#!/usr/bin/env node

import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);

const { DirectSessionStore } = require("../src/main/direct/session/session-store");
const { DirectThreadStore } = require("../src/main/direct/thread/thread-store");
const {
  approveCommandExecutionObligation,
  buildCommandExecutionContinuationRequest,
  executeApprovedCommandExecutionObligation,
  planCommandExecutionObligation,
} = require("../src/main/direct/tools/command-execution-authority");
const {
  recordReadOnlyToolContinuationRequest,
} = require("../src/main/direct/tools/read-only-authority");

const MAX_STDIO_CAPTURE_CHARS = 64 * 1024;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    const output = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] !== undefined) output[key] = stableValue(value[key]);
    }
    return output;
  }
  return value;
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function ensureDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
}

function writeTextFile(targetPath, text) {
  ensureDirectory(path.dirname(targetPath));
  fs.writeFileSync(targetPath, text, "utf8");
}

function boundedText(value, maxChars = MAX_STDIO_CAPTURE_CHARS) {
  const text = String(value || "");
  return text.length > maxChars ? text.slice(0, maxChars) : text;
}

function normalizeRelPath(value) {
  const text = normalizeString(value, "").replace(/\\/g, "/").replace(/^\.\/+/, "");
  if (!text || text.startsWith("/") || /^[A-Za-z]:\//.test(text) || text.includes("://") || text.split("/").includes("..") || /[\0-\x1f\x7f]/.test(text)) {
    const error = new Error("Unsafe workspace-relative path.");
    error.code = "unsafe_workspace_path";
    throw error;
  }
  return text;
}

function containedPath(root, relPath) {
  const normalized = normalizeRelPath(relPath);
  const resolved = path.resolve(root, normalized);
  const rootResolved = path.resolve(root);
  if (resolved !== rootResolved && !resolved.startsWith(`${rootResolved}${path.sep}`)) {
    const error = new Error("Workspace path escapes root.");
    error.code = "workspace_path_escape";
    throw error;
  }
  return { normalized, resolved };
}

function listWorkspaceFiles(root) {
  const files = [];
  function walk(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      const rel = path.relative(root, full).replace(/\\/g, "/");
      if (rel === ".git" || rel.startsWith(".git/")) continue;
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) files.push(rel);
    }
  }
  walk(root);
  return files.sort();
}

function workspaceDigestMap(root) {
  const map = new Map();
  for (const relPath of listWorkspaceFiles(root)) {
    map.set(relPath, sha256(fs.readFileSync(path.join(root, relPath))));
  }
  return map;
}

function workspaceEffectSummary(before, after) {
  const changed = [];
  const keys = new Set([...before.keys(), ...after.keys()]);
  for (const key of [...keys].sort()) {
    if (!before.has(key)) changed.push({ relPath: key, changeKind: "created" });
    else if (!after.has(key)) changed.push({ relPath: key, changeKind: "deleted" });
    else if (before.get(key) !== after.get(key)) changed.push({ relPath: key, changeKind: "modified" });
  }
  return {
    preCommandWorkspaceDigest: sha256(stableJson(Object.fromEntries(before.entries()))),
    postCommandWorkspaceDigest: sha256(stableJson(Object.fromEntries(after.entries()))),
    changedPathCount: changed.length,
    changedPathsPreview: changed.slice(0, 50),
    changedPathsTruncated: changed.length > 50,
    scanScope: "workspace-index",
    scanFailed: false,
  };
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve) => {
    const env = { ...process.env };
    for (const key of Object.keys(env)) {
      if (/OPENAI|CHATGPT|CODEX_DIRECT|CODEX_REVIEW|AUTH|TOKEN|SECRET|PASSWORD/i.test(key)) delete env[key];
    }
    const started = Date.now();
    const spawnCommand = process.platform === "win32" && command === "npm" ? "npm.cmd" : command;
    let child;
    try {
      child = spawn(spawnCommand, args, {
        cwd: options.cwd,
        env,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      resolve({
        exitCode: null,
        signal: "",
        stdout: "",
        stderr: `${error?.message || String(error)}\n`,
        stdoutTruncated: false,
        stderrTruncated: false,
        spawnError: error?.message || String(error),
        timedOut: false,
        durationMs: Date.now() - started,
      });
      return;
    }
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let stdoutTruncated = false;
    let stderrTruncated = false;
    const maxCaptureBytes = Math.max(1024, Number(options.maxCaptureBytes || MAX_STDIO_CAPTURE_CHARS));
    let timer = null;
    let timedOut = false;
    if (options.timeoutMs) {
      timer = setTimeout(() => {
        timedOut = true;
        try {
          child.kill("SIGTERM");
        } catch {}
      }, Number(options.timeoutMs));
    }
    child.stdout.on("data", (chunk) => {
      const buffer = Buffer.from(chunk);
      const remaining = maxCaptureBytes - stdoutBytes;
      if (remaining > 0) {
        stdout.push(buffer.subarray(0, remaining));
        stdoutBytes += Math.min(buffer.length, remaining);
      }
      if (buffer.length > remaining) stdoutTruncated = true;
    });
    child.stderr.on("data", (chunk) => {
      const buffer = Buffer.from(chunk);
      const remaining = maxCaptureBytes - stderrBytes;
      if (remaining > 0) {
        stderr.push(buffer.subarray(0, remaining));
        stderrBytes += Math.min(buffer.length, remaining);
      }
      if (buffer.length > remaining) stderrTruncated = true;
    });
    child.on("error", (error) => {
      if (timer) clearTimeout(timer);
      resolve({
        exitCode: null,
        signal: "",
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: `${Buffer.concat(stderr).toString("utf8")}${error.message}\n`,
        stdoutTruncated,
        stderrTruncated,
        spawnError: error.message,
        timedOut,
        durationMs: Date.now() - started,
      });
    });
    child.on("close", (code, signal) => {
      if (timer) clearTimeout(timer);
      resolve({
        exitCode: code,
        signal: signal || "",
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        stdoutTruncated,
        stderrTruncated,
        timedOut,
        durationMs: Date.now() - started,
      });
    });
  });
}

function createWorkspace(root) {
  ensureDirectory(path.join(root, "test"));
  writeTextFile(path.join(root, "test", "ok.js"), "console.log('fixture ok')\n");
  writeTextFile(path.join(root, "test", "fail.js"), "console.error('fixture fail')\nprocess.exit(2)\n");
  writeTextFile(path.join(root, "test", "mutate.js"), "require('fs').writeFileSync('command-output.txt', 'changed by command\\n')\nconsole.log('mutated workspace')\n");
  writeTextFile(path.join(root, "test", "slow.js"), "setTimeout(() => console.log('slow done'), 10_000)\n");
  writeTextFile(path.join(root, "package.json"), `${JSON.stringify({
    scripts: {
      test: "node test/ok.js",
      fail: "node test/fail.js",
      mutate: "node test/mutate.js",
      slow: "node test/slow.js",
      net: "curl https://example.com",
    },
  }, null, 2)}\n`);
}

function workspaceRequestFor(root, counters) {
  return async function workspaceRequest(method, params = {}) {
    if (method === "readFile") {
      counters.readFileCalls += 1;
      const { normalized, resolved } = containedPath(root, params.relPath || params.path);
      const bytes = fs.readFileSync(resolved);
      const maxBytes = Math.max(1, Number(params.maxBytes || 512 * 1024));
      return {
        relPath: normalized,
        text: bytes.subarray(0, maxBytes).toString("utf8"),
        size: bytes.length,
        truncated: bytes.length > maxBytes,
        binary: false,
        source: "fixture_workspace_backend",
      };
    }
    if (method !== "runDirectCommand") {
      const error = new Error(`Unsupported workspace method: ${method}`);
      error.code = "workspace_method_unsupported";
      throw error;
    }
    counters.runCommandCalls += 1;
    const cwdRelPath = normalizeString(params.cwdRelPath, "");
    const cwd = cwdRelPath ? containedPath(root, cwdRelPath).resolved : root;
    const before = workspaceDigestMap(root);
    let result;
    if (Array.isArray(params.args) && params.args.includes("slow")) {
      result = {
        exitCode: null,
        signal: "SIGTERM",
        stdout: "",
        stderr: "fixture timeout\n",
        stdoutTruncated: false,
        stderrTruncated: false,
        timedOut: true,
        durationMs: Number(params.timeoutMs || 1000),
      };
    } else {
      result = await runCommand(params.command, Array.isArray(params.args) ? params.args : [], {
        cwd,
        timeoutMs: Number(params.timeoutMs || 120_000),
      });
    }
    const after = workspaceDigestMap(root);
    return {
      ...result,
      stdout: boundedText(result.stdout),
      stderr: boundedText(result.stderr),
      stdoutTruncated: result.stdoutTruncated === true || String(result.stdout || "").length > MAX_STDIO_CAPTURE_CHARS,
      stderrTruncated: result.stderrTruncated === true || String(result.stderr || "").length > MAX_STDIO_CAPTURE_CHARS,
      startedAt: new Date(Date.now() - Number(result.durationMs || 0)).toISOString(),
      completedAt: new Date().toISOString(),
      workspaceEffects: workspaceEffectSummary(before, after),
      workspaceEffectScanCapabilities: {
        seesTrackedFiles: true,
        seesUntrackedFiles: true,
        seesIgnoredFiles: false,
        seesDeletedFiles: true,
        seesModeChanges: false,
        seesSymlinks: false,
        seesCaseOnlyRenames: false,
        seesContentDigests: true,
      },
      backendCapabilities: {
        shellFalseSupported: true,
        cwdContainmentSupported: true,
        timeoutKillSupported: true,
        envSanitizationSupported: true,
        networkIsolationSupported: false,
        processTreeKillSupported: process.platform !== "win32",
        workspaceEffectScanSupported: true,
      },
      backgroundProcessCheck: {
        supported: false,
        orphanedProcessSuspected: false,
      },
      workspaceBindingEvidenceKey: `workspace_${sha256(root).slice(0, 20)}`,
    };
  };
}

function commandEvent({ itemId, callId, command, args, sequence, responseId, timeoutMs, cwd = "" }) {
  return {
    type: "tool_call_completed",
    sequence,
    itemId,
    callId,
    name: "run_command",
    toolType: "function_call",
    argumentsJson: JSON.stringify({ command, args, timeoutMs, cwd }),
    responseId,
  };
}

function buildContinuationContext({
  sessionStore,
  threadStore,
  projectId,
  sessionId,
  turnId,
  obligationId,
  continuationRequest,
  requestShapeEvidenceRef,
}) {
  const turn = sessionStore.readTurn(sessionId, turnId);
  const session = sessionStore.readSession(sessionId);
  threadStore.indexSessionArtifacts(sessionStore, session, [turn]);
  const requestShape = {
    kind: "command_execution_continuation",
    stream: true,
    store: false,
    tools: false,
    toolDeclarations: false,
    toolOutputItem: false,
    parallelToolCalls: false,
    hasInstructions: true,
    hasPreviousResponseId: false,
    continuationTransportMode: "fresh_context",
    requestShapeClass: requestShapeEvidenceRef,
    toolLoopId: normalizeString(continuationRequest.toolLoop?.toolLoopId, ""),
    stepId: normalizeString(continuationRequest.toolLoop?.stepId, ""),
    stepOrdinal: Number(continuationRequest.toolLoop?.stepOrdinal || 1),
    commandResultId: normalizeString(continuationRequest.toolResult?.metadata?.resultId, ""),
  };
  const built = threadStore.buildAndPersistContextForToolContinuation({
    sessionStore,
    session,
    projectId,
    threadId: sessionId,
    turnId,
    obligationId,
    continuationRequest,
    previousResponseId: normalizeString(turn?.responseId, ""),
    model: normalizeString(turn?.model, "gpt-5.5"),
    requestShape,
    requestShapeHash: sha256(stableJson(requestShape)),
    endpointClass: "chatgpt-codex-responses",
    endpointHash: "fixture_endpoint_hash",
    modelEvidenceRef: "fixture_model_evidence",
    requestShapeEvidenceRef,
    endpointEvidenceRef: "fixture_endpoint",
  }, { sessionStore });
  return {
    ...built,
    requestShape,
  };
}

async function executeCommandStep({
  sessionStore,
  threadStore,
  workspaceRequest,
  projectId,
  sessionId,
  turnId,
  obligationId,
  requestShapeEvidenceRef,
}) {
  const planned = await planCommandExecutionObligation({
    sessionStore,
    sessionId,
    turnId,
    obligationId,
    workspaceRequest,
    projectId,
  });
  approveCommandExecutionObligation({
    sessionStore,
    sessionId,
    turnId,
    obligationId,
    approvedBy: "fixture-operator",
    projectId,
  });
  const executed = await executeApprovedCommandExecutionObligation({
    sessionStore,
    sessionId,
    turnId,
    obligationId,
    workspaceRequest,
    projectId,
  });
  let continuationRequest = null;
  let continuationContext = null;
  if (executed.result.providerContinuationBlocked !== true) {
    const baseContinuation = buildCommandExecutionContinuationRequest({
      sessionStore,
      sessionId,
      turnId,
      obligationId,
      continuationLiveSendEnabled: true,
      projectId,
    });
    continuationContext = buildContinuationContext({
      sessionStore,
      threadStore,
      projectId,
      sessionId,
      turnId,
      obligationId,
      continuationRequest: baseContinuation,
      requestShapeEvidenceRef,
    });
    continuationRequest = {
      ...baseContinuation,
      source: {
        ...(baseContinuation.source || {}),
        contextBuildId: continuationContext.contextPack.contextBuildId,
        requestManifestId: continuationContext.requestManifest.requestManifestId,
      },
      safety: {
        ...(baseContinuation.safety || {}),
        contextPackBuilt: true,
        requestManifestBuilt: true,
        rawRequestBodyStored: false,
      },
    };
    const recorded = recordReadOnlyToolContinuationRequest({
      sessionStore,
      sessionId,
      turnId,
      obligationId,
      continuationRequest,
      continuationLiveSendEnabled: true,
      projectId,
    });
    continuationRequest = recorded.continuationRequest;
    sessionStore.updateToolObligation(sessionId, turnId, obligationId, {
      status: "continuation_sent",
      authorityState: "continuation_sent",
      executionAllowed: false,
      continuationAllowed: false,
      continuationRequest,
    }, {
      nextTurnState: "continuation_sent",
    });
  }
  return {
    commandPlan: planned.commandPlan,
    result: executed.result,
    continuationRequest,
    continuationContext,
  };
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "direct-command-tool-loop-"));
  const workspaceRoot = path.join(root, "workspace");
  const storeRoot = path.join(root, "store");
  let threadStore = null;
  try {
    createWorkspace(workspaceRoot);
    const counters = { readFileCalls: 0, runCommandCalls: 0 };
    const workspaceRequest = workspaceRequestFor(workspaceRoot, counters);
    const sessionStore = new DirectSessionStore({ rootDir: path.join(storeRoot, "sessions") });
    threadStore = new DirectThreadStore({ rootDir: path.join(storeRoot, "threads"), mode: "context_build_required" });
    const session = sessionStore.createSession({
      sessionId: "direct_command_loop_thread",
      projectId: "direct-command-loop-fixture",
      title: "Direct command loop fixture",
      model: "gpt-5.5",
      runtimeMode: "direct-experimental",
      directTransport: "live-text",
      directTier: "implementation-lane",
      nativeDirectSession: true,
    });
    const turn = sessionStore.createTurn(session.sessionId, {
      turnId: "direct_command_loop_turn",
      input: [{ role: "user", text: "Run command proof steps." }],
      model: "gpt-5.5",
      requestShape: {
        requestShapeClass: "direct_implementation_tool_initial@1",
        tools: true,
        declaredToolNames: ["run_command"],
        parallelToolCalls: false,
      },
    });
    sessionStore.updateTurnState(session.sessionId, turn.turnId, "streaming", {
      responseId: "resp_initial_command_loop",
    });

    const testObligations = sessionStore.addToolObligations(session.sessionId, turn.turnId, [
      commandEvent({
        itemId: "item_command_test",
        callId: "call_command_test",
        command: "npm",
        args: ["test"],
        sequence: 1,
        responseId: "resp_initial_command_loop",
      }),
    ], {
      parentResponseId: "resp_initial_command_loop",
      parentResponseSource: "native_direct_initial_stream",
      stepOrdinal: 1,
    }).obligations;
    assert(testObligations.length === 1, "test command obligation must be detected");
    const test = await executeCommandStep({
      sessionStore,
      threadStore,
      workspaceRequest,
      projectId: session.projectId,
      sessionId: session.sessionId,
      turnId: turn.turnId,
      obligationId: testObligations[0].obligationId,
      requestShapeEvidenceRef: "direct_command_execution_continuation@1",
    });
    assert(test.commandPlan.authorityTransition?.sideEffectExecuted === false, "command plan must be side-effect false");
    assert(test.result.sideEffectExecuted === true, "command result must mark side effect executed");
    assert(test.result.status === "completed_exit_zero", "npm test should complete with exit zero");
    assert(test.result.exitCode === 0, "npm test exit code mismatch");
    assert(test.result.stdout.textPreview.includes("fixture ok"), "npm test stdout should be captured");
    assert(test.result.workspaceEffectSummary?.changedPathCount === 0, "read-only command should report no workspace changes");
    assert(test.result.workspaceEffectSummary?.scan?.ran === true, "command workspace effect scan must run");
    assert(test.continuationRequest?.safety?.commandExecutedLocally === true, "command continuation must preserve local execution truth");
    assert(test.continuationContext?.contextPack.policy?.policyId === "direct_command_execution_continuation@1", "command continuation context must use command policy");
    assert(test.continuationContext?.requestManifest.requestShapeClass === "direct_command_execution_continuation@1", "command request manifest class mismatch");
    assert(test.continuationContext?.requestShape.toolDeclarations === false, "command continuation v0 must not declare another tool");

    const failObligations = sessionStore.addToolObligations(session.sessionId, turn.turnId, [
      commandEvent({
        itemId: "item_command_fail",
        callId: "call_command_fail",
        command: "npm",
        args: ["run", "fail"],
        sequence: 2,
        responseId: "resp_continuation_command_loop_1",
      }),
    ], {
      parentResponseId: "resp_continuation_command_loop_1",
      parentResponseSource: "native_direct_tool_continuation_stream",
      toolLoopId: test.continuationRequest.toolLoop?.toolLoopId,
      stepOrdinal: 2,
    }).obligations;
    const failed = await executeCommandStep({
      sessionStore,
      threadStore,
      workspaceRequest,
      projectId: session.projectId,
      sessionId: session.sessionId,
      turnId: turn.turnId,
      obligationId: failObligations[0].obligationId,
      requestShapeEvidenceRef: "direct_command_execution_loop_continuation@1",
    });
    assert(failed.result.status === "completed_nonzero_exit", "failing command should record nonzero exit");
    assert(failed.result.exitCode === 2, "failing command exit code mismatch");
    assert(failed.result.stderr.textPreview.includes("fixture fail"), "failing command stderr should be captured");
    assert(failed.continuationRequest?.toolLoop?.stepOrdinal === 2, "failing command continuation must carry step 2");

    const mutateObligations = sessionStore.addToolObligations(session.sessionId, turn.turnId, [
      commandEvent({
        itemId: "item_command_mutate",
        callId: "call_command_mutate",
        command: "npm",
        args: ["run", "mutate"],
        sequence: 3,
        responseId: "resp_continuation_command_loop_2",
      }),
    ], {
      parentResponseId: "resp_continuation_command_loop_2",
      parentResponseSource: "native_direct_tool_continuation_stream",
      toolLoopId: test.continuationRequest.toolLoop?.toolLoopId,
      stepOrdinal: 3,
    }).obligations;
    const mutated = await executeCommandStep({
      sessionStore,
      threadStore,
      workspaceRequest,
      projectId: session.projectId,
      sessionId: session.sessionId,
      turnId: turn.turnId,
      obligationId: mutateObligations[0].obligationId,
      requestShapeEvidenceRef: "direct_command_execution_loop_continuation@1",
    });
    assert(mutated.result.status === "completed_with_workspace_changes", "mutating command should record workspace changes");
    assert(mutated.result.workspaceEffectSummary?.changedPathCount === 1, "mutating command should detect one workspace change");
    assert(mutated.result.workspaceEffectSummary?.changedPathsPreview?.some((entry) => entry.relPath === "command-output.txt"), "mutating command should expose changed file summary");
    assert(fs.readFileSync(path.join(workspaceRoot, "command-output.txt"), "utf8") === "changed by command\n", "mutating command should write expected file");

    const timeoutObligations = sessionStore.addToolObligations(session.sessionId, turn.turnId, [
      commandEvent({
        itemId: "item_command_timeout",
        callId: "call_command_timeout",
        command: "npm",
        args: ["run", "slow"],
        timeoutMs: 250,
        sequence: 4,
        responseId: "resp_continuation_command_loop_3",
      }),
    ], {
      parentResponseId: "resp_continuation_command_loop_3",
      parentResponseSource: "native_direct_tool_continuation_stream",
      toolLoopId: test.continuationRequest.toolLoop?.toolLoopId,
      stepOrdinal: 4,
    }).obligations;
    const timedOut = await executeCommandStep({
      sessionStore,
      threadStore,
      workspaceRequest,
      projectId: session.projectId,
      sessionId: session.sessionId,
      turnId: turn.turnId,
      obligationId: timeoutObligations[0].obligationId,
      requestShapeEvidenceRef: "direct_command_execution_loop_continuation@1",
    });
    assert(timedOut.result.status === "timed_out", "timeout command should record timed_out status");
    assert(timedOut.result.signal === "SIGTERM", "timeout command should record signal");
    assert(timedOut.result.stderr.textPreview.includes("fixture timeout"), "timeout stderr should be captured");

    const blockedCommandObligations = sessionStore.addToolObligations(session.sessionId, turn.turnId, [
      commandEvent({
        itemId: "item_command_blocked",
        callId: "call_command_blocked",
        command: "curl",
        args: ["https://example.com"],
        sequence: 5,
        responseId: "resp_continuation_command_loop_4",
      }),
    ], {
      parentResponseId: "resp_continuation_command_loop_4",
      parentResponseSource: "native_direct_tool_continuation_stream",
      toolLoopId: test.continuationRequest.toolLoop?.toolLoopId,
      stepOrdinal: 5,
    }).obligations;
    let blockedCommand = false;
    try {
      await planCommandExecutionObligation({
        sessionStore,
        sessionId: session.sessionId,
        turnId: turn.turnId,
        obligationId: blockedCommandObligations[0].obligationId,
        workspaceRequest,
        projectId: session.projectId,
      });
    } catch (error) {
      blockedCommand = error?.code === "command_executable_denied";
    }
    assert(blockedCommand, "denied executable must be blocked before planning approval");

    const blockedScriptObligations = sessionStore.addToolObligations(session.sessionId, turn.turnId, [
      commandEvent({
        itemId: "item_command_script_blocked",
        callId: "call_command_script_blocked",
        command: "npm",
        args: ["run", "net"],
        sequence: 6,
        responseId: "resp_continuation_command_loop_5",
      }),
    ], {
      parentResponseId: "resp_continuation_command_loop_5",
      parentResponseSource: "native_direct_tool_continuation_stream",
      toolLoopId: test.continuationRequest.toolLoop?.toolLoopId,
      stepOrdinal: 6,
    }).obligations;
    let blockedScript = false;
    try {
      await planCommandExecutionObligation({
        sessionStore,
        sessionId: session.sessionId,
        turnId: turn.turnId,
        obligationId: blockedScriptObligations[0].obligationId,
        workspaceRequest,
        projectId: session.projectId,
      });
    } catch (error) {
      blockedScript = error?.code === "package_script_body_blocked";
    }
    assert(blockedScript, "denied helper in package script must be blocked before approval");

    const unsafeCwdObligations = sessionStore.addToolObligations(session.sessionId, turn.turnId, [
      commandEvent({
        itemId: "item_command_cwd_blocked",
        callId: "call_command_cwd_blocked",
        command: "npm",
        args: ["test"],
        cwd: "../outside",
        sequence: 7,
        responseId: "resp_continuation_command_loop_6",
      }),
    ], {
      parentResponseId: "resp_continuation_command_loop_6",
      parentResponseSource: "native_direct_tool_continuation_stream",
      toolLoopId: test.continuationRequest.toolLoop?.toolLoopId,
      stepOrdinal: 7,
    }).obligations;
    let unsafeCwdBlocked = false;
    try {
      await planCommandExecutionObligation({
        sessionStore,
        sessionId: session.sessionId,
        turnId: turn.turnId,
        obligationId: unsafeCwdObligations[0].obligationId,
        workspaceRequest,
        projectId: session.projectId,
      });
    } catch (error) {
      unsafeCwdBlocked = error?.code === "command_cwd_unsafe";
    }
    assert(unsafeCwdBlocked, "unsafe cwd must be blocked before workspace execution");

    const replay = await executeApprovedCommandExecutionObligation({
      sessionStore,
      sessionId: session.sessionId,
      turnId: turn.turnId,
      obligationId: testObligations[0].obligationId,
      workspaceRequest,
      projectId: session.projectId,
    });
    assert(replay.reused === true && replay.result?.resultId === test.result.resultId, "matching terminal command retry must replay its stored result");
    assert(counters.runCommandCalls === 4, "terminal command replay must not execute the workspace command");

    const concurrentObligation = sessionStore.addToolObligations(session.sessionId, turn.turnId, [commandEvent({
      itemId: "item_command_concurrent",
      callId: "call_command_concurrent",
      command: "npm",
      args: ["test"],
      sequence: 8,
      responseId: "resp_continuation_command_loop_7",
    })], {
      parentResponseId: "resp_continuation_command_loop_7",
      parentResponseSource: "native_direct_tool_continuation_stream",
      toolLoopId: test.continuationRequest.toolLoop?.toolLoopId,
      stepOrdinal: 8,
    }).obligations[0];
    await planCommandExecutionObligation({ sessionStore, sessionId: session.sessionId, turnId: turn.turnId, obligationId: concurrentObligation.obligationId, workspaceRequest, projectId: session.projectId });
    approveCommandExecutionObligation({ sessionStore, sessionId: session.sessionId, turnId: turn.turnId, obligationId: concurrentObligation.obligationId, projectId: session.projectId });
    const delayedWorkspaceRequest = async (...args) => {
      await new Promise((resolve) => setTimeout(resolve, 25));
      return workspaceRequest(...args);
    };
    const concurrentResults = await Promise.all([1, 2].map(() => executeApprovedCommandExecutionObligation({
      sessionStore,
      sessionId: session.sessionId,
      turnId: turn.turnId,
      obligationId: concurrentObligation.obligationId,
      workspaceRequest: delayedWorkspaceRequest,
      projectId: session.projectId,
    })));
    assert(concurrentResults.filter((entry) => entry.result?.status === "completed_exit_zero").length === 1, "concurrent command retries must have one executor");
    assert(concurrentResults.filter((entry) => entry.active === true).length === 1, "losing command retry must observe the active claim");
    assert(counters.runCommandCalls === 5, "concurrent command retries must execute the workspace command once");

    const interruptedObligation = sessionStore.addToolObligations(session.sessionId, turn.turnId, [commandEvent({
      itemId: "item_command_restart_interrupted",
      callId: "call_command_restart_interrupted",
      command: "npm",
      args: ["test"],
      sequence: 9,
      responseId: "resp_continuation_command_loop_8",
    })], {
      parentResponseId: "resp_continuation_command_loop_8",
      parentResponseSource: "native_direct_tool_continuation_stream",
      toolLoopId: test.continuationRequest.toolLoop?.toolLoopId,
      stepOrdinal: 9,
    }).obligations[0];
    await planCommandExecutionObligation({ sessionStore, sessionId: session.sessionId, turnId: turn.turnId, obligationId: interruptedObligation.obligationId, workspaceRequest, projectId: session.projectId });
    approveCommandExecutionObligation({ sessionStore, sessionId: session.sessionId, turnId: turn.turnId, obligationId: interruptedObligation.obligationId, projectId: session.projectId });
    const interruptedApproved = sessionStore.findToolObligation(session.sessionId, turn.turnId, interruptedObligation.obligationId).obligation;
    await sessionStore.claimToolObligation(session.sessionId, turn.turnId, interruptedObligation.obligationId, {
      operationDigest: interruptedApproved.approvedOperationDigest,
      approvedStatus: "command_approved",
      executingStatus: "command_executing",
      ambiguousStatus: "command_execution_ambiguous",
    });
    const restartedStore = new DirectSessionStore({ rootDir: path.join(storeRoot, "sessions") });
    restartedStore.ensure();
    const recoveredInterrupted = restartedStore.findToolObligation(session.sessionId, turn.turnId, interruptedObligation.obligationId).obligation;
    assert(recoveredInterrupted.status === "command_execution_ambiguous" && recoveredInterrupted.result?.error?.code === "execution_interrupted_restart", "restart must reconcile an executing command as ambiguous without replay");

    const finalTurn = sessionStore.readTurn(session.sessionId, turn.turnId);
    assert((finalTurn.toolResults || []).length >= 4, "turn must persist command result evidence");
    assert((finalTurn.continuationRequests || []).length >= 4, "turn must persist command continuation evidence");
    assert(counters.runCommandCalls === 5, "only one concurrent command retry should execute");
    assert(counters.readFileCalls >= 7, "command planning must read package manifest evidence for package-script cases");

    console.log(JSON.stringify({
      schema: "direct_command_tool_loop_regression_report@1",
      status: "passed",
      cases: [
        "safe_read_only_command_completed",
        "failing_command_recorded",
        "mutating_command_workspace_effect_recorded",
        "timeout_command_degraded",
        "denied_executable_blocked_before_approval",
        "denied_package_script_blocked_before_approval",
        "unsafe_cwd_blocked_before_execution",
        "command_continuation_context_built",
        "terminal_command_replay_is_idempotent",
        "concurrent_command_claim_is_single_winner",
        "restart_command_claim_becomes_ambiguous",
      ],
      evidence: {
        toolLoopId: test.continuationRequest.toolLoop?.toolLoopId,
        testCommandPlanId: test.commandPlan.commandPlanId,
        testResultId: test.result.resultId,
        testWorkspaceEffectSummaryId: test.result.workspaceEffectSummaryId,
        failingResultId: failed.result.resultId,
        mutatingResultId: mutated.result.resultId,
        mutatingWorkspaceEffectSummaryId: mutated.result.workspaceEffectSummaryId,
        timeoutResultId: timedOut.result.resultId,
        firstContextBuildId: test.continuationContext.contextPack.contextBuildId,
        firstRequestManifestId: test.continuationContext.requestManifest.requestManifestId,
        rawWorkspacePathExposed: false,
        sideEffectExecuted: true,
        commandExecutionCalls: counters.runCommandCalls,
      },
    }, null, 2));
  } finally {
    if (threadStore) {
      try {
        threadStore.close();
      } catch {}
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
