"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
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
  DIRECT_SELF_CONSTITUTION_TOOL_NAME,
  buildSelfConstitutionResultEnvelope,
  compileDirectSelfConstitutionSnapshot,
  renderDirectSelfConstitutionInstructions,
} = require("../bridge/self-constitution");
const {
  validateRoleLedgerToolBundle,
} = require("../worldmanager/ledger-tool-compiler");
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
const {
  issueWorkspaceParentAuthorityFromDelegationPolicy,
} = require("../agents/workspace-worker-delegation-policy");
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
  buildExternalCapabilityProfile,
  validateExternalCapabilityProfile,
} = require("../external/external-capability-profile");
const {
  PROVIDER_HOSTED_ACTIVATION_SNAPSHOT_SCHEMA,
  PROVIDER_HOSTED_TOOLS_STATUS_SCHEMA,
} = require("../provider/hosted-tools");
const {
  buildMcpResourceReadEnvelope,
} = require("../external/mcp-resource-read-envelope");
const {
  DIRECT_PROVIDER_METADATA_PROFILE_SCHEMA,
  validateDirectProviderMetadataProfile,
} = require("../provider/metadata-adapter");
const {
  authorizeDirectThreadHarnessCapability,
  capabilityNames: harnessGrantCapabilityNames,
  inheritDirectThreadHarnessGrant,
  validateDirectThreadHarnessGrant,
} = require("../authority/direct-thread-harness-grant");
const {
  STATEFUL_EXEC_CAPABILITY_NAMES,
} = require("../tools/stateful-exec-session");

const DIRECT_LIVE_TEXT_SURFACE_TRANSPORT = "direct-live-text";
const DIRECT_SERVICE_TIERS = new Set(["fast", "flex"]);
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
  DIRECT_SELF_CONSTITUTION_TOOL_NAME,
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
const MAX_AGENT_RUNTIME_TOOL_LOOP_STEPS = 32;
const NATIVE_AGENT_RUNTIME_CONTINUATION_INSTRUCTIONS = [
  "You are Codex orchestrating a Direct child-agent lifecycle after a resident agent-runtime result.",
  "Treat a spawn result in running, queued, or accepted state as launch acknowledgement only, never as evidence that the delegated task completed.",
  "Re-read the current user request and preserve its completion contract.",
  "If the request requires child output, terminal state, inspection, or aggregated results, request exactly one supported next agent-runtime tool call: use wait_agent for pending children, then inspect_agent only when inspection evidence is requested or necessary.",
  "If a bounded wait returns while a required child is still nonterminal, request another bounded wait rather than answering final.",
  "Answer final only after the requested child lifecycle evidence is available, unless the user explicitly requested a background-only launch.",
  "Never invent child output, terminal state, continuation counts, transport counts, or epistemic-capture status.",
  "Do not request workspace, shell, patch, browser, network, MCP, or unrelated tools in this continuation lane.",
].join(" ");
function statefulExecContinuationInstructions(capabilityNames = [], sessionId = "") {
  const allowed = [...new Set((Array.isArray(capabilityNames) ? capabilityNames : [])
    .map((name) => normalizeString(name, ""))
    .filter((name) => STATEFUL_EXEC_CAPABILITY_NAMES.includes(name)))];
  const declared = allowed.length ? allowed.join(", ") : "no further stateful-exec tool";
  const session = normalizeString(sessionId, "");
  return [
    "You are Codex continuing after an owner-authorized stateful exec result.",
    `Only the currently declared and granted stateful-exec family is available: ${declared}.`,
    session
      ? `If requesting write_stdin, use exactly the returned live session ID ${session}; never invent, substitute, or omit the session ID.`
      : "If requesting write_stdin, use exactly the returned live session ID from the quoted stateful result; never invent or substitute a session ID.",
    "Use the quoted stateful result as evidence and preserve its terminal or live state.",
    "If no further stateful call is needed, answer final.",
    allowed.includes("exec_command")
      ? "exec_command is permitted, including its shell-backed command execution."
      : "exec_command is not declared and must not be requested.",
    allowed.includes("write_stdin")
      ? "write_stdin is permitted only with the exact returned live session ID."
      : "write_stdin is not declared and must not be requested.",
    "Do not request read_file, workspace, patch, browser, network, MCP, or any undeclared or unrelated tool.",
    "Never invent process, session, output, completion, or continuation state.",
  ].join(" ");
}
const SELF_CONSTITUTION_CONTINUATION_INSTRUCTIONS = [
  "You are Codex continuing after an owner-issued inspect_self_constitution result.",
  "Use the returned snapshot as the authoritative account of your current role, project/workspace binding, persistence, declared versus potential capabilities, authority state, provider readiness, context binding, and delegation capacity.",
  "Distinguish potential, selected, authorized, and executed capability states exactly as represented.",
  "Do not use stale generic prompt prose to override the snapshot, and do not invent unavailable runtime facts.",
  "Answer the user's introspection question directly without requesting another tool.",
].join(" ");
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

function liveModelEvidenceBlockerReason(reason = "") {
  const normalized = normalizeString(reason, "");
  if ([
    "expired",
    "missing",
    "scope_mismatch",
    "candidate",
    "unstable",
    "rejected",
  ].includes(normalized)) {
    return `live_probe_evidence_${normalized}`;
  }
  return normalized;
}

function liveTextReadinessErrorMessage(status = {}) {
  if (status.reason === "live_probe_evidence_expired") {
    return "Direct live-model capability evidence expired. Run the scoped Direct live probe before starting another turn.";
  }
  return status.reason || status.status;
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

function directHistoryHeadDigest(session = {}) {
  const turns = Array.isArray(session.turns) ? session.turns : [];
  return sha256(stableStringify({
    threadId: normalizeString(session.sessionId, ""),
    turns: turns.map((turn) => ({
      turnId: normalizeString(turn?.turnId, ""),
      state: normalizeString(turn?.state, ""),
      updatedAt: normalizeString(turn?.updatedAt, ""),
      normalizedEventCount: Number(turn?.normalizedEventCount || 0),
    })).filter((turn) => turn.turnId),
    lastTurnId: normalizeString(turns.at(-1)?.turnId, ""),
  }));
}

function directTurnControlInput(params = {}) {
  const input = Array.isArray(params.input) ? params.input : [];
  const text = normalizeString(params.promptText || params.text, "") || firstTextInput(input);
  if (!text) {
    const error = new Error("Direct turn control requires a non-empty text input.");
    error.code = "direct_turn_control_input_missing";
    throw error;
  }
  return [{ role: "user", text }];
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

function buildDirectLiveTextCapabilities(status = {}, options = {}) {
  const ready = status.status === "ready";
  const harnessGrant = isPlainObject(options.harnessGrant) ? options.harnessGrant : null;
  const fullAccess = ready && Boolean(harnessGrant && validateDirectThreadHarnessGrant(harnessGrant, { requireCurrent: true }).length === 0);
  const taskId = normalizeString(options.taskId, "");
  const readOnlyToolReady = ready && status.readOnlyToolContinuation?.status === "ready";
  const patchApplyReady = ready && status.patchApplyContinuation?.status === "ready";
  const commandExecutionReady = ready && status.commandExecutionContinuation?.status === "ready";
  const patchApplyApprovalReady = ready && scopedProofApprovalReady(status.patchApplyContinuation);
  const commandExecutionApprovalReady = ready && scopedProofApprovalReady(status.commandExecutionContinuation);
  const statefulExecGranted = fullAccess &&
    harnessGrantCapabilityNames(harnessGrant).includes("exec_command");
  const stdinGranted = statefulExecGranted &&
    harnessGrantCapabilityNames(harnessGrant).includes("write_stdin");
  const toolMethods = [];
  if (readOnlyToolReady && !fullAccess) toolMethods.push("direct/tool/readOnly/requestApproval");
  if (patchApplyReady && !fullAccess) toolMethods.push("direct/tool/patchApply/requestApproval");
  if (commandExecutionReady && !fullAccess) toolMethods.push("direct/tool/command/requestApproval");
  const attachmentCapability = buildDirectAttachmentCapabilityProjection({
    runtimeKind: DIRECT_LIVE_TEXT_SURFACE_TRANSPORT,
    workspaceKind: normalizeString(status.workspaceKind || status.workspace?.kind, ""),
    status: ready ? "ready" : "blocked",
    providerMetadataProfile: status.providerMetadataProfile,
    providerAttachmentCapability: status.providerAttachmentCapability,
  });
  const metadata = isPlainObject(status.providerMetadataProfile) ? status.providerMetadataProfile : null;
  const metadataFresh = !["stale", "missing", "failed", "invalid"].includes(normalizeString(status.providerMetadataCacheState, ""));
  const modelCatalogAvailable = ready && metadataFresh && metadata?.modelCatalog?.status === "available" &&
    Array.isArray(metadata.modelCatalog.items) && metadata.modelCatalog.items.length > 0;
  const hostedToolNames = providerHostedToolNames(status);
  const externalToolNames = externalPromotedToolNames(status);
  const runtimeCapabilityProjection = {
    schema: "direct_runtime_capability_projection@1",
    source: "direct-live-text-task-capability-projection",
    authoritative: true,
    scope: taskId ? "task" : "project",
    taskId,
    projectId: normalizeString(options.projectId, ""),
    grantId: normalizeString(harnessGrant?.grantId, ""),
    grantRevision: Number(harnessGrant?.grantRevision || 0),
    current: fullAccess,
    declaredToolNames: fullAccess ? harnessGrantCapabilityNames(harnessGrant) : [],
    rawGrantIncluded: false,
    rawProviderPayloadIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
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
      canStartLogin: status.accountLoginAvailable === true,
    },
    configRequirements: {
      canRead: true,
    },
    threads: {
      canStart: ready,
      canSelectAccessProfile: ready,
      canRead: true,
      canResume: ready,
      canList: true,
      canFork: ready,
      canRollback: ready,
      canPersistExtendedHistory: true,
    },
    turns: {
      canStart: ready,
      canSteer: ready,
      canInterrupt: true,
      canOverrideModel: ready,
      canOverrideReasoning: ready,
      canUseOutputSchema: false,
    },
    model: {
      canList: modelCatalogAvailable,
      canSetNextTurn: ready,
      canSetSessionDefault: false,
      canSetProjectDefault: false,
      canLiveUpdate: false,
    },
    reasoning: {
      canSetNextTurn: ready,
      canSetSessionDefault: false,
      canSetProjectDefault: false,
      canLiveUpdate: false,
    },
    serviceTier: {
      canSetNextTurn: ready,
      availableTiers: [...DIRECT_SERVICE_TIERS],
    },
    usage: {
      canReadRateLimits: modelCatalogAvailable && metadataFresh && Boolean(metadata?.usage?.quota),
      canReadTokenUsage: modelCatalogAvailable && metadataFresh && Boolean(metadata?.usage?.tokenUsage || metadata?.usage?.accountTokenProfile),
    },
    environment: {
      canReadStatus: ready && status.environmentStatusAvailable === true,
    },
    authority: {
      commandApproval: fullAccess ? false : commandExecutionApprovalReady,
      fileChangeApproval: fullAccess ? false : patchApplyApprovalReady,
      permissionsApproval: false,
      approvalPolicies: [
        ...(fullAccess ? ["never"] : []),
        ...(readOnlyToolReady ? ["explicit-read-only-tool"] : []),
        ...(patchApplyApprovalReady ? ["explicit-patch-apply"] : []),
        ...(commandExecutionApprovalReady ? ["explicit-command-execution"] : []),
      ],
      sandboxModes: fullAccess ? ["danger-full-access"] : [],
      readOnlyToolApproval: fullAccess ? false : readOnlyToolReady,
      patchApplyApproval: fullAccess ? false : patchApplyApprovalReady,
      commandExecutionApproval: fullAccess ? false : commandExecutionApprovalReady,
      fullAccessTaskProfile: fullAccess,
      fullAccessGrantId: normalizeString(harnessGrant?.grantId, ""),
      fullAccessGrantRevision: Number(harnessGrant?.grantRevision || 0),
      statefulExecApproval: statefulExecGranted ? false : null,
      statefulStdinApproval: stdinGranted ? false : null,
    },
    statefulExec: {
      canStart: statefulExecGranted,
      canWriteStdin: stdinGranted,
      transportMode: "plain_pipe",
      ptyModeEnabled: false,
      approvalPolicy: statefulExecGranted ? "never" : "per_session",
      exactTaskBindingRequired: true,
      restrictedWithoutGrant: true,
    },
    taskBinding: taskId
      ? {
          taskId,
          projectId: normalizeString(options.projectId, ""),
          grantId: normalizeString(harnessGrant?.grantId, ""),
          grantRevision: Number(harnessGrant?.grantRevision || 0),
          current: fullAccess,
          rawGrantIncluded: false,
        }
      : null,
    runtimeCapabilityProjection,
    requests: {
      supportedServerMethods: [
        ...(ready ? ["thread/resume", "thread/fork", "thread/rollback", "turn/steer"] : []),
        ...(modelCatalogAvailable ? ["model/list"] : []),
        ...(metadataFresh && metadata?.usage?.quota ? ["account/rateLimits/read"] : []),
        ...(metadataFresh && (metadata?.usage?.tokenUsage || metadata?.usage?.accountTokenProfile) ? ["account/usage/read"] : []),
        ...(status.environmentStatusAvailable === true ? ["environment/status"] : []),
        ...(status.accountLoginAvailable === true ? ["account/login/start"] : []),
        ...toolMethods,
        ...(statefulExecGranted ? ["exec_command", ...(stdinGranted ? ["write_stdin"] : [])] : []),
        ...hostedToolNames,
        ...externalToolNames,
      ],
      unsupportedButHandledMethods: [],
      unknownRequestPolicy: "error-visible",
    },
    diagnostics: {
      runtime: DIRECT_LIVE_TEXT_SURFACE_TRANSPORT,
      source: "direct-live-text-controller",
      appServerRequired: false,
      toolsEnabled: readOnlyToolReady || patchApplyReady || commandExecutionReady || statefulExecGranted,
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
  if (!runtimeReady || ["stale", "missing", "failed", "invalid"].includes(normalizeString(status.providerMetadataCacheState, ""))) return [];
  const metadata = status.providerMetadataProfile;
  const hostedStatus = status.providerHostedToolsStatus;
  const snapshot = status.providerHostedToolsStatus?.activationSnapshot;
  const profileDigest = normalizeString(metadata?.profileDigest, "");
  const projectId = normalizeString(metadata?.projectId, "");
  if (hostedStatus?.schema !== PROVIDER_HOSTED_TOOLS_STATUS_SCHEMA ||
      snapshot?.schema !== PROVIDER_HOSTED_ACTIVATION_SNAPSHOT_SCHEMA ||
      !profileDigest || !projectId || snapshot.providerProfileDigest !== profileDigest || snapshot.projectId !== projectId) return [];
  const readyTools = snapshot?.activationReadyTools;
  if (!Array.isArray(readyTools)) return [];
  return [...new Set(readyTools
    .filter((tool) => tool?.invocationMode === "model_mediated_provider_tool")
    .map((tool) => normalizeString(tool?.toolKind, ""))
    .filter((tool) => tool === "web_search" || tool === "image_generation"))];
}

function appendProviderHostedTools(toolNames = [], status = {}) {
  return [...new Set([
    ...(Array.isArray(toolNames) ? toolNames : []),
    ...providerHostedToolNames(status),
  ].map((name) => normalizeString(name, "")).filter(Boolean))];
}

function implementationInitialPolicyCandidateToolNames(status = {}, prompt = "", options = {}) {
  const harnessGrant = isPlainObject(options.harnessGrant) ? options.harnessGrant : null;
  if (harnessGrant) {
    const currentHosted = new Set(providerHostedToolNames(status));
    const currentExternal = new Set(externalPromotedToolNames(status));
    return harnessGrantCapabilityNames(harnessGrant).filter((name) => {
      if (["web_search", "image_generation"].includes(name)) return currentHosted.has(name);
      if (EXTERNAL_PROMOTED_TOOL_SET.has(name)) return currentExternal.has(name);
      return true;
    });
  }
  return appendProviderHostedTools(
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
  );
}

function isSafeResidentUtilityToolName(toolName = "") {
  return SAFE_RESIDENT_UTILITY_TOOL_SET.has(normalizeString(toolName, ""));
}

function isEpistemicLedgerToolName(toolName = "") {
  return normalizeString(toolName, "").startsWith("ledger_");
}

function isReadOnlySubAgentStatusToolName(toolName = "") {
  return READ_ONLY_SUB_AGENT_STATUS_TOOL_SET.has(normalizeString(toolName, ""));
}

function isNativeSubAgentRuntimeToolName(toolName = "") {
  return NATIVE_SUB_AGENT_RUNTIME_TOOL_SET.has(normalizeString(toolName, ""));
}

function workspaceWorkerSpawnHasUndeclaredFields(args = {}) {
  const admittedFields = new Set([
    "task_name",
    "message",
    "agent_type",
    "provider",
    "model",
    "reasoning_effort",
    "fork_turns",
    "workspace_mode",
    "tool_profile",
    "policy_exception_reason",
    "policy_disposition",
  ]);
  return Object.keys(isPlainObject(args) ? args : {}).some((key) => !admittedFields.has(key));
}

function typedWorkspaceWorkerParentResultCode(update = {}) {
  const state = normalizeString(update.state, "failed");
  if (state === "completed") {
    return update.epistemicCaptureComplete === true
      ? "direct_workspace_worker_completed_captured"
      : "direct_workspace_worker_completed";
  }
  return `direct_workspace_worker_${["failed", "timeout", "cancelled"].includes(state) ? state : "status"}`;
}

function safeWorkspaceWorkerBlockerCode(update = {}) {
  const code = normalizeString(update.blockerCode, "");
  return /^(?:direct_|workspace_)[A-Za-z0-9._:-]{0,183}$/.test(code) ? code : "";
}

function projectAllowsProviderWorkspaceWorkers(project = {}) {
  const binding = isPlainObject(project?.surfaceBinding?.codex)
    ? project.surfaceBinding.codex
    : {};
  return (
    binding.runtimeMode === "direct-experimental" &&
    binding.directTransport === "live-text" &&
    binding.directTier === "implementation-lane"
  );
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

function selfConstitutionEnactmentUpdatesFromTurn(turn = {}) {
  const updates = {};
  for (const obligation of Array.isArray(turn.unresolvedObligations)
    ? turn.unresolvedObligations
    : []) {
    const toolName = normalizeString(obligation?.name, "");
    if (!toolName) continue;
    const status = normalizeString(obligation.status, "requested");
    const result = isPlainObject(obligation.result) ? obligation.result : {};
    const hasExecutionEvidence = Boolean(
      obligation.sideEffectExecuted === true ||
      result.sideEffectExecuted === true ||
      normalizeString(result.resultId, "") ||
      normalizeString(result.envelopeId, ""),
    );
    let enactmentState = "requested";
    if (hasExecutionEvidence) {
      enactmentState = "executed";
    } else if (["approved", "executing"].includes(status)) {
      enactmentState = "scheduled";
    } else if (["declined", "canceled", "unsupported", "failed"].includes(status)) {
      enactmentState = "failed";
    }
    let authorityState = "not_requested";
    if (["approval_waiting", "human_decision_waiting", "waiting"].includes(
      normalizeString(obligation.authorityState, status),
    )) {
      authorityState = "approval_gated";
    } else if (["declined", "canceled"].includes(status)) {
      authorityState = "denied";
    } else if (["unsupported", "failed"].includes(status)) {
      authorityState = "blocked";
    } else if (
      hasExecutionEvidence ||
      ["approved", "executing", "continuation_ready", "continuation_sent"].includes(status)
    ) {
      authorityState = "authorized";
    }
    updates[toolName] = {
      state: enactmentState,
      evidenceRef: normalizeString(
        result.resultId || result.envelopeId || obligation.obligationId || obligation.callId,
        "",
      ),
      authority: {
        state: authorityState,
      },
    };
  }
  return updates;
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
        agentId: normalizeString(row.agentThreadId || row.childAgentId, ""),
        taskName: normalizeString(row.taskName, ""),
        label: normalizeString(row.displayLabel, ""),
        role: normalizeString(row.agentClassKind || row.role, ""),
        lifecycleState: normalizeString(row.lifecycleState || row.nodeState || row.state, ""),
        activityState: normalizeString(row.activityState || row.nodeState || row.state, ""),
        terminal: row.terminal === true || ["completed", "failed", "timeout", "cancelled"].includes(row.state),
        model: normalizeString(row.model, ""),
        reasoningEffort: normalizeString(row.reasoningEffort, ""),
        contextHandoff: isPlainObject(row.contextHandoff) ? row.contextHandoff : null,
        resultSummary: normalizeString(row.resultSummary, ""),
      })),
      readOnly: true,
      canInterfere: false,
    };
  }
  const inspectPacket = isPlainObject(payload.inspectPacket) ? payload.inspectPacket : {};
  const agentNode = isPlainObject(inspectPacket.agent)
    ? inspectPacket.agent
    : isPlainObject(inspectPacket.agentNode) ? inspectPacket.agentNode : inspectPacket;
  return {
    kind: "inspect_agent_result",
    status: normalizeString(result?.status, "completed"),
    blockerCode: normalizeString(result?.blockerCode, ""),
    agentId: normalizeString(agentNode.agentThreadId || agentNode.childAgentId || inspectPacket.requestedAgentThreadId || payload.targetAgentId, ""),
    taskName: normalizeString(agentNode.taskName, ""),
    label: normalizeString(agentNode.displayLabel, ""),
    role: normalizeString(agentNode.agentClassKind || agentNode.role, ""),
    lifecycleState: normalizeString(agentNode.lifecycleState || agentNode.nodeState || agentNode.state, ""),
    activityState: normalizeString(agentNode.activityState || agentNode.state, ""),
    model: normalizeString(agentNode.model, ""),
    reasoningEffort: normalizeString(agentNode.reasoningEffort, ""),
    contextHandoff: isPlainObject(agentNode.contextHandoff) ? agentNode.contextHandoff : null,
    resultSummary: normalizeString(agentNode.resultSummary, ""),
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

function implementationContextInstructions(contextInstructions = "", selfConstitutionSnapshot = null) {
  const contextText = normalizeString(contextInstructions, "");
  const constitutionText = selfConstitutionSnapshot
    ? renderDirectSelfConstitutionInstructions(selfConstitutionSnapshot)
    : DEFAULT_IMPLEMENTATION_TOOL_INSTRUCTIONS;
  if (!contextText) return constitutionText;
  return `${contextText}\n\n${constitutionText}`;
}

function selfConstitutionRequestShapeFields(snapshot = {}) {
  if (!isPlainObject(snapshot) || !normalizeString(snapshot.digest, "")) return {};
  return {
    selfConstitutionSnapshotId: normalizeString(snapshot.snapshotId, ""),
    selfConstitutionSnapshotDigest: normalizeString(snapshot.digest, ""),
    selfConstitutionSchema: normalizeString(snapshot.schema, ""),
    selfConstitutionBindingKind: normalizeString(snapshot.projectBinding?.bindingKind, ""),
    selfConstitutionSubstrateKind: normalizeString(snapshot.projectBinding?.substrateKind, ""),
    selfConstitutionDeclaredToolCount: Number(snapshot.capabilities?.declaredThisTurn?.length || 0),
    selfConstitutionOwner: normalizeString(snapshot.currentness?.owner, ""),
    selfConstitutionRawWorkspacePathIncluded: snapshot.safety?.rawWorkspacePathIncluded === true,
    selfConstitutionRawSecretIncluded: snapshot.safety?.rawSecretIncluded === true,
  };
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
  const roleLedgerToolBundle = isPlainObject(
    composition.roleLedgerToolBundle,
  )
    ? composition.roleLedgerToolBundle
    : null;
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
    ...(composition.composerInput?.harnessGrant ? {
      directThreadHarnessGrantId: normalizeString(composition.composerInput.harnessGrant.grantId, ""),
      directThreadHarnessGrantRevision: Number(composition.composerInput.harnessGrant.grantRevision || 0),
      directThreadHarnessGrantApprovalPolicy: normalizeString(composition.composerInput.harnessGrant.approvalPolicy, ""),
      directThreadHarnessGrantSandboxMode: normalizeString(composition.composerInput.harnessGrant.sandboxMode, ""),
      directThreadHarnessGrantExecutionEnvironmentDigest: normalizeString(composition.composerInput.harnessGrant.executionEnvironmentDigest, ""),
      directThreadHarnessGrantAuthorityMode: "durable_task_grant",
    } : {}),
    ...(roleLedgerToolBundle ? {
      roleLedgerToolBundleId: normalizeString(
        roleLedgerToolBundle.bundleId,
        "",
      ),
      roleLedgerToolBundleDigest: normalizeString(
        roleLedgerToolBundle.digest,
        "",
      ),
      roleLedgerToolOperationCount: Number(
        roleLedgerToolBundle.operationNames?.length || 0,
      ),
      unrestrictedLedgerWriteAvailable:
        roleLedgerToolBundle.unrestrictedWriteAvailable === true,
      canonicalLedgerAdmissionEnabled:
        roleLedgerToolBundle.canonicalAdmissionEnabled === true,
    } : {}),
  };
}

function composeImplementationToolBundleForRequest(input = {}) {
  const sessionId = normalizeString(input.sessionId || input.threadId, "direct_session");
  const turnId = normalizeString(input.turnId, "turn");
  const projectId = normalizeString(input.projectId, "project_direct");
  const toolNames = Array.isArray(input.toolNames) ? input.toolNames : [];
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
  const baseComposition = composeDirectToolBundle({
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
    executionEnvironmentDigest: input.executionEnvironmentDigest || input.workThreadBindingDigest || controlledRoutingResult?.workThreadBinding?.bindingDigest || contextResult?.workThreadBinding?.bindingDigest,
    harnessGrant: input.harnessGrant,
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
  const roleLedgerToolBundle = isPlainObject(input.roleLedgerToolBundle)
    ? input.roleLedgerToolBundle
    : null;
  if (roleLedgerToolBundle) {
    validateRoleLedgerToolBundle(roleLedgerToolBundle);
    if (!["implementation_worker", "review_auditor"].includes(
      roleLedgerToolBundle.roleLane,
    )) {
      const error = new Error(
        "Direct implementation request received an unsupported role ledger bundle.",
      );
      error.code = "direct_epistemic_ledger_role_mismatch";
      throw error;
    }
    if (
      roleLedgerToolBundle.scope?.projectId &&
      roleLedgerToolBundle.scope.projectId !== projectId
    ) {
      const error = new Error(
        "Direct implementation ledger bundle project scope is stale.",
      );
      error.code = "direct_epistemic_ledger_project_scope_mismatch";
      throw error;
    }
    if (
      roleLedgerToolBundle.scope?.workThreadId &&
      roleLedgerToolBundle.scope.workThreadId !== workThreadId
    ) {
      const error = new Error(
        "Direct implementation ledger bundle work-thread scope is stale.",
      );
      error.code = "direct_epistemic_ledger_work_thread_scope_mismatch";
      throw error;
    }
  }
  const baseTools = baseComposition.providerDeclaredToolBundle.toolDeclarations;
  const baseToolNames = baseComposition.providerDeclaredToolBundle.declaredToolNames;
  const ledgerTools = roleLedgerToolBundle?.providerDeclarations || [];
  const ledgerToolNames = roleLedgerToolBundle?.operationNames || [];
  const collisions = ledgerToolNames.filter((name) =>
    baseToolNames.includes(name));
  if (collisions.length) {
    const error = new Error(
      `Direct implementation tool bundle contains ledger-name collisions: ${collisions.join(", ")}`,
    );
    error.code = "direct_epistemic_ledger_tool_name_collision";
    throw error;
  }
  const declaredLedgerNames = ledgerTools.map((tool) =>
    normalizeString(tool?.name, ""));
  if (
    ledgerToolNames.length !== declaredLedgerNames.length ||
    ledgerToolNames.some((name, index) => name !== declaredLedgerNames[index])
  ) {
    const error = new Error(
      "Direct implementation ledger declarations do not match their compiled operation order.",
    );
    error.code = "direct_epistemic_ledger_declaration_mismatch";
    throw error;
  }
  const composition = roleLedgerToolBundle
    ? {
        ...baseComposition,
        roleLedgerToolBundle,
        roleLedgerToolBundleRef: {
          kind: "role_ledger_tool_bundle",
          id: roleLedgerToolBundle.bundleId,
          digest: roleLedgerToolBundle.digest,
        },
        roleLedgerProviderSupplement: {
          schema: "direct_role_ledger_provider_supplement@1",
          baseProviderBundleRef:
            baseComposition.providerDeclaredToolBundle.bundleId,
          baseProviderBundleDigest:
            baseComposition.providerDeclaredToolBundle.declarationDigest,
          roleLedgerToolBundleRef: {
            kind: "role_ledger_tool_bundle",
            id: roleLedgerToolBundle.bundleId,
            digest: roleLedgerToolBundle.digest,
          },
          combinedDeclaredToolNames: [
            ...baseToolNames,
            ...ledgerToolNames,
          ],
          supplementDigest: `sha256:${sha256(stableStringify({
            baseProviderBundleDigest:
              baseComposition.providerDeclaredToolBundle.declarationDigest,
            roleLedgerToolBundleDigest: roleLedgerToolBundle.digest,
            ledgerToolNames,
          }))}`,
          grantsAuthority: false,
        },
      }
    : baseComposition;
  return {
    composition,
    tools: [...baseTools, ...ledgerTools],
    toolNames: [...baseToolNames, ...ledgerToolNames],
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
    serviceTier: normalizeString(session.serviceTier, ""),
    agentId: normalizeString(session.agentId, ""),
    agentRunId: normalizeString(session.agentRunId, ""),
    parentAgentId: normalizeString(session.parentAgentId, ""),
    parentAgentRunId: normalizeString(session.parentAgentRunId, ""),
    agentRefState: normalizeString(session.agentId, "") && normalizeString(session.agentRunId, "") ? "linked" : "legacy_unlinked",
    agentKind,
    agentThreadId: normalizeString(session.agentThreadId, ""),
    parentThreadId: normalizeString(session.parentThreadId, ""),
    parentForkLineage: isPlainObject(session.parentForkLineage) ? session.parentForkLineage : null,
    historyHeadTurnId: normalizeString(session.historyHeadTurnId || turns.at(-1)?.turnId, ""),
    historyHeadDigest: normalizeString(session.historyHeadDigest, directHistoryHeadDigest(session)),
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
    serviceTier: normalizeString(entry.serviceTier, ""),
    agentKind,
    agentThreadId: normalizeString(entry.agentThreadId, ""),
    parentThreadId: normalizeString(entry.parentThreadId, ""),
    historyHeadTurnId: normalizeString(entry.historyHeadTurnId, ""),
    historyHeadDigest: normalizeString(entry.historyHeadDigest, ""),
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
    model: normalizeString(turn.model, ""),
    reasoningEffort: normalizeString(turn.reasoningEffort, ""),
    serviceTier: normalizeString(turn.serviceTier, ""),
    clientTurnRequestId: normalizeString(turn.clientTurnRequestId, ""),
    requestBinding: {
      model: normalizeString(turn.model, ""),
      reasoningEffort: normalizeString(turn.reasoningEffort, ""),
      serviceTier: normalizeString(turn.serviceTier, ""),
      requestShapeClass: normalizeString(turn.requestShape?.requestShapeClass, ""),
      ownerControlledSurface: turn.requestShape?.directTurnOwnerControlled === true,
    },
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
    this.activeSubAgentPolicySemanticPreflight =
      typeof options.activeSubAgentPolicySemanticPreflight === "function"
        ? options.activeSubAgentPolicySemanticPreflight
        : null;
    this.activeSubAgentPolicyResolver =
      typeof options.activeSubAgentPolicyResolver === "function"
        ? options.activeSubAgentPolicyResolver
        : null;
    this.activeSubAgentPolicyProjectionResolver =
      typeof options.activeSubAgentPolicyProjectionResolver === "function"
        ? options.activeSubAgentPolicyProjectionResolver
        : null;
    this.workspaceWorkerDelegationPolicyResolver =
      typeof options.workspaceWorkerDelegationPolicyResolver === "function"
        ? options.workspaceWorkerDelegationPolicyResolver
        : null;
    this.externalCapabilityProfileResolver = typeof options.externalCapabilityProfileResolver === "function" ? options.externalCapabilityProfileResolver : null;
    this.providerHostedToolsStatusResolver = typeof options.providerHostedToolsStatusResolver === "function" ? options.providerHostedToolsStatusResolver : null;
    this.providerMetadataResolver = typeof options.providerMetadataResolver === "function" ? options.providerMetadataResolver : null;
    this.accountLoginResolver = typeof options.accountLoginResolver === "function" ? options.accountLoginResolver : null;
    this.configRequirementsResolver = typeof options.configRequirementsResolver === "function" ? options.configRequirementsResolver : null;
    this.environmentStatusResolver = typeof options.environmentStatusResolver === "function" ? options.environmentStatusResolver : null;
    this.attachmentPayloadResolver = typeof options.attachmentPayloadResolver === "function" ? options.attachmentPayloadResolver : null;
    this.externalDiscoveryResolver = typeof options.externalDiscoveryResolver === "function" ? options.externalDiscoveryResolver : null;
    this.mcpResourceReadResolver = typeof options.mcpResourceReadResolver === "function" ? options.mcpResourceReadResolver : null;
    this.harnessGrantStore = options.harnessGrantStore || null;
    this.statefulExecSessionManager = options.statefulExecSessionManager &&
      typeof options.statefulExecSessionManager.start === "function"
      ? options.statefulExecSessionManager
      : null;
    this.fullAccessLocalEnvironmentExecutor = options.fullAccessLocalEnvironmentExecutor &&
      typeof options.fullAccessLocalEnvironmentExecutor.request === "function"
      ? options.fullAccessLocalEnvironmentExecutor
      : null;
    this.harnessGrantResolver = typeof options.harnessGrantResolver === "function"
      ? options.harnessGrantResolver
      : null;
    this.compiledAgentContextResolver = typeof options.compiledAgentContextResolver === "function"
      ? options.compiledAgentContextResolver
      : null;
    this.epistemicLedgerToolBundleResolver =
      typeof options.epistemicLedgerToolBundleResolver === "function"
        ? options.epistemicLedgerToolBundleResolver
        : null;
    this.epistemicLedgerToolInvoker =
      typeof options.epistemicLedgerToolInvoker === "function"
        ? options.epistemicLedgerToolInvoker
        : null;
    this.epistemicContextDeliveryResolver =
      typeof options.epistemicContextDeliveryResolver === "function"
        ? options.epistemicContextDeliveryResolver
        : null;
    this.epistemicContextDeliveryRecorder =
      typeof options.epistemicContextDeliveryRecorder === "function"
        ? options.epistemicContextDeliveryRecorder
        : null;
    this.threadControlFaultInjector =
      typeof options.threadControlFaultInjector === "function"
        ? options.threadControlFaultInjector
        : null;
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
    this.turnStartAdmissions = new Map();
    this.epistemicLedgerTurnBindings = new Map();
    this.closed = false;
    this.statefulExecDisposePromise = null;
  }

  resolveHarnessGrant(project = {}, session = {}) {
    const projectId = normalizeString(project.id || project.projectId || session.projectId, "");
    const threadId = normalizeString(session.sessionId || session.threadId, "");
    const expected = {
      taskId: threadId,
      threadId,
      projectId,
      executionEnvironmentDigest: normalizeString(
        session.executionEnvironmentDigest || session.workThreadBindingDigest || project.executionEnvironmentDigest,
        "",
      ),
      grantId: normalizeString(session.harnessGrantId, ""),
    };
    let grant = null;
    if (this.harnessGrantResolver) {
      grant = this.harnessGrantResolver({ project, session, ...expected });
    } else if (this.harnessGrantStore) {
      if (expected.grantId && typeof this.harnessGrantStore.reconstruct === "function") {
        try {
          grant = this.harnessGrantStore.reconstruct(expected.grantId, expected);
        } catch {
          grant = null;
        }
      }
      if (!grant && typeof this.harnessGrantStore.currentForScope === "function") {
        grant = this.harnessGrantStore.currentForScope(expected);
      }
    }
    if (!isPlainObject(grant)) return null;
    const errors = validateDirectThreadHarnessGrant(grant, { ...expected, requireCurrent: true });
    if (errors.length) return null;
    return grant;
  }

  harnessGrantForTurn(sessionId, turnId, project = {}) {
    const session = this.sessionStore.readSession(sessionId) || {};
    const turn = this.sessionStore.readTurn(sessionId, turnId) || {};
    const grantId = normalizeString(turn.requestShape?.directThreadHarnessGrantId || session.harnessGrantId, "");
    const grant = this.resolveHarnessGrant(project, { ...session, harnessGrantId: grantId });
    if (!grant) return null;
    return grant;
  }

  harnessGrantAuthorizationFor(sessionId, turnId, project = {}, toolName = "") {
    const grant = this.harnessGrantForTurn(sessionId, turnId, project);
    if (!grant) return { authorized: false, reason: "no_current_task_grant" };
    const turn = this.sessionStore.readTurn(sessionId, turnId) || {};
    const runtimeNames = Array.isArray(turn.requestShape?.declaredToolNames)
      ? turn.requestShape.declaredToolNames
      : [];
    return authorizeDirectThreadHarnessCapability(grant, toolName, {
      taskId: sessionId,
      threadId: sessionId,
      projectId: normalizeString(project.id || project.projectId, ""),
      runtimeAdmittedCapabilityNames: runtimeNames,
    });
  }

  fullAccessLocalBinding(sessionId, turnId, project = {}, capabilityName = "") {
    if (!this.fullAccessLocalEnvironmentExecutor) return null;
    const session = this.sessionStore.readSession(sessionId) || {};
    const grant = this.harnessGrantForTurn(sessionId, turnId, project);
    if (!grant || grant.sandboxMode !== "danger-full-access" || grant.executionEnvironment?.kind !== "local") return null;
    const authorization = this.harnessGrantAuthorizationFor(sessionId, turnId, project, capabilityName);
    if (!authorization.authorized) return null;
    return {
      taskId: sessionId,
      threadId: sessionId,
      projectId: normalizeString(project.id || project.projectId || session.projectId, ""),
      executionEnvironmentDigest: grant.executionEnvironmentDigest,
      grantId: grant.grantId,
      harnessGrant: grant,
      project,
    };
  }

  capabilitiesForTask(project = {}, sessionId = "") {
    const taskId = normalizeString(sessionId, "");
    const session = taskId ? this.sessionStore.readSession(taskId) : null;
    const projectId = normalizeString(project.id || project.projectId || session?.projectId, "");
    if (!session || !sessionMatchesProject(session, projectId)) {
      const directLiveText = this.statusForProject(project || {});
      return {
        capabilities: buildDirectLiveTextCapabilities(directLiveText),
        directLiveText,
        taskBinding: null,
      };
    }
    const status = this.statusForProject(project || {}, { model: session.model });
    const harnessGrant = this.resolveHarnessGrant(project, session);
    const capabilities = buildDirectLiveTextCapabilities(status, {
      harnessGrant,
      taskId: session.sessionId,
      projectId: session.projectId,
    });
    return {
      capabilities,
      directLiveText: status,
      taskBinding: {
        taskId: session.sessionId,
        projectId: session.projectId,
        grantId: normalizeString(harnessGrant?.grantId, ""),
        grantRevision: Number(harnessGrant?.grantRevision || 0),
        current: capabilities.authority?.fullAccessTaskProfile === true,
        rawGrantIncluded: false,
      },
    };
  }

  executionEnvironmentForSession(project = {}, session = {}) {
    const workspace = isPlainObject(session.workspace) && Object.keys(session.workspace).length
      ? session.workspace
      : isPlainObject(project.workspace) ? project.workspace : {};
    const bindingDigest = normalizeString(
      session.workThreadBindingDigest || workspace.bindingDigest || project.executionEnvironmentBindingDigest,
      "",
    );
    const environment = {
      environmentId: normalizeString(
        session.workThreadId || session.sessionId,
        "direct_execution_environment",
      ),
      kind: normalizeString(workspace.kind, "local"),
    };
    if (bindingDigest) {
      environment.bindingDigest = bindingDigest;
    } else {
      // The raw checkout path is never placed in the grant.  It only
      // contributes to a stable workspace binding digest used for exact
      // restart and scope matching.
      environment.workspaceDigest = sha256(stableStringify({
        kind: environment.kind,
        workspaceDisplayPath: workspaceDisplayPath(project),
      }));
    }
    return environment;
  }

  selectFullAccessTaskProfile(params = {}, context = {}) {
    const project = context.project || {};
    if (!this.harnessGrantStore || typeof this.harnessGrantStore.issueFullAccess !== "function") {
      const error = new Error("Direct full-access task profile selection is unavailable.");
      error.code = "direct_thread_harness_grant_store_unavailable";
      throw error;
    }
    const requestedProfile = normalizeString(
      params.accessProfile || params.profile || params.taskProfile,
      "",
    );
    if (requestedProfile !== "full_access") {
      const error = new Error("Direct task profile selection requires the owner-selected full_access profile.");
      error.code = "direct_thread_harness_profile_not_full_access";
      throw error;
    }
    const sessionId = normalizeString(params.sessionId || params.threadId, "");
    const session = sessionId ? this.sessionStore.readSession(sessionId) : null;
    if (!session || !sessionMatchesProject(session, normalizeString(project.id, ""))) {
      const error = new Error("Direct full-access task profile selection requires an exact project-bound session.");
      error.code = "direct_thread_harness_profile_scope_mismatch";
      throw error;
    }
    const status = this.assertReady(project, { model: session.model });
    const environment = this.executionEnvironmentForSession(project, session);
    const grant = this.harnessGrantStore.issueFullAccess({
      taskId: session.sessionId,
      threadId: session.sessionId,
      projectId: session.projectId,
      executionEnvironment: environment,
      capabilities: [
        ...new Set([
          ...implementationInitialPolicyCandidateToolNames(status, ""),
          ...STATEFUL_EXEC_CAPABILITY_NAMES,
        ]),
      ],
    });
    this.sessionStore.writeSession({
      ...session,
      harnessAccessProfile: "full_access",
      harnessGrantId: grant.grantId,
      executionEnvironmentDigest: grant.executionEnvironmentDigest,
    });
    const projection = this.capabilitiesForTask(project, session.sessionId);
    return {
      profile: "full_access",
      grantId: grant.grantId,
      grantRevision: grant.grantRevision,
      approvalPolicy: grant.approvalPolicy,
      sandboxMode: grant.sandboxMode,
      capabilityCount: grant.capabilityPopulation.capabilities.length,
      executionEnvironmentDigest: grant.executionEnvironmentDigest,
      rawGrantIncluded: false,
      capabilities: projection.capabilities,
      taskBinding: projection.taskBinding,
    };
  }

  statefulExecSessionContext(params = {}, context = {}, options = {}) {
    const project = context.project || {};
    const sessionId = normalizeString(
      options.stdin
        ? params.taskId || params.threadId || context.surfaceSession?.activeThreadId
        : params.taskId || params.threadId || params.sessionId || context.surfaceSession?.activeThreadId,
      "",
    );
    const session = sessionId ? this.sessionStore.readSession(sessionId) : null;
    const projectId = normalizeString(project.id || project.projectId, "");
    if (!session || !projectId || !sessionMatchesProject(session, projectId)) {
      throw new Error("Stateful exec requires an exact project-bound Direct task.");
    }
    if (!this.statefulExecSessionManager) {
      throw new Error("Stateful exec is unavailable in this Direct runtime.");
    }
    const grant = this.resolveHarnessGrant(project, session);
    if (!grant) {
      const error = new Error("Stateful exec requires the current owner-issued full-access task grant.");
      error.code = "direct_stateful_exec_grant_missing";
      throw error;
    }
    return {
      project,
      session,
      grant,
      taskId: session.sessionId,
      threadId: session.sessionId,
      projectId: session.projectId,
      executionEnvironmentDigest: grant.executionEnvironmentDigest,
    };
  }

  startStatefulExec(params = {}, context = {}) {
    const bound = this.statefulExecSessionContext(params, context);
    return this.statefulExecSessionManager.start({
      ...params,
      project: bound.project,
      harnessGrant: bound.grant,
      grantId: bound.grant.grantId,
      taskId: bound.taskId,
      threadId: bound.threadId,
      projectId: bound.projectId,
      executionEnvironmentDigest: bound.executionEnvironmentDigest,
    });
  }

  writeStatefulExecStdin(params = {}, context = {}) {
    const bound = this.statefulExecSessionContext(params, context, { stdin: true });
    return this.statefulExecSessionManager.writeStdin({
      ...params,
      harnessGrant: bound.grant,
      grantId: bound.grant.grantId,
      taskId: bound.taskId,
      threadId: bound.threadId,
      projectId: bound.projectId,
      executionEnvironmentDigest: bound.executionEnvironmentDigest,
    });
  }

  cancelStatefulExec(params = {}, context = {}) {
    const bound = this.statefulExecSessionContext(params, context);
    return this.statefulExecSessionManager.cancel({
      ...params,
      harnessGrant: bound.grant,
      grantId: bound.grant.grantId,
      taskId: bound.taskId,
      threadId: bound.threadId,
      projectId: bound.projectId,
      executionEnvironmentDigest: bound.executionEnvironmentDigest,
    });
  }

  waitStatefulExec(params = {}, context = {}) {
    const bound = this.statefulExecSessionContext(params, context);
    return this.statefulExecSessionManager.wait({
      ...params,
      harnessGrant: bound.grant,
      grantId: bound.grant.grantId,
      taskId: bound.taskId,
      threadId: bound.threadId,
      projectId: bound.projectId,
      executionEnvironmentDigest: bound.executionEnvironmentDigest,
    });
  }

  close(reason = "Direct live text runtime closed.") {
    if (this.closed) return { closed: true, abortedRunCount: 0 };
    this.closed = true;
    this.epistemicContextDeliveryResolver = null;
    this.epistemicContextDeliveryRecorder = null;
    if (this.statefulExecSessionManager?.dispose) {
      this.statefulExecDisposePromise = Promise.resolve(this.statefulExecSessionManager.dispose(reason)).catch((error) => {
        this.emit?.("stateful-exec-disposal-error", { code: error?.code || "direct_stateful_exec_disposal_failed" });
        return { status: "unresolved_cleanup", disposed: true, activeSessionCount: null, cleanupFailure: error?.code || "direct_stateful_exec_disposal_failed" };
      });
    }
    let abortedRunCount = 0;
    for (const active of this.activeRuns.values()) {
      if (!active?.abortController?.signal?.aborted) {
        active.abortController.abort(reason);
        abortedRunCount += 1;
      }
    }
    return { closed: true, abortedRunCount };
  }

  async disposeStatefulExec(reason = "Direct live text runtime closed.") {
    if (this.statefulExecDisposePromise) return this.statefulExecDisposePromise;
    if (!this.statefulExecSessionManager?.dispose) return { status: "completed", disposed: false, activeSessionCount: 0 };
    this.statefulExecDisposePromise = Promise.resolve(this.statefulExecSessionManager.dispose(reason)).catch((error) => {
      this.emit?.("stateful-exec-disposal-error", { code: error?.code || "direct_stateful_exec_disposal_failed" });
      return { status: "unresolved_cleanup", disposed: true, activeSessionCount: null, cleanupFailure: error?.code || "direct_stateful_exec_disposal_failed" };
    });
    return this.statefulExecDisposePromise;
  }

  assertOpen() {
    if (!this.closed) return;
    const error = new Error("Direct live text runtime is closed.");
    error.code = "direct_live_text_controller_closed";
    throw error;
  }

  epistemicLedgerTurnKey(sessionId, turnId) {
    return `${normalizeString(sessionId, "")}::${normalizeString(turnId, "")}`;
  }

  rememberEpistemicLedgerTurnBinding(sessionId, turnId, binding = null) {
    const key = this.epistemicLedgerTurnKey(sessionId, turnId);
    if (!binding?.bundle) {
      this.epistemicLedgerTurnBindings.delete(key);
      return null;
    }
    const stored = {
      bundle: binding.bundle,
      visibleEvidenceRefs: Array.isArray(binding.visibleEvidenceRefs)
        ? binding.visibleEvidenceRefs
        : [],
      currentRevisionByScope: isPlainObject(binding.currentRevisionByScope)
        ? binding.currentRevisionByScope
        : {},
      artifactLifecycleBinding:
        isPlainObject(binding.artifactLifecycleBinding)
          ? binding.artifactLifecycleBinding
          : null,
    };
    this.epistemicLedgerTurnBindings.set(key, stored);
    return stored;
  }

  epistemicLedgerTurnBinding(sessionId, turnId) {
    const inMemory = this.epistemicLedgerTurnBindings.get(
      this.epistemicLedgerTurnKey(sessionId, turnId),
    );
    if (inMemory) return inMemory;
    const turn = this.sessionStore?.readTurn?.(sessionId, turnId);
    const persisted = isPlainObject(turn?.epistemicLedgerToolBinding)
      ? turn.epistemicLedgerToolBinding
      : null;
    if (!persisted?.bundle) return null;
    return this.rememberEpistemicLedgerTurnBinding(
      sessionId,
      turnId,
      persisted,
    );
  }

  async resolveEpistemicLedgerTurnBinding(input = {}) {
    if (
      !this.epistemicLedgerToolBundleResolver ||
      !this.epistemicLedgerToolInvoker ||
      !isPlainObject(input.compiledAgentContext)
    ) {
      return null;
    }
    const resolved = await this.epistemicLedgerToolBundleResolver(input);
    if (!resolved) return null;
    const bundle = resolved.bundle || resolved;
    const expectedRoleLane = normalizeString(
      input.roleLane,
      "implementation_worker",
    );
    if (
      !isPlainObject(bundle) ||
      bundle.schema !== "direct_role_ledger_tool_bundle@1" ||
      bundle.roleLane !== expectedRoleLane ||
      !["implementation_worker", "review_auditor"].includes(
        expectedRoleLane,
      )
    ) {
      const error = new Error(
        "Direct epistemic ledger resolver returned an invalid role bundle.",
      );
      error.code = "direct_epistemic_ledger_bundle_invalid";
      throw error;
    }
    return {
      bundle,
      visibleEvidenceRefs: Array.isArray(resolved.visibleEvidenceRefs)
        ? resolved.visibleEvidenceRefs
        : [],
      currentRevisionByScope: isPlainObject(resolved.currentRevisionByScope)
        ? resolved.currentRevisionByScope
        : {},
      artifactLifecycleBinding:
        isPlainObject(resolved.artifactLifecycleBinding)
          ? resolved.artifactLifecycleBinding
          : null,
    };
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

  resolveProviderMetadataStatus(project = {}) {
    const projectId = normalizeString(project.id || project.projectId || project.name, "");
    let resolved = null;
    if (this.providerMetadataResolver) {
      try {
        resolved = this.providerMetadataResolver({
          project,
          projectId,
          authStatus: this.authStatus(),
        });
      } catch (error) {
        return { profile: null, driftReport: null, cacheState: "failed", error };
      }
    }
    if (!resolved) {
      resolved = project.directProviderMetadata || project.providerMetadataStatus || null;
    }
    const profile = resolved?.profile || (resolved?.schema === DIRECT_PROVIDER_METADATA_PROFILE_SCHEMA ? resolved : null);
    if (!isPlainObject(profile)) {
      return {
        profile: null,
        driftReport: resolved?.driftReport || null,
        cacheState: normalizeString(resolved?.cacheState, "missing"),
      };
    }
    if (normalizeString(resolved?.projectId, "") && normalizeString(resolved.projectId, "") !== projectId) {
      return {
        profile: null,
        driftReport: resolved?.driftReport || null,
        cacheState: "invalid",
        reason: "provider_metadata_project_scope_mismatch",
      };
    }
    if (normalizeString(profile.projectId, "") && normalizeString(profile.projectId, "") !== projectId) {
      return {
        profile: null,
        driftReport: resolved?.driftReport || null,
        cacheState: "invalid",
        reason: "provider_metadata_project_scope_mismatch",
      };
    }
    const findings = validateDirectProviderMetadataProfile(profile);
    if (findings.length) {
      return {
        profile: null,
        driftReport: resolved?.driftReport || null,
        cacheState: "invalid",
        reason: "provider_metadata_profile_invalid",
        validationFindings: findings,
      };
    }
    return {
      profile,
      driftReport: resolved?.driftReport || null,
      cacheState: normalizeString(resolved?.cacheState, "provided"),
      fetched: resolved?.fetched === true,
    };
  }

  requestedModelForProject(project = {}, options = {}) {
    return normalizeString(
      options.model || options.requestedModel ||
        project.surfaceBinding?.codex?.model || project.codex?.model || "",
      "",
    );
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
        if (isPlainObject(resolved)) {
          const projectId = normalizeString(project?.id || project?.projectId || project?.name, "");
          if (normalizeString(resolved.projectId, "") && projectId && normalizeString(resolved.projectId, "") !== projectId) {
            return {
              status: "blocked",
              reason: "external_capability_profile_project_scope_mismatch",
              serverIdentities: [],
            };
          }
          return resolved;
        }
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

  resolveProviderHostedToolsStatus(project = {}, directProviderMetadata = null) {
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
        directProviderMetadata,
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

  providerAttachmentCapabilityFor(project = {}, metadataProfile = null) {
    // Direct has no workspace-backend reader for WSL staged bytes yet.  Keep
    // WSL attachment custody reference-only even when a provider resolver or
    // metadata profile happens to advertise file/image payload support.
    if (normalizeString(project.workspace?.kind, "").toLowerCase() === "wsl") return null;
    if (isPlainObject(project.providerAttachmentCapability)) return project.providerAttachmentCapability;
    if (!this.attachmentPayloadResolver || !isPlainObject(metadataProfile)) return null;
    const requestedModel = this.requestedModelForProject(project);
    const model = (Array.isArray(metadataProfile.modelCatalog?.items) ? metadataProfile.modelCatalog.items : [])
      .find((item) => !requestedModel || item.model === requestedModel || item.id === requestedModel) ||
      metadataProfile.modelCatalog?.items?.[0];
    const modalities = Array.isArray(model?.inputModalities) ? model.inputModalities.map((value) => normalizeString(value, "").toLowerCase()) : [];
    const supports = (names) => modalities.some((value) => names.includes(value));
    const sourceDigest = normalizeString(metadataProfile.profileDigest, "");
    return {
      file: {
        supported: supports(["file", "input_file", "document"]),
        evidenceState: "profile_declared",
        payloadCustody: "exact",
        sourceDigest,
      },
      image: {
        supported: supports(["image", "input_image", "vision"]),
        evidenceState: "profile_declared",
        payloadCustody: "exact",
        sourceDigest,
      },
    };
  }

  modelEvidenceForProject(project = {}, options = {}) {
    const requestedModel = this.requestedModelForProject(project, options);
    const staticEvidence = modelEvidenceFor(this.profileDoc, requestedModel);
    const liveEvidence = this.resolveLiveModelEvidence(project, requestedModel || staticEvidence.model);
    if (liveEvidence?.accepted) return liveEvidence;
    return {
      ...staticEvidence,
      reason: liveModelEvidenceBlockerReason(liveEvidence?.reason) ||
        (staticEvidence.accepted ? "" : "accepted_text_model_required"),
      liveProbeEvidence: liveEvidence?.liveProbeEvidence || null,
      liveProbeEvidenceId: normalizeString(liveEvidence?.evidenceId, ""),
    };
  }

  compileSelfConstitutionSnapshot(input = {}) {
    const project = isPlainObject(input.project) ? input.project : {};
    const session = isPlainObject(input.session)
      ? input.session
      : this.sessionStore.readSession(normalizeString(input.sessionId, "")) || {};
    const status = isPlainObject(input.status)
      ? input.status
      : this.statusForProject(project, {
          model: normalizeString(input.model || session.model, ""),
        });
    const subAgentPoolDescriptor = this.subAgentPool && typeof this.subAgentPool.descriptor === "function"
      ? this.subAgentPool.descriptor()
      : {};
    const activeSubAgentPolicy = this.activeSubAgentPolicyProjectionResolver
      ? this.activeSubAgentPolicyProjectionResolver({
          projectId: normalizeString(
            project.id || project.projectId || session.projectId,
            "",
          ),
          threadId: normalizeString(session.sessionId, ""),
        })
      : null;
    return compileDirectSelfConstitutionSnapshot({
      ...input,
      project,
      session,
      status,
      declaredToolNames: input.declaredToolNames || input.toolComposition?.toolNames,
      toolComposition: input.toolComposition?.composition || input.toolComposition,
      subAgentPoolDescriptor,
      activeSubAgentPolicy,
    });
  }

  statusForProject(project = {}, options = {}) {
    const auth = this.authStatus();
    const evidence = this.modelEvidenceForProject(project, options);
    const implementationLaneProof = this.resolveImplementationProofEvidence(project, evidence.model);
    const externalCapabilityProfile = this.resolveExternalCapabilityProfile(project);
    const providerMetadataStatus = this.resolveProviderMetadataStatus(project);
    const providerHostedToolsStatus = this.resolveProviderHostedToolsStatus(project, providerMetadataStatus);
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
      workspaceKind: normalizeString(project.workspace?.kind, ""),
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
      providerMetadataProfile: providerMetadataStatus.profile,
      providerMetadataDriftReport: providerMetadataStatus.driftReport,
      providerMetadataCacheState: providerMetadataStatus.cacheState,
      providerMetadataReason: normalizeString(providerMetadataStatus.reason, ""),
      accountLoginAvailable: Boolean(this.accountLoginResolver),
      environmentStatusAvailable: Boolean(
        this.environmentStatusResolver ||
        project.workspace ||
        project.environmentId ||
        project.executionEnvironmentId,
      ),
      providerAttachmentCapability: ["stale", "missing", "failed", "invalid"].includes(providerMetadataStatus.cacheState)
        ? null
        : this.providerAttachmentCapabilityFor(project, providerMetadataStatus.profile),
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

  assertReady(project = {}, options = {}) {
    this.assertOpen();
    const status = this.statusForProject(project, options);
    if (status.status !== "ready") {
      const error = new Error(liveTextReadinessErrorMessage(status));
      error.code = status.status;
      error.blockerCode = status.reason || status.status;
      error.directLiveTextStatus = status;
      throw error;
    }
    if (this.activationStatusResolver) {
      const binding = normalizeCodexBinding(project.surfaceBinding?.codex || {});
      if (binding.runtimeMode === "direct") {
        return status;
      }
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
    const taskId = normalizeString(_params.sessionId || _params.threadId || context.sessionId, "");
    const projection = taskId ? this.capabilitiesForTask(context.project || {}, taskId) : null;
    const status = projection?.directLiveText || this.statusForProject(context.project || {});
    return {
      runtime: DIRECT_LIVE_TEXT_SURFACE_TRANSPORT,
      capabilities: projection?.capabilities || buildDirectLiveTextCapabilities(status),
      directLiveText: status,
      taskBinding: projection?.taskBinding || null,
    };
  }

  accountRead(_params = {}, _context = {}) {
    const status = this.authStatus();
    const metadataStatus = this.resolveProviderMetadataStatus(_context.project || {});
    const metadata = metadataStatus.profile;
    if (status.status === "authenticated") {
      return {
        account: {
          type: "chatgpt",
          planType: normalizeString(metadata?.account?.planType, "direct-live-text"),
          accountId: status.accountId,
        },
        source: metadata ? "direct_provider_metadata" : "direct_auth_store",
        metadataProfileDigest: normalizeString(metadata?.profileDigest, ""),
        metadataCacheState: normalizeString(metadataStatus.cacheState, "missing"),
        metadataStale: metadataStatus.cacheState === "stale",
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

  async modelList(params = {}, context = {}) {
    const status = this.statusForProject(context.project || {});
    const profile = status.providerMetadataProfile;
    const items = Array.isArray(profile?.modelCatalog?.items) ? profile.modelCatalog.items : [];
    const includeHidden = params.includeHidden === true;
    const limit = boundedPositiveInteger(params.limit, 100, 1, 1000);
    const offset = Math.max(0, Number.parseInt(String(params.cursor || "0"), 10) || 0);
    const visible = items.filter((item) => includeHidden || item.hidden !== true);
    const page = visible.slice(offset, offset + limit).map((item) => ({
      id: normalizeString(item.id || item.model, ""),
      model: normalizeString(item.model || item.id, ""),
      displayName: normalizeString(item.displayName, item.model || item.id || "model"),
      description: normalizeString(item.description, ""),
      availabilityState: normalizeString(item.availabilityState, "available"),
      unavailableReason: normalizeString(item.unavailableReason, ""),
      supportedReasoningEfforts: Array.isArray(item.supportedReasoningEfforts) ? item.supportedReasoningEfforts : [],
      defaultReasoningEffort: normalizeString(item.defaultReasoningEffort, ""),
      serviceTiers: Array.isArray(item.serviceTiers) ? item.serviceTiers : [],
      defaultServiceTier: normalizeString(item.defaultServiceTier, ""),
      inputModalities: Array.isArray(item.inputModalities) ? item.inputModalities : [],
      contextWindow: item.contextWindow,
      maxContextWindow: item.maxContextWindow,
      isDefault: item.isDefault === true,
      evidenceState: normalizeString(profile?.modelCatalog?.status, "unknown"),
      rawProviderPayloadIncluded: false,
      rawEndpointIncluded: false,
    }));
    const nextOffset = offset + page.length;
    return {
      data: page,
      nextCursor: nextOffset < visible.length ? String(nextOffset) : null,
      source: normalizeString(profile?.modelCatalog?.source, "unavailable"),
      cacheState: normalizeString(status.providerMetadataCacheState, "missing"),
      stale: status.providerMetadataCacheState === "stale",
      profileDigest: normalizeString(profile?.profileDigest, ""),
      rawProviderPayloadIncluded: false,
    };
  }

  async rateLimitsRead(_params = {}, context = {}) {
    const status = this.statusForProject(context.project || {});
    const quota = status.providerMetadataProfile?.usage?.quota;
    const windows = Array.isArray(quota?.windows) ? quota.windows : [];
    const rateLimitsByLimitId = {};
    for (const window of windows) {
      const id = normalizeString(window.windowId, "direct");
      rateLimitsByLimitId[id] = {
        usedPercent: Number.isFinite(Number(window.usedPercent)) ? Number(window.usedPercent) : undefined,
        resetsAt: normalizeString(window.resetsAt, ""),
        windowDurationMins: Number.isFinite(Number(window.windowDurationMins)) ? Number(window.windowDurationMins) : undefined,
        windowKind: normalizeString(window.windowKind, "other"),
      };
    }
    return {
      rateLimitsByLimitId,
      planType: normalizeString(quota?.planType || status.providerMetadataProfile?.account?.planType, ""),
      status: normalizeString(quota?.status, "unknown"),
      source: "direct_provider_metadata",
      cacheState: normalizeString(status.providerMetadataCacheState, "missing"),
      stale: status.providerMetadataCacheState === "stale",
      evidenceRefs: Array.isArray(quota?.evidenceRefs) ? quota.evidenceRefs : [],
      rawProviderPayloadIncluded: false,
    };
  }

  async usageRead(_params = {}, context = {}) {
    const status = this.statusForProject(context.project || {});
    const usage = status.providerMetadataProfile?.usage || {};
    const tokenUsage = isPlainObject(usage.tokenUsage) ? {
      inputTokens: usage.tokenUsage.inputTokens ?? usage.tokenUsage.input_tokens,
      outputTokens: usage.tokenUsage.outputTokens ?? usage.tokenUsage.output_tokens,
      totalTokens: usage.tokenUsage.totalTokens ?? usage.tokenUsage.total_tokens,
      reasoningTokens: usage.tokenUsage.reasoningTokens ?? usage.tokenUsage.reasoning_tokens,
    } : null;
    const accountTokenProfile = isPlainObject(usage.accountTokenProfile) ? {
      status: normalizeString(usage.accountTokenProfile.status, "unknown"),
      lifetimeTokens: usage.accountTokenProfile.lifetimeTokens,
      peakDailyTokens: usage.accountTokenProfile.peakDailyTokens,
      longestRunningTurnSec: usage.accountTokenProfile.longestRunningTurnSec,
      currentStreakDays: usage.accountTokenProfile.currentStreakDays,
      longestStreakDays: usage.accountTokenProfile.longestStreakDays,
      dailyBuckets: Array.isArray(usage.accountTokenProfile.dailyBuckets) ? usage.accountTokenProfile.dailyBuckets : [],
    } : null;
    return {
      tokenUsage,
      accountTokenProfile,
      context: isPlainObject(usage.context) ? usage.context : { status: "unknown" },
      source: "direct_provider_metadata",
      cacheState: normalizeString(status.providerMetadataCacheState, "missing"),
      stale: status.providerMetadataCacheState === "stale",
      rawProviderPayloadIncluded: false,
    };
  }

  async configRequirementsRead(params = {}, context = {}) {
    if (this.configRequirementsResolver) {
      const resolved = await this.configRequirementsResolver({
        params,
        context,
        project: context.project || {},
      });
      if (isPlainObject(resolved)) {
        return {
          requirements: resolved.requirements ?? null,
          status: normalizeString(resolved.status, resolved.requirements ? "available" : "none"),
          source: normalizeString(resolved.source, "direct-provider-config"),
          evidenceRefs: Array.isArray(resolved.evidenceRefs) ? resolved.evidenceRefs : [],
          rawTokensExposed: false,
          rawBackendFramesExposed: false,
        };
      }
    }
    return {
      requirements: null,
      status: "none",
      source: "direct-live-text-controller",
      rawTokensExposed: false,
      rawBackendFramesExposed: false,
    };
  }

  async environmentStatus(params = {}, context = {}) {
    const project = context.project || {};
    const expectedEnvironmentId = normalizeString(
      params.environmentId,
      normalizeString(project.environmentId || project.executionEnvironmentId, "direct_execution_environment"),
    );
    if (this.environmentStatusResolver) {
      const resolved = await this.environmentStatusResolver({
        params,
        project,
        environmentId: expectedEnvironmentId,
        ownerControlled: context.ownerControlled === true,
      });
      if (isPlainObject(resolved)) {
        if (resolved.environmentId && normalizeString(resolved.environmentId, "") !== expectedEnvironmentId) {
          throw new Error("Direct environment status source returned a different environment.");
        }
        return {
          environmentId: expectedEnvironmentId,
          status: normalizeString(resolved.status, "unknown"),
          kind: normalizeString(resolved.kind || resolved.workspaceKind, "local"),
          platform: normalizeString(resolved.platform || resolved.nativePlatform, "unknown"),
          adapterKind: normalizeString(resolved.adapterKind, "direct"),
          probeState: normalizeString(resolved.probeState, "unknown"),
          workspaceIdentityMatched: resolved.workspaceIdentityMatched === true,
          processContinuityObserved: resolved.processContinuityObserved === true,
          capabilityClasses: Array.isArray(resolved.capabilityClasses) ? resolved.capabilityClasses.map((value) => normalizeString(value, "")).filter(Boolean) : [],
          blockerCodes: Array.isArray(resolved.blockerCodes) ? resolved.blockerCodes.map((value) => normalizeString(value, "")).filter(Boolean) : [],
          observedAt: normalizeString(resolved.observedAt, nowIso()),
          bindingDigest: normalizeString(resolved.bindingDigest, ""),
          rawPathIncluded: false,
          rawSecretIncluded: false,
        };
      }
    }
    return {
      environmentId: expectedEnvironmentId,
      status: project.workspace ? "ready" : "unavailable",
      kind: normalizeString(project.workspace?.kind, "local"),
      source: "direct-project-environment",
      bindingDigest: normalizeString(project.executionEnvironmentBindingDigest || project.workspace?.bindingDigest, ""),
      rawPathIncluded: false,
      rawSecretIncluded: false,
    };
  }

  async accountLoginStart(params = {}, context = {}) {
    if (context.ownerControlled !== true) {
      const error = new Error("Direct account login requires an owner-controlled request.");
      error.code = "direct_account_login_owner_control_required";
      throw error;
    }
    if (!this.accountLoginResolver) {
      return { ok: false, status: "unavailable", reason: "direct_account_login_resolver_missing", rawTokensExposed: false };
    }
    const result = await this.accountLoginResolver({ params, project: context.project || {}, ownerControlled: true });
    return isPlainObject(result) ? { ...result, rawTokensExposed: false } : {
      ok: false,
      status: "unavailable",
      reason: "direct_account_login_invalid_result",
      rawTokensExposed: false,
    };
  }

  startThread(params = {}, context = {}) {
    const project = context.project || {};
    const projectId = normalizeString(project.id, "");
    const requestedModel = normalizeString(params.model, "");
    const status = this.assertReady(project, { model: requestedModel });
    const workThreadCarrier = directWorkThreadContextCarrier(params, context);
    const requestedSessionId = normalizeString(params.sessionId || params.threadId, "");
    if (requestedSessionId) {
      const existing = this.sessionStore.readSession(requestedSessionId);
      if (existing) {
        if (!sessionMatchesProject(existing, projectId)) {
          throw new Error("Direct live text session does not belong to the active project.");
        }
        const accessProfile = normalizeString(params.accessProfile || params.profile || params.taskProfile, "");
        const selected = accessProfile === "full_access"
          ? this.selectFullAccessTaskProfile({ sessionId: existing.sessionId, accessProfile }, context)
          : null;
        const refreshed = this.sessionStore.readSession(existing.sessionId) || existing;
        const projection = this.capabilitiesForTask(project, refreshed.sessionId);
        return {
          thread: threadSnapshotFromSession(refreshed),
          model: refreshed.model,
          reasoningEffort: refreshed.reasoningEffort,
          serviceTier: refreshed.serviceTier,
          accessProfile: selected,
          capabilities: projection.capabilities,
          taskBinding: projection.taskBinding,
        };
      }
    }
    const model = normalizeString(params.model, "") || status.model;
    const reasoningEffort = normalizeString(params.reasoningEffort || params.reasoning_effort, "");
    const serviceTier = normalizeString(params.serviceTier || params.service_tier, "");
    if (serviceTier && !DIRECT_SERVICE_TIERS.has(serviceTier)) {
      const error = new Error(`Direct service tier is not supported: ${serviceTier}`);
      error.code = "direct_service_tier_unsupported";
      throw error;
    }
    const session = this.sessionStore.createSession({
      sessionId: requestedSessionId,
      projectId,
      workspace: isPlainObject(project.workspace) ? project.workspace : {},
      workspaceDisplayPath: workspaceDisplayPath(project),
      title: normalizeString(params.title, `${normalizeString(project.name, "Direct")} live text session`),
      model,
      reasoningEffort,
      serviceTier,
      runtimeMode: normalizeCodexBinding(project.surfaceBinding?.codex || {}).runtimeMode,
      directTransport: DIRECT_LIVE_TEXT_SURFACE_TRANSPORT,
      modelSource: status.modelSource,
      modelEvidenceState: status.modelEvidenceState,
      modelEvidenceId: normalizeString(status.evidenceId, ""),
      profileSnapshotId: normalizeString(project.surfaceBinding?.codex?.profileId, ""),
      agentId: normalizeString(params.agentId, ""),
      agentRunId: normalizeString(params.agentRunId, ""),
      parentAgentId: normalizeString(params.parentAgentId, ""),
      parentAgentRunId: normalizeString(params.parentAgentRunId, ""),
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
      artifactWorkThreadAuthorizationId: normalizeString(
        params.artifactWorkThreadAuthorizationId,
        "",
      ),
      artifactWorkThreadAuthorizationDigest: normalizeString(
        params.artifactWorkThreadAuthorizationDigest,
        "",
      ),
      sourceClass: "direct-native",
      nativeDirectSession: true,
      providerContinuityAvailable: false,
      continuityState: "fresh_session_only",
      workThreadId: workThreadCarrier.workThreadId,
      workThreadBindingDigest: normalizeString(workThreadCarrier.workThreadBinding?.bindingDigest, ""),
    });
    const accessProfile = normalizeString(params.accessProfile || params.profile || params.taskProfile, "") === "full_access"
      ? this.selectFullAccessTaskProfile({ sessionId: session.sessionId, accessProfile: "full_access" }, context)
      : null;
    const refreshedSession = this.sessionStore.readSession(session.sessionId) || session;
    const projection = this.capabilitiesForTask(project, refreshedSession.sessionId);
    return {
      thread: threadSnapshotFromSession(refreshedSession),
      model: refreshedSession.model,
      reasoningEffort: refreshedSession.reasoningEffort,
      serviceTier: refreshedSession.serviceTier,
      accessProfile,
      capabilities: projection.capabilities,
      taskBinding: projection.taskBinding,
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
            serviceTier: normalizeString(turn?.serviceTier || summary?.serviceTier, ""),
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

  threadControlOperation(operationType, input = {}, result = {}, options = {}) {
    const store = this.directThreadStore;
    if (!store || typeof store.planOperation !== "function" || typeof store.commitOperation !== "function") return null;
    const projectId = normalizeString(input.projectId, "");
    const target = isPlainObject(input.target) ? input.target : { threadIds: [normalizeString(input.threadId, "")] };
    const plan = this.planThreadControlOperation(operationType, input, {
      target,
      intent: isPlainObject(input.intent) ? input.intent : {},
    }, options);
    if (plan.existingResult?.status === "committed") return plan.existingResult;
    return this.commitThreadControlOperation(plan, result, options);
  }

  planThreadControlOperation(operationType, input = {}, options = {}, storeOptions = {}) {
    const store = this.directThreadStore;
    if (!store || typeof store.planOperation !== "function" || typeof store.commitOperation !== "function") return null;
    const projectId = normalizeString(input.projectId, "");
    const target = isPlainObject(options.target)
      ? options.target
      : (isPlainObject(input.target) ? input.target : { threadIds: [normalizeString(input.threadId, "")] });
    const intent = isPlainObject(options.intent) ? options.intent : {};
    const identity = {
      schema: "direct_thread_control_operation_input@2",
      operationType,
      projectId,
      target,
      expectedHistoryHeadDigest: normalizeString(input.expectedHistoryHeadDigest, ""),
      expectedTurnId: normalizeString(input.expectedTurnId, ""),
      requestDigest: normalizeString(input.requestDigest, ""),
      intent,
    };
    const operationInputDigest = sha256(stableStringify(identity));
    const suppliedClientOperationId = normalizeString(input.clientOperationId, "");
    const clientOperationId = suppliedClientOperationId || `direct_${operationType}_${sha256(stableStringify({
      projectId,
      operationInputDigest,
    })).slice(0, 28)}`;
    const existing = typeof store.operationByClient === "function"
      ? store.operationByClient(projectId, clientOperationId)
      : null;
    if (existing && typeof store.returnExistingOperationOrThrowConflict === "function") {
      const existingResult = store.returnExistingOperationOrThrowConflict(existing, {
        operationType,
        operationInputDigest,
        target,
      });
      if (!["planned", "committed"].includes(normalizeString(existing.status, ""))) {
        const error = new Error("Direct thread control operation is not recoverable from its durable status.");
        error.code = "direct_thread_control_operation_not_recoverable";
        throw error;
      }
      return {
        operationType,
        projectId,
        clientOperationId,
        operationInputDigest,
        target,
        intent,
        operationId: existing.operation_id,
        existing,
        existingResult,
      };
    }
    const planned = store.planOperation({
      operationType,
      projectId,
      clientOperationId,
      actor: "direct_owner_surface",
      target,
      parameters: {
        operationInputDigest,
        expectedHistoryHeadDigest: normalizeString(input.expectedHistoryHeadDigest, ""),
        expectedTurnId: normalizeString(input.expectedTurnId, ""),
        intent,
      },
      result: {
        status: "planned",
        operationInputDigest,
        intent,
      },
      safety: { requiresConfirmation: false },
    }, storeOptions);
    return {
      operationType,
      projectId,
      clientOperationId,
      operationInputDigest,
      target,
      intent,
      operationId: planned.operationId,
      planned,
      existing: null,
      existingResult: null,
    };
  }

  maybeInjectThreadControlFault(operationType, plan, details = {}) {
    const injector = this.threadControlFaultInjector;
    if (typeof injector !== "function") return;
    const result = injector({
      phase: "after_side_effect_before_commit",
      operationType,
      operationId: normalizeString(plan?.operationId, ""),
      clientOperationId: normalizeString(plan?.clientOperationId, ""),
      ...details,
    });
    if (result instanceof Error) throw result;
  }

  commitThreadControlOperation(plan, result = {}, options = {}) {
    if (!plan) return null;
    if (plan.existingResult?.status === "committed") return plan.existingResult;
    const store = this.directThreadStore;
    this.maybeInjectThreadControlFault(plan.operationType, plan, { intent: plan.intent });
    const committed = store.commitOperation(plan.operationId, {
      operationType: plan.operationType,
      projectId: plan.projectId,
      clientOperationId: plan.clientOperationId,
      actor: "direct_owner_surface",
      target: plan.target,
      result: {
        ...result,
        status: "committed",
        operationInputDigest: plan.operationInputDigest,
        intent: plan.intent,
      },
      safety: { requiresConfirmation: false },
    }, options);
    return typeof store.operationResult === "function"
      ? store.operationResult(store.operationById(committed.operationId))
      : committed;
  }

  existingThreadControlOperation(operationType, projectId, clientOperationId) {
    const store = this.directThreadStore;
    const clientId = normalizeString(clientOperationId, "");
    if (!store || !clientId || typeof store.operationByClient !== "function") return null;
    const existing = store.operationByClient(normalizeString(projectId, ""), clientId);
    if (!existing) return null;
    if (normalizeString(existing.operation_type, "") !== operationType) {
      const error = new Error("Direct thread control client operation id was reused for another operation.");
      error.code = "client_operation_id_conflict";
      throw error;
    }
    return typeof store.operationResult === "function" ? store.operationResult(existing) : existing;
  }

  resumeThread(params = {}, context = {}) {
    const project = context.project || {};
    const projectId = normalizeString(project.id, "");
    const sessionId = normalizeString(params.sessionId || params.threadId, "");
    const session = this.sessionStore.readSession(sessionId);
    if (!session) throw new Error(`Direct live text session not found: ${sessionId}`);
    if (!sessionMatchesProject(session, projectId)) {
      const error = new Error("Direct live text session does not belong to the active project.");
      error.code = "direct_session_project_scope_mismatch";
      throw error;
    }
    this.assertReady(project, { model: session.model });
    const currentHeadDigest = directHistoryHeadDigest(session);
    const expectedHeadDigest = normalizeString(params.expectedHistoryHeadDigest || params.expectedHeadDigest, "");
    if (expectedHeadDigest && expectedHeadDigest !== currentHeadDigest) {
      const error = new Error("Direct thread resume rejected a stale history head.");
      error.code = "direct_thread_history_head_stale";
      throw error;
    }
    const operation = this.threadControlOperation("resume_thread", {
      projectId,
      threadId: session.sessionId,
      clientOperationId: params.clientOperationId || params.clientResumeId,
      expectedHistoryHeadDigest: currentHeadDigest,
      target: { threadIds: [session.sessionId] },
    }, {
      resumed: true,
      historyHeadTurnId: normalizeString(session.turns?.at(-1)?.turnId, ""),
      historyHeadDigest: currentHeadDigest,
      readOnly: session.importedSessionReadOnly === true,
    });
    const projection = this.capabilitiesForTask(project, session.sessionId);
    return {
      thread: threadSnapshotFromSession(session),
      model: session.model,
      reasoningEffort: session.reasoningEffort,
      serviceTier: session.serviceTier,
      resumed: true,
      continuityState: normalizeString(session.continuityState, "local_context_followup"),
      readOnly: session.importedSessionReadOnly === true,
      operation,
      capabilities: projection.capabilities,
      taskBinding: projection.taskBinding,
    };
  }

  forkThread(params = {}, context = {}) {
    const project = context.project || {};
    const projectId = normalizeString(project.id, "");
    const sourceThreadId = normalizeString(params.sourceThreadId || params.sessionId || params.threadId, "");
    const source = this.sessionStore.readSession(sourceThreadId);
    if (!source) throw new Error(`Direct live text session not found: ${sourceThreadId}`);
    if (!sessionMatchesProject(source, projectId)) {
      const error = new Error("Direct fork source does not belong to the active project.");
      error.code = "direct_session_project_scope_mismatch";
      throw error;
    }
    this.assertReady(project, { model: source.model });
    const activeTurn = this.activeTurnForSession(source);
    if (activeTurn) {
      const error = new Error("Direct fork requires a non-active source turn.");
      error.code = "active_direct_turn_exists";
      throw error;
    }
    const sourceHistoryHeadDigest = directHistoryHeadDigest(source);
    const expectedHeadDigest = normalizeString(params.expectedHistoryHeadDigest || params.expectedHeadDigest, "");
    if (expectedHeadDigest && expectedHeadDigest !== sourceHistoryHeadDigest) {
      const error = new Error("Direct fork rejected a stale source history head.");
      error.code = "direct_thread_history_head_stale";
      throw error;
    }
    const sourceGrant = this.resolveHarnessGrant(project, source);
    if (source.harnessAccessProfile === "full_access" && !sourceGrant) {
      const error = new Error("Direct fork cannot inherit a missing or stale full-access source grant.");
      error.code = "direct_fork_source_grant_invalid";
      throw error;
    }
    const sourceTurnIds = (Array.isArray(source.turns) ? source.turns : [])
      .map((turn) => normalizeString(turn?.turnId, ""))
      .filter(Boolean);
    const suppliedClientOperationId = normalizeString(params.clientOperationId || params.clientForkId, "");
    const operationKey = suppliedClientOperationId || `direct_fork_${sha256(stableStringify({
      projectId,
      sourceThreadId: source.sessionId,
      sourceHistoryHeadDigest,
    })).slice(0, 28)}`;
    const requestedChildId = normalizeString(params.newThreadId || params.newSessionId || params.forkThreadId, "");
    const childId = requestedChildId || `direct_fork_${sha256(stableStringify({
      projectId,
      sourceThreadId: source.sessionId,
      sourceHistoryHeadDigest,
      operationKey,
    })).slice(0, 28)}`;
    const childCapabilityNames = sourceGrant
      ? (Array.isArray(params.capabilities) ? params.capabilities : harnessGrantCapabilityNames(sourceGrant))
        .map((entry) => normalizeString(isPlainObject(entry) ? entry.name || entry.toolName : entry, ""))
        .filter(Boolean)
      : [];
    const childGrantId = sourceGrant
      ? `direct_harness_grant_${sha256(stableStringify({ projectId, childId, sourceGrantId: sourceGrant.grantId })).slice(0, 28)}`
      : "";
    const intent = {
      schema: "direct_thread_control_intent@1",
      sourceThreadId: source.sessionId,
      sourceProjectId: projectId,
      sourceHistoryHeadDigest,
      sourceHistoryHeadTurnId: normalizeString(source.turns?.at(-1)?.turnId, ""),
      sourceTurnIds,
      childThreadId: childId,
      childGrantId,
      sourceGrantId: normalizeString(sourceGrant?.grantId, ""),
      sourceGrantRevision: Number(sourceGrant?.grantRevision || 0),
      childCapabilityNames,
      title: normalizeString(params.title, ""),
    };
    const plan = this.planThreadControlOperation("fork_thread", {
      projectId,
      threadId: childId,
      clientOperationId: suppliedClientOperationId || operationKey,
      expectedHistoryHeadDigest: sourceHistoryHeadDigest,
      target: { threadIds: [childId, source.sessionId] },
      intent,
    }, { target: { threadIds: [childId, source.sessionId] }, intent });
    if (plan.existingResult?.status === "committed") {
      const existingChildId = normalizeString(plan.existingResult.result?.forkThreadId, childId);
      const existingChild = this.sessionStore.readSession(existingChildId);
      if (!existingChild || !sessionMatchesProject(existingChild, projectId) || existingChild.parentThreadId !== source.sessionId) {
        const error = new Error("Direct fork operation exists but its child session is unavailable.");
        error.code = "direct_fork_operation_recovery_failed";
        throw error;
      }
      const projection = this.capabilitiesForTask(project, existingChild.sessionId);
      return {
        thread: threadSnapshotFromSession(existingChild),
        model: existingChild.model,
        reasoningEffort: existingChild.reasoningEffort,
        serviceTier: existingChild.serviceTier,
        sourceThreadId: source.sessionId,
        forked: true,
        reused: true,
        authorityInheritance: plan.existingResult.result.authorityInheritance || { mode: "restricted_source_no_grant", capabilities: [] },
        operation: plan.existingResult,
        capabilities: projection.capabilities,
        taskBinding: projection.taskBinding,
      };
    }
    const persistedIntent = isPlainObject(plan.existingResult?.result?.intent)
      ? plan.existingResult.result.intent
      : intent;
    if (persistedIntent.childThreadId !== childId || persistedIntent.sourceThreadId !== source.sessionId) {
      const error = new Error("Direct fork recovery intent does not match the requested source or child.");
      error.code = "direct_fork_operation_recovery_ambiguous";
      throw error;
    }
    let child = this.sessionStore.readSession(childId);
    if (child) {
      const lineage = child.parentForkLineage;
      const lineageMatches = isPlainObject(lineage)
        && lineage.sourceThreadId === source.sessionId
        && lineage.sourceProjectId === projectId
        && lineage.sourceHistoryHeadDigest === sourceHistoryHeadDigest
        && stableStringify(lineage.sourceTurnIds || []) === stableStringify(sourceTurnIds)
        && lineage.exactHistoryCopied === true;
      if (!lineageMatches || !sessionMatchesProject(child, projectId)) {
        const error = new Error("Direct fork recovery found an ambiguous child lineage.");
        error.code = "direct_fork_operation_recovery_ambiguous";
        throw error;
      }
    } else {
      child = this.sessionStore.forkSession(source.sessionId, {
        sessionId: childId,
        title: persistedIntent.title,
        sourceHistoryHeadDigest,
        parentForkLineage: {
          schema: "direct_thread_fork_lineage@1",
          sourceThreadId: source.sessionId,
          sourceProjectId: source.projectId,
          sourceTurnIds,
          sourceHistoryHeadTurnId: normalizeString(source.turns?.at(-1)?.turnId, ""),
          sourceHistoryHeadDigest,
          exactHistoryCopied: true,
          providerContinuityHandleUsed: false,
          rawPathExposed: false,
        },
      });
    }
    let childGrant = null;
    if (sourceGrant) {
      if (!this.harnessGrantStore || typeof this.harnessGrantStore.write !== "function") {
        const error = new Error("Direct fork cannot recover a full-access child grant without a durable grant store.");
        error.code = "direct_fork_source_grant_invalid";
        throw error;
      }
      if (sourceGrant.grantId !== persistedIntent.sourceGrantId || Number(sourceGrant.grantRevision) !== Number(persistedIntent.sourceGrantRevision)) {
        const error = new Error("Direct fork recovery source grant is stale or changed.");
        error.code = "direct_fork_source_grant_stale";
        throw error;
      }
      let existingChildGrant = null;
      if (persistedIntent.childGrantId) {
        try {
          existingChildGrant = this.harnessGrantStore.read(persistedIntent.childGrantId);
        } catch (error) {
          const recoveryError = new Error("Direct fork recovery found an unreadable child grant.");
          recoveryError.code = "direct_fork_operation_recovery_ambiguous";
          recoveryError.cause = error;
          throw recoveryError;
        }
        if (!existingChildGrant && typeof this.harnessGrantStore.pathFor === "function"
          && fs.existsSync(this.harnessGrantStore.pathFor(persistedIntent.childGrantId))) {
          const error = new Error("Direct fork recovery found a corrupt child grant record.");
          error.code = "direct_fork_operation_recovery_ambiguous";
          throw error;
        }
      }
      if (existingChildGrant) {
        const grantErrors = validateDirectThreadHarnessGrant(existingChildGrant, {
          taskId: childId,
          threadId: childId,
          projectId,
          grantId: persistedIntent.childGrantId,
          executionEnvironmentDigest: sourceGrant.executionEnvironmentDigest,
          grantRevision: 1,
          requireCurrent: true,
        });
        if (grantErrors.length || existingChildGrant.parentGrantId !== sourceGrant.grantId
          || stableStringify(harnessGrantCapabilityNames(existingChildGrant)) !== stableStringify(persistedIntent.childCapabilityNames || [])) {
          const error = new Error("Direct fork recovery found a mismatched child grant.");
          error.code = "direct_fork_operation_recovery_ambiguous";
          throw error;
        }
        childGrant = existingChildGrant;
      } else {
        childGrant = inheritDirectThreadHarnessGrant(sourceGrant, {
          grantId: persistedIntent.childGrantId,
          taskId: childId,
          threadId: childId,
          projectId,
          executionEnvironment: sourceGrant.executionEnvironment,
          capabilities: persistedIntent.childCapabilityNames,
        });
        this.harnessGrantStore.write(childGrant);
      }
      const refreshed = this.sessionStore.readSession(childId) || child;
      if (refreshed.harnessGrantId && refreshed.harnessGrantId !== childGrant.grantId) {
        const error = new Error("Direct fork recovery found a mismatched child grant binding.");
        error.code = "direct_fork_operation_recovery_ambiguous";
        throw error;
      }
      if (refreshed.harnessAccessProfile !== "full_access" || refreshed.harnessGrantId !== childGrant.grantId) {
        this.sessionStore.writeSession({
          ...refreshed,
          harnessAccessProfile: "full_access",
          harnessGrantId: childGrant.grantId,
          executionEnvironmentDigest: childGrant.executionEnvironmentDigest,
        });
      }
    } else if (child.harnessAccessProfile === "full_access" || child.harnessGrantId) {
      const error = new Error("Direct fork recovery found unexpected full-access child authority.");
      error.code = "direct_fork_operation_recovery_ambiguous";
      throw error;
    }
    if (this.directThreadStore) this.indexDirectThreadStoreSession(childId);
    const authorityInheritance = childGrant
      ? {
          mode: "bounded_parent_inheritance",
          parentGrantId: childGrant.parentGrantId,
          childGrantId: childGrant.grantId,
          childCapabilityNames: harnessGrantCapabilityNames(childGrant),
          childMayWiden: false,
          childMayRetarget: false,
        }
      : { mode: "restricted_source_no_grant", childMayWiden: false };
    if (this.directThreadStore && typeof this.directThreadStore.createForkLineageEdges === "function") {
      try {
        this.directThreadStore.createForkLineageEdges({
          projectId,
          operationId: plan.operationId,
          forkThreadId: childId,
          sourceThreadIds: [source.sessionId],
          sourcePreviewId: childId,
        });
      } catch {
        // A rebuildable thread projection must not widen or block the canonical fork session.
      }
    }
    const refreshedChild = this.sessionStore.readSession(childId) || child;
    const operation = this.commitThreadControlOperation(plan, {
      sourceThreadId: source.sessionId,
      forkThreadId: childId,
      sourceHistoryHeadDigest,
      childHistoryHeadDigest: directHistoryHeadDigest(refreshedChild),
      authorityInheritance,
    });
    const projection = this.capabilitiesForTask(project, refreshedChild.sessionId);
    return {
      thread: threadSnapshotFromSession(refreshedChild),
      model: refreshedChild.model,
      reasoningEffort: refreshedChild.reasoningEffort,
      serviceTier: refreshedChild.serviceTier,
      sourceThreadId: source.sessionId,
      forked: true,
      reused: Boolean(plan.existing),
      authorityInheritance: childGrant
        ? { mode: "bounded_parent_inheritance", parentGrantId: childGrant.parentGrantId, grantId: childGrant.grantId, grantRevision: childGrant.grantRevision, capabilities: harnessGrantCapabilityNames(childGrant) }
        : { mode: "restricted_source_no_grant", capabilities: [] },
      operation,
      capabilities: projection.capabilities,
      taskBinding: projection.taskBinding,
    };
  }

  rollbackThread(params = {}, context = {}) {
    const project = context.project || {};
    const projectId = normalizeString(project.id, "");
    const sessionId = normalizeString(params.sessionId || params.threadId, "");
    const session = this.sessionStore.readSession(sessionId);
    if (!session) throw new Error(`Direct live text session not found: ${sessionId}`);
    if (!sessionMatchesProject(session, projectId)) {
      const error = new Error("Direct rollback target does not belong to the active project.");
      error.code = "direct_session_project_scope_mismatch";
      throw error;
    }
    this.assertReady(project, { model: session.model });
    const requestedClientOperationId = normalizeString(params.clientOperationId || params.clientRollbackId, "");
    const preexisting = requestedClientOperationId && this.directThreadStore?.operationByClient
      ? this.directThreadStore.operationByClient(projectId, requestedClientOperationId)
      : null;
    if (preexisting && normalizeString(preexisting.operation_type, "") === "rollback_thread" && preexisting.status === "committed") {
      const existingOperation = this.directThreadStore.operationResult(preexisting);
      const current = this.sessionStore.readSession(sessionId) || session;
      if (existingOperation.result?.intent?.threadId && existingOperation.result.intent.threadId !== sessionId) {
        const error = new Error("Direct rollback client operation id is bound to another thread.");
        error.code = "client_operation_id_conflict";
        throw error;
      }
      const expectedExistingHead = normalizeString(params.expectedHistoryHeadDigest || params.expectedHeadDigest, "");
      if (expectedExistingHead && expectedExistingHead !== existingOperation.result?.beforeHistoryHeadDigest) {
        const error = new Error("Direct rollback client operation id was reused with a different history head.");
        error.code = "client_operation_id_conflict";
        throw error;
      }
      if (params.rollbackId && params.rollbackId !== existingOperation.result?.rollbackId) {
        const error = new Error("Direct rollback client operation id was reused with a different rollback identity.");
        error.code = "client_operation_id_conflict";
        throw error;
      }
      const requestedCount = params.numTurns === undefined && params.turnCount === undefined
        ? null
        : Number(params.numTurns || params.turnCount);
      const existingCount = Array.isArray(existingOperation.result?.removedTurnIds)
        ? existingOperation.result.removedTurnIds.length
        : null;
      if (requestedCount !== null && requestedCount !== existingCount) {
        const error = new Error("Direct rollback client operation id was reused with a different turn count.");
        error.code = "client_operation_id_conflict";
        throw error;
      }
      const projection = this.capabilitiesForTask(project, sessionId);
      return {
        thread: threadSnapshotFromSession(current),
        rollback: {
          rollbackId: normalizeString(existingOperation.result?.rollbackId, requestedClientOperationId),
          removedTurnIds: Array.isArray(existingOperation.result?.removedTurnIds) ? existingOperation.result.removedTurnIds : [],
          beforeHistoryHeadDigest: normalizeString(existingOperation.result?.beforeHistoryHeadDigest, ""),
          afterHistoryHeadDigest: normalizeString(existingOperation.result?.afterHistoryHeadDigest, directHistoryHeadDigest(current)),
        },
        operation: existingOperation,
        reused: true,
        capabilities: projection.capabilities,
        taskBinding: projection.taskBinding,
      };
    }
    if (session.importedSessionReadOnly === true) {
      const error = new Error("Imported Direct sessions are read-only and cannot be rolled back.");
      error.code = "direct_imported_session_read_only";
      throw error;
    }
    if (this.activeTurnForSession(session)) {
      const error = new Error("Direct rollback requires a non-active thread.");
      error.code = "active_direct_turn_exists";
      throw error;
    }
    let recoveryIntent = null;
    if (preexisting && normalizeString(preexisting.operation_type, "") === "rollback_thread") {
      try {
        const plannedResult = JSON.parse(preexisting.result_json || "{}");
        if (preexisting.status === "planned" && isPlainObject(plannedResult.intent)) recoveryIntent = plannedResult.intent;
      } catch {}
    }
    const recoveringPlanned = isPlainObject(recoveryIntent);
    if (recoveringPlanned && (params.numTurns !== undefined || params.turnCount !== undefined)) {
      const requestedRecoveryCount = Number(params.numTurns || params.turnCount);
      const plannedRecoveryCount = Array.isArray(recoveryIntent.removedTurnIds) ? recoveryIntent.removedTurnIds.length : 0;
      if (requestedRecoveryCount !== plannedRecoveryCount) {
        const error = new Error("Direct rollback client operation id was reused with a different turn count.");
        error.code = "client_operation_id_conflict";
        throw error;
      }
    }
    if (recoveringPlanned && (!Array.isArray(recoveryIntent.removedTurnIds) || !Array.isArray(recoveryIntent.retainedTurnIds))) {
      const error = new Error("Direct rollback recovery intent has invalid turn identity.");
      error.code = "direct_thread_control_recovery_ambiguous";
      throw error;
    }
    const beforeDigest = normalizeString(recoveryIntent?.beforeHistoryHeadDigest, directHistoryHeadDigest(session));
    const expectedHeadDigest = normalizeString(params.expectedHistoryHeadDigest || params.expectedHeadDigest, "");
    if (!recoveringPlanned && expectedHeadDigest && expectedHeadDigest !== beforeDigest) {
      const error = new Error("Direct rollback rejected a stale history head.");
      error.code = "direct_thread_history_head_stale";
      throw error;
    }
    const turns = Array.isArray(session.turns) ? session.turns : [];
    const requestedCount = Number(params.numTurns || params.turnCount || 1);
    const count = Number.isInteger(requestedCount) ? requestedCount : 1;
    if (!recoveringPlanned && (count < 1 || count > turns.length)) {
      const error = new Error("Direct rollback turn count is outside the current history.");
      error.code = "direct_thread_rollback_count_invalid";
      throw error;
    }
    const removedIds = new Set((recoveryIntent?.removedTurnIds || turns.slice(-count).map((turn) => turn?.turnId))
      .map((turnId) => normalizeString(turnId, "")).filter(Boolean));
    const retainedIds = recoveryIntent?.retainedTurnIds || turns.slice(0, -count)
      .map((turn) => normalizeString(turn?.turnId, "")).filter(Boolean);
    const rollbackId = normalizeString(recoveryIntent?.rollbackId || params.rollbackId || params.clientRollbackId, `direct_rollback_${sha256(stableStringify({ projectId, sessionId, beforeDigest, removedTurnIds: [...removedIds] })).slice(0, 28)}`);
    const intent = {
      schema: "direct_thread_control_intent@1",
      threadId: sessionId,
      beforeHistoryHeadDigest: beforeDigest,
      removedTurnIds: [...removedIds],
      retainedTurnIds: retainedIds,
      rollbackId,
    };
    const plan = this.planThreadControlOperation("rollback_thread", {
      projectId,
      threadId: sessionId,
      clientOperationId: params.clientOperationId || rollbackId,
      expectedHistoryHeadDigest: beforeDigest,
      target: { threadIds: [sessionId], turnIds: [...removedIds] },
      intent,
    }, { target: { threadIds: [sessionId], turnIds: [...removedIds] }, intent });
    if (plan.existingResult?.status === "committed") {
      const current = this.sessionStore.readSession(sessionId) || session;
      const projection = this.capabilitiesForTask(project, sessionId);
      return {
        thread: threadSnapshotFromSession(current),
        rollback: {
          rollbackId: normalizeString(plan.existingResult.result?.rollbackId, rollbackId),
          removedTurnIds: Array.isArray(plan.existingResult.result?.removedTurnIds) ? plan.existingResult.result.removedTurnIds : [],
          beforeHistoryHeadDigest: normalizeString(plan.existingResult.result?.beforeHistoryHeadDigest, beforeDigest),
          afterHistoryHeadDigest: normalizeString(plan.existingResult.result?.afterHistoryHeadDigest, directHistoryHeadDigest(current)),
        },
        operation: plan.existingResult,
        reused: true,
        capabilities: projection.capabilities,
        taskBinding: projection.taskBinding,
      };
    }
    const persistedIntent = isPlainObject(plan.existingResult?.result?.intent)
      ? plan.existingResult.result.intent
      : intent;
    if (persistedIntent.threadId !== sessionId
      || persistedIntent.beforeHistoryHeadDigest !== beforeDigest
      || stableStringify(persistedIntent.removedTurnIds || []) !== stableStringify([...removedIds])
      || stableStringify(persistedIntent.retainedTurnIds || []) !== stableStringify(retainedIds)) {
      const error = new Error("Direct rollback recovery intent does not match the current history head.");
      error.code = "direct_thread_control_recovery_ambiguous";
      throw error;
    }
    let currentSession = this.sessionStore.readSession(sessionId) || session;
    let rollbackRecord = (Array.isArray(currentSession.rollbackHistory) ? currentSession.rollbackHistory : [])
      .find((record) => record?.rollbackId === rollbackId);
    if (rollbackRecord) {
      if (rollbackRecord.beforeHistoryHeadDigest !== beforeDigest
        || stableStringify(rollbackRecord.removedTurnIds || []) !== stableStringify([...removedIds])) {
        const error = new Error("Direct rollback recovery found an ambiguous rollback record.");
        error.code = "direct_thread_control_recovery_ambiguous";
        throw error;
      }
    } else if (recoveringPlanned && directHistoryHeadDigest(currentSession) !== beforeDigest) {
      const error = new Error("Direct rollback recovery rejected a stale history head before session mutation.");
      error.code = "direct_thread_control_recovery_ambiguous";
      throw error;
    } else {
      const now = nowIso();
      for (const turnId of removedIds) {
        const turn = this.sessionStore.readTurn(sessionId, turnId);
        if (turn && turn.rolledBack !== true) {
          this.sessionStore.writeTurn({ ...turn, rolledBack: true, rollbackId, rolledBackAt: now });
        }
      }
      currentSession = this.sessionStore.readSession(sessionId) || currentSession;
      const currentTurnIds = new Set((Array.isArray(currentSession.turns) ? currentSession.turns : [])
        .map((turn) => normalizeString(turn?.turnId, "")));
      const missingTurn = [...removedIds].find((turnId) => !currentTurnIds.has(turnId));
      if (missingTurn) {
        const removedTurn = this.sessionStore.readTurn(sessionId, missingTurn);
        if (!removedTurn || removedTurn.rolledBack !== true) {
          const error = new Error("Direct rollback recovery found a partially applied turn mutation.");
          error.code = "direct_thread_control_recovery_ambiguous";
          throw error;
        }
      }
      const nowSession = nowIso();
      const retainedIds = new Set((persistedIntent.retainedTurnIds || []).map((id) => normalizeString(id, "")).filter(Boolean));
      const retainedNow = (Array.isArray(currentSession.turns) ? currentSession.turns : []).filter((turn) => retainedIds.has(normalizeString(turn?.turnId, "")));
      const nextSession = {
        ...currentSession,
        updatedAt: nowSession,
        status: normalizeString(retainedNow.at(-1)?.state, "created"),
        turns: retainedNow,
        messages: (Array.isArray(currentSession.messages) ? currentSession.messages : []).filter((message) => !removedIds.has(normalizeString(message?.id, ""))),
        clientTurnRequests: Object.fromEntries(Object.entries(isPlainObject(currentSession.clientTurnRequests) ? currentSession.clientTurnRequests : {}).filter(([, turnId]) => !removedIds.has(normalizeString(turnId, "")))),
        rollbackHistory: [
          ...(Array.isArray(currentSession.rollbackHistory) ? currentSession.rollbackHistory : []),
          {
            schema: "direct_thread_rollback_record@1",
            rollbackId,
            removedTurnIds: [...removedIds],
            beforeHistoryHeadDigest: beforeDigest,
            exactCurrentHistoryRetained: true,
            rawPathExposed: false,
            createdAt: nowSession,
          },
        ],
        historyHeadTurnId: normalizeString(retainedNow.at(-1)?.turnId, ""),
      };
      nextSession.historyHeadDigest = directHistoryHeadDigest(nextSession);
      this.sessionStore.writeSession(nextSession);
      currentSession = nextSession;
      rollbackRecord = nextSession.rollbackHistory.at(-1);
    }
    if (this.directThreadStore) {
      this.indexDirectThreadStoreSession(sessionId);
      try {
        this.directThreadStore.buildRendererTranscriptProjection(sessionId, { sessionStore: this.sessionStore, force: true });
      } catch {}
    }
    const afterHistoryHeadDigest = directHistoryHeadDigest(currentSession);
    const operation = this.commitThreadControlOperation(plan, {
      rollbackId,
      removedTurnIds: [...removedIds],
      beforeHistoryHeadDigest: beforeDigest,
      afterHistoryHeadDigest,
    });
    const projection = this.capabilitiesForTask(project, sessionId);
    return {
      thread: threadSnapshotFromSession(currentSession),
      rollback: { rollbackId, removedTurnIds: [...removedIds], beforeHistoryHeadDigest: beforeDigest, afterHistoryHeadDigest },
      operation,
      reused: Boolean(plan.existing),
      capabilities: projection.capabilities,
      taskBinding: projection.taskBinding,
    };
  }

  steerTurn(params = {}, context = {}) {
    const project = context.project || {};
    const projectId = normalizeString(project.id, "");
    const sessionId = normalizeString(params.sessionId || params.threadId, "");
    const turnId = normalizeString(params.turnId || params.expectedTurnId, "");
    const session = this.sessionStore.readSession(sessionId);
    const turn = session ? this.sessionStore.readTurn(sessionId, turnId) : null;
    if (!session || !turn) throw new Error(`Direct live text turn not found: ${turnId || "missing"}.`);
    if (!sessionMatchesProject(session, projectId)) {
      const error = new Error("Direct steer target does not belong to the active project.");
      error.code = "direct_session_project_scope_mismatch";
      throw error;
    }
    this.assertReady(project, { model: turn.model || session.model });
    const requestedSteerRequestId = normalizeString(params.clientSteerRequestId || params.steerRequestId, "");
    const preexisting = requestedSteerRequestId && this.directThreadStore?.operationByClient
      ? this.directThreadStore.operationByClient(projectId, requestedSteerRequestId)
      : null;
    if (preexisting && normalizeString(preexisting.operation_type, "") === "steer_turn" && preexisting.status === "committed") {
      const existingOperation = this.directThreadStore.operationResult(preexisting);
      if ((existingOperation.result?.intent?.sessionId && existingOperation.result.intent.sessionId !== sessionId)
        || (existingOperation.result?.intent?.turnId && existingOperation.result.intent.turnId !== turnId)) {
        const error = new Error("Direct steer client operation id is bound to another session turn.");
        error.code = "client_operation_id_conflict";
        throw error;
      }
      const requestedInput = directTurnControlInput(params);
      const requestedInputDigest = sha256(stableStringify(requestedInput));
      if (existingOperation.result?.inputDigest && existingOperation.result.inputDigest !== requestedInputDigest) {
        const error = new Error("Direct steer client operation id was reused with different input.");
        error.code = "client_operation_id_conflict";
        throw error;
      }
      const currentTurn = this.sessionStore.readTurn(sessionId, turnId) || turn;
      return {
        turn: turnSnapshot(currentTurn),
        steerRequestId: normalizeString(existingOperation.result?.steerRequestId, requestedSteerRequestId),
        status: "accepted",
        controlState: "queued_for_active_turn",
        providerContinuationRequired: true,
        operation: existingOperation,
        reused: true,
      };
    }
    let recoveryIntent = null;
    if (preexisting && normalizeString(preexisting.operation_type, "") === "steer_turn" && preexisting.status === "planned") {
      try {
        const plannedResult = JSON.parse(preexisting.result_json || "{}");
        if (isPlainObject(plannedResult.intent)) recoveryIntent = plannedResult.intent;
      } catch {}
    }
    const expectedTurnId = normalizeString(recoveryIntent?.turnId || params.expectedTurnId, "");
    if (expectedTurnId && expectedTurnId !== turn.turnId) {
      const error = new Error("Direct steer target turn is stale.");
      error.code = "direct_turn_stale";
      throw error;
    }
    if (!ACTIVE_TURN_STATES.has(turn.state)) {
      const error = new Error("Direct steer requires an active turn.");
      error.code = "direct_turn_not_active";
      throw error;
    }
    const requestedInput = directTurnControlInput(params);
    const requestedInputDigest = sha256(stableStringify(requestedInput));
    if (recoveryIntent?.inputDigest && requestedInputDigest !== recoveryIntent.inputDigest) {
      const error = new Error("Direct steer client operation id was reused with different input.");
      error.code = "client_operation_id_conflict";
      throw error;
    }
    const input = recoveryIntent?.inputDigest && Array.isArray(recoveryIntent.input)
      ? recoveryIntent.input
      : requestedInput;
    const text = input[0].text;
    if (text.length > this.maxPromptChars) {
      const error = new Error("Direct steer input exceeds the configured prompt bound.");
      error.code = "direct_turn_control_input_too_large";
      throw error;
    }
    const steering = Array.isArray(turn.steeringRequests) ? turn.steeringRequests : [];
    const steerRequestId = normalizeString(recoveryIntent?.steerRequestId || requestedSteerRequestId, `direct_steer_${sha256(stableStringify({ projectId, sessionId, turnId, input })).slice(0, 28)}`);
    const expectedTurnDigest = normalizeString(recoveryIntent?.expectedTurnDigest || params.expectedTurnDigest, "");
    const currentTurnDigest = sha256(stableStringify({ turnId: turn.turnId, state: turn.state, steeringCount: steering.length, updatedAt: turn.updatedAt }));
    const existingSteering = steering.find((entry) => entry?.steerRequestId === steerRequestId);
    if (expectedTurnDigest && expectedTurnDigest !== currentTurnDigest && !existingSteering) {
      const error = new Error("Direct steer rejected a stale turn head.");
      error.code = "direct_turn_stale";
      throw error;
    }
    const steerInputDigest = recoveryIntent?.inputDigest || requestedInputDigest;
    if (existingSteering) {
      if (existingSteering.inputDigest !== steerInputDigest) {
        const error = new Error("Direct steer request identity was reused with different input.");
        error.code = "client_operation_id_conflict";
        throw error;
      }
      const currentSession = this.sessionStore.readSession(sessionId) || session;
      const nextMessages = (Array.isArray(currentSession.messages) ? currentSession.messages : []).map((message) => {
        if (message?.id !== turnId) return message;
        const items = Array.isArray(message.items) ? message.items : [];
        if (items.some((item) => item?.id === steerRequestId)) return message;
        return {
          ...message,
          items: [...items, { id: steerRequestId, type: "userMessage", turnId, content: [{ type: "text", text }], control: "steer" }],
        };
      });
      this.sessionStore.writeSession({ ...currentSession, messages: nextMessages });
      const existingIntent = recoveryIntent || {
        schema: "direct_thread_control_intent@1",
        sessionId,
        turnId,
        steerRequestId,
        expectedTurnDigest: existingSteering.expectedTurnDigest,
        input,
        inputDigest: existingSteering.inputDigest,
      };
      const plan = this.planThreadControlOperation("steer_turn", {
        projectId,
        threadId: sessionId,
        clientOperationId: steerRequestId,
        expectedTurnId: turnId,
        requestDigest: existingSteering.inputDigest,
        target: { threadIds: [sessionId], turnIds: [turnId] },
        intent: existingIntent,
      }, { target: { threadIds: [sessionId], turnIds: [turnId] }, intent: existingIntent });
      const operation = plan.existingResult?.status === "committed"
        ? plan.existingResult
        : this.commitThreadControlOperation(plan, {
            steerRequestId,
            turnId,
            inputDigest: existingSteering.inputDigest,
            providerContinuationRequired: true,
          });
      return {
        turn: turnSnapshot(this.sessionStore.readTurn(sessionId, turnId) || turn),
        steerRequestId,
        status: "accepted",
        controlState: "queued_for_active_turn",
        providerContinuationRequired: true,
        operation,
        reused: true,
        steering: existingSteering,
      };
    }
    const steerIntent = {
      schema: "direct_thread_control_intent@1",
      sessionId,
      turnId,
      steerRequestId,
      expectedTurnDigest: currentTurnDigest,
      input,
      inputDigest: steerInputDigest,
    };
    const plan = this.planThreadControlOperation("steer_turn", {
      projectId,
      threadId: sessionId,
      clientOperationId: steerRequestId,
      expectedTurnId: turnId,
      requestDigest: steerInputDigest,
      target: { threadIds: [sessionId], turnIds: [turnId] },
      intent: steerIntent,
    }, { target: { threadIds: [sessionId], turnIds: [turnId] }, intent: steerIntent });
    if (plan.existingResult?.status === "committed") {
      return {
        turn: turnSnapshot(turn),
        steerRequestId,
        status: "accepted",
        controlState: "queued_for_active_turn",
        providerContinuationRequired: true,
        operation: plan.existingResult,
        reused: true,
      };
    }
    const steer = {
      schema: "direct_turn_steer_request@1",
      steerRequestId,
      sessionId,
      turnId,
      input,
      inputDigest: steerInputDigest,
      expectedTurnDigest: currentTurnDigest,
      acceptedAt: nowIso(),
      ownerControlledSurface: context.ownerControlled === true,
      providerContinuationRequired: true,
      rawPathExposed: false,
    };
    const updatedTurn = this.sessionStore.updateTurnState(sessionId, turnId, turn.state, {
      input: [...(Array.isArray(turn.input) ? turn.input : []), ...input],
      steeringRequests: [...steering, steer],
      requestShape: {
        ...(isPlainObject(turn.requestShape) ? turn.requestShape : {}),
        steerRequestIds: [...steering, steer].map((entry) => entry.steerRequestId),
        lastSteerRequestId: steerRequestId,
        turnControlBinding: "exact_session_turn",
      },
    });
    const currentSession = this.sessionStore.readSession(sessionId) || session;
    const nextMessages = (Array.isArray(currentSession.messages) ? currentSession.messages : []).map((message) => message?.id === turnId
      ? {
          ...message,
          items: [
            ...(Array.isArray(message.items) ? message.items : []),
            { id: steerRequestId, type: "userMessage", turnId, content: [{ type: "text", text }], control: "steer" },
          ],
        }
      : message);
    this.sessionStore.writeSession({ ...currentSession, messages: nextMessages });
    const operation = this.commitThreadControlOperation(plan, {
      steerRequestId,
      turnId,
      inputDigest: steer.inputDigest,
      providerContinuationRequired: true,
    });
    return {
      turn: turnSnapshot(updatedTurn),
      steerRequestId,
      status: "accepted",
      controlState: "queued_for_active_turn",
      providerContinuationRequired: true,
      operation,
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
      threadIntake: isPlainObject(options.threadIntake) ? options.threadIntake : null,
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
      threadIntake: isPlainObject(options.threadIntake) ? options.threadIntake : null,
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
      threadIntake: isPlainObject(options.threadIntake) ? options.threadIntake : null,
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

  isStatefulExecObligation(obligation = {}) {
    return ["exec_command", "write_stdin"].includes(normalizeString(obligation.name, ""));
  }

  async emitStatefulExecRequest(surfaceSession, sessionId, turnId, obligation = {}, project = {}) {
    const toolName = normalizeString(obligation.name, "");
    const grantAuthorization = this.harnessGrantAuthorizationFor(sessionId, turnId, project, toolName);
    if (!grantAuthorization.authorized || !this.statefulExecSessionManager) {
      this.sessionStore.updateToolObligation(sessionId, turnId, obligation.obligationId, {
        status: "unsupported",
        authorityState: "unsupported",
        approvalAvailable: false,
        executionAllowed: false,
        continuationAllowed: false,
        failureKind: grantAuthorization.reason || "stateful_exec_unavailable",
      }, {
        nextTurnState: "failed",
        turnPatch: {
          error: {
            code: grantAuthorization.reason || "stateful_exec_unavailable",
            message: "Direct stateful exec is available only to the exact current full-access task grant.",
          },
        },
      });
      return 0;
    }
    const session = this.sessionStore.readSession(sessionId) || {};
    const grant = this.harnessGrantForTurn(sessionId, turnId, project);
    const args = parseToolArgumentsObject(obligation);
    try {
      const binding = {
        project,
        harnessGrant: grant,
        grantId: grant?.grantId,
        taskId: sessionId,
        threadId: sessionId,
        projectId: normalizeString(project.id || project.projectId || session.projectId, ""),
        executionEnvironmentDigest: normalizeString(grant?.executionEnvironmentDigest || session.executionEnvironmentDigest, ""),
      };
      let result = toolName === "exec_command"
        ? this.statefulExecSessionManager.start({
            ...binding,
            cmd: args.cmd,
            command: args.command || args.executable,
            args: args.args || args.argv,
            cwd: args.cwd || args.workdir,
            env: args.env,
            stdinPolicy: args.stdinPolicy,
            idleTimeoutMs: args.idleTimeoutMs,
            hardTimeoutMs: args.hardTimeoutMs,
          })
        : this.statefulExecSessionManager.writeStdin({
            ...binding,
            sessionId: args.sessionId || args.session_id || args.execSessionId,
            input: args.chars ?? args.input ?? args.data ?? "",
            eof: args.eof === true,
          });
      if (toolName === "exec_command" && typeof this.statefulExecSessionManager.initialYield === "function") {
        // Provider-originated exec must expose a controller-owned bounded
        // initial observation, allowing short commands to settle while
        // keeping interactive sessions live for the declared stdin path.
        result = await this.statefulExecSessionManager.initialYield({
          ...binding,
          sessionId: result.sessionId,
        });
      }
      this.sessionStore.updateToolObligation(sessionId, turnId, obligation.obligationId, {
        status: toolName === "exec_command" ? "stateful_session_started" : "stateful_stdin_written",
        authorityState: "grant_auto_approval",
        authorityMode: grantAuthorization.authorityMode,
        harnessGrantId: grantAuthorization.grantId,
        harnessGrantRevision: grantAuthorization.grantRevision,
        approvalPolicy: grantAuthorization.approvalPolicy,
        sandboxMode: grantAuthorization.sandboxMode,
        approvalAvailable: false,
        executionAllowed: true,
        continuationAllowed: true,
        statefulExecSessionId: normalizeString(result.sessionId, args.sessionId || args.execSessionId),
        statefulExecResult: result,
      }, { nextTurnState: "continuation_ready" });
      this.emitNotification(surfaceSession, "warning", {
        threadId: sessionId,
        turnId,
        message: toolName === "exec_command"
          ? "Direct started the exact task-bound stateful exec session without a per-call approval round trip."
          : "Direct wrote to the exact task-bound stateful exec session without a per-call approval round trip.",
      });
      const envelope = {
        schema: "direct_stateful_exec_tool_result_envelope@1",
        envelopeId: `stateful_exec_result_${sha256(`${sessionId}:${turnId}:${obligation.obligationId}:${result.resultDigest}`).slice(0, 24)}`,
        toolName,
        callId: normalizeString(obligation.callId, ""),
        resultKind: "stateful_exec",
        status: "ready_for_provider_continuation",
        providerOutput: result,
        sideEffectExecuted: true,
        rawCommandIncluded: false,
        rawInputIncluded: false,
        rawPathIncluded: false,
        rawSecretIncluded: false,
      };
      envelope.envelopeDigest = sha256(stableStringify(envelope));
      await this.continueAfterSafeResidentUtilityResult(
        surfaceSession,
        sessionId,
        turnId,
        obligation,
        envelope,
        project,
      );
      return 1;
    } catch (error) {
      this.sessionStore.updateToolObligation(sessionId, turnId, obligation.obligationId, {
        status: "unsupported",
        authorityState: "unsupported",
        approvalAvailable: false,
        executionAllowed: false,
        continuationAllowed: false,
        failureKind: error.code || "stateful_exec_failed",
      }, {
        nextTurnState: "failed",
        turnPatch: {
          error: {
            code: error.code || "stateful_exec_failed",
            message: error.message || "Direct stateful exec failed.",
          },
        },
      });
      return 0;
    }
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
    const grantAuthorization = this.harnessGrantAuthorizationFor(
      sessionId,
      turnId,
      project,
      "run_command",
    );
    if (grantAuthorization.authorized) {
      this.sessionStore.updateToolObligation(sessionId, turnId, obligation.obligationId, {
        approvalAvailable: true,
        authorityState: "grant_auto_approval",
        authorityMode: grantAuthorization.authorityMode,
        harnessGrantId: grantAuthorization.grantId,
        harnessGrantRevision: grantAuthorization.grantRevision,
        approvalPolicy: grantAuthorization.approvalPolicy,
        sandboxMode: grantAuthorization.sandboxMode,
      }, {
        nextTurnState: "tool_waiting",
      });
      await this.approveExecuteAndContinueCommandExecution({
        sessionId,
        turnId,
        obligationId: obligation.obligationId,
        project,
        surfaceSession,
        approvedBy: "direct-thread-harness-grant",
      });
      return 0;
    }
    this.sessionStore.updateToolObligation(sessionId, turnId, obligation.obligationId, {
      approvalAvailable: true,
      authorityState: "command_waiting_for_approval",
    }, {
      nextTurnState: "tool_waiting",
    });
    if (!surfaceSession || typeof surfaceSession.createCommandExecutionRequest !== "function") {
      return 0;
    }
    surfaceSession.createCommandExecutionRequest({
      params,
      summary: params.displayCommand || "run_command",
    });
    return 1;
  }

  async emitPatchApplyApprovalRequest(surfaceSession, sessionId, turnId, obligation = {}, project = {}) {
    const fullAccessBinding = this.fullAccessLocalBinding(sessionId, turnId, project, "apply_patch");
    if (typeof this.workspaceRequest !== "function" && !fullAccessBinding) {
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
        workspaceRequest: fullAccessBinding
          ? (method, params) => this.fullAccessLocalEnvironmentExecutor.request(fullAccessBinding, method, params)
          : (method, params) => this.workspaceRequest(project, method, params, this.readOnlyWorkspaceTimeoutMs),
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
    const grantAuthorization = this.harnessGrantAuthorizationFor(
      sessionId,
      turnId,
      project,
      "apply_patch",
    );
    if (grantAuthorization.authorized) {
      this.sessionStore.updateToolObligation(sessionId, turnId, obligation.obligationId, {
        approvalAvailable: true,
        authorityState: "grant_auto_approval",
        authorityMode: grantAuthorization.authorityMode,
        harnessGrantId: grantAuthorization.grantId,
        harnessGrantRevision: grantAuthorization.grantRevision,
        approvalPolicy: grantAuthorization.approvalPolicy,
        sandboxMode: grantAuthorization.sandboxMode,
      }, {
        nextTurnState: "tool_waiting",
      });
      await this.approveExecuteAndContinuePatchApply({
        sessionId,
        turnId,
        obligationId: obligation.obligationId,
        project,
        surfaceSession,
        approvedBy: "direct-thread-harness-grant",
      });
      return 0;
    }
    this.sessionStore.updateToolObligation(sessionId, turnId, obligation.obligationId, {
      approvalAvailable: true,
      authorityState: "patch_waiting_for_approval",
    }, {
      nextTurnState: "tool_waiting",
    });
    if (!surfaceSession || typeof surfaceSession.createPatchApplyRequest !== "function") {
      return 0;
    }
    surfaceSession.createPatchApplyRequest({
      params,
      summary: params.files.map((file) => `${file.operation} ${file.path}`).join("; ") || "apply_patch",
    });
    return 1;
  }

  isSafeResidentUtilityObligation(obligation = {}) {
    return isSafeResidentUtilityToolName(obligation.name);
  }

  isEpistemicLedgerObligation(sessionId, turnId, obligation = {}) {
    const binding = this.epistemicLedgerTurnBinding(sessionId, turnId);
    const name = normalizeString(obligation.name, "");
    return Boolean(
      binding?.bundle &&
      isEpistemicLedgerToolName(name) &&
      binding.bundle.operationNames.includes(name),
    );
  }

  async buildEpistemicLedgerResultEnvelope(
    sessionId,
    turnId,
    obligation = {},
    project = {},
  ) {
    const binding = this.epistemicLedgerTurnBinding(sessionId, turnId);
    if (!binding?.bundle || !this.epistemicLedgerToolInvoker) {
      const error = new Error(
        "Direct epistemic ledger execution is unavailable for this turn.",
      );
      error.code = "direct_epistemic_ledger_runtime_unavailable";
      throw error;
    }
    let argumentsValue;
    try {
      argumentsValue = JSON.parse(normalizeString(obligation.argumentsText, "{}"));
    } catch (_error) {
      argumentsValue = null;
    }
    if (!isPlainObject(argumentsValue)) {
      const error = new Error("Direct epistemic ledger arguments are invalid JSON.");
      error.code = "direct_epistemic_ledger_arguments_invalid";
      throw error;
    }
    const projectId = normalizeString(
      project?.id || project?.projectId || project?.name,
      binding.bundle.scope?.projectId || "",
    );
    const invocation = await this.epistemicLedgerToolInvoker({
      bundle: binding.bundle,
      operationName: normalizeString(obligation.name, ""),
      arguments: argumentsValue,
      currentRevisionByScope: binding.currentRevisionByScope,
      visibleEvidenceRefs: binding.visibleEvidenceRefs,
      authorshipKind: "semantic_role",
      agentRunRef: {
        kind: "direct_agent_run",
        id: `${sessionId}:${turnId}`,
        digest: `sha256:${sha256(stableStringify({ sessionId, turnId, projectId }))}`,
      },
      artifactLifecycleBinding:
        binding.artifactLifecycleBinding || null,
    });
    const result = isPlainObject(invocation?.result)
      ? invocation.result
      : invocation;
    const decision = isPlainObject(result?.decision) ? result.decision : {};
    const receipt = isPlainObject(result?.append?.receipt)
      ? result.append.receipt
      : null;
    const lifecycleIngestionReceipt = isPlainObject(
      invocation?.lifecycleIngestion?.receipt,
    )
      ? invocation.lifecycleIngestion.receipt
      : null;
    const lifecycleAutomation = isPlainObject(
      invocation?.lifecycleAutomation,
    )
      ? invocation.lifecycleAutomation
      : null;
    const appended = decision.allowed === true && Boolean(receipt);
    const providerOutput = {
      kind: "epistemic_ledger_result",
      operationName: normalizeString(obligation.name, ""),
      status: appended
        ? normalizeString(receipt.appendState, "appended")
        : "blocked",
      decision: {
        allowed: decision.allowed === true,
        blockerCodes: Array.isArray(decision.blockerCodes)
          ? decision.blockerCodes
          : [],
        decisionId: normalizeString(decision.decisionId, ""),
        decisionDigest: normalizeString(decision.digest, ""),
      },
      ledgerEventRef: receipt?.ledgerEventRef || null,
      receiptRef: receipt
        ? {
            kind: "ledger_write_receipt",
            id: normalizeString(receipt.receiptId, ""),
            digest: normalizeString(receipt.receiptDigest, ""),
          }
        : null,
      epistemicPosture: normalizeString(receipt?.epistemicPosture, ""),
      canonicalEffect: receipt?.canonicalEffect === true,
      lifecycleDischarge: lifecycleIngestionReceipt
        ? {
            ingestionState: normalizeString(
              lifecycleIngestionReceipt.ingestionState,
              "",
            ),
            transitionKind: normalizeString(
              lifecycleIngestionReceipt.transitionKind,
              "none",
            ),
            transitionRef:
              lifecycleIngestionReceipt.transitionRef || null,
            nextAction: normalizeString(
              lifecycleIngestionReceipt.nextAction,
              "none",
            ),
            blockerCodes: Array.isArray(
              lifecycleIngestionReceipt.blockerCodes,
            )
              ? lifecycleIngestionReceipt.blockerCodes
              : [],
            automationState: normalizeString(
              lifecycleAutomation?.state,
              lifecycleAutomation ? "started" : "not_required",
            ),
            automationAction: normalizeString(
              lifecycleAutomation?.action,
              "none",
            ),
            automationErrorCode: normalizeString(
              lifecycleAutomation?.errorCode,
              "",
            ),
            canonicalEffect: false,
            workspaceMutationAuthorized: false,
          }
        : null,
      rendererSafeSummary: normalizeString(
        receipt?.rendererSafeSummary,
        appended
          ? "The typed epistemic act was recorded."
          : "The typed epistemic act was rejected by its compiled contract.",
      ),
      rawSemanticPayloadIncluded: false,
      rawChainOfThoughtIncluded: false,
      rawSecretIncluded: false,
    };
    const envelope = {
      schema: "direct_epistemic_ledger_tool_result_envelope@1",
      envelopeId: `epistemic_ledger_result_${sha256(stableStringify({
        obligationId: obligation.obligationId,
        decisionId: providerOutput.decision.decisionId,
        receiptId: providerOutput.receiptRef?.id || "",
      })).slice(0, 24)}`,
      resultKind: "epistemic_ledger_act",
      status: appended ? "ready_for_provider_continuation" : "blocked",
      semanticEffectRecorded: appended,
      sideEffectExecuted: false,
      canonicalEffect: providerOutput.canonicalEffect,
      providerOutput,
      createdAt: nowIso(),
      rawWorkspacePathExposed: false,
      rawSecretExposed: false,
    };
    envelope.envelopeDigest = sha256(stableStringify(envelope));
    return envelope;
  }

  async emitEpistemicLedgerRequest(
    surfaceSession,
    sessionId,
    turnId,
    obligation = {},
    project = {},
  ) {
    this.sessionStore.updateToolObligation(
      sessionId,
      turnId,
      obligation.obligationId,
      {
        status: "executing",
        authorityState: "compiled_ledger_call_validating",
        approvalAvailable: false,
        executionAllowed: true,
        continuationAllowed: false,
      },
      { nextTurnState: "authority_waiting" },
    );
    let envelope;
    try {
      envelope = await this.buildEpistemicLedgerResultEnvelope(
        sessionId,
        turnId,
        obligation,
        project,
      );
    } catch (error) {
      envelope = {
        schema: "direct_epistemic_ledger_tool_result_envelope@1",
        envelopeId: `epistemic_ledger_failure_${sha256(`${obligation.obligationId}:${error.code || error.message}`).slice(0, 24)}`,
        resultKind: "epistemic_ledger_act",
        status: "blocked",
        semanticEffectRecorded: false,
        sideEffectExecuted: false,
        canonicalEffect: false,
        providerOutput: {
          kind: "epistemic_ledger_result",
          operationName: normalizeString(obligation.name, ""),
          status: "blocked",
          decision: {
            allowed: false,
            blockerCodes: [error.code || "direct_epistemic_ledger_call_failed"],
          },
          ledgerEventRef: null,
          receiptRef: null,
          canonicalEffect: false,
          rendererSafeSummary:
            error.message || "The typed epistemic act could not be recorded.",
          rawSemanticPayloadIncluded: false,
          rawChainOfThoughtIncluded: false,
          rawSecretIncluded: false,
        },
        createdAt: nowIso(),
        rawWorkspacePathExposed: false,
        rawSecretExposed: false,
      };
      envelope.envelopeDigest = sha256(stableStringify(envelope));
    }
    await this.continueAfterSafeResidentUtilityResult(
      surfaceSession,
      sessionId,
      turnId,
      obligation,
      envelope,
      project,
    );
    return 1;
  }

  buildSafeResidentUtilityEnvelope(obligation = {}, options = {}) {
    const projectId = normalizeString(options.project?.id || options.project?.projectId || options.project?.name, "");
    const toolName = normalizeString(obligation.name, "");
    if (toolName === DIRECT_SELF_CONSTITUTION_TOOL_NAME) {
      const sessionId = normalizeString(options.sessionId, obligation.sessionId);
      const turnId = normalizeString(options.turnId, obligation.turnId);
      const session = this.sessionStore.readSession(sessionId) || {};
      const turn = this.sessionStore.readTurn(sessionId, turnId) || {};
      const previousSnapshot = isPlainObject(turn.selfConstitutionSnapshot)
        ? turn.selfConstitutionSnapshot
        : {};
      const snapshot = this.compileSelfConstitutionSnapshot({
        project: options.project || {},
        session,
        sessionId,
        turnId,
        model: normalizeString(turn.model, session.model),
        reasoningEffort: normalizeString(turn.reasoningEffort, session.reasoningEffort),
        potentialToolNames: previousSnapshot.capabilities?.potentialToolNames,
        declaredToolNames: turn.requestShape?.declaredToolNames ||
          previousSnapshot.capabilities?.declaredThisTurn,
        compiledAgentContext: turn.compiledAgentContext,
        contextBuildId: normalizeString(turn.contextBuildId, ""),
        requestManifestId: normalizeString(turn.requestManifestId, ""),
        supersedesDigest: normalizeString(previousSnapshot.digest, ""),
        enactmentUpdates: {
          ...selfConstitutionEnactmentUpdatesFromTurn(turn),
          [DIRECT_SELF_CONSTITUTION_TOOL_NAME]: {
            state: "executed",
            evidenceRef: normalizeString(
              obligation.obligationId || obligation.callId,
              "inspect_self_constitution_call",
            ),
            authority: {
              requirement: "none_read_only_projection",
              state: "not_required",
            },
          },
        },
      });
      return buildSelfConstitutionResultEnvelope(snapshot, {
        callId: normalizeString(obligation.callId, ""),
      });
    }
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
    const nativeAgentRuntimeResult = normalizeString(envelope.resultKind, "") === "direct_sub_agent_runtime";
    const statefulExecResult = normalizeString(envelope.resultKind, "") === "stateful_exec";
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
        maxStepCount: nativeAgentRuntimeResult
          ? MAX_AGENT_RUNTIME_TOOL_LOOP_STEPS
          : statefulExecResult ? MAX_READONLY_TOOL_LOOP_STEPS : 1,
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
        toolDeclarations: nativeAgentRuntimeResult || statefulExecResult,
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
    const epistemicLedgerResult =
      normalizeString(envelope.resultKind, "") === "epistemic_ledger_act";
    const result = {
      schema: epistemicLedgerResult
        ? "direct_epistemic_ledger_tool_result@1"
        : "direct_safe_resident_utility_result@1",
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
      authorityState: epistemicLedgerResult
        ? "epistemic_ledger_result_recorded"
        : "utility_result_recorded",
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
    const resultKind = normalizeString(envelope.resultKind, "");
    const ledgerContinuation = resultKind === "epistemic_ledger_act";
    const selfConstitutionContinuation = resultKind === "self_constitution_snapshot";
    const agentRuntimeContinuation = [
      "direct_sub_agent_runtime",
      "sub_agent_list_status",
      "sub_agent_inspect_status",
    ].includes(resultKind);
    const statefulExecContinuation = resultKind === "stateful_exec";
    const residentContinuation = ledgerContinuation || agentRuntimeContinuation || statefulExecContinuation;
    const directStatus = this.statusForProject(project || {});
    const ledgerBinding = this.epistemicLedgerTurnBinding(sessionId, turnId);
    const harnessGrant = statefulExecContinuation
      ? this.harnessGrantForTurn(sessionId, turnId, project || {})
      : null;
    const continuationToolNames = ledgerContinuation
      ? implementationContinuationToolNames(
          directStatus,
          userPromptTextFromTurn(turn),
        )
      : agentRuntimeContinuation
        ? [
            ...NATIVE_SUB_AGENT_RUNTIME_TOOL_NAMES,
            ...READ_ONLY_SUB_AGENT_STATUS_TOOL_NAMES,
          ]
        : statefulExecContinuation
          ? harnessGrantCapabilityNames(harnessGrant)
              .filter((name) => STATEFUL_EXEC_CAPABILITY_NAMES.includes(name))
        : [];
    const continuationToolComposition = residentContinuation
      ? composeImplementationToolBundleForRequest({
          projectId: normalizeString(
            project?.id || project?.projectId || project?.name,
            ledgerBinding?.bundle?.scope?.projectId || "",
          ),
          sessionId,
          turnId,
          toolNames: continuationToolNames,
          useLaneDefaultTools: false,
          sourceMessageId: `${turnId}_${obligation.obligationId}_${ledgerContinuation ? "ledger" : "agent_runtime"}_continuation`,
          normalizedLaneRequestId: `normalized_lane_request_${turnId}_${obligation.obligationId}_${Number(obligation.stepOrdinal || 1)}`,
          workThreadId: normalizeString(
            ledgerBinding?.bundle?.scope?.workThreadId,
            directWorkThreadContextCarrier(turn, project, obligation).workThreadId,
          ),
          runtimeFactsId:
            directStatus.evidenceId || "direct_runtime_facts",
          externalCapabilityProfile: directStatus.externalCapabilityProfile,
          providerHostedToolsStatus: directStatus.providerHostedToolsStatus,
          harnessGrant,
          roleLedgerToolBundle: ledgerContinuation ? ledgerBinding?.bundle : null,
        })
      : { tools: [], toolNames: [] };
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
      instructions: agentRuntimeContinuation
        ? NATIVE_AGENT_RUNTIME_CONTINUATION_INSTRUCTIONS
        : statefulExecContinuation
          ? statefulExecContinuationInstructions(
              continuationToolNames,
              normalizeString(
                envelope.providerOutput?.sessionId ||
                  envelope.providerOutput?.statefulExecSessionId ||
                  obligation.statefulExecSessionId,
                "",
              ),
            )
        : selfConstitutionContinuation
          ? SELF_CONSTITUTION_CONTINUATION_INSTRUCTIONS
          : DEFAULT_TOOL_CONTINUATION_INSTRUCTIONS,
      continuationTools: continuationToolComposition.tools,
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
    const streamTerminal = result.terminal || terminalStateFromNormalizedEvents(result.normalizedEvents || []);
    const nestedToolCall = residentContinuation && (result.normalizedEvents || []).some(
      (event) =>
        event?.type === "tool_call_started" ||
        event?.type === "tool_call_delta" ||
        event?.type === "tool_call_completed",
    );
    let nextToolObligations = [];
    let terminal = streamTerminal;
    let continuationOutcome = terminal.state === "completed"
      ? "assistant_final"
      : normalizeString(terminal.error?.code, "utility_continuation_failed");
    if (nestedToolCall) {
      const nextStepOrdinal = (Number(obligation.stepOrdinal || 1) || 1) + 1;
      const obligationResult = this.sessionStore.addToolObligations(
        sessionId,
        turnId,
        result.normalizedEvents,
        {
          toolLoopId: canonicalToolLoopId(obligation),
          stepOrdinal: nextStepOrdinal,
          parentResponseId: normalizeString(result.responseId, ""),
          parentResponseSource: "native_direct_agent_runtime_continuation_stream",
        },
      );
      nextToolObligations = obligationResult.obligations;
      const nextToolName = normalizeString(nextToolObligations[0]?.name, "");
      const nextToolAllowed =
        nextToolObligations.length === 1 &&
        (ledgerContinuation
          ? continuationToolComposition.toolNames.includes(nextToolName)
          : statefulExecContinuation
            ? continuationToolComposition.toolNames.includes(nextToolName) &&
              this.harnessGrantAuthorizationFor(
                sessionId,
                turnId,
                project,
                nextToolName,
              ).authorized
          : isNativeSubAgentRuntimeToolName(nextToolName) ||
            isReadOnlySubAgentStatusToolName(nextToolName));
      const loopCap = agentRuntimeContinuation
        ? MAX_AGENT_RUNTIME_TOOL_LOOP_STEPS
        : MAX_READONLY_TOOL_LOOP_STEPS;
      const loopCapExceeded = nextStepOrdinal > loopCap;
      if (nextToolAllowed && !loopCapExceeded) {
        terminal = { state: "tool_waiting", error: null };
        continuationOutcome = ledgerContinuation
          ? "next_epistemic_ledger_step"
          : statefulExecContinuation
            ? "next_stateful_exec_step"
          : "next_native_agent_runtime_step";
      } else {
        const transitionKind = ledgerContinuation
          ? "epistemic_ledger"
          : statefulExecContinuation ? "stateful_exec" : "agent_runtime";
        const failureKind = loopCapExceeded
          ? `${transitionKind}_tool_loop_cap_exceeded`
          : `unsupported_${transitionKind === "agent_runtime" ? "native_agent_runtime" : transitionKind}_transition`;
        terminal = {
          state: "failed",
          error: {
            code: failureKind,
            message: loopCapExceeded
              ? `Direct ${transitionKind.replaceAll("_", "-")} tool loop reached its configured step cap.`
              : `Direct ${transitionKind.replaceAll("_", "-")} continuation emitted an unsupported or ambiguous tool transition.`,
          },
        };
        continuationOutcome = failureKind;
        for (const nextObligation of nextToolObligations) {
          this.sessionStore.updateToolObligation(sessionId, turnId, nextObligation.obligationId, {
            status: "unsupported",
            authorityState: "unsupported",
            approvalAvailable: false,
            executionAllowed: false,
            continuationAllowed: false,
            failureKind,
          }, {
            nextTurnState: "failed",
            turnPatch: { error: terminal.error },
          });
        }
      }
    }
    const continuationOk =
      (result.ok === true && terminal.state === "completed") ||
      (
        terminal.state === "tool_waiting" &&
        ["next_epistemic_ledger_step", "next_native_agent_runtime_step", "next_stateful_exec_step"].includes(continuationOutcome)
      );
    const completedTurn = this.sessionStore.updateTurnState(sessionId, turnId, terminal.state, {
      continuationResponseId: normalizeString(result.responseId, ""),
      continuationResult: {
        schema: result.schema,
        ok: continuationOk,
        terminal,
        responseId: result.responseId,
        continuationOutcome,
        normalizedEventCount: Array.isArray(result.normalizedEvents) ? result.normalizedEvents.length : 0,
        originalRequestRetried: false,
      },
    }, {});
    const continuationId = normalizeString(result.continuation?.continuationId || continuationRequest.continuationId, "utility_continuation");
    this.appendUtilityContinuationMessage(sessionId, turnId, continuationId, result.normalizedEvents || [], terminal);
    this.emitContinuationAssistant(surfaceSession, sessionId, turnId, continuationId, result.normalizedEvents || []);
    this.sessionStore.updateToolObligation(sessionId, turnId, obligation.obligationId, {
      status: "continuation_sent",
      authorityState: "continuation_sent",
      continuationResult: {
        schema: result.schema,
        ok: continuationOk,
        terminal,
        responseId: result.responseId,
        continuationOutcome,
      },
    }, {});
    if (residentContinuation) {
      await this.emitContinuationNextToolOrComplete(surfaceSession, sessionId, turnId, {
        turnState: completedTurn.state,
        nextToolObligations,
      }, project, {
        streamPhase: ledgerContinuation
          ? "ledger-continuation"
          : statefulExecContinuation
            ? "stateful-exec-continuation"
          : "native-agent-runtime-continuation",
        approvalMessage: `Direct ${ledgerContinuation ? "ledger" : statefulExecContinuation ? "stateful-exec" : "native-agent"} continuation advanced to another governed tool transition.`,
        unavailableMessage: `Direct ${ledgerContinuation ? "ledger" : statefulExecContinuation ? "stateful-exec" : "native-agent"} continuation requested an unavailable transition.`,
      });
    } else {
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
    }
    return {
      decision: "utility_continued",
      turn: turnSnapshot(this.sessionStore.readTurn(sessionId, turnId)),
      obligation: this.sessionStore.findToolObligation(sessionId, turnId, obligation.obligationId).obligation,
      envelope,
      continuation: {
        ok: continuationOk,
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
    this.emitNativeSubAgentRuntimePosture(surfaceSession, sessionId, turnId, envelope, obligation);
    await this.continueAfterSafeResidentUtilityResult(surfaceSession, sessionId, turnId, obligation, envelope, project);
    return 1;
  }

  isNativeSubAgentRuntimeObligation(obligation = {}) {
    return isNativeSubAgentRuntimeToolName(obligation?.name);
  }

  emitNativeSubAgentRuntimePosture(surfaceSession, sessionId, turnId, envelope = {}, obligation = {}) {
    const blocked = normalizeString(envelope.status, "blocked") === "blocked";
    const toolName = normalizeString(envelope.toolName || obligation.name, "agent_runtime");
    const providerOutput = isPlainObject(envelope.providerOutput) ? envelope.providerOutput : {};
    const updates = Array.isArray(providerOutput.updates) ? providerOutput.updates : [];
    const firstUpdate = isPlainObject(updates[0]) ? updates[0] : {};
    const childAgentId = normalizeString(
      providerOutput.childAgentId || providerOutput.agentId || firstUpdate.childAgentId,
      "",
    );
    const taskName = normalizeString(providerOutput.taskName || firstUpdate.taskName, "");
    const lifecycleState = normalizeString(
      providerOutput.state || providerOutput.lifecycleState || firstUpdate.state || providerOutput.status,
      blocked ? "blocked" : "completed",
    );
    const blockerCode = normalizeString(
      providerOutput.blockerCode || envelope.blockerCodes?.[0],
      "",
    );
    const subject = taskName || childAgentId || "native child-agent runtime";
    const message = blocked
      ? `Direct ${toolName} blocked${blockerCode ? ` · ${blockerCode}` : ""}.`
      : toolName === "spawn_agent"
        ? `Child launch acknowledged · ${subject} · ${lifecycleState}.`
        : toolName === "wait_agent"
          ? `Child wait resolved · ${updates.length || 0} update${updates.length === 1 ? "" : "s"} · ${lifecycleState}.`
          : toolName === "inspect_agent"
            ? `Child inspected · ${subject} · ${lifecycleState}.`
            : toolName === "list_agents"
              ? `Agent pool observed · ${Number(providerOutput.agentCount || 0)} agent${Number(providerOutput.agentCount || 0) === 1 ? "" : "s"}.`
              : `Direct processed ${toolName} and continued the provider turn.`;
    this.emitNotification(surfaceSession, blocked ? "warning" : "direct/runtime-status", {
      threadId: sessionId,
      turnId,
      observationId: normalizeString(envelope.envelopeId, `${turnId}:${obligation.obligationId || toolName}`),
      observationKind: "native_child_agent_runtime",
      operation: toolName,
      lifecycleState,
      childAgentId,
      taskName,
      providerId: normalizeString(providerOutput.providerId || firstUpdate.providerId, ""),
      model: normalizeString(providerOutput.model || firstUpdate.model, ""),
      blockerCode,
      observedAt: nowIso(),
      message,
    });
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
    let spawnRequestNormalization = null;
    if (!this.subAgentPool) {
      runtimeResult = {
        status: "blocked",
        blockerCode: "direct_native_agent_pool_unavailable",
        updates: [],
      };
    } else if (toolName === "spawn_agent") {
      let spawnArgs = args;
      let activeSubAgentPolicyDecision = null;
      if (this.activeSubAgentPolicyResolver) {
        try {
          activeSubAgentPolicyDecision =
            await this.activeSubAgentPolicyResolver({
              projectId,
              threadId: sessionId,
              args,
              parentModel: normalizeString(turn.model, session.model),
              parentReasoningEffort: normalizeString(
                turn.reasoningEffort,
                session.reasoningEffort,
              ),
              activeChildren:
                typeof this.subAgentPool.activeCountForScope === "function"
                  ? this.subAgentPool.activeCountForScope({
                      projectId,
                      primaryThreadId: sessionId,
                    })
                  : 0,
              projectActiveChildren:
                typeof this.subAgentPool.activeCountForScope === "function"
                  ? this.subAgentPool.activeCountForScope({
                      projectId,
                    })
                  : 0,
            });
          if (!activeSubAgentPolicyDecision?.launchEligible) {
            runtimeResult = {
              status: "blocked",
              blockerCode: normalizeString(
                activeSubAgentPolicyDecision?.blockerCode,
                "direct_active_sub_agent_policy_spawn_blocked",
              ),
              activeSubAgentPolicyDecision,
              updates: [],
            };
          } else {
            const effective =
              activeSubAgentPolicyDecision.effectiveSpawn || {};
            spawnArgs = {
              ...args,
              agent_type: effective.roleId,
              provider: effective.providerId,
              model: effective.model,
              reasoning_effort: effective.reasoningEffort,
              fork_turns: effective.forkTurns,
              workspace_mode: effective.workspaceMode,
              ...(effective.toolProfile
                ? { tool_profile: effective.toolProfile }
                : { tool_profile: "" }),
            };
          }
        } catch (error) {
          runtimeResult = {
            status: "blocked",
            blockerCode: normalizeString(
              error?.code,
              "direct_active_sub_agent_policy_resolution_failed",
            ),
            updates: [],
          };
        }
      }
      const workspaceModeExplicit =
        Object.prototype.hasOwnProperty.call(spawnArgs, "workspace_mode") ||
        Object.prototype.hasOwnProperty.call(spawnArgs, "workspaceMode");
      const workspaceMode = normalizeString(spawnArgs.workspace_mode || spawnArgs.workspaceMode, "reasoning_only");
      const requestedToolProfile = normalizeString(spawnArgs.tool_profile || spawnArgs.toolProfile, "");
      const safelyIgnoredReasoningToolProfile =
        workspaceModeExplicit &&
        workspaceMode === "reasoning_only" &&
        Boolean(requestedToolProfile);
      spawnRequestNormalization = safelyIgnoredReasoningToolProfile
        ? {
            schema: "direct_spawn_request_normalization@1",
            status: "safe_narrowing",
            ignoredFields: ["tool_profile"],
            reason: "tool_profile_inapplicable_to_explicit_reasoning_only_mode",
            workspaceAuthorityWidened: false,
            toolAuthorityWidened: false,
          }
        : null;
      let parentAuthorityPacket = null;
      if (!runtimeResult && !workspaceModeExplicit && requestedToolProfile) {
        runtimeResult = {
          status: "blocked",
          blockerCode: "direct_workspace_worker_tool_profile_without_workspace",
          updates: [],
        };
      } else if (!runtimeResult && workspaceMode === "isolated_worktree") {
        const requestedProfileId = requestedToolProfile;
        if (!projectAllowsProviderWorkspaceWorkers(project)) {
          runtimeResult = {
            status: "blocked",
            blockerCode: "direct_workspace_worker_implementation_lane_required",
            updates: [],
          };
        } else if (workspaceWorkerSpawnHasUndeclaredFields(spawnArgs)) {
          runtimeResult = {
            status: "blocked",
            blockerCode: "direct_workspace_worker_spawn_arguments_unsafe",
            updates: [],
          };
        } else if (!this.workspaceWorkerDelegationPolicyResolver) {
          runtimeResult = {
            status: "blocked",
            blockerCode: "direct_workspace_worker_delegation_policy_missing",
            updates: [],
          };
        } else {
          try {
            const resolved = await this.workspaceWorkerDelegationPolicyResolver({
              projectId,
              workThreadId,
              primaryThreadId: sessionId,
              parentAgentId: normalizeString(session.agentThreadId || session.agentId, sessionId),
              roleLane: "implementation_worker",
              requestedProfileId,
              project,
            });
            const policy = resolved?.policy || resolved;
            parentAuthorityPacket = issueWorkspaceParentAuthorityFromDelegationPolicy(policy, {
              projectId,
              workThreadId,
              roleLane: "implementation_worker",
              requestedProfileId,
            });
          } catch (error) {
            runtimeResult = {
              status: "blocked",
              blockerCode: normalizeString(error?.code, "direct_workspace_worker_delegation_policy_invalid"),
              updates: [],
            };
          }
        }
      }
      if (!runtimeResult) runtimeResult = this.subAgentPool.launch({
        projectId,
        workThreadId,
        primaryThreadId: sessionId,
        parentAgentId: normalizeString(session.agentThreadId || session.agentId, sessionId),
        taskName: spawnArgs.task_name || spawnArgs.taskName,
        message: spawnArgs.message,
        agentType: spawnArgs.agent_type || spawnArgs.agentType,
        provider: spawnArgs.provider,
        model: spawnArgs.model,
        reasoningEffort: spawnArgs.reasoning_effort || spawnArgs.reasoningEffort,
        forkTurns: spawnArgs.fork_turns || spawnArgs.forkTurns,
        workspaceMode,
        toolProfile: safelyIgnoredReasoningToolProfile ? "" : requestedToolProfile,
        parentAuthorityPacket,
        spawnOperation: workspaceMode === "isolated_worktree" ? {
          parentSessionId: sessionId,
          parentTurnId: turnId,
          obligationId: normalizeString(obligation.obligationId, ""),
          callId: normalizeString(obligation.callId, ""),
        } : null,
        project,
        parentModel: normalizeString(turn.model, session.model),
        parentReasoningEffort: normalizeString(turn.reasoningEffort, session.reasoningEffort),
        parentContextMessages: directParentContextMessages(session),
        activeSubAgentPolicyDecision,
        requireActiveSubAgentPolicy:
          Boolean(this.activeSubAgentPolicyResolver),
      });
    } else {
      runtimeResult = await this.subAgentPool.wait({
        projectId,
        primaryThreadId: sessionId,
        targets: Array.isArray(args.targets) ? args.targets : [],
        timeoutMs: args.timeout_ms ?? args.timeoutMs,
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
          providerId: normalizeString(runtimeResult.providerId, ""),
          model: normalizeString(runtimeResult.model, ""),
          reasoningEffort: normalizeString(runtimeResult.reasoningEffort, ""),
          workspaceMode: normalizeString(runtimeResult.workspaceMode, "reasoning_only"),
          toolProfile: normalizeString(runtimeResult.toolProfile, "reasoning_only"),
          workspaceExecution: runtimeResult.workspaceExecution || null,
          contextHandoff: runtimeResult.contextHandoff || null,
          contextMessageCount: Number(runtimeResult.contextMessageCount || 0),
          runtimeProfileIndependentOfContext: runtimeResult.runtimeProfileIndependentOfContext === true,
          requestNormalization: spawnRequestNormalization,
          activeSubAgentPolicyDecisionRef:
            runtimeResult.activeSubAgentPolicyDecisionRef ||
            (runtimeResult.activeSubAgentPolicyDecision
              ? {
                  kind: "active_sub_agent_spawn_decision",
                  id: runtimeResult.activeSubAgentPolicyDecision.decisionId,
                  digest: runtimeResult.activeSubAgentPolicyDecision.digest,
                }
              : null),
          activeSubAgentPolicyRef:
            runtimeResult.activeSubAgentPolicyRef ||
            runtimeResult.activeSubAgentPolicyDecision?.policyRef ||
            null,
          replayed: runtimeResult.replayed === true,
          providerRoleLabelAcceptedAsAuthority: false,
          pool: runtimeResult.pool || this.subAgentPool?.descriptor?.() || null,
          childRunsInBackground: ["running", "queued", "accepted"].includes(runtimeResult.status),
          rawTaskIncluded: false,
          rawContextIncluded: false,
        }
      : {
          kind: "wait_agent_result",
          status: normalizeString(runtimeResult.status, "blocked"),
          blockerCode: normalizeString(runtimeResult.blockerCode, ""),
          updates: (Array.isArray(runtimeResult.updates) ? runtimeResult.updates : []).map((update) => {
            const workspaceWorker = normalizeString(update.workspaceMode, "reasoning_only") === "isolated_worktree";
            return {
              childAgentId: normalizeString(update.childAgentId, ""),
              taskName: normalizeString(update.taskName, ""),
              state: normalizeString(update.state, ""),
              resultSummary: workspaceWorker
                ? typedWorkspaceWorkerParentResultCode(update)
                : normalizeString(update.resultSummary, ""),
              resultSummaryKind: workspaceWorker
                ? "typed_status_code"
                : normalizeString(update.resultSummaryKind, "provider_summary"),
              blockerCode: workspaceWorker
                ? safeWorkspaceWorkerBlockerCode(update)
                : normalizeString(update.blockerCode, ""),
              providerId: normalizeString(update.providerId, ""),
              model: normalizeString(update.model, ""),
              reasoningEffort: normalizeString(update.reasoningEffort, ""),
              workspaceMode: normalizeString(update.workspaceMode, "reasoning_only"),
              toolProfile: normalizeString(update.toolProfile, "reasoning_only"),
              workspaceExecution: update.workspaceExecution || null,
              epistemicCapture: update.epistemicCapture || null,
              epistemicCaptureComplete: update.epistemicCaptureComplete === true,
              epistemicCaptureOmission: update.epistemicCaptureOmission || null,
              evidenceConfidence: normalizeString(update.evidenceConfidence, "unknown"),
              continuationTrace: update.continuationTrace || null,
              childOutputIncluded: false,
              rawChildProseIncluded: false,
            };
          }),
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
        normalizeString(runtimeResult.status, "blocked") !== "blocked" &&
        runtimeResult.replayed !== true,
      runtimeLifecycleMutationExecuted:
        toolName === "spawn_agent" &&
        normalizeString(runtimeResult.status, "blocked") !== "blocked" &&
        runtimeResult.replayed !== true,
      providerTurnScheduled:
        toolName === "spawn_agent" &&
        runtimeResult.replayed !== true &&
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
    this.emitNativeSubAgentRuntimePosture(surfaceSession, sessionId, turnId, envelope, obligation);
    await this.continueAfterSafeResidentUtilityResult(surfaceSession, sessionId, turnId, obligation, envelope, project);
    return 1;
  }

  isExternalPromotedObligation(obligation = {}) {
    return isExternalPromotedToolName(obligation?.name);
  }

  async buildExternalPromotedEnvelope(sessionId, turnId, obligation = {}, project = {}) {
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
    const profileSchemaValid = profile?.schema === "external_capability_profile@1";
    let profileValidationError = "";
    if (profileSchemaValid) {
      try {
        validateExternalCapabilityProfile(profile);
      } catch (error) {
        profileValidationError = normalizeString(error?.code || error?.message, "external_capability_profile_invalid");
      }
    }
    const usableExternalProfile = profileSchemaValid && !profileValidationError
      ? profile
      : buildExternalCapabilityProfile({ projectId, workThreadId });
    const externalResolver = toolName === "read_mcp_resource"
      ? this.mcpResourceReadResolver
      : this.externalDiscoveryResolver;
    let backendResult = null;
    let backendScopeError = "";
    if (!profileSchemaValid || profileValidationError) backendScopeError = "external_capability_profile_invalid";
    if (
      !backendScopeError &&
      (normalizeString(profile?.projectId, "") !== projectId ||
        (workThreadId && normalizeString(profile?.workThreadId, "") !== workThreadId))
    ) {
      backendScopeError = "external_capability_profile_scope_mismatch";
    }
    if (!EXTERNAL_PROMOTED_TOOL_SET.has(toolName)) backendScopeError = "external_tool_not_admitted";
    if (externalResolver && !backendScopeError) {
      try {
        backendResult = await externalResolver({
          project,
          projectId,
          workThreadId,
          threadId: sessionId,
          turnId,
          toolName,
          arguments: args,
          callId: normalizeString(obligation.callId, ""),
          profile: usableExternalProfile,
        });
        this.assertOpen();
        if (!isPlainObject(backendResult)) {
          backendScopeError = "external_backend_result_unavailable";
        } else if (
          normalizeString(backendResult.projectId, "") !== projectId ||
          (workThreadId && normalizeString(backendResult.workThreadId, "") !== workThreadId) ||
          normalizeString(backendResult.threadId, "") !== sessionId ||
          normalizeString(backendResult.profileDigest, "") !== normalizeString(profile?.profileDigest, "")
        ) {
          backendScopeError = "external_backend_scope_mismatch";
        }
      } catch (error) {
        backendScopeError = normalizeString(error?.code || error?.message, "external_backend_unavailable");
      }
    }
    if (!EXTERNAL_PROMOTED_TOOL_SET.has(toolName)) {
      const providerOutput = {
        kind: `${toolName || "external_tool"}_result`,
        status: "blocked",
        blockerCodes: ["external_tool_not_admitted"],
        dynamicMcpActionPerformed: false,
        pluginInstallPerformed: false,
        workspaceMutationStarted: false,
        rawExternalPayloadIncluded: false,
        rawResourceUriIncluded: false,
        rawSecretIncluded: false,
      };
      const resultDigest = sha256(stableStringify(providerOutput));
      const envelope = {
        schema: "direct_external_promoted_tool_result_envelope@1",
        envelopeId: `external_tool_result_${sha256(`${sessionId}:${turnId}:${stableObligationId}:${resultDigest}`).slice(0, 24)}`,
        toolName,
        callId: normalizeString(obligation.callId, ""),
        resultKind: "external_discovery_status",
        status: "blocked",
        blockerCodes: ["external_tool_not_admitted"],
        resultDigest,
        providerOutput,
        contextAdmission: {
          admittedAs: "external_discovery_descriptor_summary",
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
        profile: usableExternalProfile,
        projectId,
        workThreadId,
        threadId: sessionId,
        turnId,
        callId: normalizeString(obligation.callId, ""),
        serverIdentityId,
        resourceUri,
        mimeType: normalizeString(backendResult?.mimeType || args.mimeType || args.contentType, "text/plain"),
        payload: backendScopeError ? "" : backendResult?.payload,
        content: backendScopeError ? "" : backendResult?.content,
        status: backendScopeError ? "blocked" : backendResult ? normalizeString(backendResult.status, "completed") : "unavailable",
        readFreshness: normalizeString(backendResult?.readFreshness, "fresh_external_read"),
        sourceObservedAt: normalizeString(backendResult?.sourceObservedAt, ""),
        payloadArtifactRef: backendResult?.payloadArtifactRef,
        evidenceRefs: backendResult?.evidenceRefs,
        blockerCodes: backendScopeError
          ? [backendScopeError]
          : backendResult
            ? backendResult.blockerCodes
            : ["mcp_resource_payload_backend_unavailable"],
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
      profile: usableExternalProfile,
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
      profile: usableExternalProfile,
      declaration,
      gate,
      projectId,
      workThreadId,
      threadId: sessionId,
      turnId,
      discoveryBackendAvailable: backendScopeError ? false : backendResult ? backendResult.discoveryBackendAvailable !== false : undefined,
      unavailableReason: backendScopeError || backendResult?.unavailableReason,
      discoveryDescriptors: backendScopeError ? [] : backendResult?.discoveryDescriptors,
      resourceDescriptors: backendScopeError ? [] : backendResult?.resourceDescriptors,
      resourceTemplateDescriptors: backendScopeError ? [] : backendResult?.resourceTemplateDescriptors,
      evidenceRefs: backendResult?.evidenceRefs,
    });
    const providerOutput = summarizeExternalDiscoveryResult(toolName, discoveryEnvelope);
    const externalExecutionBlocked = Boolean(backendScopeError) && backendScopeError !== "external_backend_unavailable";
    const envelope = {
      schema: "direct_external_promoted_tool_result_envelope@1",
      envelopeId: `external_tool_result_${sha256(`${sessionId}:${turnId}:${stableObligationId}:${discoveryEnvelope.envelopeDigest}`).slice(0, 24)}`,
      toolName,
      callId: normalizeString(obligation.callId, ""),
      resultKind: "external_discovery_status",
      status: !externalExecutionBlocked && (discoveryEnvelope.status === "completed" || discoveryEnvelope.status === "degraded" || discoveryEnvelope.status === "unavailable")
        ? "ready_for_provider_continuation"
        : "blocked",
      blockerCodes: [...new Set([
        ...(Array.isArray(discoveryEnvelope.blockerCodes) ? discoveryEnvelope.blockerCodes : []),
        ...(externalExecutionBlocked ? [backendScopeError] : []),
      ])],
      resultDigest: normalizeString(discoveryEnvelope.envelopeDigest, ""),
      providerOutput,
      contextAdmission: {
        admittedAs: "external_discovery_descriptor_summary",
        admissionState: discoveryEnvelope.contextAdmission === "blocked" || externalExecutionBlocked ? "blocked" : "admitted",
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
    const envelope = await this.buildExternalPromotedEnvelope(sessionId, turnId, obligation, project);
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
      if (this.isEpistemicLedgerObligation(sessionId, turnId, obligation)) {
        createdCount += await this.emitEpistemicLedgerRequest(
          surfaceSession,
          sessionId,
          turnId,
          obligation,
          project,
        );
        continue;
      }
      if (this.isStatefulExecObligation(obligation)) {
        createdCount += await this.emitStatefulExecRequest(
          surfaceSession,
          sessionId,
          turnId,
          obligation,
          project,
        );
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
      if (this.isNativeSubAgentRuntimeObligation(obligation)) {
        createdCount += await this.emitNativeSubAgentRuntimeRequest(surfaceSession, sessionId, turnId, obligation, project);
        continue;
      }
      if (this.isReadOnlySubAgentStatusObligation(obligation)) {
        createdCount += await this.emitReadOnlySubAgentStatusRequest(surfaceSession, sessionId, turnId, obligation, project);
        continue;
      }
      if (normalizeString(obligation.name, "") === DIRECT_SELF_CONSTITUTION_TOOL_NAME) {
        createdCount += await this.emitSafeResidentUtilityRequest(surfaceSession, sessionId, turnId, obligation, project);
        continue;
      }
      if (!surfaceSession) {
        if (normalizeString(obligation.name, "") !== "read_file") {
          return createdCount;
        }
        const params = this.readOnlyToolRequestParams(obligation, turn, project);
        const loopCapExceeded = Number(params.stepOrdinal || 1) > MAX_READONLY_TOOL_LOOP_STEPS;
        if (params.approvalAvailable && !loopCapExceeded) {
          const grantAuthorization = this.harnessGrantAuthorizationFor(
            sessionId,
            turnId,
            project,
            "read_file",
          );
          if (grantAuthorization.authorized) {
            this.sessionStore.updateToolObligation(sessionId, turnId, obligation.obligationId, {
              approvalAvailable: true,
              authorityState: "grant_auto_approval",
              authorityMode: grantAuthorization.authorityMode,
              harnessGrantId: grantAuthorization.grantId,
              harnessGrantRevision: grantAuthorization.grantRevision,
              approvalPolicy: grantAuthorization.approvalPolicy,
              sandboxMode: grantAuthorization.sandboxMode,
            }, {
              nextTurnState: "tool_waiting",
            });
            await this.approveExecuteAndContinueReadOnlyTool({
              sessionId,
              turnId,
              obligationId: obligation.obligationId,
              project,
              surfaceSession,
              approvedBy: "direct-thread-harness-grant",
            });
            return createdCount;
          }
          this.sessionStore.updateToolObligation(sessionId, turnId, obligation.obligationId, {
            approvalAvailable: true,
            authorityState: "approval_waiting",
          }, {
            nextTurnState: "tool_waiting",
          });
        }
        return createdCount;
      }
      if (this.isSafeResidentUtilityObligation(obligation)) {
        createdCount += await this.emitSafeResidentUtilityRequest(surfaceSession, sessionId, turnId, obligation, project);
        continue;
      }
      if (this.isExternalPromotedObligation(obligation)) {
        createdCount += await this.emitExternalPromotedRequest(surfaceSession, sessionId, turnId, obligation, project);
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
      const grantAuthorization = this.harnessGrantAuthorizationFor(
        sessionId,
        turnId,
        project,
        "read_file",
      );
      if (grantAuthorization.authorized) {
        this.sessionStore.updateToolObligation(sessionId, turnId, obligation.obligationId, {
          approvalAvailable: true,
          authorityState: "grant_auto_approval",
          authorityMode: grantAuthorization.authorityMode,
          harnessGrantId: grantAuthorization.grantId,
          harnessGrantRevision: grantAuthorization.grantRevision,
          approvalPolicy: grantAuthorization.approvalPolicy,
          sandboxMode: grantAuthorization.sandboxMode,
        }, {
          nextTurnState: "tool_waiting",
        });
        await this.approveExecuteAndContinueReadOnlyTool({
          sessionId,
          turnId,
          obligationId: obligation.obligationId,
          project,
          surfaceSession,
          approvedBy: "direct-thread-harness-grant",
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
      const ledgerOnly = continuation.nextToolObligations.every((obligation) =>
        this.isEpistemicLedgerObligation(sessionId, turnId, obligation));
      const agentRuntimeOnly = continuation.nextToolObligations.every((obligation) =>
        this.isNativeSubAgentRuntimeObligation(obligation) || this.isReadOnlySubAgentStatusObligation(obligation));
      if (!agentRuntimeOnly) {
        this.emitNotification(surfaceSession, "warning", {
          threadId: sessionId,
          turnId,
          message: ledgerOnly
            ? "Direct processed a role-compiled epistemic ledger act and continued the provider turn."
            : createdApprovalRequests
              ? normalizeString(options.approvalMessage, "Direct implementation continuation requested another tool. Local approval is required.")
              : normalizeString(options.unavailableMessage, "Direct implementation continuation requested another tool call, but it is not available for approval."),
        });
      }
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
    const fullAccessBinding = this.fullAccessLocalBinding(
      options.sessionId,
      options.turnId,
      options.project || {},
      "read_file",
    );
    if (typeof this.workspaceRequest !== "function" && !fullAccessBinding) {
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
      fullAccess: Boolean(fullAccessBinding),
      approvedBy: normalizeString(options.approvedBy, "local-user"),
    });
    const executed = await executeApprovedReadOnlyToolObligation({
      sessionStore: this.sessionStore,
      sessionId,
      turnId,
      obligationId,
      fullAccess: Boolean(fullAccessBinding),
      workspaceRequest: fullAccessBinding
        ? (method, params) => this.fullAccessLocalEnvironmentExecutor.request(fullAccessBinding, method, params)
        : (method, params) => this.workspaceRequest(project, method, params, this.readOnlyWorkspaceTimeoutMs),
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
    const harnessGrant = this.harnessGrantForTurn(sessionId, turnId, project || {});
    const continuationToolNames = harnessGrant
      ? harnessGrantCapabilityNames(harnessGrant)
      : implementationContinuationToolNames(directStatus, originalUserIntent);
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
      harnessGrant,
      roleLedgerToolBundle:
        this.epistemicLedgerTurnBinding(sessionId, turnId)?.bundle,
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
        fullAccess: Boolean(fullAccessBinding),
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
      allowedResidentSemanticToolNames:
        this.epistemicLedgerTurnBinding(sessionId, turnId)
          ?.bundle?.operationNames || [],
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
    const fullAccessBinding = this.fullAccessLocalBinding(
      options.sessionId,
      options.turnId,
      options.project || {},
      "apply_patch",
    );
    if (typeof this.workspaceRequest !== "function" && !fullAccessBinding) {
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
      approvedBy: normalizeString(options.approvedBy, "local-user"),
    });
    const executed = await executeApprovedPatchApplyObligation({
      sessionStore: this.sessionStore,
      sessionId,
      turnId,
      obligationId,
      clientPatchDecisionId: normalizeString(options.clientPatchDecisionId, ""),
      workspaceRequest: fullAccessBinding
        ? (method, params) => this.fullAccessLocalEnvironmentExecutor.request(fullAccessBinding, method, params)
        : (method, params) => this.workspaceRequest(project, method, params, this.readOnlyWorkspaceTimeoutMs),
    });
    const turn = this.sessionStore.readTurn(sessionId, turnId);
    const currentObligation = this.sessionStore.findToolObligation(sessionId, turnId, obligationId).obligation;
    const parentResponseId = parentResponseIdForToolStep(turn, currentObligation);
    const parentResponseSource = parentResponseSourceForToolStep(currentObligation);
    const stepOrdinal = Number(currentObligation.stepOrdinal || 1) || 1;
    const originalUserIntent = userPromptTextFromTurn(turn);
    const directStatus = this.statusForProject(project || {});
    const harnessGrant = this.harnessGrantForTurn(sessionId, turnId, project || {});
    const continuationToolNames = harnessGrant
      ? harnessGrantCapabilityNames(harnessGrant)
      : implementationContinuationToolNames(directStatus, originalUserIntent);
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
      harnessGrant,
      roleLedgerToolBundle:
        this.epistemicLedgerTurnBinding(sessionId, turnId)?.bundle,
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
      allowedResidentSemanticToolNames:
        this.epistemicLedgerTurnBinding(sessionId, turnId)
          ?.bundle?.operationNames || [],
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
      approvedBy: normalizeString(options.approvedBy, "local-user"),
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
    const harnessGrant = this.harnessGrantForTurn(sessionId, turnId, project || {});
    const continuationToolNames = harnessGrant
      ? harnessGrantCapabilityNames(harnessGrant)
      : commandRepairContinuationToolNames(directStatus, originalUserIntent);
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
      harnessGrant,
      roleLedgerToolBundle:
        this.epistemicLedgerTurnBinding(sessionId, turnId)?.bundle,
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
      allowedResidentSemanticToolNames:
        this.epistemicLedgerTurnBinding(sessionId, turnId)
          ?.bundle?.operationNames || [],
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
      workspaceKind: normalizeString(project.workspace?.kind, ""),
      status: status.status === "ready" ? "ready" : "blocked",
      providerAttachmentCapability: Object.prototype.hasOwnProperty.call(status, "providerAttachmentCapability")
        ? status.providerAttachmentCapability
        : project.providerAttachmentCapability,
    });
    assertDirectAttachmentCapabilityProjectionSafe(projection);
    return projection;
  }

  directAttachmentSubmitPacket(params = {}, context = {}, prompt = "") {
    const attachments = Array.isArray(params.attachmentDrafts) ? params.attachmentDrafts : [];
    const project = context.project || {};
    const sessionId = normalizeString(params.sessionId || params.threadId, "");
    const session = sessionId ? this.sessionStore.readSession(sessionId) : null;
    const capabilityProjection = this.directAttachmentCapability(
      project,
      this.statusForProject(project, { model: session?.model || params.model }),
    );
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

  async resolveDirectAttachmentPayloads(params = {}, context = {}, packet = null) {
    const rows = Array.isArray(packet?.dispositions)
      ? packet.dispositions.filter((row) => row.disposition === "provider_payload")
      : [];
    if (!rows.length) return [];
    if (!this.attachmentPayloadResolver) {
      const error = new Error("Direct provider attachment payload custody is unavailable.");
      error.code = "direct_attachment_payload_resolver_missing";
      throw error;
    }
    const project = context.project || {};
    const projectId = normalizeString(project.id || project.projectId, "");
    const taskId = normalizeString(params.sessionId || params.threadId || context.surfaceSession?.activeThreadId, "");
    if (!projectId || !taskId) {
      const error = new Error("Direct provider attachment payload custody requires an exact task and project.");
      error.code = "direct_attachment_payload_scope_missing";
      throw error;
    }
    const payloads = [];
    for (const row of rows) {
      const draft = (Array.isArray(params.attachmentDrafts) ? params.attachmentDrafts : [])
        .find((candidate) => normalizeString(candidate?.id || candidate?.draftId, "") === row.draftId);
      const resolved = await this.attachmentPayloadResolver({
        project,
        projectId,
        taskId,
        threadId: taskId,
        draftId: row.draftId,
        draft,
        kind: row.kind,
        mimeType: row.mimeType,
        capabilityProjection: packet.capabilityProjection,
        ownerControlled: context.ownerControlled === true,
      });
      this.assertOpen();
      if (!isPlainObject(resolved) || resolved.status === "blocked" || resolved.custody !== "exact") {
        const error = new Error("Direct provider attachment payload did not return exact admitted custody.");
        error.code = "direct_attachment_payload_custody_blocked";
        throw error;
      }
      if (normalizeString(resolved.projectId, projectId) !== projectId ||
          normalizeString(resolved.taskId || resolved.threadId, taskId) !== taskId ||
          normalizeString(resolved.draftId, "") !== row.draftId ||
          normalizeString(resolved.kind, row.kind) !== row.kind ||
          normalizeString(resolved.mimeType, row.mimeType) !== row.mimeType) {
        const error = new Error("Direct provider attachment payload scope does not match the active task.");
        error.code = "direct_attachment_payload_scope_mismatch";
        throw error;
      }
      const base64 = normalizeString(resolved.base64 || resolved.dataBase64 || resolved.payloadBase64, "");
      if (!base64 || resolved.rawPayloadIncluded === true || resolved.rawPathIncluded === true) {
        const error = new Error("Direct provider attachment payload is missing or unsafe.");
        error.code = "direct_attachment_payload_invalid";
        throw error;
      }
      const payloadDigest = sha256(base64);
      if (resolved.payloadDigest && resolved.payloadDigest !== payloadDigest) {
        const error = new Error("Direct provider attachment payload digest mismatch.");
        error.code = "direct_attachment_payload_digest_mismatch";
        throw error;
      }
      payloads.push({
        draftId: row.draftId,
        kind: row.kind,
        mimeType: row.mimeType,
        displayName: row.displayName,
        base64,
        payloadDigest,
        custody: "exact",
        modelVisibility: "provider_input",
      });
    }
    return payloads;
  }

  applyDirectAttachmentPayloads(requestBody = {}, payloads = []) {
    if (!Array.isArray(payloads) || !payloads.length) return requestBody;
    const body = requestBody;
    const message = Array.isArray(body.input) && isPlainObject(body.input[0]) ? body.input[0] : null;
    if (!message) throw new Error("Direct provider attachment input message is unavailable.");
    if (!Array.isArray(message.content)) message.content = [];
    for (const payload of payloads) {
      const content = payload.kind === "image"
        ? {
            type: "input_image",
            image_url: `data:${payload.mimeType};base64,${payload.base64}`,
            detail: "auto",
          }
        : {
            type: "input_file",
            filename: payload.displayName,
            file_data: `data:${payload.mimeType};base64,${payload.base64}`,
          };
      message.content.push(content);
    }
    return body;
  }

  recordDirectAttachmentProviderVisibility(packet = {}, payloads = [], options = {}) {
    if (!isPlainObject(packet) || !Array.isArray(payloads) || !payloads.length) return packet;
    const providerAccepted = options.providerAccepted !== false;
    const modelVisibility = providerAccepted ? "provider_input" : "provider_input_unconfirmed";
    const byDraftId = new Map(payloads.map((payload) => [payload.draftId, payload]));
    packet.transcriptWitnesses = (Array.isArray(packet.transcriptWitnesses) ? packet.transcriptWitnesses : []).map((witness) => {
      const payload = byDraftId.get(witness.draftId);
      if (!payload) return witness;
      return {
        ...witness,
        submitState: providerAccepted ? "bound_to_provider_input" : "provider_input_unconfirmed",
        providerAccepted,
        providerAcceptanceEvidenceRef: providerAccepted
          ? `direct_provider_input_${payload.payloadDigest.slice(0, 24)}`
          : "direct_provider_transport_failed",
        modelVisibility,
      };
    });
    packet.providerPayloads = payloads.map((payload) => ({
      draftId: payload.draftId,
      payloadDigest: payload.payloadDigest,
      modelVisibility,
      rawPayloadIncluded: false,
    }));
    packet.rawPayloadIncluded = false;
    packet.packetDigest = sha256(stableStringify(packet));
    return packet;
  }

  async startTurn(params = {}, context = {}) {
    const sessionId = normalizeString(params.sessionId || params.threadId, "");
    const previousAdmission = this.turnStartAdmissions.get(sessionId) ||
      Promise.resolve();
    const admission = previousAdmission
      .catch(() => null)
      .then(() => this.startTurnWithinAdmission(params, context));
    this.turnStartAdmissions.set(sessionId, admission);
    try {
      return await admission;
    } finally {
      if (this.turnStartAdmissions.get(sessionId) === admission) {
        this.turnStartAdmissions.delete(sessionId);
      }
    }
  }

  async startTurnWithinAdmission(params = {}, context = {}) {
    const project = context.project || {};
    const surfaceSession = context.surfaceSession;
    const sessionId = normalizeString(params.sessionId || params.threadId, "");
    const session = this.sessionStore.readSession(sessionId);
    if (!session) throw new Error(`Direct live text session not found: ${sessionId}`);
    if (!sessionMatchesProject(session, normalizeString(project.id, ""))) {
      const error = new Error("Direct live text session does not belong to the active project.");
      error.code = "direct_session_project_scope_mismatch";
      throw error;
    }
    if (session.importedSessionReadOnly === true) {
      const error = new Error("Imported Direct sessions are read-only; use an explicit checkpoint continuation.");
      error.code = "direct_imported_session_read_only";
      throw error;
    }
    const ownerControlled = context.ownerControlled === true;
    const requestedTurnModel = normalizeString(params.model, "");
    const boundSessionModel = normalizeString(session.model, "") || this.requestedModelForProject(project);
    const model = requestedTurnModel && ownerControlled ? requestedTurnModel : boundSessionModel;
    if (requestedTurnModel && model && requestedTurnModel !== boundSessionModel && !ownerControlled) {
      const error = new Error("The turn model is stale relative to the task runtime binding.");
      error.code = "direct_turn_runtime_binding_stale";
      error.canonicalModel = boundSessionModel;
      throw error;
    }
    const status = this.assertReady(project, { model });
    const clientTurnRequestId = normalizeString(params.clientTurnRequestId, "");
    if (!clientTurnRequestId) {
      const error = new Error("Direct live text turn requires clientTurnRequestId.");
      error.code = "missing_client_turn_request_id";
      throw error;
    }
    if (
      typeof params.instructions !== "undefined" ||
      typeof params.systemPrompt !== "undefined" ||
      typeof params.developerInstructions !== "undefined" ||
      typeof params.compiledAgentContext !== "undefined"
    ) {
      const error = new Error(
        "Direct compiled-agent turns do not accept renderer-supplied instruction bodies.",
      );
      error.code = "direct_compiled_agent_renderer_instruction_rejected";
      throw error;
    }
    if (
      typeof params.epistemicContextDelivery !== "undefined" ||
      typeof params.epistemicContextProjection !== "undefined" ||
      typeof params.providerProjectionText !== "undefined"
    ) {
      const error = new Error(
        "Direct turns do not accept renderer-supplied epistemic context projections.",
      );
      error.code =
        "direct_epistemic_context_delivery_renderer_projection_rejected";
      throw error;
    }
    const compiledAgentContextRef = isPlainObject(
      params.compiledAgentContextRef,
    )
      ? params.compiledAgentContextRef
      : null;
    let compiledAgentContext = null;
    if (compiledAgentContextRef) {
      if (
        !normalizeString(compiledAgentContextRef.id, "") ||
        !normalizeString(compiledAgentContextRef.digest, "") ||
        !this.compiledAgentContextResolver
      ) {
        const error = new Error(
          "Direct compiled-agent context reference cannot be resolved.",
        );
        error.code = "direct_compiled_agent_context_unavailable";
        throw error;
      }
      compiledAgentContext = await this.compiledAgentContextResolver({
        compiledAgentContextRef,
        sessionId,
        projectId: normalizeString(project.id, ""),
      });
      this.assertOpen();
      if (
        !isPlainObject(compiledAgentContext) ||
        compiledAgentContext.schema !== "direct_compiled_agent_context@1" ||
        compiledAgentContext.compiledAgentContextId !==
          compiledAgentContextRef.id ||
        compiledAgentContext.digest !== compiledAgentContextRef.digest
      ) {
        const error = new Error(
          "Direct compiled-agent context reference failed exact resolution.",
        );
        error.code = "direct_compiled_agent_context_resolution_mismatch";
        throw error;
      }
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
    const providerAttachmentPayloads = await this.resolveDirectAttachmentPayloads(
      params,
      context,
      attachmentSubmit.packet,
    );
    const activeTurn = this.activeTurnForSession(session);
    if (activeTurn) {
      const error = new Error(`Direct live text session already has an active turn: ${activeTurn.turnId}`);
      error.code = "active_turn_exists";
      error.activeTurnId = activeTurn.turnId;
      error.status = activeTurn.state;
      throw error;
    }
    const requestedTurnReasoningEffort = normalizeString(
      params.reasoningEffort || params.reasoning_effort || params.effort,
      "",
    );
    const boundSessionReasoningEffort = normalizeString(session.reasoningEffort, "");
    const reasoningEffort = ownerControlled && requestedTurnReasoningEffort
      ? requestedTurnReasoningEffort
      : normalizeString(boundSessionReasoningEffort, requestedTurnReasoningEffort);
    if (
      requestedTurnReasoningEffort &&
      requestedTurnReasoningEffort !== boundSessionReasoningEffort && !ownerControlled
    ) {
      const error = new Error("The turn reasoning effort is stale relative to the task runtime binding.");
      error.code = "direct_turn_runtime_binding_stale";
      error.canonicalReasoningEffort = boundSessionReasoningEffort;
      throw error;
    }
    const requestedServiceTier = normalizeString(params.serviceTier || params.service_tier, "");
    const serviceTier = requestedServiceTier || normalizeString(session.serviceTier, "");
    if (serviceTier && !DIRECT_SERVICE_TIERS.has(serviceTier)) {
      const error = new Error(`Direct service tier is not supported: ${serviceTier}`);
      error.code = "direct_service_tier_unsupported";
      throw error;
    }
    if (requestedServiceTier && !ownerControlled && requestedServiceTier !== session.serviceTier) {
      const error = new Error("The turn service tier is not owner-controlled for this Direct task.");
      error.code = "direct_turn_service_tier_not_owner_controlled";
      throw error;
    }
    const existingTurnIds = this.sessionStore.listTurnIdsFromDisk(session.sessionId);
    const existingTurnCount = existingTurnIds.length;
    const summaries = Array.isArray(session.turns) ? session.turns : [];
    const previousSummary = summaries.length ? summaries[summaries.length - 1] : null;
    const previousTurn = previousSummary?.turnId ? this.sessionStore.readTurn(session.sessionId, previousSummary.turnId) : null;
    const binding = normalizeCodexBinding(project.surfaceBinding?.codex || {});
    const directLiveTier = (binding.runtimeMode === "direct" || binding.runtimeMode === "direct-experimental") &&
      binding.directTransport === "live-text";
    const textOnlyTier = binding.runtimeMode === "direct-experimental" && directLiveTier &&
      binding.directTier === "text-only";
    const implementationTier = directLiveTier &&
      binding.directTier === "implementation-lane";
    const harnessGrant = implementationTier
      ? this.resolveHarnessGrant(project, session)
      : null;
    let activeSubAgentPolicySemanticResult = null;
    if (
      implementationTier &&
      this.activeSubAgentPolicySemanticPreflight
    ) {
      activeSubAgentPolicySemanticResult =
        await this.activeSubAgentPolicySemanticPreflight({
          projectId: normalizeString(project.id, session.projectId),
          threadId: session.sessionId,
          clientRequestId: clientTurnRequestId,
          userText: rawPrompt,
        });
      this.assertOpen();
    }
    const implementationToolNames = implementationTier
      ? implementationInitialPolicyCandidateToolNames(status, prompt, { harnessGrant })
      : [];
    const useRecentDialogue = compiledAgentContext
      ? false
      : existingTurnCount > 0;
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
    let epistemicLedgerTurnBinding = null;
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
          harnessGrant,
        })
      : null;
    let requestBody = implementationTier
        ? buildImplementationToolInitialRequest({
            profileDoc: this.profileDoc,
            model,
            prompt,
            reasoningEffort,
            serviceTier,
            tools: implementationToolComposition.tools,
            toolChoicePolicy: "auto",
          })
      : buildTextOnlyProbeRequest({
          profileDoc: this.profileDoc,
          model,
          prompt,
          reasoningEffort,
          serviceTier,
        });
    const turn = this.sessionStore.createTurn(session.sessionId, {
      input: [{ role: "user", text: prompt }],
      model: requestBody.model,
      reasoningEffort,
      serviceTier,
      clientTurnRequestId,
      requestShape: {
        ...initialDirectTurnRequestShape(requestBody, { implementationTier, useRecentDialogue, toolComposition: implementationToolComposition?.composition }),
        directTurnOwnerControlled: ownerControlled,
        directTurnServiceTier: serviceTier,
        serviceTier,
        ...(activeSubAgentPolicySemanticResult?.settlement
          ? {
              activeSubAgentPolicySemanticSettlementId:
                activeSubAgentPolicySemanticResult.settlement.settlementId,
              activeSubAgentPolicySemanticSettlementDigest:
                activeSubAgentPolicySemanticResult.settlement.digest,
              activeSubAgentPolicySemanticSettlementState:
                activeSubAgentPolicySemanticResult.settlement.state,
            }
          : {}),
      },
    });
    this.rememberClientTurnRequest(session.sessionId, clientTurnRequestId, turn.turnId);
    let contextResult = null;
    let controlledRoutingResult = null;
    let requestShape = null;
    let epistemicContextDeliveryBinding = null;
    let selfConstitutionSnapshot = null;
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
        const roleLedgerLane = [
          "implementation_worker",
          "review_auditor",
        ].includes(normalizeString(session.agentRole, ""))
          ? normalizeString(session.agentRole, "")
          : "implementation_worker";
        const deliveryRoleLane = normalizeString(
          session.agentRole,
          "direct_assistant",
        );
        const deliveryWorkThreadId = normalizeString(
          controlledRoutingResult?.route?.selectedWorkThreadId ||
            workThreadCarrier.workThreadId ||
            session.workThreadId,
          "",
        );
        if (this.epistemicContextDeliveryResolver) {
          const claimedDelivery = await this.epistemicContextDeliveryResolver({
            projectId: session.projectId,
            sessionId: session.sessionId,
            turnId: turn.turnId,
            roleLane: deliveryRoleLane,
            workThreadId: deliveryWorkThreadId,
          });
          this.assertOpen();
          if (claimedDelivery?.projection) {
            epistemicContextDeliveryBinding = claimedDelivery;
          }
        }
        epistemicLedgerTurnBinding = implementationTier && controlledRoutingResult
          ? await this.resolveEpistemicLedgerTurnBinding({
              roleLane: roleLedgerLane,
              project,
              projectId: normalizeString(project.id, session.projectId),
              sessionId: session.sessionId,
              turnId: turn.turnId,
              workThreadId:
                controlledRoutingResult.route?.selectedWorkThreadId,
              workThread: workThreadCarrier.workThread,
              authorityBoundary: workThreadCarrier.authorityBoundary,
              controlledRoutingResult,
              compiledAgentContext,
            })
          : null;
        this.assertOpen();
        this.rememberEpistemicLedgerTurnBinding(
          session.sessionId,
          turn.turnId,
          epistemicLedgerTurnBinding,
        );
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
              roleLedgerToolBundle: epistemicLedgerTurnBinding?.bundle,
              harnessGrant,
            })
          : null;
        selfConstitutionSnapshot = implementationTier
          ? this.compileSelfConstitutionSnapshot({
              project,
              session,
              turnId: turn.turnId,
              model,
              reasoningEffort,
              status,
              toolComposition: implementationToolComposition,
              compiledAgentContext,
              harnessGrant,
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
          requestShape: {
            ...initialDirectTurnRequestShape(requestBody, { implementationTier, useRecentDialogue, toolComposition: implementationToolComposition?.composition }),
            ...selfConstitutionRequestShapeFields(selfConstitutionSnapshot),
          },
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
          compiledAgentContext,
          epistemicContextDelivery:
            epistemicContextDeliveryBinding?.projection || null,
        });
        if (
          epistemicContextDeliveryBinding &&
          this.epistemicContextDeliveryRecorder
        ) {
          const preparedReceipt = await this.epistemicContextDeliveryRecorder({
            projectId: session.projectId,
            admissionId:
              epistemicContextDeliveryBinding.admission.admissionId,
            expectedState: "claimed_for_turn",
            state: "prepared_for_provider",
            turnId: turn.turnId,
            contextBuildId: contextResult.contextPack.contextBuildId,
            requestManifestId:
              contextResult.requestManifest.requestManifestId,
            providerInputProjectionId:
              contextResult.providerInput.projection.providerInputProjectionId,
            providerInputTextHash:
              contextResult.providerInput.projection.providerInputTextHash,
            reason:
              "The admitted projection was persisted in the exact context pack and request manifest.",
          });
          this.assertOpen();
          epistemicContextDeliveryBinding = {
            ...epistemicContextDeliveryBinding,
            preparedReceipt,
            contextBuildId: contextResult.contextPack.contextBuildId,
            requestManifestId:
              contextResult.requestManifest.requestManifestId,
            providerInputProjectionId:
              contextResult.providerInput.projection.providerInputProjectionId,
            providerInputTextHash:
              contextResult.providerInput.projection.providerInputTextHash,
          };
        }
        requestBody = implementationTier
          ? buildImplementationToolInitialRequest({
              profileDoc: this.profileDoc,
              model,
              prompt: contextResult.providerInput.prompt,
              instructions: implementationContextInstructions(
                contextResult.providerInput.instructions,
                selfConstitutionSnapshot,
              ),
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
      if (implementationTier && !selfConstitutionSnapshot) {
        selfConstitutionSnapshot = this.compileSelfConstitutionSnapshot({
          project,
          session,
          turnId: turn.turnId,
          model,
          reasoningEffort,
          status,
          toolComposition: implementationToolComposition,
          compiledAgentContext,
          harnessGrant,
        });
      }
      if (implementationTier) {
        requestBody = buildImplementationToolInitialRequest({
          profileDoc: this.profileDoc,
          model,
          prompt: normalizeString(contextResult?.providerInput?.prompt, prompt),
          instructions: implementationContextInstructions(
            contextResult?.providerInput?.instructions,
            selfConstitutionSnapshot,
          ),
          reasoningEffort,
          tools: implementationToolComposition.tools,
          toolChoicePolicy: "auto",
        });
      }
      this.applyDirectAttachmentPayloads(requestBody, providerAttachmentPayloads);
      requestShape = {
        ...initialDirectTurnRequestShape(requestBody, { implementationTier, useRecentDialogue, toolComposition: implementationToolComposition?.composition }),
        directTurnOwnerControlled: ownerControlled,
        directTurnServiceTier: serviceTier,
        serviceTier,
        ...selfConstitutionRequestShapeFields(selfConstitutionSnapshot),
        ...(activeSubAgentPolicySemanticResult?.settlement
          ? {
              activeSubAgentPolicySemanticSettlementId:
                activeSubAgentPolicySemanticResult.settlement.settlementId,
              activeSubAgentPolicySemanticSettlementDigest:
                activeSubAgentPolicySemanticResult.settlement.digest,
              activeSubAgentPolicySemanticSettlementState:
                activeSubAgentPolicySemanticResult.settlement.state,
              activeSubAgentPolicyRef:
                activeSubAgentPolicySemanticResult.settlement
                  .admittedPolicyRef || null,
            }
          : {}),
        directAttachmentCapabilityProjectionDigest: attachmentSubmit.capabilityProjection.projectionDigest,
        directAttachmentSubmitPacketId: attachmentSubmit.packet.packetId,
        directAttachmentSubmitPacketDigest: attachmentSubmit.packet.packetDigest,
        directAttachmentDraftSetDigest: normalizeString(params.attachmentDraftSetDigest, ""),
        directAttachmentDispositionSummary: attachmentSubmit.packet.summary,
        directAttachmentRawPayloadIncluded: false,
        directAttachmentRawPathIncluded: false,
        directAttachmentProviderPayloadCount: providerAttachmentPayloads.length,
        directAttachmentProviderPayloadDigests: providerAttachmentPayloads.map((payload) => payload.payloadDigest),
        directAttachmentProviderModelVisibility: providerAttachmentPayloads.length ? "provider_input" : "none",
        ...(contextResult ? {
          contextBuildId: contextResult.contextPack.contextBuildId,
          contextPackContentHash: contextResult.contextPack.contextPackContentHash,
          contextPackShapeHash: contextResult.contextPack.contextPackShapeHash,
          requestManifestId: contextResult.requestManifest.requestManifestId,
          providerInputShapeHash: contextResult.providerInput.projection.providerInputShapeHash,
          rawRequestBodyStored: false,
          previousResponseIdUsed: false,
          ...(epistemicContextDeliveryBinding ? {
            epistemicContextDeliveryAdmissionId:
              epistemicContextDeliveryBinding.admission.admissionId,
            epistemicContextDeliveryImportId:
              epistemicContextDeliveryBinding.admission.importRef.id,
            epistemicContextDeliveryProjectionId:
              epistemicContextDeliveryBinding.projection.projectionId,
            epistemicContextDeliveryState: "prepared_for_provider",
            epistemicContextRendererTextAccepted: false,
          } : {}),
        } : {}),
        ...(compiledAgentContext ? {
          compiledAgentContextId:
            compiledAgentContext.compiledAgentContextId,
          compiledAgentContextDigest: compiledAgentContext.digest,
          agentInstantiationId:
            compiledAgentContext.agentInstantiationRef?.id || "",
          rendererInstructionInputAccepted: false,
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
        ...(selfConstitutionSnapshot ? {
          selfConstitutionSnapshot,
        } : {}),
        ...(activeSubAgentPolicySemanticResult?.settlement ? {
          activeSubAgentPolicySemanticSettlement:
            activeSubAgentPolicySemanticResult.settlement,
        } : {}),
        ...(epistemicLedgerTurnBinding ? {
          epistemicLedgerToolBinding: epistemicLedgerTurnBinding,
        } : {}),
        directAttachmentSubmitPacket: attachmentSubmit.packet,
        directAttachmentTranscriptWitnesses: attachmentSubmit.packet.transcriptWitnesses,
        ...(contextResult ? {
          contextBuildId: contextResult.contextPack.contextBuildId,
          requestManifestId: contextResult.requestManifest.requestManifestId,
          contextSummary: contextResult.rendererSafeSummary,
          ...(epistemicContextDeliveryBinding ? {
            epistemicContextDelivery: {
              admissionRef: epistemicContextDeliveryBinding.admission.ref,
              importRef: epistemicContextDeliveryBinding.admission.importRef,
              projectionRef: epistemicContextDeliveryBinding.projection.ref,
              state: "prepared_for_provider",
              grantsAuthority: false,
            },
          } : {}),
        } : {}),
        ...(controlledRoutingResult ? {
          controlledRoutingSliceId: controlledRoutingResult.route.routeId,
          controlledRoutingGateState: controlledRoutingResult.route.gateState,
        } : {}),
      });
    } catch (error) {
      if (
        epistemicContextDeliveryBinding?.admission?.admissionId &&
        this.epistemicContextDeliveryRecorder
      ) {
        try {
          await this.epistemicContextDeliveryRecorder({
            projectId: session.projectId,
            admissionId:
              epistemicContextDeliveryBinding.admission.admissionId,
            expectedStates: ["claimed_for_turn", "prepared_for_provider"],
            state: "failed",
            turnId: turn.turnId,
            errorCode: normalizeString(
              error?.code,
              "direct_epistemic_context_delivery_pre_transport_failed",
            ),
            reason:
              "The turn failed before the admitted context could reach provider transport.",
          });
        } catch {}
      }
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
      providerAttachmentPayloads,
      requestKind: implementationTier ? "implementation_tool_initial" : "text_only",
      model: requestBody.model,
      reasoningEffort,
      serviceTier,
      project,
      surfaceSession,
      userItem,
      abortController,
      epistemicContextDeliveryBinding,
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
      artifactWorkThreadAuthorization:
        params.artifactWorkThreadAuthorization,
      workerPrompt,
      contextRefs: params.contextRefs,
      compiledAgentContextRef:
        params.compiledAgentContextRef,
      threadEnvironmentBindingRef:
        params.threadEnvironmentBindingRef,
      stepEnvironmentSnapshotRef:
        params.stepEnvironmentSnapshotRef,
      environmentSelection:
        params.environmentSelection,
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
      workerStartAuthorityMode: transition.authorityMode,
      artifactWorkThreadAuthorizationId:
        transition.artifactWorkThreadAuthorization?.authorizationId || "",
      artifactWorkThreadAuthorizationDigest:
        transition.artifactWorkThreadAuthorization?.authorizationDigest || "",
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
      compiledAgentContextRef:
        transition.contextPacket
          .compiledAgentContextRef,
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
      providerAttachmentPayloads,
      model,
      reasoningEffort,
      serviceTier,
      project,
      surfaceSession,
      userItem,
      abortController,
      epistemicContextDeliveryBinding,
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
    let epistemicContextDeliveryRecorded = false;
    const callerLifecycle = (event) => {
      if (
        event.phase === "request_attempt" &&
        epistemicContextDeliveryBinding &&
        !epistemicContextDeliveryRecorded
      ) {
        if (!this.epistemicContextDeliveryRecorder) {
          const error = new Error(
            "Direct epistemic context delivery recorder is unavailable.",
          );
          error.code =
            "direct_epistemic_context_delivery_recorder_unavailable";
          throw error;
        }
        const receipt = this.epistemicContextDeliveryRecorder({
          projectId: project.id,
          admissionId:
            epistemicContextDeliveryBinding.admission.admissionId,
          expectedState: "prepared_for_provider",
          state: "provider_transport_attempted",
          turnId,
          contextBuildId: epistemicContextDeliveryBinding.contextBuildId,
          requestManifestId:
            epistemicContextDeliveryBinding.requestManifestId,
          providerInputProjectionId:
            epistemicContextDeliveryBinding.providerInputProjectionId,
          providerInputTextHash:
            epistemicContextDeliveryBinding.providerInputTextHash,
          attempt: Number(event.attempt || 1),
          reason:
            "Provider transport began with the exact persisted input projection.",
        });
        if (receipt && typeof receipt.then === "function") {
          const error = new Error(
            "Direct provider-attempt delivery recording must be synchronous.",
          );
          error.code =
            "direct_epistemic_context_delivery_recorder_async_unsupported";
          throw error;
        }
        epistemicContextDeliveryRecorded = true;
      }
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
      serviceTier,
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
      : await runTextOnlyDirectProbe({
          ...probeOptions,
          requestBody,
        });
    if (Array.isArray(providerAttachmentPayloads) && providerAttachmentPayloads.length) {
      const storedTurn = this.sessionStore.readTurn(sessionId, turnId);
      const packet = storedTurn?.directAttachmentSubmitPacket;
      if (isPlainObject(packet)) {
        const updatedPacket = this.recordDirectAttachmentProviderVisibility(
          packet,
          providerAttachmentPayloads,
          { providerAccepted: result.ok === true },
        );
        this.sessionStore.updateTurnState(sessionId, turnId, storedTurn.state, {
          directAttachmentSubmitPacket: updatedPacket,
          directAttachmentTranscriptWitnesses: updatedPacket.transcriptWitnesses,
        });
      }
    }
    if (
      epistemicContextDeliveryBinding &&
      !epistemicContextDeliveryRecorded &&
      this.epistemicContextDeliveryRecorder
    ) {
      try {
        this.epistemicContextDeliveryRecorder({
          projectId: project.id,
          admissionId:
            epistemicContextDeliveryBinding.admission.admissionId,
          expectedState: "prepared_for_provider",
          state: "failed",
          turnId,
          contextBuildId: epistemicContextDeliveryBinding.contextBuildId,
          requestManifestId:
            epistemicContextDeliveryBinding.requestManifestId,
          providerInputProjectionId:
            epistemicContextDeliveryBinding.providerInputProjectionId,
          providerInputTextHash:
            epistemicContextDeliveryBinding.providerInputTextHash,
          errorCode:
            result?.terminal?.error?.code ||
            result?.error?.code ||
            "direct_epistemic_context_delivery_transport_not_started",
          reason:
            "Provider transport did not reach a request attempt.",
        });
      } catch {}
    }
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
      const ledgerOnly = obligationResult.obligations.every((obligation) =>
        this.isEpistemicLedgerObligation(sessionId, turnId, obligation));
      const agentRuntimeOnly = obligationResult.obligations.every((obligation) =>
        this.isNativeSubAgentRuntimeObligation(obligation) || this.isReadOnlySubAgentStatusObligation(obligation));
      if (!agentRuntimeOnly) {
        this.emitNotification(surfaceSession, "warning", {
          threadId: sessionId,
          turnId,
          message: ledgerOnly
            ? "Direct processed a role-compiled epistemic ledger act and continued the provider turn."
            : createdApprovalRequests
              ? "Direct live text detected a tool call. Local approval is required before local authority is used."
              : "Direct live text detected a tool call, but the required direct tool continuation evidence is not enabled.",
        });
      }
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

  async waitForTurnCompletion(params = {}) {
    const sessionId = normalizeString(params.sessionId || params.threadId, "");
    const turnId = normalizeString(params.turnId, "");
    const turn = this.sessionStore.readTurn(sessionId, turnId);
    if (!turn) {
      const error = new Error(`Direct live text turn not found: ${turnId || "missing"}.`);
      error.code = "direct_turn_not_found";
      throw error;
    }
    const active = this.activeRuns.get(turnId);
    if (active?.promise) return active.promise;
    if (TERMINAL_TURN_STATES.has(turn.state)) {
      return {
        turn: turnSnapshot(turn),
        result: null,
        recoveredFromPersistence: true,
      };
    }
    const error = new Error(
      "Direct live text turn has no active runtime after restart.",
    );
    error.code = "direct_turn_runtime_interrupted";
    error.turnState = turn.state;
    throw error;
  }

  readThread(params = {}, context = {}) {
    const projectId = normalizeString(context.project?.id, "");
    const sessionId = normalizeString(params.sessionId || params.threadId, "");
    const session = this.sessionStore.readSession(sessionId);
    if (!session) throw new Error(`Direct live text session not found: ${sessionId}`);
    if (!sessionMatchesProject(session, projectId)) {
      throw new Error("Direct live text session does not belong to the active project.");
    }
    const projection = this.capabilitiesForTask(context.project || {}, session.sessionId);
    return {
      thread: threadSnapshotFromSession(session),
      model: session.model,
      reasoningEffort: session.reasoningEffort,
      serviceTier: session.serviceTier,
      capabilities: projection.capabilities,
      taskBinding: projection.taskBinding,
    };
  }

  interruptTurn(params = {}, context = {}) {
    const turnId = normalizeString(params.turnId, "");
    const sessionId = normalizeString(params.sessionId || params.threadId, "");
    const turn = turnId && sessionId ? this.sessionStore.readTurn(sessionId, turnId) : null;
    if (!turn) throw new Error(`Direct live text turn not found: ${turnId || "missing"}.`);
    const projectId = normalizeString(context.project?.id, "");
    if (projectId) {
      const session = this.sessionStore.readSession(sessionId);
      if (!session || !sessionMatchesProject(session, projectId)) {
        const error = new Error("Direct interrupt target does not belong to the active project.");
        error.code = "direct_session_project_scope_mismatch";
        throw error;
      }
    }
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
    if (method === "account/login/start") return this.accountLoginStart(params, context);
    if (method === "account/rateLimits/read") return this.rateLimitsRead(params, context);
    if (method === "account/usage/read") return this.usageRead(params, context);
    if (method === "model/list") return this.modelList(params, context);
    if (method === "configRequirements/read") return this.configRequirementsRead(params, context);
    if (method === "environment/status") return this.environmentStatus(params, context);
    if (method === "thread/start") return this.startThread(params, context);
    if (method === "thread/resume") return this.resumeThread(params, context);
    if (method === "thread/fork") return this.forkThread(params, context);
    if (method === "thread/selectAccessProfile") return this.selectFullAccessTaskProfile(params, context);
    if (method === "thread/list") return this.listThreads(params, context);
    if (method === "thread/read") return this.readThread(params, context);
    if (method === "thread/rollback") return this.rollbackThread(params, context);
    if (method === "exec_command") return this.startStatefulExec(params, context);
    if (method === "write_stdin") return this.writeStatefulExecStdin(params, context);
    if (method === "exec_command/cancel") return this.cancelStatefulExec(params, context);
    if (method === "exec_command/wait") return this.waitStatefulExec(params, context);
    if (method === "turn/start") return this.startTurn(params, context);
    if (method === "turn/steer") return this.steerTurn(params, context);
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
    this.activeThreadId = "";
    this.taskCapabilityProjection = null;
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
    const connectedTaskId = normalizeString(connection.taskBinding?.taskId, "");
    if (connectedTaskId) this.activeThreadId = connectedTaskId;
    const projection = this.activeThreadId && this.controller?.capabilitiesForTask
      ? this.controller.capabilitiesForTask(this.project || {}, this.activeThreadId)
      : null;
    const status = projection?.directLiveText || this.controller?.statusForProject?.(this.project || {}) || {};
    this.connection = {
      ...connection,
      transport: DIRECT_LIVE_TEXT_SURFACE_TRANSPORT,
      connectionId: this.connectionId,
      capabilities: projection?.capabilities || connection.capabilities || buildDirectLiveTextCapabilities(status),
      directLiveText: status,
      taskBinding: projection?.taskBinding || connection.taskBinding || null,
    };
    this.taskCapabilityProjection = projection;
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
      const requestMethod = String(method || "");
      const result = await this.controller.handleRequest(requestMethod, params || {}, {
        project: this.project,
        surfaceSession: this,
        connection: this.connection,
        ownerControlled: true,
      });
      if (requestMethod === "initialize" || requestMethod === "thread/start" || requestMethod === "thread/resume" || requestMethod === "thread/fork" || requestMethod === "thread/selectAccessProfile" || requestMethod === "thread/read" || requestMethod === "thread/rollback" || requestMethod === "exec_command") {
        const taskId = normalizeString(
          requestMethod === "exec_command"
            ? params?.taskId || params?.threadId || this.activeThreadId
            : result?.thread?.id || result?.thread?.threadId || params?.sessionId || params?.threadId,
          "",
        );
        if (taskId) {
          this.activeThreadId = taskId;
          this.taskCapabilityProjection = this.controller.capabilitiesForTask
            ? this.controller.capabilitiesForTask(this.project || {}, taskId)
            : null;
          if (this.taskCapabilityProjection) {
            this.connection = {
              ...(this.connection || {}),
              capabilities: this.taskCapabilityProjection.capabilities,
              directLiveText: this.taskCapabilityProjection.directLiveText,
              taskBinding: this.taskCapabilityProjection.taskBinding,
            };
            this.emitStatus("connected");
          }
        }
        if (!taskId) return result;
        return {
          ...(isPlainObject(result) ? result : { result }),
          capabilities: this.taskCapabilityProjection?.capabilities || result?.capabilities,
        };
      }
      return result;
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
    this.activeThreadId = "";
    this.taskCapabilityProjection = null;
  }
}

module.exports = {
  DIRECT_LIVE_TEXT_SURFACE_TRANSPORT,
  DirectLiveTextController,
  DirectLiveTextSurfaceSession,
  buildDirectLiveTextCapabilities,
  composeImplementationToolBundleForRequest,
  implementationInitialPolicyCandidateToolNames,
  modelEvidenceFor,
};
