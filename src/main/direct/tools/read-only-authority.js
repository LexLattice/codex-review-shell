"use strict";

const crypto = require("node:crypto");

const DIRECT_READONLY_TOOL_AUTHORITY_DECISION_SCHEMA = "direct_codex_readonly_tool_authority_decision@1";
const DIRECT_READONLY_TOOL_CONTINUATION_REQUEST_SCHEMA = "direct_codex_readonly_tool_continuation_request@1";
const DIRECT_READONLY_TOOL_RESULT_SCHEMA = "direct_codex_readonly_tool_result@1";
const DIRECT_PATCH_APPLY_CONTINUATION_REQUEST_SCHEMA = "direct_codex_patch_apply_continuation_request@1";
const DIRECT_PATCH_APPLY_RESULT_SCHEMA = "direct_codex_patch_apply_result@1";
const DIRECT_COMMAND_EXECUTION_CONTINUATION_REQUEST_SCHEMA = "direct_codex_command_execution_continuation_request@1";
const DIRECT_COMMAND_EXECUTION_RESULT_SCHEMA = "direct_codex_command_execution_result@1";
const READ_FILE_TOOL_NAMES = new Set(["read_file", "readFile"]);
const MAX_READ_FILE_BYTES = 384 * 1024;
const MAX_PROVIDER_OUTPUT_CHARS = 64 * 1024;
const MAX_APPROVAL_PREVIEW_CHARS = 512;
const MAX_READONLY_TOOL_LOOP_STEPS = 8;
const MAX_READONLY_TOOL_LOOP_TOTAL_PROVIDER_CHARS = 256 * 1024;
const MAX_READONLY_TOOL_LOOP_REPEATED_PATH_READS = 2;
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
const TOOL_RESULT_SECRET_PATTERNS = [
  { category: "authorization-header", pattern: /authorization\s*:\s*bearer\s+[A-Za-z0-9._~+/=-]{16,}/i },
  { category: "cookie", pattern: /(?:cookie|set-cookie)\s*:\s*[^;\n]*?(?:session|token|auth|jwt)[^;\n=]*=[^;\n]{8,}/i },
  { category: "private-key", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { category: "env-secret", pattern: /(?:^|\n)\s*[A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY|PRIVATE_KEY)[A-Z0-9_]*\s*=\s*['"]?[^'"\s]{8,}/i },
  { category: "token", pattern: /\b(?:access_token|refresh_token|id_token|api[_-]?key)\b\s*[:=]\s*['"]?[A-Za-z0-9._~+/=-]{16,}/i },
  { category: "session-id", pattern: /\b(?:session_id|sid|csrf)\b\s*[:=]\s*['"]?[A-Za-z0-9._~+/=-]{16,}/i },
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

function canonicalToolLoopId(obligation = {}) {
  const existing = normalizeString(obligation.toolLoopId, "");
  if (existing) return existing;
  const digest = crypto
    .createHash("sha256")
    .update(`${normalizeString(obligation.sessionId, "")}:${normalizeString(obligation.turnId, "")}:read_only_tool_loop`)
    .digest("hex")
    .slice(0, 20);
  return `tool_loop_${digest}`;
}

function canonicalToolStepId(obligation = {}) {
  const existing = normalizeString(obligation.stepId, "");
  if (existing) return existing;
  const digest = crypto
    .createHash("sha256")
    .update([
      normalizeString(obligation.sessionId, ""),
      normalizeString(obligation.turnId, ""),
      canonicalToolLoopId(obligation),
      String(Number(obligation.stepOrdinal || 1) || 1),
      normalizeString(obligation.obligationId, ""),
    ].join(":"))
    .digest("hex")
    .slice(0, 20);
  return `tool_step_${digest}`;
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
    /^mnt\/[a-z]\//i.test(text) ||
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

function scanToolResultTextForSecrets(text) {
  const value = exactString(text, "");
  const categories = [];
  for (const entry of TOOL_RESULT_SECRET_PATTERNS) {
    if (entry.pattern.test(value)) categories.push(entry.category);
  }
  return {
    scanned: true,
    scanVersion: "direct_tool_result_redaction@1",
    status: categories.length ? "blocked" : "passed",
    categories: [...new Set(categories)],
  };
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
  const toolResultRedaction = binary
    ? { scanned: true, scanVersion: "direct_tool_result_redaction@1", status: "passed", categories: [] }
    : scanToolResultTextForSecrets(providerTextPreview);
  if (toolResultRedaction.status === "blocked") {
    const error = new Error("read_file result contains auth-like material and cannot be sent to the provider.");
    error.code = "tool_result_redaction_failed";
    error.redaction = {
      scanned: true,
      scanVersion: toolResultRedaction.scanVersion,
      status: "blocked",
      categoryCount: toolResultRedaction.categories.length,
    };
    throw error;
  }
  const resultClass = binary
    ? "binary_summary"
    : (truncated ? "text_preview_truncated" : "text_preview_untruncated");
  const providerEnvelope = {
    kind: "read_file_result",
    path: normalizeString(result.relPath, ""),
    textPreview: providerTextPreview,
    truncated,
    redacted: toolResultRedaction.status === "redacted",
    bytesRead: Number(result.size || 0),
    binary,
    encoding: binary ? "" : "utf-8",
    resultClass,
    redaction: {
      scanned: true,
      scanVersion: toolResultRedaction.scanVersion,
      status: toolResultRedaction.status,
    },
    note: truncated
      ? "File content was truncated by the local shell before provider continuation."
      : "",
  };
  const providerOutputText = JSON.stringify(providerEnvelope);
  return {
    schema: DIRECT_READONLY_TOOL_RESULT_SCHEMA,
    resultId: resultIdForObligation(obligation.obligationId),
    obligationId: obligation.obligationId,
    toolLoopId: canonicalToolLoopId(obligation),
    stepId: canonicalToolStepId(obligation),
    stepOrdinal: Number(obligation.stepOrdinal || 1),
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
    toolResultRedaction,
    summary: `${normalizeString(result.relPath, "file")} · ${Number(result.size || 0)} bytes${truncated ? " · truncated" : ""}`,
    source: normalizeString(result.source, ""),
    approvedAt,
    recordedAt: nowIso(nowMs),
    sideEffectExecuted: false,
    rawWorkspacePathExposed: false,
  };
}

function loopSummaryFromTurn(turn = {}, nextObligation = null) {
  const obligations = Array.isArray(turn.unresolvedObligations) ? turn.unresolvedObligations : [];
  const loopId = canonicalToolLoopId(nextObligation || obligations[0] || {
    sessionId: turn.sessionId,
    turnId: turn.turnId,
  });
  const loopObligations = obligations.filter((obligation) => canonicalToolLoopId(obligation) === loopId);
  const providerOutputTotalChars = loopObligations.reduce((sum, obligation) =>
    sum + Number(obligation?.result?.providerOutputChars || 0), 0);
  const completedStepCount = loopObligations.filter((obligation) =>
    ["continuation_built", "continuation_sent"].includes(normalizeString(obligation.status, ""))).length;
  const readCounts = new Map();
  for (const obligation of loopObligations) {
    const relPath = normalizeString(obligation.approvedRead?.relPath || obligation.result?.relPath, "");
    if (!relPath) continue;
    readCounts.set(relPath, (readCounts.get(relPath) || 0) + 1);
  }
  return {
    toolLoopId: loopId,
    maxStepCount: MAX_READONLY_TOOL_LOOP_STEPS,
    completedStepCount,
    totalStepCount: loopObligations.length,
    providerOutputTotalChars,
    redactionBlockedStepCount: loopObligations.filter((obligation) => obligation.result?.toolResultRedaction?.status === "blocked").length,
    redactedStepCount: loopObligations.filter((obligation) => obligation.result?.toolResultRedaction?.status === "redacted").length,
    repeatedPathReads: Object.fromEntries(readCounts.entries()),
  };
}

function assertLoopCapsBeforeExecution(turn = {}, obligation = {}) {
  const stepOrdinal = Number(obligation.stepOrdinal || 1) || 1;
  if (stepOrdinal > MAX_READONLY_TOOL_LOOP_STEPS) {
    const error = new Error("Direct read-only tool loop step cap exceeded.");
    error.code = "tool_loop_cap_exceeded";
    throw error;
  }
  const summary = loopSummaryFromTurn(turn, obligation);
  if (summary.providerOutputTotalChars > MAX_READONLY_TOOL_LOOP_TOTAL_PROVIDER_CHARS) {
    const error = new Error("Direct read-only tool loop provider-output cap exceeded.");
    error.code = "tool_loop_cap_exceeded";
    throw error;
  }
  const parsed = assertReadFileObligation(obligation);
  const currentCount = Number(summary.repeatedPathReads[parsed.relPath] || 0);
  if (currentCount > MAX_READONLY_TOOL_LOOP_REPEATED_PATH_READS) {
    const error = new Error("Direct read-only tool loop repeated-path cap exceeded.");
    error.code = "tool_loop_cap_exceeded";
    throw error;
  }
}

function assertRecordedReadOnlyResult(obligation = {}) {
  if (!["result_recorded", "patch_result_recorded", "command_result_recorded", "continuation_built", "continuation_sent"].includes(normalizeString(obligation.status, ""))) {
    const error = new Error("Read-only tool continuation requires a recorded tool result.");
    error.code = "tool_result_not_recorded";
    throw error;
  }
  if (!isPlainObject(obligation.result)) {
    const error = new Error("Read-only tool continuation requires stored tool evidence.");
    error.code = "tool_result_missing";
    throw error;
  }
  if (![DIRECT_READONLY_TOOL_RESULT_SCHEMA, DIRECT_PATCH_APPLY_RESULT_SCHEMA, DIRECT_COMMAND_EXECUTION_RESULT_SCHEMA].includes(obligation.result.schema)) {
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
    toolLoopId: canonicalToolLoopId(obligation),
    stepId: canonicalToolStepId(obligation),
    stepOrdinal: Number(obligation.stepOrdinal || 1),
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
  const turn = sessionStore.readTurn(options.sessionId, options.turnId) || {};
  assertLoopCapsBeforeExecution(turn, obligation);
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
    toolLoopId: canonicalToolLoopId(obligation),
    stepId: canonicalToolStepId(obligation),
    stepOrdinal: Number(obligation.stepOrdinal || 1),
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
    toolLoop: {
      toolLoopId: canonicalToolLoopId(obligation),
      stepId: canonicalToolStepId(obligation),
      stepOrdinal: Number(obligation.stepOrdinal || 1),
      maxStepCount: MAX_READONLY_TOOL_LOOP_STEPS,
      parentResponseId: normalizeString(obligation.parentResponseId, ""),
      parentResponseSource: normalizeString(obligation.parentResponseSource, ""),
      parentResponseDigest: normalizeString(obligation.parentResponseDigest, ""),
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
  if (![DIRECT_READONLY_TOOL_CONTINUATION_REQUEST_SCHEMA, DIRECT_PATCH_APPLY_CONTINUATION_REQUEST_SCHEMA, DIRECT_COMMAND_EXECUTION_CONTINUATION_REQUEST_SCHEMA].includes(request.schema)) {
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
    toolLoopId: canonicalToolLoopId(obligation),
    stepId: canonicalToolStepId(obligation),
    stepOrdinal: Number(obligation.stepOrdinal || 1),
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
  MAX_READONLY_TOOL_LOOP_REPEATED_PATH_READS,
  MAX_READONLY_TOOL_LOOP_STEPS,
  MAX_READONLY_TOOL_LOOP_TOTAL_PROVIDER_CHARS,
  approveReadOnlyToolObligation,
  buildReadOnlyToolContinuationRequest,
  canonicalToolLoopId,
  canonicalToolStepId,
  cancelReadOnlyToolObligation,
  declineReadOnlyToolObligation,
  executeApprovedReadOnlyToolObligation,
  loopSummaryFromTurn,
  projectReadResult,
  projectReadOnlyAuthorityDecision,
  recordReadOnlyToolContinuationRequest,
  scanToolResultTextForSecrets,
};
