#!/usr/bin/env node

import { createRequire } from "node:module";
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

function digestTree(root) {
  const entries = [];
  function walk(directory, prefix = "") {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(target, relPath);
        continue;
      }
      if (!entry.isFile()) continue;
      entries.push({
        relPath,
        digest: sha256(fs.readFileSync(target)),
      });
    }
  }
  walk(root);
  return sha256(stableJson(entries));
}

function containedPath(root, relPath) {
  const normalized = normalizeString(relPath, "").replace(/\\/g, "/");
  if (!normalized || normalized.startsWith("/") || normalized.split("/").includes("..")) {
    const error = new Error("Path is outside the disposable workspace.");
    error.code = "workspace_path_outside_root";
    throw error;
  }
  const resolved = path.resolve(root, normalized);
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    const error = new Error("Path is outside the disposable workspace.");
    error.code = "workspace_path_outside_root";
    throw error;
  }
  return { normalized, resolved };
}

function createWorkspace(root) {
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "alpha.txt"), "alpha one\nalpha two\n", "utf8");
  fs.writeFileSync(path.join(root, "src", "beta.txt"), "beta one\nbeta two\n", "utf8");
}

function workspaceRequestFor(root, counters) {
  return async function workspaceRequest(method, params = {}) {
    if (method !== "readFile") {
      const error = new Error(`Unsupported workspace method: ${method}`);
      error.code = "workspace_method_unsupported";
      throw error;
    }
    counters.readFileCalls += 1;
    const { normalized, resolved } = containedPath(root, params.relPath);
    const stat = fs.statSync(resolved);
    const maxBytes = Math.max(1, Number(params.maxBytes || 384 * 1024));
    const bytes = fs.readFileSync(resolved);
    const truncated = bytes.length > maxBytes;
    return {
      relPath: normalized,
      text: bytes.subarray(0, maxBytes).toString("utf8"),
      size: stat.size,
      truncated,
      binary: false,
      source: "fixture_workspace_backend",
    };
  };
}

function toolEvent({ itemId, callId, path: relPath, sequence, responseId }) {
  return {
    type: "tool_call_completed",
    sequence,
    itemId,
    callId,
    name: "read_file",
    toolType: "function_call",
    argumentsJson: JSON.stringify({ path: relPath }),
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
    kind: "read_only_tool_continuation",
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
  };
  return threadStore.buildAndPersistContextForToolContinuation({
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
}

async function executeStep({
  sessionStore,
  threadStore,
  workspaceRequest,
  projectId,
  sessionId,
  turnId,
  obligationId,
  requestShapeEvidenceRef,
}) {
  approveReadOnlyToolObligation({
    sessionStore,
    sessionId,
    turnId,
    obligationId,
    approvedBy: "fixture-operator",
    projectId,
  });
  const executed = await executeApprovedReadOnlyToolObligation({
    sessionStore,
    sessionId,
    turnId,
    obligationId,
    workspaceRequest,
    projectId,
  });
  const baseContinuation = buildReadOnlyToolContinuationRequest({
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
    result: executed.result,
    continuationRequest: recorded.continuationRequest,
    continuationContext,
  };
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "direct-read-tool-loop-"));
  const workspaceRoot = path.join(root, "workspace");
  const storeRoot = path.join(root, "store");
  let threadStore = null;
  try {
    createWorkspace(workspaceRoot);
    const beforeDigest = digestTree(workspaceRoot);
    const counters = { readFileCalls: 0 };
    const workspaceRequest = workspaceRequestFor(workspaceRoot, counters);
    const sessionStore = new DirectSessionStore({ rootDir: path.join(storeRoot, "sessions") });
    threadStore = new DirectThreadStore({ rootDir: path.join(storeRoot, "threads"), mode: "context_build_required" });
    const session = sessionStore.createSession({
      sessionId: "direct_read_loop_thread",
      projectId: "direct-read-loop-fixture",
      title: "Direct read loop fixture",
      model: "gpt-5.5",
      runtimeMode: "direct-experimental",
      directTransport: "live-text",
      directTier: "implementation-lane",
      nativeDirectSession: true,
    });
    const turn = sessionStore.createTurn(session.sessionId, {
      turnId: "direct_read_loop_turn",
      input: [{ role: "user", text: "Read alpha, then beta." }],
      model: "gpt-5.5",
      requestShape: {
        requestShapeClass: "direct_implementation_tool_initial@1",
        tools: true,
        declaredToolNames: ["read_file"],
        parallelToolCalls: false,
      },
    });
    sessionStore.updateTurnState(session.sessionId, turn.turnId, "streaming", {
      responseId: "resp_initial_read_loop",
    });
    const firstObligations = sessionStore.addToolObligations(session.sessionId, turn.turnId, [
      toolEvent({
        itemId: "item_read_alpha",
        callId: "call_read_alpha",
        path: "src/alpha.txt",
        sequence: 1,
        responseId: "resp_initial_read_loop",
      }),
    ], {
      parentResponseId: "resp_initial_read_loop",
      parentResponseSource: "native_direct_initial_stream",
      stepOrdinal: 1,
    }).obligations;
    assert(firstObligations.length === 1, "first read obligation must be detected");
    const first = await executeStep({
      sessionStore,
      threadStore,
      workspaceRequest,
      projectId: session.projectId,
      sessionId: session.sessionId,
      turnId: turn.turnId,
      obligationId: firstObligations[0].obligationId,
      requestShapeEvidenceRef: "direct_readonly_tool_continuation@1",
    });
    assert(first.result.sideEffectExecuted === false, "read result must not execute side effects");
    assert(first.result.authorityTransition?.sideEffectExecuted === false, "read authority transition must be side-effect false");
    assert(first.continuationRequest.safety?.sideEffectExecuted === false, "continuation request must remain side-effect false");
    assert(first.continuationRequest.safety?.workspaceBackendOnly === true, "continuation must cite workspace backend-only posture");
    assert(first.continuationContext.contextPack.schema === "direct_context_pack@1", "first continuation context pack missing");
    assert(first.continuationContext.requestManifest.schema === "direct_request_manifest@1", "first continuation request manifest missing");

    sessionStore.updateTurnState(session.sessionId, turn.turnId, "streaming_continuation", {
      responseId: "resp_continuation_read_loop_1",
      continuationResponseId: "resp_continuation_read_loop_1",
    });
    const secondObligations = sessionStore.addToolObligations(session.sessionId, turn.turnId, [
      toolEvent({
        itemId: "item_read_beta",
        callId: "call_read_beta",
        path: "src/beta.txt",
        sequence: 2,
        responseId: "resp_continuation_read_loop_1",
      }),
    ], {
      parentResponseId: "resp_continuation_read_loop_1",
      parentResponseSource: "native_direct_tool_continuation_stream",
      toolLoopId: first.continuationRequest.toolLoop.toolLoopId,
      stepOrdinal: 2,
    }).obligations;
    assert(secondObligations.length === 1, "second read obligation must be detected");
    const second = await executeStep({
      sessionStore,
      threadStore,
      workspaceRequest,
      projectId: session.projectId,
      sessionId: session.sessionId,
      turnId: turn.turnId,
      obligationId: secondObligations[0].obligationId,
      requestShapeEvidenceRef: "direct_readonly_tool_loop_continuation@1",
    });
    assert(second.continuationRequest.toolLoop.stepOrdinal === 2, "second continuation must carry step ordinal 2");
    assert(second.continuationRequest.toolLoop.toolLoopId === first.continuationRequest.toolLoop.toolLoopId, "steps must share a tool loop id");
    assert(second.continuationContext.requestManifest.requestShapeClass === "direct_readonly_tool_loop_continuation@1", "second request manifest must classify loop continuation");

    const missingObligations = sessionStore.addToolObligations(session.sessionId, turn.turnId, [
      toolEvent({
        itemId: "item_read_missing",
        callId: "call_read_missing",
        path: "src/missing.txt",
        sequence: 3,
        responseId: "resp_continuation_read_loop_2",
      }),
    ], {
      parentResponseId: "resp_continuation_read_loop_2",
      parentResponseSource: "native_direct_tool_continuation_stream",
      toolLoopId: first.continuationRequest.toolLoop.toolLoopId,
      stepOrdinal: 3,
    }).obligations;
    approveReadOnlyToolObligation({
      sessionStore,
      sessionId: session.sessionId,
      turnId: turn.turnId,
      obligationId: missingObligations[0].obligationId,
      approvedBy: "fixture-operator",
      projectId: session.projectId,
    });
    let missingBlocked = false;
    try {
      await executeApprovedReadOnlyToolObligation({
        sessionStore,
        sessionId: session.sessionId,
        turnId: turn.turnId,
        obligationId: missingObligations[0].obligationId,
        workspaceRequest,
        projectId: session.projectId,
      });
    } catch (error) {
      missingBlocked = error?.code === "ENOENT" || /no such file/i.test(error?.message || "");
    }
    assert(missingBlocked, "missing file read must fail before provider continuation");

    const outsideObligations = sessionStore.addToolObligations(session.sessionId, turn.turnId, [
      toolEvent({
        itemId: "item_read_outside",
        callId: "call_read_outside",
        path: "../outside.txt",
        sequence: 4,
        responseId: "resp_continuation_read_loop_3",
      }),
    ], {
      parentResponseId: "resp_continuation_read_loop_3",
      parentResponseSource: "native_direct_tool_continuation_stream",
      toolLoopId: first.continuationRequest.toolLoop.toolLoopId,
      stepOrdinal: 4,
    }).obligations;
    let outsideBlocked = false;
    try {
      approveReadOnlyToolObligation({
        sessionStore,
        sessionId: session.sessionId,
        turnId: turn.turnId,
        obligationId: outsideObligations[0].obligationId,
        approvedBy: "fixture-operator",
        projectId: session.projectId,
      });
    } catch (error) {
      outsideBlocked = error?.code === "invalid_read_file_path";
    }
    assert(outsideBlocked, "outside-workspace path must be blocked before execution");

    const afterDigest = digestTree(workspaceRoot);
    assert(afterDigest === beforeDigest, "read-only loop must not mutate the disposable workspace");
    const finalTurn = sessionStore.readTurn(session.sessionId, turn.turnId);
    assert((finalTurn.toolResults || []).length >= 2, "turn must persist read result evidence");
    assert((finalTurn.continuationRequests || []).length >= 2, "turn must persist continuation request evidence");
    assert(counters.readFileCalls === 3, "only approved read attempts should reach workspace backend");

    console.log(JSON.stringify({
      schema: "direct_read_tool_loop_regression_report@1",
      status: "passed",
      cases: [
        "read_one_file",
        "read_second_loop_step",
        "missing_file_blocked_before_continuation",
        "outside_workspace_blocked_before_execution",
        "workspace_not_mutated",
      ],
      evidence: {
        toolLoopId: first.continuationRequest.toolLoop.toolLoopId,
        firstResultId: first.result.resultId,
        secondResultId: second.result.resultId,
        firstContextBuildId: first.continuationContext.contextPack.contextBuildId,
        secondContextBuildId: second.continuationContext.contextPack.contextBuildId,
        firstRequestManifestId: first.continuationContext.requestManifest.requestManifestId,
        secondRequestManifestId: second.continuationContext.requestManifest.requestManifestId,
        rawWorkspacePathExposed: false,
        sideEffectExecuted: false,
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
