"use strict";

const crypto = require("node:crypto");

const DIRECT_IMPLEMENTATION_REPAIR_LOOP_SCHEMA = "direct_implementation_repair_loop@1";
const DIRECT_IMPLEMENTATION_REPAIR_STEP_SCHEMA = "direct_implementation_repair_step@1";
const DIRECT_IMPLEMENTATION_TRANSITION_GRAPH_SCHEMA = "direct_implementation_transition_graph@1";
const DIRECT_IMPLEMENTATION_REPAIR_REPORT_SCHEMA = "direct_iterative_repair_report@1";
const DIRECT_IMPLEMENTATION_REPAIR_POLICY_VERSION = "direct-implementation-repair-loop@1";

const REPAIR_TOOL_NAMES = Object.freeze(["read_file", "apply_patch", "run_command"]);
const DEFAULT_REPAIR_CAPS = Object.freeze({
  maxTotalSteps: 12,
  maxReadFileSteps: 8,
  maxPatchSteps: 3,
  maxCommandSteps: 3,
  maxRepeatedCanonicalReadPathCount: 2,
  maxProviderToolOutputCharsTotal: 384 * 1024,
  maxPatchChangedFilesTotal: 20,
  maxPatchAddedLinesTotal: 1200,
  maxPatchRemovedLinesTotal: 1200,
  maxCommandRuntimeMsTotal: 180_000,
  maxCommandWorkspaceChangedPathsTotal: 50,
});

const TERMINAL_STATES_WITHOUT_FRESH_TURN = new Set([
  "empty_output",
  "response_incomplete",
  "content_filter_terminal",
  "max_output_terminal",
  "stream_interrupted",
  "transport_handoff_unknown",
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
      if (value[key] !== undefined) output[key] = stableValue(value[key]);
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

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function repairLoopIdForTurn(sessionId, turnId) {
  return `repair_loop_${sha256(`${normalizeString(sessionId, "")}:${normalizeString(turnId, "")}:implementation_repair_loop`).slice(0, 20)}`;
}

function canonicalRepairToolName(name) {
  const text = normalizeString(name, "").replace(/-/g, "_");
  if (text === "readfile") return "read_file";
  if (REPAIR_TOOL_NAMES.includes(text)) return text;
  return "";
}

function isSupportedRepairToolName(name) {
  return Boolean(canonicalRepairToolName(name));
}

function continuationOutcomeForToolName(name) {
  const tool = canonicalRepairToolName(name);
  if (tool === "read_file") return "next_read_file_step";
  if (tool === "apply_patch") return "next_apply_patch_step";
  if (tool === "run_command") return "next_run_command_step";
  return "unsupported_tool_call";
}

function createRepairCounters() {
  return {
    totalSteps: 0,
    readFileSteps: 0,
    patchSteps: 0,
    commandSteps: 0,
    providerToolOutputCharsTotal: 0,
    patchChangedFilesTotal: 0,
    patchAddedLinesTotal: 0,
    patchRemovedLinesTotal: 0,
    commandRuntimeMsTotal: 0,
    commandWorkspaceChangedPathsTotal: 0,
    repeatedCanonicalReadPathCounts: {},
  };
}

function toolCounterKey(tool) {
  if (tool === "read_file") return "readFileSteps";
  if (tool === "apply_patch") return "patchSteps";
  if (tool === "run_command") return "commandSteps";
  return "";
}

function summarizeRepairCounters(turn = {}, nextTool = "") {
  const counters = createRepairCounters();
  const obligations = Array.isArray(turn.unresolvedObligations) ? turn.unresolvedObligations : [];
  for (const obligation of obligations) {
    const tool = canonicalRepairToolName(obligation?.name);
    if (!tool) continue;
    counters.totalSteps += 1;
    const key = toolCounterKey(tool);
    if (key) counters[key] += 1;
    const result = isPlainObject(obligation.result) ? obligation.result : {};
    counters.providerToolOutputCharsTotal += Number(result.providerOutputChars || result.providerOutputText?.length || 0) || 0;
    if (tool === "apply_patch") {
      const files = Array.isArray(result.files) ? result.files : [];
      counters.patchChangedFilesTotal += files.length;
      for (const file of files) {
        counters.patchAddedLinesTotal += Number(file?.addedLineCount || 0) || 0;
        counters.patchRemovedLinesTotal += Number(file?.removedLineCount || 0) || 0;
      }
    }
    if (tool === "run_command") {
      counters.commandRuntimeMsTotal += Number(result.durationMs || 0) || 0;
      counters.commandWorkspaceChangedPathsTotal += Number(
        result.workspaceEffectSummary?.changedPathCount ||
        result.workspaceEffects?.changedPathCount ||
        0,
      ) || 0;
    }
    if (tool === "read_file") {
      const relPath = normalizeString(result.canonicalEvidenceKey || result.relPath || obligation.approvedRead?.relPath, "");
      if (relPath) {
        counters.repeatedCanonicalReadPathCounts[relPath] = Number(counters.repeatedCanonicalReadPathCounts[relPath] || 0) + 1;
      }
    }
  }
  const tool = canonicalRepairToolName(nextTool);
  if (tool) {
    counters.totalSteps += 1;
    const key = toolCounterKey(tool);
    if (key) counters[key] += 1;
  }
  return counters;
}

function capFailureForCounters(counters = {}, caps = DEFAULT_REPAIR_CAPS) {
  if (Number(counters.totalSteps || 0) > caps.maxTotalSteps) return "repair_loop_cap_exceeded";
  if (Number(counters.readFileSteps || 0) > caps.maxReadFileSteps) return "repair_loop_cap_exceeded";
  if (Number(counters.patchSteps || 0) > caps.maxPatchSteps) return "repair_loop_cap_exceeded";
  if (Number(counters.commandSteps || 0) > caps.maxCommandSteps) return "repair_loop_cap_exceeded";
  if (Number(counters.providerToolOutputCharsTotal || 0) > caps.maxProviderToolOutputCharsTotal) return "provider_tool_output_cap_exceeded";
  if (Number(counters.patchChangedFilesTotal || 0) > caps.maxPatchChangedFilesTotal) return "repair_loop_cap_exceeded";
  if (Number(counters.patchAddedLinesTotal || 0) > caps.maxPatchAddedLinesTotal) return "repair_loop_cap_exceeded";
  if (Number(counters.patchRemovedLinesTotal || 0) > caps.maxPatchRemovedLinesTotal) return "repair_loop_cap_exceeded";
  if (Number(counters.commandRuntimeMsTotal || 0) > caps.maxCommandRuntimeMsTotal) return "command_timed_out";
  if (Number(counters.commandWorkspaceChangedPathsTotal || 0) > caps.maxCommandWorkspaceChangedPathsTotal) {
    return "command_workspace_change_cap_exceeded";
  }
  for (const count of Object.values(counters.repeatedCanonicalReadPathCounts || {})) {
    if (Number(count || 0) > caps.maxRepeatedCanonicalReadPathCount) return "repair_loop_cap_exceeded";
  }
  return "";
}

function buildTransitionGraph(input = {}) {
  const providerToolSetDigest = normalizeString(input.providerToolSetDigest, "") || digestValue(REPAIR_TOOL_NAMES);
  const allowedEdges = [];
  for (const from of ["initial", ...REPAIR_TOOL_NAMES]) {
    allowedEdges.push({ from, to: "assistant_final", requiresApproval: false, requiresContinuation: false });
    for (const to of REPAIR_TOOL_NAMES) {
      allowedEdges.push({ from, to, requiresApproval: true, requiresContinuation: true });
    }
  }
  const graph = {
    schema: DIRECT_IMPLEMENTATION_TRANSITION_GRAPH_SCHEMA,
    graphId: DIRECT_IMPLEMENTATION_REPAIR_LOOP_SCHEMA,
    allowedTools: [...REPAIR_TOOL_NAMES],
    providerToolSetDigest,
    declaredToolSchemasDigest: normalizeString(input.declaredToolSchemasDigest, ""),
    allowedEdges,
    blockedEdges: [
      { code: "patch_delete_deferred", appliesToTool: "apply_patch", reason: "Patch delete remains out of scope for PR 3." },
      { code: "multiple_tool_calls_unsupported", reason: "PR 3 supports exactly one active provider tool call at a time." },
      { code: "parallel_tool_call_attempted", reason: "Parallel tool calls are disabled." },
      { code: "unsupported_tool_call", reason: "Only read_file, apply_patch, and run_command are supported." },
    ],
    version: DIRECT_IMPLEMENTATION_REPAIR_POLICY_VERSION,
  };
  return {
    ...graph,
    digest: digestValue(graph),
  };
}

function defaultPolicySnapshot(input = {}) {
  const transitionGraph = input.transitionGraph || buildTransitionGraph(input);
  return {
    allowedTools: [...REPAIR_TOOL_NAMES],
    sensitivePathPolicyDigest: normalizeString(input.sensitivePathPolicyDigest, "sensitive_path_policy_default@1"),
    commandPolicyDigest: normalizeString(input.commandPolicyDigest, "command_policy_package_scripts@1"),
    patchPolicyDigest: normalizeString(input.patchPolicyDigest, "patch_policy_create_update_only@1"),
    capPolicyDigest: normalizeString(input.capPolicyDigest, "repair_caps_default@1"),
    networkRiskPolicyDigest: normalizeString(input.networkRiskPolicyDigest, "network_helpers_blocked_not_sandboxed@1"),
    transitionGraphDigest: transitionGraph.digest,
    providerToolSetDigest: transitionGraph.providerToolSetDigest,
    declaredToolSchemasDigest: normalizeString(transitionGraph.declaredToolSchemasDigest, ""),
  };
}

function sideEffectStateFromTurn(turn = {}) {
  const obligations = Array.isArray(turn.unresolvedObligations) ? turn.unresolvedObligations : [];
  let read = false;
  let patch = false;
  let command = false;
  let commandChanged = false;
  for (const obligation of obligations) {
    const tool = canonicalRepairToolName(obligation?.name);
    if (!isPlainObject(obligation?.result)) continue;
    if (tool === "read_file") read = true;
    if (tool === "apply_patch") patch = true;
    if (tool === "run_command") {
      command = true;
      commandChanged = commandChanged || Number(
        obligation.result.workspaceEffectSummary?.changedPathCount ||
        obligation.result.workspaceEffects?.changedPathCount ||
        0,
      ) > 0;
    }
  }
  if (patch && command) return "workspace_patch_and_command_effects";
  if (patch) return "workspace_patch_applied";
  if (command) return commandChanged ? "command_ran_workspace_changes_detected" : "command_ran_no_workspace_changes_detected";
  if (read) return "read_evidence_only";
  return "none";
}

function buildRepairLoopForTurn(turn = {}, input = {}) {
  const caps = {
    ...DEFAULT_REPAIR_CAPS,
    ...(isPlainObject(input.caps) ? input.caps : {}),
  };
  const transitionGraph = input.transitionGraph || buildTransitionGraph(input);
  const counters = summarizeRepairCounters(turn);
  const loopId = normalizeString(turn.repairLoop?.loopId, repairLoopIdForTurn(turn.sessionId, turn.turnId));
  const activeStepOrdinal = Number(turn.activeToolStepOrdinal || counters.totalSteps || 0) || 0;
  return {
    schema: DIRECT_IMPLEMENTATION_REPAIR_LOOP_SCHEMA,
    loopId,
    projectId: normalizeString(input.projectId || turn.projectId, ""),
    sessionId: normalizeString(turn.sessionId, ""),
    turnId: normalizeString(turn.turnId, ""),
    tier: "implementation-lane",
    status: normalizeString(input.status || turn.repairLoop?.status, turn.state === "completed" ? "completed_final_assistant" : "waiting_for_user"),
    localWorkflowState: normalizeString(input.localWorkflowState || turn.repairLoop?.localWorkflowState, "waiting_for_user_approval"),
    providerHandoffState: normalizeString(input.providerHandoffState || turn.repairLoop?.providerHandoffState, "not_started"),
    sideEffectState: sideEffectStateFromTurn(turn),
    currentStepId: normalizeString(turn.activeToolStepId || input.currentStepId, ""),
    currentStepOrdinal: activeStepOrdinal,
    stepCount: counters.totalSteps,
    terminalKind: normalizeString(input.terminalKind || turn.repairLoop?.terminalKind, ""),
    createdAt: normalizeString(turn.repairLoop?.createdAt || turn.createdAt, ""),
    updatedAt: normalizeString(input.updatedAt || turn.updatedAt, ""),
    caps,
    counters,
    responseChain: Array.isArray(turn.toolLoopResponseChain) ? turn.toolLoopResponseChain : [],
    policySnapshot: defaultPolicySnapshot({ ...input, transitionGraph }),
    noAutoRetry: true,
    noAutoApproval: true,
    appServerFallbackUsed: false,
    rightPaneMutationUsed: false,
    handoffMutationUsed: false,
  };
}

function evaluateNextRepairTool(input = {}) {
  const turn = isPlainObject(input.turn) ? input.turn : {};
  const obligations = Array.isArray(input.obligations) ? input.obligations : [];
  const caps = { ...DEFAULT_REPAIR_CAPS, ...(isPlainObject(input.caps) ? input.caps : {}) };
  if (obligations.length !== 1) {
    return { ok: false, outcome: "multiple_tool_calls_unsupported", terminalKind: "multiple_tool_calls_unsupported", blockerCode: "multiple_tool_calls_unsupported" };
  }
  const obligation = obligations[0] || {};
  const tool = canonicalRepairToolName(obligation.name);
  if (!tool) {
    return { ok: false, outcome: "unsupported_tool_call", terminalKind: "unsupported_tool_call", blockerCode: "unsupported_tool_call" };
  }
  const namespace = normalizeString(obligation.namespace, "");
  if (namespace) {
    return { ok: false, outcome: "unsupported_tool_call", terminalKind: "unsupported_tool_call", blockerCode: "unsupported_tool_namespace" };
  }
  if (obligation.completedAtSequence === null || obligation.completedAtSequence === undefined) {
    return { ok: false, outcome: "invalid_tool_arguments", terminalKind: "invalid_tool_arguments", blockerCode: "invalid_tool_arguments" };
  }
  const argumentsText = normalizeString(obligation.argumentsText, "");
  if (!argumentsText) {
    return { ok: false, outcome: "invalid_tool_arguments", terminalKind: "invalid_tool_arguments", blockerCode: "invalid_tool_arguments" };
  }
  if (tool === "apply_patch" && /deleted file mode|\+\+\+ \/dev\/null/.test(argumentsText)) {
    return { ok: false, outcome: "unsupported_tool_call", terminalKind: "patch_delete_deferred", blockerCode: "patch_delete_deferred" };
  }
  const turnObligationIds = new Set((Array.isArray(turn.unresolvedObligations) ? turn.unresolvedObligations : [])
    .map((entry) => normalizeString(entry?.obligationId, ""))
    .filter(Boolean));
  const nextAlreadyInTurn = turnObligationIds.has(normalizeString(obligation.obligationId, ""));
  const counters = summarizeRepairCounters(turn, nextAlreadyInTurn ? "" : tool);
  const capFailure = capFailureForCounters(counters, caps);
  if (capFailure) {
    return { ok: false, outcome: "repair_loop_cap_exceeded", terminalKind: capFailure, blockerCode: capFailure, counters };
  }
  return {
    ok: true,
    tool,
    outcome: continuationOutcomeForToolName(tool),
    terminalKind: "",
    blockerCode: "",
    counters,
  };
}

function annotateContinuationRequestForRepairLoop(request = {}, input = {}) {
  const turn = isPlainObject(input.turn) ? input.turn : {};
  const transitionGraph = input.transitionGraph || buildTransitionGraph(input);
  const repairLoop = buildRepairLoopForTurn(turn, { ...input, transitionGraph });
  const stepOrdinal = Number(request.toolLoop?.stepOrdinal || input.stepOrdinal || 1) || 1;
  const stepId = normalizeString(request.toolLoop?.stepId || input.stepId, "");
  const resultArtifactId = normalizeString(request.toolResult?.metadata?.resultId || input.resultArtifactId, "");
  const lineage = {
    repairLoopId: repairLoop.loopId,
    stepId,
    stepOrdinal,
    parentResponseProofDigest: sha256(request.toolLoop?.parentResponseId || request.source?.previousResponseId || ""),
    resultArtifactId,
    previousStepIds: (Array.isArray(turn.unresolvedObligations) ? turn.unresolvedObligations : [])
      .map((obligation) => normalizeString(obligation?.stepId, ""))
      .filter(Boolean)
      .filter((id) => id !== stepId),
    loopCountersDigest: digestValue(repairLoop.counters),
  };
  return {
    ...request,
    repairLoop: {
      schema: DIRECT_IMPLEMENTATION_REPAIR_LOOP_SCHEMA,
      loopId: repairLoop.loopId,
      stepId,
      stepOrdinal,
      transitionGraphDigest: transitionGraph.digest,
      providerToolSetDigest: transitionGraph.providerToolSetDigest,
      declaredToolSchemasDigest: normalizeString(transitionGraph.declaredToolSchemasDigest, ""),
      lineage,
      policySnapshot: repairLoop.policySnapshot,
    },
    continuationPolicy: {
      harnessPolicyDigest: normalizeString(input.harnessPolicyDigest, "harness_policy_direct_repair_loop_v1"),
      roleMappingDigest: normalizeString(input.roleMappingDigest, "role_mapping_direct_repair_loop_v1"),
      toolContinuationPolicyDigest: normalizeString(input.toolContinuationPolicyDigest, "tool_continuation_policy_direct_repair_loop_v1"),
      transitionGraphDigest: transitionGraph.digest,
      resentOnEveryContinuation: true,
    },
  };
}

function recoveryBlocksRepairAction(classification = {}) {
  const state = normalizeString(classification.recoveryState, "");
  const sideEffectState = normalizeString(classification.sideEffectState, "");
  const handoffState = normalizeString(classification.providerHandoffState, "");
  return (
    state === "corrupt" ||
    state === "raw_exposure_blocked" ||
    sideEffectState === "workspace_patch_partial_unknown" ||
    sideEffectState === "command_may_have_run" ||
    handoffState === "sent_no_bytes" ||
    handoffState === "stream_interrupted"
  );
}

function freshTurnBlockedAfterTerminalKind(terminalKind) {
  return TERMINAL_STATES_WITHOUT_FRESH_TURN.has(normalizeString(terminalKind, ""));
}

function validateRepairReport(report = {}) {
  if (!isPlainObject(report) || report.schema !== DIRECT_IMPLEMENTATION_REPAIR_REPORT_SCHEMA) {
    throw new Error("Invalid direct iterative repair report schema.");
  }
  if (!Array.isArray(report.cases)) throw new Error("Direct iterative repair report cases must be an array.");
  for (const entry of report.cases) {
    if (entry.coverageSource !== "real_provider" && entry.matrixPromotionCandidate === true) {
      throw new Error(`Fixture/non-real case ${entry.caseId || "unknown"} cannot promote matrix rows.`);
    }
    if (Array.isArray(entry.matrixRowsExercised) && entry.matrixRowsExercised.includes("D18") && !entry.transitionGraphDigest) {
      throw new Error(`Case ${entry.caseId || "unknown"} exercises D18 without a transition graph digest.`);
    }
  }
  return true;
}

module.exports = {
  DEFAULT_REPAIR_CAPS,
  DIRECT_IMPLEMENTATION_REPAIR_LOOP_SCHEMA,
  DIRECT_IMPLEMENTATION_REPAIR_POLICY_VERSION,
  DIRECT_IMPLEMENTATION_REPAIR_REPORT_SCHEMA,
  DIRECT_IMPLEMENTATION_REPAIR_STEP_SCHEMA,
  DIRECT_IMPLEMENTATION_TRANSITION_GRAPH_SCHEMA,
  REPAIR_TOOL_NAMES,
  annotateContinuationRequestForRepairLoop,
  buildRepairLoopForTurn,
  buildTransitionGraph,
  canonicalRepairToolName,
  continuationOutcomeForToolName,
  defaultPolicySnapshot,
  evaluateNextRepairTool,
  freshTurnBlockedAfterTerminalKind,
  isSupportedRepairToolName,
  recoveryBlocksRepairAction,
  repairLoopIdForTurn,
  summarizeRepairCounters,
  validateRepairReport,
};
