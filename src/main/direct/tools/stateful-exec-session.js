"use strict";

const crypto = require("node:crypto");

const DIRECT_STATEFUL_EXEC_SESSION_SURFACE_SCHEMA = "direct_stateful_exec_session_surface@1";
const DIRECT_STATEFUL_EXEC_SESSION_PLAN_SCHEMA = "direct_stateful_exec_session_plan@1";
const DIRECT_STATEFUL_EXEC_OUTPUT_FRAME_SCHEMA = "direct_stateful_exec_output_frame@1";
const DIRECT_STATEFUL_EXEC_STDIN_PLAN_SCHEMA = "direct_stateful_exec_stdin_plan@1";
const DIRECT_STATEFUL_EXEC_CLEANUP_PLAN_SCHEMA = "direct_stateful_exec_cleanup_plan@1";
const DIRECT_STATEFUL_EXEC_RECOVERY_CLASSIFICATION_SCHEMA = "direct_stateful_exec_recovery_classification@1";

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
  const originalChars = nonNegativeNumber(source.originalChars ?? source.textChars ?? source.previewChars, 0);
  const previewChars = nonNegativeNumber(source.previewChars ?? Math.min(originalChars, positiveNumber(source.outputBudgetChars, 24_000)), 0);
  const frame = {
    schema: DIRECT_STATEFUL_EXEC_OUTPUT_FRAME_SCHEMA,
    frameId: boundedString(source.frameId || `exec_output_frame_${digestFor("direct-stateful-exec-output-frame-source@1", source).slice(0, 24)}`, 160),
    sessionId: normalizeSessionId(source),
    sequence,
    stream: normalizeEnum(source.stream, OUTPUT_STREAMS, "combined"),
    observedAt: boundedString(source.observedAt || source.createdAt || nowIso(source.nowMs), 80),
    originalChars,
    previewChars,
    truncated: source.truncated === true || originalChars > previewChars,
    providerVisible: source.providerVisible === true,
    providerIncludedChars: nonNegativeNumber(source.providerIncludedChars ?? Math.min(previewChars, positiveNumber(source.providerResultBudgetChars, 12_000)), 0),
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
  const classification = {
    schema: DIRECT_STATEFUL_EXEC_RECOVERY_CLASSIFICATION_SCHEMA,
    recoveryId: boundedString(source.recoveryId || `exec_recovery_${digestFor("direct-stateful-exec-recovery-source@1", source).slice(0, 24)}`, 160),
    sessionId: normalizeSessionId(source.sessionId ? source : session),
    sessionState,
    recoveryClass: normalizeEnum(source.recoveryClass, RECOVERY_CLASSES, recoveryClass),
    replayAllowed: false,
    replayForbiddenReason: started ? "process_side_effects_may_have_occurred" : "not_started_replay_unneeded",
    requiresHumanReconciliation: ["running_unknown", "cleanup_required", "recovery_required", "unknown"].includes(recoveryClass),
    terminalSuccessClaimAllowed: recoveryClass === "terminal_known" && sessionState === "completed",
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
  const outputFrames = arrayOrEmpty(source.outputFrames).map((frame) => buildStatefulExecOutputFrame({ ...frame, sessionId: sessionPlan.sessionId }));
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

module.exports = {
  DIRECT_STATEFUL_EXEC_SESSION_SURFACE_SCHEMA,
  DIRECT_STATEFUL_EXEC_SESSION_PLAN_SCHEMA,
  DIRECT_STATEFUL_EXEC_OUTPUT_FRAME_SCHEMA,
  DIRECT_STATEFUL_EXEC_STDIN_PLAN_SCHEMA,
  DIRECT_STATEFUL_EXEC_CLEANUP_PLAN_SCHEMA,
  DIRECT_STATEFUL_EXEC_RECOVERY_CLASSIFICATION_SCHEMA,
  buildStatefulExecSessionPlan,
  buildStatefulExecOutputFrame,
  buildStatefulExecStdinPlan,
  buildStatefulExecCleanupPlan,
  buildStatefulExecRecoveryClassification,
  buildStatefulExecSessionSurface,
  assertStatefulExecSessionSurfaceSafe,
};
