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
  approveReadOnlyToolObligation,
  buildReadOnlyToolContinuationRequest,
  executeApprovedReadOnlyToolObligation,
  recordReadOnlyToolContinuationRequest,
} = require("../src/main/direct/tools/read-only-authority");
const {
  approvePatchApplyObligation,
  buildPatchApplyContinuationRequest,
  executeApprovedPatchApplyObligation,
  planPatchApplyObligation,
} = require("../src/main/direct/tools/patch-apply-authority");
const {
  approveCommandExecutionObligation,
  buildCommandExecutionContinuationRequest,
  executeApprovedCommandExecutionObligation,
  planCommandExecutionObligation,
} = require("../src/main/direct/tools/command-execution-authority");
const {
  buildRepairLoopForTurn,
  evaluateNextRepairTool,
} = require("../src/main/direct/repair/repair-loop");

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
  writeTextFile(path.join(root, "package.json"), JSON.stringify({
    scripts: {
      test: "node test/check.js",
    },
  }, null, 2));
  writeTextFile(path.join(root, "src", "target.txt"), "state=broken\n");
  writeTextFile(path.join(root, "test", "check.js"), [
    "const fs = require('node:fs');",
    "const value = fs.readFileSync('src/target.txt', 'utf8').trim();",
    "if (value !== 'state=fixed') {",
    "  console.error(`expected state=fixed, got ${value}`);",
    "  process.exit(1);",
    "}",
    "console.log('state ok');",
    "",
  ].join("\n"));
}

function parseFixturePatch(patchText) {
  const lines = String(patchText || "").split(/\r?\n/);
  const oldLine = lines.find((line) => line.startsWith("--- "));
  const newLine = lines.find((line) => line.startsWith("+++ "));
  const removeLine = lines.find((line) => line.startsWith("-") && !line.startsWith("--- "));
  const addLine = lines.find((line) => line.startsWith("+") && !line.startsWith("+++ "));
  if (!oldLine || !newLine || !removeLine || !addLine) {
    const error = new Error("Fixture patch parser only supports one-line update hunks.");
    error.code = "unsupported_fixture_patch";
    throw error;
  }
  const relPath = newLine.slice(4).replace(/^b\//, "");
  return {
    relPath,
    beforeText: `${removeLine.slice(1)}\n`,
    afterText: `${addLine.slice(1)}\n`,
  };
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
    if (method === "applyPatch") {
      if (params.mode === "apply") counters.applyPatchCalls += 1;
      else counters.dryRunCalls += 1;
      const patch = parseFixturePatch(params.patch);
      const { normalized, resolved } = containedPath(root, patch.relPath);
      const beforeText = fs.readFileSync(resolved, "utf8");
      if (beforeText !== patch.beforeText) {
        const error = new Error(`Fixture patch hunk did not match ${normalized}.`);
        error.code = "patch_hunk_context_mismatch";
        throw error;
      }
      if (params.mode === "apply") fs.writeFileSync(resolved, patch.afterText, "utf8");
      return {
        files: [{
          displayPath: normalized,
          operation: "update",
          beforeDigest: sha256(beforeText),
          afterDigest: sha256(patch.afterText),
          beforeExists: true,
          addedLineCount: 1,
          removedLineCount: 1,
          hunkCount: 1,
          previewText: String(params.patch || ""),
          previewTruncated: false,
        }],
        totals: {
          fileCount: 1,
          createCount: 0,
          updateCount: 1,
          deleteCount: 0,
          addedLineCount: 1,
          removedLineCount: 1,
          hunkCount: 1,
        },
        backendCapabilities: {
          canonicalRootSupported: true,
          pathPolicyEnforced: true,
          commandExecutionSupported: true,
        },
        workspaceBindingEvidenceKey: `workspace_${sha256(root).slice(0, 20)}`,
      };
    }
    if (method === "runDirectCommand") {
      counters.runCommandCalls += 1;
      const cwdRelPath = normalizeString(params.cwdRelPath, "");
      const cwd = cwdRelPath ? containedPath(root, cwdRelPath).resolved : root;
      const before = workspaceDigestMap(root);
      const result = await runCommand(params.command, Array.isArray(params.args) ? params.args : [], {
        cwd,
        timeoutMs: Number(params.timeoutMs || 120_000),
      });
      const after = workspaceDigestMap(root);
      return {
        ...result,
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
    }
    const error = new Error(`Unsupported workspace method: ${method}`);
    error.code = "workspace_method_unsupported";
    throw error;
  };
}

function toolEvent({ itemId, callId, name, args, sequence, responseId }) {
  return {
    type: "tool_call_completed",
    sequence,
    itemId,
    callId,
    name,
    toolType: "function_call",
    argumentsJson: JSON.stringify(args),
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
  kind,
  continuationToolNames = [],
}) {
  const turn = sessionStore.readTurn(sessionId, turnId);
  const session = sessionStore.readSession(sessionId);
  threadStore.indexSessionArtifacts(sessionStore, session, [turn]);
  const requestShape = {
    kind,
    stream: true,
    store: false,
    tools: continuationToolNames.length > 0,
    toolCount: continuationToolNames.length,
    declaredToolNames: continuationToolNames,
    toolDeclarations: continuationToolNames.length > 0,
    toolOutputItem: false,
    parallelToolCalls: false,
    hasInstructions: true,
    hasPreviousResponseId: false,
    continuationTransportMode: "fresh_context",
    requestShapeClass: requestShapeEvidenceRef,
    toolLoopId: normalizeString(continuationRequest.toolLoop?.toolLoopId, ""),
    stepId: normalizeString(continuationRequest.toolLoop?.stepId, ""),
    stepOrdinal: Number(continuationRequest.toolLoop?.stepOrdinal || 1),
    resultId: normalizeString(continuationRequest.toolResult?.metadata?.resultId, ""),
  };
  return {
    ...threadStore.buildAndPersistContextForToolContinuation({
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
    }, { sessionStore }),
    requestShape,
  };
}

function recordContinuation({
  sessionStore,
  threadStore,
  projectId,
  sessionId,
  turnId,
  obligationId,
  baseContinuation,
  requestShapeEvidenceRef,
  kind,
  continuationToolNames = [],
}) {
  const continuationContext = buildContinuationContext({
    sessionStore,
    threadStore,
    projectId,
    sessionId,
    turnId,
    obligationId,
    continuationRequest: baseContinuation,
    requestShapeEvidenceRef,
    kind,
    continuationToolNames,
  });
  const continuationRequest = {
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
  sessionStore.updateToolObligation(sessionId, turnId, obligationId, {
    status: "continuation_sent",
    authorityState: "continuation_sent",
    executionAllowed: false,
    continuationAllowed: false,
    continuationRequest: recorded.continuationRequest,
  }, {
    nextTurnState: "continuation_sent",
  });
  return {
    continuationRequest: recorded.continuationRequest,
    continuationContext,
  };
}

async function executeReadStep(input) {
  const { sessionStore, workspaceRequest, sessionId, turnId, obligationId, projectId } = input;
  approveReadOnlyToolObligation({ sessionStore, sessionId, turnId, obligationId, approvedBy: "fixture-operator", projectId });
  const executed = await executeApprovedReadOnlyToolObligation({ sessionStore, sessionId, turnId, obligationId, workspaceRequest, projectId });
  const baseContinuation = buildReadOnlyToolContinuationRequest({
    sessionStore,
    sessionId,
    turnId,
    obligationId,
    continuationLiveSendEnabled: true,
    projectId,
  });
  return {
    tool: "read_file",
    result: executed.result,
    ...recordContinuation({
      ...input,
      baseContinuation,
      requestShapeEvidenceRef: "direct_readonly_tool_continuation@1",
      kind: "read_only_tool_continuation",
      continuationToolNames: ["apply_patch", "run_command"],
    }),
  };
}

async function executePatchStep(input) {
  const { sessionStore, workspaceRequest, sessionId, turnId, obligationId, projectId, requestShapeEvidenceRef } = input;
  const planned = await planPatchApplyObligation({ sessionStore, sessionId, turnId, obligationId, workspaceRequest, projectId });
  approvePatchApplyObligation({ sessionStore, sessionId, turnId, obligationId, approvedBy: "fixture-operator", projectId });
  const executed = await executeApprovedPatchApplyObligation({ sessionStore, sessionId, turnId, obligationId, workspaceRequest, projectId });
  const baseContinuation = buildPatchApplyContinuationRequest({
    sessionStore,
    sessionId,
    turnId,
    obligationId,
    continuationLiveSendEnabled: true,
    projectId,
  });
  return {
    tool: "apply_patch",
    patchPlan: planned.patchPlan,
    result: executed.result,
    ...recordContinuation({
      ...input,
      baseContinuation,
      requestShapeEvidenceRef,
      kind: "patch_apply_continuation",
      continuationToolNames: ["apply_patch", "run_command"],
    }),
  };
}

async function executeCommandStep(input) {
  const { sessionStore, workspaceRequest, sessionId, turnId, obligationId, projectId, requestShapeEvidenceRef, continuationToolNames = [] } = input;
  const planned = await planCommandExecutionObligation({ sessionStore, sessionId, turnId, obligationId, workspaceRequest, projectId });
  approveCommandExecutionObligation({ sessionStore, sessionId, turnId, obligationId, approvedBy: "fixture-operator", projectId });
  const executed = await executeApprovedCommandExecutionObligation({ sessionStore, sessionId, turnId, obligationId, workspaceRequest, projectId });
  const baseContinuation = buildCommandExecutionContinuationRequest({
    sessionStore,
    sessionId,
    turnId,
    obligationId,
    continuationLiveSendEnabled: true,
    projectId,
    allowFurtherToolDeclarations: continuationToolNames.length > 0,
    continuationToolNames,
  });
  return {
    tool: "run_command",
    commandPlan: planned.commandPlan,
    result: executed.result,
    ...recordContinuation({
      ...input,
      baseContinuation,
      requestShapeEvidenceRef,
      kind: "command_execution_continuation",
      continuationToolNames,
    }),
  };
}

function patchText(from, to) {
  return `diff --git a/src/target.txt b/src/target.txt
--- a/src/target.txt
+++ b/src/target.txt
@@ -1 +1 @@
-state=${from}
+state=${to}
`;
}

function addObligation({ sessionStore, sessionId, turnId, toolLoopId, stepOrdinal, responseId, name, args }) {
  const obligations = sessionStore.addToolObligations(sessionId, turnId, [
    toolEvent({
      itemId: `item_step_${stepOrdinal}`,
      callId: `call_step_${stepOrdinal}`,
      name,
      args,
      sequence: stepOrdinal,
      responseId,
    }),
  ], {
    parentResponseId: responseId,
    parentResponseSource: stepOrdinal === 1 ? "native_direct_initial_stream" : "native_direct_tool_continuation_stream",
    toolLoopId,
    stepOrdinal,
  }).obligations;
  assert(obligations.length === 1, `step ${stepOrdinal} must create one ${name} obligation`);
  const evaluation = evaluateNextRepairTool({
    turn: sessionStore.readTurn(sessionId, turnId),
    obligations,
  });
  assert(evaluation.ok === true, `step ${stepOrdinal} must be repair-loop admissible: ${evaluation.blockerCode || evaluation.outcome}`);
  return obligations[0];
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "direct-tool-repair-loop-"));
  const workspaceRoot = path.join(root, "workspace");
  const storeRoot = path.join(root, "store");
  let threadStore = null;
  try {
    createWorkspace(workspaceRoot);
    const counters = { readFileCalls: 0, dryRunCalls: 0, applyPatchCalls: 0, runCommandCalls: 0 };
    const workspaceRequest = workspaceRequestFor(workspaceRoot, counters);
    const sessionStore = new DirectSessionStore({ rootDir: path.join(storeRoot, "sessions") });
    threadStore = new DirectThreadStore({ rootDir: path.join(storeRoot, "threads"), mode: "context_build_required" });
    const session = sessionStore.createSession({
      sessionId: "direct_tool_repair_loop_thread",
      projectId: "direct-tool-repair-loop-fixture",
      title: "Direct repair loop fixture",
      model: "gpt-5.5",
      reasoningEffort: "high",
      runtimeMode: "direct-experimental",
      directTransport: "live-text",
      directTier: "implementation-lane",
      nativeDirectSession: true,
    });
    const turn = sessionStore.createTurn(session.sessionId, {
      turnId: "direct_tool_repair_loop_turn",
      input: [{ role: "user", text: "Fix src/target.txt and run npm test. If tests fail, repair the patch and rerun." }],
      model: "gpt-5.5",
      reasoningEffort: "high",
      requestShape: {
        requestShapeClass: "direct_implementation_tool_initial@1",
        tools: true,
        declaredToolNames: ["read_file", "apply_patch", "run_command"],
        parallelToolCalls: false,
      },
    });
    sessionStore.updateTurnState(session.sessionId, turn.turnId, "streaming", { responseId: "resp_initial_repair_loop" });
    const toolLoopId = `repair_loop_${sha256(`${session.sessionId}:${turn.turnId}`).slice(0, 20)}`;
    const steps = [];

    const readObligation = addObligation({
      sessionStore,
      sessionId: session.sessionId,
      turnId: turn.turnId,
      toolLoopId,
      stepOrdinal: 1,
      responseId: "resp_initial_repair_loop",
      name: "read_file",
      args: { path: "src/target.txt" },
    });
    steps.push(await executeReadStep({
      sessionStore,
      threadStore,
      workspaceRequest,
      projectId: session.projectId,
      sessionId: session.sessionId,
      turnId: turn.turnId,
      obligationId: readObligation.obligationId,
    }));
    sessionStore.updateTurnState(session.sessionId, turn.turnId, "streaming_continuation", {
      responseId: "resp_after_read",
      continuationResponseId: "resp_after_read",
    });

    const badPatchObligation = addObligation({
      sessionStore,
      sessionId: session.sessionId,
      turnId: turn.turnId,
      toolLoopId,
      stepOrdinal: 2,
      responseId: "resp_after_read",
      name: "apply_patch",
      args: { patch: patchText("broken", "almost") },
    });
    steps.push(await executePatchStep({
      sessionStore,
      threadStore,
      workspaceRequest,
      projectId: session.projectId,
      sessionId: session.sessionId,
      turnId: turn.turnId,
      obligationId: badPatchObligation.obligationId,
      requestShapeEvidenceRef: "direct_patch_apply_loop_continuation@1",
    }));
    assert(fs.readFileSync(path.join(workspaceRoot, "src", "target.txt"), "utf8") === "state=almost\n", "bad patch must mutate workspace before failing command");
    sessionStore.updateTurnState(session.sessionId, turn.turnId, "streaming_continuation", {
      responseId: "resp_after_bad_patch",
      continuationResponseId: "resp_after_bad_patch",
    });

    const failingCommandObligation = addObligation({
      sessionStore,
      sessionId: session.sessionId,
      turnId: turn.turnId,
      toolLoopId,
      stepOrdinal: 3,
      responseId: "resp_after_bad_patch",
      name: "run_command",
      args: { command: "npm", args: ["test"], cwd: ".", timeoutMs: 120_000 },
    });
    const failingCommand = await executeCommandStep({
      sessionStore,
      threadStore,
      workspaceRequest,
      projectId: session.projectId,
      sessionId: session.sessionId,
      turnId: turn.turnId,
      obligationId: failingCommandObligation.obligationId,
      requestShapeEvidenceRef: "direct_command_execution_loop_continuation@1",
      continuationToolNames: ["apply_patch", "run_command"],
    });
    steps.push(failingCommand);
    assert(failingCommand.result.exitCode !== 0, "first command must fail to justify repair patch");
    assert(failingCommand.continuationRequest.requestControls.toolDeclarations === true, "failed command continuation must allow bounded repair tools");
    assert(failingCommand.continuationRequest.requestControls.declaredToolNames.includes("apply_patch"), "failed command continuation must expose apply_patch as bounded repair tool");
    sessionStore.updateTurnState(session.sessionId, turn.turnId, "streaming_continuation", {
      responseId: "resp_after_failing_command",
      continuationResponseId: "resp_after_failing_command",
    });

    const repairPatchObligation = addObligation({
      sessionStore,
      sessionId: session.sessionId,
      turnId: turn.turnId,
      toolLoopId,
      stepOrdinal: 4,
      responseId: "resp_after_failing_command",
      name: "apply_patch",
      args: { patch: patchText("almost", "fixed") },
    });
    steps.push(await executePatchStep({
      sessionStore,
      threadStore,
      workspaceRequest,
      projectId: session.projectId,
      sessionId: session.sessionId,
      turnId: turn.turnId,
      obligationId: repairPatchObligation.obligationId,
      requestShapeEvidenceRef: "direct_patch_apply_loop_continuation@1",
    }));
    assert(fs.readFileSync(path.join(workspaceRoot, "src", "target.txt"), "utf8") === "state=fixed\n", "repair patch must correct workspace");
    sessionStore.updateTurnState(session.sessionId, turn.turnId, "streaming_continuation", {
      responseId: "resp_after_repair_patch",
      continuationResponseId: "resp_after_repair_patch",
    });

    const passingCommandObligation = addObligation({
      sessionStore,
      sessionId: session.sessionId,
      turnId: turn.turnId,
      toolLoopId,
      stepOrdinal: 5,
      responseId: "resp_after_repair_patch",
      name: "run_command",
      args: { command: "npm", args: ["test"], cwd: ".", timeoutMs: 120_000 },
    });
    const passingCommand = await executeCommandStep({
      sessionStore,
      threadStore,
      workspaceRequest,
      projectId: session.projectId,
      sessionId: session.sessionId,
      turnId: turn.turnId,
      obligationId: passingCommandObligation.obligationId,
      requestShapeEvidenceRef: "direct_command_execution_loop_continuation@1",
      continuationToolNames: [],
    });
    steps.push(passingCommand);
    assert(passingCommand.result.exitCode === 0, "second command must pass after repair");
    assert(passingCommand.continuationRequest.requestControls.toolDeclarations === false, "passing final command continuation must not expose hidden repair tools");

    sessionStore.appendNormalizedEvent(session.sessionId, turn.turnId, {
      type: "agent_message",
      sequence: 6,
      responseId: "resp_final_repair_loop",
      itemId: "item_final_repair_loop",
      text: "Fixed src/target.txt and verified npm test passes.",
    });
    sessionStore.updateTurnState(session.sessionId, turn.turnId, "completed", {
      responseId: "resp_final_repair_loop",
      responseStatus: 200,
      repairLoop: {
        status: "finalized",
        localWorkflowState: "finalized",
        providerHandoffState: "terminal_completed",
        terminalKind: "finalized",
      },
    });

    const finalTurn = sessionStore.readTurn(session.sessionId, turn.turnId);
    const loop = buildRepairLoopForTurn(finalTurn, {
      status: "finalized",
      localWorkflowState: "finalized",
      providerHandoffState: "terminal_completed",
      terminalKind: "finalized",
    });
    const continuationRequests = Array.isArray(finalTurn.continuationRequests) ? finalTurn.continuationRequests : [];
    assert(continuationRequests.length === 5, "every executed tool result must produce exactly one continuation request");
    assert(new Set(continuationRequests.map((entry) => entry.continuationId)).size === 5, "continuation requests must be unique");
    assert(counters.readFileCalls >= 2, "read and command planning should use workspace reads");
    assert(counters.dryRunCalls === 2, "each patch must be dry-run planned exactly once");
    assert(counters.applyPatchCalls === 2, "each approved patch must execute exactly once");
    assert(counters.runCommandCalls === 2, "each approved command must execute exactly once");
    assert(loop.status === "finalized", "repair loop must be finalized");
    assert(loop.sideEffectState === "workspace_patch_and_command_effects", "repair loop must record patch and command effects");
    assert(loop.counters.patchSteps === 2 && loop.counters.commandSteps === 2, "repair loop counters must reflect two patches and two commands");

    console.log(JSON.stringify({
      schema: "direct_tool_continuation_repair_loop_regression_report@1",
      status: "passed",
      cases: [
        "read_then_patch",
        "patch_then_failing_test_command",
        "failing_test_then_repair_patch",
        "repair_patch_then_passing_test_command",
        "final_assistant_after_evidence_chain",
        "no_hidden_retry_or_auto_approval",
      ],
      evidence: {
        loopId: loop.loopId,
        transitionGraphDigest: loop.policySnapshot.transitionGraphDigest,
        continuationCount: continuationRequests.length,
        resultIds: steps.map((step) => normalizeString(step.result?.resultId, "")),
        counters,
        failedCommandExitCode: failingCommand.result.exitCode,
        finalCommandExitCode: passingCommand.result.exitCode,
        finalState: finalTurn.state,
        terminalKind: loop.terminalKind,
        rawWorkspacePathExposed: false,
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
