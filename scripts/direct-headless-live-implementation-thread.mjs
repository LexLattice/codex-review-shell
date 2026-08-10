#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const LIVE_OPT_IN_ENV_VAR = "CODEX_DIRECT_HEADLESS_LIVE_IMPLEMENTATION_THREAD";
const DEFAULT_MODEL = "gpt-5.5";
const DEFAULT_REASONING_EFFORT = "low";
const REPORT_SCHEMA = "direct_live_implementation_thread_test@1";

const { createDirectAuthStore } = require("../src/main/direct/auth/auth-store.js");
const { createDirectAuthLoginCoordinator } = require("../src/main/direct/auth/auth-login.js");
const { createCodexCliAuthStore, createDirectAuthCompositeStore } = require("../src/main/direct/auth/codex-cli-auth.js");
const { loadDirectCodexProfile } = require("../src/main/direct/odeu-profile/profile-loader.js");
const { DirectSessionStore } = require("../src/main/direct/session/session-store.js");
const {
  DEFAULT_CODEX_RESPONSES_ENDPOINT,
  DEFAULT_REPAIR_LOOP_CONTINUATION_INSTRUCTIONS,
  directImplementationToolSchemas,
  requestShapeForDiagnostic,
  runImplementationToolInitialProbe,
  runPersistedReadOnlyToolContinuation,
} = require("../src/main/direct/transport/codex-responses-transport.js");
const {
  approveReadOnlyToolObligation,
  buildReadOnlyToolContinuationRequest,
  executeApprovedReadOnlyToolObligation,
} = require("../src/main/direct/tools/read-only-authority.js");
const {
  approvePatchApplyObligation,
  buildPatchApplyContinuationRequest,
  executeApprovedPatchApplyObligation,
  planPatchApplyObligation,
} = require("../src/main/direct/tools/patch-apply-authority.js");
const {
  approveCommandExecutionObligation,
  buildCommandExecutionContinuationRequest,
  executeApprovedCommandExecutionObligation,
  planCommandExecutionObligation,
} = require("../src/main/direct/tools/command-execution-authority.js");

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function nowIso(nowMs = Date.now()) {
  return new Date(Number(nowMs) || Date.now()).toISOString();
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function parseArgs(argv) {
  const options = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      options._.push(arg);
      continue;
    }
    const raw = arg.slice(2);
    const equals = raw.indexOf("=");
    if (equals >= 0) {
      options[raw.slice(0, equals)] = raw.slice(equals + 1);
      continue;
    }
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      options[raw] = next;
      index += 1;
      continue;
    }
    options[raw] = true;
  }
  return options;
}

function optionString(options, name, fallback = "") {
  return normalizeString(options[name], fallback);
}

function optionFlag(options, name, fallback = false) {
  const value = options[name];
  if (value === undefined) return fallback;
  if (typeof value === "boolean") return value;
  return /^(1|true|yes)$/i.test(String(value || "").trim());
}

function envFlag(name) {
  return /^(1|true|yes)$/i.test(String(process.env[name] || "").trim());
}

function defaultAppUserDataRoot() {
  if (process.env.CODEX_DIRECT_APP_USER_DATA_ROOT) return process.env.CODEX_DIRECT_APP_USER_DATA_ROOT;
  if (process.env.APPDATA) return path.join(process.env.APPDATA, "codex-review-shell-direct");
  if (process.env.XDG_CONFIG_HOME) return path.join(process.env.XDG_CONFIG_HOME, "codex-review-shell-direct");
  return path.join(os.homedir(), ".config", "codex-review-shell-direct");
}

function writableTmpDir() {
  for (const candidate of [process.env.CODEX_DIRECT_TEST_TMPDIR, process.env.TMPDIR, os.tmpdir(), "/tmp"].filter(Boolean)) {
    try {
      fs.mkdirSync(candidate, { recursive: true });
      fs.accessSync(candidate, fs.constants.W_OK);
      return candidate;
    } catch {
      // Try the next candidate.
    }
  }
  return os.tmpdir();
}

function ensureDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
}

function writeText(filePath, value) {
  ensureDirectory(path.dirname(filePath));
  fs.writeFileSync(filePath, value);
}

function writeJson(filePath, value) {
  ensureDirectory(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

function safeText(value) {
  return typeof value === "string" ? value : "";
}

function listFiles(root) {
  const output = [];
  function walk(directory) {
    for (const name of fs.readdirSync(directory).sort()) {
      if (name === ".git" || name === "node_modules") continue;
      const absolute = path.join(directory, name);
      const relPath = path.relative(root, absolute).replace(/\\/g, "/");
      const stat = fs.statSync(absolute);
      if (stat.isDirectory()) walk(absolute);
      else output.push(relPath);
    }
  }
  walk(root);
  return output;
}

function snapshotWorkspace(root) {
  return Object.fromEntries(listFiles(root).map((relPath) => [
    relPath,
    sha256(fs.readFileSync(path.join(root, relPath))),
  ]));
}

function diffSnapshots(before = {}, after = {}) {
  const paths = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  return paths.filter((relPath) => before[relPath] !== after[relPath]);
}

function countPatchLines(patchText = "") {
  let addedLineCount = 0;
  let removedLineCount = 0;
  let hunkCount = 0;
  for (const line of String(patchText).split(/\r?\n/)) {
    if (line.startsWith("@@")) hunkCount += 1;
    else if (line.startsWith("+") && !line.startsWith("+++")) addedLineCount += 1;
    else if (line.startsWith("-") && !line.startsWith("---")) removedLineCount += 1;
  }
  return { addedLineCount, removedLineCount, hunkCount };
}

function filesFromPatch(patchText, before, after = before) {
  const counts = countPatchLines(patchText);
  const paths = [];
  for (const line of String(patchText).split(/\r?\n/)) {
    const match = line.match(/^\+\+\+ b\/(.+)$/);
    if (match) paths.push(match[1]);
  }
  return [...new Set(paths)].map((displayPath) => ({
    displayPath,
    operation: before[displayPath] ? "update" : "create",
    beforeDigest: before[displayPath] || "",
    afterDigest: after[displayPath] || "",
    addedLineCount: counts.addedLineCount,
    removedLineCount: counts.removedLineCount,
    hunkCount: counts.hunkCount,
    previewText: String(patchText).slice(0, 4000),
    previewTruncated: String(patchText).length > 4000,
  }));
}

function spawnProcess(command, args, options = {}) {
  const startedAt = nowIso();
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    input: options.input,
    encoding: "utf8",
    timeout: options.timeoutMs || 120000,
    shell: false,
  });
  const completedAt = nowIso();
  return {
    exitCode: typeof result.status === "number" ? result.status : null,
    signal: normalizeString(result.signal, ""),
    stdout: safeText(result.stdout),
    stderr: safeText(result.stderr || result.error?.message),
    timedOut: result.error?.code === "ETIMEDOUT",
    durationMs: Math.max(0, Date.parse(completedAt) - Date.parse(startedAt)),
    startedAt,
    completedAt,
  };
}

function createFixtureWorkspace(root) {
  ensureDirectory(root);
  writeText(path.join(root, "README.md"), [
    "# Direct live implementation fixture",
    "",
    "The calculator module has a deliberate bug.",
    "Fix `add(a, b)` so `npm test` passes.",
    "",
  ].join("\n"));
  writeText(path.join(root, "src", "calc.js"), [
    "function add(a, b) {",
    "  return a - b;",
    "}",
    "",
    "module.exports = { add };",
    "",
  ].join("\n"));
  writeText(path.join(root, "test.js"), [
    "const assert = require('node:assert/strict');",
    "const { add } = require('./src/calc');",
    "",
    "assert.equal(add(2, 3), 5);",
    "assert.equal(add(-2, 7), 5);",
    "console.log('fixture tests passed');",
    "",
  ].join("\n"));
  writeJson(path.join(root, "package.json"), {
    name: "direct-live-implementation-fixture",
    private: true,
    version: "1.0.0",
    scripts: {
      test: "node test.js",
    },
  });
}

function containedPath(root, relPath) {
  const safeRel = normalizeString(relPath, "").replace(/\\/g, "/");
  const absolute = path.resolve(root, safeRel);
  if (!safeRel || absolute === root || !absolute.startsWith(`${root}${path.sep}`)) {
    const error = new Error(`Workspace path is not contained: ${safeRel || "(empty)"}`);
    error.code = "workspace_path_not_contained";
    throw error;
  }
  return { safeRel, absolute };
}

function createWorkspaceRequest(workspaceRoot) {
  return async function workspaceRequest(method, payload = {}) {
    if (method === "readFile") {
      const { safeRel, absolute } = containedPath(workspaceRoot, payload.relPath);
      const buffer = fs.readFileSync(absolute);
      return {
        relPath: safeRel,
        text: buffer.toString("utf8"),
        size: buffer.length,
        binary: false,
        truncated: false,
        source: "direct-live-fixture-workspace",
      };
    }
    if (method === "applyPatch") {
      const patch = safeText(payload.patch);
      const before = snapshotWorkspace(workspaceRoot);
      const check = spawnProcess("git", ["apply", "--check", "-"], { cwd: workspaceRoot, input: patch });
      if (check.exitCode !== 0) {
        const error = new Error(check.stderr || "git apply --check failed");
        error.code = "patch_dry_run_failed";
        throw error;
      }
      if (payload.mode === "dryRun") {
        const files = filesFromPatch(patch, before);
        return {
          files,
          totals: {
            fileCount: files.length,
            createCount: files.filter((file) => file.operation === "create").length,
            updateCount: files.filter((file) => file.operation === "update").length,
            deleteCount: 0,
            ...countPatchLines(patch),
          },
          backendCapabilities: { gitApplyCheck: true, gitApply: true },
          workspaceBindingEvidenceKey: `workspace_${sha256(workspaceRoot).slice(0, 16)}`,
        };
      }
      const apply = spawnProcess("git", ["apply", "-"], { cwd: workspaceRoot, input: patch });
      if (apply.exitCode !== 0) {
        const error = new Error(apply.stderr || "git apply failed");
        error.code = "patch_apply_failed";
        throw error;
      }
      const after = snapshotWorkspace(workspaceRoot);
      return {
        files: filesFromPatch(patch, before, after),
        backendCapabilities: { gitApplyCheck: true, gitApply: true },
        workspaceBindingEvidenceKey: `workspace_${sha256(workspaceRoot).slice(0, 16)}`,
      };
    }
    if (method === "runDirectCommand") {
      const before = snapshotWorkspace(workspaceRoot);
      const cwdRelPath = normalizeString(payload.cwdRelPath, "");
      const cwd = cwdRelPath ? containedPath(workspaceRoot, cwdRelPath).absolute : workspaceRoot;
      const result = spawnProcess(payload.command, Array.isArray(payload.args) ? payload.args : [], {
        cwd,
        timeoutMs: payload.timeoutMs,
      });
      const after = snapshotWorkspace(workspaceRoot);
      const changed = diffSnapshots(before, after);
      return {
        ...result,
        workspaceEffects: {
          changedPathCount: changed.length,
          changedPathsPreview: changed.slice(0, 20),
          changedPathsTruncated: false,
          scanScope: "fixture_workspace",
          scanFailed: false,
        },
        workspaceEffectScanCapabilities: {
          supported: true,
          strategy: "sha256_recursive_snapshot",
        },
        backendCapabilities: {
          shellFalse: true,
          timeoutKill: true,
          workspaceEffectScan: true,
        },
        backgroundProcessCheck: {
          supported: false,
          orphanedProcessSuspected: false,
        },
        workspaceBindingEvidenceKey: `workspace_${sha256(workspaceRoot).slice(0, 16)}`,
        workspaceEffectScanConsistency: "stable",
      };
    }
    const error = new Error(`Unsupported workspace request: ${method}`);
    error.code = "unsupported_workspace_request";
    throw error;
  };
}

function assistantTextFromEvents(events = []) {
  return (Array.isArray(events) ? events : [])
    .filter((event) => event?.type === "message_delta")
    .map((event) => event.text || "")
    .join("");
}

function responseIdFromEvents(events = []) {
  return [...(Array.isArray(events) ? events : [])].reverse().find((event) => event?.responseId)?.responseId || "";
}

function fixturePrompt() {
  return [
    "You are testing a direct harness implementation lane in a disposable workspace.",
    "You have provider-declared tools: read_file, apply_patch, run_command. Use them one at a time.",
    "Task:",
    "1. Read README.md and src/calc.js.",
    "2. Fix the bug in src/calc.js by using apply_patch with a git-apply-compatible unified diff.",
    "3. Run npm test with run_command.",
    "4. If a sub-agent/spawn-agent tool is actually available in this request, use it for a tiny review. If it is not available, do not invent one; state sub_agent_status=\"unavailable_not_declared\" in the final.",
    "5. Final answer must summarize files read, files changed, test result, and sub-agent status.",
  ].join("\n");
}

function reportAssertions(report = {}) {
  const actionLog = Array.isArray(report.actionLog) ? report.actionLog : [];
  const workspaceFiles = isPlainObject(report.workspaceFiles) ? report.workspaceFiles : {};
  return {
    schemaValid: report.schema === REPORT_SCHEMA,
    providerStarted: report.providerStarted === true,
    declaredReadPatchCommand: ["read_file", "apply_patch", "run_command"].every((tool) => (report.declaredTools || []).includes(tool)),
    readCount: actionLog.filter((entry) => entry.tool === "read_file" && entry.status === "completed").length,
    patchApplied: actionLog.some((entry) => entry.tool === "apply_patch" && entry.status === "applied"),
    commandPassed: actionLog.some((entry) => entry.tool === "run_command" && entry.status === "completed_exit_zero"),
    finalTestPassed: report.finalTest?.exitCode === 0,
    calcFixed: /return a \+ b;/.test(workspaceFiles["src/calc.js"] || ""),
    finalCompleted: report.finalTurnState === "completed",
    subAgentUnavailableTruthful: report.subAgentToolDeclared === false &&
      /unavailable_not_declared/.test(normalizeString(report.finalAssistantText, "")),
    rawPromptIncluded: report.rawPromptIncluded === true,
    rawProviderPayloadIncluded: report.rawProviderPayloadIncluded === true,
    rawAuthTokensIncluded: report.rawAuthTokensIncluded === true,
  };
}

function reportPassed(report = {}) {
  const assertions = reportAssertions(report);
  return assertions.schemaValid &&
    assertions.providerStarted &&
    assertions.declaredReadPatchCommand &&
    assertions.readCount >= 2 &&
    assertions.patchApplied &&
    assertions.commandPassed &&
    assertions.finalTestPassed &&
    assertions.calcFixed &&
    assertions.finalCompleted &&
    assertions.subAgentUnavailableTruthful &&
    assertions.rawPromptIncluded === false &&
    assertions.rawProviderPayloadIncluded === false &&
    assertions.rawAuthTokensIncluded === false;
}

function providerBlockFromEvents(events = []) {
  const quota = (Array.isArray(events) ? events : []).find((event) => event?.type === "quota_error");
  if (quota) {
    return {
      reasonCode: "provider_quota_error",
      providerErrorCode: normalizeString(quota.code, "quota_error"),
      providerErrorClass: "quota_error",
      rendererSafeMessage: "Live implementation-thread harness was blocked by provider quota.",
    };
  }
  return null;
}

function buildBlockedReport(reasonCode, message) {
  const report = {
    schema: REPORT_SCHEMA,
    status: "blocked",
    reasonCode,
    rendererSafeMessage: message,
    providerStarted: false,
    providerCompleted: false,
    declaredTools: [],
    actionLog: [],
    rawPromptIncluded: false,
    rawProviderPayloadIncluded: false,
    rawAuthTokensIncluded: false,
    grantsAuthority: false,
    workspaceMutationStarted: false,
    createdAt: nowIso(),
  };
  report.assertions = reportAssertions(report);
  report.reportDigest = `sha256:${sha256(JSON.stringify(report))}`;
  return report;
}

function buildFixturePassingReport() {
  const report = {
    schema: REPORT_SCHEMA,
    status: "passed",
    providerStarted: true,
    providerCompleted: true,
    declaredTools: ["read_file", "apply_patch", "run_command"],
    subAgentToolDeclared: false,
    actionLog: [
      { step: 1, tool: "read_file", status: "completed", relPath: "README.md" },
      { step: 2, tool: "read_file", status: "completed", relPath: "src/calc.js" },
      { step: 3, tool: "apply_patch", status: "applied", files: [{ path: "src/calc.js", operation: "update" }] },
      { step: 4, tool: "run_command", status: "completed_exit_zero", exitCode: 0 },
    ],
    finalTurnState: "completed",
    finalTest: { exitCode: 0, stdoutPreview: "fixture tests passed", stderrPreview: "" },
    finalAssistantText: "sub_agent_status=\"unavailable_not_declared\"",
    workspaceFiles: {
      "src/calc.js": "function add(a, b) {\n  return a + b;\n}\n",
    },
    rawPromptIncluded: false,
    rawProviderPayloadIncluded: false,
    rawAuthTokensIncluded: false,
    grantsAuthority: false,
    workspaceMutationStarted: true,
    createdAt: nowIso(0),
  };
  report.assertions = reportAssertions(report);
  report.reportDigest = `sha256:${sha256(JSON.stringify(report))}`;
  return report;
}

async function runLive(options = {}) {
  const runId = optionString(options, "run-id", `direct_live_impl_${Date.now()}`);
  const outputRoot = path.resolve(optionString(options, "output-root", path.join(writableTmpDir(), runId)));
  const workspaceRoot = path.join(outputRoot, "workspace");
  const sessionRoot = path.join(outputRoot, "sessions");
  const reportPath = path.join(outputRoot, "live-implementation-thread-report.json");
  createFixtureWorkspace(workspaceRoot);
  const initialPackageDigest = sha256(fs.readFileSync(path.join(workspaceRoot, "package.json")));

  const appUserDataRoot = path.resolve(optionString(
    options,
    "app-user-data-root",
    defaultAppUserDataRoot(),
  ));
  const authStore = createDirectAuthCompositeStore({
    primaryStore: createDirectAuthStore({ mode: "file", rootDir: path.join(appUserDataRoot, "direct-auth") }),
    fallbackStore: createCodexCliAuthStore({ filePath: optionString(options, "codex-auth-file", "") }),
  });
  const authLogin = createDirectAuthLoginCoordinator();
  let authStatus = authStore.readStatus();
  if (authStatus.status === "expired" || authStatus.status === "refresh_failed") {
    await authLogin.refreshCredentials({ activeStore: () => authStore });
    authStatus = authStore.readStatus();
  }
  if (authStatus.status !== "authenticated") {
    const error = new Error(`Direct auth is not authenticated: ${authStatus.status || "unknown"}`);
    error.code = "direct_auth_not_authenticated";
    throw error;
  }

  const profileDoc = loadDirectCodexProfile();
  const sessionStore = new DirectSessionStore({ rootDir: sessionRoot });
  const workspaceRequest = createWorkspaceRequest(workspaceRoot);
  const model = optionString(options, "model", DEFAULT_MODEL);
  const reasoningEffort = optionString(options, "reasoning-effort", optionString(options, "effort", DEFAULT_REASONING_EFFORT));
  const endpoint = optionString(options, "endpoint", process.env.CODEX_DIRECT_RESPONSES_ENDPOINT || DEFAULT_CODEX_RESPONSES_ENDPOINT);
  const tools = directImplementationToolSchemas(["read_file", "apply_patch", "run_command"]);
  const prompt = fixturePrompt();
  const session = sessionStore.createSession({
    projectId: "direct_live_impl_fixture",
    workspace: { kind: "local", localPath: workspaceRoot },
    workspaceDisplayPath: "/tmp/direct-live-implementation-fixture",
    title: "Direct live implementation capability test",
    model,
    reasoningEffort,
    runtimeMode: "direct-experimental",
    directTransport: "direct-implementation-tools",
    sourceClass: "direct-native",
    nativeDirectSession: true,
  });
  const requestShape = requestShapeForDiagnostic({
    model,
    stream: true,
    store: false,
    tools,
    input: [{ role: "user", content: [{ type: "input_text", text: prompt }] }],
    reasoning: { effort: reasoningEffort },
  });
  const turn = sessionStore.createTurn(session.sessionId, {
    input: [{ role: "user", text: prompt }],
    model,
    reasoningEffort,
    requestShape,
  });
  const actionLog = [];
  const initial = await runImplementationToolInitialProbe({
    endpoint,
    authStore,
    refreshCredentials: () => authLogin.refreshCredentials({ activeStore: () => authStore }),
    profileDoc,
    model,
    reasoningEffort,
    prompt,
    tools,
    toolNames: ["read_file", "apply_patch", "run_command"],
  });
  sessionStore.writeDiagnostic(session.sessionId, "direct_live_impl_initial", initial.diagnostic);
  sessionStore.appendNormalizedEvents(session.sessionId, turn.turnId, initial.normalizedEvents);
  sessionStore.updateTurnState(session.sessionId, turn.turnId, initial.terminal?.state || "tool_waiting", {
    responseId: initial.responseId || responseIdFromEvents(initial.normalizedEvents),
  });
  const initialProviderBlock = providerBlockFromEvents(initial.normalizedEvents);
  if (initialProviderBlock) {
    const turnAfter = sessionStore.readTurn(session.sessionId, turn.turnId) || {};
    const report = {
      schema: REPORT_SCHEMA,
      status: "blocked",
      reasonCode: initialProviderBlock.reasonCode,
      rendererSafeMessage: initialProviderBlock.rendererSafeMessage,
      providerErrorCode: initialProviderBlock.providerErrorCode,
      providerErrorClass: initialProviderBlock.providerErrorClass,
      runId,
      outputEvidenceKey: `sha256:${sha256(outputRoot)}`,
      workspaceEvidenceKey: `sha256:${sha256(workspaceRoot)}`,
      sessionId: session.sessionId,
      turnId: turn.turnId,
      model,
      reasoningEffort,
      declaredTools: tools.map((tool) => tool.name),
      subAgentToolDeclared: tools.some((tool) => /agent|worker|spawn/i.test(tool.name)),
      providerStarted: true,
      providerCompleted: false,
      actionLog,
      finalTurnState: turnAfter.state || "",
      finalAssistantText: "",
      finalAssistantTextDigest: "",
      finalTest: null,
      workspaceFiles: Object.fromEntries(listFiles(workspaceRoot).map((relPath) => [relPath, fs.readFileSync(path.join(workspaceRoot, relPath), "utf8")])),
      turnSummary: {
        normalizedEventCount: Number(turnAfter.normalizedEventCount || 0),
        toolResultCount: Array.isArray(turnAfter.toolResults) ? turnAfter.toolResults.length : 0,
        responseId: turnAfter.responseId || "",
        continuationResponseId: turnAfter.continuationResponseId || "",
      },
      rawPromptIncluded: false,
      rawProviderPayloadIncluded: false,
      rawAuthTokensIncluded: false,
      grantsAuthority: false,
      workspaceMutationStarted: false,
      createdAt: nowIso(),
    };
    report.assertions = reportAssertions(report);
    report.reportDigest = `sha256:${sha256(JSON.stringify(report))}`;
    writeJson(reportPath, report);
    return { report, reportPath, outputRoot };
  }
  let pending = sessionStore.addToolObligations(session.sessionId, turn.turnId, initial.normalizedEvents).obligations;
  let finalText = assistantTextFromEvents(initial.normalizedEvents);

  for (let step = 0; step < 8 && pending.length; step += 1) {
    const obligation = pending[0];
    const toolName = obligation.name;
    let continuationRequest = null;
    if (toolName === "read_file") {
      approveReadOnlyToolObligation({ sessionStore, sessionId: session.sessionId, turnId: turn.turnId, obligationId: obligation.obligationId, projectId: "direct_live_impl_fixture" });
      const executed = await executeApprovedReadOnlyToolObligation({ sessionStore, sessionId: session.sessionId, turnId: turn.turnId, obligationId: obligation.obligationId, workspaceRequest, projectId: "direct_live_impl_fixture" });
      continuationRequest = buildReadOnlyToolContinuationRequest({ sessionStore, sessionId: session.sessionId, turnId: turn.turnId, obligationId: obligation.obligationId, continuationLiveSendEnabled: true });
      actionLog.push({ step: step + 1, tool: toolName, status: executed.result.status, relPath: executed.result.relPath });
    } else if (toolName === "apply_patch") {
      await planPatchApplyObligation({ sessionStore, sessionId: session.sessionId, turnId: turn.turnId, obligationId: obligation.obligationId, workspaceRequest, projectId: "direct_live_impl_fixture" });
      approvePatchApplyObligation({ sessionStore, sessionId: session.sessionId, turnId: turn.turnId, obligationId: obligation.obligationId, projectId: "direct_live_impl_fixture" });
      const executed = await executeApprovedPatchApplyObligation({ sessionStore, sessionId: session.sessionId, turnId: turn.turnId, obligationId: obligation.obligationId, workspaceRequest, projectId: "direct_live_impl_fixture" });
      continuationRequest = buildPatchApplyContinuationRequest({ sessionStore, sessionId: session.sessionId, turnId: turn.turnId, obligationId: obligation.obligationId, continuationLiveSendEnabled: true });
      actionLog.push({ step: step + 1, tool: toolName, status: executed.result.status, files: executed.result.files });
    } else if (toolName === "run_command") {
      await planCommandExecutionObligation({ sessionStore, sessionId: session.sessionId, turnId: turn.turnId, obligationId: obligation.obligationId, workspaceRequest, projectId: "direct_live_impl_fixture" });
      approveCommandExecutionObligation({ sessionStore, sessionId: session.sessionId, turnId: turn.turnId, obligationId: obligation.obligationId, projectId: "direct_live_impl_fixture" });
      const executed = await executeApprovedCommandExecutionObligation({ sessionStore, sessionId: session.sessionId, turnId: turn.turnId, obligationId: obligation.obligationId, workspaceRequest, projectId: "direct_live_impl_fixture" });
      continuationRequest = buildCommandExecutionContinuationRequest({ sessionStore, sessionId: session.sessionId, turnId: turn.turnId, obligationId: obligation.obligationId, continuationLiveSendEnabled: true });
      actionLog.push({ step: step + 1, tool: toolName, status: executed.result.status, exitCode: executed.result.exitCode });
    } else {
      actionLog.push({ step: step + 1, tool: toolName, status: "unsupported_by_live_implementation_harness" });
      break;
    }

    const resultText = continuationRequest.toolResult?.content?.map((item) => item.text).join("\n") || "";
    const contextPrompt = [
      prompt,
      "",
      "Tool/action history so far:",
      JSON.stringify(actionLog, null, 2),
      "",
      "[LATEST LOCAL TOOL RESULT EVIDENCE]",
      resultText,
      "",
      "Continue the same task. If more work is required, request exactly one next supported tool. If all work is done, give the final answer.",
    ].join("\n");
    const continuation = await runPersistedReadOnlyToolContinuation({
      sessionStore,
      sessionId: session.sessionId,
      turnId: turn.turnId,
      obligationId: obligation.obligationId,
      continuationRequest,
      endpoint,
      authStore,
      refreshCredentials: () => authLogin.refreshCredentials({ activeStore: () => authStore }),
      profileDoc,
      model,
      reasoningEffort,
      prompt: contextPrompt,
      instructions: DEFAULT_REPAIR_LOOP_CONTINUATION_INSTRUCTIONS,
      continuationTools: tools,
      allowSequentialImplementationRepairLoop: true,
      projectId: "direct_live_impl_fixture",
    });
    finalText = assistantTextFromEvents(continuation.normalizedEvents) || finalText;
    pending = Array.isArray(continuation.nextToolObligations) ? continuation.nextToolObligations : [];
    if (!pending.length && continuation.terminal?.state === "completed") break;
  }

  const packageDigest = sha256(fs.readFileSync(path.join(workspaceRoot, "package.json")));
  const packageManifestUnchanged = packageDigest === initialPackageDigest;
  const finalTest = packageManifestUnchanged
    ? spawnProcess(process.execPath, ["test.js"], { cwd: workspaceRoot, timeoutMs: 120000 })
    : {
        exitCode: null,
        stdout: "",
        stderr: "Final fixture test blocked because package.json changed; refusing to execute package scripts after model-controlled patches.",
        timedOut: false,
      };
  const turnAfter = sessionStore.readTurn(session.sessionId, turn.turnId) || {};
  const report = {
    schema: REPORT_SCHEMA,
    status: "failed",
    runId,
    outputEvidenceKey: `sha256:${sha256(outputRoot)}`,
    workspaceEvidenceKey: `sha256:${sha256(workspaceRoot)}`,
    sessionId: session.sessionId,
    turnId: turn.turnId,
    model,
    reasoningEffort,
    declaredTools: tools.map((tool) => tool.name),
    subAgentToolDeclared: tools.some((tool) => /agent|worker|spawn/i.test(tool.name)),
    providerStarted: true,
    providerCompleted: true,
    actionLog,
    finalTurnState: turnAfter.state || "",
    finalAssistantText: finalText,
    finalAssistantTextDigest: finalText ? `sha256:${sha256(finalText)}` : "",
    finalTest: {
      exitCode: finalTest.exitCode,
      stdoutPreview: finalTest.stdout.slice(0, 2000),
      stderrPreview: finalTest.stderr.slice(0, 2000),
      command: packageManifestUnchanged ? `${process.execPath} test.js` : "",
      packageManifestUnchanged,
    },
    workspaceFiles: Object.fromEntries(listFiles(workspaceRoot).map((relPath) => [relPath, fs.readFileSync(path.join(workspaceRoot, relPath), "utf8")])),
    turnSummary: {
      normalizedEventCount: Number(turnAfter.normalizedEventCount || 0),
      toolResultCount: Array.isArray(turnAfter.toolResults) ? turnAfter.toolResults.length : 0,
      responseId: turnAfter.responseId || "",
      continuationResponseId: turnAfter.continuationResponseId || "",
    },
    rawPromptIncluded: false,
    rawProviderPayloadIncluded: false,
    rawAuthTokensIncluded: false,
    grantsAuthority: false,
    workspaceMutationStarted: true,
    createdAt: nowIso(),
  };
  report.assertions = reportAssertions(report);
  report.status = reportPassed(report) ? "passed" : "failed";
  report.reportDigest = `sha256:${sha256(JSON.stringify(report))}`;
  writeJson(reportPath, report);
  return { report, reportPath, outputRoot };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (optionFlag(options, "fixture-report", false)) {
    const report = buildFixturePassingReport();
    if (optionFlag(options, "report-json", false)) console.log(JSON.stringify(report, null, 2));
    return;
  }
  if (!optionFlag(options, "allow-live-provider-call", false) && !envFlag(LIVE_OPT_IN_ENV_VAR)) {
    const report = buildBlockedReport(
      "live_provider_call_opt_in_missing",
      `Pass --allow-live-provider-call or set ${LIVE_OPT_IN_ENV_VAR}=1 to run live implementation-thread harness.`,
    );
    if (optionFlag(options, "report-json", false)) console.log(JSON.stringify(report, null, 2));
    else console.error(report.rendererSafeMessage);
    process.exitCode = 2;
    return;
  }
  const { report, reportPath, outputRoot } = await runLive(options);
  const summary = {
    ok: report.status === "passed",
    status: report.status,
    reasonCode: report.reasonCode || "",
    rendererSafeMessage: report.rendererSafeMessage || "",
    reportPath,
    outputRoot,
    sessionId: report.sessionId,
    turnId: report.turnId,
    declaredTools: report.declaredTools,
    actionLog: report.actionLog,
    finalTest: report.finalTest,
    finalAssistantText: report.finalAssistantText,
  };
  if (optionFlag(options, "report-json", false)) console.log(JSON.stringify(summary, null, 2));
  else console.log(reportPath);
  process.exitCode = report.status === "passed" ? 0 : (report.status === "blocked" ? 2 : 1);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exit(1);
  });
}

export {
  LIVE_OPT_IN_ENV_VAR,
  REPORT_SCHEMA,
  buildBlockedReport,
  buildFixturePassingReport,
  createFixtureWorkspace,
  fixturePrompt,
  providerBlockFromEvents,
  reportAssertions,
  reportPassed,
  writableTmpDir,
};
