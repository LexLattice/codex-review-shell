"use strict";

const crypto = require("node:crypto");

const CODE_MODE_KERNEL_SESSION_SCHEMA = "code_mode_kernel_session@1";
const CODE_MODE_EXECUTE_POSTURE_SCHEMA = "code_mode_execute_request_posture@1";
const CODE_MODE_WAIT_CANCEL_POLICY_SCHEMA = "code_mode_wait_cancel_policy@1";
const CODE_MODE_ARTIFACT_OUTPUT_POLICY_SCHEMA = "code_mode_artifact_output_policy@1";
const CODE_MODE_EXECUTION_LANE_STATUS_SCHEMA = "code_mode_execution_lane_status@1";

const KERNEL_STATES = new Set(["not_started", "planned", "starting", "idle", "busy", "waiting", "completed", "failed", "cancelled", "unknown"]);
const EXECUTE_STATES = new Set([
  "not_requested",
  "blocked_missing_kernel_authority",
  "blocked_request_shape_not_declared",
  "blocked_execution_not_enabled",
  "queued",
  "running",
  "completed",
  "failed",
  "unknown",
]);
const WAIT_STATES = new Set(["not_requested", "blocked_no_active_execution", "blocked_execution_not_enabled", "waiting", "completed", "failed", "unknown"]);
const CANCEL_STATES = new Set(["not_requested", "blocked_no_active_execution", "blocked_execution_not_enabled", "requested", "completed", "failed", "unknown"]);
const ARTIFACT_STATES = new Set(["not_available", "metadata_only", "staged_reference_required", "blocked_raw_artifact", "unknown"]);
const RESOURCE_CLASSES = new Set(["none", "low", "medium", "high", "unknown"]);

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

function normalizeBoolean(value) {
  return value === true;
}

function normalizeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function normalizeEnum(value, allowed, fallback) {
  const text = normalizeString(value, fallback);
  return allowed.has(text) ? text : fallback;
}

function normalizeStringList(values, fallback = []) {
  const source = Array.isArray(values) ? values : fallback;
  return [...new Set(source.map((value) => normalizeString(value, "")).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function stableStringifyValue(value, seen) {
  if (value && typeof value.toJSON === "function") return stableStringifyValue(value.toJSON(), seen);
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (seen.has(value)) return JSON.stringify("[Circular]");
  seen.add(value);
  if (Array.isArray(value)) {
    const result = `[${value.map((entry) => (entry === undefined ? "null" : stableStringifyValue(entry, seen))).join(",")}]`;
    seen.delete(value);
    return result;
  }
  const result = `{${Object.keys(value)
    .filter((key) => value[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringifyValue(value[key], seen)}`)
    .join(",")}}`;
  seen.delete(value);
  return result;
}

function stableStringify(value) {
  return stableStringifyValue(value, new WeakSet());
}

function digestFor(domain, value) {
  return crypto.createHash("sha256").update(`${domain}:${stableStringify(value)}`).digest("hex");
}

function nowIso(nowMs) {
  const ms = typeof nowMs === "number" && !Number.isNaN(nowMs) ? nowMs : Date.now();
  return new Date(ms).toISOString();
}

function evidenceRef(input = {}) {
  const ref = {
    kind: boundedString(input.kind || "code_mode_execution_lane", 120),
    evidenceKey: boundedString(input.evidenceKey || input.digest || digestFor("code-mode-evidence-ref-source@1", input).slice(0, 24), 160),
    label: boundedString(input.label || input.kind || "Code mode execution lane", 180),
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  ref.refDigest = digestFor("code-mode-evidence-ref@1", ref);
  return ref;
}

function defaultId(prefix, input) {
  return `${prefix}_${digestFor(`code-mode-${prefix}-source@1`, input).slice(0, 24)}`;
}

function buildCodeModeKernelSession(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const session = {
    schema: CODE_MODE_KERNEL_SESSION_SCHEMA,
    kernelSessionId: boundedString(source.kernelSessionId || defaultId("kernel_session", source), 180),
    projectId: boundedString(source.projectId, 160),
    workThreadId: boundedString(source.workThreadId, 160),
    threadId: boundedString(source.threadId, 180),
    kernelKind: boundedString(source.kernelKind || "provider_code_mode", 120),
    language: boundedString(source.language || "unknown", 80),
    state: normalizeEnum(source.state || source.kernelState, KERNEL_STATES, "not_started"),
    resourceClass: normalizeEnum(source.resourceClass, RESOURCE_CLASSES, "unknown"),
    maxWallTimeMs: normalizeNumber(source.maxWallTimeMs, 0),
    maxOutputBytes: normalizeNumber(source.maxOutputBytes, 0),
    idleTimeoutMs: normalizeNumber(source.idleTimeoutMs, 0),
    createdAt: normalizeString(source.createdAt, nowIso(source.nowMs)),
    evidenceRefs: normalizeStringList(source.evidenceRefs).map((label) => evidenceRef({ kind: "kernel_session_evidence", label })),
    kernelStartAllowed: false,
    providerDeclarationAllowed: false,
    providerTransportAllowed: false,
    localExecutionAllowed: false,
    requestShapeMutationAllowed: false,
    shellApprovalProfileInherited: false,
    rawCodeIncluded: false,
    rawOutputIncluded: false,
    rawArtifactIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  session.sessionDigest = digestFor("code-mode-kernel-session@1", session);
  return session;
}

function buildCodeModeExecutePosture(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const posture = {
    schema: CODE_MODE_EXECUTE_POSTURE_SCHEMA,
    executeRequestId: boundedString(source.executeRequestId || defaultId("execute_request", source), 180),
    kernelSessionId: boundedString(source.kernelSessionId, 180),
    projectId: boundedString(source.projectId, 160),
    workThreadId: boundedString(source.workThreadId, 160),
    executionState: normalizeEnum(source.executionState, EXECUTE_STATES, "blocked_execution_not_enabled"),
    codeEvidenceKey: boundedString(source.codeEvidenceKey, 180),
    inputEvidenceKey: boundedString(source.inputEvidenceKey, 180),
    requestShapeFamily: boundedString(source.requestShapeFamily || "code_mode_execute_request_posture", 160),
    estimatedResourceClass: normalizeEnum(source.estimatedResourceClass, RESOURCE_CLASSES, "unknown"),
    waitRequired: normalizeBoolean(source.waitRequired),
    providerVisibleOutputBudgetBytes: normalizeNumber(source.providerVisibleOutputBudgetBytes, 0),
    createdAt: normalizeString(source.createdAt, nowIso(source.nowMs)),
    codeVisibleToProvider: false,
    providerDeclarationAllowed: false,
    providerTransportAllowed: false,
    localExecutionAllowed: false,
    requestShapeMutationAllowed: false,
    shellApprovalProfileInherited: false,
    workspaceMutationAllowed: false,
    rawCodeIncluded: false,
    rawInputIncluded: false,
    rawOutputIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  posture.postureDigest = digestFor("code-mode-execute-posture@1", posture);
  return posture;
}

function buildCodeModeWaitCancelPolicy(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const policy = {
    schema: CODE_MODE_WAIT_CANCEL_POLICY_SCHEMA,
    policyId: boundedString(source.policyId || defaultId("wait_cancel_policy", source), 180),
    kernelSessionId: boundedString(source.kernelSessionId, 180),
    executeRequestId: boundedString(source.executeRequestId, 180),
    waitState: normalizeEnum(source.waitState, WAIT_STATES, "blocked_execution_not_enabled"),
    cancelState: normalizeEnum(source.cancelState, CANCEL_STATES, "blocked_execution_not_enabled"),
    waitTimeoutMs: normalizeNumber(source.waitTimeoutMs, 0),
    cancelTimeoutMs: normalizeNumber(source.cancelTimeoutMs, 0),
    cleanupRequired: source.cleanupRequired !== false,
    resultPollingAllowed: false,
    providerCancelAllowed: false,
    localKernelCancelAllowed: false,
    localExecutionAllowed: false,
    requestShapeMutationAllowed: false,
    rawOutputIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  policy.policyDigest = digestFor("code-mode-wait-cancel-policy@1", policy);
  return policy;
}

function buildCodeModeArtifactOutputPolicy(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const policy = {
    schema: CODE_MODE_ARTIFACT_OUTPUT_POLICY_SCHEMA,
    artifactPolicyId: boundedString(source.artifactPolicyId || defaultId("artifact_policy", source), 180),
    kernelSessionId: boundedString(source.kernelSessionId, 180),
    artifactState: normalizeEnum(source.artifactState, ARTIFACT_STATES, "metadata_only"),
    allowedArtifactKinds: normalizeStringList(source.allowedArtifactKinds, ["text_summary", "structured_result_ref"]),
    maxArtifactBytes: normalizeNumber(source.maxArtifactBytes, 0),
    artifactRefPolicy: boundedString(source.artifactRefPolicy || "metadata_only", 120),
    providerContextInjectionAllowed: false,
    workspaceMutationAllowed: false,
    artifactWriteAllowed: false,
    rawArtifactIncluded: false,
    rawOutputIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  policy.policyDigest = digestFor("code-mode-artifact-output-policy@1", policy);
  return policy;
}

function buildCodeModeExecutionLaneStatus(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const projectId = boundedString(source.projectId, 160);
  const workThreadId = boundedString(source.workThreadId, 160);
  const threadId = boundedString(source.threadId, 180);
  const kernelSession = buildCodeModeKernelSession({
    projectId,
    workThreadId,
    threadId,
    ...(isPlainObject(source.kernelSession) ? source.kernelSession : {}),
    nowMs: source.nowMs,
  });
  const executePosture = buildCodeModeExecutePosture({
    projectId,
    workThreadId,
    kernelSessionId: kernelSession.kernelSessionId,
    ...(isPlainObject(source.executePosture) ? source.executePosture : {}),
    nowMs: source.nowMs,
  });
  const waitCancelPolicy = buildCodeModeWaitCancelPolicy({
    kernelSessionId: kernelSession.kernelSessionId,
    executeRequestId: executePosture.executeRequestId,
    ...(isPlainObject(source.waitCancelPolicy) ? source.waitCancelPolicy : {}),
  });
  const artifactOutputPolicy = buildCodeModeArtifactOutputPolicy({
    kernelSessionId: kernelSession.kernelSessionId,
    ...(isPlainObject(source.artifactOutputPolicy) ? source.artifactOutputPolicy : {}),
  });
  const status = {
    schema: CODE_MODE_EXECUTION_LANE_STATUS_SCHEMA,
    laneId: boundedString(source.laneId || defaultId("execution_lane", { projectId, workThreadId, threadId, kernelSession, executePosture }), 180),
    projectId,
    workThreadId,
    threadId,
    mode: "projection_only",
    laneState: "blocked_until_kernel_authority",
    authorityRequired: "code_mode_execution_gate",
    kernelSession,
    executePosture,
    waitCancelPolicy,
    artifactOutputPolicy,
    kernelSessionCount: kernelSession.state === "not_started" ? 0 : 1,
    activeExecutionCount: executePosture.executionState === "running" ? 1 : 0,
    artifactPolicyCount: 1,
    kernelStartEnabledInThisPr: false,
    executeToolEnabledInThisPr: false,
    waitToolEnabledInThisPr: false,
    cancelToolEnabledInThisPr: false,
    artifactWriteEnabledInThisPr: false,
    providerDeclarationAllowed: false,
    providerTransportAllowed: false,
    localExecutionAllowed: false,
    requestShapeMutationAllowed: false,
    shellApprovalProfileInherited: false,
    workspaceMutationAllowed: false,
    providerContextInjectionAllowed: false,
    rawCodeIncluded: false,
    rawInputIncluded: false,
    rawOutputIncluded: false,
    rawArtifactIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
    generatedAt: normalizeString(source.generatedAt, nowIso(source.nowMs)),
    rendererSafeSummary: "Code mode is modeled as a separate kernel/session/artifact lane; execution remains blocked until explicit code-mode authority exists.",
  };
  status.statusDigest = digestFor("code-mode-execution-lane-status@1", status);
  return status;
}

function assertCodeModeExecutionLaneSafe(status = {}) {
  if (!isPlainObject(status) || status.schema !== CODE_MODE_EXECUTION_LANE_STATUS_SCHEMA) {
    throw new Error("code_mode_execution_lane_schema_mismatch");
  }
  if (!isPlainObject(status.kernelSession) || status.kernelSession.schema !== CODE_MODE_KERNEL_SESSION_SCHEMA) {
    throw new Error("code_mode_kernel_session_schema_mismatch");
  }
  if (!isPlainObject(status.executePosture) || status.executePosture.schema !== CODE_MODE_EXECUTE_POSTURE_SCHEMA) {
    throw new Error("code_mode_execute_posture_schema_mismatch");
  }
  if (!isPlainObject(status.waitCancelPolicy) || status.waitCancelPolicy.schema !== CODE_MODE_WAIT_CANCEL_POLICY_SCHEMA) {
    throw new Error("code_mode_wait_cancel_policy_schema_mismatch");
  }
  if (!isPlainObject(status.artifactOutputPolicy) || status.artifactOutputPolicy.schema !== CODE_MODE_ARTIFACT_OUTPUT_POLICY_SCHEMA) {
    throw new Error("code_mode_artifact_output_policy_schema_mismatch");
  }
  const forbiddenTrueFlags = [
    "kernelStartEnabledInThisPr",
    "executeToolEnabledInThisPr",
    "waitToolEnabledInThisPr",
    "cancelToolEnabledInThisPr",
    "artifactWriteEnabledInThisPr",
    "providerDeclarationAllowed",
    "providerTransportAllowed",
    "localExecutionAllowed",
    "requestShapeMutationAllowed",
    "shellApprovalProfileInherited",
    "workspaceMutationAllowed",
    "providerContextInjectionAllowed",
    "rawCodeIncluded",
    "rawInputIncluded",
    "rawOutputIncluded",
    "rawArtifactIncluded",
    "rawPathIncluded",
    "rawSecretIncluded",
  ];
  for (const flag of forbiddenTrueFlags) {
    if (status[flag] !== false) throw new Error(`code_mode_execution_lane_authority_leak:${flag}`);
  }
  for (const part of [status.kernelSession, status.executePosture, status.waitCancelPolicy, status.artifactOutputPolicy]) {
    for (const flag of [
      "providerDeclarationAllowed",
      "providerTransportAllowed",
      "localExecutionAllowed",
      "requestShapeMutationAllowed",
      "shellApprovalProfileInherited",
      "workspaceMutationAllowed",
      "providerContextInjectionAllowed",
      "artifactWriteAllowed",
      "rawCodeIncluded",
      "rawInputIncluded",
      "rawOutputIncluded",
      "rawArtifactIncluded",
      "rawPathIncluded",
      "rawSecretIncluded",
    ]) {
      if (part[flag] === true) throw new Error(`code_mode_execution_lane_part_authority_leak:${flag}`);
    }
  }
  if (status.mode !== "projection_only" || status.laneState !== "blocked_until_kernel_authority") {
    throw new Error("code_mode_execution_lane_unexpected_operational_state");
  }
  return true;
}

module.exports = {
  CODE_MODE_ARTIFACT_OUTPUT_POLICY_SCHEMA,
  CODE_MODE_EXECUTE_POSTURE_SCHEMA,
  CODE_MODE_EXECUTION_LANE_STATUS_SCHEMA,
  CODE_MODE_KERNEL_SESSION_SCHEMA,
  CODE_MODE_WAIT_CANCEL_POLICY_SCHEMA,
  assertCodeModeExecutionLaneSafe,
  buildCodeModeArtifactOutputPolicy,
  buildCodeModeExecutePosture,
  buildCodeModeExecutionLaneStatus,
  buildCodeModeKernelSession,
  buildCodeModeWaitCancelPolicy,
  stableStringify,
};
