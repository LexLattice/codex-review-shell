"use strict";

const crypto = require("node:crypto");

const DIRECT_READONLY_TOOL_AUTHORITY_DECISION_SCHEMA = "direct_codex_readonly_tool_authority_decision@1";
const DIRECT_READONLY_TOOL_CONTINUATION_REQUEST_SCHEMA = "direct_codex_readonly_tool_continuation_request@1";
const DIRECT_READONLY_TOOL_RESULT_SCHEMA = "direct_codex_readonly_tool_result@1";
const READ_FILE_TOOL_NAMES = new Set(["read_file", "readFile"]);
const MAX_READ_FILE_BYTES = 384 * 1024;
const MAX_PROVIDER_OUTPUT_CHARS = 64 * 1024;
const MAX_APPROVAL_PREVIEW_CHARS = 4 * 1024;
const SUPPORTED_READONLY_CONTINUATION_KINDS = new Map([
  ["function_call", "function_call_output"],
  ["custom_tool_call", "custom_tool_call_output"],
]);
const READONLY_TERMINAL_STATUSES = new Set([
  "approved",
  "declined",
  "canceled",
  "result_recorded",
  "continuation_built",
  "continuation_sent",
]);
const SENSITIVE_READ_FILE_PATTERNS = [
  /(?:^|\/)\.env(?:\.|$)/i,
  /(?:^|\/)[^/]+\.pem$/i,
  /(?:^|\/)[^/]+\.key$/i,
  /(?:^|\/)[^/]+\.p12$/i,
  /(?:^|\/)[^/]+\.pfx$/i,
  /(?:^|\/)id_rsa$/i,
  /(?:^|\/)id_ed25519$/i,
  /(?:^|\/)secrets(?:\/|$)/i,
  /(?:^|\/)\.ssh(?:\/|$)/i,
  /(?:^|\/)\.git\/config$/i,
];

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function exactString(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function boundedText(value, maxChars) {
  const text = typeof value === "string" ? value : "";
  return text.length > maxChars ? text.slice(0, maxChars) : text;
}

function nowIso(nowMs = Date.now()) {
  return new Date(Number(nowMs) || Date.now()).toISOString();
}

function resultIdForObligation(obligationId) {
  const digest = crypto.createHash("sha256").update(normalizeString(obligationId, "")).digest("hex").slice(0, 20);
  return `tool_result_${digest}`;
}

function continuationIdForResult(obligationId, resultId) {
  const digest = crypto
    .createHash("sha256")
    .update(`${normalizeString(obligationId, "")}:${normalizeString(resultId, "")}`)
    .digest("hex")
    .slice(0, 20);
  return `tool_continuation_${digest}`;
}

function parseArgumentsJson(obligation = {}) {
  const text = normalizeString(obligation.argumentsText, "");
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    return isPlainObject(parsed) ? parsed : {};
  } catch (error) {
    const parseError = new Error(`Tool obligation arguments are not valid JSON: ${error.message}`);
    parseError.code = "invalid_tool_arguments";
    throw parseError;
  }
}

function normalizeRelativePath(value) {
  const original = normalizeString(value, "");
  const text = original.replace(/\\/g, "/");
  if (
    !text ||
    /[\0-\x1f\x7f]/.test(text) ||
    text.startsWith("/") ||
    /^[A-Za-z]:\//.test(text) ||
    text.includes("://") ||
    text.split("/").includes("..")
  ) {
    const error = new Error("read_file tool requires a relative workspace path.");
    error.code = "invalid_read_file_path";
    throw error;
  }
  try {
    const decoded = decodeURIComponent(text);
    if (decoded !== text && (decoded.includes("/") || decoded.includes("\\") || decoded.split(/[\\/]/).includes(".."))) {
      const error = new Error("read_file tool path contains encoded traversal.");
      error.code = "invalid_read_file_path";
      throw error;
    }
  } catch {
    const error = new Error("read_file tool path contains malformed encoding.");
    error.code = "invalid_read_file_path";
    throw error;
  }
  return text.replace(/^\.\/+/, "");
}

function sensitiveReadFileReason(relPath) {
  const normalized = normalizeRelativePath(relPath);
  return SENSITIVE_READ_FILE_PATTERNS.some((pattern) => pattern.test(normalized)) ? "sensitive_path" : "";
}

function assertReadFileToolName(obligation = {}) {
  if (!READ_FILE_TOOL_NAMES.has(normalizeString(obligation.name, ""))) {
    const error = new Error(`Unsupported direct read-only tool: ${obligation.name || "unknown"}`);
    error.code = "unsupported_readonly_tool";
    throw error;
  }
}

function assertToolCallCompleted(obligation = {}) {
  const status = normalizeString(obligation.status, "");
  const hasCompletedSequence = obligation.completedAtSequence !== null && obligation.completedAtSequence !== undefined;
  if (status === "collecting_arguments" || !hasCompletedSequence) {
    const error = new Error("Read-only approval requires a completed provider tool call with parseable arguments.");
    error.code = "tool_call_arguments_incomplete";
    throw error;
  }
}

function supportedContinuationOutputType(obligation = {}) {
  const providerCallType = normalizeString(obligation.providerCallType || obligation.toolType, "");
  const outputType = SUPPORTED_READONLY_CONTINUATION_KINDS.get(providerCallType);
  if (!outputType) {
    const error = new Error(`Unsupported read-only continuation call type: ${providerCallType || "unknown"}`);
    error.code = "unsupported_tool_call_type";
    throw error;
  }
  return { providerCallType, outputType };
}

function assertAcceptedNamespace(obligation = {}) {
  const namespace = normalizeString(obligation.namespace, "");
  if (!namespace) return "";
  const error = new Error(`Unsupported read-only tool namespace: ${namespace}`);
  error.code = "unsupported_tool_namespace";
  throw error;
}

function assertToolCallId(obligation = {}) {
  const callId = normalizeString(obligation.callId, "");
  if (callId) return callId;
  const error = new Error("Read-only continuation requires the original provider call_id.");
  error.code = "missing_tool_call_id";
  throw error;
}

function assertReadFileObligation(obligation = {}) {
  assertToolCallCompleted(obligation);
  assertReadFileToolName(obligation);
  assertAcceptedNamespace(obligation);
  const continuationKind = supportedContinuationOutputType(obligation);
  const callId = assertToolCallId(obligation);
  const args = parseArgumentsJson(obligation);
  const relPath = normalizeRelativePath(args.path || args.relPath || args.relativePath);
  const sensitiveReason = sensitiveReadFileReason(relPath);
  if (sensitiveReason) {
    const error = new Error("read_file requested a sensitive path that is denied by default.");
    error.code = "sensitive_read_file_path";
    error.sensitiveReason = sensitiveReason;
    throw error;
  }
  return {
    relPath,
    callId,
    providerCallType: continuationKind.providerCallType,
    outputType: continuationKind.outputType,
  };
}

function projectReadResult(raw = {}, obligation = {}, approvedAt = "", nowMs) {
  const result = isPlainObject(raw) ? raw : {};
  const text = exactString(result.text, "");
  const binary = Boolean(result.binary);
  const truncated = Boolean(result.truncated) || text.length > MAX_PROVIDER_OUTPUT_CHARS;
  const textPreview = binary ? "" : boundedText(text, MAX_APPROVAL_PREVIEW_CHARS);
  const providerTextPreview = binary ? "" : boundedText(text, MAX_PROVIDER_OUTPUT_CHARS);
  const resultClass = binary
    ? "binary_summary"
    : (truncated ? "text_preview_truncated" : "text_preview_untruncated");
  const providerEnvelope = {
    path: normalizeString(result.relPath, ""),
    textPreview: providerTextPreview,
    truncated,
    bytesRead: Number(result.size || 0),
    binary,
    resultClass,
    note: truncated
      ? "File content was truncated by the local shell before provider continuation."
      : "",
  };
  const providerOutputText = JSON.stringify(providerEnvelope);
  return {
    schema: DIRECT_READONLY_TOOL_RESULT_SCHEMA,
    resultId: resultIdForObligation(obligation.obligationId),
    obligationId: obligation.obligationId,
    tool: normalizeString(obligation.name, "read_file"),
    status: "completed",
    relPath: normalizeString(result.relPath, ""),
    size: Number(result.size || 0),
    truncated,
    binary,
    resultClass,
    textPreview,
    providerOutputText,
    providerOutputChars: providerOutputText.length,
    approvalPreviewChars: textPreview.length,
    summary: `${normalizeString(result.relPath, "file")} · ${Number(result.size || 0)} bytes${truncated ? " · truncated" : ""}`,
    source: normalizeString(result.source, ""),
    approvedAt,
    recordedAt: nowIso(nowMs),
    sideEffectExecuted: false,
    rawWorkspacePathExposed: false,
  };
}

function assertRecordedReadOnlyResult(obligation = {}) {
  if (!["result_recorded", "continuation_built", "continuation_sent"].includes(normalizeString(obligation.status, ""))) {
    const error = new Error("Read-only tool continuation requires a recorded tool result.");
    error.code = "tool_result_not_recorded";
    throw error;
  }
  if (!isPlainObject(obligation.result)) {
    const error = new Error("Read-only tool continuation requires stored tool evidence.");
    error.code = "tool_result_missing";
    throw error;
  }
  if (obligation.result.schema !== DIRECT_READONLY_TOOL_RESULT_SCHEMA) {
    const error = new Error("Read-only tool continuation requires a direct read-only result record.");
    error.code = "invalid_tool_result_schema";
    throw error;
  }
  return obligation.result;
}

function projectReadOnlyAuthorityDecision(obligation = {}, decision = "declined", options = {}) {
  const decidedAt = nowIso(options.nowMs);
  const normalizedDecision = decision === "canceled" ? "canceled" : "declined";
  return {
    schema: DIRECT_READONLY_TOOL_AUTHORITY_DECISION_SCHEMA,
    decision: normalizedDecision,
    obligationId: obligation.obligationId,
    tool: normalizeString(obligation.name, "read_file"),
    decidedAt,
    decidedBy: normalizeString(options.decidedBy || options.approvedBy, "local-user"),
    reason: normalizeString(options.reason, normalizedDecision === "canceled" ? "User canceled read-only tool execution." : "User declined read-only tool execution."),
    executionAllowed: false,
    continuationAllowed: false,
    sideEffectExecuted: false,
  };
}

function approveReadOnlyToolObligation(options = {}) {
  const sessionStore = options.sessionStore;
  if (!sessionStore) throw new Error("Read-only tool approval requires a direct session store.");
  const { turn, obligation } = sessionStore.findToolObligation(options.sessionId, options.turnId, options.obligationId);
  if (READONLY_TERMINAL_STATUSES.has(normalizeString(obligation.status, ""))) {
    return { turn, obligation };
  }
  const parsed = assertReadFileObligation(obligation);
  const approvedAt = nowIso(options.nowMs);
  return sessionStore.updateToolObligation(options.sessionId, options.turnId, obligation.obligationId, {
    status: "approved",
    authorityState: "approved_readonly",
    executionAllowed: true,
    continuationAllowed: false,
    approvalAvailable: false,
    approvedAt,
    approvedBy: normalizeString(options.approvedBy, "local-user"),
    approvedRead: {
      tool: normalizeString(obligation.name, "read_file"),
      relPath: parsed.relPath,
      providerCallType: parsed.providerCallType,
      outputType: parsed.outputType,
    },
  }, {
    ...options,
    nextTurnState: "authority_waiting",
  });
}

function decideReadOnlyToolObligation(options = {}) {
  const sessionStore = options.sessionStore;
  if (!sessionStore) throw new Error("Read-only tool decision requires a direct session store.");
  const { turn, obligation } = sessionStore.findToolObligation(options.sessionId, options.turnId, options.obligationId);
  assertReadFileToolName(obligation);
  const existingStatus = normalizeString(obligation.status, "");
  if (READONLY_TERMINAL_STATUSES.has(existingStatus) && existingStatus !== "approved") {
    return { turn, obligation };
  }
  const decision = options.decision === "canceled" ? "canceled" : "declined";
  const authorityDecision = projectReadOnlyAuthorityDecision(obligation, decision, options);
  return sessionStore.updateToolObligation(options.sessionId, options.turnId, obligation.obligationId, {
    status: decision,
    authorityState: decision,
    executionAllowed: false,
    continuationAllowed: false,
    sideEffectExecuted: false,
    authorityDecision,
    [`${decision}At`]: authorityDecision.decidedAt,
  }, {
    ...options,
    nextTurnState: decision === "canceled" ? "aborted" : "failed",
    turnPatch: {
      error: decision === "canceled"
        ? null
        : {
            code: "tool_obligation_declined",
            message: authorityDecision.reason,
          },
    },
  });
}

function declineReadOnlyToolObligation(options = {}) {
  return decideReadOnlyToolObligation({
    ...options,
    decision: "declined",
  });
}

function cancelReadOnlyToolObligation(options = {}) {
  return decideReadOnlyToolObligation({
    ...options,
    decision: "canceled",
  });
}

async function executeApprovedReadOnlyToolObligation(options = {}) {
  const sessionStore = options.sessionStore;
  if (!sessionStore) throw new Error("Read-only tool execution requires a direct session store.");
  if (typeof options.workspaceRequest !== "function") throw new Error("Read-only tool execution requires workspaceRequest.");
  const { obligation } = sessionStore.findToolObligation(options.sessionId, options.turnId, options.obligationId);
  if (isPlainObject(obligation.result)) {
    return {
      reused: true,
      obligation,
      result: obligation.result,
    };
  }
  if (obligation.status !== "approved" || obligation.authorityState !== "approved_readonly") {
    const error = new Error("Read-only tool obligation must be approved before execution.");
    error.code = "tool_obligation_not_approved";
    throw error;
  }
  const parsed = assertReadFileObligation(obligation);
  const workspaceResult = await options.workspaceRequest("readFile", {
    relPath: parsed.relPath,
    maxBytes: MAX_READ_FILE_BYTES,
    rejectSensitive: true,
  });
  const result = projectReadResult(workspaceResult, obligation, obligation.approvedAt || "", options.nowMs);
  const updated = sessionStore.updateToolObligation(options.sessionId, options.turnId, obligation.obligationId, {
    status: "result_recorded",
    authorityState: "result_recorded",
    executionAllowed: false,
    continuationAllowed: false,
    approvalAvailable: false,
    sideEffectExecuted: false,
    result,
    resultRecordedAt: result.recordedAt,
  }, {
    ...options,
    nextTurnState: "continuation_ready",
  });
  return {
    reused: false,
    obligation: updated.obligation,
    result,
  };
}

function buildReadOnlyToolContinuationRequest(options = {}) {
  const sessionStore = options.sessionStore;
  if (!sessionStore) throw new Error("Read-only tool continuation requires a direct session store.");
  const { obligation } = sessionStore.findToolObligation(options.sessionId, options.turnId, options.obligationId);
  const result = assertRecordedReadOnlyResult(obligation);
  const parsed = assertReadFileObligation(obligation);
  const toolCallId = parsed.callId;
  const outputType = normalizeString(obligation.approvedRead?.outputType || parsed.outputType, parsed.outputType);
  const outputText = normalizeString(result.providerOutputText, "") || normalizeString(result.textPreview, "");
  return {
    schema: DIRECT_READONLY_TOOL_CONTINUATION_REQUEST_SCHEMA,
    continuationId: continuationIdForResult(obligation.obligationId, result.resultId),
    sessionId: normalizeString(options.sessionId, obligation.sessionId),
    turnId: normalizeString(options.turnId, obligation.turnId),
    obligationId: obligation.obligationId,
    createdAt: nowIso(options.nowMs),
    source: {
      fromRecordedResult: true,
      recordedResultId: result.resultId,
      recordedAt: normalizeString(result.recordedAt, ""),
      approvedAt: normalizeString(result.approvedAt || obligation.approvedAt, ""),
    },
    toolResult: {
      obligationId: obligation.obligationId,
      callId: toolCallId,
      itemId: normalizeString(obligation.sourceItemId, ""),
      toolCallId,
      name: normalizeString(obligation.name, "read_file"),
      providerCallType: normalizeString(obligation.providerCallType || obligation.toolType, ""),
      outputType,
      content: [
        {
          type: outputType,
          text: outputText,
        },
      ],
      metadata: {
        resultId: result.resultId,
        relPath: normalizeString(result.relPath, ""),
        size: Number(result.size || 0),
        truncated: Boolean(result.truncated),
        binary: Boolean(result.binary),
        resultClass: normalizeString(result.resultClass, ""),
        status: normalizeString(result.status, "completed"),
      },
    },
    localTranscript: [
      {
        type: "tool_result",
        toolCallId,
        name: normalizeString(obligation.name, "read_file"),
        content: outputText,
      },
    ],
    safety: {
      fromRecordedResult: true,
      originalRequestRetried: false,
      sideEffectExecuted: false,
      workspaceBackendOnly: true,
      continuationLiveSendEnabled: options.continuationLiveSendEnabled === true,
    },
    rawAuthHeadersExposed: false,
    rawBackendRequestsExposed: false,
    rawBackendFramesExposed: false,
  };
}

function assertContinuationRequestForObligation(request = {}, obligation = {}) {
  const result = assertRecordedReadOnlyResult(obligation);
  if (request.schema !== DIRECT_READONLY_TOOL_CONTINUATION_REQUEST_SCHEMA) {
    const error = new Error("Read-only tool continuation request has an invalid schema.");
    error.code = "invalid_continuation_request_schema";
    throw error;
  }
  if (request.obligationId !== obligation.obligationId || request.toolResult?.metadata?.resultId !== result.resultId) {
    const error = new Error("Read-only tool continuation request does not match recorded tool evidence.");
    error.code = "continuation_evidence_mismatch";
    throw error;
  }
}

function recordReadOnlyToolContinuationRequest(options = {}) {
  const sessionStore = options.sessionStore;
  if (!sessionStore) throw new Error("Read-only tool continuation requires a direct session store.");
  const { obligation } = sessionStore.findToolObligation(options.sessionId, options.turnId, options.obligationId);
  if (isPlainObject(obligation.continuationRequest)) {
    return {
      reused: true,
      obligation,
      continuationRequest: obligation.continuationRequest,
    };
  }
  const continuationRequest = isPlainObject(options.continuationRequest)
    ? options.continuationRequest
    : buildReadOnlyToolContinuationRequest(options);
  assertContinuationRequestForObligation(continuationRequest, obligation);
  const updated = sessionStore.updateToolObligation(options.sessionId, options.turnId, obligation.obligationId, {
    status: "continuation_built",
    authorityState: "continuation_built",
    executionAllowed: false,
    continuationAllowed: false,
    continuationRequest,
    continuationBuiltAt: continuationRequest.createdAt,
  }, {
    ...options,
    nextTurnState: "continuation_ready",
  });
  return {
    reused: false,
    obligation: updated.obligation,
    continuationRequest,
  };
}

module.exports = {
  DIRECT_READONLY_TOOL_AUTHORITY_DECISION_SCHEMA,
  DIRECT_READONLY_TOOL_CONTINUATION_REQUEST_SCHEMA,
  DIRECT_READONLY_TOOL_RESULT_SCHEMA,
  MAX_APPROVAL_PREVIEW_CHARS,
  MAX_PROVIDER_OUTPUT_CHARS,
  MAX_READ_FILE_BYTES,
  approveReadOnlyToolObligation,
  buildReadOnlyToolContinuationRequest,
  cancelReadOnlyToolObligation,
  declineReadOnlyToolObligation,
  executeApprovedReadOnlyToolObligation,
  projectReadResult,
  projectReadOnlyAuthorityDecision,
  recordReadOnlyToolContinuationRequest,
};
