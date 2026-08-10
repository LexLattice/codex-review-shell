"use strict";

const crypto = require("node:crypto");
const { EventEmitter } = require("node:events");
const {
  buildImplementationToolInitialRequest,
  buildTextOnlyProbeRequest,
  DEFAULT_IMPLEMENTATION_TOOL_INSTRUCTIONS,
  DEFAULT_REPAIR_LOOP_CONTINUATION_INSTRUCTIONS,
  DEFAULT_TOOL_CONTINUATION_INSTRUCTIONS,
  requestShapeForDiagnostic,
  runImplementationToolInitialProbe,
  runPersistedReadOnlyToolContinuation,
  runReadOnlyToolContinuationProbe,
  runTextOnlyDirectProbe,
  terminalStateFromNormalizedEvents,
} = require("../transport/codex-responses-transport");
const {
  composeDirectToolBundle,
} = require("../bridge/role-lane-tool-bundle-composer");
const {
  buildContextRemainingResultEnvelope,
  buildDirectFirstToolCallGate,
  buildDirectFirstToolSlice,
  buildHumanDecisionAnswerResultEnvelope,
  buildRequestUserInputResultEnvelope,
  buildUpdatePlanResultEnvelope,
} = require("../headless/first-tool-slice");
const {
  DIRECT_IMPORT_CHECKPOINT_REQUEST_SHAPE,
  assistantTextFromNormalizedEvents,
  checkpointTerminalFromEvents,
} = require("../import/checkpoint-continuation");
const { toolTranscriptItemFromObligation } = require("../session/session-store");
const {
  APPLY_PATCH_TOOL_NAMES,
  MAX_PATCH_APPROVAL_CARD_CHARS,
  MAX_PATCH_TEXT_CHARS,
  approvePatchApplyObligation,
  buildPatchApplyContinuationRequest,
  decidePatchApplyObligation,
  executeApprovedPatchApplyObligation,
  planPatchApplyObligation,
} = require("../tools/patch-apply-authority");
const {
  RUN_COMMAND_TOOL_NAMES,
  approveCommandExecutionObligation,
  buildCommandExecutionContinuationRequest,
  decideCommandExecutionObligation,
  executeApprovedCommandExecutionObligation,
  planCommandExecutionObligation,
} = require("../tools/command-execution-authority");
const {
  approveReadOnlyToolObligation,
  buildReadOnlyToolContinuationRequest,
  canonicalToolLoopId,
  cancelReadOnlyToolObligation,
  declineReadOnlyToolObligation,
  executeApprovedReadOnlyToolObligation,
  MAX_READONLY_TOOL_LOOP_STEPS,
} = require("../tools/read-only-authority");
const { normalizeCodexBinding } = require("../runtime/runtime-status");
const {
  buildAgentGraph,
  buildWorkerGraphAlignment,
  validateWorkerGraphAlignment,
} = require("../agents/observability");
const {
  createDirectLiveSubAgentToolSurface,
} = require("../agents/live-tool-surface");
const { buildDirectThreadDeckProjection } = require("../thread/thread-deck");
const {
  assertDirectAttachmentCapabilityProjectionSafe,
  assertDirectAttachmentSubmitPacketSafe,
  buildDirectAttachmentCapabilityProjection,
  buildDirectAttachmentProviderPrompt,
  buildDirectAttachmentSubmitPacket,
} = require("../attachments/capability");
const {
  buildDirectWorkerStartResult,
  buildDirectWorkerStartTransition,
  validateDirectWorkerStartResult,
  validateDirectWorkerStartTransition,
} = require("../bridge/worker-start");
const {
  buildExternalDiscoveryResultEnvelope,
  buildExternalDiscoveryToolCallGate,
  buildExternalToolResidentDeclaration,
} = require("../external/external-discovery-tools");
const {
  buildMcpResourceReadEnvelope,
} = require("../external/mcp-resource-read-envelope");

const DIRECT_LIVE_TEXT_SURFACE_TRANSPORT = "direct-live-text";
const DIRECT_FORK_PREVIEW_START_REQUEST_SHAPE = "direct_fork_preview_start_live_text@1";
const DIRECT_MERGE_PREVIEW_START_REQUEST_SHAPE = "direct_merge_preview_start_live_text@1";
const DIRECT_PRUNE_PREVIEW_START_REQUEST_SHAPE = "direct_prune_preview_start_live_text@1";
const ACTIVE_TURN_STATES = new Set([
  "created",
  "request_built",
  "streaming",
  "tool_waiting",
  "authority_waiting",
  "continuation_ready",
  "continuation_sent",
  "streaming_continuation",
]);
const TERMINAL_TURN_STATES = new Set([
  "completed",
  "failed",
  "aborted",
  "tool_call_blocked_text_only",
  "transport_handoff_unknown",
  "response_incomplete",
  "content_filter_terminal",
  "max_output_terminal",
  "empty_output_terminal",
]);
const SAFE_TEXT_ONLY_FOLLOWUP_PREVIOUS_STATES = new Set(["completed"]);
const BLOCKED_WORK_THREAD_LIFECYCLE_STATES = new Set(["archived", "stale"]);
const DEFAULT_MAX_PROMPT_CHARS = 64_000;
const DEFAULT_MAX_ASSISTANT_CHARS = 256_000;
const DEFAULT_READONLY_WORKSPACE_TIMEOUT_MS = 30_000;
const DEFAULT_TOOL_DECISION_CACHE_LIMIT = 512;
const SAFE_RESIDENT_UTILITY_TOOL_NAMES = Object.freeze([
  "get_context_remaining",
  "update_plan",
  "request_user_input",
]);
const SAFE_RESIDENT_UTILITY_TOOL_SET = new Set(SAFE_RESIDENT_UTILITY_TOOL_NAMES);
const READ_ONLY_SUB_AGENT_STATUS_TOOL_NAMES = Object.freeze([
  "list_agents",
  "inspect_agent",
]);
const READ_ONLY_SUB_AGENT_STATUS_TOOL_SET = new Set(READ_ONLY_SUB_AGENT_STATUS_TOOL_NAMES);
const NATIVE_SUB_AGENT_RUNTIME_TOOL_NAMES = Object.freeze([
  "spawn_agent",
  "wait_agent",
]);
const NATIVE_SUB_AGENT_RUNTIME_TOOL_SET = new Set(NATIVE_SUB_AGENT_RUNTIME_TOOL_NAMES);
const EXTERNAL_DISCOVERY_TOOL_NAMES = Object.freeze([
  "tool_search",
  "list_mcp_resources",
  "list_mcp_resource_templates",
]);
const EXTERNAL_READ_TOOL_NAMES = Object.freeze([
  "read_mcp_resource",
]);
const EXTERNAL_PROMOTED_TOOL_NAMES = Object.freeze([
  ...EXTERNAL_DISCOVERY_TOOL_NAMES,
  ...EXTERNAL_READ_TOOL_NAMES,
]);
const EXTERNAL_PROMOTED_TOOL_SET = new Set(EXTERNAL_PROMOTED_TOOL_NAMES);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizeDirectSurfaceRequestError(error) {
  const message = normalizeString(error?.message || error, "");
  const code = normalizeString(error?.code, "");
  const normalized = `${code} ${message}`.toLowerCase().replace(/[^a-z0-9_ -]+/g, " ").trim();
  if (
    normalized === "expired" ||
    normalized.startsWith("direct_auth_expired") ||
    normalized.includes(" direct_auth_expired") ||
    normalized.includes("invalid_grant") ||
    normalized.includes("refresh token expired") ||
    normalized.includes("token expired")
  ) {
    const wrapped = new Error("Direct auth expired. Sign in again before starting a direct Codex turn.");
    wrapped.code = "direct_auth_expired";
    wrapped.cause = error;
    return wrapped;
  }
  return error;
}

function repairLoopContinuationInstructions(specificInstructions = "") {
  return [
    normalizeString(specificInstructions, ""),
    DEFAULT_REPAIR_LOOP_CONTINUATION_INSTRUCTIONS,
  ].filter(Boolean).join("\n\n");
}

function directWorkThreadContextCarrier(...sources) {
  const carrier = {
    workThread: null,
    workThreadId: "",
    workThreadBinding: null,
    authorityBoundary: null,
    openObligations: [],
    bridgeInformationRefs: [],
  };
  const candidates = [];
  for (const source of sources) {
    if (!isPlainObject(source)) continue;
    if (isPlainObject(source.workThreadContext)) candidates.push(source.workThreadContext);
    candidates.push(source);
  }
  for (const source of candidates) {
    if (!carrier.workThread && isPlainObject(source.workThread)) carrier.workThread = source.workThread;
    if (!carrier.workThreadBinding && isPlainObject(source.workThreadBinding)) carrier.workThreadBinding = source.workThreadBinding;
    if (!carrier.authorityBoundary && isPlainObject(source.authorityBoundary)) carrier.authorityBoundary = source.authorityBoundary;
    if (!carrier.workThreadId) carrier.workThreadId = normalizeString(source.workThreadId, "");
    if (!carrier.openObligations.length && Array.isArray(source.openObligations)) carrier.openObligations = source.openObligations;
    if (!carrier.bridgeInformationRefs.length && Array.isArray(source.bridgeInformationRefs)) carrier.bridgeInformationRefs = source.bridgeInformationRefs;
  }
  return carrier;
}

function isRoutableWorkThreadForProject(workThread = {}, projectId = "") {
  if (!workThread) return false;
  const normalizedProjectId = normalizeString(projectId, "");
  const normalizedWorkThreadProjectId = normalizeString(workThread.projectId, "");
  const lifecycleState = normalizeString(workThread.lifecycleState, "unknown");
  return Boolean(
    workThread &&
    normalizedProjectId &&
    normalizedWorkThreadProjectId &&
    normalizedWorkThreadProjectId === normalizedProjectId &&
    !BLOCKED_WORK_THREAD_LIFECYCLE_STATES.has(lifecycleState),
  );
}

function userPromptTextFromTurn(turn = {}) {
  const input = Array.isArray(turn.input) ? turn.input : [];
  for (const item of input) {
    if (normalizeString(item?.role, "") !== "user") continue;
    if (typeof item.text === "string" && item.text.trim()) return item.text.trim();
    if (Array.isArray(item.content)) {
      const text = item.content
        .map((content) => typeof content?.text === "string" ? content.text : "")
        .filter(Boolean)
        .join("\n")
        .trim();
      if (text) return text;
    }
  }
  return "";
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
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function nowSeconds() {
  return Date.now() / 1000;
}

function boundedPositiveInteger(value, fallback, min = 1, max = 10_000) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(number)));
}

function derivedPreviewForkStartRequestShapeClassForKind(sourcePreviewKind) {
  return normalizeString(sourcePreviewKind, "") === "merge_preview"
    ? DIRECT_MERGE_PREVIEW_START_REQUEST_SHAPE
    : DIRECT_PRUNE_PREVIEW_START_REQUEST_SHAPE;
}

function firstForkTurnTerminalKind(result = {}, assistantText = "", unsupportedTool = false) {
  if (unsupportedTool) return "tool_call_unsupported";
  if (!assistantText && result.terminal?.state === "completed") return "completed_empty_output";
  const terminal = isPlainObject(result.terminal) ? result.terminal : {};
  const terminalCode = normalizeString(terminal.error?.code || result.error?.code, "");
  if (terminalCode === "response_incomplete") return "response_incomplete";
  if (terminalCode === "content_filter" || terminalCode === "content_filter_terminal") return "content_filter_terminal";
  if (terminalCode === "max_output" || terminalCode === "max_output_terminal") return "max_output_terminal";
  if (terminalCode === "empty_output" || terminalCode === "empty_output_terminal") return "completed_empty_output";
  if (terminalCode === "stream_interrupted") return "stream_interrupted";
  if (terminalCode === "transport_handoff_unknown") return "transport_handoff_unknown";
  const state = normalizeString(terminal.state, "");
  if (state === "response_incomplete" || state === "stream_interrupted" || state === "transport_handoff_unknown") return state;
  if (state === "content_filter_terminal" || state === "max_output_terminal" || state === "empty_output_terminal") return state;
  return result.ok ? "completed_with_assistant_text" : "provider_failed";
}

function firstForkTurnTerminal(result = {}, assistantText = "", unsupportedTool = false, label = "Fork start") {
  const terminalKind = firstForkTurnTerminalKind(result, assistantText, unsupportedTool);
  if (terminalKind === "tool_call_unsupported") {
    return {
      state: "failed",
      error: { code: "fresh_fork_first_turn_tool_call_unsupported", message: `${label} does not support provider tool calls.` },
      terminalKind,
    };
  }
  if (terminalKind === "completed_empty_output") {
    return {
      state: "failed",
      error: { code: "completed_empty_output", message: `${label} completed without assistant text.` },
      terminalKind,
    };
  }
  return {
    ...(result.terminal || { state: result.ok ? "completed" : "failed", error: result.error || null }),
    terminalKind,
  };
}

function toolHistoryOperationType(toolName) {
  const tool = normalizeString(toolName, "");
  if (tool === "apply_patch") return "apply_patch_tool_result";
  if (tool === "run_command") return "run_command_tool_result";
  return "read_file_tool_result";
}

function toolHistorySummary(toolName, result = {}) {
  const tool = normalizeString(toolName, "tool");
  const status = normalizeString(result.status, "recorded");
  if (tool === "apply_patch") return `apply_patch ${status}`;
  if (tool === "run_command") return `run_command ${status}`;
  return `read_file ${status}`;
}

function toolHistoryEffects(result = {}, continuation = {}) {
  const effects = [{
    effectKind: "tool_approval_recorded",
    targetKind: "tool_obligation",
    targetId: normalizeString(result.obligationId, ""),
    rendererSafeSummary: "tool approval recorded",
  }, {
    effectKind: "tool_result_recorded",
    targetKind: "tool_result",
    targetId: normalizeString(result.resultId, ""),
    rendererSafeSummary: "tool result recorded",
  }];
  const workspaceEffectSummaryId = normalizeString(result.workspaceEffectSummaryId, "");
  if (workspaceEffectSummaryId) {
    effects.push({
      effectKind: "workspace_effect_summary_recorded",
      targetKind: "workspace_effect_summary",
      targetId: workspaceEffectSummaryId,
      rendererSafeSummary: "workspace effect summary recorded",
    });
  }
  const continuationId = normalizeString(continuation.continuationId || continuation.continuation?.continuationId, "");
  if (continuationId) {
    effects.push({
      effectKind: "provider_continuation_recorded",
      targetKind: "provider_continuation",
      targetId: continuationId,
      rendererSafeSummary: "provider continuation recorded",
    });
  }
  return effects.filter((effect) => effect.targetId);
}

function workspaceEffectHistoryResult(result = {}, toolName = "") {
  const summary = isPlainObject(result.workspaceEffectSummary) ? result.workspaceEffectSummary : {};
  const providerVisibility = isPlainObject(summary.providerVisibility) ? summary.providerVisibility : {};
  return {
    status: "committed",
    rendererSafeSummary: "workspace effect summary recorded",
    tool: normalizeString(toolName, ""),
    resultStatus: normalizeString(result.status, ""),
    resultClass: normalizeString(result.resultClass, ""),
    workspaceEffectSummaryId: normalizeString(result.workspaceEffectSummaryId || summary.effectSummaryId, ""),
    changedPathCount: Number(summary.changedPathCount || result.workspaceEffects?.changedPathCount || 0) || 0,
    providerVisibility: normalizeString(providerVisibility.providerVisibilityCompleteness, ""),
    providerSawChangedFileContents: providerVisibility.providerSawChangedFileContents === true,
    rawProviderPayloadIncluded: false,
    rawWorkspacePathIncluded: false,
    rawToolOutputIncluded: false,
  };
}

function maybeInjectToolFaultAfterHistory(toolName) {
  if (process.env.CODEX_DIRECT_TEST_TOOL_FAULT_INJECTION !== "after_history_before_continuation") return;
  const expectedTool = normalizeString(process.env.CODEX_DIRECT_TEST_TOOL_FAULT_TOOL, "");
  const tool = normalizeString(toolName, "");
  if (expectedTool && expectedTool !== tool) return;
  const exitCode = Number(process.env.CODEX_DIRECT_TEST_TOOL_FAULT_EXIT_CODE || 87);
  process.stderr.write(`[direct-test-fault] after_history_before_continuation:${tool}\n`);
  process.exit(Number.isFinite(exitCode) && exitCode > 0 ? exitCode : 87);
}

function firstTextInput(input) {
  const entries = Array.isArray(input) ? input : [];
  for (const entry of entries) {
    if (typeof entry?.text === "string" && entry.text.trim()) return entry.text.trim();
  }
  return "";
}

function workspaceDisplayPath(project = {}) {
  const workspace = isPlainObject(project.workspace) ? project.workspace : {};
  if (workspace.kind === "wsl") return normalizeString(workspace.linuxPath, "");
  if (workspace.kind === "local") return normalizeString(workspace.localPath, "");
  return normalizeString(project.repoPath, "");
}

function modelEntries(profileDoc = {}) {
  const models = profileDoc.profile?.ontology?.models;
  return Array.isArray(models) ? models.filter((model) => isPlainObject(model) && model.id) : [];
}

function modelEvidenceState(status) {
  if (status === "accepted") return "accepted";
  if (status === "probed" || status === "runtime_probed") return "runtime_probed";
  if (status === "rejected") return "rejected";
  if (status === "observed" || status === "unstable") return "candidate";
  return "unknown";
}

function modelEvidenceFor(profileDoc = {}, requestedModel = "") {
  const entries = modelEntries(profileDoc);
  const requested = normalizeString(requestedModel, "");
  const entry = (requested ? entries.find((model) => model.id === requested) : null) ||
    entries.find((model) => ["accepted", "probed", "runtime_probed"].includes(model.status)) ||
    entries.find((model) => model.status !== "rejected") ||
    null;
  const state = modelEvidenceState(entry?.status);
  return {
    model: normalizeString(entry?.id, requested || "gpt-5.4"),
    modelSource: "odeu-profile",
    modelEvidenceState: state,
    accepted: state === "accepted" || state === "runtime_probed",
    entry: entry || null,
  };
}

function readOnlyContinuationEvidenceFor(profileDoc = {}) {
  const shapes = profileDoc.profile?.ontology?.continuationShapes;
  const entries = Array.isArray(shapes) ? shapes : [];
  const entry = entries.find((shape) =>
    shape?.id === "continuation.tool_result" ||
    String(shape?.field || "").toLowerCase().includes("tool-result") ||
    String(shape?.field || "").toLowerCase().includes("tool result"));
  const state = modelEvidenceState(entry?.status);
  const accepted = state === "accepted" || state === "runtime_probed";
  return {
    accepted,
    status: accepted ? "ready" : "profile_required",
    capabilityId: normalizeString(entry?.id, "continuation.tool_result"),
    evidenceState: state,
    reason: accepted ? "" : "accepted_readonly_tool_continuation_required",
  };
}

function patchApplyContinuationEvidenceFor(profileDoc = {}) {
  const shapes = profileDoc.profile?.ontology?.continuationShapes;
  const entries = Array.isArray(shapes) ? shapes : [];
  const entry = entries.find((shape) =>
    shape?.id === "direct_patch_apply_continuation@1" ||
    String(shape?.field || "").toLowerCase().includes("patch-apply") ||
    String(shape?.field || "").toLowerCase().includes("patch apply") ||
    String(shape?.field || "").toLowerCase().includes("apply_patch"));
  const state = modelEvidenceState(entry?.status);
  const accepted = state === "accepted" || state === "runtime_probed";
  return {
    accepted,
    status: accepted ? "ready" : "profile_required",
    capabilityId: normalizeString(entry?.id, "direct_patch_apply_continuation@1"),
    evidenceState: state,
    reason: accepted ? "" : "accepted_patch_apply_continuation_required",
  };
}

function commandExecutionContinuationEvidenceFor(profileDoc = {}) {
  const shapes = profileDoc.profile?.ontology?.continuationShapes;
  const entries = Array.isArray(shapes) ? shapes : [];
  const entry = entries.find((shape) =>
    shape?.id === "direct_command_execution_continuation@1" ||
    String(shape?.field || "").toLowerCase().includes("command-execution") ||
    String(shape?.field || "").toLowerCase().includes("command execution") ||
    String(shape?.field || "").toLowerCase().includes("run_command"));
  const state = modelEvidenceState(entry?.status);
  const accepted = state === "accepted" || state === "runtime_probed";
  return {
    accepted,
    status: accepted ? "ready" : "profile_required",
    capabilityId: normalizeString(entry?.id, "direct_command_execution_continuation@1"),
    evidenceState: state,
    reason: accepted ? "" : "accepted_command_execution_continuation_required",
  };
}

function capabilityIdsList(capabilityIds = []) {
  const values = Array.isArray(capabilityIds) ? capabilityIds : [capabilityIds];
  return values.map((item) => normalizeString(item, "")).filter(Boolean);
}

function capabilityStatusFromProof(proof = {}, capabilityId = "") {
  const rows = Array.isArray(proof.requiredCapabilities) ? proof.requiredCapabilities : [];
  return rows.find((row) => row?.capabilityId === capabilityId) || null;
}

function proofCapabilityReady(proof = {}, capabilityId = "") {
  const row = capabilityStatusFromProof(proof, capabilityId);
  return row?.status === "ready" && row?.evidenceState === "runtime_probed";
}

function proofCapabilitiesReady(proof = {}, capabilityIds = []) {
  const ids = capabilityIdsList(capabilityIds);
  return ids.length > 0 && ids.every((capabilityId) => proofCapabilityReady(proof, capabilityId));
}

function continuationStatusReady(evidence = {}) {
  return normalizeString(evidence?.status, "") === "ready";
}

function scopedProofApprovalReady(evidence = {}) {
  return continuationStatusReady(evidence) && evidence?.scopedProofAuthoritative === true;
}

function mergeScopedProofWithProfileEvidence(profileEvidence = {}, proof = {}, capabilityIds = "", missingReason = "") {
  const ids = capabilityIdsList(capabilityIds);
  const primaryCapabilityId = ids[0] || "";
  const rows = ids.map((capabilityId) => capabilityStatusFromProof(proof, capabilityId));
  if (proofCapabilitiesReady(proof, ids)) {
    const primaryRow = rows[0] || {};
    return {
      ...profileEvidence,
      accepted: true,
      status: "ready",
      evidenceState: "runtime_probed",
      scopedProofEvidenceId: normalizeString(primaryRow.evidenceId, ""),
      scopedProofEvidenceIds: rows.map((row) => normalizeString(row?.evidenceId, "")).filter(Boolean),
      scopedProofSourceCaseId: normalizeString(primaryRow.sourceCaseId, ""),
      scopedProofCapabilityId: primaryCapabilityId,
      scopedProofCapabilityIds: ids,
      scopedProofAuthoritative: true,
    };
  }
  const missingRow = rows.find((row) => row?.status !== "ready" || row?.evidenceState !== "runtime_probed") || null;
  return {
    ...profileEvidence,
    accepted: true,
    status: "ready",
    evidenceState: "local_declared",
    scopedProofEvidenceId: "",
    scopedProofEvidenceIds: [],
    scopedProofSourceCaseId: "",
    scopedProofCapabilityId: primaryCapabilityId,
    scopedProofCapabilityIds: ids,
    scopedProofAuthoritative: false,
    scopedProofMissingCapabilityIds: ids.filter((capabilityId) => !proofCapabilityReady(proof, capabilityId)),
    localImplementationToolDeclared: true,
    proofStatus: missingRow?.status === "expired" ? "evidence_expired" : "proof_required",
    proofEvidenceState: missingRow?.evidenceState || proof.evidenceState || "missing",
    proofReason: normalizeString(missingRow?.reason, "") || missingReason,
    reason: "",
  };
}

function sanitizeStatus(status = {}) {
  return {
    status: normalizeString(status.status, "unauthenticated"),
    accountId: normalizeString(status.accountId, ""),
    expiresAt: Number(status.expiresAt || 0),
    expiresInMs: Number(status.expiresInMs || 0),
    hasAccessToken: Boolean(status.hasAccessToken),
    hasRefreshToken: Boolean(status.hasRefreshToken),
    storageMode: normalizeString(status.storageMode, ""),
    source: normalizeString(status.source, ""),
    authSource: normalizeString(status.authSource || status.source, ""),
    rawTokensExposed: false,
  };
}

function buildDirectLiveTextCapabilities(status = {}) {
  const ready = status.status === "ready";
  const readOnlyToolReady = ready && status.readOnlyToolContinuation?.status === "ready";
  const patchApplyReady = ready && status.patchApplyContinuation?.status === "ready";
  const commandExecutionReady = ready && status.commandExecutionContinuation?.status === "ready";
  const patchApplyApprovalReady = ready && scopedProofApprovalReady(status.patchApplyContinuation);
  const commandExecutionApprovalReady = ready && scopedProofApprovalReady(status.commandExecutionContinuation);
  const toolMethods = [];
  if (readOnlyToolReady) toolMethods.push("direct/tool/readOnly/requestApproval");
  if (patchApplyReady) toolMethods.push("direct/tool/patchApply/requestApproval");
  if (commandExecutionReady) toolMethods.push("direct/tool/command/requestApproval");
  const attachmentCapability = buildDirectAttachmentCapabilityProjection({
    runtimeKind: DIRECT_LIVE_TEXT_SURFACE_TRANSPORT,
    status: ready ? "ready" : "blocked",
  });
  return {
    version: 1,
    status: ready ? "ready" : "blocked",
    generatedAt: nowIso(),
    coreRuntime: {
      canConnect: true,
      canInitialize: true,
      transport: DIRECT_LIVE_TEXT_SURFACE_TRANSPORT,
      transports: [DIRECT_LIVE_TEXT_SURFACE_TRANSPORT],
      schemaSource: "direct-live-text-controller",
    },
    account: {
      canRead: true,
      canStartLogin: false,
    },
    configRequirements: {
      canRead: true,
    },
    threads: {
      canStart: ready,
      canRead: true,
      canResume: false,
      canList: true,
      canFork: false,
      canPersistExtendedHistory: true,
    },
    turns: {
      canStart: ready,
      canSteer: false,
      canInterrupt: true,
      canOverrideModel: false,
      canOverrideReasoning: false,
      canUseOutputSchema: false,
    },
    authority: {
      commandApproval: commandExecutionApprovalReady,
      fileChangeApproval: patchApplyApprovalReady,
      permissionsApproval: false,
      approvalPolicies: [
        ...(readOnlyToolReady ? ["explicit-read-only-tool"] : []),
        ...(patchApplyApprovalReady ? ["explicit-patch-apply"] : []),
        ...(commandExecutionApprovalReady ? ["explicit-command-execution"] : []),
      ],
      sandboxModes: [],
      readOnlyToolApproval: readOnlyToolReady,
      patchApplyApproval: patchApplyApprovalReady,
      commandExecutionApproval: commandExecutionApprovalReady,
    },
    requests: {
      supportedServerMethods: toolMethods,
      unsupportedButHandledMethods: [],
      unknownRequestPolicy: "error-visible",
    },
    diagnostics: {
      runtime: DIRECT_LIVE_TEXT_SURFACE_TRANSPORT,
      source: "direct-live-text-controller",
      appServerRequired: false,
      toolsEnabled: readOnlyToolReady || patchApplyReady || commandExecutionReady,
      rawBackendFramesExposed: false,
    },
    attachments: attachmentCapability,
  };
}

function implementationInitialToolNames(status = {}, prompt = "") {
  const names = [];
  const lowerPrompt = normalizeString(prompt, "").toLowerCase();
  const readReady = status.readOnlyToolContinuation?.status === "ready";
  const patchReady = status.patchApplyContinuation?.status === "ready";
  const commandReady = status.commandExecutionContinuation?.status === "ready";
  const asksRead = lowerPrompt.includes("read_file");
  const asksPatch = lowerPrompt.includes("apply_patch");
  const asksCommand = lowerPrompt.includes("run_command");
  if (asksRead && readReady) names.push("read_file");
  if (!asksRead && asksPatch && patchReady) names.push("apply_patch");
  if (!asksRead && asksCommand && commandReady) names.push("run_command");
  if (names.length) return names;
  if (readReady) names.push("read_file");
  if (patchReady) names.push("apply_patch");
  if (commandReady) names.push("run_command");
  return names;
}

function safeResidentUtilityToolNames(status = {}) {
  const runtimeReady = status && normalizeString(status.status, "") === "ready";
  return runtimeReady ? [...SAFE_RESIDENT_UTILITY_TOOL_NAMES] : [];
}

function appendSafeResidentUtilities(toolNames = [], status = {}) {
  return [...new Set([
    ...(Array.isArray(toolNames) ? toolNames : []),
    ...safeResidentUtilityToolNames(status),
  ].map((name) => normalizeString(name, "")).filter(Boolean))];
}

function readOnlySubAgentStatusToolNames(status = {}) {
  const runtimeReady = status && normalizeString(status.status, "") === "ready";
  return runtimeReady ? [...READ_ONLY_SUB_AGENT_STATUS_TOOL_NAMES] : [];
}

function appendReadOnlySubAgentStatusTools(toolNames = [], status = {}) {
  return [...new Set([
    ...(Array.isArray(toolNames) ? toolNames : []),
    ...readOnlySubAgentStatusToolNames(status),
  ].map((name) => normalizeString(name, "")).filter(Boolean))];
}

function nativeSubAgentRuntimeToolNames(status = {}) {
  const runtimeReady = status && normalizeString(status.status, "") === "ready";
  return runtimeReady ? [...NATIVE_SUB_AGENT_RUNTIME_TOOL_NAMES] : [];
}

function appendNativeSubAgentRuntimeTools(toolNames = [], status = {}) {
  return [...new Set([
    ...(Array.isArray(toolNames) ? toolNames : []),
    ...nativeSubAgentRuntimeToolNames(status),
  ].map((name) => normalizeString(name, "")).filter(Boolean))];
}

function externalSourceIdentityReady(externalProfile = {}) {
  const servers = Array.isArray(externalProfile?.serverIdentities) ? externalProfile.serverIdentities : [];
  return servers.some((server) => (
    server?.enabledState === "enabled" &&
    server?.freshness === "fresh" &&
    !["unknown", "untrusted"].includes(normalizeString(server?.trustState, "unknown"))
  ));
}

function externalPromotedToolNames(status = {}) {
  const runtimeReady = status && normalizeString(status.status, "") === "ready";
  return runtimeReady && externalSourceIdentityReady(status.externalCapabilityProfile)
    ? [...EXTERNAL_PROMOTED_TOOL_NAMES]
    : [];
}

function appendExternalPromotedTools(toolNames = [], status = {}) {
  return [...new Set([
    ...(Array.isArray(toolNames) ? toolNames : []),
    ...externalPromotedToolNames(status),
  ].map((name) => normalizeString(name, "")).filter(Boolean))];
}

function providerHostedToolNames(status = {}) {
  const runtimeReady = status && normalizeString(status.status, "") === "ready";
  return runtimeReady ? ["web_search", "image_generation"] : [];
}

function appendProviderHostedTools(toolNames = [], status = {}) {
  return [...new Set([
    ...(Array.isArray(toolNames) ? toolNames : []),
    ...providerHostedToolNames(status),
  ].map((name) => normalizeString(name, "")).filter(Boolean))];
}

function isSafeResidentUtilityToolName(toolName = "") {
  return SAFE_RESIDENT_UTILITY_TOOL_SET.has(normalizeString(toolName, ""));
}

function isReadOnlySubAgentStatusToolName(toolName = "") {
  return READ_ONLY_SUB_AGENT_STATUS_TOOL_SET.has(normalizeString(toolName, ""));
}

function isNativeSubAgentRuntimeToolName(toolName = "") {
  return NATIVE_SUB_AGENT_RUNTIME_TOOL_SET.has(normalizeString(toolName, ""));
}

function directParentContextMessages(session = {}) {
  const messages = [];
  for (const turn of Array.isArray(session.messages) ? session.messages : []) {
    const turnId = normalizeString(turn?.id || turn?.turnId, "");
    for (const item of Array.isArray(turn?.items) ? turn.items : []) {
      if (item?.type === "userMessage") {
        const text = (Array.isArray(item.content) ? item.content : [])
          .map((entry) => normalizeString(entry?.text, ""))
          .filter(Boolean)
          .join("\n") || normalizeString(item.text, "");
        if (text) messages.push({ role: "user", text, turnId });
      } else if (item?.type === "agentMessage") {
        const text = normalizeString(item.text, "");
        if (text) messages.push({ role: "assistant", text, turnId });
      }
    }
  }
  return messages;
}

function isExternalPromotedToolName(toolName = "") {
  return EXTERNAL_PROMOTED_TOOL_SET.has(normalizeString(toolName, ""));
}

function parseToolArgumentsObject(obligation = {}) {
  try {
    const parsed = JSON.parse(normalizeString(obligation?.argumentsText, "{}"));
    return isPlainObject(parsed) ? parsed : {};
  } catch (_error) {
    return {};
  }
}

function safeResidentUtilityActivationRow(toolName, projectId = "") {
  const requestShapeByTool = {
    get_context_remaining: "context_status_or_control",
    update_plan: "plan_projection",
    request_user_input: "direct_human_decision_tool_packet@1",
  };
  const classByTool = {
    get_context_remaining: "session_control.get_context_remaining",
    update_plan: "session_control.update_plan",
    request_user_input: "human_decision.request_user_input",
  };
  const safeToolName = normalizeString(toolName, "");
  return {
    schema: "direct_tool_activation_row@1",
    activationRowId: `${safeToolName}_live_activation`,
    toolClassId: classByTool[safeToolName] || safeToolName,
    toolName: safeToolName,
    toolSchemaVersion: "direct_tool_class@1",
    state: "active",
    activationEffect: "allow",
    scope: { kind: "project_default", projectId: normalizeString(projectId, "project_direct") },
    promotionDecisionRef: {
      decisionId: `${safeToolName}_live_promotion`,
      decisionDigest: sha256(`safe-resident-utility:${safeToolName}`),
      decisionState: "promotable",
      evidenceClass: "real_provider_full_loop",
    },
    providerRequestShapeSupport: {
      requestShapeFamily: requestShapeByTool[safeToolName] || safeToolName,
      providerProfileId: "direct_live_provider_profile",
      modelId: "direct_live_model",
      declarationEligibleByRegistry: true,
    },
    localExecutorState: { authorityFamily: "safe_resident_utility" },
    authorityEnvelope: { authorityEnvelopeVersion: "authority_envelope@1" },
    recoveryReplayClassifier: { classifierId: "direct_recovery_replay_classifier@1" },
    contextResultEnvelopePolicy: { resultEnvelopeVersion: "tool_result_envelope@1" },
    blockerCodes: [],
    rowDigest: sha256(`safe-resident-utility-row:${safeToolName}`),
    rawPromptIncluded: false,
    rawResultIncluded: false,
    rawWorkspacePathIncluded: false,
    rawSecretIncluded: false,
  };
}

function buildSafeResidentUtilitySlice(toolName, projectId = "") {
  return buildDirectFirstToolSlice({
    activationRegistry: {
      schema: "direct_tool_activation_registry@1",
      registryId: `safe_resident_utility_registry_${normalizeString(toolName, "utility")}`,
      registryDigest: sha256(`safe-resident-utility-registry:${toolName}:${projectId}`),
      status: "passed",
      validationErrors: [],
      snapshot: { snapshotId: `safe_resident_utility_snapshot_${normalizeString(toolName, "utility")}` },
      rows: [safeResidentUtilityActivationRow(toolName, projectId)],
    },
  });
}

function assistantTextFromDirectEvents(normalizedEvents = []) {
  return (Array.isArray(normalizedEvents) ? normalizedEvents : [])
    .filter((event) => event?.type === "message_delta")
    .map((event) => normalizeString(event.text, ""))
    .join("");
}

function summarizeSubAgentStatusResult(toolName, result = {}) {
  const payload = isPlainObject(result?.result) ? result.result : {};
  if (toolName === "list_agents") {
    const projection = isPlainObject(payload.listProjection) ? payload.listProjection : {};
    return {
      kind: "list_agents_result",
      status: normalizeString(result?.status, "completed"),
      blockerCode: normalizeString(result?.blockerCode, ""),
      agentCount: Number(projection.rowCount || 0),
      activeCount: Number(projection.activeCount || 0),
      terminalCount: Number(projection.terminalCount || 0),
      agents: (Array.isArray(projection.rows) ? projection.rows : []).map((row) => ({
        agentId: normalizeString(row.agentThreadId, ""),
        label: normalizeString(row.displayLabel, ""),
        role: normalizeString(row.agentClassKind || row.role, ""),
        lifecycleState: normalizeString(row.lifecycleState || row.nodeState, ""),
        activityState: normalizeString(row.activityState || row.nodeState, ""),
        terminal: row.terminal === true,
        model: normalizeString(row.model, ""),
        reasoningEffort: normalizeString(row.reasoningEffort, ""),
      })),
      readOnly: true,
      canInterfere: false,
    };
  }
  const inspectPacket = isPlainObject(payload.inspectPacket) ? payload.inspectPacket : {};
  const agentNode = isPlainObject(inspectPacket.agent)
    ? inspectPacket.agent
    : isPlainObject(inspectPacket.agentNode) ? inspectPacket.agentNode : {};
  return {
    kind: "inspect_agent_result",
    status: normalizeString(result?.status, "completed"),
    blockerCode: normalizeString(result?.blockerCode, ""),
    agentId: normalizeString(agentNode.agentThreadId || inspectPacket.requestedAgentThreadId || payload.targetAgentId, ""),
    label: normalizeString(agentNode.displayLabel, ""),
    role: normalizeString(agentNode.agentClassKind || agentNode.role, ""),
    lifecycleState: normalizeString(agentNode.lifecycleState || agentNode.nodeState, ""),
    activityState: normalizeString(agentNode.activityState, ""),
    model: normalizeString(agentNode.model, ""),
    reasoningEffort: normalizeString(agentNode.reasoningEffort, ""),
    graphRevision: Number(result?.graphRevision || inspectPacket.graphRevision || 0),
    readOnly: true,
    canInterfere: false,
  };
}

function summarizeExternalDiscoveryResult(toolName, envelope = {}) {
  if (toolName === "read_mcp_resource") {
    return {
      kind: "read_mcp_resource_result",
      status: normalizeString(envelope.status, "blocked"),
      blockerCodes: Array.isArray(envelope.blockerCodes) ? envelope.blockerCodes : [],
      serverIdentityId: normalizeString(envelope.serverSelector?.serverIdentityId, ""),
      resourceDisplay: normalizeString(envelope.resourceDisplay, ""),
      contextAdmission: normalizeString(envelope.contextAdmission, "blocked"),
      mimeKind: normalizeString(envelope.mimeKind, "unknown"),
      contentHandling: normalizeString(envelope.contentHandling, ""),
      byteCount: Number(envelope.byteCount || 0),
      excerpt: normalizeString(envelope.payloadExcerpt, ""),
      rawResourceUriIncluded: false,
      rawResourcePayloadIncluded: false,
      dynamicMcpActionPerformed: false,
      pluginInstallPerformed: false,
      workspaceMutationStarted: false,
    };
  }
  return {
    kind: `${toolName}_result`,
    status: normalizeString(envelope.status, "blocked"),
    blockerCodes: Array.isArray(envelope.blockerCodes) ? envelope.blockerCodes : [],
    descriptorCount: Number(envelope.descriptorCount || 0),
    totalAvailableDescriptorCount: Number(envelope.totalAvailableDescriptorCount || 0),
    truncated: envelope.truncated === true,
    serverSelector: envelope.serverSelector ? {
      serverIdentityId: normalizeString(envelope.serverSelector.serverIdentityId, ""),
      selectorState: normalizeString(envelope.serverSelector.selectorState, ""),
      exactServerIdentityRequired: envelope.serverSelector.exactServerIdentityRequired === true,
      rawEndpointIncluded: false,
      rawCredentialIncluded: false,
    } : null,
    descriptors: (Array.isArray(envelope.descriptors) ? envelope.descriptors : []).map((descriptor) => ({
      descriptorId: normalizeString(descriptor.descriptorId, ""),
      sourceKind: normalizeString(descriptor.sourceKind, ""),
      displayName: normalizeString(descriptor.displayName, ""),
      serverIdentity: normalizeString(descriptor.serverIdentity, ""),
      permissionClass: normalizeString(descriptor.permissionClass, ""),
      enabledState: normalizeString(descriptor.enabledState, ""),
      deferredToolExposureStatus: normalizeString(descriptor.deferredToolExposureStatus, ""),
      resourceReadAllowed: false,
      dynamicToolCallAllowed: false,
      pluginInstallAllowed: false,
    })),
    rawResourceUriIncluded: false,
    rawExternalPayloadIncluded: false,
    dynamicMcpActionPerformed: false,
    pluginInstallPerformed: false,
    workspaceMutationStarted: false,
  };
}

function unavailableSubAgentStatusSurface(sessionId, project = {}) {
  const baseResult = (toolName, targetAgentId = "") => ({
    schema: "direct_live_sub_agent_tool_result@1",
    toolName,
    status: "blocked",
    blockerCode: "sub_agent_graph_evidence_unavailable",
    projectId: normalizeString(project?.id || project?.projectId || project?.name, "project_direct_live_sub_agents"),
    workThreadId: normalizeString(directWorkThreadContextCarrier(project).workThreadId, "work_thread_direct_live_sub_agents"),
    primaryThreadId: normalizeString(sessionId, "primary_direct_agent"),
    graphRevision: 0,
    providerTransportStarted: false,
    providerDeclarationStarted: false,
    workspaceMutationStarted: false,
    childTranscriptPromotionStarted: false,
    parentSelfBindingRespected: true,
    result: toolName === "list_agents"
      ? {
          listProjection: {
            schema: "direct_sub_agent_list_projection@1",
            rowCount: 0,
            activeCount: 0,
            terminalCount: 0,
            rows: [],
            unavailableReason: "sub_agent_graph_evidence_unavailable",
          },
        }
      : {
          targetAgentId,
          unavailableReason: "sub_agent_graph_evidence_unavailable",
        },
    rawPromptIncluded: false,
    rawTranscriptIncluded: false,
    rawProviderFrameIncluded: false,
    rawSecretIncluded: false,
    observedAt: nowIso(),
  });
  return {
    listAgents: () => baseResult("list_agents"),
    inspectAgent: (input = {}) => baseResult("inspect_agent", normalizeString(input.childAgentId || input.agentThreadId || input.targetAgentId, "")),
  };
}

function promptImpliesFileMutation(prompt) {
  const text = normalizeString(prompt, "").toLowerCase();
  return /\b(apply_patch|patch|edit|modify|update|change|fix|replace|insert|delete|remove|rename|write)\b/.test(text) ||
    /\b(file|line|code|implementation|source)\b/.test(text) && /\b(should|needs?|must|make|add|set|convert)\b/.test(text);
}

function promptImpliesCommand(prompt) {
  const text = normalizeString(prompt, "").toLowerCase();
  return /\b(run_command|run|execute|test|tests|npm test|pnpm test|yarn test|command|script)\b/.test(text);
}

function implementationContinuationToolNames(status = {}, prompt = "") {
  const names = [];
  const lowerPrompt = normalizeString(prompt, "").toLowerCase();
  const readReady = status.readOnlyToolContinuation?.status === "ready";
  const patchReady = status.patchApplyContinuation?.status === "ready";
  const commandReady = status.commandExecutionContinuation?.status === "ready";
  const asksPatch = lowerPrompt.includes("apply_patch") || promptImpliesFileMutation(lowerPrompt);
  const asksCommand = lowerPrompt.includes("run_command") || promptImpliesCommand(lowerPrompt);
  if (asksPatch && patchReady) names.push("apply_patch");
  if (asksCommand && commandReady) names.push("run_command");
  if (!names.length && readReady) names.push("read_file");
  return appendProviderHostedTools(
    appendExternalPromotedTools(
      appendNativeSubAgentRuntimeTools(
        appendReadOnlySubAgentStatusTools(
          appendSafeResidentUtilities(names, status),
          status,
        ),
        status,
      ),
      status,
    ),
    status,
  );
}

function commandRepairContinuationToolNames(status = {}, prompt = "") {
  const names = implementationContinuationToolNames(status, prompt);
  if (
    status.readOnlyToolContinuation?.status === "ready" &&
    names.length > 0 &&
    !names.includes("read_file")
  ) {
    return appendProviderHostedTools(appendExternalPromotedTools(["read_file", ...names], status), status);
  }
  return appendProviderHostedTools(appendExternalPromotedTools(names, status), status);
}

function implementationContextInstructions(contextInstructions = "") {
  const contextText = normalizeString(contextInstructions, "");
  if (!contextText) return DEFAULT_IMPLEMENTATION_TOOL_INSTRUCTIONS;
  return `${contextText}\n\n${DEFAULT_IMPLEMENTATION_TOOL_INSTRUCTIONS}`;
}

function initialDirectTurnRequestShape(requestBody = {}, options = {}) {
  const implementationTier = options.implementationTier === true;
  const useRecentDialogue = options.useRecentDialogue === true;
  const shape = requestShapeForDiagnostic(requestBody);
  const declaredToolNames = Array.isArray(requestBody.tools)
    ? requestBody.tools.map((tool) => {
      const name = normalizeString(tool?.name, "");
      if (name) return name;
      const type = normalizeString(tool?.type, "");
      if (type === "web_search_preview") return "web_search";
      return type;
    }).filter(Boolean)
    : [];
  return {
    ...shape,
    requestShapeClass: implementationTier
      ? "direct_implementation_tool_initial@1"
      : useRecentDialogue ? "direct_text_turn_recent_dialogue@1" : "direct_text_turn_empty_context@1",
    tools: declaredToolNames.length > 0,
    declaredToolNames,
    ...directToolCompositionRequestShapeFields(options.toolComposition),
  };
}

function directToolEvidenceRef(kind, id, label = "") {
  const safeKind = normalizeString(kind, "evidence");
  const safeId = normalizeString(id, safeKind);
  return {
    kind: safeKind,
    id: safeId,
    label: normalizeString(label, safeId),
    digest: `sha256:${sha256(`${safeKind}\0${safeId}\0${normalizeString(label, safeId)}`)}`,
    rendererSafe: true,
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
}

function directToolCompositionRequestShapeFields(composition = {}) {
  if (!isPlainObject(composition)) return {};
  const providerBundle = isPlainObject(composition.providerDeclaredToolBundle) ? composition.providerDeclaredToolBundle : {};
  const catalogue = isPlainObject(composition.residentCapabilityCatalogue) ? composition.residentCapabilityCatalogue : {};
  const witness = isPlainObject(composition.witness) ? composition.witness : {};
  if (!providerBundle.bundleId || !witness.witnessDigest) return {};
  return {
    directToolBundleCompositionId: normalizeString(composition.compositionId, ""),
    directToolBundleCompositionStatus: normalizeString(composition.status, ""),
    providerDeclaredToolBundleId: normalizeString(providerBundle.bundleId, ""),
    providerDeclaredToolBundleDigest: normalizeString(providerBundle.declarationDigest, ""),
    residentCapabilityCatalogueId: normalizeString(catalogue.catalogueId, ""),
    residentCapabilityCatalogueDigest: normalizeString(catalogue.catalogueDigest, ""),
    toolBundleCompositionWitnessDigest: normalizeString(witness.witnessDigest, ""),
    toolBundleCompositionWitnessAttached: true,
  };
}

function composeImplementationToolBundleForRequest(input = {}) {
  const sessionId = normalizeString(input.sessionId || input.threadId, "direct_session");
  const turnId = normalizeString(input.turnId, "turn");
  const projectId = normalizeString(input.projectId, "project_direct");
  const toolNames = Array.isArray(input.toolNames) ? input.toolNames : ["read_file", "apply_patch", "run_command"];
  const contextResult = isPlainObject(input.contextResult) ? input.contextResult : null;
  const controlledRoutingResult = isPlainObject(input.controlledRoutingResult) ? input.controlledRoutingResult : null;
  const workThreadId = normalizeString(
    controlledRoutingResult?.route?.selectedWorkThreadId ||
    input.workThreadId ||
    contextResult?.contextPack?.workThreadId,
    "work_thread_direct_live",
  );
  const providerHostedActivationDigest = normalizeString(
    input.providerHostedToolsStatus?.activationSnapshotDigest ||
    input.providerHostedToolsStatus?.activationSnapshot?.activationDigest,
    "",
  );
  const composition = composeDirectToolBundle({
    projectId,
    workThreadId,
    threadId: sessionId,
    laneKind: "implementation_worker",
    toolNames,
    useLaneDefaultTools: input.useLaneDefaultTools !== false,
    providerProfileRef: directToolEvidenceRef("provider_profile", input.providerProfileId || "direct_provider_profile", "Direct provider profile"),
    runtimeFactsRef: directToolEvidenceRef("runtime_facts", input.runtimeFactsId || "direct_runtime_facts", "Direct runtime facts"),
    activationSnapshotRefs: [
      directToolEvidenceRef("activation_snapshot", input.activationSnapshotId || "direct_tool_activation_snapshot", "Direct tool activation snapshot"),
      ...(providerHostedActivationDigest
        ? [directToolEvidenceRef("provider_hosted_activation_snapshot", providerHostedActivationDigest, "Provider-hosted activation snapshot")]
        : []),
    ],
    externalCapabilityProfile: input.externalCapabilityProfile,
    providerHostedToolsStatus: input.providerHostedToolsStatus,
    providerHostedActivationSnapshot: input.providerHostedToolsStatus?.activationSnapshot,
    sourceMessageRef: directToolEvidenceRef("source_message", input.sourceMessageId || `${turnId}_user`, "Direct user message"),
    normalizedLaneRequestRef: directToolEvidenceRef("normalized_lane_request", input.normalizedLaneRequestId || `normalized_lane_request_${turnId}`, "Implementation lane request"),
    controlledRouteRef: controlledRoutingResult?.route?.routeId
      ? directToolEvidenceRef("controlled_route", controlledRoutingResult.route.routeId, "Controlled route")
      : input.controlledRouteId
        ? directToolEvidenceRef("controlled_route", input.controlledRouteId, "Controlled route")
        : undefined,
    roleHandoffPacketRef: input.roleHandoffPacketId
      ? directToolEvidenceRef("role_handoff_packet", input.roleHandoffPacketId, "Role handoff packet")
      : undefined,
    contextPacketRef: contextResult?.contextPack?.contextBuildId
      ? directToolEvidenceRef("context_packet", contextResult.contextPack.contextBuildId, "Context packet")
      : undefined,
    requestManifestRef: contextResult?.requestManifest?.requestManifestId
      ? directToolEvidenceRef("request_manifest", contextResult.requestManifest.requestManifestId, "Request manifest")
      : undefined,
    observedAt: normalizeString(input.observedAt, nowIso()),
    requireRequestGrounding: true,
  });
  return {
    composition,
    tools: composition.providerDeclaredToolBundle.toolDeclarations,
    toolNames: composition.providerDeclaredToolBundle.declaredToolNames,
    requestShapeFields: directToolCompositionRequestShapeFields(composition),
  };
}

function threadSnapshotFromSession(session = {}) {
  const turns = Array.isArray(session.turns) ? session.turns : [];
  const agentKind = normalizeString(session.agentKind, "");
  return {
    id: session.sessionId,
    threadId: session.sessionId,
    title: normalizeString(session.title, "Direct live text session"),
    preview: normalizeString(session.title, "Direct live text session"),
    turns: Array.isArray(session.messages) ? session.messages : [],
    model: normalizeString(session.model, ""),
    createdAt: normalizeString(session.createdAt, ""),
    updatedAt: normalizeString(session.updatedAt, ""),
    status: normalizeString(session.status, "created"),
    runtimeMode: normalizeString(session.runtimeMode, ""),
    directTransport: normalizeString(session.directTransport, DIRECT_LIVE_TEXT_SURFACE_TRANSPORT),
    reasoningEffort: normalizeString(session.reasoningEffort, ""),
    agentId: normalizeString(session.agentId, ""),
    agentRunId: normalizeString(session.agentRunId, ""),
    parentAgentId: normalizeString(session.parentAgentId, ""),
    parentAgentRunId: normalizeString(session.parentAgentRunId, ""),
    agentRefState: normalizeString(session.agentId, "") && normalizeString(session.agentRunId, "") ? "linked" : "legacy_unlinked",
    agentKind,
    agentThreadId: normalizeString(session.agentThreadId, ""),
    parentThreadId: normalizeString(session.parentThreadId, ""),
    primaryThreadId: normalizeString(session.primaryThreadId, ""),
    agentLabel: normalizeString(session.agentLabel, ""),
    agentRole: normalizeString(session.agentRole, ""),
    roleHandoffPacketId: normalizeString(session.roleHandoffPacketId, ""),
    roleHandoffPacketDigest: normalizeString(session.roleHandoffPacketDigest, ""),
    workerStartTransitionId: normalizeString(session.workerStartTransitionId, ""),
    workerStartTransitionDigest: normalizeString(session.workerStartTransitionDigest, ""),
    workerContextPacketId: normalizeString(session.workerContextPacketId, ""),
    workerContextPacketDigest: normalizeString(session.workerContextPacketDigest, ""),
    workerGraphAlignmentId: normalizeString(session.workerGraphAlignmentId, ""),
    workerGraphAlignmentDigest: normalizeString(session.workerGraphAlignmentDigest, ""),
    transcriptLane: agentKind ? "worker" : "primary",
    primaryTranscriptSeparated: Boolean(agentKind),
    workThreadId: normalizeString(session.workThreadId, ""),
    turnCount: turns.length,
    activeTurnCount: turns.filter((turn) => ACTIVE_TURN_STATES.has(normalizeString(turn?.state, ""))).length,
    lastTurnState: normalizeString(turns[turns.length - 1]?.state, ""),
    rawPathExposed: false,
  };
}

function threadListEntryFromIndexEntry(entry = {}) {
  const sessionId = normalizeString(entry.sessionId, "");
  const agentKind = normalizeString(entry.agentKind, "");
  return {
    id: sessionId,
    threadId: sessionId,
    title: normalizeString(entry.title, "Direct live text session"),
    preview: normalizeString(entry.title, "Direct live text session"),
    createdAt: normalizeString(entry.createdAt, ""),
    updatedAt: normalizeString(entry.updatedAt, ""),
    status: normalizeString(entry.status, "created"),
    model: normalizeString(entry.model, ""),
    reasoningEffort: normalizeString(entry.reasoningEffort, ""),
    agentKind,
    agentThreadId: normalizeString(entry.agentThreadId, ""),
    parentThreadId: normalizeString(entry.parentThreadId, ""),
    primaryThreadId: normalizeString(entry.primaryThreadId, ""),
    agentLabel: normalizeString(entry.agentLabel, ""),
    agentRole: normalizeString(entry.agentRole, ""),
    roleHandoffPacketId: normalizeString(entry.roleHandoffPacketId, ""),
    roleHandoffPacketDigest: normalizeString(entry.roleHandoffPacketDigest, ""),
    workerStartTransitionId: normalizeString(entry.workerStartTransitionId, ""),
    workerStartTransitionDigest: normalizeString(entry.workerStartTransitionDigest, ""),
    workerContextPacketId: normalizeString(entry.workerContextPacketId, ""),
    workerContextPacketDigest: normalizeString(entry.workerContextPacketDigest, ""),
    workerGraphAlignmentId: normalizeString(entry.workerGraphAlignmentId, ""),
    workerGraphAlignmentDigest: normalizeString(entry.workerGraphAlignmentDigest, ""),
    transcriptLane: agentKind ? "worker" : "primary",
    primaryTranscriptSeparated: Boolean(agentKind),
    runtimeMode: normalizeString(entry.runtimeMode, ""),
    directTransport: normalizeString(entry.directTransport, DIRECT_LIVE_TEXT_SURFACE_TRANSPORT),
    workThreadId: normalizeString(entry.workThreadId, ""),
    turnCount: Number(entry.turnCount || 0),
    activeTurnCount: Number(entry.activeTurnCount || 0),
    lastTurnState: normalizeString(entry.lastTurnState, ""),
    activeToolLoopId: normalizeString(entry.activeToolLoopId, ""),
    activeToolStepOrdinal: Number(entry.activeToolStepOrdinal || 0),
    sourceClass: "direct-native",
    rawPathExposed: false,
  };
}

function sessionMatchesProject(session = {}, projectId = "") {
  const scopedProjectId = normalizeString(projectId, "");
  if (!scopedProjectId) return true;
  return normalizeString(session?.projectId, "") === scopedProjectId;
}

function safeReadDirectSession(sessionStore, sessionId) {
  try {
    return sessionStore?.readSession?.(sessionId) || null;
  } catch {
    return null;
  }
}

function safeReadDirectTurn(sessionStore, sessionId, turnId) {
  try {
    return sessionStore?.readTurn?.(sessionId, turnId) || null;
  } catch {
    return null;
  }
}

function terminalStatusForState(state) {
  if (state === "completed") return "completed";
  if (state === "failed") return "failed";
  if (state === "aborted") return "aborted";
  if (state === "tool_waiting") return "tool_waiting";
  if (state === "tool_call_blocked_text_only") return "failed";
  if (state === "transport_handoff_unknown") return "failed";
  if (state === "response_incomplete") return "failed";
  if (state === "content_filter_terminal") return "failed";
  if (state === "max_output_terminal") return "failed";
  if (state === "empty_output_terminal") return "failed";
  if ([
    "streaming",
    "request_built",
    "created",
    "authority_waiting",
    "continuation_ready",
    "continuation_sent",
    "streaming_continuation",
  ].includes(state)) return "inProgress";
  return normalizeString(state, "unknown");
}

function turnPromptDigest(turn = {}) {
  const input = Array.isArray(turn.input) ? turn.input : [];
  const text = input.map((entry) => normalizeString(entry?.text, "")).join("\n");
  return sha256(text);
}

function parentResponseIdForToolStep(turn = {}, obligation = {}) {
  return normalizeString(
    obligation.parentResponseId ||
    (Number(obligation.stepOrdinal || 1) > 1 ? turn.continuationResponseId : turn.responseId),
    "",
  );
}

function parentResponseSourceForToolStep(obligation = {}) {
  return normalizeString(
    obligation.parentResponseSource,
    Number(obligation.stepOrdinal || 1) > 1
      ? "native_direct_tool_continuation_stream"
      : "native_direct_initial_stream",
  );
}

function turnSnapshot(turn = {}) {
  const attribution = isPlainObject(turn.usageAttribution) ? turn.usageAttribution : null;
  return {
    id: turn.turnId,
    status: terminalStatusForState(turn.state),
    state: turn.state,
    startedAt: turn.streamStartedAt ? Date.parse(turn.streamStartedAt) / 1000 : Date.parse(turn.createdAt || nowIso()) / 1000,
    completedAt: turn.completedAt ? Date.parse(turn.completedAt) / 1000 : 0,
    error: turn.error || null,
    clientTurnRequestId: normalizeString(turn.clientTurnRequestId, ""),
    usageAttribution: attribution ? {
      schema: attribution.schema,
      attributionId: normalizeString(attribution.attributionId, ""),
      status: normalizeString(attribution.status, ""),
      agentKind: normalizeString(attribution.agentScope?.agentKind, ""),
      agentThreadId: normalizeString(attribution.agentScope?.agentThreadId, ""),
      parentThreadId: normalizeString(attribution.agentScope?.parentThreadId, ""),
      rowCount: Number(attribution.rows?.length || 0),
      totals: attribution.totals || {},
      billingGrade: attribution.privacy?.billingGrade === true,
      rawPromptIncluded: attribution.privacy?.rawPromptIncluded === true,
      rawResponseIncluded: attribution.privacy?.rawResponseIncluded === true,
    } : null,
  };
}

class DirectLiveTextController {
  constructor(options = {}) {
    this.sessionStore = options.sessionStore;
    this.profileDoc = isPlainObject(options.profileDoc) ? options.profileDoc : {};
    this.authStore = options.authStore || null;
    this.directThreadStore = options.directThreadStore || options.threadStore || null;
    this.workThreadStore = options.workThreadStore || null;
    this.refreshCredentials = typeof options.refreshCredentials === "function" ? options.refreshCredentials : null;
    this.modelEvidenceResolver = typeof options.modelEvidenceResolver === "function" ? options.modelEvidenceResolver : null;
    this.implementationProofEvidenceResolver = typeof options.implementationProofEvidenceResolver === "function" ? options.implementationProofEvidenceResolver : null;
    this.activationStatusResolver = typeof options.activationStatusResolver === "function" ? options.activationStatusResolver : null;
    this.subAgentStatusSurfaceResolver = typeof options.subAgentStatusSurfaceResolver === "function" ? options.subAgentStatusSurfaceResolver : null;
    this.subAgentPool = options.subAgentPool && typeof options.subAgentPool.launch === "function"
      ? options.subAgentPool
      : null;
    this.externalCapabilityProfileResolver = typeof options.externalCapabilityProfileResolver === "function" ? options.externalCapabilityProfileResolver : null;
    this.providerHostedToolsStatusResolver = typeof options.providerHostedToolsStatusResolver === "function" ? options.providerHostedToolsStatusResolver : null;
    this.fetchImpl = typeof options.fetchImpl === "function" ? options.fetchImpl : null;
    this.workspaceRequest = typeof options.workspaceRequest === "function" ? options.workspaceRequest : null;
    this.endpoint = normalizeString(options.endpoint, "");
    this.maxPromptChars = Number(options.maxPromptChars || DEFAULT_MAX_PROMPT_CHARS);
    this.maxAssistantChars = Number(options.maxAssistantChars || DEFAULT_MAX_ASSISTANT_CHARS);
    this.readOnlyWorkspaceTimeoutMs = boundedPositiveInteger(
      options.readOnlyWorkspaceTimeoutMs,
      DEFAULT_READONLY_WORKSPACE_TIMEOUT_MS,
      1_000,
      10 * 60_000,
    );
    this.toolDecisionCacheLimit = boundedPositiveInteger(options.toolDecisionCacheLimit, DEFAULT_TOOL_DECISION_CACHE_LIMIT, 16, 10_000);
    this.activeRuns = new Map();
    this.toolDecisionLocks = new Map();
    this.toolDecisionClaims = new Map();
    this.toolDecisionResults = new Map();
    this.forkStartLocks = new Map();
  }

  hydrateWorkThreadCarrier(carrier = {}, projectId = "") {
    const hydrated = {
      ...carrier,
      bridgeInformationRefs: Array.isArray(carrier.bridgeInformationRefs) ? [...carrier.bridgeInformationRefs] : [],
      openObligations: Array.isArray(carrier.openObligations) ? [...carrier.openObligations] : [],
    };
    const workThreadId = normalizeString(hydrated.workThread?.workThreadId || hydrated.workThreadId, "");
    hydrated.workThreadId = workThreadId;
    if (hydrated.workThread && !isRoutableWorkThreadForProject(hydrated.workThread, projectId)) {
      hydrated.workThread = null;
    }
    if (
      !hydrated.workThread &&
      workThreadId &&
      this.workThreadStore &&
      typeof this.workThreadStore.readWorkThread === "function"
    ) {
      const workThread = this.workThreadStore.readWorkThread(workThreadId);
      if (isRoutableWorkThreadForProject(workThread, projectId)) {
        hydrated.workThread = workThread;
      }
    }
    if (hydrated.workThread) {
      hydrated.workThreadId = normalizeString(hydrated.workThread.workThreadId, hydrated.workThreadId);
      if (!hydrated.authorityBoundary && isPlainObject(hydrated.workThread.authorityBoundary)) {
        hydrated.authorityBoundary = hydrated.workThread.authorityBoundary;
      }
      if (!hydrated.openObligations.length && Array.isArray(hydrated.workThread.openObligations)) {
        hydrated.openObligations = [...hydrated.workThread.openObligations];
      }
      if (!hydrated.bridgeInformationRefs.length && Array.isArray(hydrated.workThread.bridgeInformationRefs)) {
        hydrated.bridgeInformationRefs = [...hydrated.workThread.bridgeInformationRefs];
      }
    }
    return hydrated;
  }

  currentAuthStore() {
    const store = typeof this.authStore === "function" ? this.authStore() : this.authStore;
    return store && typeof store.readStatus === "function" ? store : null;
  }

  authStatus() {
    const store = this.currentAuthStore();
    return store
      ? sanitizeStatus(store.readStatus())
      : sanitizeStatus(null);
  }

  currentAuthCredentials() {
    const store = this.currentAuthStore();
    if (!store || typeof store.readCredentials !== "function") return {};
    try {
      return store.readCredentials() || {};
    } catch {
      return {};
    }
  }

  requestedModelForProject(project = {}) {
    return normalizeString(project.surfaceBinding?.codex?.model || project.codex?.model || "", "");
  }

  resolveLiveModelEvidence(project = {}, requestedModel = "") {
    if (!this.modelEvidenceResolver) return null;
    try {
      return this.modelEvidenceResolver({
        project,
        profileDoc: this.profileDoc,
        model: requestedModel,
        endpoint: this.endpoint,
        authStatus: this.authStatus(),
        credentials: this.currentAuthCredentials(),
      }) || null;
    } catch (error) {
      return {
        model: requestedModel,
        modelSource: "live-probe",
        modelEvidenceState: "unknown",
        accepted: false,
        reason: "live_probe_evidence_unavailable",
        liveProbeEvidence: {
          available: false,
          usable: false,
          status: "error",
          reason: error?.message || "live_probe_evidence_unavailable",
          rawTokensExposed: false,
          rawBackendFramesExposed: false,
        },
      };
    }
  }

  resolveImplementationProofEvidence(project = {}, requestedModel = "") {
    if (!this.implementationProofEvidenceResolver) {
      return {
        status: "missing",
        evidenceState: "missing",
        canSelectImplementationLane: false,
        requiredCapabilities: [],
        missingCapabilityIds: ["read_file", "read_file_loop", "apply_patch", "run_command"],
        rawProviderPayloadIncluded: false,
        rawToolArgsIncluded: false,
        rawWorkspacePathIncluded: false,
        rawAccountIncluded: false,
      };
    }
    try {
      return this.implementationProofEvidenceResolver({
        project,
        model: requestedModel,
        endpoint: this.endpoint,
        authStatus: this.authStatus(),
        credentials: this.currentAuthCredentials(),
      }) || null;
    } catch {
      return {
        status: "error",
        evidenceState: "unknown",
        canSelectImplementationLane: false,
        requiredCapabilities: [],
        missingCapabilityIds: ["read_file", "read_file_loop", "apply_patch", "run_command"],
        rawProviderPayloadIncluded: false,
        rawToolArgsIncluded: false,
        rawWorkspacePathIncluded: false,
        rawAccountIncluded: false,
      };
    }
  }

  resolveExternalCapabilityProfile(project = {}) {
    const workThreadId = normalizeString(directWorkThreadContextCarrier(project)?.workThreadId, "");
    if (this.externalCapabilityProfileResolver) {
      try {
        const resolved = this.externalCapabilityProfileResolver({
          project,
          projectId: normalizeString(project?.id || project?.projectId || project?.name, ""),
          workThreadId,
          endpoint: this.endpoint,
          authStatus: this.authStatus(),
        });
        if (isPlainObject(resolved)) return resolved;
      } catch (error) {
        return {
          status: "unavailable",
          reason: normalizeString(error?.message, "external_capability_profile_unavailable"),
          serverIdentities: [],
          resolverError: true,
        };
      }
    }
    return {
      status: "unavailable",
      reason: "external_capability_profile_resolver_missing",
      serverIdentities: [],
    };
  }

  resolveProviderHostedToolsStatus(project = {}) {
    if (!this.providerHostedToolsStatusResolver) {
      return {
        status: "unavailable",
        reason: "provider_hosted_tools_status_resolver_missing",
      };
    }
    try {
      const resolved = this.providerHostedToolsStatusResolver({
        project,
        projectId: normalizeString(project?.id || project?.projectId || project?.name, ""),
        workThreadId: normalizeString(directWorkThreadContextCarrier(project)?.workThreadId, ""),
        endpoint: this.endpoint,
        authStatus: this.authStatus(),
      });
      if (isPlainObject(resolved)) return resolved;
      return {
        status: "unavailable",
        reason: "provider_hosted_tools_status_resolver_invalid_result",
      };
    } catch (error) {
      return {
        status: "unavailable",
        reason: normalizeString(error?.message, "provider_hosted_tools_status_unavailable"),
        resolverError: true,
      };
    }
  }

  modelEvidenceForProject(project = {}) {
    const requestedModel = this.requestedModelForProject(project);
    const staticEvidence = modelEvidenceFor(this.profileDoc, requestedModel);
    const liveEvidence = this.resolveLiveModelEvidence(project, requestedModel || staticEvidence.model);
    if (liveEvidence?.accepted) return liveEvidence;
    return {
      ...staticEvidence,
      reason: liveEvidence?.reason || (staticEvidence.accepted ? "" : "accepted_text_model_required"),
      liveProbeEvidence: liveEvidence?.liveProbeEvidence || null,
      liveProbeEvidenceId: normalizeString(liveEvidence?.evidenceId, ""),
    };
  }

  statusForProject(project = {}) {
    const auth = this.authStatus();
    const evidence = this.modelEvidenceForProject(project);
    const implementationLaneProof = this.resolveImplementationProofEvidence(project, evidence.model);
    const externalCapabilityProfile = this.resolveExternalCapabilityProfile(project);
    const providerHostedToolsStatus = this.resolveProviderHostedToolsStatus(project);
    const readOnlyToolContinuation = mergeScopedProofWithProfileEvidence(
      readOnlyContinuationEvidenceFor(this.profileDoc),
      implementationLaneProof,
      ["read_file", "read_file_loop"],
      "scoped_read_file_and_loop_proof_required",
    );
    const patchApplyContinuation = mergeScopedProofWithProfileEvidence(
      patchApplyContinuationEvidenceFor(this.profileDoc),
      implementationLaneProof,
      "apply_patch",
      "scoped_patch_apply_proof_required",
    );
    const commandExecutionContinuation = mergeScopedProofWithProfileEvidence(
      commandExecutionContinuationEvidenceFor(this.profileDoc),
      implementationLaneProof,
      "run_command",
      "scoped_command_execution_proof_required",
    );
    let status = "ready";
    let reason = "";
    if (auth.status !== "authenticated") {
      status = "auth_required";
      reason = "direct_auth_required";
    } else if (!evidence.accepted) {
      status = "profile_required";
      reason = evidence.reason || "accepted_text_model_required";
    }
    return {
      status,
      turnRunnable: status === "ready",
      model: evidence.model,
      modelSource: evidence.modelSource,
      modelEvidenceState: evidence.modelEvidenceState,
      transport: DIRECT_LIVE_TEXT_SURFACE_TRANSPORT,
      appServerRequired: false,
      toolsEnabled: status === "ready" && (
        readOnlyToolContinuation.status === "ready" ||
        patchApplyContinuation.status === "ready" ||
        commandExecutionContinuation.status === "ready"
      ),
      reason,
      auth,
      evidenceId: normalizeString(evidence.evidenceId || evidence.liveProbeEvidenceId, ""),
      liveProbeEvidence: evidence.liveProbeEvidence || null,
      readOnlyToolContinuation,
      patchApplyContinuation,
      commandExecutionContinuation,
      externalCapabilityProfile,
      providerHostedToolsStatus,
      externalDiscovery: {
        status: externalSourceIdentityReady(externalCapabilityProfile) ? "ready" : "blocked",
        tools: externalPromotedToolNames({ status, externalCapabilityProfile }),
        sourceIdentityReady: externalSourceIdentityReady(externalCapabilityProfile),
        reason: externalSourceIdentityReady(externalCapabilityProfile)
          ? ""
          : normalizeString(externalCapabilityProfile?.reason, "external_source_identity_missing"),
        rawEndpointIncluded: false,
        rawCredentialIncluded: false,
        rawSecretIncluded: false,
      },
      implementationLaneProof: {
        ...(implementationLaneProof || {}),
        readLoopReady: proofCapabilityReady(implementationLaneProof, "read_file_loop"),
      },
    };
  }

  assertReady(project = {}) {
    const status = this.statusForProject(project);
    if (status.status !== "ready") {
      const error = new Error(status.reason || status.status);
      error.code = status.status;
      error.directLiveTextStatus = status;
      throw error;
    }
    if (this.activationStatusResolver) {
      const binding = normalizeCodexBinding(project.surfaceBinding?.codex || {});
      if (
        binding.runtimeMode === "direct-experimental" &&
        binding.directTransport === "live-text" &&
        binding.directTier === "text-only"
      ) {
        return status;
      }
      const activation = this.activationStatusResolver(project) || {};
      const canStart = activation.state === "enabled" ||
        (activation.state === "degraded" && activation.degradedCapabilities?.canStartNewTextTurn === true);
      if (!canStart) {
        const reason = activation.state === "eligible"
          ? "direct_experimental_activation_required"
          : (activation.state === "rollback_required" ? "direct_experimental_rollback_required" : "direct_experimental_not_enabled");
        const error = new Error(reason);
        error.code = reason;
        error.directActivationStatus = activation;
        error.directLiveTextStatus = status;
        throw error;
      }
    }
    return status;
  }

  initialize(_params = {}, context = {}) {
    const status = this.statusForProject(context.project || {});
    return {
      runtime: DIRECT_LIVE_TEXT_SURFACE_TRANSPORT,
      capabilities: buildDirectLiveTextCapabilities(status),
      directLiveText: status,
    };
  }

  accountRead() {
    const status = this.authStatus();
    if (status.status === "authenticated") {
      return {
        account: {
          type: "chatgpt",
          planType: "direct-live-text",
          accountId: status.accountId,
        },
        requiresOpenaiAuth: false,
        rawTokensExposed: false,
      };
    }
    return {
      account: null,
      requiresOpenaiAuth: true,
      authStatus: status,
      rawTokensExposed: false,
    };
  }

  configRequirementsRead() {
    return {
      requirements: null,
      status: "none",
      source: "direct-live-text-controller",
      rawTokensExposed: false,
      rawBackendFramesExposed: false,
    };
  }

  startThread(params = {}, context = {}) {
    const project = context.project || {};
    const projectId = normalizeString(project.id, "");
    const status = this.assertReady(project);
    const workThreadCarrier = directWorkThreadContextCarrier(params, context);
    const requestedSessionId = normalizeString(params.sessionId || params.threadId, "");
    if (requestedSessionId) {
      const existing = this.sessionStore.readSession(requestedSessionId);
      if (existing) {
        if (!sessionMatchesProject(existing, projectId)) {
          throw new Error("Direct live text session does not belong to the active project.");
        }
        return { thread: threadSnapshotFromSession(existing), model: existing.model };
      }
    }
    const model = normalizeString(params.model, "") || status.model;
    const reasoningEffort = normalizeString(params.reasoningEffort || params.reasoning_effort, "");
    const session = this.sessionStore.createSession({
      sessionId: requestedSessionId,
      projectId,
      workspace: isPlainObject(project.workspace) ? project.workspace : {},
      workspaceDisplayPath: workspaceDisplayPath(project),
      title: normalizeString(params.title, `${normalizeString(project.name, "Direct")} live text session`),
      model,
      reasoningEffort,
      runtimeMode: "direct-experimental",
      directTransport: DIRECT_LIVE_TEXT_SURFACE_TRANSPORT,
      modelSource: status.modelSource,
      modelEvidenceState: status.modelEvidenceState,
      modelEvidenceId: normalizeString(status.evidenceId, ""),
      profileSnapshotId: normalizeString(project.surfaceBinding?.codex?.profileId, ""),
      agentKind: normalizeString(params.agentKind, ""),
      agentThreadId: normalizeString(params.agentThreadId, ""),
      parentThreadId: normalizeString(params.parentThreadId, ""),
      primaryThreadId: normalizeString(params.primaryThreadId || params.parentThreadId, ""),
      agentLabel: normalizeString(params.agentLabel, ""),
      agentRole: normalizeString(params.agentRole, ""),
      roleHandoffPacketId: normalizeString(params.roleHandoffPacketId, ""),
      roleHandoffPacketDigest: normalizeString(params.roleHandoffPacketDigest, ""),
      workerStartTransitionId: normalizeString(params.workerStartTransitionId, ""),
      workerStartTransitionDigest: normalizeString(params.workerStartTransitionDigest, ""),
      workerContextPacketId: normalizeString(params.workerContextPacketId, ""),
      workerContextPacketDigest: normalizeString(params.workerContextPacketDigest, ""),
      workerGraphAlignmentId: normalizeString(params.workerGraphAlignmentId, ""),
      workerGraphAlignmentDigest: normalizeString(params.workerGraphAlignmentDigest, ""),
      sourceClass: "direct-native",
      nativeDirectSession: true,
      providerContinuityAvailable: false,
      continuityState: "fresh_session_only",
      workThreadId: workThreadCarrier.workThreadId,
      workThreadBindingDigest: normalizeString(workThreadCarrier.workThreadBinding?.bindingDigest, ""),
    });
    return {
      thread: threadSnapshotFromSession(session),
      model: session.model,
    };
  }

  listThreads(params = {}, context = {}) {
    const project = context.project || {};
    const projectId = normalizeString(project.id, "");
    const requestedLimit = Number(params.limit || 40);
    const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(200, requestedLimit)) : 40;
    const index = this.sessionStore.ensure();
    const sessions = Array.isArray(index?.sessions) ? index.sessions : [];
    const updatedMs = (entry) => {
      const parsed = Date.parse(normalizeString(entry?.updatedAt, ""));
      return Number.isFinite(parsed) ? parsed : 0;
    };
    const scopedEntries = sessions
      .filter((entry) => {
        return entry && sessionMatchesProject(entry, projectId);
      })
      .sort((left, right) => updatedMs(right) - updatedMs(left))
      .slice(0, limit);
    const threads = scopedEntries.map(threadListEntryFromIndexEntry);
    const deckThreads = scopedEntries
      .map((entry) => {
        const session = safeReadDirectSession(this.sessionStore, entry.sessionId);
        const sessionReadFailed = !session && Boolean(entry.sessionId);
        const safeSession = session || {};
        const turns = (Array.isArray(safeSession.turns) ? safeSession.turns : []).map((summary) => {
          const turnId = normalizeString(summary?.turnId, "");
          const turn = turnId ? safeReadDirectTurn(this.sessionStore, entry.sessionId, turnId) : null;
          return {
            turnId,
            state: normalizeString(turn?.state || summary?.state, ""),
            createdAt: normalizeString(turn?.createdAt || summary?.createdAt, ""),
            updatedAt: normalizeString(turn?.updatedAt || summary?.updatedAt, ""),
            model: normalizeString(turn?.model || summary?.model, ""),
            reasoningEffort: normalizeString(turn?.reasoningEffort || summary?.reasoningEffort, ""),
            error: isPlainObject(turn?.error)
              ? {
                  code: normalizeString(turn.error.code, ""),
                  previousState: normalizeString(turn.error.previousState, ""),
                  recoveredAt: normalizeString(turn.error.recoveredAt, ""),
                }
              : null,
          };
        });
        return {
          ...threadListEntryFromIndexEntry(entry),
          turns,
          storageState: sessionReadFailed ? "session_unreadable" : "available",
          providerContinuityAvailable: safeSession.providerContinuityAvailable === true,
        };
      });
    const storeStatus = this.sessionStore.status({ projectId });
    const defaultModel = normalizeString(params.defaultModel || params.model, "");
    const defaultReasoningEffort = normalizeString(params.defaultReasoningEffort || params.reasoningEffort || params.reasoning_effort, "");
    const deck = buildDirectThreadDeckProjection({
      projectId,
      runtime: DIRECT_LIVE_TEXT_SURFACE_TRANSPORT,
      threads: deckThreads,
      storeStatus,
      defaultModel,
      defaultReasoningEffort,
      canStart: true,
    });
    return {
      schema: "direct_thread_list@1",
      runtime: DIRECT_LIVE_TEXT_SURFACE_TRANSPORT,
      projectId,
      threads,
      count: threads.length,
      limit,
      storeStatus,
      deck,
      rawPathsExposed: false,
    };
  }

  emitNotification(surfaceSession, method, params = {}) {
    surfaceSession?.sendEvent?.({
      type: "rpc-notification",
      method,
      params,
    });
  }

  findTurnByClientRequestId(session, clientTurnRequestId) {
    const key = normalizeString(clientTurnRequestId, "");
    if (!key) return null;
    const mappedTurnId = normalizeString(session.clientTurnRequests?.[key], "");
    if (mappedTurnId) return this.sessionStore.readTurn(session.sessionId, mappedTurnId);
    for (const summary of Array.isArray(session.turns) ? session.turns : []) {
      const turn = this.sessionStore.readTurn(session.sessionId, summary.turnId);
      if (turn?.clientTurnRequestId === key) return turn;
    }
    return null;
  }

  activeTurnForSession(session) {
    for (const summary of Array.isArray(session.turns) ? session.turns : []) {
      if (!ACTIVE_TURN_STATES.has(summary?.state)) continue;
      const turn = this.sessionStore.readTurn(session.sessionId, summary.turnId);
      if (turn && ACTIVE_TURN_STATES.has(turn.state)) return turn;
    }
    return null;
  }

  rememberClientTurnRequest(sessionId, clientTurnRequestId, turnId) {
    const session = this.sessionStore.readSession(sessionId);
    if (!session) return;
    this.sessionStore.writeSession({
      ...session,
      updatedAt: nowIso(),
      clientTurnRequests: {
        ...(isPlainObject(session.clientTurnRequests) ? session.clientTurnRequests : {}),
        [clientTurnRequestId]: turnId,
      },
    });
  }

  appendSessionTurn(sessionId, turnId, items, model, status) {
    const session = this.sessionStore.readSession(sessionId);
    if (!session) return;
    const nextMessages = [
      ...(Array.isArray(session.messages) ? session.messages.filter((message) => message.id !== turnId) : []),
      {
        id: turnId,
        status,
        items,
      },
    ];
    this.sessionStore.writeSession({
      ...session,
      updatedAt: nowIso(),
      status,
      model: normalizeString(model, session.model),
      messages: nextMessages,
    });
  }

  indexDirectThreadStoreSession(sessionId, options = {}) {
    const store = this.directThreadStore;
    if (!store || typeof store.indexSessionArtifacts !== "function") return null;
    const session = this.sessionStore.readSession(sessionId);
    if (!session) return null;
    const turns = this.sessionStore.listTurnIdsFromDisk(sessionId)
      .map((turnId) => this.sessionStore.readTurn(sessionId, turnId))
      .filter(Boolean);
    return store.indexSessionArtifacts(this.sessionStore, session, turns, options);
  }

  prepareDirectContextProjection(sessionId, options = {}) {
    const store = this.directThreadStore;
    if (!store || typeof store.buildRendererTranscriptProjection !== "function") return null;
    const turnIds = this.sessionStore.listTurnIdsFromDisk(sessionId);
    if (!turnIds.length) return null;
    this.indexDirectThreadStoreSession(sessionId, options);
    return store.buildRendererTranscriptProjection(sessionId, {
      sessionStore: this.sessionStore,
      nowMs: options.nowMs,
    });
  }

  forkStartRequestShapeHash(input = {}) {
    return sha256(stableStringify({
      schema: DIRECT_FORK_PREVIEW_START_REQUEST_SHAPE,
      model: normalizeString(input.model, ""),
      endpointHash: normalizeString(input.endpointHash, ""),
      store: false,
      tools: false,
      previousResponseId: false,
      contextPolicy: "direct_fork_start_from_preview@1",
      roleMapping: "direct_context_role_mapping@1",
      streamEvents: [
        "response_created",
        "message_delta",
        "usage",
        "response_completed",
        "response_failed",
        "response_incomplete",
      ],
    }));
  }

  derivedPreviewForkStartRequestShapeHash(input = {}) {
    const sourcePreviewKind = normalizeString(input.sourcePreviewKind, "");
    const requestShapeClass = this.derivedPreviewForkStartRequestShapeClass(sourcePreviewKind);
    return sha256(stableStringify({
      schema: requestShapeClass,
      sourcePreviewKind,
      model: normalizeString(input.model, ""),
      endpointHash: normalizeString(input.endpointHash, ""),
      store: false,
      tools: false,
      previousResponseId: false,
      contextPolicy: "direct_derived_preview_fork_start@1",
      roleMapping: "direct_context_role_mapping@1",
      streamEvents: [
        "response_created",
        "message_delta",
        "usage",
        "response_completed",
        "response_failed",
        "response_incomplete",
      ],
    }));
  }

  derivedPreviewForkStartRequestShapeClass(sourcePreviewKind) {
    return derivedPreviewForkStartRequestShapeClassForKind(sourcePreviewKind);
  }

  async startForkFromPreview(options = {}) {
    const project = options.project || {};
    const projectId = normalizeString(project.id, "");
    const status = this.assertReady(project);
    const store = this.directThreadStore;
    if (!store) {
      const error = new Error("context_store_unhealthy");
      error.code = "context_store_unhealthy";
      throw error;
    }
    const sourcePreviewId = normalizeString(options.sourcePreviewId, "");
    const clientForkStartId = normalizeString(options.clientForkStartId, "");
    const clientOperationId = normalizeString(options.clientOperationId, "");
    const currentUserPrompt = normalizeString(options.currentUserPrompt, "");
    if (!clientForkStartId || !clientOperationId) {
      const error = new Error("idempotency_key_conflict");
      error.code = "idempotency_key_conflict";
      throw error;
    }
    if (!sourcePreviewId) {
      const error = new Error("source_preview_missing");
      error.code = "source_preview_missing";
      throw error;
    }
    if (!currentUserPrompt) {
      const error = new Error("current_user_prompt_missing");
      error.code = "current_user_prompt_missing";
      throw error;
    }
    const lockKey = `${projectId}:${sourcePreviewId}`;
    if (this.forkStartLocks.has(lockKey) && this.forkStartLocks.get(lockKey) !== clientForkStartId) {
      const error = new Error("active_fork_start_exists");
      error.code = "active_fork_start_exists";
      throw error;
    }
    this.forkStartLocks.set(lockKey, clientForkStartId);
    let planned = null;
    let session = null;
    let turn = null;
    let forkStartId = `fork_start_${sha256(`${projectId}:${clientForkStartId}:${sourcePreviewId}`).slice(0, 24)}`;
    let operationInputDigest = "";
    let operationCommitted = false;
    try {
      const existing = store.operationByClient(projectId, clientOperationId);
      if (existing) {
        const existingResult = store.operationResult(existing);
        const existingForkStartId = normalizeString(existingResult?.result?.forkStartId, "");
        if (existingForkStartId && existingForkStartId !== forkStartId) {
          const error = new Error("client_operation_id_conflict");
          error.code = "client_operation_id_conflict";
          throw error;
        }
        let existingTurnState = "";
        try {
          existingTurnState = normalizeString(this.sessionStore.readTurn(
            normalizeString(existingResult?.result?.createdSessionId, ""),
            normalizeString(existingResult?.result?.createdTurnId, ""),
          )?.state, "");
        } catch {}
        return {
          forkStartId: existingForkStartId,
          operationId: existingResult.operationId,
          threadId: normalizeString(existingResult?.result?.createdThreadId, ""),
          sessionId: normalizeString(existingResult?.result?.createdSessionId, ""),
          turnId: normalizeString(existingResult?.result?.createdTurnId, ""),
          status: existingTurnState || normalizeString(existingResult?.result?.forkStatus, existingResult.status),
          refreshRequired: true,
          rawPathExposed: false,
          rawUrlExposed: false,
          contextTextExposed: false,
          requestBodyExposed: false,
        };
      }
      if (store.activeTurnCountForProject(projectId) > 0 && options.allowConcurrentDirectTurns !== true) {
        const error = new Error("active_direct_turn_exists");
        error.code = "active_direct_turn_exists";
        throw error;
      }
      const model = normalizeString(options.selectedModel || options.model, "") || status.model;
      const endpointHash = this.endpoint ? sha256(this.endpoint) : "";
      const requestShapeHash = this.forkStartRequestShapeHash({ model, endpointHash });
      operationInputDigest = sha256(stableStringify({
        schema: "direct_fork_start_operation_input@1",
        projectId,
        sourcePreviewId,
        expectedSourcePreviewDigest: normalizeString(options.expectedSourcePreviewDigest, ""),
        clientForkStartId,
        model,
        requestShapeHash,
      }));
      planned = store.planOperation({
        operationType: "start_fork_turn",
        projectId,
        clientOperationId,
        target: { previewId: sourcePreviewId },
        parameters: { operationInputDigest, clientForkStartId, requestShapeHash },
        safety: { requiresConfirmation: true },
      }, options);
      const seedPreview = store.previewProjectionRecord(projectId, sourcePreviewId);
      const sourceKind = normalizeString(seedPreview.items[0]?.seed?.sourceKind || seedPreview.projection.source?.sourceKind, "direct_thread");
      if (sourceKind !== "direct_thread") {
        const error = new Error(sourceKind === "merge_preview" ? "merge_preview_fork_start_deferred" : (sourceKind === "prune_preview" ? "prune_preview_fork_start_deferred" : "fork_preview_source_kind_unsupported"));
        error.code = error.message;
        throw error;
      }
      session = this.sessionStore.createSession({
        projectId,
        workspace: isPlainObject(project.workspace) ? project.workspace : {},
        workspaceDisplayPath: workspaceDisplayPath(project),
        title: `Fork from ${normalizeString(seedPreview.items[0]?.threadId, "direct thread")}`,
        model,
        runtimeMode: "direct-experimental",
        directTransport: DIRECT_LIVE_TEXT_SURFACE_TRANSPORT,
        modelSource: status.modelSource,
        modelEvidenceState: status.modelEvidenceState,
        modelEvidenceId: normalizeString(status.evidenceId, ""),
        profileSnapshotId: normalizeString(project.surfaceBinding?.codex?.profileId, ""),
        sourceClass: "forked-direct-native",
        nativeDirectSession: true,
        providerContinuityAvailable: false,
        continuityState: "fresh_session_only",
        composerState: "disabled_until_first_turn_terminal",
        forkStartId,
        sourcePreviewId,
        sourcePreviewDigest: seedPreview.projection.projectionDigest,
        sourcePreviousResponseIdUsed: false,
      }, options);
      turn = this.sessionStore.createTurn(session.sessionId, {
        input: [{ role: "current_user_intent", text: currentUserPrompt }],
        model,
        clientTurnRequestId: clientForkStartId,
        requestShape: { schema: DIRECT_FORK_PREVIEW_START_REQUEST_SHAPE, requestShapeHash },
        sourceClass: "forked-direct-native",
        nativeDirectSession: true,
        forkStartId,
        sourcePreviewId,
        sourcePreviewDigest: seedPreview.projection.projectionDigest,
        previousResponseIdUsed: false,
        providerContinuityHandleUsed: false,
        sourceProviderContinuityHandleUsed: false,
      }, options);
      this.sessionStore.appendNormalizedEvents(session.sessionId, turn.turnId, [
        { type: "fork_session_created", forkStartId, sourcePreviewId },
      ], options);
      const forkSeedResult = store.buildForkSeedFromPreview({
        projectId,
        forkStartId,
        sourcePreviewId,
        sourcePreviewOperationId: normalizeString(options.sourcePreviewOperationId, ""),
        expectedSourcePreviewDigest: normalizeString(options.expectedSourcePreviewDigest, seedPreview.projection.projectionDigest),
        targetThreadId: session.sessionId,
        targetTurnId: turn.turnId,
        currentUserPrompt,
      }, options);
      const forkSeed = forkSeedResult.forkSeed;
      const patchedSession = this.sessionStore.readSession(session.sessionId);
      this.sessionStore.writeSession({
        ...patchedSession,
        forkSeedId: forkSeed.forkSeedId,
        seedShapeHash: forkSeed.seedShapeHash,
        parentForkLineage: forkSeed.parentLineage,
      });
      this.sessionStore.appendNormalizedEvents(session.sessionId, turn.turnId, [
        { type: "fork_seed_built", forkStartId, forkSeedId: forkSeed.forkSeedId, seedShapeHash: forkSeed.seedShapeHash },
      ], options);
      this.indexDirectThreadStoreSession(session.sessionId, options);
      const contextResult = store.buildAndPersistContextForForkStart({
        session: this.sessionStore.readSession(session.sessionId),
        projectId,
        threadId: session.sessionId,
        turnId: turn.turnId,
        forkStartId,
        forkSeed,
        currentUserPrompt,
        model,
        requestShape: {
          schema: DIRECT_FORK_PREVIEW_START_REQUEST_SHAPE,
          requestShapeClass: DIRECT_FORK_PREVIEW_START_REQUEST_SHAPE,
          model,
          stream: true,
          store: false,
          tools: false,
          previousResponseId: false,
        },
        requestShapeHash,
        endpointClass: "chatgpt-codex-responses",
        endpointHash,
        modelEvidenceRef: normalizeString(status.evidenceId, status.modelEvidenceId || ""),
        requestShapeEvidenceRef: DIRECT_FORK_PREVIEW_START_REQUEST_SHAPE,
        endpointEvidenceRef: endpointHash,
        accountEvidenceRef: normalizeString(status.auth?.accountId, ""),
      }, options);
      this.sessionStore.appendNormalizedEvents(session.sessionId, turn.turnId, [
        { type: "context_pack_built", contextBuildId: contextResult.contextPack.contextBuildId, contextPackContentHash: contextResult.contextPack.contextPackContentHash },
        { type: "request_manifest_built", requestManifestId: contextResult.requestManifest.requestManifestId },
      ], options);
      const requestShape = {
        schema: DIRECT_FORK_PREVIEW_START_REQUEST_SHAPE,
        requestShapeHash,
        contextBuildId: contextResult.contextPack.contextBuildId,
        contextPackContentHash: contextResult.contextPack.contextPackContentHash,
        contextPackShapeHash: contextResult.contextPack.contextPackShapeHash,
        requestManifestId: contextResult.requestManifest.requestManifestId,
        providerInputShapeHash: contextResult.providerInput.projection.providerInputShapeHash,
        previousResponseIdUsed: false,
        providerContinuityHandleUsed: false,
        store: false,
        tools: false,
      };
      this.sessionStore.updateTurnState(session.sessionId, turn.turnId, "request_built", {
        requestShape,
        contextBuildId: contextResult.contextPack.contextBuildId,
        requestManifestId: contextResult.requestManifest.requestManifestId,
        forkSeedId: forkSeed.forkSeedId,
        seedShapeHash: forkSeed.seedShapeHash,
        parentForkLineage: forkSeed.parentLineage,
        contextSummary: contextResult.rendererSafeSummary,
      }, options);
      this.sessionStore.appendNormalizedEvents(session.sessionId, turn.turnId, [
        {
          type: "request_built",
          forkStartId,
          forkSeedId: forkSeed.forkSeedId,
          seedShapeHash: forkSeed.seedShapeHash,
          contextBuildId: contextResult.contextPack.contextBuildId,
          requestManifestId: contextResult.requestManifest.requestManifestId,
          requestShapeHash,
          previousResponseIdUsed: false,
          providerContinuityHandleUsed: false,
        },
      ], options);
      this.indexDirectThreadStoreSession(session.sessionId, options);
      const lineageEdges = store.createForkLineageEdges({
        projectId,
        operationId: planned.operationId,
        forkThreadId: session.sessionId,
        sourcePreviewId,
        sourceThreadIds: forkSeed.parentLineage.sourceThreadIds,
      }, options);
      const committed = store.commitOperation(planned.operationId, {
        operationType: "start_fork_turn",
        projectId,
        clientOperationId,
        target: { previewId: sourcePreviewId, threadIds: [session.sessionId] },
        result: {
          status: "committed",
          operationInputDigest,
          forkStartId,
          forkStatus: "request_built",
          createdThreadId: session.sessionId,
          createdSessionId: session.sessionId,
          createdTurnId: turn.turnId,
          effects: [
            { effectKind: "fork_seed_created", targetKind: "projection", targetId: forkSeed.forkSeedId, rendererSafeSummary: "fork_seed_created" },
            { effectKind: "fork_thread_created", targetKind: "direct_thread", targetId: session.sessionId, rendererSafeSummary: "fork_thread_created" },
            { effectKind: "fork_turn_request_built", targetKind: "direct_thread", targetId: turn.turnId, rendererSafeSummary: "provider turn pending" },
            ...lineageEdges.map((edge) => ({ effectKind: "lineage_edge_created", targetKind: "thread_edge", targetId: edge.edgeId, rendererSafeSummary: edge.edgeKind })),
          ],
        },
      }, options);
      operationCommitted = true;
      let requestBody = buildTextOnlyProbeRequest({
        profileDoc: this.profileDoc,
        model,
        prompt: contextResult.providerInput.prompt,
        instructions: contextResult.providerInput.instructions,
      });
      const callerLifecycle = options.onLifecycle;
      let result;
      try {
        result = await runTextOnlyDirectProbe({
          endpoint: this.endpoint || undefined,
          authStore: this.currentAuthStore(),
          refreshCredentials: this.refreshCredentials,
          profileDoc: this.profileDoc,
          model: requestBody.model,
          prompt: requestBody.input?.[0]?.content?.[0]?.text || contextResult.providerInput.prompt,
          instructions: requestBody.instructions,
          fetchImpl: this.fetchImpl || undefined,
          signal: options.signal,
          onLifecycle: (event) => {
            if (event.phase === "streaming") {
              this.sessionStore.updateTurnState(session.sessionId, turn.turnId, "streaming", {
                streamStartedAt: event.at,
                responseStatus: event.status,
                responseContentType: event.contentType,
              }, options);
            }
            if (typeof callerLifecycle === "function") callerLifecycle(event);
          },
        });
      } catch (error) {
        this.sessionStore.updateTurnState(session.sessionId, turn.turnId, "failed", {
          error: { code: error.code || "provider_transport_failed", message: error.message || "Provider transport failed." },
          forkStartStatus: "sent_unknown",
        }, options);
        return {
          forkStartId,
          operationId: committed.operationId,
          threadId: session.sessionId,
          sessionId: session.sessionId,
          turnId: turn.turnId,
          status: "sent_unknown",
          refreshRequired: true,
          rawPathExposed: false,
          rawUrlExposed: false,
          contextTextExposed: false,
          requestBodyExposed: false,
        };
      }
      this.sessionStore.writeDiagnostic(session.sessionId, "direct_fork_start", {
        ...result.diagnostic,
        forkStartId,
        forkSeedId: forkSeed.forkSeedId,
        rawBackendFramesExposed: false,
        rawAuthHeadersExposed: false,
      }, options);
      if (result.normalizedEvents.length) this.sessionStore.appendNormalizedEvents(session.sessionId, turn.turnId, result.normalizedEvents, options);
      const assistantText = assistantTextFromNormalizedEvents(result.normalizedEvents);
      const unsupportedTool = result.normalizedEvents.some((event) => String(event.type || "").startsWith("tool_call_"));
      const terminal = firstForkTurnTerminal(result, assistantText, unsupportedTool, "Fork start");
      const completedTurn = this.sessionStore.updateTurnState(session.sessionId, turn.turnId, terminal.state, {
        ...(terminal.error ? { error: terminal.error } : {}),
        responseId: result.responseId || "",
        responseStatus: result.response?.status || 0,
        responseContentType: result.response?.contentType || "",
        forkStartStatus: terminal.state,
        firstTurnTerminalKind: terminal.terminalKind,
        localSessionState: terminal.state === "completed" ? "provider_completed" : "provider_sent_not_completed",
      }, options);
      const currentSession = this.sessionStore.readSession(session.sessionId);
      this.sessionStore.writeSession({
        ...currentSession,
        composerState: terminal.state === "completed" ? "enabled" : "disabled_interrupted",
      });
      this.appendSessionTurn(session.sessionId, turn.turnId, [
        {
          id: `${turn.turnId}_fork_seed`,
          type: "harnessForkSeed",
          turnId: turn.turnId,
          text: forkSeed.seedText.slice(0, 4096),
          forkStartId,
          forkSeedId: forkSeed.forkSeedId,
          seedShapeHash: forkSeed.seedShapeHash,
        },
        ...(assistantText ? [{
          id: `${turn.turnId}_assistant`,
          type: "agentMessage",
          turnId: turn.turnId,
          text: assistantText,
        }] : []),
      ], model, terminal.state);
      this.prepareDirectContextProjection(session.sessionId, options);
      return {
        forkStartId,
        operationId: committed.operationId,
        threadId: session.sessionId,
        sessionId: session.sessionId,
        turnId: turn.turnId,
        status: completedTurn.state,
        refreshRequired: true,
        rawPathExposed: false,
        rawUrlExposed: false,
        contextTextExposed: false,
        requestBodyExposed: false,
        firstTurnTerminalKind: terminal.terminalKind,
        localSessionState: terminal.state === "completed" ? "provider_completed" : "provider_sent_not_completed",
      };
    } catch (error) {
      if (!operationCommitted && session?.sessionId && turn?.turnId) {
        try {
          this.sessionStore.updateTurnState(session.sessionId, turn.turnId, "failed", {
            error: {
              code: error.code || error.message || "fork_start_pre_transport_failed",
              message: error.message || "Fork start failed before provider transport.",
            },
            forkStartStatus: "failed",
          }, options);
          const currentSession = this.sessionStore.readSession(session.sessionId);
          this.sessionStore.writeSession({
            ...currentSession,
            composerState: "disabled_failed_pre_transport",
          });
          this.indexDirectThreadStoreSession(session.sessionId, options);
        } catch {}
      }
      if (!operationCommitted && planned?.operationId && typeof store.failOperation === "function") {
        try {
          store.failOperation(planned.operationId, {
            operationType: "start_fork_turn",
            projectId,
            clientOperationId,
            target: {
              previewId: sourcePreviewId,
              threadIds: session?.sessionId ? [session.sessionId] : [],
            },
            result: {
              status: "failed",
              operationInputDigest,
              forkStartId,
              forkStatus: "failed",
              blockerCode: error.code || error.message || "fork_start_pre_transport_failed",
              createdThreadId: session?.sessionId || "",
              createdSessionId: session?.sessionId || "",
              createdTurnId: turn?.turnId || "",
              effects: [{
                effectKind: "operation_failed_no_effect",
                targetKind: session?.sessionId ? "direct_thread" : "projection",
                targetId: session?.sessionId || sourcePreviewId,
                rendererSafeSummary: error.code || error.message || "fork_start_pre_transport_failed",
              }],
            },
          }, options);
        } catch {}
      }
      throw error;
    } finally {
      this.forkStartLocks.delete(lockKey);
    }
  }

  async startForkFromDerivedPreview(options = {}) {
    const project = options.project || {};
    const projectId = normalizeString(project.id, "");
    const status = this.assertReady(project);
    const store = this.directThreadStore;
    if (!store) {
      const error = new Error("context_store_unhealthy");
      error.code = "context_store_unhealthy";
      throw error;
    }
    const sourcePreviewId = normalizeString(options.sourcePreviewId, "");
    const sourcePreviewKind = normalizeString(options.sourcePreviewKind, "");
    const clientDerivedForkStartId = normalizeString(options.clientDerivedForkStartId || options.clientForkStartId, "");
    const clientOperationId = normalizeString(options.clientOperationId, "");
    const currentUserPrompt = normalizeString(options.currentUserPrompt, "");
    if (!clientDerivedForkStartId || !clientOperationId) {
      const error = new Error("idempotency_key_conflict");
      error.code = "idempotency_key_conflict";
      throw error;
    }
    if (!sourcePreviewId) {
      const error = new Error("source_preview_missing");
      error.code = "source_preview_missing";
      throw error;
    }
    if (sourcePreviewKind !== "merge_preview" && sourcePreviewKind !== "prune_preview") {
      const error = new Error(sourcePreviewKind === "fork_preview" ? "intermediate_fork_preview_not_supported" : "derived_preview_source_kind_unsupported");
      error.code = error.message;
      throw error;
    }
    if (!currentUserPrompt) {
      const error = new Error("current_user_prompt_missing");
      error.code = "current_user_prompt_missing";
      throw error;
    }
    const lockKey = `${projectId}:derived:${sourcePreviewKind}:${sourcePreviewId}`;
    if (this.forkStartLocks.has(lockKey) && this.forkStartLocks.get(lockKey) !== clientDerivedForkStartId) {
      const error = new Error("active_fork_start_exists");
      error.code = "active_fork_start_exists";
      throw error;
    }
    this.forkStartLocks.set(lockKey, clientDerivedForkStartId);
    let planned = null;
    let session = null;
    let turn = null;
    let forkStartId = "";
    let operationInputDigest = "";
    let operationCommitted = false;
    try {
      forkStartId = `derived_fork_start_${sha256(`${projectId}:${clientDerivedForkStartId}:${sourcePreviewKind}:${sourcePreviewId}`).slice(0, 24)}`;
      const existing = store.operationByClient(projectId, clientOperationId);
      if (existing) {
        const existingResult = store.operationResult(existing);
        const existingForkStartId = normalizeString(existingResult?.result?.forkStartId, "");
        if (existingForkStartId && existingForkStartId !== forkStartId) {
          const error = new Error("client_operation_id_conflict");
          error.code = "client_operation_id_conflict";
          throw error;
        }
        let existingTurnState = "";
        try {
          existingTurnState = normalizeString(this.sessionStore.readTurn(
            normalizeString(existingResult?.result?.createdSessionId, ""),
            normalizeString(existingResult?.result?.createdTurnId, ""),
          )?.state, "");
        } catch {}
        return {
          forkStartId: existingForkStartId,
          operationId: existingResult.operationId,
          threadId: normalizeString(existingResult?.result?.createdThreadId, ""),
          sessionId: normalizeString(existingResult?.result?.createdSessionId, ""),
          turnId: normalizeString(existingResult?.result?.createdTurnId, ""),
          status: existingTurnState || normalizeString(existingResult?.result?.forkStatus, existingResult.status),
          refreshRequired: true,
          rawPathExposed: false,
          rawUrlExposed: false,
          contextTextExposed: false,
          requestBodyExposed: false,
        };
      }
      if (store.activeTurnCountForProject(projectId) > 0 && options.allowConcurrentDirectTurns !== true) {
        const error = new Error("active_direct_turn_exists");
        error.code = "active_direct_turn_exists";
        throw error;
      }
      const model = normalizeString(options.selectedModel || options.model, "") || status.model;
      const endpointHash = this.endpoint ? sha256(this.endpoint) : "";
      const requestShapeHash = this.derivedPreviewForkStartRequestShapeHash({ model, endpointHash, sourcePreviewKind });
      const requestShapeClass = this.derivedPreviewForkStartRequestShapeClass(sourcePreviewKind);
      operationInputDigest = sha256(stableStringify({
        schema: "direct_derived_preview_fork_start_operation_input@1",
        projectId,
        sourcePreviewId,
        sourcePreviewKind,
        expectedSourcePreviewDigest: normalizeString(options.expectedSourcePreviewDigest, ""),
        expectedSourcePreviewOperationId: normalizeString(options.expectedSourcePreviewOperationId, ""),
        clientDerivedForkStartId,
        model,
        requestShapeHash,
      }));
      const existingByForkStartId = store.db.prepare(`
        select *
        from direct_operations
        where project_id = ? and operation_type = 'start_fork_turn'
        order by requested_at desc
        limit 200
      `).all(projectId).map((row) => store.operationResult(row))
        .find((entry) => normalizeString(entry?.result?.forkStartId, "") === forkStartId);
      if (existingByForkStartId && normalizeString(existingByForkStartId.clientOperationId, "") !== clientOperationId) {
        const error = new Error("idempotency_key_conflict");
        error.code = "idempotency_key_conflict";
        throw error;
      }
      planned = store.planOperation({
        operationType: "start_fork_turn",
        projectId,
        clientOperationId,
        target: { previewId: sourcePreviewId, previewKind: sourcePreviewKind },
        parameters: { operationInputDigest, clientDerivedForkStartId, requestShapeHash },
        safety: { requiresConfirmation: true },
      }, options);
      const seedPreview = store.previewProjectionRecord(projectId, sourcePreviewId, sourcePreviewKind);
      const derivedSeedResult = store.buildDerivedForkSeedFromPreview({
        projectId,
        forkStartId,
        sourcePreviewId,
        sourcePreviewKind,
        sourcePreviewOperationId: normalizeString(options.sourcePreviewOperationId || options.expectedSourcePreviewOperationId, ""),
        expectedSourcePreviewOperationId: normalizeString(options.expectedSourcePreviewOperationId, ""),
        expectedSourcePreviewDigest: normalizeString(options.expectedSourcePreviewDigest, seedPreview.projection.projectionDigest),
        currentUserPrompt,
      }, options);
      const derivedForkSeed = derivedSeedResult.derivedForkSeed;
      session = this.sessionStore.createSession({
        projectId,
        workspace: isPlainObject(project.workspace) ? project.workspace : {},
        workspaceDisplayPath: workspaceDisplayPath(project),
        title: `Fork from ${sourcePreviewKind.replace("_", " ")}`,
        model,
        runtimeMode: "direct-experimental",
        directTransport: DIRECT_LIVE_TEXT_SURFACE_TRANSPORT,
        modelSource: status.modelSource,
        modelEvidenceState: status.modelEvidenceState,
        modelEvidenceId: normalizeString(status.evidenceId, ""),
        profileSnapshotId: normalizeString(project.surfaceBinding?.codex?.profileId, ""),
        sourceClass: "forked-direct-native",
        nativeDirectSession: true,
        providerContinuityAvailable: false,
        continuityState: "fresh_session_only",
        composerState: "disabled_until_first_turn_terminal",
        forkStartId,
        forkSeedId: derivedForkSeed.derivedForkSeedId,
        derivedForkSeedId: derivedForkSeed.derivedForkSeedId,
        seedShapeHash: derivedForkSeed.seedShapeHash,
        parentForkLineage: derivedForkSeed.parentLineage,
        sourcePreviewId,
        sourcePreviewKind,
        sourcePreviewDigest: seedPreview.projection.projectionDigest,
        sourcePreviewOperationId: derivedForkSeed.sourcePreviewOperationId,
        sourcePreviousResponseIdUsed: false,
      }, options);
      turn = this.sessionStore.createTurn(session.sessionId, {
        input: [{ role: "current_user_intent", text: currentUserPrompt }],
        model,
        clientTurnRequestId: clientDerivedForkStartId,
        requestShape: { schema: requestShapeClass, requestShapeHash, sourcePreviewKind },
        sourceClass: "forked-direct-native",
        nativeDirectSession: true,
        forkStartId,
        derivedForkSeedId: derivedForkSeed.derivedForkSeedId,
        sourcePreviewId,
        sourcePreviewKind,
        sourcePreviewDigest: seedPreview.projection.projectionDigest,
        previousResponseIdUsed: false,
        providerContinuityHandleUsed: false,
        sourceProviderContinuityHandleUsed: false,
      }, options);
      this.sessionStore.appendNormalizedEvents(session.sessionId, turn.turnId, [
        { type: "fork_session_created", forkStartId, sourcePreviewId, sourcePreviewKind },
        {
          type: "derived_fork_seed_built",
          forkStartId,
          derivedForkSeedId: derivedForkSeed.derivedForkSeedId,
          seedShapeHash: derivedForkSeed.seedShapeHash,
          sourcePreviewId,
          sourcePreviewKind,
          sourcePreviewDigest: seedPreview.projection.projectionDigest,
        },
      ], options);
      this.indexDirectThreadStoreSession(session.sessionId, options);
      const contextResult = store.buildAndPersistContextForDerivedPreviewForkStart({
        session: this.sessionStore.readSession(session.sessionId),
        projectId,
        threadId: session.sessionId,
        turnId: turn.turnId,
        forkStartId,
        derivedForkSeed,
        currentUserPrompt,
        model,
        requestShape: {
          schema: requestShapeClass,
          requestShapeClass,
          sourcePreviewKind,
          model,
          stream: true,
          store: false,
          tools: false,
          previousResponseId: false,
        },
        requestShapeHash,
        endpointClass: "chatgpt-codex-responses",
        endpointHash,
        modelEvidenceRef: normalizeString(status.evidenceId, status.modelEvidenceId || ""),
        requestShapeEvidenceRef: requestShapeClass,
        endpointEvidenceRef: endpointHash,
        accountEvidenceRef: normalizeString(status.auth?.accountId, ""),
      }, options);
      this.sessionStore.appendNormalizedEvents(session.sessionId, turn.turnId, [
        { type: "context_pack_built", contextBuildId: contextResult.contextPack.contextBuildId, contextPackContentHash: contextResult.contextPack.contextPackContentHash },
        { type: "request_manifest_built", requestManifestId: contextResult.requestManifest.requestManifestId },
      ], options);
      const requestShape = {
        schema: requestShapeClass,
        requestShapeHash,
        sourcePreviewKind,
        contextBuildId: contextResult.contextPack.contextBuildId,
        contextPackContentHash: contextResult.contextPack.contextPackContentHash,
        contextPackShapeHash: contextResult.contextPack.contextPackShapeHash,
        requestManifestId: contextResult.requestManifest.requestManifestId,
        providerInputShapeHash: contextResult.providerInput.projection.providerInputShapeHash,
        previousResponseIdUsed: false,
        providerContinuityHandleUsed: false,
        store: false,
        tools: false,
      };
      this.sessionStore.updateTurnState(session.sessionId, turn.turnId, "request_built", {
        requestShape,
        contextBuildId: contextResult.contextPack.contextBuildId,
        requestManifestId: contextResult.requestManifest.requestManifestId,
        derivedForkSeedId: derivedForkSeed.derivedForkSeedId,
        seedShapeHash: derivedForkSeed.seedShapeHash,
        parentForkLineage: derivedForkSeed.parentLineage,
        contextSummary: contextResult.rendererSafeSummary,
      }, options);
      this.sessionStore.appendNormalizedEvents(session.sessionId, turn.turnId, [
        {
          type: "request_built",
          forkStartId,
          derivedForkSeedId: derivedForkSeed.derivedForkSeedId,
          seedShapeHash: derivedForkSeed.seedShapeHash,
          contextBuildId: contextResult.contextPack.contextBuildId,
          requestManifestId: contextResult.requestManifest.requestManifestId,
          requestShapeHash,
          sourcePreviewKind,
          previousResponseIdUsed: false,
          providerContinuityHandleUsed: false,
        },
      ], options);
      this.indexDirectThreadStoreSession(session.sessionId, options);
      const lineageEdges = store.createDerivedForkLineageEdges({
        projectId,
        operationId: planned.operationId,
        forkThreadId: session.sessionId,
        sourcePreviewId,
        sourcePreviewKind,
        sourceThreadIds: derivedForkSeed.parentLineage.sourceThreadIds,
      }, options);
      const committed = store.commitOperation(planned.operationId, {
        operationType: "start_fork_turn",
        projectId,
        clientOperationId,
        target: { previewId: sourcePreviewId, previewKind: sourcePreviewKind, threadIds: [session.sessionId] },
        result: {
          status: "committed",
          operationInputDigest,
          forkStartId,
          derivedForkStartId: forkStartId,
          sourcePreviewKind,
          forkStatus: "request_built",
          createdThreadId: session.sessionId,
          createdSessionId: session.sessionId,
          createdTurnId: turn.turnId,
          effects: [
            { effectKind: "derived_fork_seed_created", targetKind: "projection", targetId: derivedForkSeed.derivedForkSeedId, rendererSafeSummary: "derived_fork_seed_created" },
            { effectKind: "fork_thread_created", targetKind: "direct_thread", targetId: session.sessionId, rendererSafeSummary: "fork_thread_created" },
            { effectKind: "fork_turn_request_built", targetKind: "direct_thread", targetId: turn.turnId, rendererSafeSummary: "provider turn pending" },
            ...lineageEdges.map((edge) => ({ effectKind: "lineage_edge_created", targetKind: "thread_edge", targetId: edge.edgeId, rendererSafeSummary: edge.edgeKind })),
          ],
        },
      }, options);
      operationCommitted = true;
      const requestBody = buildTextOnlyProbeRequest({
        profileDoc: this.profileDoc,
        model,
        prompt: contextResult.providerInput.prompt,
        instructions: contextResult.providerInput.instructions,
      });
      let result;
      const callerLifecycle = options.onLifecycle;
      try {
        result = await runTextOnlyDirectProbe({
          endpoint: this.endpoint || undefined,
          authStore: this.currentAuthStore(),
          refreshCredentials: this.refreshCredentials,
          profileDoc: this.profileDoc,
          model: requestBody.model,
          prompt: requestBody.input?.[0]?.content?.[0]?.text || contextResult.providerInput.prompt,
          instructions: requestBody.instructions,
          fetchImpl: this.fetchImpl || undefined,
          signal: options.signal,
          onLifecycle: (event) => {
            if (event.phase === "streaming") {
              this.sessionStore.updateTurnState(session.sessionId, turn.turnId, "streaming", {
                streamStartedAt: event.at,
                responseStatus: event.status,
                responseContentType: event.contentType,
              }, options);
            }
            if (typeof callerLifecycle === "function") callerLifecycle(event);
          },
        });
      } catch (error) {
        this.sessionStore.updateTurnState(session.sessionId, turn.turnId, "failed", {
          error: { code: error.code || "provider_transport_failed", message: error.message || "Provider transport failed." },
          forkStartStatus: "transport_handoff_unknown",
        }, options);
        return {
          forkStartId,
          operationId: committed.operationId,
          threadId: session.sessionId,
          sessionId: session.sessionId,
          turnId: turn.turnId,
          status: "transport_handoff_unknown",
          refreshRequired: true,
          rawPathExposed: false,
          rawUrlExposed: false,
          contextTextExposed: false,
          requestBodyExposed: false,
        };
      }
      this.sessionStore.writeDiagnostic(session.sessionId, "direct_derived_preview_fork_start", {
        ...result.diagnostic,
        forkStartId,
        derivedForkSeedId: derivedForkSeed.derivedForkSeedId,
        rawBackendFramesExposed: false,
        rawAuthHeadersExposed: false,
      }, options);
      if (result.normalizedEvents.length) this.sessionStore.appendNormalizedEvents(session.sessionId, turn.turnId, result.normalizedEvents, options);
      const assistantText = assistantTextFromNormalizedEvents(result.normalizedEvents);
      const unsupportedTool = result.normalizedEvents.some((event) => String(event.type || "").startsWith("tool_call_"));
      const terminal = firstForkTurnTerminal(result, assistantText, unsupportedTool, "Derived fork start");
      const completedTurn = this.sessionStore.updateTurnState(session.sessionId, turn.turnId, terminal.state, {
        ...(terminal.error ? { error: terminal.error } : {}),
        responseId: result.responseId || "",
        responseStatus: result.response?.status || 0,
        responseContentType: result.response?.contentType || "",
        forkStartStatus: terminal.state,
        firstTurnTerminalKind: terminal.terminalKind,
        localSessionState: terminal.state === "completed" ? "provider_completed" : "provider_sent_not_completed",
      }, options);
      const currentSession = this.sessionStore.readSession(session.sessionId);
      this.sessionStore.writeSession({
        ...currentSession,
        composerState: terminal.state === "completed" ? "enabled_after_completed_first_turn" : "disabled_streaming_interrupted",
      });
      this.appendSessionTurn(session.sessionId, turn.turnId, [
        {
          id: `${turn.turnId}_derived_fork_seed`,
          type: "harnessForkSeed",
          turnId: turn.turnId,
          text: derivedForkSeed.seedText.slice(0, 4096),
          forkStartId,
          forkSeedId: derivedForkSeed.derivedForkSeedId,
          derivedForkSeedId: derivedForkSeed.derivedForkSeedId,
          seedShapeHash: derivedForkSeed.seedShapeHash,
        },
        ...(assistantText ? [{
          id: `${turn.turnId}_assistant`,
          type: "agentMessage",
          turnId: turn.turnId,
          text: assistantText,
        }] : []),
      ], model, terminal.state);
      this.prepareDirectContextProjection(session.sessionId, options);
      return {
        forkStartId,
        operationId: committed.operationId,
        threadId: session.sessionId,
        sessionId: session.sessionId,
        turnId: turn.turnId,
        status: completedTurn.state,
        sourcePreviewKind,
        refreshRequired: true,
        rawPathExposed: false,
        rawUrlExposed: false,
        contextTextExposed: false,
        requestBodyExposed: false,
        firstTurnTerminalKind: terminal.terminalKind,
        localSessionState: terminal.state === "completed" ? "provider_completed" : "provider_sent_not_completed",
      };
    } catch (error) {
      if (!operationCommitted && session?.sessionId && turn?.turnId) {
        try {
          this.sessionStore.updateTurnState(session.sessionId, turn.turnId, "failed", {
            error: {
              code: error.code || error.message || "derived_fork_start_pre_transport_failed",
              message: error.message || "Derived preview fork start failed before provider transport.",
            },
            forkStartStatus: "failed",
          }, options);
          const currentSession = this.sessionStore.readSession(session.sessionId);
          this.sessionStore.writeSession({
            ...currentSession,
            composerState: "disabled_failed_pre_transport",
          });
          this.indexDirectThreadStoreSession(session.sessionId, options);
        } catch {}
      }
      if (!operationCommitted && planned?.operationId && typeof store.failOperation === "function") {
        try {
          store.failOperation(planned.operationId, {
            operationType: "start_fork_turn",
            projectId,
            clientOperationId,
            target: {
              previewId: sourcePreviewId,
              previewKind: sourcePreviewKind,
              threadIds: session?.sessionId ? [session.sessionId] : [],
            },
            result: {
              status: "failed",
              operationInputDigest,
              forkStartId,
              sourcePreviewKind,
              forkStatus: "failed",
              blockerCode: error.code || error.message || "derived_fork_start_pre_transport_failed",
              createdThreadId: session?.sessionId || "",
              createdSessionId: session?.sessionId || "",
              createdTurnId: turn?.turnId || "",
              effects: [{
                effectKind: "operation_failed_no_effect",
                targetKind: session?.sessionId ? "direct_thread" : "projection",
                targetId: session?.sessionId || sourcePreviewId,
                rendererSafeSummary: error.code || error.message || "derived_fork_start_pre_transport_failed",
              }],
            },
          }, options);
        } catch {}
      }
      throw error;
    } finally {
      this.forkStartLocks.delete(lockKey);
    }
  }

  async runImportCheckpointContinuation(options = {}) {
    const project = options.project || {};
    const status = this.assertReady(project);
    const seed = isPlainObject(options.seed) ? options.seed : null;
    if (!seed?.seedText) throw new Error("Direct import checkpoint continuation requires a seed.");
    const clientCheckpointContinuationId = normalizeString(options.clientCheckpointContinuationId, "");
    if (!clientCheckpointContinuationId) {
      const error = new Error("Direct import checkpoint continuation requires clientCheckpointContinuationId.");
      error.code = "missing_client_checkpoint_continuation_id";
      throw error;
    }
    const model = normalizeString(options.model, "") || status.model;
    const session = this.sessionStore.createSession({
      projectId: normalizeString(project.id || seed.projectId, ""),
      workspace: isPlainObject(project.workspace) ? project.workspace : {},
      workspaceDisplayPath: workspaceDisplayPath(project),
      title: `Checkpoint continuation ${normalizeString(seed.source?.sourceDisplayName, seed.importId)}`,
      model,
      runtimeMode: "direct-experimental",
      directTransport: DIRECT_LIVE_TEXT_SURFACE_TRANSPORT,
      modelSource: status.modelSource,
      modelEvidenceState: status.modelEvidenceState,
      modelEvidenceId: normalizeString(status.evidenceId, ""),
      profileSnapshotId: normalizeString(project.surfaceBinding?.codex?.profileId, ""),
      sourceClass: "direct-import-checkpoint-continuation",
      nativeDirectSession: true,
      parentImportLineage: options.parentImportLineage || null,
      checkpointContinuationId: normalizeString(options.continuationId, ""),
      checkpointSeedId: normalizeString(seed.seedId, ""),
      seedShapeHash: normalizeString(seed.seedShapeHash, ""),
      requestShapeHash: normalizeString(seed.requestShapeHash, ""),
      importedSessionId: normalizeString(seed.materializedSessionId, ""),
      importedSessionReadOnly: true,
    });
    let requestBody = buildTextOnlyProbeRequest({
      profileDoc: this.profileDoc,
      model,
      prompt: seed.seedText,
      instructions: "You are Codex running a fresh direct checkpoint continuation from quoted imported transcript evidence. Do not request tools.",
    });
    let requestShape = {
      ...requestShapeForDiagnostic(requestBody),
      schema: DIRECT_IMPORT_CHECKPOINT_REQUEST_SHAPE,
      seedShapeHash: seed.seedShapeHash,
      requestShapeHash: seed.requestShapeHash,
      previousResponseIdFromImportUsed: false,
      importedToolReplayAttempted: false,
    };
    const turn = this.sessionStore.createTurn(session.sessionId, {
      input: [{ role: "harness_checkpoint_seed", text: seed.seedText }],
      model: requestBody.model,
      clientTurnRequestId: clientCheckpointContinuationId,
      requestShape,
      sourceClass: "direct-import-checkpoint-continuation",
      nativeDirectSession: true,
      parentImportLineage: options.parentImportLineage || null,
      checkpointContinuationId: normalizeString(options.continuationId, ""),
      checkpointSeedId: normalizeString(seed.seedId, ""),
      seedShapeHash: normalizeString(seed.seedShapeHash, ""),
      importedSessionId: normalizeString(seed.materializedSessionId, ""),
      importedSessionReadOnly: true,
    });
    let contextResult = null;
    if (this.directThreadStore && typeof this.directThreadStore.buildAndPersistContextForCheckpointContinuation === "function") {
      this.indexDirectThreadStoreSession(session.sessionId, options);
      contextResult = this.directThreadStore.buildAndPersistContextForCheckpointContinuation({
        session,
        projectId: session.projectId,
        threadId: session.sessionId,
        turnId: turn.turnId,
        seed,
        currentUserPrompt: normalizeString(options.userPromptText, ""),
        model: requestBody.model,
        requestShape,
        requestShapeHash: normalizeString(seed.requestShapeHash, ""),
        endpointClass: "chatgpt-codex-responses",
        endpointHash: this.endpoint ? sha256(this.endpoint) : "",
        modelEvidenceRef: normalizeString(status.evidenceId, status.modelEvidenceId || ""),
        requestShapeEvidenceRef: normalizeString(seed.requestShapeHash, ""),
        endpointEvidenceRef: this.endpoint ? sha256(this.endpoint) : "",
      }, options);
      requestBody = buildTextOnlyProbeRequest({
        profileDoc: this.profileDoc,
        model,
        prompt: contextResult.providerInput.prompt,
        instructions: contextResult.providerInput.instructions,
      });
      requestShape = {
        ...requestShapeForDiagnostic(requestBody),
        schema: DIRECT_IMPORT_CHECKPOINT_REQUEST_SHAPE,
        seedShapeHash: seed.seedShapeHash,
        requestShapeHash: seed.requestShapeHash,
        contextBuildId: contextResult.contextPack.contextBuildId,
        contextPackContentHash: contextResult.contextPack.contextPackContentHash,
        requestManifestId: contextResult.requestManifest.requestManifestId,
        providerInputShapeHash: contextResult.providerInput.projection.providerInputShapeHash,
        previousResponseIdFromImportUsed: false,
        importedToolReplayAttempted: false,
      };
    }
    this.sessionStore.updateTurnState(session.sessionId, turn.turnId, "request_built", {
      requestShape,
      ...(contextResult ? {
        contextBuildId: contextResult.contextPack.contextBuildId,
        requestManifestId: contextResult.requestManifest.requestManifestId,
        contextSummary: contextResult.rendererSafeSummary,
      } : {}),
    }, options);

    const callerLifecycle = options.onLifecycle;
    const result = await runTextOnlyDirectProbe({
      endpoint: this.endpoint || undefined,
      authStore: this.currentAuthStore(),
      refreshCredentials: this.refreshCredentials,
      profileDoc: this.profileDoc,
      model: requestBody.model,
      prompt: requestBody.input?.[0]?.content?.[0]?.text || seed.seedText,
      instructions: requestBody.instructions,
      fetchImpl: this.fetchImpl || undefined,
      signal: options.signal,
      onLifecycle: (event) => {
        if (event.phase === "streaming") {
          this.sessionStore.updateTurnState(session.sessionId, turn.turnId, "streaming", {
            streamStartedAt: event.at,
            responseStatus: event.status,
            responseContentType: event.contentType,
          }, options);
        }
        if (typeof callerLifecycle === "function") callerLifecycle(event);
      },
    });
    this.sessionStore.writeDiagnostic(session.sessionId, "direct_import_checkpoint_continuation", {
      ...result.diagnostic,
      clientCheckpointContinuationId,
      directTransport: DIRECT_LIVE_TEXT_SURFACE_TRANSPORT,
      checkpointSeedId: seed.seedId,
      seedShapeHash: seed.seedShapeHash,
      rawBackendFramesExposed: false,
      rawAuthHeadersExposed: false,
    }, options);
    if (result.normalizedEvents.length) {
      this.sessionStore.appendNormalizedEvents(session.sessionId, turn.turnId, result.normalizedEvents, options);
    }
    const terminal = checkpointTerminalFromEvents(result.normalizedEvents, result.terminal || { state: result.ok ? "completed" : "failed", error: result.error || null });
    const completedTurn = this.sessionStore.updateTurnState(session.sessionId, turn.turnId, terminal.state, {
      ...(terminal.error ? { error: terminal.error } : {}),
      responseId: result.responseId || "",
      responseStatus: result.response?.status || 0,
      responseContentType: result.response?.contentType || "",
      sourceClass: "direct-import-checkpoint-continuation",
      checkpointContinuationId: normalizeString(options.continuationId, ""),
      checkpointSeedId: normalizeString(seed.seedId, ""),
      seedShapeHash: normalizeString(seed.seedShapeHash, ""),
    }, options);
    const assistantText = assistantTextFromNormalizedEvents(result.normalizedEvents);
    this.appendSessionTurn(
      session.sessionId,
      turn.turnId,
      [
        {
          id: `${turn.turnId}_checkpoint_seed`,
          type: "harnessCheckpointSeed",
          turnId: turn.turnId,
          text: seed.seedText.slice(0, 4096),
          seedId: seed.seedId,
          seedShapeHash: seed.seedShapeHash,
          importedSessionId: seed.materializedSessionId,
        },
        ...(assistantText
          ? [{
              id: `${turn.turnId}_assistant`,
              type: "agentMessage",
              turnId: turn.turnId,
              text: assistantText,
            }]
          : []),
      ],
      model,
      completedTurn.state,
    );
    const persistedSession = this.sessionStore.readSession(session.sessionId) || session;
    this.sessionStore.writeSession({
      ...persistedSession,
      sourceClass: "direct-import-checkpoint-continuation",
      nativeDirectSession: true,
      parentImportLineage: options.parentImportLineage || null,
      checkpointContinuationId: normalizeString(options.continuationId, ""),
      checkpointSeedId: normalizeString(seed.seedId, ""),
      seedShapeHash: normalizeString(seed.seedShapeHash, ""),
      requestShapeHash: normalizeString(seed.requestShapeHash, ""),
      importedSessionId: normalizeString(seed.materializedSessionId, ""),
      importedSessionReadOnly: true,
    });
    return {
      ...result,
      sessionId: session.sessionId,
      turnId: turn.turnId,
      turnState: completedTurn.state,
      terminal,
    };
  }

  readOnlyToolRequestParams(obligation = {}, turn = {}, project = {}) {
    let relPath = "";
    let argumentsError = "";
    try {
      const parsed = JSON.parse(normalizeString(obligation.argumentsText, "{}"));
      if (isPlainObject(parsed)) relPath = normalizeString(parsed.path || parsed.relPath || parsed.relativePath, "");
    } catch (error) {
      argumentsError = error?.message || "invalid_tool_arguments";
    }
    const parentResponseId = parentResponseIdForToolStep(turn, obligation);
    const parentResponseSource = parentResponseSourceForToolStep(obligation);
    const hasContinuityHandle = Boolean(parentResponseId);
    const providerCallType = normalizeString(obligation.providerCallType || obligation.toolType, "");
    const namespace = normalizeString(obligation.namespace, "");
    const supportedCallType = providerCallType === "function_call" || providerCallType === "custom_tool_call";
    const supportedNamespace = !namespace;
    const continuationEvidence = this.statusForProject(project).readOnlyToolContinuation || readOnlyContinuationEvidenceFor(this.profileDoc);
    const approvalAvailable = normalizeString(obligation.status, "") === "waiting" &&
      !argumentsError &&
      Boolean(normalizeString(obligation.callId, "")) &&
      hasContinuityHandle &&
      supportedCallType &&
      supportedNamespace &&
      continuationEvidence.status === "ready";
    const obligationDigest = sha256(stableStringify({
      obligationId: normalizeString(obligation.obligationId, ""),
      toolLoopId: normalizeString(obligation.toolLoopId, ""),
      stepId: normalizeString(obligation.stepId, ""),
      stepOrdinal: Number(obligation.stepOrdinal || 1),
      status: normalizeString(obligation.status, ""),
      callIdDigest: sha256(obligation.callId || ""),
      argumentsDigest: sha256(obligation.argumentsText || ""),
      responseIdDigest: sha256(parentResponseId),
    }));
    const actionToken = (action) => `direct_tool_action_${sha256(`${obligation.toolLoopId || ""}:${obligation.stepId || ""}:${obligation.obligationId}:${action}:${obligationDigest}`).slice(0, 24)}`;
    return {
      sessionId: obligation.sessionId,
      threadId: obligation.sessionId,
      turnId: obligation.turnId,
      obligationId: obligation.obligationId,
      toolLoopId: normalizeString(obligation.toolLoopId, ""),
      stepId: normalizeString(obligation.stepId, ""),
      stepOrdinal: Number(obligation.stepOrdinal || 1),
      obligationDigest,
      operationLedgerHeadDigest: normalizeString(turn?.operationLedgerHeadDigest || turn?.ledgerDigest, ""),
      tool: normalizeString(obligation.name, "read_file"),
      relPath,
      providerCallType,
      namespace,
      toolCallSource: normalizeString(obligation.toolCallSource, "provider-native-implicit"),
      callIdPresent: Boolean(normalizeString(obligation.callId, "")),
      hasContinuityHandle,
      parentResponseSource,
      parentResponseDigest: sha256(parentResponseId),
      toolContinuationEvidence: continuationEvidence,
      approvalAvailable,
      argumentsError,
      maxReadFileBytes: 384 * 1024,
      maxProviderOutputChars: 64 * 1024,
      maxApprovalPreviewChars: 512,
      maxToolLoopSteps: MAX_READONLY_TOOL_LOOP_STEPS,
      sensitivePathPolicy: "deny-by-default",
      actionTokens: {
        approve: actionToken("approve"),
        decline: actionToken("decline"),
        cancel: actionToken("cancel"),
      },
      rawWorkspacePathExposed: false,
    };
  }

  isPatchApplyObligation(obligation = {}) {
    return APPLY_PATCH_TOOL_NAMES.has(normalizeString(obligation.name, ""));
  }

  patchApplyRequestParams(obligation = {}, turn = {}, project = {}) {
    const parentResponseId = parentResponseIdForToolStep(turn, obligation);
    const parentResponseSource = parentResponseSourceForToolStep(obligation);
    const hasContinuityHandle = Boolean(parentResponseId);
    const providerCallType = normalizeString(obligation.providerCallType || obligation.toolType, "");
    const namespace = normalizeString(obligation.namespace, "");
    const supportedCallType = providerCallType === "function_call" || providerCallType === "custom_tool_call";
    const supportedNamespace = !namespace;
    const patchEvidence = this.statusForProject(project).patchApplyContinuation || patchApplyContinuationEvidenceFor(this.profileDoc);
    const patchPlan = isPlainObject(obligation.patchPlan) ? obligation.patchPlan : null;
    const approvalAvailable = normalizeString(obligation.status, "") === "patch_planned" &&
      Boolean(normalizeString(obligation.callId, "")) &&
      hasContinuityHandle &&
      supportedCallType &&
      supportedNamespace &&
      scopedProofApprovalReady(patchEvidence) &&
      patchPlan?.status === "dry_run_passed" &&
      patchPlan?.preview?.truncated !== true;
    const obligationDigest = sha256(stableStringify({
      obligationId: normalizeString(obligation.obligationId, ""),
      patchPlanId: normalizeString(patchPlan?.patchPlanId, ""),
      status: normalizeString(obligation.status, ""),
      callIdDigest: sha256(obligation.callId || ""),
      argumentsDigest: sha256(obligation.argumentsText || ""),
      responseIdDigest: sha256(parentResponseId),
      planDigest: normalizeString(patchPlan?.integrity?.artifactDigest, ""),
    }));
    const actionToken = (action) => `direct_patch_action_${sha256(`${obligation.obligationId}:${action}:${obligationDigest}`).slice(0, 24)}`;
    return {
      sessionId: obligation.sessionId,
      threadId: obligation.sessionId,
      turnId: obligation.turnId,
      obligationId: obligation.obligationId,
      patchPlanId: normalizeString(patchPlan?.patchPlanId, ""),
      obligationDigest,
      operationLedgerHeadDigest: normalizeString(turn?.operationLedgerHeadDigest || turn?.ledgerDigest, ""),
      tool: "apply_patch",
      providerCallType,
      namespace,
      toolCallSource: normalizeString(obligation.toolCallSource, "provider-native-implicit"),
      callIdPresent: Boolean(normalizeString(obligation.callId, "")),
      hasContinuityHandle,
      parentResponseSource,
      parentResponseDigest: sha256(parentResponseId),
      patchApplyEvidence: patchEvidence,
      approvalAvailable,
      files: Array.isArray(patchPlan?.files)
        ? patchPlan.files.map((file) => ({
            path: normalizeString(file.displayPath || file.path, ""),
            operation: normalizeString(file.operation, "update"),
            addedLineCount: Number(file.addedLineCount || 0),
            removedLineCount: Number(file.removedLineCount || 0),
            hunkCount: Number(file.hunkCount || 0),
          }))
        : [],
      totals: isPlainObject(patchPlan?.totals) ? patchPlan.totals : {},
      preview: {
        text: normalizeString(patchPlan?.preview?.text, ""),
        textHash: normalizeString(patchPlan?.preview?.textHash, ""),
        truncated: patchPlan?.preview?.truncated === true,
      },
      maxPatchTextChars: MAX_PATCH_TEXT_CHARS,
      maxApprovalPreviewChars: MAX_PATCH_APPROVAL_CARD_CHARS,
      actionTokens: {
        approve: actionToken("approve"),
        decline: actionToken("decline"),
        cancel: actionToken("cancel"),
      },
      rawWorkspacePathExposed: false,
      rawPatchExposed: false,
    };
  }

  isCommandExecutionObligation(obligation = {}) {
    return RUN_COMMAND_TOOL_NAMES.has(normalizeString(obligation.name, ""));
  }

  commandExecutionRequestParams(obligation = {}, turn = {}, project = {}) {
    const parentResponseId = parentResponseIdForToolStep(turn, obligation);
    const parentResponseSource = parentResponseSourceForToolStep(obligation);
    const hasContinuityHandle = Boolean(parentResponseId);
    const providerCallType = normalizeString(obligation.providerCallType || obligation.toolType, "");
    const namespace = normalizeString(obligation.namespace, "");
    const supportedCallType = providerCallType === "function_call" || providerCallType === "custom_tool_call";
    const supportedNamespace = !namespace;
    const commandEvidence = this.statusForProject(project).commandExecutionContinuation || commandExecutionContinuationEvidenceFor(this.profileDoc);
    const commandPlan = isPlainObject(obligation.commandPlan) ? obligation.commandPlan : null;
    const approvalAvailable = normalizeString(obligation.status, "") === "command_planned" &&
      Boolean(normalizeString(obligation.callId, "")) &&
      hasContinuityHandle &&
      supportedCallType &&
      supportedNamespace &&
      scopedProofApprovalReady(commandEvidence) &&
      commandPlan?.status === "planned";
    const obligationDigest = sha256(stableStringify({
      obligationId: normalizeString(obligation.obligationId, ""),
      commandPlanId: normalizeString(commandPlan?.commandPlanId, ""),
      status: normalizeString(obligation.status, ""),
      callIdDigest: sha256(obligation.callId || ""),
      argumentsDigest: sha256(obligation.argumentsText || ""),
      responseIdDigest: sha256(parentResponseId),
      planDigest: normalizeString(commandPlan?.integrity?.artifactDigest, ""),
    }));
    const actionToken = (action) => `direct_command_action_${sha256(`${obligation.obligationId}:${action}:${obligationDigest}`).slice(0, 24)}`;
    return {
      sessionId: obligation.sessionId,
      threadId: obligation.sessionId,
      turnId: obligation.turnId,
      obligationId: obligation.obligationId,
      commandPlanId: normalizeString(commandPlan?.commandPlanId, ""),
      obligationDigest,
      operationLedgerHeadDigest: normalizeString(turn?.operationLedgerHeadDigest || turn?.ledgerDigest, ""),
      tool: "run_command",
      providerCallType,
      namespace,
      toolCallSource: normalizeString(obligation.toolCallSource, "provider-native-implicit"),
      callIdPresent: Boolean(normalizeString(obligation.callId, "")),
      hasContinuityHandle,
      parentResponseSource,
      parentResponseDigest: sha256(parentResponseId),
      commandExecutionEvidence: commandEvidence,
      approvalAvailable,
      command: normalizeString(commandPlan?.command, ""),
      args: Array.isArray(commandPlan?.args) ? commandPlan.args : [],
      displayCommand: normalizeString(commandPlan?.displayCommand, "run_command"),
      cwdRelPath: normalizeString(commandPlan?.cwdRelPath, ""),
      timeoutMs: Number(commandPlan?.timeoutMs || 0),
      commandClass: normalizeString(commandPlan?.commandClass, "package_script"),
      workspaceWritePolicy: normalizeString(commandPlan?.workspaceWritePolicy, "writes_possible_with_warning"),
      packageScriptEvidence: isPlainObject(commandPlan?.packageScriptEvidence) ? {
        packageManager: normalizeString(commandPlan.packageScriptEvidence.packageManager, ""),
        packageJsonRelPath: normalizeString(commandPlan.packageScriptEvidence.packageJsonRelPath, ""),
        scriptName: normalizeString(commandPlan.packageScriptEvidence.scriptName, ""),
        scriptExists: commandPlan.packageScriptEvidence.scriptExists === true,
        scriptCommandEvidenceKey: normalizeString(commandPlan.packageScriptEvidence.scriptCommandEvidenceKey, ""),
        scriptCommandPreview: normalizeString(commandPlan.packageScriptEvidence.scriptCommandPreview, ""),
        scriptCommandPreviewTruncated: commandPlan.packageScriptEvidence.scriptCommandPreviewTruncated === true,
        lifecycleScriptCount: Number(commandPlan.packageScriptEvidence.lifecycleScriptCount || 0),
        lifecycleScripts: Array.isArray(commandPlan.packageScriptEvidence.lifecycleScripts)
          ? commandPlan.packageScriptEvidence.lifecycleScripts.map((script) => ({
              scriptName: normalizeString(script.scriptName, ""),
              scriptCommandEvidenceKey: normalizeString(script.scriptCommandEvidenceKey, ""),
              scriptCommandPreview: normalizeString(script.scriptCommandPreview, ""),
              scriptCommandPreviewTruncated: script.scriptCommandPreviewTruncated === true,
              lifecycleKind: normalizeString(script.lifecycleKind, ""),
            }))
          : [],
        scriptPolicyWarning: normalizeString(commandPlan.packageScriptEvidence.scriptPolicyWarning, ""),
      } : {},
      safety: {
        shellFalse: true,
        knownNetworkCommandHelpersBlocked: true,
        networkAccessNotProvenAbsent: true,
        workspaceWritesPossible: true,
        rawWorkspacePathExposed: false,
      },
      actionTokens: {
        approve: actionToken("approve"),
        decline: actionToken("decline"),
        cancel: actionToken("cancel"),
      },
      rawWorkspacePathExposed: false,
      rawCommandOutputExposed: false,
    };
  }

  async emitCommandExecutionApprovalRequest(surfaceSession, sessionId, turnId, obligation = {}, project = {}) {
    if (!surfaceSession || typeof surfaceSession.createCommandExecutionRequest !== "function") return 0;
    if (typeof this.workspaceRequest !== "function") {
      this.sessionStore.updateToolObligation(sessionId, turnId, obligation.obligationId, {
        status: "unsupported",
        authorityState: "unsupported",
        approvalAvailable: false,
        executionAllowed: false,
        continuationAllowed: false,
        failureKind: "workspace_command_backend_unavailable",
      }, {
        nextTurnState: "failed",
        turnPatch: {
          error: {
            code: "workspace_command_backend_unavailable",
            message: "Direct command execution requires the workspace backend.",
          },
        },
      });
      return 0;
    }
    let planned = null;
    try {
      planned = await planCommandExecutionObligation({
        sessionStore: this.sessionStore,
        sessionId,
        turnId,
        obligationId: obligation.obligationId,
        workspaceRequest: (method, params) => this.workspaceRequest(project, method, params, this.readOnlyWorkspaceTimeoutMs),
      });
    } catch (error) {
      this.sessionStore.updateToolObligation(sessionId, turnId, obligation.obligationId, {
        status: "unsupported",
        authorityState: "unsupported",
        approvalAvailable: false,
        executionAllowed: false,
        continuationAllowed: false,
        failureKind: error.code || "command_plan_failed",
      }, {
        nextTurnState: "failed",
        turnPatch: {
          error: {
            code: error.code || "command_plan_failed",
            message: error.message || "Command plan failed.",
          },
        },
      });
      return 0;
    }
    const turn = this.sessionStore.readTurn(sessionId, turnId) || {};
    const params = this.commandExecutionRequestParams(planned.obligation, turn, project);
    if (!params.approvalAvailable) {
      const code = !params.hasContinuityHandle
        ? "continuation_missing_context_handle"
        : (params.commandExecutionEvidence?.status !== "ready" ? "command_tool_evidence_missing" : "unsupported_command_tool_shape");
      this.sessionStore.updateToolObligation(sessionId, turnId, obligation.obligationId, {
        status: "unsupported",
        authorityState: "unsupported",
        approvalAvailable: false,
        executionAllowed: false,
        continuationAllowed: false,
        failureKind: code,
      }, {
        nextTurnState: "failed",
        turnPatch: {
          error: {
            code,
            message: "Direct command execution cannot be approved for continuation in this runtime bundle.",
          },
        },
      });
      return 0;
    }
    this.sessionStore.updateToolObligation(sessionId, turnId, obligation.obligationId, {
      approvalAvailable: true,
      authorityState: "command_waiting_for_approval",
    }, {
      nextTurnState: "tool_waiting",
    });
    surfaceSession.createCommandExecutionRequest({
      params,
      summary: params.displayCommand || "run_command",
    });
    return 1;
  }

  async emitPatchApplyApprovalRequest(surfaceSession, sessionId, turnId, obligation = {}, project = {}) {
    if (!surfaceSession || typeof surfaceSession.createPatchApplyRequest !== "function") return 0;
    if (typeof this.workspaceRequest !== "function") {
      this.sessionStore.updateToolObligation(sessionId, turnId, obligation.obligationId, {
        status: "unsupported",
        authorityState: "unsupported",
        approvalAvailable: false,
        executionAllowed: false,
        continuationAllowed: false,
        failureKind: "workspace_patch_backend_unavailable",
      }, {
        nextTurnState: "failed",
        turnPatch: {
          error: {
            code: "workspace_patch_backend_unavailable",
            message: "Direct patch apply requires the workspace backend.",
          },
        },
      });
      return 0;
    }
    let planned = null;
    try {
      planned = await planPatchApplyObligation({
        sessionStore: this.sessionStore,
        sessionId,
        turnId,
        obligationId: obligation.obligationId,
        workspaceRequest: (method, params) => this.workspaceRequest(project, method, params, this.readOnlyWorkspaceTimeoutMs),
      });
    } catch (error) {
      this.sessionStore.updateToolObligation(sessionId, turnId, obligation.obligationId, {
        status: "unsupported",
        authorityState: "unsupported",
        approvalAvailable: false,
        executionAllowed: false,
        continuationAllowed: false,
        failureKind: error.code || "patch_plan_failed",
      }, {
        nextTurnState: "failed",
        turnPatch: {
          error: {
            code: error.code || "patch_plan_failed",
            message: error.message || "Patch dry-run failed.",
          },
        },
      });
      return 0;
    }
    const turn = this.sessionStore.readTurn(sessionId, turnId) || {};
    const params = this.patchApplyRequestParams(planned.obligation, turn, project);
    if (!params.approvalAvailable) {
      const code = !params.hasContinuityHandle
        ? "continuation_missing_context_handle"
        : (params.patchApplyEvidence?.status !== "ready" ? "patch_tool_evidence_missing" : "unsupported_patch_tool_shape");
      this.sessionStore.updateToolObligation(sessionId, turnId, obligation.obligationId, {
        status: "unsupported",
        authorityState: "unsupported",
        approvalAvailable: false,
        executionAllowed: false,
        continuationAllowed: false,
        failureKind: code,
      }, {
        nextTurnState: "failed",
        turnPatch: {
          error: {
            code,
            message: "Direct patch apply cannot be approved for continuation in this runtime bundle.",
          },
        },
      });
      return 0;
    }
    this.sessionStore.updateToolObligation(sessionId, turnId, obligation.obligationId, {
      approvalAvailable: true,
      authorityState: "patch_waiting_for_approval",
    }, {
      nextTurnState: "tool_waiting",
    });
    surfaceSession.createPatchApplyRequest({
      params,
      summary: params.files.map((file) => `${file.operation} ${file.path}`).join("; ") || "apply_patch",
    });
    return 1;
  }

  isSafeResidentUtilityObligation(obligation = {}) {
    return isSafeResidentUtilityToolName(obligation.name);
  }

  buildSafeResidentUtilityEnvelope(obligation = {}, options = {}) {
    const projectId = normalizeString(options.project?.id || options.project?.projectId || options.project?.name, "");
    const toolName = normalizeString(obligation.name, "");
    const slice = buildSafeResidentUtilitySlice(toolName, projectId);
    const gate = buildDirectFirstToolCallGate({
      slice,
      toolCall: {
        itemId: normalizeString(obligation.sourceItemId, ""),
        callId: normalizeString(obligation.callId, ""),
        name: toolName,
        arguments: normalizeString(obligation.argumentsText, "{}"),
      },
    });
    const workThreadId = normalizeString(directWorkThreadContextCarrier(options).workThreadId, "");
    const baseInput = {
      projectId,
      workThreadId,
      threadId: normalizeString(options.sessionId, obligation.sessionId),
      turnId: normalizeString(options.turnId, obligation.turnId),
    };
    if (toolName === "get_context_remaining") {
      const status = this.statusForProject(options.project || {});
      const context = isPlainObject(status.context) ? status.context : {};
      return buildContextRemainingResultEnvelope({
        gate,
        contextRemainingInput: {
          ...baseInput,
          model: normalizeString(status.model, ""),
          contextWindow: Number(context.contextWindow || context.windowTokens || status.contextWindow || 0),
          usedTokens: Number(context.usedTokens || context.contextTokensUsed || status.contextUsedTokens || 0),
          remainingTokens: Number(context.remainingTokens || context.contextTokensRemaining || status.contextRemainingTokens || 0),
          confidence: normalizeString(context.confidence, "estimated"),
          estimateKind: normalizeString(context.estimateKind, "harness_estimate"),
        },
      });
    }
    if (toolName === "update_plan") {
      return buildUpdatePlanResultEnvelope({
        gate,
        ...baseInput,
      });
    }
    return buildRequestUserInputResultEnvelope({
      gate,
      ...baseInput,
    });
  }

  utilityContinuationRequestFromEnvelope(sessionId, turnId, obligation = {}, envelope = {}) {
    const outputType = normalizeString(obligation.providerCallType || obligation.toolType, "") === "custom_tool_call"
      ? "custom_tool_call_output"
      : "function_call_output";
    const resultId = normalizeString(envelope.envelopeId, `utility_result_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`);
    const providerOutputText = JSON.stringify(envelope.providerOutput || {
      kind: `${normalizeString(obligation.name, "utility")}_result`,
      status: normalizeString(envelope.status, "ready_for_provider_continuation"),
    });
    return {
      schema: "direct_safe_resident_utility_continuation_request@1",
      continuationId: `utility_continuation_${sha256(`${obligation.obligationId}:${resultId}`).slice(0, 20)}`,
      sessionId,
      turnId,
      obligationId: obligation.obligationId,
      createdAt: nowIso(),
      source: {
        fromRecordedResult: true,
        recordedResultId: resultId,
        recordedAt: nowIso(),
      },
      toolLoop: {
        toolLoopId: normalizeString(obligation.toolLoopId, `utility_loop_${sha256(`${sessionId}:${turnId}`).slice(0, 20)}`),
        stepId: normalizeString(obligation.stepId, `utility_step_${sha256(`${obligation.obligationId}:${resultId}`).slice(0, 20)}`),
        stepOrdinal: Number(obligation.stepOrdinal || 1) || 1,
        parentResponseId: normalizeString(obligation.parentResponseId, ""),
        parentResponseSource: normalizeString(obligation.parentResponseSource, ""),
        parentResponseDigest: normalizeString(obligation.parentResponseDigest, ""),
      },
      toolResult: {
        obligationId: obligation.obligationId,
        callId: normalizeString(obligation.callId, ""),
        itemId: normalizeString(obligation.sourceItemId, ""),
        toolCallId: normalizeString(obligation.callId, ""),
        name: normalizeString(obligation.name, ""),
        providerCallType: normalizeString(obligation.providerCallType || obligation.toolType, "function_call"),
        outputType,
        content: [{ type: outputType, text: providerOutputText }],
        metadata: {
          resultId,
          status: normalizeString(envelope.status, "ready_for_provider_continuation"),
          resultKind: normalizeString(envelope.resultKind, "safe_resident_utility"),
        },
      },
      safety: {
        fromRecordedResult: true,
        originalRequestRetried: false,
        sideEffectExecuted:
          envelope.sideEffectExecuted === true ||
          envelope.runtimeLifecycleMutationExecuted === true,
        semanticEffectRecorded: envelope.semanticEffectRecorded === true,
        canonicalEffect: envelope.canonicalEffect === true,
        workspaceBackendOnly: false,
        utilityToolResult: true,
        continuationLiveSendEnabled: true,
      },
      requestControls: {
        store: false,
        parallelToolCalls: false,
        toolDeclarations: false,
        toolOutputItem: true,
        previousResponseId: false,
      },
      rawAuthHeadersExposed: false,
      rawBackendRequestsExposed: false,
      rawBackendFramesExposed: false,
    };
  }

  recordSafeResidentUtilityResult(sessionId, turnId, obligation = {}, envelope = {}) {
    const continuationRequest = this.utilityContinuationRequestFromEnvelope(sessionId, turnId, obligation, envelope);
    const providerOutputText = normalizeString(continuationRequest.toolResult?.content?.[0]?.text, "{}");
    const result = {
      schema: "direct_safe_resident_utility_result@1",
      resultId: normalizeString(continuationRequest.toolResult?.metadata?.resultId, ""),
      envelopeId: normalizeString(envelope.envelopeId, ""),
      envelopeDigest: normalizeString(envelope.envelopeDigest, ""),
      gateId: normalizeString(envelope.gateId, ""),
      gateDigest: normalizeString(envelope.gateDigest, ""),
      resultKind: normalizeString(envelope.resultKind, "safe_resident_utility"),
      status: normalizeString(envelope.status, "ready_for_provider_continuation"),
      providerOutputText,
      providerOutputChars: providerOutputText.length,
      sideEffectExecuted:
        envelope.sideEffectExecuted === true ||
        envelope.runtimeLifecycleMutationExecuted === true,
      semanticEffectRecorded: envelope.semanticEffectRecorded === true,
      canonicalEffect: envelope.canonicalEffect === true,
      rawWorkspacePathExposed: false,
      rawSecretExposed: false,
      recordedAt: nowIso(),
    };
    const updated = this.sessionStore.updateToolObligation(sessionId, turnId, obligation.obligationId, {
      status: "result_recorded",
      authorityState: "utility_result_recorded",
      approvalAvailable: false,
      executionAllowed: false,
      sideEffectExecuted:
        envelope.sideEffectExecuted === true ||
        envelope.runtimeLifecycleMutationExecuted === true,
      continuationAllowed: true,
      result,
      continuationRequest,
      resultRecordedAt: result.recordedAt,
    }, {
      nextTurnState: "continuation_ready",
    });
    return { result, continuationRequest, obligation: updated.obligation };
  }

  appendUtilityContinuationMessage(sessionId, turnId, continuationId, normalizedEvents = [], terminal = {}) {
    const text = assistantTextFromDirectEvents(normalizedEvents);
    if (!text) return;
    const session = this.sessionStore.readSession(sessionId);
    if (!session || !Array.isArray(session.messages)) return;
    this.sessionStore.writeSession({
      ...session,
      status: normalizeString(terminal.state, session.status),
      updatedAt: nowIso(),
      messages: session.messages.map((message) => {
        if (message.id !== turnId) return message;
        const itemId = `${turnId}_${continuationId}_assistant`;
        const existingItems = Array.isArray(message.items) ? message.items : [];
        return {
          ...message,
          status: normalizeString(terminal.state, message.status),
          items: [
            ...existingItems.filter((item) => item?.id !== itemId),
            { id: itemId, type: "agentMessage", turnId, text },
          ],
        };
      }),
    });
  }

  async continueAfterSafeResidentUtilityResult(surfaceSession, sessionId, turnId, obligation = {}, envelope = {}, project = {}) {
    const recorded = this.recordSafeResidentUtilityResult(sessionId, turnId, obligation, envelope);
    const continuationRequest = recorded.continuationRequest;
    const turn = this.sessionStore.readTurn(sessionId, turnId) || {};
    this.sessionStore.updateToolObligation(sessionId, turnId, obligation.obligationId, {
      status: "continuation_sent",
      authorityState: "continuation_sent",
      continuationAllowed: false,
      continuationSentAt: nowIso(),
    }, {
      nextTurnState: "continuation_sent",
    });
    const result = await runReadOnlyToolContinuationProbe({
      continuationRequest,
      continuationTransportMode: "fresh_context",
      endpoint: this.endpoint || undefined,
      authStore: this.currentAuthStore(),
      refreshCredentials: this.refreshCredentials,
      profileDoc: this.profileDoc,
      model: normalizeString(turn.model, ""),
      fetchImpl: this.fetchImpl || undefined,
      instructions: DEFAULT_TOOL_CONTINUATION_INSTRUCTIONS,
      continuationTools: [],
      onLifecycle: (event) => {
        if (event.phase === "streaming") {
          this.emitNotification(surfaceSession, "turn/started", {
            threadId: sessionId,
            turnId,
            turn: { id: turnId, status: "inProgress", startedAt: nowSeconds(), streamPhase: "utility-continuation" },
          });
        }
      },
    });
    this.sessionStore.writeDiagnostic(sessionId, "direct_safe_resident_utility_continuation", result.diagnostic, {});
    if (Array.isArray(result.normalizedEvents) && result.normalizedEvents.length) {
      this.sessionStore.appendNormalizedEvents(sessionId, turnId, result.normalizedEvents, {});
    }
    const terminal = result.terminal || terminalStateFromNormalizedEvents(result.normalizedEvents || []);
    const completedTurn = this.sessionStore.updateTurnState(sessionId, turnId, terminal.state, {
      continuationResponseId: normalizeString(result.responseId, ""),
      continuationResult: {
        schema: result.schema,
        ok: result.ok === true && terminal.state === "completed",
        terminal,
        responseId: result.responseId,
        continuationOutcome: terminal.state === "completed" ? "assistant_final" : normalizeString(terminal.error?.code, "utility_continuation_failed"),
        normalizedEventCount: Array.isArray(result.normalizedEvents) ? result.normalizedEvents.length : 0,
        originalRequestRetried: false,
      },
    }, {});
    const continuationId = normalizeString(result.continuation?.continuationId || continuationRequest.continuationId, "utility_continuation");
    this.appendUtilityContinuationMessage(sessionId, turnId, continuationId, result.normalizedEvents || [], terminal);
    this.emitContinuationAssistant(surfaceSession, sessionId, turnId, continuationId, result.normalizedEvents || []);
    this.emitNotification(surfaceSession, "turn/completed", {
      threadId: sessionId,
      turnId,
      turn: {
        id: turnId,
        status: terminalStatusForState(completedTurn.state),
        completedAt: nowSeconds(),
        streamPhase: "utility-continuation",
      },
    });
    this.sessionStore.updateToolObligation(sessionId, turnId, obligation.obligationId, {
      status: "continuation_sent",
      authorityState: "continuation_sent",
      continuationResult: {
        schema: result.schema,
        ok: result.ok === true && terminal.state === "completed",
        terminal,
        responseId: result.responseId,
      },
    }, {});
    return {
      decision: "utility_continued",
      turn: turnSnapshot(this.sessionStore.readTurn(sessionId, turnId)),
      obligation: this.sessionStore.findToolObligation(sessionId, turnId, obligation.obligationId).obligation,
      envelope,
      continuation: {
        ok: result.ok === true && terminal.state === "completed",
        continuationId,
        terminal,
      },
    };
  }

  async emitSafeResidentUtilityRequest(surfaceSession, sessionId, turnId, obligation = {}, project = {}) {
    const envelope = this.buildSafeResidentUtilityEnvelope(obligation, { sessionId, turnId, project });
    if (obligation.name === "request_user_input") {
      if (!surfaceSession || typeof surfaceSession.createUserInputRequest !== "function") return 0;
      const recorded = this.recordSafeResidentUtilityResult(sessionId, turnId, obligation, envelope);
      this.sessionStore.updateToolObligation(sessionId, turnId, obligation.obligationId, {
        status: "waiting",
        authorityState: "human_decision_waiting",
        approvalAvailable: true,
        continuationAllowed: true,
      }, {
        nextTurnState: "authority_waiting",
      });
      surfaceSession.createUserInputRequest({
        params: {
          sessionId,
          turnId,
          obligationId: obligation.obligationId,
          envelopeId: envelope.envelopeId,
          decisionPacketId: envelope.decisionPacket?.decisionPacketId,
          questions: [{
            id: normalizeString(envelope.decisionPacket?.decisionPacketId, "decision"),
            header: "Codex asks",
            question: normalizeString(envelope.decisionPacket?.promptPreview, "Codex requested user input."),
            options: (Array.isArray(envelope.decisionPacket?.choices) ? envelope.decisionPacket.choices : []).map((choice) => ({
              id: normalizeString(choice.choiceId, choice.label),
              label: normalizeString(choice.label, "Option"),
              description: normalizeString(choice.description, ""),
            })),
          }],
          rawPromptIncluded: false,
          authorityGranted: false,
        },
        summary: normalizeString(envelope.decisionPacket?.promptPreview, "request_user_input"),
      });
      return recorded ? 1 : 0;
    }
    await this.continueAfterSafeResidentUtilityResult(surfaceSession, sessionId, turnId, obligation, envelope, project);
    return 1;
  }

  isReadOnlySubAgentStatusObligation(obligation = {}) {
    return isReadOnlySubAgentStatusToolName(obligation?.name);
  }

  buildReadOnlySubAgentStatusSurface(sessionId, turnId, project = {}) {
    if (this.subAgentStatusSurfaceResolver) {
      try {
        const resolved = this.subAgentStatusSurfaceResolver({ sessionId, turnId, project });
        if (resolved && typeof resolved.listAgents === "function" && typeof resolved.inspectAgent === "function") {
          return resolved;
        }
      } catch (_error) {
        return unavailableSubAgentStatusSurface(sessionId, project);
      }
    }
    return unavailableSubAgentStatusSurface(sessionId, project);
  }

  buildReadOnlySubAgentStatusEnvelope(sessionId, turnId, obligation = {}, project = {}) {
    const toolName = normalizeString(obligation?.name, "");
    const args = parseToolArgumentsObject(obligation);
    const statusSurface = this.buildReadOnlySubAgentStatusSurface(sessionId, turnId, project);
    const result = (toolName === "list_agents"
      ? statusSurface?.listAgents?.()
      : statusSurface?.inspectAgent?.({
          childAgentId: normalizeString(args.childAgentId || args.agentThreadId || args.targetAgentId, ""),
        })) || unavailableSubAgentStatusSurface(sessionId, project).inspectAgent({
          childAgentId: normalizeString(args.childAgentId || args.agentThreadId || args.targetAgentId, ""),
        });
    const providerOutput = summarizeSubAgentStatusResult(toolName, result);
    const envelope = {
      schema: "direct_read_only_sub_agent_status_result_envelope@1",
      envelopeId: `sub_agent_status_result_${sha256(`${sessionId}:${turnId}:${obligation.obligationId}:${result.resultDigest || stableStringify(providerOutput)}`).slice(0, 24)}`,
      toolName,
      callId: normalizeString(obligation.callId, ""),
      resultKind: toolName === "list_agents" ? "sub_agent_list_status" : "sub_agent_inspect_status",
      status: result.status === "completed" ? "ready_for_provider_continuation" : "blocked",
      blockerCodes: normalizeString(result.blockerCode, "") ? [normalizeString(result.blockerCode, "")] : [],
      resultDigest: normalizeString(result.resultDigest, ""),
      providerOutput,
      contextAdmission: {
        admittedAs: "sub_agent_status_e_channel",
        admissionState: result.status === "completed" ? "admitted" : "blocked",
        readOnly: true,
        mutatesAgentGraph: false,
        mutatesWorkspace: false,
        childTranscriptPromoted: false,
        grantsInterferenceAuthority: false,
      },
      rawPromptIncluded: false,
      rawResultIncluded: false,
      rawWorkspacePathIncluded: false,
      rawTranscriptIncluded: false,
      rawSecretIncluded: false,
    };
    envelope.envelopeDigest = sha256(stableStringify(envelope));
    return envelope;
  }

  async emitReadOnlySubAgentStatusRequest(surfaceSession, sessionId, turnId, obligation = {}, project = {}) {
    const envelope = this.buildReadOnlySubAgentStatusEnvelope(sessionId, turnId, obligation, project);
    await this.continueAfterSafeResidentUtilityResult(surfaceSession, sessionId, turnId, obligation, envelope, project);
    return 1;
  }

  isNativeSubAgentRuntimeObligation(obligation = {}) {
    return isNativeSubAgentRuntimeToolName(obligation?.name);
  }

  async buildNativeSubAgentRuntimeEnvelope(sessionId, turnId, obligation = {}, project = {}) {
    const toolName = normalizeString(obligation.name, "");
    const args = parseToolArgumentsObject(obligation);
    const session = this.sessionStore.readSession(sessionId) || {};
    const turn = this.sessionStore.readTurn(sessionId, turnId) || {};
    const projectId = normalizeString(project?.id || project?.projectId || project?.name, session.projectId || "project_direct_agents");
    const workThreadId = normalizeString(
      directWorkThreadContextCarrier(session, turn, project).workThreadId,
      "work_thread_direct_agents",
    );
    let runtimeResult;
    if (!this.subAgentPool) {
      runtimeResult = {
        status: "blocked",
        blockerCode: "direct_native_agent_pool_unavailable",
        updates: [],
      };
    } else if (toolName === "spawn_agent") {
      runtimeResult = this.subAgentPool.launch({
        projectId,
        workThreadId,
        primaryThreadId: sessionId,
        parentAgentId: normalizeString(session.agentThreadId || session.agentId, sessionId),
        taskName: args.task_name || args.taskName,
        message: args.message,
        agentType: args.agent_type || args.agentType,
        model: args.model,
        reasoningEffort: args.reasoning_effort || args.reasoningEffort,
        forkTurns: args.fork_turns || args.forkTurns,
        parentModel: normalizeString(turn.model, session.model),
        parentReasoningEffort: normalizeString(turn.reasoningEffort, session.reasoningEffort),
        parentContextMessages: directParentContextMessages(session),
      });
    } else {
      runtimeResult = await this.subAgentPool.wait({
        projectId,
        primaryThreadId: sessionId,
        targets: Array.isArray(args.targets) ? args.targets : [],
        timeoutMs: args.timeout_ms || args.timeoutMs,
      });
    }
    const providerOutput = toolName === "spawn_agent"
      ? {
          kind: "spawn_agent_result",
          status: normalizeString(runtimeResult.status, "blocked"),
          blockerCode: normalizeString(runtimeResult.blockerCode, ""),
          taskName: normalizeString(runtimeResult.taskName, ""),
          childAgentId: normalizeString(runtimeResult.childAgentId, ""),
          state: normalizeString(runtimeResult.state, runtimeResult.status),
          model: normalizeString(runtimeResult.model, ""),
          reasoningEffort: normalizeString(runtimeResult.reasoningEffort, ""),
          contextHandoff: runtimeResult.contextHandoff || null,
          contextMessageCount: Number(runtimeResult.contextMessageCount || 0),
          runtimeProfileIndependentOfContext: runtimeResult.runtimeProfileIndependentOfContext === true,
          pool: runtimeResult.pool || this.subAgentPool?.descriptor?.() || null,
          childRunsInBackground: ["running", "queued", "accepted"].includes(runtimeResult.status),
          rawTaskIncluded: false,
          rawContextIncluded: false,
        }
      : {
          kind: "wait_agent_result",
          status: normalizeString(runtimeResult.status, "blocked"),
          blockerCode: normalizeString(runtimeResult.blockerCode, ""),
          updates: (Array.isArray(runtimeResult.updates) ? runtimeResult.updates : []).map((update) => ({
            childAgentId: normalizeString(update.childAgentId, ""),
            taskName: normalizeString(update.taskName, ""),
            state: normalizeString(update.state, ""),
            resultSummary: normalizeString(update.resultSummary, ""),
            blockerCode: normalizeString(update.blockerCode, ""),
            model: normalizeString(update.model, ""),
            reasoningEffort: normalizeString(update.reasoningEffort, ""),
          })),
          pool: runtimeResult.pool || this.subAgentPool?.descriptor?.() || null,
          rawChildTranscriptIncluded: false,
        };
    const envelope = {
      schema: "direct_native_sub_agent_runtime_result_envelope@1",
      envelopeId: `native_sub_agent_runtime_${sha256(`${sessionId}:${turnId}:${obligation.obligationId}:${stableStringify(providerOutput)}`).slice(0, 24)}`,
      toolName,
      callId: normalizeString(obligation.callId, ""),
      resultKind: "direct_sub_agent_runtime",
      status: normalizeString(runtimeResult.status, "blocked") === "blocked" ? "blocked" : "ready_for_provider_continuation",
      providerOutput,
      sideEffectExecuted:
        toolName === "spawn_agent" &&
        normalizeString(runtimeResult.status, "blocked") !== "blocked",
      runtimeLifecycleMutationExecuted:
        toolName === "spawn_agent" &&
        normalizeString(runtimeResult.status, "blocked") !== "blocked",
      providerTurnScheduled:
        toolName === "spawn_agent" &&
        ["running", "queued", "accepted"].includes(
          normalizeString(runtimeResult.status, ""),
        ),
      semanticEffectRecorded: true,
      canonicalEffect: false,
      contextAdmission: {
        admittedAs: "direct_sub_agent_runtime_status",
        admissionState:
          normalizeString(runtimeResult.status, "blocked") === "blocked"
            ? "blocked"
            : "admitted",
        childTranscriptPromoted: false,
        workspaceMutationStarted: false,
      },
      rawPromptIncluded: false,
      rawResultIncluded: false,
      rawWorkspacePathIncluded: false,
      rawTranscriptIncluded: false,
      rawSecretIncluded: false,
    };
    envelope.envelopeDigest = sha256(stableStringify(envelope));
    return envelope;
  }

  async emitNativeSubAgentRuntimeRequest(surfaceSession, sessionId, turnId, obligation = {}, project = {}) {
    const envelope = await this.buildNativeSubAgentRuntimeEnvelope(sessionId, turnId, obligation, project);
    await this.continueAfterSafeResidentUtilityResult(surfaceSession, sessionId, turnId, obligation, envelope, project);
    return 1;
  }

  isExternalPromotedObligation(obligation = {}) {
    return isExternalPromotedToolName(obligation?.name);
  }

  buildExternalPromotedEnvelope(sessionId, turnId, obligation = {}, project = {}) {
    const toolName = normalizeString(obligation?.name, "");
    const args = parseToolArgumentsObject(obligation) || {};
    const projectId = normalizeString(project?.id || project?.projectId || project?.name, "project_direct_external");
    const workThreadId = normalizeString(directWorkThreadContextCarrier(project)?.workThreadId, "work_thread_direct_external");
    const stableObligationId = normalizeString(
      obligation.obligationId || obligation.itemId || obligation.sourceItemId || obligation.callId,
      `${toolName}_${sha256(stableStringify({
        sessionId,
        turnId,
        toolName,
        args,
      })).slice(0, 12)}`,
    );
    const profile = this.resolveExternalCapabilityProfile({
      ...project,
      workThreadId,
    });
    if (toolName === "read_mcp_resource") {
      const serverIdentityId = normalizeString(args.serverIdentityId || args.serverId, "");
      const resourceUri = normalizeString(args.resourceUri || args.uri, "");
      if (!serverIdentityId || !resourceUri) {
        const providerOutput = {
          kind: "read_mcp_resource_result",
          status: "blocked",
          blockerCodes: ["mcp_resource_read_invalid_arguments"],
          serverIdentityId,
          resourceDisplay: "",
          contextAdmission: "blocked",
          mimeKind: "unknown",
          contentHandling: "unknown_blocked",
          byteCount: 0,
          excerpt: "",
          rawResourceUriIncluded: false,
          rawResourcePayloadIncluded: false,
          dynamicMcpActionPerformed: false,
          pluginInstallPerformed: false,
          workspaceMutationStarted: false,
        };
        const resultDigest = sha256(stableStringify(providerOutput));
        const envelope = {
          schema: "direct_external_promoted_tool_result_envelope@1",
          envelopeId: `external_tool_result_${sha256(`${sessionId}:${turnId}:${stableObligationId}:${resultDigest}`).slice(0, 24)}`,
          toolName,
          callId: normalizeString(obligation.callId, ""),
          resultKind: "mcp_resource_read_status",
          status: "blocked",
          blockerCodes: ["mcp_resource_read_invalid_arguments"],
          resultDigest,
          providerOutput,
          contextAdmission: {
            admittedAs: "external_resource_read_evidence",
            admissionState: "blocked",
            readOnly: true,
            mutatesWorkspace: false,
            grantsDynamicMcpAuthority: false,
            pluginInstallAllowed: false,
            discoveredToolAutoPromotionAllowed: false,
          },
          rawPromptIncluded: false,
          rawResultIncluded: false,
          rawWorkspacePathIncluded: false,
          rawExternalPayloadIncluded: false,
          rawResourceUriIncluded: false,
          rawSecretIncluded: false,
        };
        envelope.envelopeDigest = sha256(stableStringify(envelope));
        return envelope;
      }
      const readEnvelope = buildMcpResourceReadEnvelope({
        profile,
        projectId,
        workThreadId,
        threadId: sessionId,
        turnId,
        callId: normalizeString(obligation.callId, ""),
        serverIdentityId,
        resourceUri,
        mimeType: normalizeString(args.mimeType || args.contentType, "text/plain"),
        status: "unavailable",
        blockerCodes: ["mcp_resource_payload_backend_unavailable"],
      });
      const providerOutput = summarizeExternalDiscoveryResult(toolName, readEnvelope);
      const envelope = {
        schema: "direct_external_promoted_tool_result_envelope@1",
        envelopeId: `external_tool_result_${sha256(`${sessionId}:${turnId}:${stableObligationId}:${readEnvelope.envelopeDigest}`).slice(0, 24)}`,
        toolName,
        callId: normalizeString(obligation.callId, ""),
        resultKind: "mcp_resource_read_status",
        status: readEnvelope.status === "completed" || readEnvelope.status === "unsupported" || readEnvelope.status === "unavailable"
          ? "ready_for_provider_continuation"
          : "blocked",
        blockerCodes: Array.isArray(readEnvelope.blockerCodes) ? readEnvelope.blockerCodes : [],
        resultDigest: normalizeString(readEnvelope.envelopeDigest, ""),
        providerOutput,
        contextAdmission: {
          admittedAs: "external_resource_read_evidence",
          admissionState: readEnvelope.contextAdmission === "blocked" ? "blocked" : "admitted",
          readOnly: true,
          mutatesWorkspace: false,
          grantsDynamicMcpAuthority: false,
          pluginInstallAllowed: false,
          discoveredToolAutoPromotionAllowed: false,
        },
        rawPromptIncluded: false,
        rawResultIncluded: false,
        rawWorkspacePathIncluded: false,
        rawExternalPayloadIncluded: false,
        rawResourceUriIncluded: false,
        rawSecretIncluded: false,
      };
      envelope.envelopeDigest = sha256(stableStringify(envelope));
      return envelope;
    }

    const declaration = buildExternalToolResidentDeclaration({
      profile,
      generatedAt: nowIso(),
    });
    const gate = buildExternalDiscoveryToolCallGate({
      declaration,
      toolCall: {
        name: toolName,
        callId: normalizeString(obligation.callId, ""),
        arguments: normalizeString(obligation.argumentsText, "{}"),
      },
    });
    const discoveryEnvelope = buildExternalDiscoveryResultEnvelope({
      profile,
      declaration,
      gate,
      projectId,
      workThreadId,
      threadId: sessionId,
      turnId,
    });
    const providerOutput = summarizeExternalDiscoveryResult(toolName, discoveryEnvelope);
    const envelope = {
      schema: "direct_external_promoted_tool_result_envelope@1",
      envelopeId: `external_tool_result_${sha256(`${sessionId}:${turnId}:${stableObligationId}:${discoveryEnvelope.envelopeDigest}`).slice(0, 24)}`,
      toolName,
      callId: normalizeString(obligation.callId, ""),
      resultKind: "external_discovery_status",
      status: discoveryEnvelope.status === "completed" || discoveryEnvelope.status === "degraded" || discoveryEnvelope.status === "unavailable"
        ? "ready_for_provider_continuation"
        : "blocked",
      blockerCodes: Array.isArray(discoveryEnvelope.blockerCodes) ? discoveryEnvelope.blockerCodes : [],
      resultDigest: normalizeString(discoveryEnvelope.envelopeDigest, ""),
      providerOutput,
      contextAdmission: {
        admittedAs: "external_discovery_descriptor_summary",
        admissionState: discoveryEnvelope.contextAdmission === "blocked" ? "blocked" : "admitted",
        readOnly: true,
        mutatesWorkspace: false,
        grantsDynamicMcpAuthority: false,
        pluginInstallAllowed: false,
        discoveredToolAutoPromotionAllowed: false,
      },
      rawPromptIncluded: false,
      rawResultIncluded: false,
      rawWorkspacePathIncluded: false,
      rawExternalPayloadIncluded: false,
      rawResourceUriIncluded: false,
      rawSecretIncluded: false,
    };
    envelope.envelopeDigest = sha256(stableStringify(envelope));
    return envelope;
  }

  async emitExternalPromotedRequest(surfaceSession, sessionId, turnId, obligation = {}, project = {}) {
    const envelope = this.buildExternalPromotedEnvelope(sessionId, turnId, obligation, project);
    await this.continueAfterSafeResidentUtilityResult(surfaceSession, sessionId, turnId, obligation, envelope, project);
    return 1;
  }

  async emitToolApprovalRequests(surfaceSession, sessionId, turnId, obligations = [], project = {}) {
    const turn = this.sessionStore.readTurn(sessionId, turnId) || {};
    if (obligations.length !== 1) {
      for (const obligation of obligations) {
        this.sessionStore.updateToolObligation(sessionId, turnId, obligation.obligationId, {
          status: "unsupported",
          authorityState: "unsupported",
          approvalAvailable: false,
          executionAllowed: false,
          continuationAllowed: false,
          failureKind: "multiple_tool_calls_unsupported",
        }, {
          nextTurnState: "failed",
          turnPatch: {
            error: {
              code: "multiple_tool_calls_unsupported",
              message: "Direct read-only continuation supports exactly one tool obligation in this bundle.",
            },
          },
        });
      }
      return 0;
    }
    let createdCount = 0;
    for (const obligation of obligations) {
      if (this.isNativeSubAgentRuntimeObligation(obligation)) {
        createdCount += await this.emitNativeSubAgentRuntimeRequest(surfaceSession, sessionId, turnId, obligation, project);
        continue;
      }
      if (this.isReadOnlySubAgentStatusObligation(obligation)) {
        createdCount += await this.emitReadOnlySubAgentStatusRequest(surfaceSession, sessionId, turnId, obligation, project);
        continue;
      }
      if (!surfaceSession) return createdCount;
      if (this.isSafeResidentUtilityObligation(obligation)) {
        createdCount += await this.emitSafeResidentUtilityRequest(surfaceSession, sessionId, turnId, obligation, project);
        continue;
      }
      if (this.isExternalPromotedObligation(obligation)) {
        createdCount += await this.emitExternalPromotedRequest(surfaceSession, sessionId, turnId, obligation, project);
        continue;
      }
      if (this.isPatchApplyObligation(obligation)) {
        createdCount += await this.emitPatchApplyApprovalRequest(surfaceSession, sessionId, turnId, obligation, project);
        continue;
      }
      if (this.isCommandExecutionObligation(obligation)) {
        createdCount += await this.emitCommandExecutionApprovalRequest(surfaceSession, sessionId, turnId, obligation, project);
        continue;
      }
      if (typeof surfaceSession.createReadOnlyToolRequest !== "function") continue;
      const params = this.readOnlyToolRequestParams(obligation, turn, project);
      const loopCapExceeded = Number(params.stepOrdinal || 1) > MAX_READONLY_TOOL_LOOP_STEPS;
      if (!params.approvalAvailable || loopCapExceeded) {
        this.sessionStore.updateToolObligation(sessionId, turnId, obligation.obligationId, {
          status: "unsupported",
          authorityState: "unsupported",
          approvalAvailable: false,
          executionAllowed: false,
          continuationAllowed: false,
          failureKind: loopCapExceeded
            ? "tool_loop_cap_exceeded"
            : params.argumentsError
            ? "invalid_tool_arguments"
            : (!params.hasContinuityHandle
                ? "continuation_missing_context_handle"
                : (params.toolContinuationEvidence?.status !== "ready" ? "tool_continuation_profile_required" : "unsupported_tool_call_shape")),
        }, {
          nextTurnState: "failed",
          turnPatch: {
            error: {
              code: loopCapExceeded
                ? "tool_loop_cap_exceeded"
                : params.argumentsError
                ? "invalid_tool_arguments"
                : (!params.hasContinuityHandle
                    ? "continuation_missing_context_handle"
                    : (params.toolContinuationEvidence?.status !== "ready" ? "tool_continuation_profile_required" : "unsupported_tool_call_shape")),
              message: loopCapExceeded
                ? "Direct read-only tool loop reached its configured step cap."
                : "Direct read-only tool call cannot be approved for continuation in this runtime bundle.",
            },
          },
        });
        continue;
      }
      this.sessionStore.updateToolObligation(sessionId, turnId, obligation.obligationId, {
        approvalAvailable: true,
        authorityState: "approval_waiting",
      }, {
        nextTurnState: "tool_waiting",
      });
      surfaceSession.createReadOnlyToolRequest({
        params,
        summary: params.relPath || params.tool,
      });
      createdCount += 1;
    }
    return createdCount;
  }

  async emitContinuationNextToolOrComplete(surfaceSession, sessionId, turnId, continuation = {}, project = {}, options = {}) {
    const streamPhase = normalizeString(options.streamPhase, "continuation");
    if (continuation.turnState === "tool_waiting" && Array.isArray(continuation.nextToolObligations) && continuation.nextToolObligations.length) {
      const nextToolItems = continuation.nextToolObligations.map(toolTranscriptItemFromObligation);
      const currentSession = this.sessionStore.readSession(sessionId);
      if (currentSession && Array.isArray(currentSession.messages)) {
        this.sessionStore.writeSession({
          ...currentSession,
          messages: currentSession.messages.map((message) => {
            if (message.id !== turnId) return message;
            const existingItems = Array.isArray(message.items) ? message.items : [];
            const existingIds = new Set(existingItems.map((item) => item?.id));
            return {
              ...message,
              status: "tool_waiting",
              items: [
                ...existingItems,
                ...nextToolItems.filter((item) => !existingIds.has(item.id)),
              ],
            };
          }),
        });
      }
      for (const item of nextToolItems) {
        this.emitNotification(surfaceSession, "item/started", { threadId: sessionId, turnId, item });
        this.emitNotification(surfaceSession, "item/completed", { threadId: sessionId, turnId, item });
      }
      const createdApprovalRequests = await this.emitToolApprovalRequests(surfaceSession, sessionId, turnId, continuation.nextToolObligations, project);
      this.emitNotification(surfaceSession, "warning", {
        threadId: sessionId,
        turnId,
        message: createdApprovalRequests
          ? normalizeString(options.approvalMessage, "Direct implementation continuation requested another tool. Local approval is required.")
          : normalizeString(options.unavailableMessage, "Direct implementation continuation requested another tool call, but it is not available for approval."),
      });
      return true;
    }
    this.emitNotification(surfaceSession, "turn/completed", {
      threadId: sessionId,
      turnId,
      turn: {
        id: turnId,
        status: terminalStatusForState(continuation.turnState),
        completedAt: nowSeconds(),
        streamPhase,
      },
    });
    return false;
  }

  async withToolDecisionLock(key, action) {
    const lockKey = normalizeString(key, "");
    const existing = this.toolDecisionLocks.get(lockKey);
    if (existing) return existing;
    const run = Promise.resolve()
      .then(action)
      .finally(() => {
        if (this.toolDecisionLocks.get(lockKey) === run) this.toolDecisionLocks.delete(lockKey);
      });
    this.toolDecisionLocks.set(lockKey, run);
    return run;
  }

  pruneToolDecisionCache() {
    const limit = this.toolDecisionCacheLimit;
    while (this.toolDecisionClaims.size > limit) {
      const oldestKey = this.toolDecisionClaims.keys().next().value;
      if (!oldestKey) break;
      this.toolDecisionClaims.delete(oldestKey);
      this.toolDecisionResults.delete(oldestKey);
    }
    while (this.toolDecisionResults.size > limit) {
      const oldestKey = this.toolDecisionResults.keys().next().value;
      if (!oldestKey) break;
      this.toolDecisionResults.delete(oldestKey);
      this.toolDecisionClaims.delete(oldestKey);
    }
  }

  async handleReadOnlyToolResponse(record = {}, result = {}, context = {}) {
    const params = record.params || {};
    const sessionId = normalizeString(params.sessionId || params.threadId, "");
    const turnId = normalizeString(params.turnId, "");
    const obligationId = normalizeString(params.obligationId, "");
    const decision = normalizeString(result.decision || result.action, "decline");
    const clientToolDecisionId = normalizeString(result.clientToolDecisionId, `${record.key}:${decision}`);
    const actionTokenId = normalizeString(result.actionTokenId, "");
    const canonicalDecision = decision === "approve" || decision === "approved" || decision === "accept"
      ? "approve"
      : decision === "cancel" || decision === "canceled" || decision === "abort"
        ? "cancel"
        : "decline";
    const expectedActionToken = normalizeString(params.actionTokens?.[canonicalDecision], "");
    if (expectedActionToken && actionTokenId !== expectedActionToken) {
      const error = new Error("Read-only tool action token is stale or missing.");
      error.code = "stale_tool_action_token";
      throw error;
    }
    const decisionKey = clientToolDecisionId;
    const existingClaim = this.toolDecisionClaims.get(decisionKey);
    if (existingClaim && (existingClaim.obligationId !== obligationId || existingClaim.decision !== canonicalDecision)) {
      const error = new Error("clientToolDecisionId was reused for a different read-only tool decision.");
      error.code = "tool_decision_id_conflict";
      throw error;
    }
    this.toolDecisionClaims.set(decisionKey, { obligationId, decision: canonicalDecision });
    this.pruneToolDecisionCache();
    const previousDecision = this.toolDecisionResults.get(decisionKey);
    if (previousDecision) {
      if (previousDecision.obligationId !== obligationId || previousDecision.decision !== canonicalDecision) {
        const error = new Error("clientToolDecisionId was reused for a different read-only tool decision.");
        error.code = "tool_decision_id_conflict";
        throw error;
      }
      return previousDecision.response;
    }
    const response = await this.withToolDecisionLock(obligationId, async () => {
      const found = this.sessionStore.findToolObligation(sessionId, turnId, obligationId);
      if (!found || !found.obligation) {
        const error = new Error("Read-only tool obligation not found.");
        error.code = "obligation_not_found";
        throw error;
      }
      const current = found.obligation;
      const currentStatus = normalizeString(current.status, "");
      if (["declined", "canceled"].includes(currentStatus)) {
        const error = new Error("Read-only tool obligation already has a terminal local decision.");
        error.code = "terminal_decision_exists";
        throw error;
      }
      if (["result_recorded", "continuation_built", "continuation_sent"].includes(currentStatus) && canonicalDecision !== "approve") {
        const error = new Error("Read-only tool obligation is too late for decline or cancel.");
        error.code = "too_late_for_decision";
        throw error;
      }
      if (canonicalDecision === "approve") {
        return this.approveExecuteAndContinueReadOnlyTool({
          project: context.project || this.project || {},
          surfaceSession: context.surfaceSession,
          sessionId,
          turnId,
          obligationId,
          clientToolDecisionId,
          ...directWorkThreadContextCarrier(params, result, context),
        });
      }
      if (canonicalDecision === "cancel") {
        const canceled = cancelReadOnlyToolObligation({
          sessionStore: this.sessionStore,
          sessionId,
          turnId,
          obligationId,
          decidedBy: "local-user",
          reason: "User canceled read-only tool execution.",
        });
        this.emitNotification(context.surfaceSession, "turn/completed", {
          threadId: sessionId,
          turnId,
          turn: { id: turnId, status: "aborted", completedAt: nowSeconds() },
        });
        return { decision: "canceled", turn: turnSnapshot(canceled.turn), obligation: canceled.obligation };
      }
      const declined = declineReadOnlyToolObligation({
        sessionStore: this.sessionStore,
        sessionId,
        turnId,
        obligationId,
        decidedBy: "local-user",
        reason: "User declined read-only tool execution.",
      });
      this.emitNotification(context.surfaceSession, "turn/completed", {
        threadId: sessionId,
        turnId,
        turn: { id: turnId, status: "failed", completedAt: nowSeconds() },
      });
      return { decision: "declined", turn: turnSnapshot(declined.turn), obligation: declined.obligation };
    });
    this.toolDecisionResults.set(decisionKey, { obligationId, decision: canonicalDecision, response });
    this.pruneToolDecisionCache();
    return response;
  }

  async handlePatchApplyResponse(record = {}, result = {}, context = {}) {
    const params = record.params || {};
    const sessionId = normalizeString(params.sessionId || params.threadId, "");
    const turnId = normalizeString(params.turnId, "");
    const obligationId = normalizeString(params.obligationId, "");
    const decision = normalizeString(result.decision || result.action, "decline");
    const clientPatchDecisionId = normalizeString(result.clientPatchDecisionId || result.clientToolDecisionId, `${record.key}:${decision}`);
    const actionTokenId = normalizeString(result.actionTokenId, "");
    const canonicalDecision = decision === "approve" || decision === "approved" || decision === "accept"
      ? "approve"
      : decision === "cancel" || decision === "canceled" || decision === "abort"
        ? "cancel"
        : "decline";
    const expectedActionToken = normalizeString(params.actionTokens?.[canonicalDecision], "");
    if (expectedActionToken && actionTokenId !== expectedActionToken) {
      const error = new Error("Patch action token is stale or missing.");
      error.code = "stale_patch_action_token";
      throw error;
    }
    const decisionKey = clientPatchDecisionId;
    const existingClaim = this.toolDecisionClaims.get(decisionKey);
    if (existingClaim && (existingClaim.obligationId !== obligationId || existingClaim.decision !== canonicalDecision)) {
      const error = new Error("clientPatchDecisionId was reused for a different patch decision.");
      error.code = "patch_decision_id_conflict";
      throw error;
    }
    this.toolDecisionClaims.set(decisionKey, { obligationId, decision: canonicalDecision });
    this.pruneToolDecisionCache();
    const previousDecision = this.toolDecisionResults.get(decisionKey);
    if (previousDecision) {
      if (previousDecision.obligationId !== obligationId || previousDecision.decision !== canonicalDecision) {
        const error = new Error("clientPatchDecisionId was reused for a different patch decision.");
        error.code = "patch_decision_id_conflict";
        throw error;
      }
      return previousDecision.response;
    }
    const response = await this.withToolDecisionLock(`patch:${obligationId}`, async () => {
      const found = this.sessionStore.findToolObligation(sessionId, turnId, obligationId);
      if (!found || !found.obligation) {
        const error = new Error("Patch obligation not found.");
        error.code = "obligation_not_found";
        throw error;
      }
      const currentStatus = normalizeString(found.obligation.status, "");
      if (["patch_declined", "patch_canceled"].includes(currentStatus)) {
        const error = new Error("Patch obligation already has a terminal local decision.");
        error.code = "terminal_decision_exists";
        throw error;
      }
      if (["patch_result_recorded", "continuation_built", "continuation_sent"].includes(currentStatus) && canonicalDecision !== "approve") {
        const error = new Error("Patch obligation is too late for decline or cancel.");
        error.code = "too_late_for_decision";
        throw error;
      }
      if (canonicalDecision === "approve") {
        return this.approveExecuteAndContinuePatchApply({
          project: context.project || this.project || {},
          surfaceSession: context.surfaceSession,
          sessionId,
          turnId,
          obligationId,
          clientPatchDecisionId,
          ...directWorkThreadContextCarrier(params, result, context),
        });
      }
      const decided = decidePatchApplyObligation({
        sessionStore: this.sessionStore,
        sessionId,
        turnId,
        obligationId,
        decision: canonicalDecision === "cancel" ? "canceled" : "declined",
        decidedBy: "local-user",
        reason: canonicalDecision === "cancel" ? "User canceled patch apply." : "User declined patch apply.",
      });
      this.emitNotification(context.surfaceSession, "turn/completed", {
        threadId: sessionId,
        turnId,
        turn: {
          id: turnId,
          status: canonicalDecision === "cancel" ? "aborted" : "failed",
          completedAt: nowSeconds(),
        },
      });
      return {
        decision: canonicalDecision === "cancel" ? "canceled" : "declined",
        turn: turnSnapshot(decided.turn),
        obligation: decided.obligation,
      };
    });
    this.toolDecisionResults.set(decisionKey, { obligationId, decision: canonicalDecision, response });
    this.pruneToolDecisionCache();
    return response;
  }

  async handleCommandExecutionResponse(record = {}, result = {}, context = {}) {
    const params = record.params || {};
    const sessionId = normalizeString(params.sessionId || params.threadId, "");
    const turnId = normalizeString(params.turnId, "");
    const obligationId = normalizeString(params.obligationId, "");
    const decision = normalizeString(result.decision || result.action, "decline");
    const clientCommandDecisionId = normalizeString(result.clientCommandDecisionId || result.clientToolDecisionId, `${record.key}:${decision}`);
    const actionTokenId = normalizeString(result.actionTokenId, "");
    const canonicalDecision = decision === "approve" || decision === "approved" || decision === "accept"
      ? "approve"
      : decision === "cancel" || decision === "canceled" || decision === "abort"
        ? "cancel"
        : "decline";
    const expectedActionToken = normalizeString(params.actionTokens?.[canonicalDecision], "");
    if (expectedActionToken && actionTokenId !== expectedActionToken) {
      const error = new Error("Command action token is stale or missing.");
      error.code = "stale_command_action_token";
      throw error;
    }
    const decisionKey = clientCommandDecisionId;
    const existingClaim = this.toolDecisionClaims.get(decisionKey);
    if (existingClaim && (existingClaim.obligationId !== obligationId || existingClaim.decision !== canonicalDecision)) {
      const error = new Error("clientCommandDecisionId was reused for a different command decision.");
      error.code = "command_decision_id_conflict";
      throw error;
    }
    this.toolDecisionClaims.set(decisionKey, { obligationId, decision: canonicalDecision });
    this.pruneToolDecisionCache();
    const previousDecision = this.toolDecisionResults.get(decisionKey);
    if (previousDecision) {
      if (previousDecision.obligationId !== obligationId || previousDecision.decision !== canonicalDecision) {
        const error = new Error("clientCommandDecisionId was reused for a different command decision.");
        error.code = "command_decision_id_conflict";
        throw error;
      }
      return previousDecision.response;
    }
    const response = await this.withToolDecisionLock(`command:${obligationId}`, async () => {
      const found = this.sessionStore.findToolObligation(sessionId, turnId, obligationId);
      if (!found || !found.obligation) {
        const error = new Error("Command obligation not found.");
        error.code = "obligation_not_found";
        throw error;
      }
      const currentStatus = normalizeString(found.obligation.status, "");
      if (["command_declined", "command_canceled"].includes(currentStatus)) {
        const error = new Error("Command obligation already has a terminal local decision.");
        error.code = "terminal_decision_exists";
        throw error;
      }
      if (["command_result_recorded", "continuation_built", "continuation_sent"].includes(currentStatus) && canonicalDecision !== "approve") {
        const error = new Error("Command obligation is too late for decline or cancel.");
        error.code = "too_late_for_decision";
        throw error;
      }
      if (canonicalDecision === "approve") {
        return this.approveExecuteAndContinueCommandExecution({
          project: context.project || this.project || {},
          surfaceSession: context.surfaceSession,
          sessionId,
          turnId,
          obligationId,
          clientCommandDecisionId,
          ...directWorkThreadContextCarrier(params, result, context),
        });
      }
      const decided = decideCommandExecutionObligation({
        sessionStore: this.sessionStore,
        sessionId,
        turnId,
        obligationId,
        decision: canonicalDecision === "cancel" ? "canceled" : "declined",
        decidedBy: "local-user",
        reason: canonicalDecision === "cancel" ? "User canceled command execution." : "User declined command execution.",
      });
      this.emitNotification(context.surfaceSession, "turn/completed", {
        threadId: sessionId,
        turnId,
        turn: {
          id: turnId,
          status: canonicalDecision === "cancel" ? "aborted" : "failed",
          completedAt: nowSeconds(),
        },
      });
      return {
        decision: canonicalDecision === "cancel" ? "canceled" : "declined",
        turn: turnSnapshot(decided.turn),
        obligation: decided.obligation,
      };
    });
    this.toolDecisionResults.set(decisionKey, { obligationId, decision: canonicalDecision, response });
    this.pruneToolDecisionCache();
    return response;
  }

  async handleUserInputResponse(record = {}, result = {}, context = {}) {
    const params = record.params || {};
    const sessionId = normalizeString(params.sessionId, "");
    const turnId = normalizeString(params.turnId, "");
    const obligationId = normalizeString(params.obligationId, "");
    if (!sessionId || !turnId || !obligationId) {
      const error = new Error("Direct user-input response is missing tool obligation identity.");
      error.code = "missing_user_input_obligation_identity";
      throw error;
    }
    const found = this.sessionStore.findToolObligation(sessionId, turnId, obligationId);
    const obligation = found.obligation;
    const answers = isPlainObject(result.answers) ? result.answers : {};
    const selectedChoiceIds = [];
    let freeText = "";
    for (const answer of Object.values(answers)) {
      const answerList = Array.isArray(answer?.answers) ? answer.answers : [];
      for (const value of answerList) {
        const text = normalizeString(value, "");
        if (!text) continue;
        selectedChoiceIds.push(text);
        if (!freeText) freeText = text;
      }
    }
    const envelope = buildHumanDecisionAnswerResultEnvelope({
      decisionPacketId: normalizeString(params.decisionPacketId, ""),
      callId: normalizeString(obligation.callId, ""),
      gateId: normalizeString(obligation.result?.gateId, ""),
      gateDigest: normalizeString(obligation.result?.gateDigest, ""),
      selectedChoiceIds,
      freeText,
      status: "answered",
    });
    return this.continueAfterSafeResidentUtilityResult(
      context.surfaceSession,
      sessionId,
      turnId,
      obligation,
      envelope,
      context.project || {},
    );
  }

  emitContinuationAssistant(surfaceSession, sessionId, turnId, continuationId, normalizedEvents = []) {
    const itemId = `${turnId}_${continuationId}_assistant`;
    const item = { id: itemId, type: "agentMessage", turnId, text: "" };
    let started = false;
    for (const event of normalizedEvents) {
      if (event.type !== "message_delta") continue;
      if (!started) {
        started = true;
        this.emitNotification(surfaceSession, "item/started", { threadId: sessionId, turnId, item });
      }
      const delta = String(event.text || "");
      item.text += delta;
      this.emitNotification(surfaceSession, "item/agentMessage/delta", {
        threadId: sessionId,
        turnId,
        itemId,
        delta,
      });
    }
    if (started) this.emitNotification(surfaceSession, "item/completed", { threadId: sessionId, turnId, item });
  }

  recordToolOperationHistory({
    project = {},
    sessionId = "",
    turnId = "",
    obligationId = "",
    toolName = "",
    result = {},
    continuation = {},
    clientDecisionId = "",
  } = {}) {
    if (!this.directThreadStore) return null;
    const projectId = normalizeString(project?.id || project?.projectId || project?.name, "");
    if (!projectId) return null;
    const tool = normalizeString(toolName || result.tool, "tool");
    const resultId = normalizeString(result.resultId, "");
    const operationType = toolHistoryOperationType(tool);
    const baseClientOperationId = normalizeString(clientDecisionId, "") ||
      `direct_tool_result_${sha256(`${projectId}:${sessionId}:${turnId}:${obligationId}:${resultId}:${tool}`).slice(0, 24)}`;
    const operationInputDigest = sha256(stableStringify({
      schema: "direct_tool_operation_history_input@1",
      projectId,
      sessionId,
      turnId,
      obligationId,
      tool,
      resultId,
      status: normalizeString(result.status, ""),
      workspaceEffectSummaryId: normalizeString(result.workspaceEffectSummaryId, ""),
    }));
    const confirmationSafety = { requiresConfirmation: true, confirmedAt: nowIso() };
    const existing = this.directThreadStore.operationByClient(projectId, baseClientOperationId);
    if (existing) return this.directThreadStore.operationResult(existing);
    const planned = this.directThreadStore.planOperation({
      operationType,
      projectId,
      clientOperationId: baseClientOperationId,
      actor: "local-user",
      target: { threadIds: [sessionId], turnId, obligationId },
      parameters: {
        operationInputDigest,
        tool,
      },
      safety: confirmationSafety,
    });
    const committed = this.directThreadStore.commitOperation(planned.operationId, {
      operationType,
      projectId,
      clientOperationId: baseClientOperationId,
      actor: "local-user",
      target: { threadIds: [sessionId], turnId, obligationId },
      result: {
        status: "committed",
        operationInputDigest,
        rendererSafeSummary: toolHistorySummary(tool, result),
        tool,
        resultStatus: normalizeString(result.status, ""),
        resultClass: normalizeString(result.resultClass, ""),
        resultId,
        workspaceEffectSummaryId: normalizeString(result.workspaceEffectSummaryId, ""),
        continuationId: normalizeString(continuation.continuationId || continuation.continuation?.continuationId, ""),
        rawProviderPayloadIncluded: false,
        rawWorkspacePathIncluded: false,
        rawToolOutputIncluded: false,
        effects: toolHistoryEffects({ ...result, obligationId }, continuation),
      },
      safety: confirmationSafety,
    });
    const workspaceEffectSummaryId = normalizeString(result.workspaceEffectSummaryId, "");
    if (workspaceEffectSummaryId) {
      const workspaceClientOperationId = `${baseClientOperationId}:workspace_effect`;
      if (!this.directThreadStore.operationByClient(projectId, workspaceClientOperationId)) {
        const workspaceInputDigest = sha256(stableStringify({
          schema: "direct_tool_workspace_effect_operation_input@1",
          projectId,
          sessionId,
          turnId,
          obligationId,
          tool,
          resultId,
          workspaceEffectSummaryId,
        }));
        const workspacePlanned = this.directThreadStore.planOperation({
          operationType: "workspace_effect_summary_recorded",
          projectId,
          clientOperationId: workspaceClientOperationId,
          actor: "local-system",
          target: { threadIds: [sessionId], turnId, obligationId },
          parameters: {
            operationInputDigest: workspaceInputDigest,
            tool,
          },
        });
        this.directThreadStore.commitOperation(workspacePlanned.operationId, {
          operationType: "workspace_effect_summary_recorded",
          projectId,
          clientOperationId: workspaceClientOperationId,
          actor: "local-system",
          target: { threadIds: [sessionId], turnId, obligationId },
          result: {
            ...workspaceEffectHistoryResult(result, tool),
            operationInputDigest: workspaceInputDigest,
            effects: [{
              effectKind: "workspace_effect_summary_recorded",
              targetKind: "workspace_effect_summary",
              targetId: workspaceEffectSummaryId,
              rendererSafeSummary: "workspace effect summary recorded",
            }],
          },
        });
      }
    }
    return this.directThreadStore.operationResult(this.directThreadStore.operationById(committed.operationId));
  }

  async approveExecuteAndContinueReadOnlyTool(options = {}) {
    if (typeof this.workspaceRequest !== "function") {
      const error = new Error("Direct read-only tool execution requires the workspace backend.");
      error.code = "workspace_backend_unavailable";
      throw error;
    }
    const { sessionId, turnId, obligationId, project, surfaceSession } = options;
    const approved = approveReadOnlyToolObligation({
      sessionStore: this.sessionStore,
      sessionId,
      turnId,
      obligationId,
      approvedBy: "local-user",
    });
    const executed = await executeApprovedReadOnlyToolObligation({
      sessionStore: this.sessionStore,
      sessionId,
      turnId,
      obligationId,
      workspaceRequest: (method, params) => this.workspaceRequest(project, method, params, this.readOnlyWorkspaceTimeoutMs),
    });
    const turn = this.sessionStore.readTurn(sessionId, turnId);
    const currentObligation = this.sessionStore.findToolObligation(sessionId, turnId, obligationId).obligation;
    const parentResponseId = parentResponseIdForToolStep(turn, currentObligation);
    const parentResponseSource = parentResponseSourceForToolStep(currentObligation);
    const toolLoopId = canonicalToolLoopId(currentObligation);
    const stepOrdinal = Number(currentObligation.stepOrdinal || 1) || 1;
    const stepId = normalizeString(currentObligation.stepId, "");
    const originalUserIntent = userPromptTextFromTurn(turn);
    const directStatus = this.statusForProject(project || {});
    const continuationToolNames = implementationContinuationToolNames(directStatus, originalUserIntent);
    const continuationToolComposition = composeImplementationToolBundleForRequest({
      projectId: normalizeString(project?.id || project?.projectId || project?.name, ""),
      sessionId,
      turnId,
      toolNames: continuationToolNames,
      useLaneDefaultTools: false,
      sourceMessageId: `${turnId}_${obligationId}_read_continuation`,
      normalizedLaneRequestId: `normalized_lane_request_${turnId}_${obligationId}_${stepOrdinal}`,
      workThreadId: directWorkThreadContextCarrier(options).workThreadId,
      runtimeFactsId: directStatus.evidenceId || "direct_runtime_facts",
      externalCapabilityProfile: directStatus.externalCapabilityProfile,
      providerHostedToolsStatus: directStatus.providerHostedToolsStatus,
    });
    const continuationTools = continuationToolComposition.tools;
    const declaredContinuationToolNames = continuationToolComposition.toolNames;
    const implementationRepairContinuation = continuationToolNames.some((name) => name === "apply_patch" || name === "run_command");
    let continuationRequest = null;
    let continuationContext = null;
    if (this.directThreadStore && typeof this.directThreadStore.buildAndPersistContextForToolContinuation === "function") {
      this.indexDirectThreadStoreSession(sessionId);
      const baseContinuationRequest = buildReadOnlyToolContinuationRequest({
        sessionStore: this.sessionStore,
        sessionId,
        turnId,
        obligationId,
        continuationLiveSendEnabled: true,
        ...directWorkThreadContextCarrier(options),
      });
      continuationRequest = {
        ...baseContinuationRequest,
        source: {
          ...(baseContinuationRequest.source || {}),
          previousResponseId: parentResponseId,
          previousResponseIdSource: parentResponseSource,
          sourceEventDigest: sha256(parentResponseId),
          sourceTurnDigest: sha256(stableStringify({
            threadId: sessionId,
            turnId,
            responseId: parentResponseId,
            requestManifestId: normalizeString(turn?.requestManifestId, ""),
            stepId,
            stepOrdinal,
          })),
          sourceRequestManifestId: normalizeString(turn?.requestManifestId, ""),
          sourceStepId: stepId,
          importedContinuityHandleUsed: false,
        },
      };
      const outputType = normalizeString(continuationRequest.toolResult?.outputType || continuationRequest.toolResult?.content?.[0]?.type, "");
      const continuationShape = {
        kind: "read_only_tool_continuation",
        stream: true,
        store: false,
        tools: continuationTools.length > 0,
        toolCount: continuationTools.length,
        declaredToolNames: declaredContinuationToolNames,
        parallelToolCalls: false,
        hasInstructions: true,
        hasPreviousResponseId: false,
        toolOutputItem: false,
        functionCallOutputCount: 0,
        customToolCallOutputCount: 0,
        providerCallType: normalizeString(continuationRequest.toolResult?.providerCallType, ""),
        providerOutputType: outputType,
        continuationTransportMode: "fresh_context",
        requestShapeClass: stepOrdinal > 1
          ? "direct_readonly_tool_loop_continuation@1"
          : "direct_readonly_tool_continuation@1",
        parentResponseSource,
        toolLoopId,
        stepId,
        stepOrdinal,
        ...continuationToolComposition.requestShapeFields,
      };
      continuationContext = this.directThreadStore.buildAndPersistContextForToolContinuation({
        sessionStore: this.sessionStore,
        session: this.sessionStore.readSession(sessionId),
        projectId: normalizeString(project?.id || project?.projectId || project?.name, ""),
        threadId: sessionId,
        turnId,
        obligationId,
        continuationRequest,
        previousResponseId: parentResponseId,
        model: normalizeString(turn?.model, ""),
        requestShape: continuationShape,
        requestShapeHash: sha256(stableStringify(continuationShape)),
        endpointClass: "chatgpt-codex-responses",
        endpointHash: this.endpoint ? sha256(this.endpoint) : "",
        modelEvidenceRef: normalizeString(this.statusForProject(project).evidenceId, ""),
        requestShapeEvidenceRef: stepOrdinal > 1
          ? "direct_readonly_tool_loop_continuation@1"
          : "continuation.tool_result",
        endpointEvidenceRef: this.endpoint ? sha256(this.endpoint) : "",
        ...directWorkThreadContextCarrier(options),
      }, {
        sessionStore: this.sessionStore,
      });
      continuationRequest = {
        ...continuationRequest,
        toolLoop: {
          ...(continuationRequest.toolLoop || {}),
          toolLoopId,
          stepId,
          stepOrdinal,
          maxStepCount: MAX_READONLY_TOOL_LOOP_STEPS,
          parentResponseId,
          parentResponseSource,
          parentResponseDigest: sha256(parentResponseId),
        },
        source: {
          ...(continuationRequest.source || {}),
          contextBuildId: continuationContext.contextPack.contextBuildId,
          requestManifestId: continuationContext.requestManifest.requestManifestId,
        },
        safety: {
          ...(continuationRequest.safety || {}),
          contextPackBuilt: true,
          requestManifestBuilt: true,
          rawRequestBodyStored: false,
        },
      };
    }
    this.recordToolOperationHistory({
      project,
      sessionId,
      turnId,
      obligationId,
      toolName: "read_file",
      result: executed.result,
      continuation: { continuationId: normalizeString(continuationRequest?.continuationId, "") },
      clientDecisionId: normalizeString(options.clientToolDecisionId, ""),
    });
    const continuation = await runPersistedReadOnlyToolContinuation({
      sessionStore: this.sessionStore,
      sessionId,
      turnId,
      obligationId,
      continuationRequest,
      previousResponseId: parentResponseId,
      instructions: implementationRepairContinuation
        ? DEFAULT_REPAIR_LOOP_CONTINUATION_INSTRUCTIONS
        : [
            normalizeString(continuationContext?.providerInput?.instructions, ""),
            DEFAULT_TOOL_CONTINUATION_INSTRUCTIONS,
          ].filter(Boolean).join("\n\n"),
      prompt: implementationRepairContinuation && originalUserIntent
        ? [
            `[CURRENT USER INTENT]\n${originalUserIntent}`,
            normalizeString(continuationContext?.providerInput?.prompt, ""),
          ].filter(Boolean).join("\n\n")
        : normalizeString(continuationContext?.providerInput?.prompt, ""),
      continuationTransportMode: "fresh_context",
      endpoint: this.endpoint || undefined,
      authStore: this.currentAuthStore(),
      refreshCredentials: this.refreshCredentials,
      profileDoc: this.profileDoc,
      model: normalizeString(turn?.model, ""),
      fetchImpl: this.fetchImpl || undefined,
      allowSequentialReadOnlyToolLoop: true,
      allowSequentialImplementationRepairLoop: true,
      continuationTools,
      onLifecycle: (event) => {
        if (event.phase === "streaming") {
          this.emitNotification(surfaceSession, "turn/started", {
            threadId: sessionId,
            turnId,
            turn: { id: turnId, status: "inProgress", startedAt: nowSeconds(), streamPhase: "continuation" },
          });
        }
      },
    });
    if (this.directThreadStore) {
      this.indexDirectThreadStoreSession(sessionId);
    }
    const continuationId = normalizeString(continuation.continuation?.continuationId || continuation.obligation?.continuationRequest?.continuationId, "continuation");
    this.emitContinuationAssistant(surfaceSession, sessionId, turnId, continuationId, continuation.normalizedEvents || []);
    await this.emitContinuationNextToolOrComplete(surfaceSession, sessionId, turnId, continuation, project, {
      streamPhase: "continuation",
      approvalMessage: "Direct read-only continuation requested another file. Local approval is required for the next read.",
      unavailableMessage: "Direct read-only continuation requested another tool call, but it is not available for approval.",
    });
    return {
      decision: "approved",
      turn: turnSnapshot(this.sessionStore.readTurn(sessionId, turnId)),
      obligation: continuation.obligation || approved.obligation,
      result: executed.result,
      continuation: {
        ok: continuation.ok,
        continuationId,
        terminal: continuation.terminal || null,
      },
    };
  }

  async approveExecuteAndContinuePatchApply(options = {}) {
    if (typeof this.workspaceRequest !== "function") {
      const error = new Error("Direct patch apply requires the workspace backend.");
      error.code = "workspace_patch_backend_unavailable";
      throw error;
    }
    const { sessionId, turnId, obligationId, project, surfaceSession } = options;
    approvePatchApplyObligation({
      sessionStore: this.sessionStore,
      sessionId,
      turnId,
      obligationId,
      approvedBy: "local-user",
    });
    const executed = await executeApprovedPatchApplyObligation({
      sessionStore: this.sessionStore,
      sessionId,
      turnId,
      obligationId,
      clientPatchDecisionId: normalizeString(options.clientPatchDecisionId, ""),
      workspaceRequest: (method, params) => this.workspaceRequest(project, method, params, this.readOnlyWorkspaceTimeoutMs),
    });
    const turn = this.sessionStore.readTurn(sessionId, turnId);
    const currentObligation = this.sessionStore.findToolObligation(sessionId, turnId, obligationId).obligation;
    const parentResponseId = parentResponseIdForToolStep(turn, currentObligation);
    const parentResponseSource = parentResponseSourceForToolStep(currentObligation);
    const stepOrdinal = Number(currentObligation.stepOrdinal || 1) || 1;
    const originalUserIntent = userPromptTextFromTurn(turn);
    const directStatus = this.statusForProject(project || {});
    const continuationToolNames = implementationContinuationToolNames(directStatus, originalUserIntent);
    const continuationToolComposition = composeImplementationToolBundleForRequest({
      projectId: normalizeString(project?.id || project?.projectId || project?.name, ""),
      sessionId,
      turnId,
      toolNames: continuationToolNames,
      useLaneDefaultTools: false,
      sourceMessageId: `${turnId}_${obligationId}_patch_continuation`,
      normalizedLaneRequestId: `normalized_lane_request_${turnId}_${obligationId}_${stepOrdinal}`,
      workThreadId: directWorkThreadContextCarrier(options).workThreadId,
      runtimeFactsId: directStatus.evidenceId || "direct_runtime_facts",
      externalCapabilityProfile: directStatus.externalCapabilityProfile,
      providerHostedToolsStatus: directStatus.providerHostedToolsStatus,
    });
    const continuationTools = continuationToolComposition.tools;
    const declaredContinuationToolNames = continuationToolComposition.toolNames;
    const implementationRepairContinuation = continuationToolNames.some((name) => name === "apply_patch" || name === "run_command");
    let continuationRequest = null;
    let continuationContext = null;
    if (this.directThreadStore && typeof this.directThreadStore.buildAndPersistContextForToolContinuation === "function") {
      this.indexDirectThreadStoreSession(sessionId);
      const baseContinuationRequest = buildPatchApplyContinuationRequest({
        sessionStore: this.sessionStore,
        sessionId,
        turnId,
        obligationId,
        continuationLiveSendEnabled: true,
        ...directWorkThreadContextCarrier(options),
      });
      continuationRequest = {
        ...baseContinuationRequest,
        source: {
          ...(baseContinuationRequest.source || {}),
          previousResponseId: parentResponseId,
          previousResponseIdSource: parentResponseSource,
          sourceEventDigest: sha256(parentResponseId),
          sourceTurnDigest: sha256(stableStringify({
            threadId: sessionId,
            turnId,
            responseId: parentResponseId,
            requestManifestId: normalizeString(turn?.requestManifestId, ""),
            patchPlanId: normalizeString(currentObligation.patchPlan?.patchPlanId, ""),
          })),
          sourceRequestManifestId: normalizeString(turn?.requestManifestId, ""),
          importedContinuityHandleUsed: false,
        },
      };
      const outputType = normalizeString(continuationRequest.toolResult?.outputType || continuationRequest.toolResult?.content?.[0]?.type, "");
      const continuationShape = {
        kind: "patch_apply_continuation",
        stream: true,
        store: false,
        tools: continuationTools.length > 0,
        toolCount: continuationTools.length,
        declaredToolNames: declaredContinuationToolNames,
        toolDeclarations: continuationTools.length > 0,
        toolOutputItem: false,
        parallelToolCalls: false,
        hasInstructions: true,
        hasPreviousResponseId: false,
        functionCallOutputCount: 0,
        customToolCallOutputCount: 0,
        providerCallType: normalizeString(continuationRequest.toolResult?.providerCallType, ""),
        providerOutputType: outputType,
        continuationTransportMode: "fresh_context",
        requestShapeClass: stepOrdinal > 1
          ? "direct_patch_apply_loop_continuation@1"
          : "direct_patch_apply_continuation@1",
        toolLoopId: normalizeString(continuationRequest.toolLoop?.toolLoopId, ""),
        stepId: normalizeString(continuationRequest.toolLoop?.stepId, ""),
        stepOrdinal,
        patchPlanId: normalizeString(currentObligation.patchPlan?.patchPlanId, ""),
        patchResultId: normalizeString(executed.result?.resultId, ""),
        ...continuationToolComposition.requestShapeFields,
      };
      continuationContext = this.directThreadStore.buildAndPersistContextForToolContinuation({
        sessionStore: this.sessionStore,
        session: this.sessionStore.readSession(sessionId),
        projectId: normalizeString(project?.id || project?.projectId || project?.name, ""),
        threadId: sessionId,
        turnId,
        obligationId,
        continuationRequest,
        previousResponseId: parentResponseId,
        model: normalizeString(turn?.model, ""),
        requestShape: continuationShape,
        requestShapeHash: sha256(stableStringify(continuationShape)),
        endpointClass: "chatgpt-codex-responses",
        endpointHash: this.endpoint ? sha256(this.endpoint) : "",
        modelEvidenceRef: normalizeString(this.statusForProject(project).evidenceId, ""),
        requestShapeEvidenceRef: continuationShape.requestShapeClass,
        endpointEvidenceRef: this.endpoint ? sha256(this.endpoint) : "",
        ...directWorkThreadContextCarrier(options),
      }, {
        sessionStore: this.sessionStore,
      });
      continuationRequest = {
        ...continuationRequest,
        source: {
          ...(continuationRequest.source || {}),
          contextBuildId: continuationContext.contextPack.contextBuildId,
          requestManifestId: continuationContext.requestManifest.requestManifestId,
        },
        safety: {
          ...(continuationRequest.safety || {}),
          contextPackBuilt: true,
          requestManifestBuilt: true,
          rawRequestBodyStored: false,
        },
      };
    }
    this.recordToolOperationHistory({
      project,
      sessionId,
      turnId,
      obligationId,
      toolName: "apply_patch",
      result: executed.result,
      continuation: { continuationId: normalizeString(continuationRequest?.continuationId, "") },
      clientDecisionId: normalizeString(options.clientPatchDecisionId, ""),
    });
    maybeInjectToolFaultAfterHistory("apply_patch");
    const patchContinuationInstructions = [
      normalizeString(continuationContext?.providerInput?.instructions, ""),
      DEFAULT_TOOL_CONTINUATION_INSTRUCTIONS,
    ].filter(Boolean).join("\n\n");
    const continuation = await runPersistedReadOnlyToolContinuation({
      sessionStore: this.sessionStore,
      sessionId,
      turnId,
      obligationId,
      continuationRequest,
      previousResponseId: parentResponseId,
      instructions: implementationRepairContinuation
        ? repairLoopContinuationInstructions(patchContinuationInstructions)
        : patchContinuationInstructions,
      prompt: implementationRepairContinuation && originalUserIntent
        ? [
            `[CURRENT USER INTENT]\n${originalUserIntent}`,
            normalizeString(continuationContext?.providerInput?.prompt, ""),
          ].filter(Boolean).join("\n\n")
        : normalizeString(continuationContext?.providerInput?.prompt, ""),
      continuationTransportMode: "fresh_context",
      endpoint: this.endpoint || undefined,
      authStore: this.currentAuthStore(),
      refreshCredentials: this.refreshCredentials,
      profileDoc: this.profileDoc,
      model: normalizeString(turn?.model, ""),
      fetchImpl: this.fetchImpl || undefined,
      allowSequentialReadOnlyToolLoop: false,
      allowSequentialImplementationRepairLoop: true,
      continuationTools,
      onLifecycle: (event) => {
        if (event.phase === "streaming") {
          this.emitNotification(surfaceSession, "turn/started", {
            threadId: sessionId,
            turnId,
            turn: { id: turnId, status: "inProgress", startedAt: nowSeconds(), streamPhase: "patch-continuation" },
          });
        }
      },
    });
    if (this.directThreadStore) this.indexDirectThreadStoreSession(sessionId);
    const continuationId = normalizeString(continuation.continuation?.continuationId || continuation.obligation?.continuationRequest?.continuationId, "patch_continuation");
    this.emitContinuationAssistant(surfaceSession, sessionId, turnId, continuationId, continuation.normalizedEvents || []);
    await this.emitContinuationNextToolOrComplete(surfaceSession, sessionId, turnId, continuation, project, {
      streamPhase: "patch-continuation",
      approvalMessage: "Direct patch continuation requested another tool. Local approval is required to continue the repair loop.",
      unavailableMessage: "Direct patch continuation requested another tool call, but it is not available for approval.",
    });
    return {
      decision: "approved",
      turn: turnSnapshot(this.sessionStore.readTurn(sessionId, turnId)),
      obligation: continuation.obligation || executed.obligation,
      result: executed.result,
      continuation: {
        ok: continuation.ok,
        continuationId,
        terminal: continuation.terminal || null,
      },
    };
  }

  async approveExecuteAndContinueCommandExecution(options = {}) {
    if (typeof this.workspaceRequest !== "function") {
      const error = new Error("Direct command execution requires the workspace backend.");
      error.code = "workspace_command_backend_unavailable";
      throw error;
    }
    const { sessionId, turnId, obligationId, project, surfaceSession } = options;
    approveCommandExecutionObligation({
      sessionStore: this.sessionStore,
      sessionId,
      turnId,
      obligationId,
      approvedBy: "local-user",
    });
    const executed = await executeApprovedCommandExecutionObligation({
      sessionStore: this.sessionStore,
      sessionId,
      turnId,
      obligationId,
      clientCommandDecisionId: normalizeString(options.clientCommandDecisionId, ""),
      workspaceRequest: (method, params) => this.workspaceRequest(project, method, params, Math.max(this.readOnlyWorkspaceTimeoutMs, Number(params?.timeoutMs || 0) + 5000)),
    });
    const turn = this.sessionStore.readTurn(sessionId, turnId);
    const currentObligation = this.sessionStore.findToolObligation(sessionId, turnId, obligationId).obligation;
    if (executed.result?.providerContinuationBlocked === true) {
      this.recordToolOperationHistory({
        project,
        sessionId,
        turnId,
        obligationId,
        toolName: "run_command",
        result: executed.result,
        continuation: {},
        clientDecisionId: normalizeString(options.clientCommandDecisionId, ""),
      });
      this.emitNotification(surfaceSession, "turn/completed", {
        threadId: sessionId,
        turnId,
        turn: {
          id: turnId,
          status: "failed",
          completedAt: nowSeconds(),
          streamPhase: "command-output-redaction-blocked",
        },
      });
      return {
        decision: "approved",
        turn: turnSnapshot(this.sessionStore.readTurn(sessionId, turnId)),
        obligation: currentObligation,
        result: executed.result,
        continuation: {
          ok: false,
          continuationId: "",
          terminal: {
            status: "failed",
            failureKind: "command_output_redaction_blocked",
            providerRequestStarted: false,
          },
        },
      };
    }
    const parentResponseId = parentResponseIdForToolStep(turn, currentObligation);
    const parentResponseSource = parentResponseSourceForToolStep(currentObligation);
    const stepOrdinal = Number(currentObligation.stepOrdinal || 1) || 1;
    const originalUserIntent = userPromptTextFromTurn(turn);
    const directStatus = this.statusForProject(project || {});
    const continuationToolNames = commandRepairContinuationToolNames(directStatus, originalUserIntent);
    const continuationToolComposition = composeImplementationToolBundleForRequest({
      projectId: normalizeString(project?.id || project?.projectId || project?.name, ""),
      sessionId,
      turnId,
      toolNames: continuationToolNames,
      useLaneDefaultTools: false,
      sourceMessageId: `${turnId}_${obligationId}_command_continuation`,
      normalizedLaneRequestId: `normalized_lane_request_${turnId}_${obligationId}_${stepOrdinal}`,
      workThreadId: directWorkThreadContextCarrier(options).workThreadId,
      runtimeFactsId: directStatus.evidenceId || "direct_runtime_facts",
      externalCapabilityProfile: directStatus.externalCapabilityProfile,
      providerHostedToolsStatus: directStatus.providerHostedToolsStatus,
    });
    const continuationTools = continuationToolComposition.tools;
    const declaredContinuationToolNames = continuationToolComposition.toolNames;
    const implementationRepairContinuation = continuationToolNames.some((name) => name === "apply_patch" || name === "run_command");
    let continuationRequest = null;
    let continuationContext = null;
    if (this.directThreadStore && typeof this.directThreadStore.buildAndPersistContextForToolContinuation === "function") {
      this.indexDirectThreadStoreSession(sessionId);
      const baseContinuationRequest = buildCommandExecutionContinuationRequest({
        sessionStore: this.sessionStore,
        sessionId,
        turnId,
        obligationId,
        continuationLiveSendEnabled: true,
        allowFurtherToolDeclarations: continuationToolNames.length > 0,
        continuationToolNames,
        ...directWorkThreadContextCarrier(options),
      });
      continuationRequest = {
        ...baseContinuationRequest,
        source: {
          ...(baseContinuationRequest.source || {}),
          previousResponseId: parentResponseId,
          previousResponseIdSource: parentResponseSource,
          sourceEventDigest: sha256(parentResponseId),
          sourceTurnDigest: sha256(stableStringify({
            threadId: sessionId,
            turnId,
            responseId: parentResponseId,
            requestManifestId: normalizeString(turn?.requestManifestId, ""),
            commandPlanId: normalizeString(currentObligation.commandPlan?.commandPlanId, ""),
          })),
          sourceRequestManifestId: normalizeString(turn?.requestManifestId, ""),
          importedContinuityHandleUsed: false,
        },
      };
      const outputType = normalizeString(continuationRequest.toolResult?.outputType || continuationRequest.toolResult?.content?.[0]?.type, "");
      const continuationShape = {
        kind: "command_execution_continuation",
        stream: true,
        store: false,
        tools: continuationTools.length > 0,
        toolCount: continuationTools.length,
        declaredToolNames: declaredContinuationToolNames,
        toolDeclarations: continuationTools.length > 0,
        toolOutputItem: false,
        parallelToolCalls: false,
        hasInstructions: true,
        hasPreviousResponseId: false,
        functionCallOutputCount: 0,
        customToolCallOutputCount: 0,
        providerCallType: normalizeString(continuationRequest.toolResult?.providerCallType, ""),
        providerOutputType: outputType,
        continuationTransportMode: "fresh_context",
        requestShapeClass: stepOrdinal > 1
          ? "direct_command_execution_loop_continuation@1"
          : "direct_command_execution_continuation@1",
        toolLoopId: normalizeString(continuationRequest.toolLoop?.toolLoopId, ""),
        stepId: normalizeString(continuationRequest.toolLoop?.stepId, ""),
        stepOrdinal,
        commandPlanId: normalizeString(currentObligation.commandPlan?.commandPlanId, ""),
        commandResultId: normalizeString(executed.result?.resultId, ""),
        ...continuationToolComposition.requestShapeFields,
      };
      continuationContext = this.directThreadStore.buildAndPersistContextForToolContinuation({
        sessionStore: this.sessionStore,
        session: this.sessionStore.readSession(sessionId),
        projectId: normalizeString(project?.id || project?.projectId || project?.name, ""),
        threadId: sessionId,
        turnId,
        obligationId,
        continuationRequest,
        previousResponseId: parentResponseId,
        model: normalizeString(turn?.model, ""),
        requestShape: continuationShape,
        requestShapeHash: sha256(stableStringify(continuationShape)),
        endpointClass: "chatgpt-codex-responses",
        endpointHash: this.endpoint ? sha256(this.endpoint) : "",
        modelEvidenceRef: normalizeString(this.statusForProject(project).evidenceId, ""),
        requestShapeEvidenceRef: continuationShape.requestShapeClass,
        endpointEvidenceRef: this.endpoint ? sha256(this.endpoint) : "",
        ...directWorkThreadContextCarrier(options),
      }, {
        sessionStore: this.sessionStore,
      });
      continuationRequest = {
        ...continuationRequest,
        source: {
          ...(continuationRequest.source || {}),
          contextBuildId: continuationContext.contextPack.contextBuildId,
          requestManifestId: continuationContext.requestManifest.requestManifestId,
        },
        safety: {
          ...(continuationRequest.safety || {}),
          contextPackBuilt: true,
          requestManifestBuilt: true,
          rawRequestBodyStored: false,
        },
      };
    }
    this.recordToolOperationHistory({
      project,
      sessionId,
      turnId,
      obligationId,
      toolName: "run_command",
      result: executed.result,
      continuation: { continuationId: normalizeString(continuationRequest?.continuationId, "") },
      clientDecisionId: normalizeString(options.clientCommandDecisionId, ""),
    });
    maybeInjectToolFaultAfterHistory("run_command");
    const commandContinuationInstructions = normalizeString(continuationContext?.providerInput?.instructions, "");
    const continuation = await runPersistedReadOnlyToolContinuation({
      sessionStore: this.sessionStore,
      sessionId,
      turnId,
      obligationId,
      continuationRequest,
      previousResponseId: parentResponseId,
      instructions: implementationRepairContinuation
        ? repairLoopContinuationInstructions(commandContinuationInstructions)
        : commandContinuationInstructions,
      prompt: implementationRepairContinuation && originalUserIntent
        ? [
            `[CURRENT USER INTENT]\n${originalUserIntent}`,
            normalizeString(continuationContext?.providerInput?.prompt, ""),
          ].filter(Boolean).join("\n\n")
        : normalizeString(continuationContext?.providerInput?.prompt, ""),
      continuationTransportMode: "fresh_context",
      endpoint: this.endpoint || undefined,
      authStore: this.currentAuthStore(),
      refreshCredentials: this.refreshCredentials,
      profileDoc: this.profileDoc,
      model: normalizeString(turn?.model, ""),
      fetchImpl: this.fetchImpl || undefined,
      allowSequentialReadOnlyToolLoop: false,
      allowSequentialImplementationRepairLoop: true,
      continuationTools,
      onLifecycle: (event) => {
        if (event.phase === "streaming") {
          this.emitNotification(surfaceSession, "turn/started", {
            threadId: sessionId,
            turnId,
            turn: { id: turnId, status: "inProgress", startedAt: nowSeconds(), streamPhase: "command-continuation" },
          });
        }
      },
    });
    if (this.directThreadStore) this.indexDirectThreadStoreSession(sessionId);
    const continuationId = normalizeString(continuation.continuation?.continuationId || continuation.obligation?.continuationRequest?.continuationId, "command_continuation");
    this.emitContinuationAssistant(surfaceSession, sessionId, turnId, continuationId, continuation.normalizedEvents || []);
    await this.emitContinuationNextToolOrComplete(surfaceSession, sessionId, turnId, continuation, project, {
      streamPhase: "command-continuation",
      approvalMessage: "Direct command continuation requested another tool. Local approval is required to continue the repair loop.",
      unavailableMessage: "Direct command continuation requested another tool call, but it is not available for approval.",
    });
    return {
      decision: "approved",
      turn: turnSnapshot(this.sessionStore.readTurn(sessionId, turnId)),
      obligation: continuation.obligation || executed.obligation,
      result: executed.result,
      continuation: {
        ok: continuation.ok,
        continuationId,
        terminal: continuation.terminal || null,
      },
    };
  }

  textPrompt(params = {}) {
    const prompt = normalizeString(params.promptText, "") || firstTextInput(params.input);
    if (!prompt) throw new Error("Direct live text turn requires prompt text.");
    if (prompt.length > this.maxPromptChars) {
      const error = new Error("Direct live text prompt exceeds the configured size limit.");
      error.code = "prompt_too_large";
      throw error;
    }
    return prompt;
  }

  directAttachmentCapability(project = {}, status = {}) {
    const projection = buildDirectAttachmentCapabilityProjection({
      projectId: normalizeString(project.id, ""),
      runtimeKind: DIRECT_LIVE_TEXT_SURFACE_TRANSPORT,
      status: status.status === "ready" ? "ready" : "blocked",
    });
    assertDirectAttachmentCapabilityProjectionSafe(projection);
    return projection;
  }

  directAttachmentSubmitPacket(params = {}, context = {}, prompt = "") {
    const attachments = Array.isArray(params.attachmentDrafts) ? params.attachmentDrafts : [];
    const capabilityProjection = this.directAttachmentCapability(context.project || {}, this.statusForProject(context.project || {}));
    const packet = buildDirectAttachmentSubmitPacket({
      projectId: normalizeString(context.project?.id, ""),
      surfaceId: "codex",
      turnClientId: normalizeString(params.clientTurnRequestId, ""),
      text: prompt,
      attachments,
      capabilityProjection,
    });
    assertDirectAttachmentSubmitPacketSafe(packet);
    if (packet.status === "blocked") {
      const error = new Error("Direct attachment submit packet contains unsupported attachments.");
      error.code = "direct_attachment_submit_blocked";
      error.attachmentSubmitPacket = {
        packetId: packet.packetId,
        unsupportedAttachments: packet.unsupportedAttachments,
      };
      throw error;
    }
    return { capabilityProjection, packet };
  }

  async startTurn(params = {}, context = {}) {
    const project = context.project || {};
    const status = this.assertReady(project);
    const surfaceSession = context.surfaceSession;
    const sessionId = normalizeString(params.sessionId || params.threadId, "");
    const session = this.sessionStore.readSession(sessionId);
    if (!session) throw new Error(`Direct live text session not found: ${sessionId}`);
    const clientTurnRequestId = normalizeString(params.clientTurnRequestId, "");
    if (!clientTurnRequestId) {
      const error = new Error("Direct live text turn requires clientTurnRequestId.");
      error.code = "missing_client_turn_request_id";
      throw error;
    }
    const rawPrompt = this.textPrompt(params);
    const attachmentSubmit = this.directAttachmentSubmitPacket(params, context, rawPrompt);
    const prompt = buildDirectAttachmentProviderPrompt(rawPrompt, attachmentSubmit.packet);
    const duplicate = this.findTurnByClientRequestId(session, clientTurnRequestId);
    if (duplicate) {
      if (turnPromptDigest(duplicate) !== sha256(prompt)) {
        const error = new Error("Direct live text clientTurnRequestId was reused with a different prompt.");
        error.code = "client_turn_request_id_conflict";
        throw error;
      }
      const requestedAttachmentDraftSetDigest = normalizeString(params.attachmentDraftSetDigest, "");
      const existingAttachmentDraftSetDigest = normalizeString(duplicate.requestShape?.directAttachmentDraftSetDigest, "");
      if (
        existingAttachmentDraftSetDigest &&
        requestedAttachmentDraftSetDigest !== existingAttachmentDraftSetDigest
      ) {
        const error = new Error("Direct live text clientTurnRequestId was reused with a different attachment draft set.");
        error.code = "client_turn_request_id_conflict";
        throw error;
      }
      return {
        turn: turnSnapshot(duplicate),
        reused: true,
        clientTurnRequestId,
      };
    }
    const activeTurn = this.activeTurnForSession(session);
    if (activeTurn) {
      const error = new Error(`Direct live text session already has an active turn: ${activeTurn.turnId}`);
      error.code = "active_turn_exists";
      error.activeTurnId = activeTurn.turnId;
      error.status = activeTurn.state;
      throw error;
    }
    const model = normalizeString(params.model, "") || status.model;
    const reasoningEffort = normalizeString(params.reasoningEffort || params.reasoning_effort || params.effort, session.reasoningEffort);
    const existingTurnIds = this.sessionStore.listTurnIdsFromDisk(session.sessionId);
    const existingTurnCount = existingTurnIds.length;
    const summaries = Array.isArray(session.turns) ? session.turns : [];
    const previousSummary = summaries.length ? summaries[summaries.length - 1] : null;
    const previousTurn = previousSummary?.turnId ? this.sessionStore.readTurn(session.sessionId, previousSummary.turnId) : null;
    const binding = normalizeCodexBinding(project.surfaceBinding?.codex || {});
    const directLiveTier = binding.runtimeMode === "direct-experimental" &&
      binding.directTransport === "live-text";
    const textOnlyTier = directLiveTier &&
      binding.directTier === "text-only";
    const implementationTier = directLiveTier &&
      binding.directTier === "implementation-lane";
    const implementationToolNames = implementationTier
      ? appendProviderHostedTools(
          appendExternalPromotedTools(
            appendNativeSubAgentRuntimeTools(
              appendReadOnlySubAgentStatusTools(
                appendSafeResidentUtilities(
                  implementationInitialToolNames(status, prompt),
                  status,
                ),
                status,
              ),
              status,
            ),
            status,
          ),
          status,
        )
      : [];
    const useRecentDialogue = existingTurnCount > 0;
    let frozenContextProjection = null;
    if (useRecentDialogue) {
      if (!previousTurn || !SAFE_TEXT_ONLY_FOLLOWUP_PREVIOUS_STATES.has(previousTurn.state)) {
        const error = new Error("Direct text-only follow-up requires the previous turn to have completed safely.");
        error.code = "previous_turn_not_safe";
        error.previousTurnState = normalizeString(previousTurn?.state, "");
        throw error;
      }
      const expectedPreviousTurnId = normalizeString(params.expectedPreviousTurnId, "");
      if (expectedPreviousTurnId && expectedPreviousTurnId !== previousTurn.turnId) {
        const error = new Error("Direct text-only follow-up previous turn id is stale.");
        error.code = "previous_turn_mismatch";
        throw error;
      }
      const expectedPreviousTurnDigest = normalizeString(params.expectedPreviousTurnDigest, "");
      if (expectedPreviousTurnDigest && expectedPreviousTurnDigest !== sha256(stableStringify({
        turnId: previousTurn.turnId,
        state: previousTurn.state,
        contextBuildId: previousTurn.contextBuildId || "",
        requestManifestId: previousTurn.requestManifestId || "",
        responseId: previousTurn.responseId || "",
      }))) {
        const error = new Error("Direct text-only follow-up previous turn digest is stale.");
        error.code = "previous_turn_mismatch";
        throw error;
      }
      const expectedNextTurnOrdinal = Number(params.expectedNextTurnOrdinal || 0);
      if (expectedNextTurnOrdinal > 0 && expectedNextTurnOrdinal !== existingTurnCount + 1) {
        const error = new Error("Direct text-only follow-up next turn ordinal is stale.");
        error.code = "next_turn_ordinal_mismatch";
        throw error;
      }
    }
    if (this.directThreadStore) {
      this.prepareDirectContextProjection(session.sessionId);
      if (useRecentDialogue && typeof this.directThreadStore.buildContextRecentDialogueProjection === "function") {
        const builtContext = this.directThreadStore.buildContextRecentDialogueProjection(session.sessionId, {
          sessionStore: this.sessionStore,
        });
        if (builtContext.status !== "valid") {
          const error = new Error("Direct text-only follow-up context projection is not valid.");
          error.code = "context_projection_failed";
          throw error;
        }
        frozenContextProjection = this.directThreadStore.projectionFromRow(
          this.directThreadStore.currentProjectionRow(session.sessionId, "context_recent_dialogue"),
        );
        if (!frozenContextProjection || frozenContextProjection.status !== "valid") {
          const error = new Error("Direct text-only follow-up context projection is missing.");
          error.code = "context_projection_failed";
          throw error;
        }
      }
    } else if (useRecentDialogue) {
      const error = new Error("Direct text-only follow-up requires the direct context store.");
      error.code = "context_store_unhealthy";
      throw error;
    }
    const workThreadCarrier = this.hydrateWorkThreadCarrier(
      directWorkThreadContextCarrier(params, session, context),
      project.id,
    );
    const requireControlledRouting = params.requireControlledRouting === true || params.controlledRouting?.required === true;
    const controlledRoutingRequested = Boolean(
      workThreadCarrier.workThread ||
      workThreadCarrier.workThreadBinding ||
      workThreadCarrier.workThreadId ||
      (Array.isArray(params.workThreads) && params.workThreads.length) ||
      requireControlledRouting ||
      params.controlledRouting?.enabled === true,
    );
    if (requireControlledRouting && !directLiveTier) {
      const error = new Error("Controlled routing requires the Direct live backend.");
      error.code = "controlled_routing_direct_live_required";
      throw error;
    }
    if (
      requireControlledRouting &&
      (!this.directThreadStore || typeof this.directThreadStore.buildAndPersistControlledRoutingForTextTurn !== "function")
    ) {
      const error = new Error("Controlled routing is required but the thread store does not support it.");
      error.code = "controlled_routing_unsupported";
      throw error;
    }
    let implementationToolComposition = implementationTier
      ? composeImplementationToolBundleForRequest({
          projectId: project.id,
          sessionId: session.sessionId,
          turnId: clientTurnRequestId,
          clientTurnRequestId,
          toolNames: implementationToolNames,
          useLaneDefaultTools: false,
          sourceMessageId: `${clientTurnRequestId}_user`,
          normalizedLaneRequestId: `normalized_lane_request_${clientTurnRequestId}`,
          workThreadId: workThreadCarrier.workThreadId,
          runtimeFactsId: status.evidenceId || status.modelEvidenceId || "direct_runtime_facts",
          externalCapabilityProfile: status.externalCapabilityProfile,
          providerHostedToolsStatus: status.providerHostedToolsStatus,
        })
      : null;
    let requestBody = implementationTier
        ? buildImplementationToolInitialRequest({
            profileDoc: this.profileDoc,
            model,
            prompt,
            reasoningEffort,
            tools: implementationToolComposition.tools,
            toolChoicePolicy: "auto",
          })
      : buildTextOnlyProbeRequest({
          profileDoc: this.profileDoc,
          model,
          prompt,
          reasoningEffort,
        });
    const turn = this.sessionStore.createTurn(session.sessionId, {
      input: [{ role: "user", text: prompt }],
      model: requestBody.model,
      reasoningEffort,
      clientTurnRequestId,
      requestShape: initialDirectTurnRequestShape(requestBody, { implementationTier, useRecentDialogue, toolComposition: implementationToolComposition?.composition }),
    });
    this.rememberClientTurnRequest(session.sessionId, clientTurnRequestId, turn.turnId);
    let contextResult = null;
    let controlledRoutingResult = null;
    let requestShape = null;
    try {
      if (this.directThreadStore && typeof this.directThreadStore.buildAndPersistContextForTextTurn === "function") {
        this.indexDirectThreadStoreSession(session.sessionId);
        const hasControlledRoutingInput = controlledRoutingRequested;
        if (hasControlledRoutingInput && typeof this.directThreadStore.buildAndPersistControlledRoutingForTextTurn === "function") {
          controlledRoutingResult = this.directThreadStore.buildAndPersistControlledRoutingForTextTurn({
            session,
            projectId: session.projectId,
            threadId: session.sessionId,
            turnId: turn.turnId,
            requestPreview: prompt,
            runtimePath: implementationTier ? "direct-implementation" : "direct-text",
            workThreads: Array.isArray(params.workThreads) ? params.workThreads : [],
            requireControlledRouting,
            ...workThreadCarrier,
          });
        }
        implementationToolComposition = implementationTier
          ? composeImplementationToolBundleForRequest({
              projectId: session.projectId,
              sessionId: session.sessionId,
              turnId: turn.turnId,
              clientTurnRequestId,
              toolNames: implementationToolNames,
              useLaneDefaultTools: false,
              sourceMessageId: `${turn.turnId}_user`,
              normalizedLaneRequestId: `normalized_lane_request_${turn.turnId}`,
              workThreadId: controlledRoutingResult?.route?.selectedWorkThreadId || workThreadCarrier.workThreadId,
              controlledRoutingResult,
              runtimeFactsId: status.evidenceId || status.modelEvidenceId || "direct_runtime_facts",
              externalCapabilityProfile: status.externalCapabilityProfile,
              providerHostedToolsStatus: status.providerHostedToolsStatus,
            })
          : null;
        contextResult = this.directThreadStore.buildAndPersistContextForTextTurn({
          session: this.sessionStore.readSession(session.sessionId) || session,
          projectId: session.projectId,
          threadId: session.sessionId,
          turnId: turn.turnId,
          currentUserPrompt: prompt,
          useRecentDialogue,
          requireRecentDialogue: useRecentDialogue,
          sourceContextProjectionId: normalizeString(frozenContextProjection?.projectionId, ""),
          expectedOperationLedgerHeadDigest: normalizeString(params.expectedOperationLedgerHeadDigest, ""),
          expectedRendererProjectionId: normalizeString(params.expectedRendererProjectionId, ""),
          expectedRendererProjectionDigest: normalizeString(params.expectedRendererProjectionDigest, ""),
          expectedContextProjectionId: normalizeString(params.expectedContextProjectionId, frozenContextProjection?.projectionId || ""),
          expectedContextProjectionDigest: normalizeString(params.expectedContextProjectionDigest, frozenContextProjection?.projectionDigest || ""),
          model: requestBody.model,
          requestShape: initialDirectTurnRequestShape(requestBody, { implementationTier, useRecentDialogue, toolComposition: implementationToolComposition?.composition }),
          endpointClass: "chatgpt-codex-responses",
          endpointHash: this.endpoint ? sha256(this.endpoint) : "",
          modelEvidenceRef: normalizeString(status.evidenceId, status.modelEvidenceId || ""),
          requestShapeEvidenceRef: implementationTier
            ? "direct_implementation_tool_initial@1"
            : useRecentDialogue ? "direct_text_turn_recent_dialogue@1" : "direct_text_turn_empty_context@1",
          endpointEvidenceRef: this.endpoint ? sha256(this.endpoint) : "",
          governanceRefs: controlledRoutingResult?.governanceRefs || params.governanceRefs,
          workThreadBinding: controlledRoutingResult?.workThreadBinding || workThreadCarrier.workThreadBinding,
          workThread: workThreadCarrier.workThread,
          workThreadId: controlledRoutingResult?.route?.selectedWorkThreadId || workThreadCarrier.workThreadId,
          authorityBoundary: workThreadCarrier.authorityBoundary,
          openObligations: workThreadCarrier.openObligations,
          bridgeInformationRefs: [
            ...(Array.isArray(workThreadCarrier.bridgeInformationRefs) ? workThreadCarrier.bridgeInformationRefs : []),
            ...(controlledRoutingResult?.route?.bridgeInformationRef ? [controlledRoutingResult.route.bridgeInformationRef] : []),
          ],
        });
        requestBody = implementationTier
          ? buildImplementationToolInitialRequest({
              profileDoc: this.profileDoc,
              model,
              prompt: contextResult.providerInput.prompt,
              instructions: implementationContextInstructions(contextResult.providerInput.instructions),
              reasoningEffort,
              tools: implementationToolComposition.tools,
              toolChoicePolicy: "auto",
            })
          : buildTextOnlyProbeRequest({
              profileDoc: this.profileDoc,
              model,
              prompt: contextResult.providerInput.prompt,
              instructions: contextResult.providerInput.instructions,
              reasoningEffort,
            });
      }
      requestShape = {
        ...initialDirectTurnRequestShape(requestBody, { implementationTier, useRecentDialogue, toolComposition: implementationToolComposition?.composition }),
        directAttachmentCapabilityProjectionDigest: attachmentSubmit.capabilityProjection.projectionDigest,
        directAttachmentSubmitPacketId: attachmentSubmit.packet.packetId,
        directAttachmentSubmitPacketDigest: attachmentSubmit.packet.packetDigest,
        directAttachmentDraftSetDigest: normalizeString(params.attachmentDraftSetDigest, ""),
        directAttachmentDispositionSummary: attachmentSubmit.packet.summary,
        directAttachmentRawPayloadIncluded: false,
        directAttachmentRawPathIncluded: false,
        ...(contextResult ? {
          contextBuildId: contextResult.contextPack.contextBuildId,
          contextPackContentHash: contextResult.contextPack.contextPackContentHash,
          contextPackShapeHash: contextResult.contextPack.contextPackShapeHash,
          requestManifestId: contextResult.requestManifest.requestManifestId,
          providerInputShapeHash: contextResult.providerInput.projection.providerInputShapeHash,
          rawRequestBodyStored: false,
          previousResponseIdUsed: false,
        } : {}),
        ...(controlledRoutingResult ? {
          controlledRoutingSliceId: controlledRoutingResult.route.routeId,
          controlledRoutingSliceDigest: controlledRoutingResult.route.routeDigest,
          controlledRoutingGateState: controlledRoutingResult.route.gateState,
          controlledRoutingProviderScope: controlledRoutingResult.route.providerCallScope,
        } : {}),
      };
      this.sessionStore.updateTurnState(session.sessionId, turn.turnId, "request_built", {
        requestShape,
        directAttachmentSubmitPacket: attachmentSubmit.packet,
        directAttachmentTranscriptWitnesses: attachmentSubmit.packet.transcriptWitnesses,
        ...(contextResult ? {
          contextBuildId: contextResult.contextPack.contextBuildId,
          requestManifestId: contextResult.requestManifest.requestManifestId,
          contextSummary: contextResult.rendererSafeSummary,
        } : {}),
        ...(controlledRoutingResult ? {
          controlledRoutingSliceId: controlledRoutingResult.route.routeId,
          controlledRoutingGateState: controlledRoutingResult.route.gateState,
        } : {}),
      });
    } catch (error) {
      this.sessionStore.updateTurnState(session.sessionId, turn.turnId, "failed", {
        error: {
          code: error.code || "direct_turn_pre_transport_failed",
          message: error.message || "Direct text turn failed before provider transport.",
        },
        requestShape: requestShape || initialDirectTurnRequestShape(requestBody, { implementationTier, useRecentDialogue, toolComposition: implementationToolComposition?.composition }),
        controlledRoutingGateState: controlledRoutingResult?.route?.gateState || "",
        preTransportFailed: true,
      });
      if (this.directThreadStore) {
        try {
          this.indexDirectThreadStoreSession(session.sessionId);
        } catch {}
      }
      throw error;
    }

    const userItem = {
      id: `${turn.turnId}_user`,
      type: "userMessage",
      turnId: turn.turnId,
      content: [{ type: "text", text: prompt, text_elements: [] }],
    };
    this.emitNotification(surfaceSession, "turn/started", {
      threadId: session.sessionId,
      turnId: turn.turnId,
      turn: { id: turn.turnId, status: "inProgress", startedAt: nowSeconds(), clientTurnRequestId },
    });
    this.emitNotification(surfaceSession, "item/started", {
      threadId: session.sessionId,
      turnId: turn.turnId,
      item: userItem,
    });
    this.emitNotification(surfaceSession, "item/completed", {
      threadId: session.sessionId,
      turnId: turn.turnId,
      item: userItem,
    });

    const abortController = new AbortController();
    const run = this.runTurn({
      sessionId: session.sessionId,
      turnId: turn.turnId,
      clientTurnRequestId,
      prompt: requestBody.input?.[0]?.content?.[0]?.text || prompt,
      instructions: requestBody.instructions,
      requestBody,
      requestKind: implementationTier ? "implementation_tool_initial" : "text_only",
      model: requestBody.model,
      reasoningEffort,
      project,
      surfaceSession,
      userItem,
      abortController,
    }).finally(() => {
      const active = this.activeRuns.get(turn.turnId);
      if (active?.promise === run) this.activeRuns.delete(turn.turnId);
    });
    this.activeRuns.set(turn.turnId, { abortController, promise: run });

    return {
      turn: {
        id: turn.turnId,
        status: "inProgress",
        state: "request_built",
        clientTurnRequestId,
      },
      reused: false,
    };
  }

  async startWorkerFromHandoff(params = {}, context = {}) {
    const project = context.project || {};
    const handoffPacket = isPlainObject(params.handoffPacket) ? params.handoffPacket : {};
    const workerPrompt = this.textPrompt({
      promptText: params.workerPrompt || params.promptText || params.prompt,
      input: params.input,
    });
    const transition = buildDirectWorkerStartTransition({
      projectId: normalizeString(project.id, handoffPacket.projectId || ""),
      parentThreadId: normalizeString(params.parentThreadId || handoffPacket.threadId, ""),
      primaryThreadId: normalizeString(params.primaryThreadId || params.parentThreadId || handoffPacket.threadId, ""),
      handoffPacket,
      operatorAcceptance: params.operatorAcceptance,
      workerPrompt,
      contextRefs: params.contextRefs,
    });
    validateDirectWorkerStartTransition(transition);
    if (transition.startState !== "ready_to_start") {
      const error = new Error("Direct worker start blocked.");
      error.code = "direct_worker_start_blocked";
      error.blockerCodes = transition.blockerCodes;
      error.workerStartTransition = transition;
      throw error;
    }
    const clientTurnRequestId = normalizeString(
      params.clientTurnRequestId,
      `client_worker_${sha256(`${transition.workerStartTransitionId}:${workerPrompt}`).slice(0, 20)}`,
    );
    const workerSessionId = normalizeString(
      params.workerSessionId || params.sessionId,
      `direct_worker_${sha256(`${transition.workerStartTransitionId}:${clientTurnRequestId}`).slice(0, 24)}`,
    );
    const selectedAgentClass = transition.selectedAgentClass || {};
    const agentLabel = normalizeString(
      params.agentLabel,
      selectedAgentClass.displayName || selectedAgentClass.agentClassKind || "Direct worker",
    );
    const startedThread = this.startThread({
      sessionId: workerSessionId,
      title: normalizeString(params.title, `${agentLabel} worker`),
      model: normalizeString(params.model, ""),
      reasoningEffort: normalizeString(params.reasoningEffort || params.reasoning_effort, ""),
      agentKind: "direct_worker",
      agentThreadId: workerSessionId,
      parentThreadId: transition.parentThreadId,
      primaryThreadId: transition.primaryThreadId,
      agentLabel,
      agentRole: normalizeString(selectedAgentClass.agentClassKind, "implementation_worker"),
      roleHandoffPacketId: transition.handoffRef.handoffPacketId,
      roleHandoffPacketDigest: transition.handoffRef.handoffPacketDigest,
      workerStartTransitionId: transition.workerStartTransitionId,
      workerStartTransitionDigest: transition.transitionDigest,
      workerContextPacketId: transition.contextPacket.workerContextPacketId,
      workerContextPacketDigest: transition.contextPacket.contextPacketDigest,
      workThreadId: transition.workThreadId,
    }, context);
    let workerSession = this.sessionStore.readSession(startedThread.thread.id);
    const workerGraph = buildAgentGraph({
      projectId: transition.projectId,
      primaryThreadId: transition.primaryThreadId,
      runtimeSourceClass: "direct_harness_agent_run",
      nodes: [{
        agentThreadId: startedThread.thread.id,
        parentThreadId: transition.parentThreadId,
        depth: 1,
        displayLabel: agentLabel,
        role: normalizeString(selectedAgentClass.agentClassKind, "implementation_worker"),
        model: normalizeString(params.model || workerSession?.model, ""),
        reasoningEffort: normalizeString(params.reasoningEffort || params.reasoning_effort || workerSession?.reasoningEffort, ""),
        lifecycleState: "running",
        activityState: "active",
        agentClassKind: normalizeString(selectedAgentClass.agentClassKind, "implementation_worker"),
        evidenceRefs: [{
          kind: "agent_run_record",
          artifactId: transition.workerStartTransitionId,
          artifactDigest: transition.transitionDigest,
          sourceConfidence: "accepted",
          rendererSafeLabel: "Direct worker start transition",
        }],
      }],
      edges: [{
        edgeKind: "spawned_child",
        parentThreadId: transition.parentThreadId,
        childThreadId: startedThread.thread.id,
        status: "in_progress",
        sourceCallId: transition.workerStartTransitionId,
        evidenceRefs: [{
          kind: "agent_run_record",
          artifactId: transition.handoffRef.handoffPacketId,
          artifactDigest: transition.handoffRef.handoffPacketDigest,
          sourceConfidence: "accepted",
          rendererSafeLabel: "Accepted role handoff packet",
        }],
      }],
    });
    const workerGraphAlignment = buildWorkerGraphAlignment({
      projectId: transition.projectId,
      primaryThreadId: transition.primaryThreadId,
      workThreadId: transition.workThreadId,
      workThreadRef: {
        workThreadId: transition.workThreadId,
        projectId: transition.projectId,
        workThreadDigest: normalizeString(handoffPacket.workThreadRef?.sourceDigest, ""),
      },
      agentGraph: workerGraph,
      agentClassRegistryRef: {
        registryId: normalizeString(params.agentClassRegistryId, ""),
        registryDigest: normalizeString(params.agentClassRegistryDigest, ""),
        registrySourceDigest: normalizeString(params.agentClassRegistrySourceDigest, ""),
        specs: [{
          agentClassId: normalizeString(selectedAgentClass.agentClassId, ""),
          agentClassKind: normalizeString(selectedAgentClass.agentClassKind, "implementation_worker"),
          specDigest: normalizeString(handoffPacket.selectedAgentClass?.specDigest, ""),
        }],
      },
    });
    validateWorkerGraphAlignment(workerGraphAlignment);
    workerSession = this.sessionStore.readSession(startedThread.thread.id);
    if (workerSession) {
      this.sessionStore.writeSession({
        ...workerSession,
        workerGraphAlignmentId: workerGraphAlignment.alignmentId,
        workerGraphAlignmentDigest: workerGraphAlignment.integrity?.artifactDigest || "",
      });
    }
    this.sessionStore.writeDiagnostic(startedThread.thread.id, "direct_worker_start", {
      transition,
      workerGraph,
      workerGraphAlignment,
    });
    if (this.directThreadStore) this.indexDirectThreadStoreSession(startedThread.thread.id);
    const startAck = await this.startTurn({
      threadId: startedThread.thread.id,
      sessionId: startedThread.thread.id,
      clientTurnRequestId,
      promptText: workerPrompt,
      model: normalizeString(params.model, ""),
      reasoningEffort: normalizeString(params.reasoningEffort || params.reasoning_effort, ""),
      workThreadId: transition.workThreadId,
      workThread: isPlainObject(params.workThread) ? params.workThread : handoffPacket.workThreadRef,
      authorityBoundary: isPlainObject(params.authorityBoundary) ? params.authorityBoundary : handoffPacket.authorityBoundary,
      bridgeInformationRefs: [{
        classId: "ic6.direct-worker-start-v0",
        role: "governance_routing",
        artifactKind: "direct_worker_start_transition",
        artifactId: transition.workerStartTransitionId,
        artifactDigest: transition.transitionDigest,
      }],
      governanceRefs: {
        roleHandoffPacketId: transition.handoffRef.handoffPacketId,
        roleHandoffPacketDigest: transition.handoffRef.handoffPacketDigest,
        workerStartTransitionId: transition.workerStartTransitionId,
        workerStartTransitionDigest: transition.transitionDigest,
        workerContextPacketId: transition.contextPacket.workerContextPacketId,
        workerContextPacketDigest: transition.contextPacket.contextPacketDigest,
      },
    }, context);
    const result = buildDirectWorkerStartResult({
      projectId: transition.projectId,
      transition,
      session: this.sessionStore.readSession(startedThread.thread.id) || workerSession || {},
      turn: startAck.turn,
      workerGraphAlignment,
      status: "started",
    });
    validateDirectWorkerStartResult(result);
    this.sessionStore.writeDiagnostic(startedThread.thread.id, "direct_worker_start_result", result);
    return {
      schema: "direct_worker_start_response@1",
      transition,
      workerGraphAlignment,
      result,
      thread: threadSnapshotFromSession(this.sessionStore.readSession(startedThread.thread.id) || {}),
      turn: startAck.turn,
      reused: startAck.reused === true,
    };
  }

  async runTurn(options = {}) {
    const {
      sessionId,
      turnId,
      clientTurnRequestId,
      prompt,
      instructions,
      requestBody,
      requestKind,
      model,
      reasoningEffort,
      project,
      surfaceSession,
      userItem,
      abortController,
    } = options;
    let terminalSent = false;
    const assistantItem = { id: `${turnId}_assistant`, type: "agentMessage", turnId, text: "" };
    let assistantStarted = false;
    let assistantCompleted = false;
    let firstVisibleDeltaMarked = false;
    const emittedItems = [userItem];
    const emittedMessageDeltaSequences = new Set();
    const emitAssistantStarted = () => {
      if (assistantStarted) return;
      assistantStarted = true;
      this.emitNotification(surfaceSession, "item/started", {
        threadId: sessionId,
        turnId,
        item: assistantItem,
      });
    };
    const emitAssistantCompleted = () => {
      if (!assistantStarted || assistantCompleted) return;
      assistantCompleted = true;
      this.emitNotification(surfaceSession, "item/completed", {
        threadId: sessionId,
        turnId,
        item: assistantItem,
      });
    };
    const emitAssistantDelta = (event, observedAt = "") => {
      if (event.type !== "message_delta") return;
      const sequence = Number.isFinite(Number(event.sequence)) ? Number(event.sequence) : null;
      if (sequence !== null && emittedMessageDeltaSequences.has(sequence)) return;
      emitAssistantStarted();
      if (assistantItem.text.length < this.maxAssistantChars) {
        const room = Math.max(0, this.maxAssistantChars - assistantItem.text.length);
        const truncatedDelta = String(event.text || "").slice(0, room);
        if (!truncatedDelta) return;
        if (!firstVisibleDeltaMarked) {
          firstVisibleDeltaMarked = true;
          this.sessionStore.updateTurnState(sessionId, turnId, "streaming", {
            firstVisibleDeltaAt: normalizeString(observedAt, nowIso()),
          });
        }
        assistantItem.text += truncatedDelta;
        if (sequence !== null) emittedMessageDeltaSequences.add(sequence);
        this.emitNotification(surfaceSession, "item/agentMessage/delta", {
          threadId: sessionId,
          turnId,
          itemId: assistantItem.id,
          delta: truncatedDelta,
        });
      }
    };
    const callerLifecycle = (event) => {
      if (event.phase === "streaming") {
        this.sessionStore.updateTurnState(sessionId, turnId, "streaming", {
          streamStartedAt: event.at,
          responseStatus: event.status,
          responseContentType: event.contentType,
        });
      }
      if (event.phase === "first_sse_frame") {
        this.sessionStore.updateTurnState(sessionId, turnId, "streaming", {
          firstResponseByteAt: event.at,
        });
      }
      if (event.phase === "first_normalized_event") {
        this.sessionStore.updateTurnState(sessionId, turnId, "streaming", {
          firstNormalizedEventAt: event.at,
        });
      }
    };
    const probeOptions = {
      endpoint: this.endpoint || undefined,
      authStore: this.currentAuthStore(),
      refreshCredentials: this.refreshCredentials,
      profileDoc: this.profileDoc,
      model,
      reasoningEffort,
      prompt,
      instructions,
      fetchImpl: this.fetchImpl || undefined,
      signal: abortController.signal,
      onLifecycle: callerLifecycle,
      onNormalizedEvents: (events, details = {}) => {
        for (const event of Array.isArray(events) ? events : []) emitAssistantDelta(event, details.at);
      },
    };
    const result = requestKind === "implementation_tool_initial"
      ? await runImplementationToolInitialProbe({
          ...probeOptions,
          requestBody,
        })
      : await runTextOnlyDirectProbe(probeOptions);
    this.sessionStore.writeDiagnostic(sessionId, "direct_live_text_turn", {
      ...result.diagnostic,
      clientTurnRequestId,
      directTransport: DIRECT_LIVE_TEXT_SURFACE_TRANSPORT,
    });
    if (result.normalizedEvents.length) {
      this.sessionStore.appendNormalizedEvents(sessionId, turnId, result.normalizedEvents);
    }
    const terminal = result.terminal || { state: result.ok ? "completed" : "failed", error: result.error || null };
    for (const event of result.normalizedEvents) {
      emitAssistantDelta(event);
    }
    if (assistantStarted) {
      emittedItems.push(assistantItem);
      emitAssistantCompleted();
    }

    const binding = normalizeCodexBinding(project.surfaceBinding?.codex || {});
    const textOnlyTier = binding.runtimeMode === "direct-experimental" &&
      binding.directTransport === "live-text" &&
      binding.directTier === "text-only";
    let obligationResult = this.sessionStore.addToolObligations(sessionId, turnId, result.normalizedEvents, {
      parentResponseId: result.responseId || "",
      parentResponseSource: "native_direct_initial_stream",
      stepOrdinal: 1,
    });
    if (textOnlyTier && obligationResult.obligations.length) {
      const unsupported = [];
      for (const obligation of obligationResult.obligations) {
        const updated = this.sessionStore.updateToolObligation(sessionId, turnId, obligation.obligationId, {
          status: "unsupported",
          failureKind: "provider_tool_call_in_text_only_tier",
          authorityState: "text_only_tier_blocked",
          approvalAvailable: false,
          executionAllowed: false,
          continuationAllowed: false,
          sideEffectExecuted: false,
        }).obligation;
        unsupported.push(updated);
      }
      obligationResult = { ...obligationResult, obligations: unsupported };
    }
    if (obligationResult.obligations.length) {
      for (const item of obligationResult.obligations.map(toolTranscriptItemFromObligation)) {
        emittedItems.push(item);
        this.emitNotification(surfaceSession, "item/started", { threadId: sessionId, turnId, item });
        this.emitNotification(surfaceSession, "item/completed", { threadId: sessionId, turnId, item });
      }
    }

    const toolBlockedTextOnly = textOnlyTier && obligationResult.obligations.length > 0;
    let terminalState = toolBlockedTextOnly ? "tool_call_blocked_text_only" : obligationResult.obligations.length ? "tool_waiting" : terminal.state;
    const terminalCode = normalizeString(terminal.error?.code, "");
    if (!toolBlockedTextOnly && !obligationResult.obligations.length) {
      if (terminalCode === "response_incomplete") terminalState = "response_incomplete";
      else if (terminalCode === "content_filter" || terminalCode === "content_filter_terminal") terminalState = "content_filter_terminal";
      else if (terminalCode === "max_output" || terminalCode === "max_output_terminal") terminalState = "max_output_terminal";
      else if (terminal.state === "completed" && !assistantItem.text) terminalState = "empty_output_terminal";
    }
    const completedTurn = this.sessionStore.updateTurnState(sessionId, turnId, terminalState, {
      ...(toolBlockedTextOnly
        ? { error: { code: "provider_tool_call_in_text_only_tier", message: "Direct text-only does not execute or continue tool calls." } }
        : terminalState === "empty_output_terminal"
          ? { error: { code: "empty_output_terminal", message: "Direct text-only response completed without assistant text." } }
          : terminal.error ? { error: terminal.error } : {}),
      responseId: result.responseId || "",
      responseStatus: result.response?.status || 0,
      responseContentType: result.response?.contentType || "",
      ...(toolBlockedTextOnly ? { toolExecuted: false, continuationSent: false } : {}),
    });
    this.appendSessionTurn(sessionId, turnId, emittedItems, model, terminalState);
    if (this.directThreadStore) {
      this.indexDirectThreadStoreSession(sessionId);
      try {
        this.directThreadStore.buildRendererTranscriptProjection(sessionId, { sessionStore: this.sessionStore });
      } catch {}
    }
    if (obligationResult.obligations.length && !toolBlockedTextOnly) {
      const createdApprovalRequests = await this.emitToolApprovalRequests(surfaceSession, sessionId, turnId, obligationResult.obligations, project);
      this.emitNotification(surfaceSession, "warning", {
        threadId: sessionId,
        turnId,
        message: createdApprovalRequests
          ? "Direct live text detected a tool call. Local approval is required before local authority is used."
          : "Direct live text detected a tool call, but the required direct tool continuation evidence is not enabled.",
      });
    } else if (toolBlockedTextOnly) {
      this.emitNotification(surfaceSession, "warning", {
        threadId: sessionId,
        turnId,
        message: "The model requested a tool call, but Direct text-only does not execute tools.",
      });
    }

    const finalTurn = this.sessionStore.readTurn(sessionId, turnId) || completedTurn;
    if (
      finalTurn.state === "failed" ||
      finalTurn.state === "aborted" ||
      finalTurn.state === "tool_call_blocked_text_only" ||
      finalTurn.state === "response_incomplete" ||
      finalTurn.state === "content_filter_terminal" ||
      finalTurn.state === "max_output_terminal" ||
      finalTurn.state === "empty_output_terminal"
    ) {
      this.emitNotification(surfaceSession, "error", {
        threadId: sessionId,
        turnId,
        error: finalTurn.error || result.error || { code: finalTurn.state, message: `Direct live text turn ${finalTurn.state}.` },
      });
    }
    if (!terminalSent) {
      terminalSent = true;
      this.emitNotification(surfaceSession, "turn/completed", {
        threadId: sessionId,
        turnId,
        turn: {
          id: turnId,
          status: terminalStatusForState(finalTurn.state),
          completedAt: nowSeconds(),
          durationMs: Math.max(0, Date.parse(finalTurn.updatedAt) - Date.parse(finalTurn.createdAt)),
        },
      });
    }
    return {
      turn: turnSnapshot(finalTurn),
      result,
    };
  }

  readThread(params = {}, context = {}) {
    const projectId = normalizeString(context.project?.id, "");
    const sessionId = normalizeString(params.sessionId || params.threadId, "");
    const session = this.sessionStore.readSession(sessionId);
    if (!session) throw new Error(`Direct live text session not found: ${sessionId}`);
    if (!sessionMatchesProject(session, projectId)) {
      throw new Error("Direct live text session does not belong to the active project.");
    }
    return {
      thread: threadSnapshotFromSession(session),
      model: session.model,
    };
  }

  interruptTurn(params = {}) {
    const turnId = normalizeString(params.turnId, "");
    const sessionId = normalizeString(params.sessionId || params.threadId, "");
    const turn = turnId && sessionId ? this.sessionStore.readTurn(sessionId, turnId) : null;
    if (!turn) throw new Error(`Direct live text turn not found: ${turnId || "missing"}.`);
    if (TERMINAL_TURN_STATES.has(turn.state)) {
      return { turn: turnSnapshot(turn), status: `${turn.state}_already` };
    }
    const active = this.activeRuns.get(turn.turnId);
    if (active?.abortController) {
      active.abortController.abort();
      return { turn: turnSnapshot(turn), status: "abort_requested" };
    }
    const aborted = this.sessionStore.updateTurnState(sessionId, turnId, "aborted", {
      error: null,
    });
    return { turn: turnSnapshot(aborted), status: "aborted" };
  }

  async handleRequest(method, params = {}, context = {}) {
    if (method === "initialize") return this.initialize(params, context);
    if (method === "account/read") return this.accountRead(params, context);
    if (method === "configRequirements/read") return this.configRequirementsRead(params, context);
    if (method === "thread/start") return this.startThread(params, context);
    if (method === "thread/list") return this.listThreads(params, context);
    if (method === "thread/read") return this.readThread(params, context);
    if (method === "turn/start") return this.startTurn(params, context);
    if (method === "worker/start") return this.startWorkerFromHandoff(params, context);
    if (method === "turn/interrupt" || method === "turn/abort") return this.interruptTurn(params, context);
    throw new Error(`Direct live text controller does not support ${method}.`);
  }
}

class DirectLiveTextSurfaceSession extends EventEmitter {
  constructor(webContents, options = {}) {
    super();
    this.webContents = webContents;
    this.controller = options.controller;
    this.project = options.project || null;
    this.connection = null;
    this.connectionId = "";
    this.transportKind = DIRECT_LIVE_TEXT_SURFACE_TRANSPORT;
    this.serverRequests = new Map();
  }

  sendEvent(payload) {
    this.emit("event", payload);
    if (!this.webContents || this.webContents.isDestroyed()) return;
    this.webContents.send("codex-surface:event", payload);
  }

  emitStatus(status, extra = {}) {
    this.sendEvent({
      type: "connection-status",
      status,
      error: extra.error || "",
      connection: this.connection,
      connectionId: this.connectionId,
    });
  }

  createUserInputRequest(input = {}) {
    const params = isPlainObject(input.params) ? input.params : {};
    const id = normalizeString(input.id, `direct_user_input_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`);
    const key = `direct:${id}`;
    const now = nowIso();
    const record = {
      id,
      key,
      method: "item/tool/requestUserInput",
      title: "Tool user input",
      summary: normalizeString(input.summary || params.questions?.[0]?.question || "request_user_input", "request_user_input"),
      riskCategory: "user-input",
      status: "pending",
      params,
      createdAt: now,
      updatedAt: now,
    };
    this.serverRequests.set(key, record);
    this.sendEvent({
      type: "rpc-request",
      request: this.publicServerRequest(record),
    });
    return this.publicServerRequest(record);
  }

  async handleUserInputResponse(record = {}, result = {}, context = {}) {
    return this.controller.handleUserInputResponse(record, result || {}, {
      project: this.project,
      surfaceSession: this,
      connection: this.connection,
      ...context,
    });
  }

  async connect(connection = {}) {
    this.connectionId = crypto.randomUUID();
    const status = this.controller?.statusForProject?.(this.project || {}) || {};
    this.connection = {
      ...connection,
      transport: DIRECT_LIVE_TEXT_SURFACE_TRANSPORT,
      connectionId: this.connectionId,
      capabilities: connection.capabilities || buildDirectLiveTextCapabilities(status),
    };
    this.emitStatus("connected");
    return {
      connected: true,
      connection: this.connection,
      connectionId: this.connectionId,
    };
  }

  async request(method, params = {}) {
    if (!this.controller) throw new Error("Direct live text controller is unavailable.");
    try {
      return await this.controller.handleRequest(String(method || ""), params || {}, {
        project: this.project,
        surfaceSession: this,
        connection: this.connection,
      });
    } catch (error) {
      throw normalizeDirectSurfaceRequestError(error);
    }
  }

  async notify() {
    return true;
  }

  publicServerRequest(record = {}) {
    return {
      key: record.key,
      id: record.id,
      method: record.method,
      title: record.title,
      summary: record.summary,
      riskCategory: record.riskCategory,
      status: record.status,
      params: record.params,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      responseSummary: record.responseSummary || "",
      errorSummary: record.errorSummary || "",
      rawBackendFramesExposed: false,
      rawAuthHeadersExposed: false,
    };
  }

  createReadOnlyToolRequest(input = {}) {
    const params = isPlainObject(input.params) ? input.params : {};
    const id = normalizeString(input.id, `direct_readonly_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`);
    const key = `direct:${id}`;
    const now = nowIso();
    const record = {
      id,
      key,
      method: "direct/tool/readOnly/requestApproval",
      title: "Approve read-only file access",
      summary: normalizeString(input.summary || params.relPath || params.tool, "read_file"),
      riskCategory: "readOnly",
      status: "pending",
      params,
      createdAt: now,
      updatedAt: now,
    };
    this.serverRequests.set(key, record);
    this.sendEvent({
      type: "rpc-request",
      request: this.publicServerRequest(record),
    });
    return this.publicServerRequest(record);
  }

  createPatchApplyRequest(input = {}) {
    const params = isPlainObject(input.params) ? input.params : {};
    const id = normalizeString(input.id, `direct_patch_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`);
    const key = `direct:${id}`;
    const now = nowIso();
    const record = {
      id,
      key,
      method: "direct/tool/patchApply/requestApproval",
      title: "Approve patch apply",
      summary: normalizeString(input.summary || "apply_patch", "apply_patch"),
      riskCategory: "write",
      status: "pending",
      params,
      createdAt: now,
      updatedAt: now,
    };
    this.serverRequests.set(key, record);
    this.sendEvent({
      type: "rpc-request",
      request: this.publicServerRequest(record),
    });
    return this.publicServerRequest(record);
  }

  createCommandExecutionRequest(input = {}) {
    const params = isPlainObject(input.params) ? input.params : {};
    const id = normalizeString(input.id, `direct_command_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`);
    const key = `direct:${id}`;
    const now = nowIso();
    const record = {
      id,
      key,
      method: "direct/tool/command/requestApproval",
      title: "Approve command execution",
      summary: normalizeString(input.summary || params.displayCommand || "run_command", "run_command"),
      riskCategory: "command",
      status: "pending",
      params,
      createdAt: now,
      updatedAt: now,
    };
    this.serverRequests.set(key, record);
    this.sendEvent({
      type: "rpc-request",
      request: this.publicServerRequest(record),
    });
    return this.publicServerRequest(record);
  }

  async respond(key, result = {}) {
    const requestKey = normalizeString(key, "");
    const record = this.serverRequests.get(requestKey);
    if (!record) throw new Error("Direct live text runtime has no pending server request.");
    if (record.status !== "pending") {
      return { request: this.publicServerRequest(record), reused: true };
    }
    try {
      const handler = record.method === "direct/tool/patchApply/requestApproval"
        ? "handlePatchApplyResponse"
        : record.method === "direct/tool/command/requestApproval"
          ? "handleCommandExecutionResponse"
          : record.method === "item/tool/requestUserInput"
            ? "handleUserInputResponse"
            : "handleReadOnlyToolResponse";
      const response = await this.controller[handler](record, result || {}, {
        project: this.project,
        surfaceSession: this,
        connection: this.connection,
      });
      const next = {
        ...record,
        status: "completed",
        updatedAt: nowIso(),
        response,
        responseSummary: response?.decision || "completed",
      };
      this.serverRequests.set(requestKey, next);
      this.sendEvent({
        type: "rpc-request-updated",
        request: this.publicServerRequest(next),
      });
      return { request: this.publicServerRequest(next), response };
    } catch (error) {
      const next = {
        ...record,
        status: "failed",
        updatedAt: nowIso(),
        errorSummary: error?.message || "Direct read-only tool response failed.",
      };
      this.serverRequests.set(requestKey, next);
      this.sendEvent({
        type: "rpc-request-updated",
        request: this.publicServerRequest(next),
      });
      throw error;
    }
  }

  hasServerRequest(key = "") {
    if (!key) return [...this.serverRequests.values()].some((request) => request.status === "pending");
    return this.serverRequests.has(key);
  }

  async dispose(options = {}) {
    if (!options.silent) this.emitStatus("disconnected", { error: options.reason || "" });
    this.connection = null;
    this.connectionId = "";
  }
}

module.exports = {
  DIRECT_LIVE_TEXT_SURFACE_TRANSPORT,
  DirectLiveTextController,
  DirectLiveTextSurfaceSession,
  buildDirectLiveTextCapabilities,
  modelEvidenceFor,
};
