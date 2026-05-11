"use strict";

const crypto = require("node:crypto");
const { scanTextForRawExposure, stableStringify } = require("./renderer-transcript-projection");

const DIRECT_OBLIGATIONS_PROJECTION_KIND = "direct_obligations";
const DIRECT_OBLIGATIONS_PROJECTION_VERSION = "direct_obligations@1";
const DIRECT_OBLIGATIONS_BUILDER_VERSION = "direct_obligations_builder@1";
const DIRECT_OBLIGATIONS_POLICY_ID = "direct_obligations_policy@1";
const TOOL_CONTINUATION_CONTEXT_PROJECTION_KIND = "tool_continuation_context";
const TOOL_CONTINUATION_CONTEXT_PROJECTION_VERSION = "tool_continuation_context@1";
const TOOL_CONTINUATION_CONTEXT_BUILDER_VERSION = "direct_tool_continuation_context_builder@1";
const TOOL_CONTINUATION_CONTEXT_POLICY_ID = "direct_readonly_tool_continuation@1";
const READ_FILE_TOOL_NAMES = new Set(["read_file", "readFile"]);
const SUPPORTED_PROVIDER_CALL_TYPES = new Map([
  ["function_call", "function_call_output"],
  ["custom_tool_call", "custom_tool_call_output"],
]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function preserveString(value) {
  return typeof value === "string" ? value : "";
}

function nowIso(nowMs = Date.now()) {
  return new Date(Number(nowMs) || Date.now()).toISOString();
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function projectionItemId(projectionId, ordinal) {
  return `${projectionId}_item_${String(ordinal).padStart(4, "0")}`;
}

function safeKey(value) {
  return String(value || "key").replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 96) || "key";
}

function parseToolArguments(obligation = {}) {
  const text = preserveString(obligation.argumentsText);
  if (!text) return { ok: true, args: {} };
  try {
    const parsed = JSON.parse(text);
    return { ok: true, args: isPlainObject(parsed) ? parsed : {} };
  } catch {
    return { ok: false, args: {}, reason: "invalid_tool_arguments" };
  }
}

function providerOutputTypeFor(obligation = {}) {
  const providerCallType = normalizeString(obligation.providerCallType || obligation.toolType, "");
  return {
    providerCallType,
    providerOutputType: SUPPORTED_PROVIDER_CALL_TYPES.get(providerCallType) || "",
  };
}

function obligationUnsupportedReason(obligation = {}, context = {}) {
  if (context.multipleProviderToolCalls) return "multiple_tool_calls_unsupported";
  if (normalizeString(obligation.status, "") === "collecting_arguments" || obligation.completedAtSequence == null) {
    return "tool_call_arguments_incomplete";
  }
  if (!READ_FILE_TOOL_NAMES.has(normalizeString(obligation.name, ""))) return "unsupported_readonly_tool";
  if (normalizeString(obligation.namespace, "")) return "unsupported_tool_namespace";
  const { providerOutputType } = providerOutputTypeFor(obligation);
  if (!providerOutputType) return "unsupported_tool_call_type";
  if (!normalizeString(obligation.callId, "")) return "missing_tool_call_id";
  const parsed = parseToolArguments(obligation);
  if (!parsed.ok) return parsed.reason;
  if (!normalizeString(parsed.args.path || parsed.args.relPath || parsed.args.relativePath, "")) return "invalid_read_file_path";
  if (normalizeString(obligation.status, "") !== "result_recorded" &&
      normalizeString(obligation.status, "") !== "continuation_built" &&
      normalizeString(obligation.status, "") !== "continuation_sent") {
    return "";
  }
  if (!isPlainObject(obligation.result)) return "tool_result_missing";
  return "";
}

function obligationSourceDigest({ turn = {}, obligations = [], operationLedgerHeadDigest = "" } = {}) {
  return sha256(stableStringify({
    schema: "direct_obligations_projection_source@1",
    threadId: normalizeString(turn.sessionId, ""),
    turnId: normalizeString(turn.turnId, ""),
    turnState: normalizeString(turn.state, ""),
    responseIdDigest: sha256(turn.responseId || ""),
    operationLedgerHeadDigest,
    builderVersion: DIRECT_OBLIGATIONS_BUILDER_VERSION,
    obligations: obligations.map((obligation) => ({
      obligationId: normalizeString(obligation.obligationId, ""),
      toolLoopId: normalizeString(obligation.toolLoopId, ""),
      stepId: normalizeString(obligation.stepId, ""),
      stepOrdinal: Number(obligation.stepOrdinal || 1),
      status: normalizeString(obligation.status, ""),
      authorityState: normalizeString(obligation.authorityState, ""),
      name: normalizeString(obligation.name, ""),
      namespace: normalizeString(obligation.namespace, ""),
      providerCallType: normalizeString(obligation.providerCallType || obligation.toolType, ""),
      callIdDigest: sha256(obligation.callId || ""),
      argumentsDigest: sha256(obligation.argumentsText || ""),
      resultDigest: sha256(stableStringify(obligation.result || {})),
      continuationDigest: sha256(stableStringify(obligation.continuationRequest || {})),
    })),
  }));
}

function obligationItemText(obligation = {}, unsupportedReason = "") {
  const relPath = normalizeString(obligation.approvedRead?.relPath || obligation.result?.relPath, "");
  const parts = [
    `tool=${normalizeString(obligation.name, "read_file")}`,
    `status=${normalizeString(obligation.status, "unknown")}`,
    `providerCallType=${normalizeString(obligation.providerCallType || obligation.toolType, "unknown")}`,
  ];
  if (relPath) parts.push(`path=${relPath}`);
  if (unsupportedReason) parts.push(`unsupported=${unsupportedReason}`);
  if (isPlainObject(obligation.result)) parts.push(`result=${normalizeString(obligation.result.resultClass, "recorded")}`);
  return parts.join(" ");
}

function buildDirectObligationsProjection({ session = {}, turn = {}, operationManifest = {}, nowMs = Date.now() } = {}) {
  const obligations = Array.isArray(turn.unresolvedObligations) ? turn.unresolvedObligations : [];
  const providerToolCalls = obligations.filter((obligation) => {
    const status = normalizeString(obligation.status, "");
    return status !== "declined" && status !== "canceled" && status !== "continuation_sent";
  });
  const multipleProviderToolCalls = providerToolCalls.length > 1;
  const sourceDigest = obligationSourceDigest({
    turn,
    obligations,
    operationLedgerHeadDigest: normalizeString(operationManifest.hashChainHead || operationManifest.ledgerDigest, ""),
  });
  const projectionId = `direct_obligations_${sha256(`${turn.sessionId}:${turn.turnId}:${sourceDigest}`).slice(0, 24)}`;
  const createdAt = nowIso(nowMs);
  const items = obligations.map((obligation, index) => {
    const unsupportedReason = obligationUnsupportedReason(obligation, { multipleProviderToolCalls });
    const { providerCallType, providerOutputType } = providerOutputTypeFor(obligation);
    const text = obligationItemText(obligation, unsupportedReason);
    const findings = scanTextForRawExposure(text).filter((finding) => finding.severity === "block");
    const stableSourceItemKey = `obligation_${safeKey(turn.turnId)}_${safeKey(obligation.obligationId)}`;
    return {
      itemId: projectionItemId(projectionId, index + 1),
      stableSourceItemKey,
      projectionId,
      ordinal: index + 1,
      threadId: normalizeString(session.sessionId || turn.sessionId, ""),
      turnId: normalizeString(turn.turnId, ""),
      itemKind: "tool_obligation",
      role: "tool",
      phase: "obligation",
      status: normalizeString(obligation.status, "unknown"),
      text,
      textDigest: sha256(text),
      textTruncated: false,
      itemValidity: {
        usableForContinuation: !unsupportedReason && isPlainObject(obligation.result),
        unsupportedReason,
        blocksProjection: findings.length > 0,
      },
      actionHints: {
        approvalLikelyAvailable: normalizeString(obligation.status, "") === "waiting" && !unsupportedReason,
        continuationLikelyAvailable: !unsupportedReason && isPlainObject(obligation.result),
        controllerStatusRef: normalizeString(obligation.obligationId, ""),
        authoritative: false,
      },
      providerCallType,
      providerOutputType,
      callIdDigest: sha256(obligation.callId || ""),
      namespaceAccepted: !normalizeString(obligation.namespace, ""),
      rawExposureFindings: findings.map((finding) => finding.reason),
      sourceRef: {
        sessionId: normalizeString(session.sessionId || turn.sessionId, ""),
        turnId: normalizeString(turn.turnId, ""),
        sourceArtifactKind: "direct_turn_tool_obligation",
        sourceDigest: sha256(stableStringify({
          obligationId: obligation.obligationId,
          status: obligation.status,
          result: obligation.result || null,
          continuationRequest: obligation.continuationRequest || null,
        })),
      },
      obligation: {
        obligationId: normalizeString(obligation.obligationId, ""),
        sourceItemId: normalizeString(obligation.sourceItemId, ""),
        toolName: normalizeString(obligation.name, ""),
        status: normalizeString(obligation.status, ""),
        authorityState: normalizeString(obligation.authorityState, ""),
        resultId: normalizeString(obligation.result?.resultId, ""),
        continuationId: normalizeString(obligation.continuationRequest?.continuationId, ""),
        resultClass: normalizeString(obligation.result?.resultClass, ""),
      },
      flags: {
        rendererSafe: true,
        contextSafe: true,
        executable: false,
        rawPathExposed: false,
        rawCredentialsExposed: false,
        rawBackendFrameExposed: false,
      },
    };
  });
  const projectionLevelBlocked = items.some((item) => item.itemValidity?.blocksProjection === true);
  const projection = {
    projectionId,
    projectId: normalizeString(session.projectId, "unknown_project"),
    threadId: normalizeString(session.sessionId || turn.sessionId, ""),
    projectionKind: DIRECT_OBLIGATIONS_PROJECTION_KIND,
    projectionVersion: DIRECT_OBLIGATIONS_PROJECTION_VERSION,
    builderVersion: DIRECT_OBLIGATIONS_BUILDER_VERSION,
    policyId: DIRECT_OBLIGATIONS_POLICY_ID,
    status: projectionLevelBlocked ? "blocked" : "valid",
    staleReason: "",
    securityReason: projectionLevelBlocked ? "raw_exposure" : "",
    unsafeForRenderer: projectionLevelBlocked,
    unsafeForContextBuild: projectionLevelBlocked,
    createdAt,
    source: {
      sourceDigest,
      sessionId: normalizeString(session.sessionId || turn.sessionId, ""),
      turnId: normalizeString(turn.turnId, ""),
      operationLedgerHeadDigest: normalizeString(operationManifest.hashChainHead || operationManifest.ledgerDigest, ""),
      multipleProviderToolCalls,
    },
    safety: {
      rendererSafe: !projectionLevelBlocked,
      contextSafe: !projectionLevelBlocked,
      rawPathExposed: false,
      rawCredentialsExposed: false,
      rawBackendFrameExposed: false,
      unsupportedItemsBlockProjection: false,
    },
    caps: {
      truncated: false,
      omittedCounts: {},
    },
    continuity: {
      sourceClass: "direct-native",
      composer: {
        projectionHint: "obligation-status-only",
        enabledByProjection: false,
        authoritative: false,
        controlAuthority: "runtime-status",
      },
    },
    lifecycle: { state: "active", operationIds: [], rendererListVisible: true },
    integrity: { projectionDigest: "", algorithm: "sha256" },
  };
  projection.integrity.projectionDigest = sha256(stableStringify({
    projection: { ...projection, integrity: { projectionDigest: "", algorithm: "sha256" } },
    items: items.map((item) => ({
      key: item.stableSourceItemKey,
      status: item.status,
      validity: item.itemValidity,
      textDigest: item.textDigest,
    })),
  }));
  projection.projectionDigest = projection.integrity.projectionDigest;
  return { projection, items, sourceDigest };
}

function buildToolContinuationContextProjection({
  session = {},
  turn = {},
  obligationProjection = {},
  obligationItem = {},
  obligation = {},
  continuationRequest = {},
  previousResponseId = "",
  nowMs = Date.now(),
} = {}) {
  const itemValidity = isPlainObject(obligationItem.itemValidity) ? obligationItem.itemValidity : {};
  if (itemValidity.usableForContinuation !== true) {
    const error = new Error("Tool continuation context requires a usable recorded read-only obligation.");
    error.code = itemValidity.unsupportedReason || "tool_result_not_recorded";
    throw error;
  }
  const result = isPlainObject(obligation.result) ? obligation.result : {};
  const toolResult = isPlainObject(continuationRequest.toolResult) ? continuationRequest.toolResult : {};
  const { providerCallType, providerOutputType } = providerOutputTypeFor(obligation);
  const sourceDigest = sha256(stableStringify({
    schema: "tool_continuation_context_source@1",
    threadId: normalizeString(session.sessionId || turn.sessionId, ""),
    turnId: normalizeString(turn.turnId, ""),
    obligationId: normalizeString(obligation.obligationId, ""),
    toolLoopId: normalizeString(obligation.toolLoopId, ""),
    stepId: normalizeString(obligation.stepId, ""),
    stepOrdinal: Number(obligation.stepOrdinal || 1),
    obligationProjectionId: normalizeString(obligationProjection.projectionId, ""),
    obligationItemKey: normalizeString(obligationItem.stableSourceItemKey, ""),
    resultId: normalizeString(result.resultId, ""),
    resultDigest: sha256(stableStringify(result)),
    providerCallType,
    providerOutputType,
    providerCallIdDigest: sha256(obligation.callId || toolResult.callId || ""),
    previousResponseIdDigest: sha256(previousResponseId),
    toolCallShapeHash: sha256(stableStringify({
      providerCallType,
      providerOutputType,
      toolName: normalizeString(obligation.name, ""),
      namespace: normalizeString(obligation.namespace, ""),
    })),
    toolResultShapeHash: sha256(stableStringify({
      schema: result.schema,
      resultClass: result.resultClass,
      providerOutputType,
      truncated: result.truncated === true,
      binary: result.binary === true,
      redactionStatus: result.toolResultRedaction?.status || "",
    })),
    continuationRequestShapeHash: sha256(stableStringify({
      schema: continuationRequest.schema,
      outputType: providerOutputType,
      previousResponseId: Boolean(previousResponseId),
      store: false,
      tools: false,
    })),
  }));
  const projectionId = `tool_context_${sha256(`${turn.sessionId}:${turn.turnId}:${obligation.obligationId}:${sourceDigest}`).slice(0, 24)}`;
  const text = normalizeString(result.providerOutputText, result.textPreview || result.summary);
  const items = [
    {
      itemId: projectionItemId(projectionId, 1),
      stableSourceItemKey: `tool_result_${safeKey(turn.turnId)}_${safeKey(obligation.obligationId)}`,
      projectionId,
      ordinal: 1,
      threadId: normalizeString(session.sessionId || turn.sessionId, ""),
      turnId: normalizeString(turn.turnId, ""),
      itemKind: "tool_result_evidence",
      role: "tool",
      phase: "tool_continuation_context",
      status: "complete",
      authority: "tool-result-evidence",
      quotedEvidence: true,
      text,
      textDigest: sha256(text),
      textTruncated: result.truncated === true,
      sourceRef: {
        sessionId: normalizeString(session.sessionId || turn.sessionId, ""),
        turnId: normalizeString(turn.turnId, ""),
        sourceArtifactKind: "direct_readonly_tool_result",
        sourceProjectionId: normalizeString(obligationProjection.projectionId, ""),
        sourceDigest,
      },
      continuation: {
        continuationId: normalizeString(continuationRequest.continuationId, ""),
        obligationId: normalizeString(obligation.obligationId, ""),
        toolLoopId: normalizeString(obligation.toolLoopId || continuationRequest.toolLoop?.toolLoopId, ""),
        stepId: normalizeString(obligation.stepId || continuationRequest.toolLoop?.stepId, ""),
        stepOrdinal: Number(obligation.stepOrdinal || continuationRequest.toolLoop?.stepOrdinal || 1),
        providerCallType,
        providerOutputType,
        previousResponseIdDigest: sha256(previousResponseId),
      },
      flags: {
        rendererSafe: false,
        contextSafe: true,
        executable: false,
        rawPathExposed: false,
        rawCredentialsExposed: false,
        rawBackendFrameExposed: false,
      },
    },
  ];
  const projection = {
    projectionId,
    projectId: normalizeString(session.projectId, "unknown_project"),
    threadId: normalizeString(session.sessionId || turn.sessionId, ""),
    projectionKind: TOOL_CONTINUATION_CONTEXT_PROJECTION_KIND,
    projectionVersion: TOOL_CONTINUATION_CONTEXT_PROJECTION_VERSION,
    builderVersion: TOOL_CONTINUATION_CONTEXT_BUILDER_VERSION,
    policyId: TOOL_CONTINUATION_CONTEXT_POLICY_ID,
    status: "valid",
    staleReason: "",
    securityReason: "",
    unsafeForRenderer: true,
    unsafeForContextBuild: false,
    createdAt: nowIso(nowMs),
    source: {
      sourceDigest,
      sourceProjectionIds: [normalizeString(obligationProjection.projectionId, "")],
      sessionId: normalizeString(session.sessionId || turn.sessionId, ""),
      turnId: normalizeString(turn.turnId, ""),
      obligationId: normalizeString(obligation.obligationId, ""),
      continuationId: normalizeString(continuationRequest.continuationId, ""),
      providerCallType,
      providerOutputType,
    },
    safety: {
      contextSafe: true,
      rendererSafe: false,
      rawPathExposed: false,
      rawCredentialsExposed: false,
      rawBackendFrameExposed: false,
      toolResultIsInstructionAuthority: false,
    },
    caps: {
      truncated: result.truncated === true,
      omittedCounts: result.truncated === true ? { tool_result_truncated: 1 } : {},
    },
    continuity: {
      previousResponseIdUsed: true,
      importedContinuityHandleUsed: false,
      continuityPolicy: "native_parent_turn_previous_response_id",
    },
    lifecycle: { state: "active", operationIds: [], rendererListVisible: false },
    integrity: { projectionDigest: "", algorithm: "sha256" },
  };
  projection.integrity.projectionDigest = sha256(stableStringify({
    projection: { ...projection, integrity: { projectionDigest: "", algorithm: "sha256" } },
    items: items.map((item) => ({
      key: item.stableSourceItemKey,
      textDigest: item.textDigest,
      authority: item.authority,
    })),
  }));
  projection.projectionDigest = projection.integrity.projectionDigest;
  return { projection, items, sourceDigest };
}

module.exports = {
  DIRECT_OBLIGATIONS_BUILDER_VERSION,
  DIRECT_OBLIGATIONS_POLICY_ID,
  DIRECT_OBLIGATIONS_PROJECTION_KIND,
  DIRECT_OBLIGATIONS_PROJECTION_VERSION,
  TOOL_CONTINUATION_CONTEXT_BUILDER_VERSION,
  TOOL_CONTINUATION_CONTEXT_POLICY_ID,
  TOOL_CONTINUATION_CONTEXT_PROJECTION_KIND,
  TOOL_CONTINUATION_CONTEXT_PROJECTION_VERSION,
  buildDirectObligationsProjection,
  buildToolContinuationContextProjection,
};
