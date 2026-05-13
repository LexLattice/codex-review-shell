"use strict";

const crypto = require("node:crypto");
const { DIRECT_TURN_STATES } = require("../session/session-store");
const { workspaceEffectRecoveryState } = require("../workspace/mutation-truth");

const DIRECT_RECOVERY_REPORT_SCHEMA = "direct_recovery_report@1";
const DIRECT_RECOVERY_SCANNER_VERSION = "direct-recovery-scanner@1";
const DIRECT_OPERATION_LEDGER_EVENT_VERSION = 1;

const ZERO_RECOVERY_SENTINEL_COUNTERS = Object.freeze({
  providerTransportCalls: 0,
  appServerSpawnCalls: 0,
  rightPaneMutationCalls: 0,
  handoffMutationCalls: 0,
  fileReadCalls: 0,
  patchApplyCalls: 0,
  commandRunCalls: 0,
  continuationSendCalls: 0,
});

const EVENT_FAMILIES = new Set([
  "initial_request",
  "tool_obligation",
  "read_file",
  "apply_patch",
  "run_command",
  "continuation",
  "recovery",
]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (isPlainObject(value)) {
    const output = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] !== undefined && key !== "eventDigest") output[key] = stableValue(value[key]);
    }
    return output;
  }
  return value;
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function digestValue(value) {
  return crypto.createHash("sha256").update(stableJson(value)).digest("hex");
}

function createZeroRecoverySentinelCounters() {
  return { ...ZERO_RECOVERY_SENTINEL_COUNTERS };
}

function sentinelCountersAreZero(counters = {}) {
  return Object.keys(ZERO_RECOVERY_SENTINEL_COUNTERS).every((key) => Number(counters[key] || 0) === 0);
}

function normalizeCounters(counters = {}) {
  const output = createZeroRecoverySentinelCounters();
  for (const key of Object.keys(output)) output[key] = Math.max(0, Number(counters[key] || 0) || 0);
  return output;
}

function authorityKindForObligation(obligation = {}) {
  const name = normalizeString(obligation.name, "").replace(/-/g, "_");
  if (name === "apply_patch") return "apply_patch";
  if (name === "run_command") return "run_command";
  if (name === "read_file" || name === "readfile") return "read_file";
  if (name) return "unsupported_tool";
  return "none";
}

function activeObligation(turn = {}) {
  const obligations = Array.isArray(turn.unresolvedObligations) ? turn.unresolvedObligations : [];
  if (!obligations.length) return null;
  const activeId = normalizeString(turn.activeToolStepId, "");
  if (activeId) {
    const byStep = obligations.find((obligation) => obligation?.stepId === activeId);
    if (byStep) return byStep;
  }
  return obligations[obligations.length - 1] || null;
}

function latestContinuationRequest(turn = {}, obligation = {}) {
  if (isPlainObject(obligation.continuationRequest)) return obligation.continuationRequest;
  const requests = Array.isArray(turn.continuationRequests) ? turn.continuationRequests : [];
  const matching = requests.filter((request) => request?.obligationId === obligation?.obligationId);
  return matching[matching.length - 1] || null;
}

function latestResult(turn = {}, obligation = {}) {
  if (isPlainObject(obligation.result)) return obligation.result;
  const results = Array.isArray(turn.toolResults) ? turn.toolResults : [];
  const matching = results.filter((result) => result?.obligationId === obligation?.obligationId);
  return matching[matching.length - 1] || null;
}

function hasAssistantText(turn = {}) {
  if (Number(turn.assistantTextCharCount || 0) > 0) return true;
  if (normalizeString(turn.assistantPreview, "")) return true;
  const messages = Array.isArray(turn.messages) ? turn.messages : [];
  return messages.some((message) =>
    normalizeString(message?.role, "") === "assistant" && normalizeString(message?.text || message?.content, ""),
  );
}

function requestControlsState(request = {}) {
  if (!isPlainObject(request)) return "not_required";
  const controls = isPlainObject(request.requestControls) ? request.requestControls : {};
  const features = isPlainObject(request.enabledFeatures) ? request.enabledFeatures : {};
  const store = controls.store === false || features.store === false;
  const parallelToolCalls = controls.parallelToolCalls === false || controls.parallel_tool_calls === false || features.parallelToolCalls === false;
  const toolDeclarations = controls.toolDeclarations === false || features.toolDeclarations === false;
  const toolOutputItem = controls.toolOutputItem === true || features.toolOutputItem === true || isPlainObject(request.toolResult);
  const previousResponseId = controls.previousResponseId === true || features.previousResponseId === true || Boolean(request.toolLoop?.parentResponseId || request.previousResponse?.id);
  return store && parallelToolCalls && toolDeclarations && toolOutputItem && previousResponseId
    ? "valid"
    : "schema_mismatch";
}

function validateLedgerEvents(events = []) {
  const list = Array.isArray(events) ? events : [];
  if (!list.length) {
    return {
      status: "not_present",
      eventCount: 0,
      lastDigest: "",
      problem: "",
    };
  }
  let previousDigest = "";
  const seenSeq = new Set();
  for (let index = 0; index < list.length; index += 1) {
    const event = list[index] || {};
    const seq = Number(event.ledgerSeq || 0);
    if (event.eventVersion !== DIRECT_OPERATION_LEDGER_EVENT_VERSION) {
      return { status: "schema_mismatch", eventCount: list.length, lastDigest: previousDigest, problem: "event_version" };
    }
    if (!EVENT_FAMILIES.has(normalizeString(event.eventFamily, ""))) {
      return { status: "schema_mismatch", eventCount: list.length, lastDigest: previousDigest, problem: "event_family" };
    }
    if (seq !== index + 1 || seenSeq.has(seq)) {
      return { status: "ledger_gap", eventCount: list.length, lastDigest: previousDigest, problem: "ledger_seq" };
    }
    seenSeq.add(seq);
    if (normalizeString(event.previousLedgerDigest, "") !== previousDigest) {
      return { status: "digest_mismatch", eventCount: list.length, lastDigest: previousDigest, problem: "previous_digest" };
    }
    const expectedDigest = digestValue({ ...event, eventDigest: undefined });
    if (normalizeString(event.eventDigest, "") !== expectedDigest) {
      return { status: "digest_mismatch", eventCount: list.length, lastDigest: previousDigest, problem: "event_digest" };
    }
    previousDigest = expectedDigest;
  }
  return {
    status: "valid",
    eventCount: list.length,
    lastDigest: previousDigest,
    problem: "",
  };
}

function buildLedgerEvent(input = {}, previousLedgerDigest = "") {
  const event = {
    eventVersion: DIRECT_OPERATION_LEDGER_EVENT_VERSION,
    ledgerSeq: Math.max(1, Number(input.ledgerSeq || 1) || 1),
    eventFamily: normalizeString(input.eventFamily, "recovery"),
    eventType: normalizeString(input.eventType, "recovery_fixture_event"),
    createdAt: normalizeString(input.createdAt, new Date(0).toISOString()),
    sessionId: normalizeString(input.sessionId, ""),
    turnId: normalizeString(input.turnId, ""),
    obligationId: normalizeString(input.obligationId, ""),
    artifactRefs: isPlainObject(input.artifactRefs) ? input.artifactRefs : {},
    previousLedgerDigest,
  };
  return {
    ...event,
    eventDigest: digestValue(event),
  };
}

function buildLedgerSequence(events = []) {
  let previousLedgerDigest = "";
  return events.map((event, index) => {
    const built = buildLedgerEvent({ ...event, ledgerSeq: index + 1 }, previousLedgerDigest);
    previousLedgerDigest = built.eventDigest;
    return built;
  });
}

function patchJournalStateFor(obligation = {}, result = {}) {
  const safeResult = isPlainObject(result) ? result : {};
  const journal = isPlainObject(safeResult.journal) ? safeResult.journal : (isPlainObject(obligation.patchJournal) ? obligation.patchJournal : {});
  const status = normalizeString(journal.status || obligation.patchApplyState || obligation.authorityState, "");
  if (!status && !isPlainObject(obligation.patchPlan)) return "not_applicable";
  if (status === "applied") return "applied_verified";
  if (status === "apply_failed" || status === "failed") return "apply_failed_verified";
  if (status === "partial_unknown") return "partial_unknown";
  if (status === "applying" || status === "patch_approved") return "applying";
  if (status === "journal_corrupt") return "journal_corrupt";
  return "planned_only";
}

function commandWorkspaceEffectStateFor(result = {}) {
  if (!isPlainObject(result) || result.tool !== "run_command") return "not_applicable";
  const effectRecoveryState = workspaceEffectRecoveryState(result);
  if (effectRecoveryState === "effect_summary_missing") return "scan_missing";
  if (effectRecoveryState === "effect_summary_corrupt") return "scan_failed";
  if (effectRecoveryState === "effect_summary_scan_failed") return "scan_failed";
  if (isPlainObject(result.workspaceEffectSummary)) {
    if (result.workspaceEffectSummary.scan?.scanFailed === true) return "scan_failed";
    if (Number(result.workspaceEffectSummary.changedPathCount || 0) > 0) return "changes_detected";
    if (result.workspaceEffectSummary.scan?.supported === false) return "scan_missing";
    return "scan_passed";
  }
  const effects = isPlainObject(result.workspaceEffects) ? result.workspaceEffects : {};
  if (!Object.keys(effects).length) return "scan_missing";
  if (effects.scanFailed === true) return "scan_failed";
  if (Number(effects.changedPathCount || 0) > 0) return "changes_detected";
  if (normalizeString(effects.scanScope, "none") === "none") return "scan_missing";
  return "scan_passed";
}

function providerHandoffStateFor(turn = {}, obligation = {}, continuationRequest = {}) {
  const hint = isPlainObject(turn.recoveryHints) ? turn.recoveryHints : {};
  if (normalizeString(hint.providerHandoffState, "")) return hint.providerHandoffState;
  if (turn.state === "streaming_continuation") return "stream_interrupted";
  if (turn.state === "streaming") return "bytes_observed";
  if (turn.state === "completed") return "completed";
  if (turn.state === "failed") return "failed";
  if (turn.state === "transport_handoff_unknown") return "sent_no_bytes";
  if (turn.state === "continuation_sent" || obligation.status === "continuation_sent") {
    if (obligation.continuationBytesObserved === true || continuationRequest?.bytesObserved === true) return "bytes_observed";
    return "sent_no_bytes";
  }
  if (turn.state === "continuation_ready" || obligation.status === "continuation_built") return "request_built";
  if (turn.contextBuildId || obligation.continuationContextId) return "context_built";
  return "not_started";
}

function providerContinuationSeenByModelFor(providerHandoffState, providerTerminalKind) {
  if (providerTerminalKind === "completed_with_assistant_text") return "terminal_completed";
  if (["failed", "incomplete", "completed_empty", "tool_call_blocked", "unknown_event_blocked"].includes(providerTerminalKind)) {
    return "terminal_failed";
  }
  if (["bytes_observed", "stream_interrupted", "completed"].includes(providerHandoffState)) return "bytes_observed";
  if (providerHandoffState === "sent_no_bytes") return "maybe_handoff_unknown";
  return "no";
}

function providerTerminalKindFor(turn = {}) {
  const hint = isPlainObject(turn.recoveryHints) ? normalizeString(turn.recoveryHints.providerTerminalKind, "") : "";
  if (hint) return hint;
  if (turn.state === "completed") return hasAssistantText(turn) ? "completed_with_assistant_text" : "completed_empty";
  if (turn.state === "response_incomplete" || turn.state === "content_filter_terminal" || turn.state === "max_output_terminal") return "incomplete";
  if (turn.state === "empty_output_terminal") return "completed_empty";
  if (turn.state === "tool_call_blocked_text_only") return "tool_call_blocked";
  if (turn.state === "failed" || turn.state === "aborted") return "failed";
  return "not_terminal";
}

function responseChainStateFor(turn = {}, obligation = {}, continuationRequest = {}) {
  const stepOrdinal = Number(obligation.stepOrdinal || turn.activeToolStepOrdinal || 0);
  if (stepOrdinal <= 1) return "not_required";
  if (!normalizeString(obligation.parentResponseId || continuationRequest?.toolLoop?.parentResponseId, "")) return "missing_parent_response";
  const chain = Array.isArray(turn.toolLoopResponseChain) ? turn.toolLoopResponseChain : [];
  if (!chain.length) return "chain_broken";
  const entry = chain.find((item) => Number(item?.stepOrdinal || 0) === stepOrdinal - 1);
  if (!entry) return "chain_broken";
  if (normalizeString(entry.continuationResponseId, "") !== normalizeString(obligation.parentResponseId, "")) {
    return "parent_response_digest_mismatch";
  }
  return "valid";
}

function sideEffectStateAfterDecision(authorityKind, recoveryState) {
  if (authorityKind === "apply_patch") return "patch_planned_only";
  if (authorityKind === "read_file") return "read_maybe_executed_no_result";
  if (authorityKind !== "run_command") return "none";
  if (recoveryState === "command_completed_no_result") return "command_ran";
  if (recoveryState.startsWith("command_")) return "command_may_have_run";
  return "none";
}

function sideEffectStateForRecordedResult(authorityKind, hasResult = true) {
  if (authorityKind === "apply_patch") return "workspace_patch_applied";
  if (authorityKind === "run_command") return "command_ran";
  if (authorityKind === "read_file" && hasResult) return "read_evidence_recorded";
  return "none";
}

function stepRefFor(turn = {}, obligation = {}) {
  if (!obligation) return null;
  return {
    loopId: normalizeString(obligation.toolLoopId || turn.toolLoopId, ""),
    stepId: normalizeString(obligation.stepId || turn.activeToolStepId, ""),
    stepOrdinal: Number(obligation.stepOrdinal || turn.activeToolStepOrdinal || 0),
    parentResponseIdEvidenceKey: normalizeString(obligation.parentResponseDigest, ""),
    previousStepId: normalizeString(obligation.previousStepId, ""),
    nextStepExpected: obligation.nextStepExpected === true,
  };
}

function classifyByObligation(turn = {}, obligation = {}, context = {}) {
  const authorityKind = authorityKindForObligation(obligation);
  const status = normalizeString(obligation.status, "");
  const result = latestResult(turn, obligation);
  const continuationRequest = latestContinuationRequest(turn, obligation);
  const hasResult = isPlainObject(result);
  const hasContinuation = isPlainObject(continuationRequest);
  const providerHandoffState = providerHandoffStateFor(turn, obligation, continuationRequest);
  const providerTerminalKind = providerTerminalKindFor(turn);
  const requestControls = hasContinuation ? requestControlsState(continuationRequest) : "not_required";

  let recoveryState = "healthy";
  let sideEffectState = "none";
  let manualActionKind = "inspect_only";
  let composerAllowed = false;
  let composerAllowedReason = "disabled_manual_recovery_required";
  let recoveryConfidence = "exact";
  let artifactDurabilityState = "all_required_present";

  if (["waiting", "collecting_arguments", "patch_planned", "command_planned"].includes(status)) {
    recoveryState = status === "collecting_arguments" ? "collecting_tool_call" : "waiting_for_user";
    sideEffectState = status === "patch_planned" ? "patch_planned_only" : "none";
    manualActionKind = "await_user_decision";
    composerAllowedReason = "waiting_for_user_decision";
  } else if (["approved", "patch_approved", "command_approved"].includes(status)) {
    if (authorityKind === "run_command" && obligation.commandExecutionState === "completed") {
      recoveryState = "command_completed_no_result";
    } else if (authorityKind === "run_command" && (obligation.commandStartedAt || obligation.commandExecutionState === "running")) {
      recoveryState = "command_started_no_terminal";
    } else {
      recoveryState = "decision_committed_no_result";
    }
    sideEffectState = sideEffectStateAfterDecision(authorityKind, recoveryState);
    manualActionKind = "manual_recovery_required";
    composerAllowedReason = recoveryState === "command_started_no_terminal" ? "disabled_side_effect_incomplete" : "disabled_manual_recovery_required";
    recoveryConfidence = recoveryState === "command_started_no_terminal" ? "conservative_from_partial" : "exact";
  } else if (hasResult && !hasContinuation) {
    recoveryState = obligation.continuationContextId || obligation.continuationContextBuiltAt
      ? "context_built_no_manifest"
      : "result_recorded_no_context";
    sideEffectState = sideEffectStateForRecordedResult(authorityKind, true);
    manualActionKind = "inspect_only";
    composerAllowedReason = authorityKind === "read_file" ? "disabled_manual_recovery_required" : "disabled_side_effect_incomplete";
  } else if (hasContinuation && !["continuation_sent", "streaming_continuation", "completed", "failed"].includes(turn.state)) {
    recoveryState = "request_built_not_sent";
    sideEffectState = sideEffectStateForRecordedResult(authorityKind, true);
    manualActionKind = "inspect_only";
    composerAllowedReason = authorityKind === "read_file" ? "disabled_manual_recovery_required" : "disabled_side_effect_incomplete";
  } else if (providerHandoffState === "sent_no_bytes") {
    recoveryState = "continuation_sent_no_bytes";
    sideEffectState = sideEffectStateForRecordedResult(authorityKind, true);
    manualActionKind = "manual_recovery_required";
    composerAllowedReason = "disabled_provider_handoff_unknown";
    recoveryConfidence = "conservative_from_partial";
  } else if (providerHandoffState === "stream_interrupted") {
    recoveryState = "stream_interrupted";
    sideEffectState = sideEffectStateForRecordedResult(authorityKind, true);
    manualActionKind = "manual_recovery_required";
    composerAllowedReason = "disabled_provider_handoff_unknown";
    recoveryConfidence = "conservative_from_partial";
  } else if (providerTerminalKind === "completed_with_assistant_text") {
    recoveryState = "terminal";
    sideEffectState = sideEffectStateForRecordedResult(authorityKind, hasResult);
    manualActionKind = "start_new_turn";
    composerAllowed = true;
    composerAllowedReason = "safe_terminal";
  } else if (providerTerminalKind !== "not_terminal") {
    recoveryState = "terminal";
    sideEffectState = sideEffectStateForRecordedResult(authorityKind, hasResult);
    manualActionKind = "inspect_only";
    composerAllowedReason = "disabled_manual_recovery_required";
  }

  const patchJournalState = authorityKind === "apply_patch" ? patchJournalStateFor(obligation, result) : "not_applicable";
  const workspaceEffectState = workspaceEffectRecoveryState(result);
  if (authorityKind === "apply_patch" && workspaceEffectState === "effect_summary_missing" && hasResult) {
    recoveryState = "patch_applied_effect_summary_missing";
    artifactDurabilityState = "required_missing";
    recoveryConfidence = "conservative_from_partial";
    composerAllowed = false;
    composerAllowedReason = "disabled_side_effect_incomplete";
  }
  if (authorityKind === "run_command" && workspaceEffectState === "effect_summary_missing" && hasResult) {
    recoveryState = "command_ran_effect_summary_missing";
    artifactDurabilityState = "required_missing";
    recoveryConfidence = "conservative_from_partial";
    composerAllowed = false;
    composerAllowedReason = "disabled_side_effect_incomplete";
  }
  if (workspaceEffectState === "effect_summary_corrupt") {
    recoveryState = "corrupt";
    artifactDurabilityState = "digest_mismatch";
    recoveryConfidence = "corrupt_untrusted";
    composerAllowed = false;
    composerAllowedReason = "disabled_corrupt";
  }
  if (patchJournalState === "applied_verified" && !hasResult) {
    recoveryState = "patch_applied_no_result";
    sideEffectState = "workspace_patch_applied";
    composerAllowed = false;
    composerAllowedReason = "disabled_side_effect_incomplete";
    recoveryConfidence = "exact";
  }
  if (patchJournalState === "partial_unknown" || patchJournalState === "applying" || patchJournalState === "journal_corrupt") {
    recoveryState = patchJournalState === "journal_corrupt" ? "corrupt" : "patch_partial_unknown";
    sideEffectState = "workspace_patch_partial_unknown";
    composerAllowed = false;
    composerAllowedReason = patchJournalState === "journal_corrupt" ? "disabled_corrupt" : "disabled_partial_unknown";
    recoveryConfidence = patchJournalState === "journal_corrupt" ? "corrupt_untrusted" : "conservative_from_partial";
  }

  if (requestControls === "schema_mismatch") {
    artifactDurabilityState = "schema_mismatch";
    recoveryState = "corrupt";
    composerAllowed = false;
    composerAllowedReason = "disabled_corrupt";
    recoveryConfidence = "corrupt_untrusted";
  }

  const ledger = validateLedgerEvents(turn.operationLedgerEvents);
  if (["ledger_gap", "digest_mismatch", "schema_mismatch"].includes(ledger.status)) {
    artifactDurabilityState = ledger.status;
    recoveryState = "corrupt";
    composerAllowed = false;
    composerAllowedReason = "disabled_corrupt";
    recoveryConfidence = "corrupt_untrusted";
  }

  const responseChainState = responseChainStateFor(turn, obligation, continuationRequest);
  if (["missing_parent_response", "parent_response_digest_mismatch", "chain_broken"].includes(responseChainState)) {
    artifactDurabilityState = "digest_mismatch";
    recoveryState = "corrupt";
    composerAllowed = false;
    composerAllowedReason = "disabled_corrupt";
    recoveryConfidence = "corrupt_untrusted";
  }

  if (context.rawExposureBlocked === true) {
    recoveryState = "raw_exposure_blocked";
    artifactDurabilityState = "unreadable";
    composerAllowed = false;
    composerAllowedReason = "disabled_corrupt";
    recoveryConfidence = "corrupt_untrusted";
  }

  return {
    recoveryState,
    sideEffectState,
    providerHandoffState,
    providerContinuationSeenByModel: providerContinuationSeenByModelFor(providerHandoffState, providerTerminalKind),
    providerTerminalKind,
    responseChainState,
    artifactDurabilityState,
    recoveryConfidence,
    authorityKind,
    stepRef: stepRefFor(turn, obligation),
    patchJournalState,
    workspaceEffectRecoveryState: workspaceEffectState,
    commandWorkspaceEffectState: authorityKind === "run_command" ? commandWorkspaceEffectStateFor(result) : "not_applicable",
    autoRetryAllowed: false,
    autoReexecuteAllowed: false,
    composerAllowed,
    composerAllowedReason,
    manualActionKind,
    actionAvailability: {
      suggested: manualActionKind,
      enabledInThisPR: false,
      requiresFutureSpec: manualActionKind === "manual_recovery_required" ? "manual_resume" : "",
    },
    integrity: {
      ledger,
      requestControls,
    },
  };
}

function classifyTextOnlyTurn(turn = {}, context = {}) {
  const providerHandoffState = providerHandoffStateFor(turn, {}, {});
  const providerTerminalKind = providerTerminalKindFor(turn);
  let recoveryState = "healthy";
  let composerAllowed = false;
  let composerAllowedReason = "disabled_manual_recovery_required";
  let manualActionKind = "inspect_only";
  let recoveryConfidence = "exact";
  let artifactDurabilityState = "all_required_present";

  if (turn.state === "continuation_sent" || turn.state === "transport_handoff_unknown") {
    recoveryState = "sent_no_bytes";
    composerAllowedReason = "disabled_provider_handoff_unknown";
    recoveryConfidence = "conservative_from_partial";
    manualActionKind = "manual_recovery_required";
  } else if (turn.state === "streaming" || turn.state === "streaming_continuation") {
    recoveryState = "stream_interrupted";
    composerAllowedReason = "disabled_provider_handoff_unknown";
    recoveryConfidence = "conservative_from_partial";
    manualActionKind = "manual_recovery_required";
  } else if (providerTerminalKind === "completed_with_assistant_text") {
    recoveryState = "terminal";
    composerAllowed = true;
    composerAllowedReason = "safe_terminal";
    manualActionKind = "start_new_turn";
  } else if (providerTerminalKind !== "not_terminal") {
    recoveryState = "terminal";
    composerAllowedReason = "disabled_manual_recovery_required";
  }

  const ledger = validateLedgerEvents(turn.operationLedgerEvents);
  if (["ledger_gap", "digest_mismatch", "schema_mismatch"].includes(ledger.status)) {
    artifactDurabilityState = ledger.status;
    recoveryState = "corrupt";
    composerAllowed = false;
    composerAllowedReason = "disabled_corrupt";
    recoveryConfidence = "corrupt_untrusted";
  }
  if (context.rawExposureBlocked === true) {
    recoveryState = "raw_exposure_blocked";
    artifactDurabilityState = "unreadable";
    composerAllowed = false;
    composerAllowedReason = "disabled_corrupt";
    recoveryConfidence = "corrupt_untrusted";
  }

  return {
    recoveryState,
    sideEffectState: "none",
    providerHandoffState,
    providerContinuationSeenByModel: providerContinuationSeenByModelFor(providerHandoffState, providerTerminalKind),
    providerTerminalKind,
    responseChainState: "not_required",
    artifactDurabilityState,
    recoveryConfidence,
    authorityKind: "text_only",
    stepRef: null,
    patchJournalState: "not_applicable",
    commandWorkspaceEffectState: "not_applicable",
    autoRetryAllowed: false,
    autoReexecuteAllowed: false,
    composerAllowed,
    composerAllowedReason,
    manualActionKind,
    actionAvailability: {
      suggested: manualActionKind,
      enabledInThisPR: false,
      requiresFutureSpec: manualActionKind === "manual_recovery_required" ? "manual_resume" : "",
    },
    integrity: {
      ledger,
      requestControls: "not_required",
    },
  };
}

function classifyDirectTurnRecovery(input = {}) {
  const session = isPlainObject(input.session) ? input.session : {};
  const turn = isPlainObject(input.turn) ? input.turn : {};
  if (normalizeString(turn.schema, "") !== "direct_codex_turn@1") {
    return {
      schema: "direct_recovery_classification@1",
      sessionId: normalizeString(input.sessionId || session.sessionId, ""),
      turnId: normalizeString(input.turnId || turn.turnId, ""),
      recoveryState: "corrupt",
      sideEffectState: "unknown",
      providerHandoffState: "unknown",
      providerContinuationSeenByModel: "no",
      providerTerminalKind: "unknown_event_blocked",
      responseChainState: "unknown",
      artifactDurabilityState: "schema_mismatch",
      recoveryConfidence: "corrupt_untrusted",
      authorityKind: "unknown",
      autoRetryAllowed: false,
      autoReexecuteAllowed: false,
      composerAllowed: false,
      composerAllowedReason: "disabled_corrupt",
      manualActionKind: "manual_recovery_required",
      actionAvailability: {
        suggested: "manual_recovery_required",
        enabledInThisPR: false,
        requiresFutureSpec: "repair",
      },
      safeRendererMessage: "Direct recovery could not classify this turn because required artifacts are unavailable.",
    };
  }
  const state = normalizeString(turn.state, "");
  if (!DIRECT_TURN_STATES.has(state)) {
    return {
      ...classifyTextOnlyTurn({ ...turn, state: "failed" }, input),
      schema: "direct_recovery_classification@1",
      sessionId: normalizeString(session.sessionId || turn.sessionId, ""),
      turnId: normalizeString(turn.turnId, ""),
      recoveryState: "corrupt",
      artifactDurabilityState: "schema_mismatch",
      recoveryConfidence: "corrupt_untrusted",
      composerAllowed: false,
      composerAllowedReason: "disabled_corrupt",
    };
  }

  const obligation = input.obligation || activeObligation(turn);
  const base = obligation
    ? classifyByObligation(turn, obligation, input)
    : classifyTextOnlyTurn(turn, input);
  return {
    schema: "direct_recovery_classification@1",
    scannerVersion: DIRECT_RECOVERY_SCANNER_VERSION,
    sessionId: normalizeString(session.sessionId || turn.sessionId, ""),
    turnId: normalizeString(turn.turnId, ""),
    turnState: state,
    sourceOfTruth: "authority_artifacts_and_operation_ledger",
    rendererProjectionIsAuthority: false,
    ...base,
    safeRendererMessage: safeRendererMessage(base),
  };
}

function safeRendererMessage(classification = {}) {
  if (classification.recoveryState === "corrupt") return "Direct recovery found inconsistent local artifacts. Manual inspection is required; no retry or replay was attempted.";
  if (classification.sideEffectState === "workspace_patch_partial_unknown") return "Patch state is partially unknown. No apply or provider continuation was retried.";
  if (classification.sideEffectState === "workspace_patch_applied" && classification.providerContinuationSeenByModel !== "terminal_completed") {
    return "Patch was applied locally, but assistant continuation did not complete. No provider retry was attempted.";
  }
  if (classification.sideEffectState === "command_may_have_run") return "Command may have run locally. No command rerun or provider retry was attempted.";
  if (classification.sideEffectState === "command_ran" && classification.providerContinuationSeenByModel !== "terminal_completed") {
    return "Command ran locally, but assistant continuation did not complete. No command rerun or provider retry was attempted.";
  }
  if (classification.providerHandoffState === "sent_no_bytes") return "Provider handoff is ambiguous. Automatic retry is disabled.";
  if (classification.recoveryState === "waiting_for_user") return "A direct tool request is waiting for a fresh user decision.";
  if (classification.composerAllowed) return "Direct turn is safely terminal.";
  return "Direct recovery classified this turn for inspection only. Manual resume is not implemented in this PR.";
}

function scanDirectSessionRecovery(input = {}) {
  const sessionStore = input.sessionStore;
  if (!sessionStore) throw new Error("scanDirectSessionRecovery requires a direct session store.");
  const session = sessionStore.readSession(input.sessionId);
  if (!session) {
    return {
      sessionId: normalizeString(input.sessionId, ""),
      status: "missing",
      classifications: [],
    };
  }
  const turnIds = new Set([
    ...(Array.isArray(session.turns) ? session.turns.map((summary) => summary?.turnId).filter(Boolean) : []),
    ...sessionStore.listTurnIdsFromDisk(session.sessionId),
  ]);
  const classifications = [...turnIds].map((turnId) => {
    const turn = sessionStore.readTurn(session.sessionId, turnId);
    return classifyDirectTurnRecovery({ session, turn });
  });
  return {
    sessionId: session.sessionId,
    status: "classified",
    classifications,
  };
}

function validateDirectRecoveryReport(report = {}) {
  if (!isPlainObject(report) || report.schema !== DIRECT_RECOVERY_REPORT_SCHEMA) {
    throw new Error("Invalid direct recovery report schema.");
  }
  if (report.coverageSource !== "fixture_recovery") throw new Error("Recovery report must be fixture-only.");
  if (report.matrixPromotionCandidate !== false) throw new Error("Recovery report must not promote matrix rows.");
  if (!Array.isArray(report.cases)) throw new Error("Recovery report cases must be an array.");
  for (const entry of report.cases) {
    if (!entry.classification || entry.classification.autoRetryAllowed !== false || entry.classification.autoReexecuteAllowed !== false) {
      throw new Error(`Recovery case ${entry.caseId || "unknown"} permits retry/reexecute.`);
    }
    if (!sentinelCountersAreZero(entry.sentinelCounters || {})) {
      throw new Error(`Recovery case ${entry.caseId || "unknown"} has non-zero sentinel counters.`);
    }
  }
  return true;
}

module.exports = {
  DIRECT_OPERATION_LEDGER_EVENT_VERSION,
  DIRECT_RECOVERY_REPORT_SCHEMA,
  DIRECT_RECOVERY_SCANNER_VERSION,
  ZERO_RECOVERY_SENTINEL_COUNTERS,
  buildLedgerEvent,
  buildLedgerSequence,
  classifyDirectTurnRecovery,
  createZeroRecoverySentinelCounters,
  normalizeCounters,
  scanDirectSessionRecovery,
  sentinelCountersAreZero,
  validateDirectRecoveryReport,
};
