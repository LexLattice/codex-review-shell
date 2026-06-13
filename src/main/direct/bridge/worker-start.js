"use strict";

const crypto = require("node:crypto");
const {
  DIRECT_ROLE_HANDOFF_PACKET_SCHEMA,
  stableStringify,
  validateDirectRoleHandoffPacket,
} = require("./role-handoff-packet");

const DIRECT_WORKER_START_TRANSITION_SCHEMA = "direct_worker_start_transition@1";
const DIRECT_WORKER_CONTEXT_PACKET_SCHEMA = "direct_worker_context_packet@1";
const DIRECT_WORKER_START_RESULT_SCHEMA = "direct_worker_start_result@1";
const DIRECT_WORKER_START_VERSION = "direct-worker-start@1";

const WORKER_START_STATES = new Set(["ready_to_start", "blocked", "started", "failed"]);

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype;
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function boundedString(value, maxLength = 360) {
  const text = normalizeString(value, "");
  return text.length > maxLength ? `${text.slice(0, Math.max(0, maxLength - 3))}...` : text;
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function digestFor(domain, value) {
  return `sha256:${sha256(`${domain}:${stableStringify(value)}`)}`;
}

function isoTimestamp(input) {
  if (input instanceof Date && !Number.isNaN(input.getTime())) return input.toISOString();
  if (typeof input === "number" && Number.isFinite(input)) return new Date(input).toISOString();
  const parsed = Date.parse(normalizeString(input, ""));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString();
}

function normalizeEvidenceRef(input = {}, fallbackKind = "unknown") {
  const source = isPlainObject(input) ? input : {};
  const artifactId = normalizeString(source.artifactId || source.id || source.refId, "");
  const artifactDigest = normalizeString(source.artifactDigest || source.digest || source.specDigest, "");
  if (!artifactId && !artifactDigest) return null;
  return {
    kind: normalizeString(source.kind, fallbackKind),
    artifactId,
    artifactDigest,
    sourceConfidence: normalizeString(source.sourceConfidence || source.confidence, "diagnostic"),
    rendererSafeLabel: boundedString(source.rendererSafeLabel || source.label || fallbackKind, 120),
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
}

function normalizeEvidenceRefs(value, fallbackKind) {
  return (Array.isArray(value) ? value : [])
    .map((entry) => normalizeEvidenceRef(entry, fallbackKind))
    .filter(Boolean);
}

function operatorAcceptance(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const decision = normalizeString(source.decision || source.operatorDecision, "");
  return {
    decision,
    accepted: source.accepted === true || decision === "accept" || decision === "accepted",
    rejected: source.rejected === true || decision === "reject" || decision === "rejected",
    operatorActionId: normalizeString(source.operatorActionId || source.actionId, ""),
    acceptedAt: normalizeString(source.acceptedAt || source.decidedAt, ""),
    rendererSafeLabel: boundedString(source.rendererSafeLabel || "Operator role-handoff decision", 160),
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
}

function handoffRef(packet = {}) {
  const source = isPlainObject(packet) ? packet : {};
  return {
    handoffPacketId: normalizeString(source.handoffPacketId, ""),
    handoffPacketDigest: normalizeString(source.packetDigest || source.sourceDigest, ""),
    status: normalizeString(source.status, ""),
    selectedWorkThreadId: normalizeString(source.workThreadRef?.workThreadId, ""),
    selectedAgentClassId: normalizeString(source.selectedAgentClass?.agentClassId, ""),
    selectedAgentClassKind: normalizeString(source.selectedAgentClass?.agentClassKind, ""),
    expectedOutputArtifactFamily: normalizeString(source.expectedOutputArtifactFamily, ""),
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
}

function transitionBlockers({ projectId, handoffPacket, acceptance, workerPrompt }) {
  const blockers = [];
  if (!isPlainObject(handoffPacket) || handoffPacket.schema !== DIRECT_ROLE_HANDOFF_PACKET_SCHEMA) {
    blockers.push("handoff_packet_missing_or_invalid");
    return blockers;
  }
  const requestedProjectId = normalizeString(projectId, "");
  const handoffProjectId = normalizeString(handoffPacket.projectId, "");
  if (requestedProjectId && handoffProjectId && requestedProjectId !== handoffProjectId) {
    blockers.push("handoff_project_id_mismatch");
  }
  try {
    validateDirectRoleHandoffPacket(handoffPacket);
  } catch (error) {
    blockers.push(`handoff_packet_validation_failed:${normalizeString(error.message, "unknown")}`);
  }
  if (handoffPacket.status !== "operator_review_required") blockers.push("handoff_not_ready_for_operator_review");
  if (Array.isArray(handoffPacket.blockerCodes) && handoffPacket.blockerCodes.length) blockers.push("handoff_has_blockers");
  if (!acceptance.accepted) blockers.push(acceptance.rejected ? "operator_rejected_handoff" : "operator_acceptance_missing");
  if (normalizeString(handoffPacket.selectedAgentClass?.agentClassKind, "") === "primary_agent") blockers.push("primary_agent_worker_start_forbidden");
  if (!normalizeString(handoffPacket.workThreadRef?.workThreadId, "")) blockers.push("work_thread_ref_missing");
  if (!normalizeString(handoffPacket.selectedAgentClass?.agentClassId, "")) blockers.push("agent_class_ref_missing");
  if (!normalizeString(workerPrompt, "")) blockers.push("worker_prompt_missing");
  return [...new Set(blockers)];
}

function buildDirectWorkerContextPacket(input = {}, opts = {}) {
  const source = isPlainObject(input) ? input : {};
  const handoffPacket = isPlainObject(source.handoffPacket) ? source.handoffPacket : {};
  const prompt = normalizeString(source.workerPrompt || source.prompt, "");
  const contextRefs = [
    normalizeEvidenceRef({
      kind: "role_handoff_packet",
      artifactId: handoffPacket.handoffPacketId,
      artifactDigest: handoffPacket.packetDigest,
      sourceConfidence: "accepted",
      rendererSafeLabel: "Accepted role handoff packet",
    }, "role_handoff_packet"),
    ...normalizeEvidenceRefs(handoffPacket.contextRefs, "context_pack"),
    ...normalizeEvidenceRefs(handoffPacket.requestRefs, "request_manifest"),
    ...normalizeEvidenceRefs(source.contextRefs, "context_pack"),
  ].filter(Boolean);
  const sourceDigest = digestFor("direct-worker-context-packet-source@1", {
    handoffPacketId: handoffPacket.handoffPacketId || "",
    handoffPacketDigest: handoffPacket.packetDigest || "",
    workerPromptDigest: sha256(prompt),
    contextRefs,
  });
  const packet = {
    schema: DIRECT_WORKER_CONTEXT_PACKET_SCHEMA,
    version: DIRECT_WORKER_START_VERSION,
    workerContextPacketId: normalizeString(source.workerContextPacketId, `worker_context_${sourceDigest.slice(7, 31)}`),
    projectId: normalizeString(source.projectId || handoffPacket.projectId, ""),
    parentThreadId: normalizeString(source.parentThreadId || handoffPacket.threadId, ""),
    workThreadId: normalizeString(handoffPacket.workThreadRef?.workThreadId || source.workThreadId, ""),
    handoffPacketId: normalizeString(handoffPacket.handoffPacketId, ""),
    handoffPacketDigest: normalizeString(handoffPacket.packetDigest, ""),
    agentClassId: normalizeString(handoffPacket.selectedAgentClass?.agentClassId, ""),
    agentClassKind: normalizeString(handoffPacket.selectedAgentClass?.agentClassKind, ""),
    expectedOutputArtifactFamily: normalizeString(handoffPacket.expectedOutputArtifactFamily, ""),
    workerPromptDigest: sha256(prompt),
    workerPromptPreview: boundedString(prompt, 240),
    contextRefs,
    contextRefCount: contextRefs.length,
    createdAt: isoTimestamp(opts.nowMs ?? source.nowMs ?? source.createdAt),
    providerInputEligible: true,
    rawPromptIncluded: false,
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
    sourceDigest,
  };
  packet.contextPacketDigest = digestFor(DIRECT_WORKER_CONTEXT_PACKET_SCHEMA, { ...packet, contextPacketDigest: "" });
  return packet;
}

function buildDirectWorkerStartTransition(input = {}, opts = {}) {
  const source = isPlainObject(input) ? input : {};
  const handoffPacket = isPlainObject(source.handoffPacket) ? source.handoffPacket : {};
  const acceptance = operatorAcceptance(source.operatorAcceptance || source.acceptance || {});
  const workerPrompt = normalizeString(source.workerPrompt || source.prompt, "");
  const projectId = normalizeString(source.projectId || handoffPacket.projectId, "");
  const blockerCodes = transitionBlockers({ projectId, handoffPacket, acceptance, workerPrompt });
  const startState = blockerCodes.length ? "blocked" : "ready_to_start";
  const contextPacket = buildDirectWorkerContextPacket({
    ...source,
    handoffPacket,
    workerPrompt,
  }, opts);
  const selectedAgentClass = isPlainObject(handoffPacket.selectedAgentClass) ? handoffPacket.selectedAgentClass : {};
  const sourceDigest = digestFor("direct-worker-start-transition-source@1", {
    handoffRef: handoffRef(handoffPacket),
    acceptance,
    workerPromptDigest: sha256(workerPrompt),
    contextPacketSourceDigest: contextPacket.sourceDigest,
    blockerCodes,
  });
  const transition = {
    schema: DIRECT_WORKER_START_TRANSITION_SCHEMA,
    version: DIRECT_WORKER_START_VERSION,
    workerStartTransitionId: normalizeString(source.workerStartTransitionId, `worker_start_${sourceDigest.slice(7, 31)}`),
    projectId,
    parentThreadId: normalizeString(source.parentThreadId || handoffPacket.threadId, ""),
    primaryThreadId: normalizeString(source.primaryThreadId || source.parentThreadId || handoffPacket.threadId, ""),
    workThreadId: normalizeString(handoffPacket.workThreadRef?.workThreadId || source.workThreadId, ""),
    startState,
    blockerCodes,
    handoffRef: handoffRef(handoffPacket),
    operatorAcceptance: acceptance,
    selectedAgentClass: {
      agentClassId: normalizeString(selectedAgentClass.agentClassId, ""),
      agentClassKind: normalizeString(selectedAgentClass.agentClassKind, ""),
      displayName: boundedString(selectedAgentClass.displayName || selectedAgentClass.agentClassKind, 160),
    },
    expectedOutputArtifactFamily: normalizeString(handoffPacket.expectedOutputArtifactFamily, ""),
    contextPacket,
    workerPromptDigest: sha256(workerPrompt),
    workerPromptPreview: boundedString(workerPrompt, 240),
    workerSessionCreateAllowed: startState === "ready_to_start",
    workerTurnStartAllowed: startState === "ready_to_start",
    providerCallAllowed: startState === "ready_to_start",
    providerCallScope: startState === "ready_to_start" ? "single_direct_worker_text_turn" : "none",
    recursiveWorkerSpawnAllowed: false,
    objectAuditAllowed: false,
    workspaceMutationAllowed: false,
    workflowClosureAllowed: false,
    childDialogueFlattenedIntoPrimary: false,
    evidenceRefs: [
      normalizeEvidenceRef({
        kind: "role_handoff_packet",
        artifactId: handoffPacket.handoffPacketId,
        artifactDigest: handoffPacket.packetDigest,
        sourceConfidence: startState === "ready_to_start" ? "accepted" : "diagnostic",
        rendererSafeLabel: "Role handoff packet",
      }, "role_handoff_packet"),
      ...normalizeEvidenceRefs(handoffPacket.evidenceRefs, "unknown"),
    ].filter(Boolean),
    createdAt: isoTimestamp(opts.nowMs ?? source.nowMs ?? source.createdAt),
    rawPromptIncluded: false,
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
    sourceDigest,
  };
  transition.transitionDigest = digestFor(DIRECT_WORKER_START_TRANSITION_SCHEMA, { ...transition, transitionDigest: "" });
  return transition;
}

function buildDirectWorkerStartResult(input = {}, opts = {}) {
  const source = isPlainObject(input) ? input : {};
  const transition = isPlainObject(source.transition) ? source.transition : {};
  const session = isPlainObject(source.session) ? source.session : {};
  const turn = isPlainObject(source.turn) ? source.turn : {};
  const status = normalizeString(source.status, transition.startState === "ready_to_start" ? "started" : "blocked");
  const result = {
    schema: DIRECT_WORKER_START_RESULT_SCHEMA,
    version: DIRECT_WORKER_START_VERSION,
    resultId: normalizeString(source.resultId, `worker_start_result_${sha256(`${transition.workerStartTransitionId || ""}:${session.sessionId || ""}:${turn.turnId || ""}:${status}`).slice(0, 24)}`),
    projectId: normalizeString(source.projectId || transition.projectId || session.projectId, ""),
    workerStartTransitionId: normalizeString(transition.workerStartTransitionId, ""),
    workerStartTransitionDigest: normalizeString(transition.transitionDigest, ""),
    status: WORKER_START_STATES.has(status) ? status : "failed",
    parentThreadId: normalizeString(transition.parentThreadId || session.parentThreadId, ""),
    primaryThreadId: normalizeString(transition.primaryThreadId || session.primaryThreadId, ""),
    workerSessionId: normalizeString(session.sessionId || source.workerSessionId, ""),
    workerTurnId: normalizeString(turn.id || turn.turnId || source.workerTurnId, ""),
    agentClassKind: normalizeString(transition.selectedAgentClass?.agentClassKind || session.agentRole, ""),
    workerGraphAlignmentId: normalizeString(source.workerGraphAlignment?.alignmentId || source.workerGraphAlignmentId, ""),
    workerGraphAlignmentDigest: normalizeString(source.workerGraphAlignment?.integrity?.artifactDigest || source.workerGraphAlignmentDigest, ""),
    providerCallAllowed: status === "started",
    providerCallScope: status === "started" ? "single_direct_worker_text_turn" : "none",
    recursiveWorkerSpawnAllowed: false,
    childDialogueFlattenedIntoPrimary: false,
    rawPromptIncluded: false,
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
    createdAt: isoTimestamp(opts.nowMs ?? source.nowMs ?? source.createdAt),
  };
  result.resultDigest = digestFor(DIRECT_WORKER_START_RESULT_SCHEMA, { ...result, resultDigest: "" });
  return result;
}

function validateDirectWorkerStartTransition(transition = {}) {
  if (!isPlainObject(transition) || transition.schema !== DIRECT_WORKER_START_TRANSITION_SCHEMA) {
    throw new Error("direct_worker_start_transition_schema_mismatch");
  }
  if (!WORKER_START_STATES.has(transition.startState)) {
    throw new Error(`direct_worker_start_transition_state_invalid:${transition.startState || ""}`);
  }
  if (!normalizeString(transition.projectId, "")) throw new Error("direct_worker_start_transition_missing_project_id");
  if (!normalizeString(transition.workerStartTransitionId, "")) throw new Error("direct_worker_start_transition_missing_id");
  if (!normalizeString(transition.transitionDigest, "")) throw new Error("direct_worker_start_transition_missing_digest");
  if (transition.startState === "ready_to_start") {
    if (transition.operatorAcceptance?.accepted !== true) throw new Error("direct_worker_start_transition_missing_acceptance");
    if (!normalizeString(transition.workThreadId, "")) throw new Error("direct_worker_start_transition_missing_work_thread");
    if (!normalizeString(transition.handoffRef?.handoffPacketId, "")) throw new Error("direct_worker_start_transition_missing_handoff");
    if (!normalizeString(transition.workerPromptDigest, "")) throw new Error("direct_worker_start_transition_missing_prompt_digest");
    if (transition.providerCallAllowed !== true || transition.workerTurnStartAllowed !== true || transition.workerSessionCreateAllowed !== true) {
      throw new Error("direct_worker_start_transition_ready_without_start_authority");
    }
    validateDirectWorkerContextPacket(transition.contextPacket);
  }
  for (const key of [
    "recursiveWorkerSpawnAllowed",
    "objectAuditAllowed",
    "workspaceMutationAllowed",
    "workflowClosureAllowed",
    "childDialogueFlattenedIntoPrimary",
    "rawPromptIncluded",
    "rawTextIncluded",
    "rawPathIncluded",
    "rawSecretIncluded",
  ]) {
    if (transition[key] !== false) throw new Error(`direct_worker_start_transition_authority_leak:${key}`);
  }
  return true;
}

function validateDirectWorkerContextPacket(packet = {}) {
  if (!isPlainObject(packet) || packet.schema !== DIRECT_WORKER_CONTEXT_PACKET_SCHEMA) {
    throw new Error("direct_worker_context_packet_schema_mismatch");
  }
  if (!normalizeString(packet.workerContextPacketId, "")) throw new Error("direct_worker_context_packet_missing_id");
  if (!normalizeString(packet.projectId, "")) throw new Error("direct_worker_context_packet_missing_project_id");
  if (!normalizeString(packet.parentThreadId, "")) throw new Error("direct_worker_context_packet_missing_parent_thread_id");
  if (!normalizeString(packet.workThreadId, "")) throw new Error("direct_worker_context_packet_missing_work_thread_id");
  if (!normalizeString(packet.handoffPacketId, "")) throw new Error("direct_worker_context_packet_missing_handoff_packet_id");
  if (!normalizeString(packet.agentClassId, "")) throw new Error("direct_worker_context_packet_missing_agent_class_id");
  if (!normalizeString(packet.workerPromptDigest, "")) throw new Error("direct_worker_context_packet_missing_prompt_digest");
  if (!normalizeString(packet.contextPacketDigest, "")) throw new Error("direct_worker_context_packet_missing_digest");
  if (packet.providerInputEligible !== true) throw new Error("direct_worker_context_packet_not_provider_eligible");
  if (packet.rawPromptIncluded !== false || packet.rawTextIncluded !== false || packet.rawPathIncluded !== false || packet.rawSecretIncluded !== false) {
    throw new Error("direct_worker_context_packet_raw_exposure");
  }
  return true;
}

function validateDirectWorkerStartResult(result = {}) {
  if (!isPlainObject(result) || result.schema !== DIRECT_WORKER_START_RESULT_SCHEMA) {
    throw new Error("direct_worker_start_result_schema_mismatch");
  }
  if (!WORKER_START_STATES.has(result.status)) throw new Error(`direct_worker_start_result_status_invalid:${result.status || ""}`);
  if (result.status === "started") {
    if (!normalizeString(result.workerSessionId, "")) throw new Error("direct_worker_start_result_missing_worker_session_id");
    if (!normalizeString(result.workerTurnId, "")) throw new Error("direct_worker_start_result_missing_worker_turn_id");
  }
  for (const key of [
    "recursiveWorkerSpawnAllowed",
    "childDialogueFlattenedIntoPrimary",
    "rawPromptIncluded",
    "rawTextIncluded",
    "rawPathIncluded",
    "rawSecretIncluded",
  ]) {
    if (result[key] !== false) throw new Error(`direct_worker_start_result_authority_leak:${key}`);
  }
  return true;
}

module.exports = {
  DIRECT_WORKER_CONTEXT_PACKET_SCHEMA,
  DIRECT_WORKER_START_RESULT_SCHEMA,
  DIRECT_WORKER_START_TRANSITION_SCHEMA,
  DIRECT_WORKER_START_VERSION,
  buildDirectWorkerContextPacket,
  buildDirectWorkerStartResult,
  buildDirectWorkerStartTransition,
  validateDirectWorkerContextPacket,
  validateDirectWorkerStartResult,
  validateDirectWorkerStartTransition,
};
