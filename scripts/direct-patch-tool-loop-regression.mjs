#!/usr/bin/env node

import { createRequire } from "node:module";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);

const { DirectSessionStore } = require("../src/main/direct/session/session-store");
const { DirectThreadStore } = require("../src/main/direct/thread/thread-store");
const { classifyWorkspacePath } = require("../src/main/direct/workspace/mutation-truth");
const {
  approvePatchApplyObligation,
  buildPatchApplyContinuationRequest,
  executeApprovedPatchApplyObligation,
  planPatchApplyObligation,
} = require("../src/main/direct/tools/patch-apply-authority");
const {
  recordReadOnlyToolContinuationRequest,
} = require("../src/main/direct/tools/read-only-authority");

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

function normalizeRelPath(value) {
  const text = normalizeString(value, "").replace(/\\/g, "/").replace(/^\.\/+/, "");
  if (
    !text ||
    text.startsWith("/") ||
    /^[A-Za-z]:\//.test(text) ||
    text.includes("://") ||
    text.split("/").includes("..") ||
    /[\0-\x1f\x7f]/.test(text)
  ) {
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

function ensureDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
}

function createWorkspace(root) {
  ensureDirectory(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "src", "alpha.txt"), "alpha one\nalpha two\n", "utf8");
}

function normalizeUnifiedHeaderPath(value) {
  const text = String(value || "").trim();
  if (text === "/dev/null") return text;
  if (text.startsWith("a/") || text.startsWith("b/")) return text.slice(2);
  return text;
}

function parseUnifiedFileHeader(oldLine, newLine) {
  const oldPath = normalizeUnifiedHeaderPath(oldLine.slice(4));
  const newPath = normalizeUnifiedHeaderPath(newLine.slice(4));
  if (newPath === "/dev/null") {
    const error = new Error("Patch delete is deferred in v0.");
    error.code = "patch_delete_deferred";
    throw error;
  }
  if (!oldPath || !newPath || oldPath.includes("\t") || newPath.includes("\t")) {
    const error = new Error("Unsupported patch dialect.");
    error.code = "unsupported_patch_dialect";
    throw error;
  }
  return {
    oldPath: oldPath === "/dev/null" ? newPath : oldPath,
    newPath,
    operation: oldPath === "/dev/null" ? "create" : "update",
  };
}

function parseDiffGitHeader(line) {
  const prefix = "diff --git ";
  if (!line.startsWith(prefix)) return null;
  const body = line.slice(prefix.length);
  if (body.startsWith("\"") || body.includes("\"")) return null;
  if (!body.startsWith("a/")) return null;
  const separator = " b/";
  const firstSeparator = body.indexOf(separator);
  if (firstSeparator < 0 || firstSeparator !== body.lastIndexOf(separator)) return null;
  const oldPath = body.slice(2, firstSeparator);
  const newPath = body.slice(firstSeparator + separator.length);
  if (!oldPath || !newPath || oldPath.includes(" b/") || newPath.includes(" b/")) return null;
  return { oldPath, newPath };
}

function parseSimpleUnifiedPatch(patchText) {
  const lines = String(patchText || "").replace(/\r\n/g, "\n").split("\n");
  const files = [];
  let index = 0;
  while (index < lines.length) {
    let parsedHeader = null;
    let operation = "update";
    if (lines[index].startsWith("diff --git ")) {
      parsedHeader = parseDiffGitHeader(lines[index]);
      if (!parsedHeader) {
        const error = new Error("Unsupported patch dialect.");
        error.code = "unsupported_patch_dialect";
        throw error;
      }
      index += 1;
    } else if (lines[index].startsWith("--- ") && lines[index + 1]?.startsWith("+++ ")) {
      parsedHeader = parseUnifiedFileHeader(lines[index], lines[index + 1]);
      operation = parsedHeader.operation;
      index += 2;
    } else {
      index += 1;
      continue;
    }
    const oldPath = normalizeRelPath(parsedHeader.oldPath);
    const newPath = normalizeRelPath(parsedHeader.newPath);
    if (oldPath !== newPath) {
      const error = new Error("Rename/copy patches are unsupported.");
      error.code = "unsupported_patch_dialect";
      throw error;
    }
    const file = { relPath: newPath, operation, hunks: [] };
    while (index < lines.length && !lines[index].startsWith("diff --git ")) {
      const line = lines[index];
      if (line.startsWith("--- ") && lines[index + 1]?.startsWith("+++ ") && file.hunks.length) break;
      if (line.startsWith("deleted file mode") || line === "+++ /dev/null") {
        const error = new Error("Patch delete is deferred in v0.");
        error.code = "patch_delete_deferred";
        throw error;
      }
      if (line.startsWith("new file mode") || line === "--- /dev/null") file.operation = "create";
      if (line.startsWith("rename ") || line.startsWith("copy ") || line.startsWith("Binary files ")) {
        const error = new Error("Unsupported patch dialect.");
        error.code = "unsupported_patch_dialect";
        throw error;
      }
      if (line.startsWith("@@ ")) {
        const hunkHeader = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
        if (!hunkHeader) {
          const error = new Error("Malformed patch hunk range.");
          error.code = "unsupported_patch_dialect";
          throw error;
        }
        const hunkLines = [];
        const oldStart = Number(hunkHeader[1]);
        const newStart = Number(hunkHeader[2]);
        index += 1;
        while (index < lines.length && !lines[index].startsWith("@@ ") && !lines[index].startsWith("diff --git ")) {
          hunkLines.push(lines[index]);
          index += 1;
        }
        file.hunks.push({ oldStart, newStart, lines: hunkLines });
        continue;
      }
      index += 1;
    }
    files.push(file);
  }
  if (!files.some((file) => file.hunks.length)) {
    const error = new Error("Patch contains no supported file hunks.");
    error.code = "unsupported_patch_dialect";
    throw error;
  }
  return files;
}

function applySimplePatchToText(originalText, file) {
  const originalLines = originalText.replace(/\r\n/g, "\n").split("\n");
  if (originalLines.length && originalLines[originalLines.length - 1] === "") originalLines.pop();
  const result = [];
  let cursor = 0;
  let addedLineCount = 0;
  let removedLineCount = 0;
  let noNewlineAtEnd = false;
  for (const hunk of file.hunks) {
    const targetIndex = Math.max(0, Number(hunk.oldStart || 1) - 1);
    if (targetIndex < cursor) {
      const error = new Error("Patch hunks overlap or move backwards.");
      error.code = "patch_context_mismatch";
      throw error;
    }
    if (targetIndex > originalLines.length) {
      const error = new Error("Patch start line exceeds file length.");
      error.code = "patch_context_mismatch";
      throw error;
    }
    while (cursor < targetIndex) {
      result.push(originalLines[cursor]);
      cursor += 1;
    }
    for (const line of hunk.lines) {
      if (!line) continue;
      const marker = line[0];
      const content = line.slice(1);
      if (marker === " ") {
        if (originalLines[cursor] !== content) {
          const error = new Error("Patch context does not match workspace file.");
          error.code = "patch_context_mismatch";
          throw error;
        }
        result.push(originalLines[cursor]);
        cursor += 1;
      } else if (marker === "-") {
        if (originalLines[cursor] !== content) {
          const error = new Error("Patch removal does not match workspace file.");
          error.code = "patch_context_mismatch";
          throw error;
        }
        cursor += 1;
        removedLineCount += 1;
      } else if (marker === "+") {
        result.push(content);
        addedLineCount += 1;
      } else if (line.startsWith("\\ No newline")) {
        noNewlineAtEnd = true;
      } else {
        const error = new Error("Unsupported patch hunk line.");
        error.code = "unsupported_patch_dialect";
        throw error;
      }
    }
  }
  while (cursor < originalLines.length) {
    result.push(originalLines[cursor]);
    cursor += 1;
  }
  return {
    text: `${result.join("\n")}${noNewlineAtEnd ? "" : "\n"}`,
    addedLineCount,
    removedLineCount,
  };
}

function workspaceRequestFor(root, counters) {
  return async function workspaceRequest(method, params = {}) {
    if (method !== "applyPatch") {
      const error = new Error(`Unsupported workspace method: ${method}`);
      error.code = "workspace_method_unsupported";
      throw error;
    }
    if (params.mode === "apply") counters.applyPatchCalls += 1;
    else counters.dryRunCalls += 1;
    const files = parseSimpleUnifiedPatch(params.patch);
    const planned = [];
    for (const file of files) {
      const { normalized, resolved } = containedPath(root, file.relPath);
      const pathPolicy = classifyWorkspacePath(normalized);
      if (pathPolicy.decision === "block") {
        const error = new Error(`Patch target blocked by workspace policy: ${pathPolicy.reasonCode}`);
        error.code = pathPolicy.reasonCode;
        throw error;
      }
      const exists = fs.existsSync(resolved);
      if (file.operation === "update" && !exists) {
        const error = new Error("Patch target is missing.");
        error.code = "patch_target_missing";
        throw error;
      }
      const beforeText = exists ? fs.readFileSync(resolved, "utf8") : "";
      const applied = applySimplePatchToText(file.operation === "create" ? "" : beforeText, file);
      planned.push({
        displayPath: normalized,
        operation: file.operation,
        beforeDigest: exists ? sha256(beforeText) : "",
        afterDigest: sha256(applied.text),
        beforeExists: exists,
        addedLineCount: applied.addedLineCount,
        removedLineCount: applied.removedLineCount,
        hunkCount: file.hunks.length,
        previewText: params.patch.slice(0, 24_000),
        previewTruncated: params.patch.length > 24_000,
        afterText: applied.text,
      });
    }
    const publicFiles = planned.map(({ afterText: _afterText, ...entry }) => entry);
    if (params.mode === "apply") {
      for (const file of planned) {
        const { resolved } = containedPath(root, file.displayPath);
        ensureDirectory(path.dirname(resolved));
        fs.writeFileSync(resolved, file.afterText, "utf8");
      }
    }
    return {
      files: publicFiles,
      totals: {
        fileCount: publicFiles.length,
        createCount: publicFiles.filter((file) => file.operation === "create").length,
        updateCount: publicFiles.filter((file) => file.operation === "update").length,
        deleteCount: 0,
        addedLineCount: publicFiles.reduce((sum, file) => sum + Number(file.addedLineCount || 0), 0),
        removedLineCount: publicFiles.reduce((sum, file) => sum + Number(file.removedLineCount || 0), 0),
        hunkCount: publicFiles.reduce((sum, file) => sum + Number(file.hunkCount || 0), 0),
      },
      backendCapabilities: {
        canonicalRootSupported: true,
        pathPolicyEnforced: true,
        commandExecutionSupported: false,
      },
      workspaceBindingEvidenceKey: `workspace_${sha256(root).slice(0, 20)}`,
    };
  };
}

function patchEvent({ itemId, callId, patch, sequence, responseId }) {
  return {
    type: "tool_call_completed",
    sequence,
    itemId,
    callId,
    name: "apply_patch",
    toolType: "function_call",
    argumentsJson: JSON.stringify({ patch }),
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
  continuationToolNames = [],
}) {
  const declaredToolNames = Array.isArray(continuationToolNames) ? continuationToolNames.filter(Boolean) : [];
  const turn = sessionStore.readTurn(sessionId, turnId);
  const session = sessionStore.readSession(sessionId);
  threadStore.indexSessionArtifacts(sessionStore, session, [turn]);
  const requestShape = {
    kind: "patch_apply_continuation",
    stream: true,
    store: false,
    tools: declaredToolNames.length > 0,
    toolCount: declaredToolNames.length,
    declaredToolNames,
    toolDeclarations: declaredToolNames.length > 0,
    toolOutputItem: false,
    parallelToolCalls: false,
    hasInstructions: true,
    hasPreviousResponseId: false,
    continuationTransportMode: "fresh_context",
    requestShapeClass: requestShapeEvidenceRef,
    toolLoopId: normalizeString(continuationRequest.toolLoop?.toolLoopId, ""),
    stepId: normalizeString(continuationRequest.toolLoop?.stepId, ""),
    stepOrdinal: Number(continuationRequest.toolLoop?.stepOrdinal || 1),
    patchResultId: normalizeString(continuationRequest.toolResult?.metadata?.resultId, ""),
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

async function executePatchStep({
  sessionStore,
  threadStore,
  workspaceRequest,
  projectId,
  sessionId,
  turnId,
  obligationId,
  requestShapeEvidenceRef,
  continuationToolNames = [],
}) {
  const planned = await planPatchApplyObligation({
    sessionStore,
    sessionId,
    turnId,
    obligationId,
    workspaceRequest,
    projectId,
  });
  approvePatchApplyObligation({
    sessionStore,
    sessionId,
    turnId,
    obligationId,
    approvedBy: "fixture-operator",
    projectId,
  });
  const executed = await executeApprovedPatchApplyObligation({
    sessionStore,
    sessionId,
    turnId,
    obligationId,
    workspaceRequest,
    projectId,
  });
  const baseContinuation = buildPatchApplyContinuationRequest({
    sessionStore,
    sessionId,
    turnId,
    obligationId,
    continuationLiveSendEnabled: true,
    projectId,
  });
  const continuationContext = buildContinuationContext({
    sessionStore,
    threadStore,
    projectId,
    sessionId,
    turnId,
    obligationId,
    continuationRequest: baseContinuation,
    requestShapeEvidenceRef,
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
    patchPlan: planned.patchPlan,
    result: executed.result,
    continuationRequest: recorded.continuationRequest,
    continuationContext,
  };
}

function readText(root, relPath) {
  return fs.readFileSync(path.join(root, relPath), "utf8");
}

const EDIT_PATCH = `diff --git a/src/alpha.txt b/src/alpha.txt
--- a/src/alpha.txt
+++ b/src/alpha.txt
@@ -1,2 +1,2 @@
 alpha one
-alpha two
+alpha patched
`;

const CREATE_PATCH = `diff --git a/src/new.txt b/src/new.txt
--- /dev/null
+++ b/src/new.txt
@@ -0,0 +1,2 @@
+new one
+new two
`;

const OUTSIDE_PATCH = `diff --git a/../outside.txt b/../outside.txt
--- a/../outside.txt
+++ b/../outside.txt
@@ -1,1 +1,1 @@
-outside
+blocked
`;

const FAILED_PATCH = `diff --git a/src/alpha.txt b/src/alpha.txt
--- a/src/alpha.txt
+++ b/src/alpha.txt
@@ -1,2 +1,2 @@
 alpha one
-not present
+should fail
`;

const FAR_HUNK_PATCH = `diff --git a/src/alpha.txt b/src/alpha.txt
--- a/src/alpha.txt
+++ b/src/alpha.txt
@@ -99,1 +99,1 @@
-missing
+still missing
`;

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "direct-patch-tool-loop-"));
  const workspaceRoot = path.join(root, "workspace");
  const storeRoot = path.join(root, "store");
  let threadStore = null;
  try {
    createWorkspace(workspaceRoot);
    const counters = { dryRunCalls: 0, applyPatchCalls: 0, runCommandCalls: 0 };
    const workspaceRequest = workspaceRequestFor(workspaceRoot, counters);
    const sessionStore = new DirectSessionStore({ rootDir: path.join(storeRoot, "sessions") });
    threadStore = new DirectThreadStore({ rootDir: path.join(storeRoot, "threads"), mode: "context_build_required" });
    const session = sessionStore.createSession({
      sessionId: "direct_patch_loop_thread",
      projectId: "direct-patch-loop-fixture",
      title: "Direct patch loop fixture",
      model: "gpt-5.5",
      runtimeMode: "direct-experimental",
      directTransport: "live-text",
      directTier: "implementation-lane",
      nativeDirectSession: true,
    });
    const turn = sessionStore.createTurn(session.sessionId, {
      turnId: "direct_patch_loop_turn",
      input: [{ role: "user", text: "Patch alpha, then create a new file." }],
      model: "gpt-5.5",
      requestShape: {
        requestShapeClass: "direct_implementation_tool_initial@1",
        tools: true,
        declaredToolNames: ["apply_patch"],
        parallelToolCalls: false,
      },
    });
    sessionStore.updateTurnState(session.sessionId, turn.turnId, "streaming", {
      responseId: "resp_initial_patch_loop",
    });

    const editObligations = sessionStore.addToolObligations(session.sessionId, turn.turnId, [
      patchEvent({
        itemId: "item_patch_alpha",
        callId: "call_patch_alpha",
        patch: EDIT_PATCH,
        sequence: 1,
        responseId: "resp_initial_patch_loop",
      }),
    ], {
      parentResponseId: "resp_initial_patch_loop",
      parentResponseSource: "native_direct_initial_stream",
      stepOrdinal: 1,
    }).obligations;
    assert(editObligations.length === 1, "edit patch obligation must be detected");
    const edit = await executePatchStep({
      sessionStore,
      threadStore,
      workspaceRequest,
      projectId: session.projectId,
      sessionId: session.sessionId,
      turnId: turn.turnId,
      obligationId: editObligations[0].obligationId,
      requestShapeEvidenceRef: "direct_patch_apply_continuation@1",
      continuationToolNames: ["apply_patch"],
    });
    assert(readText(workspaceRoot, "src/alpha.txt") === "alpha one\nalpha patched\n", "edit patch must mutate alpha exactly");
    assert(edit.patchPlan.authorityTransition?.sideEffectExecuted === false, "patch plan must be side-effect false");
    assert(edit.result.sideEffectExecuted === true, "patch result must mark side effect executed");
    assert(edit.result.authorityTransition?.sideEffectExecuted === true, "patch result transition must mark side effect executed");
    assert(edit.result.workspaceEffectSummary?.expectedChangeCount === 1, "edit patch must record one expected change");
    assert(edit.result.workspaceEffectSummary?.unexpectedChangeCount === 0, "edit patch must not record unexpected changes");
    assert(edit.result.patchJournalInspection?.journalState === "applied_verified", "edit patch journal must be applied_verified");
    assert(edit.continuationRequest.safety?.sideEffectExecuted === true, "patch continuation must preserve side-effect truth");
    assert(edit.continuationContext.contextPack.policy?.policyId === "direct_patch_apply_continuation@1", "patch continuation context must use patch policy");
    assert(edit.continuationContext.requestManifest.requestShapeClass === "direct_patch_apply_continuation@1", "patch request manifest class mismatch");
    assert(edit.continuationContext.requestShape.tools === true, "patch continuation shape must declare tools when another patch step is allowed");
    assert(edit.continuationContext.requestShape.toolDeclarations === true, "patch continuation shape must record tool declarations");
    assert(edit.continuationContext.requestShape.declaredToolNames?.includes("apply_patch"), "patch continuation shape must include apply_patch");

    sessionStore.updateTurnState(session.sessionId, turn.turnId, "streaming_continuation", {
      responseId: "resp_continuation_patch_loop_1",
      continuationResponseId: "resp_continuation_patch_loop_1",
    });
    const createObligations = sessionStore.addToolObligations(session.sessionId, turn.turnId, [
      patchEvent({
        itemId: "item_patch_create",
        callId: "call_patch_create",
        patch: CREATE_PATCH,
        sequence: 2,
        responseId: "resp_continuation_patch_loop_1",
      }),
    ], {
      parentResponseId: "resp_continuation_patch_loop_1",
      parentResponseSource: "native_direct_tool_continuation_stream",
      toolLoopId: edit.continuationRequest.toolLoop?.toolLoopId,
      stepOrdinal: 2,
    }).obligations;
    assert(createObligations.length === 1, "create patch obligation must be detected");
    const created = await executePatchStep({
      sessionStore,
      threadStore,
      workspaceRequest,
      projectId: session.projectId,
      sessionId: session.sessionId,
      turnId: turn.turnId,
      obligationId: createObligations[0].obligationId,
      requestShapeEvidenceRef: "direct_patch_apply_loop_continuation@1",
      continuationToolNames: ["apply_patch"],
    });
    assert(readText(workspaceRoot, "src/new.txt") === "new one\nnew two\n", "create patch must write new file exactly");
    assert(
      created.result.workspaceEffectSummary?.changedPathsPreview?.some((entry) =>
        entry.relPath === "src/new.txt" && entry.changeKind === "created"
      ),
      "create patch must record one created file",
    );
    assert(created.continuationRequest.toolLoop?.stepOrdinal === 2, "create continuation must carry step ordinal 2");
    assert(created.continuationRequest.toolLoop?.toolLoopId === edit.continuationRequest.toolLoop?.toolLoopId, "patch steps must share tool loop id");

    const outsideObligations = sessionStore.addToolObligations(session.sessionId, turn.turnId, [
      patchEvent({
        itemId: "item_patch_outside",
        callId: "call_patch_outside",
        patch: OUTSIDE_PATCH,
        sequence: 3,
        responseId: "resp_continuation_patch_loop_2",
      }),
    ], {
      parentResponseId: "resp_continuation_patch_loop_2",
      parentResponseSource: "native_direct_tool_continuation_stream",
      toolLoopId: edit.continuationRequest.toolLoop?.toolLoopId,
      stepOrdinal: 3,
    }).obligations;
    let outsideBlocked = false;
    try {
      await planPatchApplyObligation({
        sessionStore,
        sessionId: session.sessionId,
        turnId: turn.turnId,
        obligationId: outsideObligations[0].obligationId,
        workspaceRequest,
        projectId: session.projectId,
      });
    } catch (error) {
      outsideBlocked = ["unsafe_workspace_path", "workspace_path_escape", "path_outside_workspace"].includes(error?.code);
    }
    assert(outsideBlocked, "outside-workspace patch must be blocked before approval/apply");

    const failedObligations = sessionStore.addToolObligations(session.sessionId, turn.turnId, [
      patchEvent({
        itemId: "item_patch_failed",
        callId: "call_patch_failed",
        patch: FAILED_PATCH,
        sequence: 4,
        responseId: "resp_continuation_patch_loop_3",
      }),
    ], {
      parentResponseId: "resp_continuation_patch_loop_3",
      parentResponseSource: "native_direct_tool_continuation_stream",
      toolLoopId: edit.continuationRequest.toolLoop?.toolLoopId,
      stepOrdinal: 4,
    }).obligations;
    let failedBlocked = false;
    try {
      await planPatchApplyObligation({
        sessionStore,
        sessionId: session.sessionId,
        turnId: turn.turnId,
        obligationId: failedObligations[0].obligationId,
        workspaceRequest,
        projectId: session.projectId,
      });
    } catch (error) {
      failedBlocked = error?.code === "patch_context_mismatch";
    }
    assert(failedBlocked, "patch with mismatched context must fail before approval/apply");

    const farHunkObligations = sessionStore.addToolObligations(session.sessionId, turn.turnId, [
      patchEvent({
        itemId: "item_patch_far_hunk",
        callId: "call_patch_far_hunk",
        patch: FAR_HUNK_PATCH,
        sequence: 5,
        responseId: "resp_continuation_patch_loop_4",
      }),
    ], {
      parentResponseId: "resp_continuation_patch_loop_4",
      parentResponseSource: "native_direct_tool_continuation_stream",
      toolLoopId: edit.continuationRequest.toolLoop?.toolLoopId,
      stepOrdinal: 5,
    }).obligations;
    let farHunkBlocked = false;
    try {
      await planPatchApplyObligation({
        sessionStore,
        sessionId: session.sessionId,
        turnId: turn.turnId,
        obligationId: farHunkObligations[0].obligationId,
        workspaceRequest,
        projectId: session.projectId,
      });
    } catch (error) {
      farHunkBlocked = error?.code === "patch_context_mismatch";
    }
    assert(farHunkBlocked, "patch with hunk start beyond file length must fail before approval/apply");

    const finalTurn = sessionStore.readTurn(session.sessionId, turn.turnId);
    assert((finalTurn.toolResults || []).length >= 2, "turn must persist patch result evidence");
    assert((finalTurn.continuationRequests || []).length >= 2, "turn must persist patch continuation evidence");
    assert(counters.dryRunCalls === 5, "each patch proposal should dry-run exactly once");
    assert(counters.applyPatchCalls === 2, "only approved valid patches should apply");
    assert(counters.runCommandCalls === 0, "patch loop regression must not execute commands");

    console.log(JSON.stringify({
      schema: "direct_patch_tool_loop_regression_report@1",
      status: "passed",
      cases: [
        "simple_edit_patch_applied",
        "create_file_patch_applied",
        "outside_workspace_patch_blocked_before_approval",
        "failed_patch_blocked_before_approval",
        "out_of_bounds_hunk_blocked_before_approval",
        "workspace_effect_summary_rendered",
        "patch_continuation_context_built",
        "no_command_execution",
      ],
      evidence: {
        toolLoopId: edit.continuationRequest.toolLoop?.toolLoopId,
        editPatchPlanId: edit.patchPlan.patchPlanId,
        editResultId: edit.result.resultId,
        editWorkspaceEffectSummaryId: edit.result.workspaceEffectSummaryId,
        editPatchJournalInspectionId: edit.result.patchJournalInspectionId,
        createResultId: created.result.resultId,
        createWorkspaceEffectSummaryId: created.result.workspaceEffectSummaryId,
        firstContextBuildId: edit.continuationContext.contextPack.contextBuildId,
        secondContextBuildId: created.continuationContext.contextPack.contextBuildId,
        firstRequestManifestId: edit.continuationContext.requestManifest.requestManifestId,
        secondRequestManifestId: created.continuationContext.requestManifest.requestManifestId,
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
