"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { spawn } = require("node:child_process");
const { StringDecoder } = require("node:string_decoder");
const {
  authorizeDirectThreadHarnessCapability,
  validateDirectThreadHarnessGrant,
} = require("../authority/direct-thread-harness-grant");

const DIRECT_STATEFUL_EXEC_SESSION_SURFACE_SCHEMA = "direct_stateful_exec_session_surface@1";
const DIRECT_STATEFUL_EXEC_SESSION_PLAN_SCHEMA = "direct_stateful_exec_session_plan@1";
const DIRECT_STATEFUL_EXEC_OUTPUT_FRAME_SCHEMA = "direct_stateful_exec_output_frame@1";
const DIRECT_STATEFUL_EXEC_STDIN_PLAN_SCHEMA = "direct_stateful_exec_stdin_plan@1";
const DIRECT_STATEFUL_EXEC_CLEANUP_PLAN_SCHEMA = "direct_stateful_exec_cleanup_plan@1";
const DIRECT_STATEFUL_EXEC_RECOVERY_CLASSIFICATION_SCHEMA = "direct_stateful_exec_recovery_classification@1";
const DIRECT_STATEFUL_EXEC_RESULT_SCHEMA = "direct_stateful_exec_result@1";
const STATEFUL_EXEC_CAPABILITY_NAMES = Object.freeze(["exec_command", "write_stdin"]);
const DEFAULT_EXEC_OUTPUT_BUDGET_CHARS = 24_000;
const DEFAULT_EXEC_PROVIDER_RESULT_BUDGET_CHARS = 12_000;
const DEFAULT_EXEC_INITIAL_YIELD_MS = 100;
const DEFAULT_EXEC_CANCEL_ESCALATION_MS = 200;
const DEFAULT_EXEC_IDLE_ESCALATION_MS = 200;
const STATEFUL_EXEC_DISPOSE_TERM_GRACE_MS = 200;
const STATEFUL_EXEC_DISPOSE_DEADLINE_MS = 2_000;
const DEFAULT_EXEC_IDLE_TIMEOUT_MS = 30_000;
const DEFAULT_EXEC_HARD_TIMEOUT_MS = 120_000;
const MAX_EXEC_OUTPUT_BUDGET_CHARS = 256 * 1024;
const MAX_EXEC_PROVIDER_RESULT_BUDGET_CHARS = 64 * 1024;
const MAX_EXEC_INPUT_CHARS = 64 * 1024;
const SAFE_ENV_KEYS = new Set([
  "CI",
  "COMSPEC",
  "HOME",
  "LANG",
  "LC_ALL",
  "NO_COLOR",
  "PATH",
  "SYSTEMROOT",
  "TEMP",
  "TMP",
  "TMPDIR",
]);
const SHELL_EXECUTABLES = new Set([
  "bash",
  "cmd",
  "cmd.exe",
  "fish",
  "powershell",
  "powershell.exe",
  "sh",
  "zsh",
]);

const SESSION_STATES = new Set([
  "planned",
  "starting",
  "running",
  "stdin_waiting",
  "completed",
  "failed",
  "cancelled",
  "timeout",
  "cleanup_required",
  "recovery_required",
  "unknown",
]);
const TERMINAL_SESSION_STATES = new Set(["completed", "failed", "cancelled", "timeout"]);
const TRANSPORT_MODES = new Set(["plain_pipe", "pty_deferred"]);
const OUTPUT_STREAMS = new Set(["stdout", "stderr", "combined", "system"]);
const STDIN_POLICIES = new Set(["disabled", "line_input", "eof_only", "blocked_until_policy"]);
const CLEANUP_STATES = new Set(["not_required", "pending", "completed", "failed", "unknown"]);
const RECOVERY_CLASSES = new Set([
  "not_started",
  "terminal_known",
  "running_unknown",
  "cleanup_required",
  "replay_forbidden",
  "recovery_required",
  "unknown",
]);

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype;
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function boundedString(value, maxLength = 320) {
  const text = normalizeString(value, "");
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function finiteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function positiveNumber(value, fallback) {
  const parsed = finiteNumber(value, fallback);
  return parsed > 0 ? parsed : fallback;
}

function nonNegativeNumber(value, fallback = 0) {
  const parsed = finiteNumber(value, fallback);
  return parsed >= 0 ? parsed : fallback;
}

function arrayOrEmpty(value) {
  return Array.isArray(value) ? value : [];
}

function stableStringify(value) {
  if (value && typeof value.toJSON === "function") return stableStringify(value.toJSON());
  if (value === null) return "null";
  const type = typeof value;
  if (type === "boolean" || type === "number" || type === "string") return JSON.stringify(value);
  if (type === "bigint" || type === "function" || type === "symbol" || type === "undefined") return undefined;
  if (Array.isArray(value)) {
    return `[${value.map((entry) => {
      const serialized = stableStringify(entry);
      return serialized === undefined ? "null" : serialized;
    }).join(",")}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => {
      const serialized = stableStringify(value[key]);
      return serialized === undefined ? "" : `${JSON.stringify(key)}:${serialized}`;
    })
    .filter(Boolean)
    .join(",")}}`;
}

function digestFor(domain, value) {
  return crypto.createHash("sha256").update(`${domain}:${stableStringify(value)}`).digest("hex");
}

function nowIso(nowMs) {
  const ms = typeof nowMs === "number" && Number.isFinite(nowMs) ? nowMs : Date.now();
  return new Date(ms).toISOString();
}

function normalizeEnum(value, allowed, fallback) {
  const text = normalizeString(value, fallback);
  return allowed.has(text) ? text : fallback;
}

function normalizeEvidenceRef(input = {}, fallbackKind = "stateful_exec") {
  const source = isPlainObject(input) ? input : {};
  const ref = {
    kind: boundedString(source.kind || source.refKind || fallbackKind, 80),
    id: boundedString(source.id || source.refId || source.artifactId, 160),
    digest: boundedString(source.digest || source.artifactDigest || source.refDigest, 180),
    label: boundedString(source.label || source.rendererSafeLabel || fallbackKind, 180),
    confidence: boundedString(source.confidence || source.sourceConfidence || "diagnostic", 80),
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  ref.refDigest = digestFor("direct-stateful-exec-evidence-ref@1", ref);
  return ref;
}

function normalizeEvidenceRefs(values, fallbackKind = "stateful_exec") {
  return arrayOrEmpty(values)
    .filter((value) => isPlainObject(value))
    .map((value) => normalizeEvidenceRef(value, fallbackKind));
}

function normalizeSessionId(input = {}, fallbackPrefix = "exec_session") {
  const existing = normalizeString(input.sessionId || input.execSessionId || input.id, "");
  if (existing) return boundedString(existing, 160);
  return `${fallbackPrefix}_${digestFor("direct-stateful-exec-session-source@1", input).slice(0, 24)}`;
}

function commandPreviewFrom(input = {}) {
  const command = normalizeString(input.commandPreview || input.command || input.executable, "");
  if (command) return boundedString(command, 180);
  const argv = arrayOrEmpty(input.argv || input.args).map((item) => normalizeString(item, "")).filter(Boolean);
  return boundedString(argv.join(" "), 180);
}

function buildStatefulExecSessionPlan(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const transportMode = normalizeEnum(source.transportMode || source.mode, TRANSPORT_MODES, "plain_pipe");
  const sessionState = normalizeEnum(source.sessionState || source.state, SESSION_STATES, "planned");
  const plan = {
    schema: DIRECT_STATEFUL_EXEC_SESSION_PLAN_SCHEMA,
    sessionId: normalizeSessionId(source),
    projectId: boundedString(source.projectId, 160),
    workThreadId: boundedString(source.workThreadId, 160),
    turnId: boundedString(source.turnId, 160),
    toolCallId: boundedString(source.toolCallId || source.callId, 160),
    commandPreview: commandPreviewFrom(source),
    commandClass: boundedString(source.commandClass || "unknown", 80),
    cwdEvidenceKey: boundedString(source.cwdEvidenceKey || source.workspaceEvidenceKey, 180),
    transportMode,
    ptyModeEnabled: false,
    plainPipeModeEnabled: transportMode === "plain_pipe",
    sessionState,
    terminal: TERMINAL_SESSION_STATES.has(sessionState),
    exitCodeKnown: source.exitCode !== undefined && source.exitCode !== null,
    exitCode: source.exitCode === undefined || source.exitCode === null ? null : Number(source.exitCode),
    startedAt: boundedString(source.startedAt || source.createdAt, 80),
    completedAt: boundedString(source.completedAt || source.terminalAt, 80),
    idleTimeoutMs: positiveNumber(source.idleTimeoutMs, 30_000),
    hardTimeoutMs: positiveNumber(source.hardTimeoutMs, 120_000),
    outputBudgetChars: positiveNumber(source.outputBudgetChars, 24_000),
    providerResultBudgetChars: positiveNumber(source.providerResultBudgetChars, 12_000),
    sandboxProfile: boundedString(source.sandboxProfile || "workspace_write_scoped", 120),
    approvalProfile: boundedString(source.approvalProfile || "per_session", 120),
    workspaceEffectScanRequired: source.workspaceEffectScanRequired !== false,
    cancellationSupported: source.cancellationSupported !== false,
    processTreeCleanupRequired: source.processTreeCleanupRequired !== false,
    replayForbiddenAfterStart: true,
    runCommandAlias: false,
    providerVisibleOutputPolicy: "bounded_result_envelope",
    evidenceRefs: normalizeEvidenceRefs(source.evidenceRefs, "stateful_exec_session_plan"),
    rawCommandIncluded: false,
    rawOutputIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  plan.planDigest = digestFor("direct-stateful-exec-session-plan@1", plan);
  return plan;
}

function buildStatefulExecOutputFrame(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const sequence = Math.max(1, Math.trunc(positiveNumber(source.sequence || source.frameSequence, 1)));
  const outputBudgetChars = positiveNumber(source.outputBudgetChars, 24_000);
  const providerResultBudgetChars = positiveNumber(source.providerResultBudgetChars, 12_000);
  const originalChars = nonNegativeNumber(source.originalChars ?? source.textChars ?? source.previewChars, 0);
  const requestedPreviewChars = nonNegativeNumber(source.previewChars ?? Math.min(originalChars, outputBudgetChars), 0);
  const previewChars = Math.min(requestedPreviewChars, outputBudgetChars);
  const requestedProviderIncludedChars = nonNegativeNumber(source.providerIncludedChars ?? Math.min(previewChars, providerResultBudgetChars), 0);
  const frame = {
    schema: DIRECT_STATEFUL_EXEC_OUTPUT_FRAME_SCHEMA,
    frameId: boundedString(source.frameId || `exec_output_frame_${digestFor("direct-stateful-exec-output-frame-source@1", source).slice(0, 24)}`, 160),
    sessionId: normalizeSessionId(source),
    sequence,
    stream: normalizeEnum(source.stream, OUTPUT_STREAMS, "combined"),
    observedAt: boundedString(source.observedAt || source.createdAt || nowIso(source.nowMs), 80),
    originalChars,
    previewChars,
    truncated: source.truncated === true || originalChars > previewChars || requestedPreviewChars > previewChars,
    providerVisible: source.providerVisible === true,
    providerIncludedChars: Math.min(requestedProviderIncludedChars, providerResultBudgetChars, previewChars),
    redactionApplied: source.redactionApplied !== false,
    outputEvidenceKey: boundedString(source.outputEvidenceKey || source.evidenceKey, 180),
    rawOutputIncluded: false,
    rawSecretIncluded: false,
  };
  frame.frameDigest = digestFor("direct-stateful-exec-output-frame@1", frame);
  return frame;
}

function buildStatefulExecStdinPlan(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const session = source.session || {};
  const sessionId = normalizeSessionId(source.sessionId ? source : session);
  const sessionState = normalizeEnum(source.sessionState || session.sessionState || session.state, SESSION_STATES, "unknown");
  const stdinPolicy = normalizeEnum(source.stdinPolicy || source.policy, STDIN_POLICIES, "blocked_until_policy");
  const targetExists = source.targetExists === true || normalizeString(session.sessionId, "") === sessionId;
  const sessionAcceptsInput = targetExists && ["running", "stdin_waiting"].includes(sessionState);
  const canWrite = stdinPolicy === "line_input" && sessionAcceptsInput;
  const plan = {
    schema: DIRECT_STATEFUL_EXEC_STDIN_PLAN_SCHEMA,
    stdinPlanId: boundedString(source.stdinPlanId || `exec_stdin_plan_${digestFor("direct-stateful-exec-stdin-source@1", source).slice(0, 24)}`, 160),
    sessionId,
    targetExists,
    targetSessionState: sessionState,
    stdinPolicy,
    commandClass: boundedString(source.commandClass || session.commandClass || "unknown", 80),
    inputPreviewChars: nonNegativeNumber(source.inputPreviewChars || source.chars || 0, 0),
    eofRequested: source.eofRequested === true,
    canWrite,
    blockerCodes: [
      targetExists ? "" : "missing_session",
      targetExists && !sessionAcceptsInput ? "session_not_accepting_stdin" : "",
      stdinPolicy !== "line_input" ? `stdin_policy_${stdinPolicy}` : "",
    ].filter(Boolean),
    writeStdinAuthorityBearing: true,
    providerVisibleInputPolicy: "stdin_event_metadata_only",
    evidenceRefs: normalizeEvidenceRefs(source.evidenceRefs, "stateful_exec_stdin_plan"),
    rawInputIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  plan.stdinPlanDigest = digestFor("direct-stateful-exec-stdin-plan@1", plan);
  return plan;
}

function buildStatefulExecCleanupPlan(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const session = source.session || {};
  const sessionState = normalizeEnum(source.sessionState || session.sessionState || session.state, SESSION_STATES, "unknown");
  const cleanupState = normalizeEnum(source.cleanupState, CLEANUP_STATES, TERMINAL_SESSION_STATES.has(sessionState) ? "not_required" : "pending");
  const plan = {
    schema: DIRECT_STATEFUL_EXEC_CLEANUP_PLAN_SCHEMA,
    cleanupPlanId: boundedString(source.cleanupPlanId || `exec_cleanup_plan_${digestFor("direct-stateful-exec-cleanup-source@1", source).slice(0, 24)}`, 160),
    sessionId: normalizeSessionId(source.sessionId ? source : session),
    cleanupState,
    sessionState,
    cancellationRequested: source.cancellationRequested === true,
    processTreeCleanupRequired: source.processTreeCleanupRequired !== false && !TERMINAL_SESSION_STATES.has(sessionState),
    cleanupAuthorityRequired: cleanupState !== "not_required",
    workspaceEffectScanRequired: source.workspaceEffectScanRequired !== false,
    evidenceRefs: normalizeEvidenceRefs(source.evidenceRefs, "stateful_exec_cleanup_plan"),
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  plan.cleanupPlanDigest = digestFor("direct-stateful-exec-cleanup-plan@1", plan);
  return plan;
}

function buildStatefulExecRecoveryClassification(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const session = source.session || {};
  const sessionState = normalizeEnum(source.sessionState || session.sessionState || session.state, SESSION_STATES, "unknown");
  const started = Boolean(source.started || session.startedAt || ["starting", "running", "stdin_waiting", "completed", "failed", "cancelled", "timeout", "cleanup_required", "recovery_required"].includes(sessionState));
  let recoveryClass = "unknown";
  if (!started || sessionState === "planned") recoveryClass = "not_started";
  else if (TERMINAL_SESSION_STATES.has(sessionState)) recoveryClass = "terminal_known";
  else if (sessionState === "cleanup_required") recoveryClass = "cleanup_required";
  else if (sessionState === "recovery_required") recoveryClass = "recovery_required";
  else if (sessionState === "running" || sessionState === "stdin_waiting" || sessionState === "starting") recoveryClass = "running_unknown";
  const finalRecoveryClass = normalizeEnum(source.recoveryClass, RECOVERY_CLASSES, recoveryClass);
  const classification = {
    schema: DIRECT_STATEFUL_EXEC_RECOVERY_CLASSIFICATION_SCHEMA,
    recoveryId: boundedString(source.recoveryId || `exec_recovery_${digestFor("direct-stateful-exec-recovery-source@1", source).slice(0, 24)}`, 160),
    sessionId: normalizeSessionId(source.sessionId ? source : session),
    sessionState,
    recoveryClass: finalRecoveryClass,
    replayAllowed: false,
    replayForbiddenReason: started ? "process_side_effects_may_have_occurred" : "not_started_replay_unneeded",
    requiresHumanReconciliation: ["running_unknown", "cleanup_required", "recovery_required", "unknown"].includes(finalRecoveryClass),
    terminalSuccessClaimAllowed: finalRecoveryClass === "terminal_known" && sessionState === "completed",
    evidenceRefs: normalizeEvidenceRefs(source.evidenceRefs, "stateful_exec_recovery_classification"),
    rawOutputIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  classification.recoveryDigest = digestFor("direct-stateful-exec-recovery-classification@1", classification);
  return classification;
}

function validateOutputFrameSequence(outputFrames = []) {
  let previous = 0;
  for (const frame of outputFrames) {
    const sequence = Number(frame?.sequence || 0);
    if (!Number.isInteger(sequence) || sequence <= previous) return false;
    previous = sequence;
  }
  return true;
}

function buildStatefulExecSessionSurface(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const sessionPlan = buildStatefulExecSessionPlan(source.sessionPlan || source.session || source);
  let outputRemaining = sessionPlan.outputBudgetChars;
  let providerRemaining = sessionPlan.providerResultBudgetChars;
  const outputFrames = arrayOrEmpty(source.outputFrames).map((frame) => {
    const normalized = buildStatefulExecOutputFrame({
      ...frame,
      sessionId: sessionPlan.sessionId,
      outputBudgetChars: frame.outputBudgetChars ?? sessionPlan.outputBudgetChars,
      providerResultBudgetChars: frame.providerResultBudgetChars ?? sessionPlan.providerResultBudgetChars,
      nowMs: frame.nowMs ?? source.nowMs,
    });
    const previewChars = Math.min(normalized.previewChars, outputRemaining);
    const providerIncludedChars = Math.min(normalized.providerIncludedChars, providerRemaining, previewChars);
    outputRemaining -= previewChars;
    providerRemaining -= providerIncludedChars;
    if (previewChars === normalized.previewChars && providerIncludedChars === normalized.providerIncludedChars) {
      return normalized;
    }
    return buildStatefulExecOutputFrame({
      ...normalized,
      previewChars,
      providerIncludedChars,
      outputBudgetChars: sessionPlan.outputBudgetChars,
      providerResultBudgetChars: sessionPlan.providerResultBudgetChars,
    });
  });
  const stdinPlan = buildStatefulExecStdinPlan({
    ...(source.stdinPlan || {}),
    session: sessionPlan,
    sessionId: source.stdinPlan?.sessionId || sessionPlan.sessionId,
    commandClass: source.stdinPlan?.commandClass || sessionPlan.commandClass,
  });
  const cleanupPlan = buildStatefulExecCleanupPlan({
    ...(source.cleanupPlan || {}),
    session: sessionPlan,
    sessionId: sessionPlan.sessionId,
  });
  const recoveryClassification = buildStatefulExecRecoveryClassification({
    ...(source.recoveryClassification || {}),
    session: sessionPlan,
    sessionId: sessionPlan.sessionId,
  });
  const surface = {
    schema: DIRECT_STATEFUL_EXEC_SESSION_SURFACE_SCHEMA,
    projectId: boundedString(source.projectId || sessionPlan.projectId, 160),
    workThreadId: boundedString(source.workThreadId || sessionPlan.workThreadId, 160),
    surfaceId: boundedString(source.surfaceId || `stateful_exec_surface_${digestFor("direct-stateful-exec-surface-source@1", { sessionPlan, outputFrames, stdinPlan }).slice(0, 24)}`, 160),
    mode: "restricted_stateful_session_surface",
    sessionPlan,
    outputFrames,
    stdinPlan,
    cleanupPlan,
    recoveryClassification,
    outputFrameSequenceValid: validateOutputFrameSequence(outputFrames),
    outputFrameCount: outputFrames.length,
    outputBudgetChars: sessionPlan.outputBudgetChars,
    providerResultBudgetChars: sessionPlan.providerResultBudgetChars,
    execCommandToolEnabledInThisPr: true,
    writeStdinToolEnabledInThisPr: stdinPlan.canWrite === true,
    plainPipeModeEnabledInThisPr: true,
    ptyModeEnabledInThisPr: false,
    cancellationPlanEnabledInThisPr: true,
    processTreeCleanupPlanEnabledInThisPr: true,
    providerDeclarationAllowed: false,
    providerTransportAllowed: false,
    requestShapeMutationAllowed: false,
    runCommandAliasAllowed: false,
    terminalSuccessWithoutExitAllowed: false,
    rawCommandIncluded: false,
    rawOutputIncluded: false,
    rawInputIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
    rendererSafeSummary: boundedString(source.rendererSafeSummary || "Stateful exec session parity is modeled as session identity, bounded output frames, stdin policy, cancellation, cleanup, and restart recovery evidence; PTY mode remains deferred.", 420),
    evidenceRefs: normalizeEvidenceRefs(source.evidenceRefs, "stateful_exec_session_surface"),
    generatedAt: normalizeString(source.generatedAt, nowIso(source.nowMs)),
  };
  surface.surfaceDigest = digestFor("direct-stateful-exec-session-surface@1", surface);
  return surface;
}

function assertStatefulExecSessionSurfaceSafe(surface = {}) {
  if (!isPlainObject(surface) || surface.schema !== DIRECT_STATEFUL_EXEC_SESSION_SURFACE_SCHEMA) {
    throw new Error("direct_stateful_exec_session_surface_schema_mismatch");
  }
  if (surface.sessionPlan?.schema !== DIRECT_STATEFUL_EXEC_SESSION_PLAN_SCHEMA) {
    throw new Error("direct_stateful_exec_session_plan_missing");
  }
  if (surface.stdinPlan?.schema !== DIRECT_STATEFUL_EXEC_STDIN_PLAN_SCHEMA) {
    throw new Error("direct_stateful_exec_stdin_plan_missing");
  }
  if (surface.cleanupPlan?.schema !== DIRECT_STATEFUL_EXEC_CLEANUP_PLAN_SCHEMA) {
    throw new Error("direct_stateful_exec_cleanup_plan_missing");
  }
  if (surface.recoveryClassification?.schema !== DIRECT_STATEFUL_EXEC_RECOVERY_CLASSIFICATION_SCHEMA) {
    throw new Error("direct_stateful_exec_recovery_classification_missing");
  }
  for (const flag of [
    "ptyModeEnabledInThisPr",
    "providerDeclarationAllowed",
    "providerTransportAllowed",
    "requestShapeMutationAllowed",
    "runCommandAliasAllowed",
    "terminalSuccessWithoutExitAllowed",
    "rawCommandIncluded",
    "rawOutputIncluded",
    "rawInputIncluded",
    "rawPathIncluded",
    "rawSecretIncluded",
  ]) {
    if (surface[flag] !== false) throw new Error(`direct_stateful_exec_authority_leak:${flag}`);
  }
  if (surface.sessionPlan.runCommandAlias !== false) throw new Error("direct_stateful_exec_run_command_alias");
  if (surface.sessionPlan.providerVisibleOutputPolicy !== "bounded_result_envelope") {
    throw new Error("direct_stateful_exec_unbounded_provider_output");
  }
  if (surface.sessionPlan.terminal === false && surface.sessionPlan.exitCodeKnown === false && surface.recoveryClassification.terminalSuccessClaimAllowed === true) {
    throw new Error("direct_stateful_exec_running_claimed_success");
  }
  if (!surface.outputFrameSequenceValid || !validateOutputFrameSequence(surface.outputFrames)) {
    throw new Error("direct_stateful_exec_output_frame_sequence_invalid");
  }
  for (const frame of arrayOrEmpty(surface.outputFrames)) {
    if (Number(frame.previewChars || 0) > Number(surface.outputBudgetChars || 0)) {
      throw new Error("direct_stateful_exec_output_frame_exceeds_output_budget");
    }
    if (Number(frame.providerIncludedChars || 0) > Number(surface.providerResultBudgetChars || 0)) {
      throw new Error("direct_stateful_exec_output_frame_exceeds_provider_budget");
    }
  }
  const totalPreviewChars = arrayOrEmpty(surface.outputFrames)
    .reduce((total, frame) => total + Number(frame.previewChars || 0), 0);
  const totalProviderIncludedChars = arrayOrEmpty(surface.outputFrames)
    .reduce((total, frame) => total + Number(frame.providerIncludedChars || 0), 0);
  if (totalPreviewChars > Number(surface.outputBudgetChars || 0)) {
    throw new Error("direct_stateful_exec_output_exceeds_output_budget");
  }
  if (totalProviderIncludedChars > Number(surface.providerResultBudgetChars || 0)) {
    throw new Error("direct_stateful_exec_output_exceeds_provider_budget");
  }
  if (surface.writeStdinToolEnabledInThisPr === true && (surface.stdinPlan.canWrite !== true || surface.stdinPlan.writeStdinAuthorityBearing !== true)) {
    throw new Error("direct_stateful_exec_stdin_authority_invalid");
  }
  if (surface.stdinPlan.canWrite === true && surface.stdinPlan.targetSessionState !== "running" && surface.stdinPlan.targetSessionState !== "stdin_waiting") {
    throw new Error("direct_stateful_exec_stdin_terminal_target");
  }
  if (surface.recoveryClassification.replayAllowed !== false) {
    throw new Error("direct_stateful_exec_replay_allowed");
  }
  return true;
}

function statefulExecError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function boundedInteger(value, fallback, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.trunc(number)));
}

function normalizeExecScope(input = {}, grant = null) {
  const source = isPlainObject(input) ? input : {};
  const grantSource = isPlainObject(grant) ? grant : {};
  const taskId = normalizeString(source.taskId || source.threadId || source.sessionId, "");
  const threadId = normalizeString(source.threadId || source.taskId || source.sessionId, taskId);
  const projectId = normalizeString(source.projectId || source.project?.id || source.project?.projectId, "");
  const executionEnvironmentDigest = normalizeString(
    source.executionEnvironmentDigest || source.environmentDigest || source.environmentBindingDigest,
    normalizeString(grantSource.executionEnvironmentDigest, ""),
  );
  if (!taskId || !threadId || !projectId || !executionEnvironmentDigest) {
    throw statefulExecError(
      "direct_stateful_exec_scope_incomplete",
      "Stateful exec requires exact task, thread, project, and execution-environment binding.",
    );
  }
  return { taskId, threadId, projectId, executionEnvironmentDigest };
}

function normalizeExecInput(value) {
  const text = typeof value === "string" ? value : "";
  if (text.length > MAX_EXEC_INPUT_CHARS || /[\0]/.test(text)) {
    throw statefulExecError("direct_stateful_exec_input_invalid", "Stateful exec stdin is bounded and cannot contain NUL bytes.");
  }
  return text;
}

function normalizeShellCommand(value) {
  const text = typeof value === "string" ? value : "";
  if (!text.trim() || text.length > MAX_EXEC_INPUT_CHARS || /[\0]/.test(text)) {
    throw statefulExecError("direct_stateful_exec_command_invalid", "Stateful exec requires one bounded command string.");
  }
  return text;
}

function normalizeExecRelativePath(value, label) {
  const text = normalizeString(value, "").replace(/\\/g, "/");
  if (!text) return "";
  if (
    text.startsWith("/") ||
    /^[A-Za-z]:\//.test(text) ||
    text.split("/").includes("..") ||
    /[\0-\x1f\x7f]/.test(text)
  ) {
    throw statefulExecError("direct_stateful_exec_cwd_invalid", `${label} must be a workspace-relative directory.`);
  }
  return text.replace(/^\.\/+/, "");
}

function safeExecEnvironment(extra = {}) {
  const result = {};
  for (const key of ["PATH", "HOME", "TMPDIR", "TMP", "TEMP", "SystemRoot", "ComSpec", "LANG", "LC_ALL"]) {
    if (process.env[key]) result[key] = process.env[key];
  }
  result.CI = "1";
  result.NO_COLOR = "1";
  if (!isPlainObject(extra)) return result;
  for (const [key, value] of Object.entries(extra)) {
    if (
      (!SAFE_ENV_KEYS.has(key) && !/^[A-Z][A-Z0-9_]{0,63}$/.test(key)) ||
      /(?:TOKEN|SECRET|PASSWORD|PRIVATE_KEY|API_KEY)/i.test(key) ||
      typeof value !== "string" ||
      value.length > 4096 ||
      /[\0\r\n]/.test(value)
    ) continue;
    result[key] = value;
  }
  return result;
}

function execCommandName(command) {
  const text = normalizeString(command, "");
  if (!text || /[\0\r\n]/.test(text)) {
    throw statefulExecError("direct_stateful_exec_command_invalid", "Stateful exec requires one bounded executable command.");
  }
  return path.basename(text).toLowerCase();
}

function assertExecCommandAllowed(command, allowedCommands) {
  const name = execCommandName(command);
  if (SHELL_EXECUTABLES.has(name)) {
    throw statefulExecError("direct_stateful_exec_shell_blocked", "Stateful exec does not provide a general shell command alias.");
  }
  if (allowedCommands && allowedCommands.size && !allowedCommands.has(name) && !allowedCommands.has(command)) {
    throw statefulExecError("direct_stateful_exec_command_not_admitted", "The executable is outside the admitted stateful exec command population.");
  }
}

function processTreeKill(child, signal = "SIGTERM") {
  if (!child) return false;
  let killed = false;
  if (process.platform !== "win32" && Number.isInteger(child.pid) && child.pid > 0) {
    try {
      process.kill(-child.pid, signal);
      killed = true;
    } catch (error) {
      if (!['ESRCH', 'EINVAL'].includes(error?.code)) throw error;
    }
  }
  if (!killed && typeof child.kill === "function" && !child.killed) {
    try { killed = child.kill(signal) || killed; } catch {}
  }
  return killed;
}

function sessionScopeMatches(record, input = {}) {
  const scope = normalizeExecScope(input, record?.grant || null);
  return (
    scope.taskId === record.taskId &&
    scope.threadId === record.threadId &&
    scope.projectId === record.projectId &&
    scope.executionEnvironmentDigest === record.executionEnvironmentDigest
  );
}

/**
 * Main-process owner of actual plain-pipe process sessions.  This deliberately
 * lives beside the stateful projection so the projection and execution share
 * one session identity and one exact task/project/environment scope check.
 */
class DirectStatefulExecSessionManager extends EventEmitter {
  constructor(options = {}) {
    super();
    this.spawnImpl = typeof options.spawnImpl === "function" ? options.spawnImpl : spawn;
    this.grantStore = options.grantStore || null;
    this.workspaceRootResolver = typeof options.workspaceRootResolver === "function"
      ? options.workspaceRootResolver
      : (input = {}) => input.workspaceRoot || input.project?.workspaceRoot || "";
    this.allowedCommands = options.allowedCommands
      ? new Set([...options.allowedCommands].map((value) => String(value).toLowerCase()))
      : null;
    this.defaultIdleTimeoutMs = boundedInteger(options.idleTimeoutMs, DEFAULT_EXEC_IDLE_TIMEOUT_MS, 25, 10 * 60_000);
    this.defaultHardTimeoutMs = boundedInteger(options.hardTimeoutMs, DEFAULT_EXEC_HARD_TIMEOUT_MS, 25, 10 * 60_000);
    this.defaultOutputBudgetChars = boundedInteger(options.outputBudgetChars, DEFAULT_EXEC_OUTPUT_BUDGET_CHARS, 256, MAX_EXEC_OUTPUT_BUDGET_CHARS);
    this.defaultProviderResultBudgetChars = boundedInteger(options.providerResultBudgetChars, DEFAULT_EXEC_PROVIDER_RESULT_BUDGET_CHARS, 128, MAX_EXEC_PROVIDER_RESULT_BUDGET_CHARS);
    this.initialYieldMs = boundedInteger(options.initialYieldMs, DEFAULT_EXEC_INITIAL_YIELD_MS, 25, 2_000);
    this.sessions = new Map();
    this.disposed = false;
    this.disposePromise = null;
  }

  resolveGrant(input = {}, capabilityName = "exec_command") {
    const supplied = isPlainObject(input.harnessGrant) ? input.harnessGrant : null;
    const scope = normalizeExecScope(input, supplied);
    if (supplied && (
      supplied.taskId !== scope.taskId ||
      supplied.threadId !== scope.threadId ||
      supplied.projectId !== scope.projectId ||
      supplied.executionEnvironmentDigest !== scope.executionEnvironmentDigest
    )) {
      throw statefulExecError("direct_stateful_exec_scope_mismatch", "The current task grant does not authorize this process session.");
    }
    const grantId = normalizeString(input.grantId || supplied?.grantId, "");
    let grant = supplied;
    try {
      if (this.grantStore && grantId && typeof this.grantStore.reconstruct === "function") {
        grant = this.grantStore.reconstruct(grantId, {
          ...scope,
          grantId,
          requireCurrent: true,
        });
      } else if (this.grantStore && typeof this.grantStore.currentForScope === "function") {
        grant = this.grantStore.currentForScope(scope);
      }
    } catch (error) {
      const errorCode = String(error?.code || "");
      let durableStateCode = "";
      if (errorCode === "direct_thread_harness_grant_invalid" && this.grantStore && grantId && typeof this.grantStore.read === "function") {
        try {
          const durableGrant = this.grantStore.read(grantId);
          if (durableGrant?.revocation?.state === "revoked" || durableGrant?.currentness?.state !== "current") {
            durableStateCode = "direct_stateful_exec_grant_not_current";
          }
        } catch {}
      }
      throw statefulExecError(
        errorCode.startsWith("scope_mismatch_")
          ? "direct_stateful_exec_scope_mismatch"
          : (durableStateCode || errorCode || "direct_stateful_exec_grant_invalid"),
        "The current task grant does not authorize this process session.",
      );
    }
    if (!grant) throw statefulExecError("direct_stateful_exec_grant_missing", "Stateful exec requires the current owner-issued task grant.");
    const grantErrors = validateDirectThreadHarnessGrant(grant, {
      ...scope,
      requireCurrent: true,
    });
    if (grantErrors.length) {
      const scopeError = grantErrors.find((error) => error.startsWith("scope_mismatch_"));
      throw statefulExecError(
        scopeError ? "direct_stateful_exec_scope_mismatch" : grantErrors[0],
        "The stateful exec task grant is stale, revoked, or out of scope.",
      );
    }
    const authorization = this.grantStore?.authorize && grant.grantId
      ? this.grantStore.authorize(grant.grantId, capabilityName, scope)
      : authorizeDirectThreadHarnessCapability(grant, capabilityName, {
          ...scope,
          runtimeAdmittedCapabilityNames: [capabilityName],
        });
    if (!authorization?.authorized) {
      throw statefulExecError(
        authorization?.reason || "direct_stateful_exec_capability_not_authorized",
        "The current task grant does not authorize this stateful exec capability.",
      );
    }
    return { grant, scope, authorization };
  }

  workspaceFor(input, grant) {
    const kind = normalizeString(grant?.executionEnvironment?.kind || input.executionEnvironment?.kind, "local");
    if (kind !== "local") {
      throw statefulExecError("direct_stateful_exec_environment_not_local", "This slice executes only in the exact selected local workspace environment.");
    }
    const rootCandidate = this.workspaceRootResolver(input, grant?.executionEnvironment || {});
    const root = path.resolve(String(rootCandidate || ""));
    if (!rootCandidate || !fs.existsSync(root)) {
      throw statefulExecError("direct_stateful_exec_workspace_unavailable", "The selected local execution environment has no available workspace root.");
    }
    const fullAccess = grant?.sandboxMode === "danger-full-access";
    const requestedCwd = normalizeString(input.cwdRelPath || input.cwd, "");
    const rel = fullAccess
      ? requestedCwd.replace(/\\/g, "/")
      : normalizeExecRelativePath(requestedCwd, "cwd");
    if (/[\0-\x1f\x7f]/.test(rel)) {
      throw statefulExecError("direct_stateful_exec_cwd_invalid", "Stateful exec cwd contains control characters.");
    }
    const cwd = path.resolve(root, rel || ".");
    if (fullAccess) {
      let cwdReal;
      try {
        cwdReal = fs.realpathSync(cwd);
        if (!fs.statSync(cwdReal).isDirectory()) throw new Error("not a directory");
      } catch (error) {
        if (error?.code?.startsWith("direct_stateful_exec_")) throw error;
        throw statefulExecError("direct_stateful_exec_cwd_unavailable", "Stateful exec cwd is unavailable in the selected local environment.");
      }
      return { root, cwd: cwdReal, cwdRelPath: path.relative(root, cwdReal).split(path.sep).join("/") || "." };
    }
    const relative = path.relative(root, cwd);
    if (relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) {
      throw statefulExecError("direct_stateful_exec_cwd_outside_workspace", "Stateful exec cwd must remain inside the selected workspace.");
    }
    let rootReal;
    let cwdReal;
    try {
      rootReal = fs.realpathSync(root);
      cwdReal = fs.realpathSync(cwd);
      const realRelative = path.relative(rootReal, cwdReal);
      if (realRelative.startsWith(`..${path.sep}`) || realRelative === ".." || path.isAbsolute(realRelative)) {
        throw statefulExecError("direct_stateful_exec_cwd_outside_workspace", "Stateful exec cwd resolves outside the selected workspace.");
      }
      if (!fs.statSync(cwdReal).isDirectory()) throw new Error("not a directory");
    } catch (error) {
      if (error?.code?.startsWith("direct_stateful_exec_")) throw error;
      throw statefulExecError("direct_stateful_exec_cwd_unavailable", "Stateful exec cwd is unavailable in the selected workspace.");
    }
    return { root: rootReal, cwd: cwdReal, cwdRelPath: relative.split(path.sep).join("/") };
  }

  start(input = {}) {
    if (this.disposed) throw statefulExecError("direct_stateful_exec_manager_disposed", "Stateful exec admission is closed because the manager is disposing or disposed.");
    const { grant, scope, authorization } = this.resolveGrant(input, "exec_command");
    const shellCommand = typeof input.cmd === "string" && input.cmd.trim() ? normalizeShellCommand(input.cmd) : "";
    const command = shellCommand || normalizeString(input.command || input.executable, "");
    if (!shellCommand) assertExecCommandAllowed(command, this.allowedCommands);
    const args = shellCommand ? [] : (Array.isArray(input.args || input.argv)
      ? (input.args || input.argv).map((value) => {
          const arg = String(value);
          if (arg.length > 16 * 1024 || /[\0\r\n]/.test(arg)) throw statefulExecError("direct_stateful_exec_argument_invalid", "Stateful exec arguments are bounded and cannot contain control separators.");
          return arg;
        })
      : []);
    const workspace = this.workspaceFor(input, grant);
    const stdinPolicy = normalizeEnum(input.stdinPolicy || input.stdinMode, STDIN_POLICIES, "line_input");
    const explicitSessionHandle = normalizeString(input.execSessionId || input.processSessionId || input.sessionHandleId, "");
    const sessionId = explicitSessionHandle
      ? normalizeSessionId({ ...input, sessionId: explicitSessionHandle })
      : `exec_session_${crypto.randomBytes(16).toString("hex")}`;
    if (this.sessions.has(sessionId)) throw statefulExecError("direct_stateful_exec_session_exists", "Stateful exec session id is already in use.");
    const now = nowIso(input.nowMs);
    const record = {
      schema: DIRECT_STATEFUL_EXEC_RESULT_SCHEMA,
      sessionId,
      taskId: scope.taskId,
      threadId: scope.threadId,
      projectId: scope.projectId,
      executionEnvironmentDigest: scope.executionEnvironmentDigest,
      grantId: grant.grantId,
      grantRevision: Number(grant.grantRevision),
      grant,
      authorization,
      command,
      args,
      shellSemantics: Boolean(shellCommand),
      commandInput: shellCommand ? "cmd" : "command",
      commandPreview: boundedString(commandPreviewFrom({ command, args }), 180),
      cwdRelPath: workspace.cwdRelPath,
      cwd: workspace.cwd,
      env: safeExecEnvironment(input.env),
      stdinPolicy,
      transportMode: "plain_pipe",
      sessionState: "starting",
      startedAt: now,
      completedAt: "",
      exitCode: null,
      signal: "",
      timedOut: false,
      cancellationRequested: false,
      cleanupState: "pending",
      outputBudgetChars: boundedInteger(input.outputBudgetChars, this.defaultOutputBudgetChars, 256, MAX_EXEC_OUTPUT_BUDGET_CHARS),
      providerResultBudgetChars: boundedInteger(input.providerResultBudgetChars, this.defaultProviderResultBudgetChars, 128, MAX_EXEC_PROVIDER_RESULT_BUDGET_CHARS),
      idleTimeoutMs: boundedInteger(input.idleTimeoutMs, this.defaultIdleTimeoutMs, 25, 10 * 60_000),
      hardTimeoutMs: boundedInteger(input.hardTimeoutMs, this.defaultHardTimeoutMs, 25, 10 * 60_000),
      outputFrames: [],
      outputChars: 0,
      stdoutPreview: "",
      stderrPreview: "",
      providerOutputChars: 0,
      stdoutDecoder: new StringDecoder("utf8"),
      stderrDecoder: new StringDecoder("utf8"),
      outputDecodersFlushed: false,
      sequence: 0,
      child: null,
      idleTimer: null,
      hardTimer: null,
      forceKillTimer: null,
      completion: null,
      cancelKillTimer: null,
      stdinKillTimer: null,
      failureKillTimer: null,
      settled: false,
      errorCode: "",
      stdinErrorCode: "",
      stdinWriteError: false,
      failurePending: false,
    };
    let resolveCompletion;
    record.completion = new Promise((resolve) => { resolveCompletion = resolve; });
    record.resolveCompletion = resolveCompletion;
    this.sessions.set(sessionId, record);
    try {
      const child = this.spawnImpl(command, args, {
        cwd: workspace.cwd,
        env: record.env,
        shell: Boolean(shellCommand),
        detached: process.platform !== "win32",
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
      record.child = child;
      record.sessionState = "running";
      this.attachProcess(record);
      this.armTimers(record);
      return this.publicResult(record);
    } catch (error) {
      this.settle(record, {
        sessionState: "failed",
        spawnError: boundedString(error?.message || error, 500),
      });
      return this.publicResult(record);
    }
  }

  attachProcess(record) {
    const onData = (stream, chunk) => {
      const decoder = stream === "stdout" ? record.stdoutDecoder : record.stderrDecoder;
      this.recordOutput(record, stream, decoder.write(chunk));
    };
    record.child?.stdout?.on("data", (chunk) => onData("stdout", chunk));
    record.child?.stderr?.on("data", (chunk) => onData("stderr", chunk));
    record.child?.stdout?.on("error", (error) => {
      this.recordProcessFailure(record, "direct_stateful_exec_stdout_read_failed", error);
    });
    record.child?.stderr?.on("error", (error) => {
      this.recordProcessFailure(record, "direct_stateful_exec_stderr_read_failed", error);
    });
    record.child?.stdin?.on?.("error", (error) => this.handleStdinWriteError(record, error));
    record.child?.on?.("error", (error) => {
      this.recordProcessFailure(record, "direct_stateful_exec_child_error", error);
    });
    record.child?.on?.("close", (exitCode, signal) => {
      if (record.settled) return;
      this.flushOutput(record);
      if (record.failurePending || record.stdinWriteError) {
        this.settle(record, { sessionState: "failed", exitCode, signal });
        return;
      }
      const terminalState = record.cancellationRequested
        ? "cancelled"
        : record.timedOut
          ? "timeout"
          : Number(exitCode) === 0
            ? "completed"
            : "failed";
      this.settle(record, { sessionState: terminalState, exitCode, signal });
    });
  }

  flushOutput(record) {
    if (!record || record.outputDecodersFlushed) return;
    record.outputDecodersFlushed = true;
    this.recordOutput(record, "stdout", record.stdoutDecoder?.end() || "");
    this.recordOutput(record, "stderr", record.stderrDecoder?.end() || "");
  }

  recordProcessFailure(record, errorCode, error, stdinErrorCode = "") {
    if (!record || record.settled) return false;
    if (record.failurePending) return true;
    record.failurePending = true;
    record.errorCode = errorCode;
    record.spawnError = boundedString(error?.message || error, 500);
    if (stdinErrorCode) {
      record.stdinWriteError = true;
      record.stdinErrorCode = stdinErrorCode;
    }
    this.requestKill(record, "SIGTERM");
    if (!record.failureKillTimer) {
      record.failureKillTimer = setTimeout(() => {
        record.failureKillTimer = null;
        if (!record.settled && record.failurePending) this.requestKill(record, "SIGKILL");
      }, DEFAULT_EXEC_CANCEL_ESCALATION_MS);
      record.failureKillTimer.unref?.();
    }
    return true;
  }

  handleStdinWriteError(record, error) {
    if (!error || !record || record.settled) return false;
    if (record.stdinWriteError || record.failurePending) return true;
    return this.recordProcessFailure(
      record,
      "direct_stateful_exec_stdin_write_failed",
      error,
      boundedString(error?.code || "direct_stateful_exec_stdin_write_failed", 120),
    );
  }

  armTimers(record) {
    const resetIdle = () => {
      if (record.settled || record.cancellationRequested || record.timedOut) return;
      if (record.idleTimer) clearTimeout(record.idleTimer);
      record.idleTimer = setTimeout(() => {
        record.idleTimer = null;
        if (record.settled || record.cancellationRequested || record.timedOut) return;
        record.timedOut = true;
        if (record.hardTimer) clearTimeout(record.hardTimer);
        record.hardTimer = null;
        this.requestKill(record, "SIGTERM");
        if (!record.settled && !record.forceKillTimer) {
          record.forceKillTimer = setTimeout(() => {
            record.forceKillTimer = null;
            if (!record.settled && record.timedOut) this.requestKill(record, "SIGKILL");
          }, DEFAULT_EXEC_IDLE_ESCALATION_MS);
          record.forceKillTimer.unref?.();
        }
      }, record.idleTimeoutMs);
      record.idleTimer.unref?.();
    };
    record.resetIdle = resetIdle;
    resetIdle();
    record.hardTimer = setTimeout(() => {
      if (record.settled || record.cancellationRequested || record.timedOut) return;
      record.timedOut = true;
      record.hardTimer = null;
      this.requestKill(record, "SIGTERM");
      record.forceKillTimer = setTimeout(() => {
        record.forceKillTimer = null;
        if (!record.settled && record.timedOut) this.requestKill(record, "SIGKILL");
      }, 1200);
      record.forceKillTimer.unref?.();
    }, record.hardTimeoutMs);
    record.hardTimer.unref?.();
  }

  requestKill(record, signal) {
    try { processTreeKill(record.child, signal); } catch (error) {
      this.emit("cleanup-error", { sessionId: record.sessionId, code: error?.code || "process_tree_kill_failed" });
    }
  }

  recordOutput(record, stream, chunk) {
    if (record.settled) return;
    const text = typeof chunk === "string" ? chunk : Buffer.from(chunk || "").toString("utf8");
    if (!text) return;
    record.resetIdle?.();
    const originalChars = text.length;
    const remaining = Math.max(0, record.outputBudgetChars - record.outputChars);
    // Once the aggregate admitted preview budget is exhausted, retain no
    // synthetic zero-preview frames.  The event is still activity for idle
    // timeout purposes, but it must not grow the retained state or sequence.
    if (remaining <= 0) return;
    const preview = text.slice(0, remaining);
    record.outputChars += Math.min(originalChars, remaining);
    record.sequence += 1;
    const providerRemaining = Math.max(0, record.providerResultBudgetChars - record.providerOutputChars);
    const providerIncludedChars = Math.min(preview.length, providerRemaining);
    const providerPreview = preview.slice(0, providerIncludedChars);
    if (stream === "stdout") record.stdoutPreview += providerPreview;
    if (stream === "stderr") record.stderrPreview += providerPreview;
    record.providerOutputChars += providerIncludedChars;
    const frame = buildStatefulExecOutputFrame({
      sessionId: record.sessionId,
      sequence: record.sequence,
      stream,
      originalChars,
      previewChars: preview.length,
      providerIncludedChars,
      providerVisible: true,
      outputEvidenceKey: `exec_output_${record.sessionId}_${record.sequence}`,
      observedAt: nowIso(),
      outputBudgetChars: record.outputBudgetChars,
      providerResultBudgetChars: record.providerResultBudgetChars,
    });
    record.outputFrames.push(frame);
    this.emit("output", {
      sessionId: record.sessionId,
      taskId: record.taskId,
      projectId: record.projectId,
      frame,
      textPreview: providerPreview,
      rawOutputIncluded: false,
    });
  }

  settle(record, update = {}) {
    if (record.settled) return record;
    record.settled = true;
    if (record.idleTimer) clearTimeout(record.idleTimer);
    if (record.hardTimer) clearTimeout(record.hardTimer);
    if (record.forceKillTimer) clearTimeout(record.forceKillTimer);
    if (record.cancelKillTimer) clearTimeout(record.cancelKillTimer);
    if (record.stdinKillTimer) clearTimeout(record.stdinKillTimer);
    if (record.failureKillTimer) clearTimeout(record.failureKillTimer);
    record.idleTimer = null;
    record.hardTimer = null;
    record.forceKillTimer = null;
    record.cancelKillTimer = null;
    record.stdinKillTimer = null;
    record.failureKillTimer = null;
    Object.assign(record, update);
    if (!TERMINAL_SESSION_STATES.has(record.sessionState) && record.sessionState !== "recovery_required") {
      record.sessionState = "recovery_required";
      record.cleanupState = "failed";
    } else {
      record.cleanupState = "completed";
    }
    record.completedAt = nowIso();
    const result = this.publicResult(record);
    record.resolveCompletion?.(result);
    this.emit("completed", result);
    return record;
  }

  exactRecord(input = {}) {
    const sessionId = normalizeString(input.sessionId || input.session_id || input.execSessionId, "");
    const record = sessionId ? this.sessions.get(sessionId) : null;
    if (!record) throw statefulExecError("direct_stateful_exec_session_missing", "The requested stateful exec session is not known to this task.");
    try {
      if (!sessionScopeMatches(record, input)) throw statefulExecError("direct_stateful_exec_scope_mismatch", "The requested stateful exec session belongs to a different task, project, or environment.");
    } catch (error) {
      if (error?.code === "direct_stateful_exec_scope_mismatch") throw error;
      throw statefulExecError("direct_stateful_exec_scope_mismatch", "The requested stateful exec session scope is invalid.");
    }
    return record;
  }

  writeStdin(input = {}) {
    const record = this.exactRecord(input);
    this.resolveGrant({ ...input, harnessGrant: record.grant, executionEnvironmentDigest: record.executionEnvironmentDigest }, "write_stdin");
    if (!['running', 'stdin_waiting'].includes(record.sessionState) || !record.child?.stdin || record.child.stdin.destroyed) {
      throw statefulExecError("direct_stateful_exec_session_not_live", "write_stdin requires an exact live process session.");
    }
    const text = normalizeExecInput(input.chars ?? input.input ?? input.data ?? "");
    if (text && record.stdinPolicy !== "line_input") {
      throw statefulExecError("direct_stateful_exec_stdin_policy_blocked", "The process command class does not permit literal stdin input.");
    }
    if (input.eof === true && !["line_input", "eof_only"].includes(record.stdinPolicy)) {
      throw statefulExecError("direct_stateful_exec_stdin_policy_blocked", "The process command class does not permit stdin EOF.");
    }
    record.sessionState = "stdin_waiting";
    let synchronousWriteError = null;
    let writeCallActive = true;
    const onWriteError = (error) => {
      if (error && writeCallActive && !synchronousWriteError) synchronousWriteError = error;
      this.handleStdinWriteError(record, error);
    };
    try {
      if (text) record.child.stdin.write(text, onWriteError);
      if (input.eof === true && !record.stdinWriteError && !record.settled) record.child.stdin.end(onWriteError);
    } catch (error) {
      synchronousWriteError = error;
      this.handleStdinWriteError(record, error);
    }
    writeCallActive = false;
    return this.publicResult(record, {
      stdinAccepted: !synchronousWriteError && !record.stdinWriteError && !record.settled,
      eofRequested: input.eof === true,
    });
  }

  cancel(input = {}) {
    const record = this.exactRecord(input);
    this.resolveGrant({ ...input, harnessGrant: record.grant, executionEnvironmentDigest: record.executionEnvironmentDigest }, "exec_command");
    if (record.settled) return this.publicResult(record, { alreadyTerminal: true });
    if (record.cancellationRequested) return this.publicResult(record, { cancellationRequested: true, alreadyCancelling: true });
    record.cancellationRequested = true;
    record.timedOut = false;
    if (record.idleTimer) clearTimeout(record.idleTimer);
    if (record.hardTimer) clearTimeout(record.hardTimer);
    if (record.forceKillTimer) clearTimeout(record.forceKillTimer);
    record.idleTimer = null;
    record.hardTimer = null;
    record.forceKillTimer = null;
    this.requestKill(record, "SIGTERM");
    if (!record.settled) {
      record.cancelKillTimer = setTimeout(() => {
        record.cancelKillTimer = null;
        if (!record.settled && record.cancellationRequested) this.requestKill(record, "SIGKILL");
      }, DEFAULT_EXEC_CANCEL_ESCALATION_MS);
      record.cancelKillTimer.unref?.();
    }
    return this.publicResult(record, { cancellationRequested: true });
  }

  async wait(input = {}) {
    const record = this.exactRecord(input);
    this.resolveGrant({ ...input, harnessGrant: record.grant, executionEnvironmentDigest: record.executionEnvironmentDigest }, "exec_command");
    return record.completion;
  }

  async initialYield(input = {}) {
    const record = this.exactRecord(input);
    this.resolveGrant({ ...input, harnessGrant: record.grant, executionEnvironmentDigest: record.executionEnvironmentDigest }, "exec_command");
    if (record.settled) return this.publicResult(record);
    return new Promise((resolve) => {
      let settled = false;
      let timer = null;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        this.removeListener("completed", onCompleted);
        resolve(result);
      };
      const onCompleted = (result) => {
        if (result?.sessionId === record.sessionId) finish(result);
      };
      this.on("completed", onCompleted);
      timer = setTimeout(() => finish(this.publicResult(record)), this.initialYieldMs);
    });
  }

  reconstructRecovery(snapshot = {}) {
    const rows = Array.isArray(snapshot) ? snapshot : (Array.isArray(snapshot.sessions) ? snapshot.sessions : []);
    return rows.map((source) => {
      if (!isPlainObject(source) || !normalizeString(source.sessionId, "")) return null;
      const record = {
        ...source,
        grant: source.grant || (this.grantStore && source.grantId && typeof this.grantStore.read === "function"
          ? (() => { try { return this.grantStore.read(source.grantId); } catch { return null; } })()
          : null),
        sessionState: TERMINAL_SESSION_STATES.has(source.sessionState) ? source.sessionState : "recovery_required",
        cleanupState: TERMINAL_SESSION_STATES.has(source.sessionState) ? "completed" : "unknown",
        recoveryClass: TERMINAL_SESSION_STATES.has(source.sessionState) ? "terminal_known" : "recovery_required",
        child: null,
        settled: TERMINAL_SESSION_STATES.has(source.sessionState),
        outputFrames: Array.isArray(source.outputFrames) ? source.outputFrames : [],
        outputBudgetChars: boundedInteger(source.outputBudgetChars, this.defaultOutputBudgetChars, 256, MAX_EXEC_OUTPUT_BUDGET_CHARS),
        providerResultBudgetChars: boundedInteger(source.providerResultBudgetChars, this.defaultProviderResultBudgetChars, 128, MAX_EXEC_PROVIDER_RESULT_BUDGET_CHARS),
      };
      record.completion = Promise.resolve(this.publicResult(record));
      this.sessions.set(record.sessionId, record);
      return this.publicResult(record);
    }).filter(Boolean);
  }

  restart(snapshot = {}) {
    return this.reconstructRecovery(snapshot);
  }

  waitForSettlement(records, deadlineAt) {
    if (!records.some((record) => !record.settled)) return Promise.resolve(true);
    return new Promise((resolve) => {
      let timer = null;
      let settled = false;
      const finish = (allSettled) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        this.removeListener("completed", onCompleted);
        resolve(allSettled);
      };
      const check = () => {
        if (!records.some((record) => !record.settled)) return finish(true);
        const remaining = deadlineAt - Date.now();
        if (remaining <= 0) return finish(false);
        timer = setTimeout(() => {
          timer = null;
          check();
        }, remaining);
        timer.unref?.();
      };
      const onCompleted = () => check();
      this.on("completed", onCompleted);
      check();
    });
  }

  dispose(reason = "stateful_exec_manager_disposed") {
    if (this.disposePromise) return this.disposePromise;
    this.disposed = true;
    this.disposePromise = (async () => {
      const records = [...this.sessions.values()].filter((record) => !record.settled);
      let sigkillEscalated = false;
      for (const record of records) {
        record.cancellationRequested = true;
        record.cleanupReason = reason;
        this.requestKill(record, "SIGTERM");
      }
      const cleanupDeadline = Date.now() + STATEFUL_EXEC_DISPOSE_DEADLINE_MS;
      const termGraceDeadline = Math.min(cleanupDeadline, Date.now() + STATEFUL_EXEC_DISPOSE_TERM_GRACE_MS);
      await this.waitForSettlement(records, termGraceDeadline);
      const survivors = records.filter((record) => !record.settled);
      if (survivors.length) {
        sigkillEscalated = true;
        for (const record of survivors) this.requestKill(record, "SIGKILL");
        await this.waitForSettlement(records, cleanupDeadline);
      }
      const unresolved = records.filter((record) => !record.settled);
      return Object.freeze({
        schema: "direct_stateful_exec_disposal_receipt@1",
        disposed: true,
        status: unresolved.length ? "unresolved_cleanup" : "completed",
        reason: boundedString(reason, 180),
        sigtermRequested: records.length > 0,
        sigkillEscalated,
        activeSessionCount: unresolved.length,
        liveSessionIds: unresolved.map((record) => record.sessionId),
        cleanupFailure: unresolved.length ? "direct_stateful_exec_cleanup_deadline_exceeded" : "",
      });
    })();
    return this.disposePromise;
  }

  snapshot() {
    return {
      schema: "direct_stateful_exec_session_recovery_snapshot@1",
      sessions: [...this.sessions.values()].map((record) => this.publicResult(record)),
      rawProcessDetailsIncluded: false,
    };
  }

  publicResult(record, extra = {}) {
    const surface = buildStatefulExecSessionSurface({
      projectId: record.projectId,
      workThreadId: record.threadId,
      sessionPlan: {
        sessionId: record.sessionId,
        projectId: record.projectId,
        workThreadId: record.threadId,
        commandPreview: record.commandPreview,
        commandClass: "plain_pipe_process_session",
        cwdEvidenceKey: `workspace_cwd_${record.executionEnvironmentDigest}`,
        transportMode: record.transportMode || "plain_pipe",
        sessionState: record.sessionState || "unknown",
        exitCode: record.exitCode,
        startedAt: record.startedAt,
        completedAt: record.completedAt,
        idleTimeoutMs: record.idleTimeoutMs,
        hardTimeoutMs: record.hardTimeoutMs,
        outputBudgetChars: record.outputBudgetChars || this.defaultOutputBudgetChars,
        providerResultBudgetChars: record.providerResultBudgetChars || this.defaultProviderResultBudgetChars,
        workspaceEffectScanRequired: true,
        cancellationSupported: true,
        processTreeCleanupRequired: true,
      },
      outputFrames: record.outputFrames || [],
      stdinPlan: {
        sessionId: record.sessionId,
        sessionState: record.sessionState,
        targetExists: true,
        stdinPolicy: record.stdinPolicy || "blocked_until_policy",
      },
      cleanupPlan: {
        cleanupState: record.cleanupState || "unknown",
        sessionState: record.sessionState,
        cancellationRequested: record.cancellationRequested === true,
      },
      recoveryClassification: {
        sessionState: record.sessionState,
        started: Boolean(record.startedAt),
        recoveryClass: record.recoveryClass,
      },
    });
    assertStatefulExecSessionSurfaceSafe(surface);
    const result = {
      schema: DIRECT_STATEFUL_EXEC_RESULT_SCHEMA,
      status: TERMINAL_SESSION_STATES.has(record.sessionState) ? record.sessionState : "running",
      sessionId: record.sessionId,
      taskId: record.taskId,
      threadId: record.threadId,
      projectId: record.projectId,
      executionEnvironmentDigest: record.executionEnvironmentDigest,
      grantId: record.grantId,
      grantRevision: Number(record.grantRevision || 0),
      commandPreview: record.commandPreview,
      cwdRelPath: record.cwdRelPath || "",
      transportMode: record.transportMode || "plain_pipe",
      sessionState: record.sessionState,
      startedAt: record.startedAt || "",
      completedAt: record.completedAt || "",
      exitCode: record.exitCode === undefined ? null : record.exitCode,
      signal: record.signal || "",
      spawnError: record.spawnError || "",
      timedOut: record.timedOut === true,
      cancellationRequested: record.cancellationRequested === true,
      stdinPolicy: record.stdinPolicy || "blocked_until_policy",
      stdinAccepted: extra.stdinAccepted === true,
      eofRequested: extra.eofRequested === true,
      errorCode: record.errorCode || "",
      stdinErrorCode: record.stdinErrorCode || "",
      outputFrames: surface.outputFrames,
      outputFrameCount: surface.outputFrameCount,
      outputFrameSequenceValid: surface.outputFrameSequenceValid,
      stdoutPreview: boundedString(record.stdoutPreview, record.providerResultBudgetChars || this.defaultProviderResultBudgetChars),
      stderrPreview: boundedString(record.stderrPreview, record.providerResultBudgetChars || this.defaultProviderResultBudgetChars),
      providerOutputChars: Number(record.providerOutputChars || 0),
      outputTruncated: (record.outputChars || 0) >= (record.outputBudgetChars || this.defaultOutputBudgetChars),
      cleanupState: record.cleanupState || "unknown",
      recoveryClassification: surface.recoveryClassification,
      surface,
      rawCommandIncluded: false,
      rawOutputIncluded: false,
      rawInputIncluded: false,
      rawPathIncluded: false,
      rawSecretIncluded: false,
      ...extra,
    };
    result.resultDigest = digestFor("direct-stateful-exec-result@1", result);
    return result;
  }
}

module.exports = {
  DIRECT_STATEFUL_EXEC_SESSION_SURFACE_SCHEMA,
  DIRECT_STATEFUL_EXEC_SESSION_PLAN_SCHEMA,
  DIRECT_STATEFUL_EXEC_OUTPUT_FRAME_SCHEMA,
  DIRECT_STATEFUL_EXEC_STDIN_PLAN_SCHEMA,
  DIRECT_STATEFUL_EXEC_CLEANUP_PLAN_SCHEMA,
  DIRECT_STATEFUL_EXEC_RECOVERY_CLASSIFICATION_SCHEMA,
  DIRECT_STATEFUL_EXEC_RESULT_SCHEMA,
  STATEFUL_EXEC_CAPABILITY_NAMES,
  buildStatefulExecSessionPlan,
  buildStatefulExecOutputFrame,
  buildStatefulExecStdinPlan,
  buildStatefulExecCleanupPlan,
  buildStatefulExecRecoveryClassification,
  buildStatefulExecSessionSurface,
  assertStatefulExecSessionSurfaceSafe,
  DirectStatefulExecSessionManager,
};
