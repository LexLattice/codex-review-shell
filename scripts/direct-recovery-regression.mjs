#!/usr/bin/env node

import { createRequire } from "node:module";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const { scanFixtureForSecrets } = require("../src/main/direct/fixtures/redaction");
const {
  DirectSessionStore,
  writeJsonAtomic,
} = require("../src/main/direct/session/session-store");
const {
  DIRECT_RECOVERY_REPORT_SCHEMA,
  DIRECT_RECOVERY_SCANNER_VERSION,
  buildLedgerSequence,
  classifyDirectTurnRecovery,
  createZeroRecoverySentinelCounters,
  validateDirectRecoveryReport,
} = require("../src/main/direct/recovery/recovery-scanner");

const USER_DATA_ROOT_ENV_VAR = "CODEX_REVIEW_SHELL_USER_DATA_ROOT";

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function nowIso() {
  return new Date().toISOString();
}

function safeIdPart(value, fallback = "case") {
  return normalizeString(value, fallback).replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80) || fallback;
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) throw new Error(`Unknown argument: ${arg}`);
    const raw = arg.slice(2);
    const equals = raw.indexOf("=");
    if (equals >= 0) {
      options[raw.slice(0, equals)] = raw.slice(equals + 1);
      continue;
    }
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      options[raw] = next;
      index += 1;
    } else {
      options[raw] = true;
    }
  }
  return options;
}

function optionString(options, key, fallback = "") {
  return normalizeString(options[key], fallback);
}

function platformAppDataRoot() {
  if (process.platform === "win32") return process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support");
  return process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
}

function defaultAppUserDataRoot() {
  return path.join(platformAppDataRoot(), "Codex Review Shell");
}

function ensureDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
}

function writeTextFile(targetPath, text) {
  ensureDirectory(path.dirname(targetPath));
  fs.writeFileSync(targetPath, text, { mode: 0o600 });
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function providerParentId(caseId) {
  return `resp_${sha256(caseId).slice(0, 18)}`;
}

function requestControls() {
  return {
    store: false,
    parallelToolCalls: false,
    toolDeclarations: false,
    toolOutputItem: true,
    previousResponseId: true,
    nativePreviousResponseIdProof: true,
  };
}

function toolArgs(toolName) {
  if (toolName === "apply_patch") {
    return JSON.stringify({ patch: "diff --git a/src/demo.txt b/src/demo.txt\n--- a/src/demo.txt\n+++ b/src/demo.txt\n@@ -1 +1 @@\n-before\n+after\n" });
  }
  if (toolName === "run_command") {
    return JSON.stringify({ command: "npm", args: ["test"], cwd: "." });
  }
  return JSON.stringify({ path: "src/demo.txt" });
}

function toolEvent(caseId, toolName) {
  return {
    type: "tool_call_completed",
    sequence: 1,
    itemId: `item_${safeIdPart(caseId)}`,
    callId: `call_${safeIdPart(caseId)}`,
    name: toolName,
    namespace: "",
    toolType: "function_call",
    argumentsJson: toolArgs(toolName),
  };
}

function resultFor(toolName, obligation, caseId, options = {}) {
  if (toolName === "apply_patch") {
    return {
      schema: "direct_codex_patch_apply_result@1",
      resultId: `patch_result_${safeIdPart(caseId)}`,
      obligationId: obligation.obligationId,
      tool: "apply_patch",
      status: "applied",
      resultClass: "patch_applied",
      patchPlanId: `patch_plan_${safeIdPart(caseId)}`,
      files: [{ path: "src/demo.txt", operation: "update", addedLineCount: 1, removedLineCount: 1 }],
      providerOutputText: JSON.stringify({ kind: "apply_patch_result", status: "applied", rawPathsExposed: false }),
      providerOutputChars: 76,
      appliedAt: nowIso(),
      sideEffectExecuted: true,
      rawWorkspacePathExposed: false,
      rawPatchIncluded: false,
      journal: {
        journalId: `patch_journal_${safeIdPart(caseId)}`,
        status: options.journalStatus || "applied",
      },
    };
  }
  if (toolName === "run_command") {
    const workspaceEffects = options.omitWorkspaceEffects
      ? undefined
      : {
          changedPathCount: 0,
          changedPathsPreview: [],
          changedPathsTruncated: false,
          scanScope: "workspace-index",
          scanFailed: false,
        };
    return {
      schema: "direct_codex_command_execution_result@1",
      resultId: `command_result_${safeIdPart(caseId)}`,
      obligationId: obligation.obligationId,
      tool: "run_command",
      status: "completed_exit_zero",
      resultClass: "completed_exit_zero",
      commandPlanId: `command_plan_${safeIdPart(caseId)}`,
      displayCommand: "npm test",
      cwdRelPath: ".",
      exitCode: 0,
      signal: "",
      durationMs: 120,
      stdout: { byteCount: 12, truncated: false, hashMode: "none" },
      stderr: { byteCount: 0, truncated: false, hashMode: "none" },
      workspaceEffects,
      commandOutputRedaction: { scanned: true, status: "passed", providerOutputAllowed: true },
      providerOutputText: JSON.stringify({ kind: "run_command_result", status: "completed_exit_zero", rawPathsExposed: false }),
      providerOutputChars: 91,
      providerContinuationBlocked: false,
      recordedAt: nowIso(),
      sideEffectExecuted: true,
      commandExecutionState: "completed_exit_zero",
      commandContinuationState: "not_built",
      rawWorkspacePathExposed: false,
      rawCommandOutputHashExposed: false,
    };
  }
  return {
    schema: "direct_codex_readonly_tool_result@1",
    resultId: `read_result_${safeIdPart(caseId)}`,
    obligationId: obligation.obligationId,
    tool: "read_file",
    status: "completed",
    resultClass: "text_preview_untruncated",
    relPath: "src/demo.txt",
    size: 28,
    truncated: false,
    binary: false,
    textPreview: "fixture file preview",
    providerOutputText: JSON.stringify({ kind: "read_file_result", path: "src/demo.txt", truncated: false }),
    providerOutputChars: 70,
    recordedAt: nowIso(),
    sideEffectExecuted: false,
    rawWorkspacePathExposed: false,
  };
}

function continuationRequestFor(toolName, obligation, result, caseId) {
  const schema = toolName === "apply_patch"
    ? "direct_codex_patch_apply_continuation_request@1"
    : (toolName === "run_command" ? "direct_codex_command_execution_continuation_request@1" : "direct_codex_readonly_tool_continuation_request@1");
  return {
    schema,
    continuationId: `continuation_${safeIdPart(caseId)}`,
    sessionId: obligation.sessionId,
    turnId: obligation.turnId,
    obligationId: obligation.obligationId,
    createdAt: nowIso(),
    source: {
      fromRecordedResult: true,
      recordedResultId: result.resultId,
      recordedAt: normalizeString(result.recordedAt || result.appliedAt, nowIso()),
      approvedAt: normalizeString(obligation.approvedAt, nowIso()),
    },
    toolLoop: {
      toolLoopId: obligation.toolLoopId,
      stepId: obligation.stepId,
      stepOrdinal: Number(obligation.stepOrdinal || 1),
      parentResponseId: obligation.parentResponseId,
      parentResponseSource: obligation.parentResponseSource,
      parentResponseDigest: obligation.parentResponseDigest,
    },
    toolResult: {
      obligationId: obligation.obligationId,
      callId: obligation.callId,
      itemId: obligation.sourceItemId,
      toolCallId: obligation.callId,
      name: toolName,
      providerCallType: obligation.providerCallType,
      outputType: "function_call_output",
      content: [{ type: "function_call_output", text: result.providerOutputText || "{}" }],
      metadata: {
        resultId: result.resultId,
        status: result.status,
      },
    },
    safety: {
      fromRecordedResult: true,
      originalRequestRetried: false,
      sideEffectExecuted: toolName !== "read_file",
      workspaceBackendOnly: true,
      continuationLiveSendEnabled: false,
    },
    requestControls: requestControls(),
    rawAuthHeadersExposed: false,
    rawBackendRequestsExposed: false,
    rawBackendFramesExposed: false,
  };
}

function ledgerFor(sessionId, turnId, obligationId, stages) {
  return buildLedgerSequence(stages.map((stage) => ({
    eventFamily: stage.family,
    eventType: stage.type,
    createdAt: nowIso(),
    sessionId,
    turnId,
    obligationId,
    artifactRefs: stage.refs || {},
  })));
}

function baseLedgerStages(toolName, stage) {
  const family = toolName === "apply_patch" ? "apply_patch" : (toolName === "run_command" ? "run_command" : "read_file");
  const stages = [
    { family: "initial_request", type: "initial_request_built" },
    { family: "tool_obligation", type: "tool_obligation_recorded" },
  ];
  if (["decision_no_result", "result_no_context", "context_no_manifest", "manifest_not_sent", "sent_no_bytes", "stream_interrupted", "terminal"].includes(stage)) {
    stages.push({ family, type: "tool_decision_committed" });
  }
  if (["result_no_context", "context_no_manifest", "manifest_not_sent", "sent_no_bytes", "stream_interrupted", "terminal"].includes(stage)) {
    stages.push({ family, type: `${toolName}_result_recorded` });
  }
  if (["context_no_manifest", "manifest_not_sent", "sent_no_bytes", "stream_interrupted", "terminal"].includes(stage)) {
    stages.push({ family: "continuation", type: "tool_continuation_context_built" });
  }
  if (["manifest_not_sent", "sent_no_bytes", "stream_interrupted", "terminal"].includes(stage)) {
    stages.push({ family: "continuation", type: "tool_continuation_request_built" });
  }
  if (["sent_no_bytes", "stream_interrupted", "terminal"].includes(stage)) {
    stages.push({ family: "continuation", type: "tool_continuation_sent" });
  }
  if (["stream_interrupted", "terminal"].includes(stage)) {
    stages.push({ family: "continuation", type: "tool_continuation_stream_started" });
  }
  if (stage === "terminal") stages.push({ family: "continuation", type: "tool_continuation_terminal" });
  return stages;
}

function createFixtureCase(store, definition) {
  const caseId = safeIdPart(definition.caseId);
  const sessionId = `session_${caseId}`;
  const turnId = `turn_${caseId}`;
  const parentResponseId = providerParentId(caseId);
  const session = store.createSession({
    sessionId,
    projectId: "direct-recovery-fixture",
    title: definition.caseId,
    model: "gpt-5.5",
    runtimeMode: definition.toolName ? "direct-implementation-lane" : "direct-text-only",
    directTransport: "live-text",
    nativeDirectSession: true,
  });
  store.createTurn(sessionId, {
    turnId,
    state: "streaming",
    nativeDirectSession: true,
    assistantTextCharCount: 0,
  });

  if (!definition.toolName) {
    const nextState = definition.stage === "terminal" ? "completed" : (definition.stage === "sent_no_bytes" ? "transport_handoff_unknown" : "streaming");
    const turn = store.updateTurnState(sessionId, turnId, nextState, {
      assistantTextCharCount: definition.stage === "terminal" ? 32 : 0,
      operationLedgerEvents: ledgerFor(sessionId, turnId, "", [{ family: "initial_request", type: "text_turn_recovery_fixture" }]),
    });
    return { session, turn, obligation: null };
  }

  const stepOrdinal = Number(definition.stepOrdinal || 1);
  store.addToolObligations(sessionId, turnId, [toolEvent(caseId, definition.toolName)], {
    parentResponseId,
    parentResponseSource: stepOrdinal > 1 ? "native_direct_tool_continuation_stream" : "native_direct_initial_stream",
    stepOrdinal,
    toolLoopId: `tool_loop_${caseId}`,
  });
  let { turn, obligation } = store.findToolObligation(sessionId, turnId, store.readTurn(sessionId, turnId).unresolvedObligations[0].obligationId);
  const approvedStatus = definition.toolName === "apply_patch"
    ? "patch_approved"
    : (definition.toolName === "run_command" ? "command_approved" : "approved");
  const resultStatus = definition.toolName === "apply_patch"
    ? "patch_result_recorded"
    : (definition.toolName === "run_command" ? "command_result_recorded" : "result_recorded");
  const plannedStatus = definition.toolName === "apply_patch"
    ? "patch_planned"
    : (definition.toolName === "run_command" ? "command_planned" : "waiting");

  const commonPatch = {
    toolLoopId: `tool_loop_${caseId}`,
    stepId: obligation.stepId,
    stepOrdinal,
    parentResponseId,
    parentResponseDigest: sha256(parentResponseId),
    parentResponseSource: stepOrdinal > 1 ? "native_direct_tool_continuation_stream" : "native_direct_initial_stream",
  };
  if (definition.stage === "no_decision") {
    const next = store.updateToolObligation(sessionId, turnId, obligation.obligationId, {
      ...commonPatch,
      status: plannedStatus,
      patchPlan: definition.toolName === "apply_patch" ? { patchPlanId: `patch_plan_${caseId}` } : undefined,
      commandPlan: definition.toolName === "run_command" ? { commandPlanId: `command_plan_${caseId}` } : undefined,
    }, { nextTurnState: "tool_waiting" });
    turn = next.turn;
    obligation = next.obligation;
  } else if (definition.stage === "decision_no_result") {
    const next = store.updateToolObligation(sessionId, turnId, obligation.obligationId, {
      ...commonPatch,
      status: approvedStatus,
      approvedAt: nowIso(),
      commandStartedAt: definition.commandStarted ? nowIso() : "",
      commandExecutionState: definition.commandCompleted ? "completed" : (definition.commandStarted ? "running" : ""),
      patchJournal: definition.patchJournalStatus ? { status: definition.patchJournalStatus } : undefined,
    }, { nextTurnState: "authority_waiting" });
    turn = next.turn;
    obligation = next.obligation;
  } else {
    const result = resultFor(definition.toolName, obligation, caseId, {
      journalStatus: definition.patchJournalStatus,
      omitWorkspaceEffects: definition.omitWorkspaceEffects,
    });
    let patch = {
      ...commonPatch,
      status: resultStatus,
      result,
      resultRecordedAt: normalizeString(result.recordedAt || result.appliedAt, nowIso()),
      sideEffectExecuted: definition.toolName !== "read_file",
    };
    let nextTurnState = "continuation_ready";
    if (definition.stage === "context_no_manifest") {
      patch = { ...patch, continuationContextId: `context_${caseId}`, continuationContextBuiltAt: nowIso() };
    }
    if (["manifest_not_sent", "sent_no_bytes", "stream_interrupted", "terminal"].includes(definition.stage)) {
      patch = {
        ...patch,
        status: "continuation_built",
        continuationContextId: `context_${caseId}`,
        continuationContextBuiltAt: nowIso(),
        continuationRequest: continuationRequestFor(definition.toolName, obligation, result, caseId),
      };
    }
    if (["sent_no_bytes", "stream_interrupted", "terminal"].includes(definition.stage)) {
      patch = { ...patch, status: "continuation_sent", continuationSentAt: nowIso() };
      nextTurnState = "continuation_sent";
    }
    if (definition.stage === "stream_interrupted") nextTurnState = "streaming_continuation";
    if (definition.stage === "terminal") nextTurnState = "completed";
    const next = store.updateToolObligation(sessionId, turnId, obligation.obligationId, patch, {
      nextTurnState,
      turnPatch: {
        assistantTextCharCount: definition.stage === "terminal" ? 64 : 0,
        recoveryHints: definition.stage === "terminal" ? { providerTerminalKind: "completed_with_assistant_text" } : undefined,
      },
    });
    turn = next.turn;
    obligation = next.obligation;
  }

  const ledgerStages = baseLedgerStages(definition.toolName, definition.stage);
  if (definition.patchJournalStatus === "journal_corrupt") ledgerStages.push({ family: "apply_patch", type: "patch_journal_corrupt" });
  const turnPatch = {
    operationLedgerEvents: ledgerFor(sessionId, turnId, obligation.obligationId, ledgerStages),
  };
  if (stepOrdinal > 1) {
    turnPatch.toolLoopResponseChain = definition.brokenResponseChain
      ? [{ stepOrdinal, emittedToolCallResponseId: "resp_wrong", sourceEventDigest: "event_wrong" }]
      : [{ stepOrdinal, emittedToolCallResponseId: parentResponseId, continuationResponseId: `resp_cont_${caseId}`, sourceEventDigest: `event_${caseId}` }];
  }
  turn = store.updateTurnState(sessionId, turnId, turn.state, turnPatch);
  return { session: store.readSession(sessionId), turn, obligation: activeObligationFromTurn(turn) };
}

function activeObligationFromTurn(turn) {
  const obligations = Array.isArray(turn?.unresolvedObligations) ? turn.unresolvedObligations : [];
  return obligations[obligations.length - 1] || null;
}

const CASES = [
  { caseId: "read_no_decision", group: "read", toolName: "read_file", stage: "no_decision", expect: { recoveryState: "waiting_for_user", sideEffectState: "none" } },
  { caseId: "read_decision_no_result", group: "read", toolName: "read_file", stage: "decision_no_result", expect: { recoveryState: "decision_committed_no_result", sideEffectState: "read_maybe_executed_no_result" } },
  { caseId: "read_result_no_context", group: "read", toolName: "read_file", stage: "result_no_context", expect: { recoveryState: "result_recorded_no_context", sideEffectState: "read_evidence_recorded" } },
  { caseId: "read_context_no_manifest", group: "read", toolName: "read_file", stage: "context_no_manifest", expect: { recoveryState: "context_built_no_manifest", sideEffectState: "read_evidence_recorded" } },
  { caseId: "read_manifest_not_sent", group: "read", toolName: "read_file", stage: "manifest_not_sent", expect: { recoveryState: "request_built_not_sent", sideEffectState: "read_evidence_recorded" } },
  { caseId: "read_sent_no_bytes", group: "read", toolName: "read_file", stage: "sent_no_bytes", expect: { recoveryState: "continuation_sent_no_bytes", providerContinuationSeenByModel: "maybe_handoff_unknown" } },
  { caseId: "read_stream_interrupted", group: "read", toolName: "read_file", stage: "stream_interrupted", expect: { recoveryState: "stream_interrupted", providerHandoffState: "stream_interrupted" } },
  { caseId: "read_terminal", group: "read", toolName: "read_file", stage: "terminal", expect: { recoveryState: "terminal", composerAllowed: true } },
  { caseId: "read_loop_step2_no_decision", group: "multi_step_read", toolName: "read_file", stage: "no_decision", stepOrdinal: 2, expect: { recoveryState: "waiting_for_user", responseChainState: "valid" } },
  { caseId: "read_loop_step2_result_no_continuation", group: "multi_step_read", toolName: "read_file", stage: "result_no_context", stepOrdinal: 2, expect: { recoveryState: "result_recorded_no_context", responseChainState: "valid" } },
  { caseId: "read_loop_broken_response_chain", group: "multi_step_read", toolName: "read_file", stage: "manifest_not_sent", stepOrdinal: 2, brokenResponseChain: true, expect: { recoveryState: "corrupt", responseChainState: "parent_response_digest_mismatch" } },
  { caseId: "patch_plan_no_decision", group: "patch", toolName: "apply_patch", stage: "no_decision", expect: { recoveryState: "waiting_for_user", patchJournalState: "planned_only" } },
  { caseId: "patch_decision_no_apply", group: "patch", toolName: "apply_patch", stage: "decision_no_result", expect: { recoveryState: "decision_committed_no_result", sideEffectState: "patch_planned_only" } },
  { caseId: "patch_apply_started_no_terminal", group: "patch", toolName: "apply_patch", stage: "decision_no_result", patchJournalStatus: "applying", expect: { recoveryState: "patch_partial_unknown", sideEffectState: "workspace_patch_partial_unknown" } },
  { caseId: "patch_apply_committed_no_result", group: "patch", toolName: "apply_patch", stage: "decision_no_result", patchJournalStatus: "applied", expect: { recoveryState: "patch_applied_no_result", sideEffectState: "workspace_patch_applied" } },
  { caseId: "patch_result_no_continuation", group: "patch", toolName: "apply_patch", stage: "result_no_context", expect: { recoveryState: "result_recorded_no_context", sideEffectState: "workspace_patch_applied" } },
  { caseId: "patch_sent_no_bytes", group: "patch", toolName: "apply_patch", stage: "sent_no_bytes", expect: { recoveryState: "continuation_sent_no_bytes", sideEffectState: "workspace_patch_applied" } },
  { caseId: "patch_stream_interrupted", group: "patch", toolName: "apply_patch", stage: "stream_interrupted", expect: { recoveryState: "stream_interrupted", sideEffectState: "workspace_patch_applied" } },
  { caseId: "patch_journal_corrupt", group: "patch", toolName: "apply_patch", stage: "decision_no_result", patchJournalStatus: "journal_corrupt", expect: { recoveryState: "corrupt", patchJournalState: "journal_corrupt" } },
  { caseId: "command_plan_no_decision", group: "command", toolName: "run_command", stage: "no_decision", expect: { recoveryState: "waiting_for_user", commandWorkspaceEffectState: "not_applicable" } },
  { caseId: "command_decision_no_start", group: "command", toolName: "run_command", stage: "decision_no_result", expect: { recoveryState: "decision_committed_no_result", sideEffectState: "none" } },
  { caseId: "command_started_no_terminal", group: "command", toolName: "run_command", stage: "decision_no_result", commandStarted: true, expect: { recoveryState: "command_started_no_terminal", sideEffectState: "command_may_have_run" } },
  { caseId: "command_completed_no_result", group: "command", toolName: "run_command", stage: "decision_no_result", commandCompleted: true, expect: { recoveryState: "command_completed_no_result", sideEffectState: "command_ran" } },
  { caseId: "command_result_no_continuation", group: "command", toolName: "run_command", stage: "result_no_context", expect: { recoveryState: "result_recorded_no_context", sideEffectState: "command_ran", commandWorkspaceEffectState: "scan_passed" } },
  { caseId: "command_effect_scan_missing", group: "command", toolName: "run_command", stage: "result_no_context", omitWorkspaceEffects: true, expect: { recoveryState: "result_recorded_no_context", commandWorkspaceEffectState: "scan_missing" } },
  { caseId: "command_sent_no_bytes", group: "command", toolName: "run_command", stage: "sent_no_bytes", expect: { recoveryState: "continuation_sent_no_bytes", sideEffectState: "command_ran" } },
  { caseId: "command_stream_interrupted", group: "command", toolName: "run_command", stage: "stream_interrupted", expect: { recoveryState: "stream_interrupted", sideEffectState: "command_ran" } },
  { caseId: "text_only_completed", group: "text_only", stage: "terminal", expect: { recoveryState: "terminal", authorityKind: "text_only", composerAllowed: true } },
  { caseId: "text_only_sent_no_bytes", group: "text_only", stage: "sent_no_bytes", expect: { recoveryState: "sent_no_bytes", authorityKind: "text_only", providerContinuationSeenByModel: "maybe_handoff_unknown" } },
  { caseId: "text_only_stream_interrupted", group: "text_only", stage: "stream_interrupted", expect: { recoveryState: "stream_interrupted", authorityKind: "text_only" } },
];

function checkExpected(caseId, classification, expected = {}) {
  const mismatches = [];
  for (const [key, value] of Object.entries(expected)) {
    if (classification[key] !== value) mismatches.push(`${key}: expected ${value}, got ${classification[key]}`);
  }
  if (classification.autoRetryAllowed !== false) mismatches.push("autoRetryAllowed must be false");
  if (classification.autoReexecuteAllowed !== false) mismatches.push("autoReexecuteAllowed must be false");
  if (classification.sourceOfTruth !== "authority_artifacts_and_operation_ledger") mismatches.push("sourceOfTruth must ignore renderer projections");
  if (classification.rendererProjectionIsAuthority !== false) mismatches.push("rendererProjectionIsAuthority must be false");
  return {
    ok: mismatches.length === 0,
    mismatches,
  };
}

function rawExposureFindings(value, roots = []) {
  const findings = scanFixtureForSecrets(value, { privatePathRoots: roots.filter(Boolean) });
  const text = JSON.stringify(value);
  for (const root of roots.filter(Boolean)) {
    if (root && text.includes(root)) findings.push("private-path");
  }
  for (const pattern of ["accessToken", "refreshToken", "Bearer ", "sk-", "FOREIGN KEY constraint failed", "SQLITE_"]) {
    if (text.includes(pattern)) findings.push(pattern);
  }
  return [...new Set(findings)];
}

function validateReportLifecycle(report) {
  validateDirectRecoveryReport(report);
  const serialized = JSON.stringify(report);
  if (!serialized.includes(DIRECT_RECOVERY_REPORT_SCHEMA)) throw new Error("Recovery report serialization lost schema.");
  validateDirectRecoveryReport(JSON.parse(serialized));
}

function markdownSummary(report) {
  const rows = report.cases.map((entry) =>
    `| ${entry.caseId} | ${entry.group} | ${entry.status} | ${entry.classification.recoveryState} | ${entry.classification.sideEffectState} | ${entry.classification.providerHandoffState} | ${entry.failureCode || ""} |`,
  ).join("\n");
  return `# Direct Recovery Regression ${report.runId}

- Coverage source: \`${report.coverageSource}\`
- Matrix promotion candidate: \`${report.matrixPromotionCandidate}\`
- Scanner: \`${report.recoveryScannerVersion}\`
- Cases: \`${report.cases.length}\`

Manual resume is not implemented in PR 2. Recovery classification is inspect-only and never retries provider transport, reads, patch apply, commands, or continuations.

| Case | Group | Status | Recovery | Side effect | Handoff | Failure |
| --- | --- | --- | --- | --- | --- | --- |
${rows}
`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const runId = safeIdPart(optionString(options, "run-id", `direct_recovery_${new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "Z")}`));
  const appUserDataRoot = path.resolve(optionString(options, "app-user-data-root", process.env[USER_DATA_ROOT_ENV_VAR] || defaultAppUserDataRoot()));
  const outputRoot = path.resolve(optionString(options, "output-root", path.join(appUserDataRoot, "direct-recovery-runs", runId)));
  const storeRoot = path.join(outputRoot, "fixture-store");
  ensureDirectory(outputRoot);
  const store = new DirectSessionStore({ rootDir: storeRoot });
  store.ensure();

  const report = {
    schema: DIRECT_RECOVERY_REPORT_SCHEMA,
    runId,
    createdAt: nowIso(),
    recoveryScannerVersion: DIRECT_RECOVERY_SCANNER_VERSION,
    compatibleRuntimeSchemaVersions: ["direct_codex_session@1", "direct_codex_turn@1"],
    coverageSource: "fixture_recovery",
    matrixRowsExercised: ["A11", "C1", "C2", "C3", "C11", "C12", "E15", "I9"],
    matrixPromotionCandidate: false,
    branch: "",
    commit: "",
    cases: [],
    rawExposureScan: {
      scanned: false,
      status: "not_run",
      findingCount: 0,
    },
    allowedStartupRecoveryWrites: ["direct_recovery_report@1"],
    forbiddenStartupRecoveryWrites: [
      "workspace_files",
      "patch_journals",
      "command_result_artifacts",
      "context_packs",
      "request_manifests",
      "provider_continuation_artifacts",
      "operation_ledger_events",
    ],
    notes: ["Manual resume is not implemented in PR 2."],
  };

  for (const definition of CASES) {
    const fixture = createFixtureCase(store, definition);
    const classification = classifyDirectTurnRecovery(fixture);
    const expected = checkExpected(definition.caseId, classification, definition.expect);
    report.cases.push({
      caseId: definition.caseId,
      group: definition.group,
      coverageSource: "fixture_recovery",
      matrixPromotionCandidate: false,
      status: expected.ok ? "passed" : "failed",
      failureCode: expected.ok ? "" : "classification_mismatch",
      mismatches: expected.mismatches,
      sentinelCounters: createZeroRecoverySentinelCounters(),
      classification,
      sourceRefs: {
        sessionId: fixture.session.sessionId,
        turnId: fixture.turn.turnId,
        obligationId: fixture.obligation?.obligationId || "",
      },
    });
  }

  validateReportLifecycle(report);
  const preFindings = rawExposureFindings(report, [outputRoot, appUserDataRoot, repoRoot]);
  report.rawExposureScan = {
    scanned: true,
    status: preFindings.length ? "failed" : "passed",
    findingCount: preFindings.length,
  };
  validateReportLifecycle(report);

  const reportPath = path.join(outputRoot, "direct-recovery-report.json");
  const markdownPath = path.join(outputRoot, "direct-recovery-report.md");
  if (preFindings.length) {
    const minimal = {
      schema: DIRECT_RECOVERY_REPORT_SCHEMA,
      runId,
      createdAt: report.createdAt,
      status: "failed",
      failureCode: "raw_exposure_blocked",
      rawExposureBlocked: true,
      coverageSource: "fixture_recovery",
      matrixPromotionCandidate: false,
      cases: [],
      rawExposureScan: {
        scanned: true,
        status: "failed",
        findingCount: preFindings.length,
      },
    };
    validateDirectRecoveryReport(minimal);
    writeJsonAtomic(reportPath, minimal);
    console.log(reportPath);
    process.exit(1);
  }

  writeJsonAtomic(reportPath, report);
  writeTextFile(markdownPath, markdownSummary(report));
  const written = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  validateReportLifecycle(written);
  const postFindings = rawExposureFindings({ report: written, markdown: fs.readFileSync(markdownPath, "utf8") }, [outputRoot, appUserDataRoot, repoRoot]);
  if (postFindings.length) {
    const minimal = {
      schema: DIRECT_RECOVERY_REPORT_SCHEMA,
      runId,
      createdAt: report.createdAt,
      status: "failed",
      failureCode: "raw_exposure_blocked",
      rawExposureBlocked: true,
      coverageSource: "fixture_recovery",
      matrixPromotionCandidate: false,
      cases: [],
      rawExposureScan: {
        scanned: true,
        status: "failed",
        findingCount: postFindings.length,
      },
    };
    validateDirectRecoveryReport(minimal);
    writeJsonAtomic(reportPath, minimal);
    console.log(reportPath);
    process.exit(1);
  }

  console.log(reportPath);
  const failed = report.cases.some((entry) => entry.status !== "passed");
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error?.message || String(error));
  process.exit(1);
});
