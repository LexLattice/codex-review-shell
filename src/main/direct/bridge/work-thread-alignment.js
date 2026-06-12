"use strict";

const crypto = require("node:crypto");

const DIRECT_WORK_THREAD_CONTEXT_BINDING_SCHEMA = "direct_work_thread_context_binding@1";
const DIRECT_AUTHORITY_BEARING_TRANSITION_SCHEMA = "direct_authority_bearing_transition@1";

const TRANSITION_KINDS = new Set(["read_file", "apply_patch", "run_command", "unknown"]);
const TRANSITION_PHASES = new Set(["plan", "decision", "result", "continuation", "unknown"]);

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype;
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function boundedPreview(value, maxChars = 240) {
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1)).trim()}…`;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (isPlainObject(value)) {
    const output = {};
    for (const key of Object.keys(value).sort()) {
      if (["bindingDigest", "transitionDigest", "artifactDigest"].includes(key)) continue;
      if (value[key] !== undefined) output[key] = stableValue(value[key]);
    }
    return output;
  }
  return value;
}

function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function digestValue(prefix, value) {
  return `sha256:${sha256(`${prefix}\0${stableStringify(value)}`)}`;
}

function normalizeBridgeInformationRef(input = {}, fallbackClassId = "") {
  const source = isPlainObject(input) ? input : {};
  const classId = normalizeString(source.classId || source.id || source.bridgeInformationClassId, fallbackClassId);
  const ref = {
    classId,
    role: normalizeString(source.role, ""),
    artifactKind: normalizeString(source.artifactKind, ""),
    artifactId: normalizeString(source.artifactId, ""),
    artifactDigest: normalizeString(source.artifactDigest || source.digest, ""),
    sourceWorld: normalizeString(source.sourceWorld, ""),
    confidence: normalizeString(source.confidence, "declared"),
    rawTextIncluded: false,
    rawPathIncluded: false,
  };
  ref.refDigest = digestValue("direct-bridge-information-ref@1", ref);
  return ref;
}

function normalizeBridgeInformationRefs(values = [], fallbackClassId = "") {
  return (Array.isArray(values) ? values : [])
    .map((value) => normalizeBridgeInformationRef(value, fallbackClassId))
    .filter((ref) => ref.classId || ref.artifactId || ref.artifactDigest);
}

function normalizeAuthorityBoundary(boundary = {}) {
  const source = isPlainObject(boundary) ? boundary : {};
  const allowedActions = Array.isArray(source.allowedActions) ? source.allowedActions.map(String).filter(Boolean) : [];
  const forbiddenActions = Array.isArray(source.forbiddenActions)
    ? source.forbiddenActions.map(String).filter(Boolean)
    : ["workspace_mutation_before_target_resolution"];
  return {
    mutationAllowedBeforeResolution: source.mutationAllowedBeforeResolution === true,
    allowedActions,
    forbiddenActions,
    summary: boundedPreview(source.summary || source.rendererSafeSummary, 320),
    rawTextIncluded: false,
    rawPathIncluded: false,
  };
}

function normalizeObligationRef(input = {}, index = 0) {
  const source = isPlainObject(input) ? input : {};
  const ref = {
    obligationId: normalizeString(source.obligationId || source.id, `obligation_${index + 1}`),
    kind: normalizeString(source.kind || source.obligationKind, "unknown"),
    status: normalizeString(source.status, "open"),
    summary: boundedPreview(source.summary || source.label || source.description, 220),
    rawTextIncluded: false,
    rawPathIncluded: false,
  };
  ref.refDigest = digestValue("direct-work-thread-obligation-ref@1", ref);
  return ref;
}

function buildWorkThreadContextBinding(input = {}) {
  if (isPlainObject(input) && input.schema === DIRECT_WORK_THREAD_CONTEXT_BINDING_SCHEMA) {
    const binding = {
      ...input,
      rawTextIncluded: false,
      rawPathIncluded: false,
      mutationAllowed: false,
      providerCallAllowed: false,
      routingEnforced: false,
    };
    binding.bindingDigest = digestValue("direct-work-thread-context-binding@1", binding);
    return binding;
  }
  const workThread = isPlainObject(input.workThread) ? input.workThread : {};
  const workThreadId = normalizeString(input.workThreadId || workThread.workThreadId, "");
  const authorityBoundary = normalizeAuthorityBoundary(input.authorityBoundary || workThread.authorityBoundary);
  const openObligationRefs = (Array.isArray(input.openObligations)
    ? input.openObligations
    : (Array.isArray(workThread.openObligations) ? workThread.openObligations : []))
    .map(normalizeObligationRef);
  const binding = {
    schema: DIRECT_WORK_THREAD_CONTEXT_BINDING_SCHEMA,
    workThreadId,
    projectId: normalizeString(input.projectId || workThread.projectId, ""),
    title: boundedPreview(input.title || workThread.title, 180),
    lifecycleState: normalizeString(input.lifecycleState || workThread.lifecycleState, "unknown"),
    activeRuntimePath: normalizeString(input.activeRuntimePath || workThread.activeRuntimePath, "unknown"),
    contextPacketRef: normalizeBridgeInformationRef(input.contextPacketRef || workThread.contextPacketRef, "context_packet"),
    authorityBoundary,
    authorityBoundaryDigest: digestValue("direct-work-thread-authority-boundary@1", authorityBoundary),
    openObligationRefs,
    openObligationCount: openObligationRefs.length,
    bridgeInformationRefs: normalizeBridgeInformationRefs(input.bridgeInformationRefs, "ic12.work-thread-registry"),
    bindingMode: normalizeString(input.bindingMode, "shadow_context_alignment"),
    mutationAllowed: false,
    providerCallAllowed: false,
    routingEnforced: false,
    rawTextIncluded: false,
    rawPathIncluded: false,
  };
  binding.bindingDigest = digestValue("direct-work-thread-context-binding@1", binding);
  return binding;
}

function normalizeTransitionKind(value) {
  const kind = normalizeString(value, "unknown");
  return TRANSITION_KINDS.has(kind) ? kind : "unknown";
}

function normalizeTransitionPhase(value) {
  const phase = normalizeString(value, "unknown");
  return TRANSITION_PHASES.has(phase) ? phase : "unknown";
}

function buildAuthorityBearingTransition(input = {}) {
  const workThreadBinding = isPlainObject(input.workThreadBinding)
    ? buildWorkThreadContextBinding(input.workThreadBinding)
    : buildWorkThreadContextBinding({
        workThread: input.workThread,
        workThreadId: input.workThreadId,
        projectId: input.projectId,
        authorityBoundary: input.authorityBoundary,
        openObligations: input.openObligations,
        bridgeInformationRefs: input.bridgeInformationRefs,
      });
  const sourceArtifact = normalizeBridgeInformationRef(input.sourceArtifact, "");
  const transitionKind = normalizeTransitionKind(input.transitionKind || input.kind);
  const transitionPhase = normalizeTransitionPhase(input.transitionPhase || input.phase);
  const projectId = normalizeString(input.projectId || workThreadBinding.projectId, "");
  const threadId = normalizeString(input.threadId, "");
  const turnId = normalizeString(input.turnId, "");
  const obligationId = normalizeString(input.obligationId, "");
  const transition = {
    schema: DIRECT_AUTHORITY_BEARING_TRANSITION_SCHEMA,
    transitionId: normalizeString(input.transitionId, `authority_transition_${sha256(stableStringify({
      transitionKind,
      transitionPhase,
      projectId,
      threadId,
      turnId,
      obligationId,
      sourceArtifact,
    })).slice(0, 24)}`),
    transitionKind,
    transitionPhase,
    projectId,
    threadId,
    turnId,
    obligationId,
    status: normalizeString(input.status, "unknown"),
    workThreadBinding,
    workThreadId: workThreadBinding.workThreadId,
    authorityBoundaryDigest: workThreadBinding.authorityBoundaryDigest,
    sourceArtifact,
    bridgeInformationRefs: normalizeBridgeInformationRefs(input.bridgeInformationRefs, ""),
    sideEffectExecuted: input.sideEffectExecuted === true,
    providerContinuationSent: input.providerContinuationSent === true,
    mutationAllowedByTransition: false,
    providerCallAllowedByTransition: false,
    routingEnforced: false,
    rawTextIncluded: false,
    rawPathIncluded: false,
    createdAt: normalizeString(input.createdAt, ""),
  };
  transition.transitionDigest = digestValue("direct-authority-bearing-transition@1", transition);
  return transition;
}

module.exports = {
  DIRECT_AUTHORITY_BEARING_TRANSITION_SCHEMA,
  DIRECT_WORK_THREAD_CONTEXT_BINDING_SCHEMA,
  buildAuthorityBearingTransition,
  buildWorkThreadContextBinding,
  normalizeBridgeInformationRef,
  normalizeBridgeInformationRefs,
};
