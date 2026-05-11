"use strict";

const crypto = require("node:crypto");

const DIRECT_PATCH_APPLY_PLAN_SCHEMA = "direct_patch_apply_plan@1";
const DIRECT_PATCH_APPLY_RESULT_SCHEMA = "direct_codex_patch_apply_result@1";
const DIRECT_PATCH_APPLY_CONTINUATION_REQUEST_SCHEMA = "direct_codex_patch_apply_continuation_request@1";
const APPLY_PATCH_TOOL_NAMES = new Set(["apply_patch", "applyPatch"]);
const SUPPORTED_PATCH_CONTINUATION_KINDS = new Map([
  ["function_call", "function_call_output"],
  ["custom_tool_call", "custom_tool_call_output"],
]);
const PATCH_TERMINAL_STATUSES = new Set([
  "patch_declined",
  "patch_canceled",
  "patch_applied",
  "patch_result_recorded",
  "continuation_built",
  "continuation_sent",
]);
const MAX_PATCH_TEXT_CHARS = 256 * 1024;
const MAX_PATCH_APPROVAL_CARD_CHARS = 24_000;
const MAX_PATCH_RESULT_SUMMARY_CHARS = 4000;

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function patchPlanIdFor(obligationId, patchText) {
  return `patch_plan_${sha256(`${normalizeString(obligationId, "")}:${patchText}`).slice(0, 20)}`;
}

function patchResultIdFor(obligationId, patchPlanId) {
  return `patch_result_${sha256(`${normalizeString(obligationId, "")}:${normalizeString(patchPlanId, "")}`).slice(0, 20)}`;
}

function patchContinuationIdFor(obligationId, resultId) {
  return `patch_continuation_${sha256(`${normalizeString(obligationId, "")}:${normalizeString(resultId, "")}`).slice(0, 20)}`;
}

function parseArgumentsJson(obligation = {}) {
  const text = normalizeString(obligation.argumentsText, "");
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    return isPlainObject(parsed) ? parsed : {};
  } catch (error) {
    const parseError = new Error(`Patch tool arguments are not valid JSON: ${error.message}`);
    parseError.code = "malformed_patch_arguments";
    throw parseError;
  }
}

function supportedPatchOutputType(obligation = {}) {
  const providerCallType = normalizeString(obligation.providerCallType || obligation.toolType, "");
  const outputType = SUPPORTED_PATCH_CONTINUATION_KINDS.get(providerCallType);
  if (!outputType) {
    const error = new Error(`Unsupported patch continuation call type: ${providerCallType || "unknown"}`);
    error.code = "patch_tool_shape_unsupported";
    throw error;
  }
  return { providerCallType, outputType };
}

function assertPatchObligation(obligation = {}) {
  const status = normalizeString(obligation.status, "");
  if (status === "collecting_arguments" || obligation.completedAtSequence == null) {
    const error = new Error("Patch approval requires a completed provider tool call.");
    error.code = "tool_call_arguments_incomplete";
    throw error;
  }
  if (!APPLY_PATCH_TOOL_NAMES.has(normalizeString(obligation.name, ""))) {
    const error = new Error(`Unsupported patch tool: ${obligation.name || "unknown"}`);
    error.code = "unsupported_patch_tool_name";
    throw error;
  }
  if (normalizeString(obligation.namespace, "")) {
    const error = new Error("Patch tool namespace is unsupported in v0.");
    error.code = "unsupported_patch_namespace";
    throw error;
  }
  if (!normalizeString(obligation.callId, "")) {
    const error = new Error("Patch continuation requires the original provider call_id.");
    error.code = "missing_patch_call_id";
    throw error;
  }
  const args = parseArgumentsJson(obligation);
  const patchText = typeof args.patch === "string" ? args.patch : "";
  if (!patchText.trim()) {
    const error = new Error("apply_patch requires patch text.");
    error.code = "malformed_patch_arguments";
    throw error;
  }
  if (patchText.length > MAX_PATCH_TEXT_CHARS) {
    const error = new Error("Patch text exceeds the configured size limit.");
    error.code = "patch_caps_exceeded";
    throw error;
  }
  const continuationKind = supportedPatchOutputType(obligation);
  return {
    patchText,
    summary: normalizeString(args.summary, ""),
    callId: normalizeString(obligation.callId, ""),
    providerCallType: continuationKind.providerCallType,
    outputType: continuationKind.outputType,
  };
}

function patchPreviewFromFiles(files = []) {
  const text = files.map((file) => [
    `diff -- ${normalizeString(file.displayPath, "file")}`,
    normalizeString(file.previewText, ""),
  ].join("\n")).join("\n\n");
  return text.length > MAX_PATCH_APPROVAL_CARD_CHARS
    ? text.slice(0, MAX_PATCH_APPROVAL_CARD_CHARS)
    : text;
}

function projectPatchPlan(workspacePlan = {}, obligation = {}, parsed = {}, nowMs) {
  const files = Array.isArray(workspacePlan.files) ? workspacePlan.files : [];
  const previewText = patchPreviewFromFiles(files);
  const patchPlanId = patchPlanIdFor(obligation.obligationId, parsed.patchText);
  const plan = {
    schema: DIRECT_PATCH_APPLY_PLAN_SCHEMA,
    patchPlanId,
    projectId: normalizeString(obligation.projectId, ""),
    threadId: normalizeString(obligation.sessionId, ""),
    turnId: normalizeString(obligation.turnId, ""),
    obligationId: normalizeString(obligation.obligationId, ""),
    callId: parsed.callId,
    providerResponseId: normalizeString(obligation.parentResponseId, ""),
    providerCallId: parsed.callId,
    providerCallItemId: normalizeString(obligation.sourceItemId, ""),
    parentResponseSource: normalizeString(obligation.parentResponseSource, "native_direct_initial_stream"),
    parentResponseSourceEventDigest: sha256(obligation.parentResponseId || ""),
    parentTurnDigest: sha256(`${normalizeString(obligation.sessionId, "")}:${normalizeString(obligation.turnId, "")}`),
    toolName: "apply_patch",
    providerCallType: parsed.providerCallType,
    providerOutputType: parsed.outputType,
    patchTextHash: sha256(parsed.patchText),
    patchShapeHash: sha256(stableStringify({
      files: files.map((file) => ({
        path: file.displayPath,
        operation: file.operation,
        beforeDigest: file.beforeDigest,
        afterDigest: file.afterDigest,
      })),
    })),
    parserVersion: "direct_patch_parser@1",
    dryRunVersion: "workspace_apply_patch@1",
    createdAt: nowIso(nowMs),
    integrity: {
      algorithm: "sha256",
      artifactDigest: sha256(stableStringify({
        obligationId: obligation.obligationId,
        patchTextHash: sha256(parsed.patchText),
        files,
      })),
    },
    files,
    totals: isPlainObject(workspacePlan.totals) ? workspacePlan.totals : {
      fileCount: files.length,
      createCount: files.filter((file) => file.operation === "create").length,
      updateCount: files.filter((file) => file.operation === "update").length,
      deleteCount: 0,
      addedLineCount: files.reduce((sum, file) => sum + Number(file.addedLineCount || 0), 0),
      removedLineCount: files.reduce((sum, file) => sum + Number(file.removedLineCount || 0), 0),
      hunkCount: files.reduce((sum, file) => sum + Number(file.hunkCount || 0), 0),
    },
    preview: {
      text: previewText,
      textHash: sha256(previewText),
      truncated: files.some((file) => file.previewTruncated) || previewText.length >= MAX_PATCH_APPROVAL_CARD_CHARS,
    },
    caps: {
      maxPatchChars: MAX_PATCH_TEXT_CHARS,
      maxPreviewChars: MAX_PATCH_APPROVAL_CARD_CHARS,
      truncatedPreview: files.some((file) => file.previewTruncated) || previewText.length >= MAX_PATCH_APPROVAL_CARD_CHARS,
    },
    safety: {
      rawWorkspacePathExposed: false,
      rawProviderPayloadExposed: false,
      sensitivePathBlocked: false,
      secretLikeContentBlocked: false,
      binaryFileBlocked: false,
      symlinkEscapeBlocked: false,
      pathCollisionBlocked: false,
      generatedPathBlocked: false,
    },
    status: "dry_run_passed",
    blockerCode: "",
  };
  if (plan.preview.truncated) {
    const error = new Error("Patch preview is too large for safe approval.");
    error.code = "patch_preview_too_large_for_safe_approval";
    throw error;
  }
  return plan;
}

async function planPatchApplyObligation(options = {}) {
  const sessionStore = options.sessionStore;
  if (!sessionStore) throw new Error("Patch planning requires a direct session store.");
  if (typeof options.workspaceRequest !== "function") throw new Error("Patch planning requires workspaceRequest.");
  const { obligation } = sessionStore.findToolObligation(options.sessionId, options.turnId, options.obligationId);
  if (isPlainObject(obligation.patchPlan)) {
    return { reused: true, obligation, patchPlan: obligation.patchPlan };
  }
  const parsed = assertPatchObligation(obligation);
  const workspacePlan = await options.workspaceRequest("applyPatch", {
    mode: "dryRun",
    patch: parsed.patchText,
  });
  const patchPlan = projectPatchPlan(workspacePlan, obligation, parsed, options.nowMs);
  const updated = sessionStore.updateToolObligation(options.sessionId, options.turnId, obligation.obligationId, {
    status: "patch_planned",
    authorityState: "patch_waiting_for_approval",
    approvalAvailable: true,
    executionAllowed: false,
    continuationAllowed: false,
    patchPlan,
    patchPlanBuiltAt: patchPlan.createdAt,
  }, {
    ...options,
    nextTurnState: "tool_waiting",
  });
  return { reused: false, obligation: updated.obligation, patchPlan };
}

function approvePatchApplyObligation(options = {}) {
  const sessionStore = options.sessionStore;
  if (!sessionStore) throw new Error("Patch approval requires a direct session store.");
  const { turn, obligation } = sessionStore.findToolObligation(options.sessionId, options.turnId, options.obligationId);
  if (PATCH_TERMINAL_STATUSES.has(normalizeString(obligation.status, ""))) return { turn, obligation };
  const parsed = assertPatchObligation(obligation);
  if (!isPlainObject(obligation.patchPlan)) {
    const error = new Error("Patch approval requires a dry-run patch plan.");
    error.code = "patch_plan_missing";
    throw error;
  }
  const approvedAt = nowIso(options.nowMs);
  return sessionStore.updateToolObligation(options.sessionId, options.turnId, obligation.obligationId, {
    status: "patch_approved",
    authorityState: "patch_approved",
    executionAllowed: true,
    continuationAllowed: false,
    approvalAvailable: false,
    approvedAt,
    approvedBy: normalizeString(options.approvedBy, "local-user"),
    approvedPatch: {
      patchPlanId: obligation.patchPlan.patchPlanId,
      providerCallType: parsed.providerCallType,
      outputType: parsed.outputType,
    },
  }, {
    ...options,
    nextTurnState: "authority_waiting",
  });
}

function decidePatchApplyObligation(options = {}) {
  const sessionStore = options.sessionStore;
  if (!sessionStore) throw new Error("Patch decision requires a direct session store.");
  const { turn, obligation } = sessionStore.findToolObligation(options.sessionId, options.turnId, options.obligationId);
  const decision = options.decision === "canceled" ? "patch_canceled" : "patch_declined";
  if (PATCH_TERMINAL_STATUSES.has(normalizeString(obligation.status, ""))) return { turn, obligation };
  const decidedAt = nowIso(options.nowMs);
  return sessionStore.updateToolObligation(options.sessionId, options.turnId, obligation.obligationId, {
    status: decision,
    authorityState: decision,
    executionAllowed: false,
    continuationAllowed: false,
    approvalAvailable: false,
    authorityDecision: {
      schema: "direct_codex_patch_authority_decision@1",
      decision,
      obligationId: obligation.obligationId,
      tool: "apply_patch",
      decidedAt,
      decidedBy: normalizeString(options.decidedBy, "local-user"),
      reason: normalizeString(options.reason, decision === "patch_canceled" ? "User canceled patch apply." : "User declined patch apply."),
      executionAllowed: false,
      sideEffectExecuted: false,
    },
    sideEffectExecuted: false,
  }, {
    ...options,
    nextTurnState: decision === "patch_canceled" ? "aborted" : "failed",
    turnPatch: decision === "patch_canceled" ? { error: null } : {
      error: {
        code: "patch_obligation_declined",
        message: "User declined patch apply.",
      },
    },
  });
}

async function executeApprovedPatchApplyObligation(options = {}) {
  const sessionStore = options.sessionStore;
  if (!sessionStore) throw new Error("Patch apply requires a direct session store.");
  if (typeof options.workspaceRequest !== "function") throw new Error("Patch apply requires workspaceRequest.");
  const { obligation } = sessionStore.findToolObligation(options.sessionId, options.turnId, options.obligationId);
  if (isPlainObject(obligation.result)) return { reused: true, obligation, result: obligation.result };
  if (obligation.status !== "patch_approved" || obligation.authorityState !== "patch_approved") {
    const error = new Error("Patch obligation must be approved before apply.");
    error.code = "patch_obligation_not_approved";
    throw error;
  }
  const parsed = assertPatchObligation(obligation);
  const applied = await options.workspaceRequest("applyPatch", {
    mode: "apply",
    patch: parsed.patchText,
    patchPlanId: obligation.patchPlan?.patchPlanId,
  });
  const resultId = patchResultIdFor(obligation.obligationId, obligation.patchPlan?.patchPlanId || "");
  const files = (Array.isArray(applied.files) ? applied.files : []).map((file) => ({
    path: normalizeString(file.displayPath, ""),
    operation: normalizeString(file.operation, "update"),
    beforeEvidenceKey: normalizeString(file.beforeDigest, ""),
    afterEvidenceKey: normalizeString(file.afterDigest, ""),
    addedLineCount: Number(file.addedLineCount || 0),
    removedLineCount: Number(file.removedLineCount || 0),
  }));
  const summary = files.map((file) => `${file.operation} ${file.path}`).join("; ").slice(0, MAX_PATCH_RESULT_SUMMARY_CHARS);
  const providerEnvelope = {
    kind: "apply_patch_result",
    status: "applied",
    patchPlanId: normalizeString(obligation.patchPlan?.patchPlanId, ""),
    operationId: normalizeString(options.clientPatchDecisionId, ""),
    files,
    summary,
    truncated: false,
    rawPathsExposed: false,
    rawPatchIncluded: false,
  };
  const providerOutputText = JSON.stringify(providerEnvelope);
  const result = {
    schema: DIRECT_PATCH_APPLY_RESULT_SCHEMA,
    resultId,
    obligationId: obligation.obligationId,
    tool: "apply_patch",
    status: "applied",
    resultClass: "patch_applied",
    patchPlanId: normalizeString(obligation.patchPlan?.patchPlanId, ""),
    files,
    summary,
    providerOutputText,
    providerOutputChars: providerOutputText.length,
    appliedAt: nowIso(options.nowMs),
    sideEffectExecuted: true,
    rawWorkspacePathExposed: false,
    rawPatchIncluded: false,
    journal: {
      journalId: `patch_journal_${sha256(`${obligation.obligationId}:${resultId}`).slice(0, 20)}`,
      status: "applied",
    },
  };
  const updated = sessionStore.updateToolObligation(options.sessionId, options.turnId, obligation.obligationId, {
    status: "patch_result_recorded",
    authorityState: "patch_result_recorded",
    executionAllowed: false,
    continuationAllowed: false,
    approvalAvailable: false,
    sideEffectExecuted: true,
    result,
    resultRecordedAt: result.appliedAt,
  }, {
    ...options,
    nextTurnState: "continuation_ready",
  });
  return { reused: false, obligation: updated.obligation, result };
}

function buildPatchApplyContinuationRequest(options = {}) {
  const sessionStore = options.sessionStore;
  if (!sessionStore) throw new Error("Patch continuation requires a direct session store.");
  const { obligation } = sessionStore.findToolObligation(options.sessionId, options.turnId, options.obligationId);
  if (!isPlainObject(obligation.result) || obligation.result.schema !== DIRECT_PATCH_APPLY_RESULT_SCHEMA) {
    const error = new Error("Patch continuation requires a recorded patch result.");
    error.code = "patch_result_missing";
    throw error;
  }
  const parsed = assertPatchObligation(obligation);
  return {
    schema: DIRECT_PATCH_APPLY_CONTINUATION_REQUEST_SCHEMA,
    continuationId: patchContinuationIdFor(obligation.obligationId, obligation.result.resultId),
    sessionId: normalizeString(options.sessionId, obligation.sessionId),
    turnId: normalizeString(options.turnId, obligation.turnId),
    obligationId: obligation.obligationId,
    createdAt: nowIso(options.nowMs),
    source: {
      fromRecordedResult: true,
      recordedResultId: obligation.result.resultId,
      recordedAt: normalizeString(obligation.result.appliedAt || obligation.result.recordedAt, ""),
      approvedAt: normalizeString(obligation.approvedAt, ""),
    },
    toolResult: {
      obligationId: obligation.obligationId,
      callId: parsed.callId,
      itemId: normalizeString(obligation.sourceItemId, ""),
      toolCallId: parsed.callId,
      name: "apply_patch",
      providerCallType: parsed.providerCallType,
      outputType: parsed.outputType,
      content: [{ type: parsed.outputType, text: normalizeString(obligation.result.providerOutputText, "") }],
      metadata: {
        resultId: obligation.result.resultId,
        patchPlanId: normalizeString(obligation.result.patchPlanId, ""),
        status: normalizeString(obligation.result.status, "applied"),
      },
    },
    safety: {
      fromRecordedResult: true,
      originalRequestRetried: false,
      sideEffectExecuted: true,
      workspaceBackendOnly: true,
      continuationLiveSendEnabled: options.continuationLiveSendEnabled === true,
    },
    rawAuthHeadersExposed: false,
    rawBackendRequestsExposed: false,
    rawBackendFramesExposed: false,
  };
}

module.exports = {
  APPLY_PATCH_TOOL_NAMES,
  DIRECT_PATCH_APPLY_CONTINUATION_REQUEST_SCHEMA,
  DIRECT_PATCH_APPLY_PLAN_SCHEMA,
  DIRECT_PATCH_APPLY_RESULT_SCHEMA,
  MAX_PATCH_APPROVAL_CARD_CHARS,
  MAX_PATCH_TEXT_CHARS,
  approvePatchApplyObligation,
  assertPatchObligation,
  buildPatchApplyContinuationRequest,
  decidePatchApplyObligation,
  executeApprovedPatchApplyObligation,
  planPatchApplyObligation,
};
