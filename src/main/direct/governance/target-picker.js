"use strict";

const crypto = require("node:crypto");

const DIRECT_CLARIFICATION_TARGET_PICKER_SCHEMA = "direct_clarification_target_picker@1";
const DIRECT_CLARIFICATION_TARGET_ANSWER_SCHEMA = "direct_clarification_target_answer@1";

const PICKER_STATES = new Set(["ready", "no_candidates", "blocked", "answered", "unknown"]);
const ANSWER_KINDS = new Set(["choose_candidate", "reject_all", "keep_blocked"]);
const ANSWER_STATES = new Set(["accepted", "blocked"]);

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype;
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function boundedString(value, maxLength = 280) {
  const text = normalizeString(value, "");
  return text.length > maxLength ? `${text.slice(0, Math.max(0, maxLength - 3)).trim()}...` : text;
}

function arrayOrEmpty(value) {
  return Array.isArray(value) ? value : [];
}

function nowIso(nowMs = Date.now()) {
  return new Date(Number(nowMs) || Date.now()).toISOString();
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (isPlainObject(value)) {
    const output = {};
    for (const key of Object.keys(value).sort()) {
      if ([
        "pickerDigest",
        "answerDigest",
        "rowDigest",
        "sourceDigest",
        "artifactDigest",
        "clarificationAnswerDigest",
      ].includes(key)) continue;
      if (value[key] !== undefined) output[key] = stableValue(value[key]);
    }
    return output;
  }
  return value;
}

function digestFor(domain, value) {
  return `sha256:${crypto.createHash("sha256").update(`${domain}\0${JSON.stringify(stableValue(value))}`).digest("hex")}`;
}

function normalizeEvidenceRef(input = {}, fallbackKind = "clarification_target_picker") {
  const source = isPlainObject(input) ? input : {};
  const ref = {
    kind: normalizeString(source.kind || source.refKind, fallbackKind),
    id: normalizeString(source.id || source.refId || source.artifactId, ""),
    digest: normalizeString(source.digest || source.artifactDigest || source.sourceDigest, ""),
    label: boundedString(source.label || source.rendererSafeLabel || fallbackKind, 180),
    confidence: normalizeString(source.confidence || source.sourceConfidence, "diagnostic"),
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  ref.refDigest = digestFor("direct-clarification-target-picker-ref@1", ref);
  return ref;
}

function normalizeEvidenceRefs(values, fallbackKind = "clarification_target_picker") {
  return arrayOrEmpty(values)
    .map((value) => normalizeEvidenceRef(value, fallbackKind))
    .filter((ref) => ref.id || ref.digest);
}

function candidateRowsFrom(input = {}) {
  const source = isPlainObject(input) ? input : {};
  return [
    ...arrayOrEmpty(source.operatorBrokerResolution?.candidates),
    ...arrayOrEmpty(source.operatorBrokerProjection?.candidates),
    ...arrayOrEmpty(source.workTargetResolutionReport?.candidates),
    ...arrayOrEmpty(source.clarificationPacket?.candidates),
    ...arrayOrEmpty(source.candidates),
  ];
}

function normalizeCandidate(input = {}, index = 0, projectId = "") {
  const source = isPlainObject(input) ? input : {};
  const workThreadId = normalizeString(source.workThreadId || source.id, "");
  const candidateProjectId = normalizeString(source.projectId, projectId);
  const blockerCodes = arrayOrEmpty(source.blockerCodes || source.blockers)
    .map((item) => normalizeString(item, ""))
    .filter(Boolean);
  if (!workThreadId) blockerCodes.push("candidate_missing_work_thread_id");
  if (projectId && candidateProjectId && candidateProjectId !== projectId) blockerCodes.push("candidate_project_mismatch");
  if (source.lifecycleState === "archived") blockerCodes.push("candidate_archived");
  if (source.lifecycleState === "stale") blockerCodes.push("candidate_stale");
  const candidate = {
    rank: Number(source.rank ?? index + 1),
    workThreadId,
    projectId: candidateProjectId,
    title: boundedString(source.title || workThreadId || `Candidate ${index + 1}`, 180),
    lifecycleState: normalizeString(source.lifecycleState, "unknown"),
    score: Number(source.score ?? 0),
    confidenceLabel: normalizeString(source.confidenceLabel, "unknown"),
    reasons: arrayOrEmpty(source.reasons).map((item) => boundedString(item, 120)).filter(Boolean).slice(0, 10),
    blockerCodes: [...new Set(blockerCodes)],
    selectable: blockerCodes.length === 0,
    digest: normalizeString(source.digest, ""),
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  candidate.rowDigest = digestFor("direct-clarification-target-candidate@1", candidate);
  return candidate;
}

function candidateWithDigest(candidate = {}) {
  const output = { ...candidate };
  output.selectable = arrayOrEmpty(output.blockerCodes).length === 0;
  output.rowDigest = digestFor("direct-clarification-target-candidate@1", output);
  return output;
}

function mergeCandidate(existing = {}, candidate = {}) {
  const blockerCodes = [...new Set([
    ...arrayOrEmpty(existing.blockerCodes),
    ...arrayOrEmpty(candidate.blockerCodes),
  ].map((item) => normalizeString(item, "")).filter(Boolean))];
  const reasons = [...new Set([
    ...arrayOrEmpty(existing.reasons),
    ...arrayOrEmpty(candidate.reasons),
  ].map((item) => boundedString(item, 120)).filter(Boolean))].slice(0, 10);
  const existingScore = Number.isFinite(Number(existing.score)) ? Number(existing.score) : 0;
  const candidateScore = Number.isFinite(Number(candidate.score)) ? Number(candidate.score) : 0;
  const existingRank = Number.isFinite(Number(existing.rank)) ? Number(existing.rank) : Number.MAX_SAFE_INTEGER;
  const candidateRank = Number.isFinite(Number(candidate.rank)) ? Number(candidate.rank) : Number.MAX_SAFE_INTEGER;
  const higherScoreCandidate = candidateScore > existingScore ? candidate : existing;
  return candidateWithDigest({
    ...existing,
    title: existing.title || candidate.title,
    projectId: existing.projectId || candidate.projectId,
    lifecycleState: existing.lifecycleState !== "unknown" ? existing.lifecycleState : candidate.lifecycleState,
    rank: Math.min(existingRank, candidateRank),
    score: Math.max(existingScore, candidateScore),
    confidenceLabel: normalizeString(higherScoreCandidate.confidenceLabel, existing.confidenceLabel || candidate.confidenceLabel || "unknown"),
    reasons,
    blockerCodes,
    digest: existing.digest || candidate.digest,
  });
}

function dedupeCandidates(candidates = []) {
  const rowsByKey = new Map();
  for (const candidate of candidates) {
    const key = candidate.workThreadId || candidate.rowDigest;
    if (rowsByKey.has(key)) {
      rowsByKey.set(key, mergeCandidate(rowsByKey.get(key), candidate));
    } else {
      rowsByKey.set(key, candidateWithDigest(candidate));
    }
  }
  return [...rowsByKey.values()];
}

function buildClarificationTargetPicker(input = {}, options = {}) {
  const source = isPlainObject(input) ? input : {};
  const clarificationPacket = isPlainObject(source.clarificationPacket) ? source.clarificationPacket : {};
  const operatorBrokerResolution = isPlainObject(source.operatorBrokerResolution || source.operatorBrokerProjection)
    ? source.operatorBrokerResolution || source.operatorBrokerProjection
    : {};
  const workTargetResolutionReport = isPlainObject(source.workTargetResolutionReport) ? source.workTargetResolutionReport : {};
  const projectId = normalizeString(source.projectId || clarificationPacket.projectId || operatorBrokerResolution.projectId || workTargetResolutionReport.projectId, "");
  const generatedAt = normalizeString(source.generatedAt, nowIso(options.nowMs));
  const candidates = dedupeCandidates(candidateRowsFrom(source).map((candidate, index) => normalizeCandidate(candidate, index, projectId)))
    .sort((a, b) => a.rank - b.rank || b.score - a.score || a.workThreadId.localeCompare(b.workThreadId));
  const selectableCount = candidates.filter((candidate) => candidate.selectable).length;
  const blockerCodes = [
    ...arrayOrEmpty(clarificationPacket.blockerCodes),
    ...arrayOrEmpty(clarificationPacket.reasonCodes),
    ...arrayOrEmpty(operatorBrokerResolution.ambiguityBlockers),
    ...arrayOrEmpty(workTargetResolutionReport.blockerCodes),
    ...(candidates.length ? [] : ["target_picker_no_candidates"]),
  ].map((item) => normalizeString(item, "")).filter(Boolean);
  const pickerState = candidates.length ? "ready" : "no_candidates";
  const sourceDigest = digestFor("direct-clarification-target-picker-source@1", {
    projectId,
    clarificationPacketDigest: clarificationPacket.clarificationPacketDigest,
    operatorBrokerResolutionDigest: operatorBrokerResolution.brokerResolutionDigest || operatorBrokerResolution.projectionDigest,
    workTargetResolutionReportDigest: workTargetResolutionReport.reportDigest,
    candidateDigests: candidates.map((candidate) => candidate.rowDigest),
    blockerCodes,
  });
  const picker = {
    schema: DIRECT_CLARIFICATION_TARGET_PICKER_SCHEMA,
    targetPickerId: normalizeString(source.targetPickerId, `clarification_target_picker_${sourceDigest.slice(7, 31)}`),
    projectId,
    generatedAt,
    pickerState: PICKER_STATES.has(pickerState) ? pickerState : "unknown",
    transitionKind: normalizeString(source.transitionKind || clarificationPacket.transitionKind, "unknown"),
    clarificationPacketId: normalizeString(clarificationPacket.clarificationPacketId, ""),
    clarificationPacketDigest: normalizeString(clarificationPacket.clarificationPacketDigest, ""),
    operatorBrokerResolutionDigest: normalizeString(operatorBrokerResolution.brokerResolutionDigest || operatorBrokerResolution.projectionDigest, ""),
    workTargetResolutionReportDigest: normalizeString(workTargetResolutionReport.reportDigest, ""),
    operatorQuestion: boundedString(source.operatorQuestion || clarificationPacket.operatorQuestion || "Select the target WorkThread for this route.", 220),
    candidateCount: candidates.length,
    selectableCandidateCount: selectableCount,
    candidates,
    blockerCodes: [...new Set(blockerCodes)],
    actions: {
      chooseCandidateAvailable: selectableCount > 0,
      rejectAllAvailable: true,
      keepBlockedAvailable: true,
      providerCallAuthorityGranted: false,
      workspaceMutationAuthorityGranted: false,
      workerSpawnAuthorityGranted: false,
      objectAuditAuthorityGranted: false,
      appServerReplacementAuthorityGranted: false,
    },
    downstreamRoutePacketConstraints: {
      clarificationAnswerRequired: true,
      selectedWorkThreadId: "",
      providerCallBlocked: true,
      workspaceMutationBlocked: true,
      toolTransitionBlocked: true,
      workerSpawnBlocked: true,
      nonTargetPreservationRequired: true,
      nonTargetPreservationConstraints: [
        "preserve_non_target_workthreads",
        "do_not_route_by_chat_recency_only",
        "do_not_mutate_workspace_before_target_resolution",
      ],
    },
    rendererSafeSummary: candidates.length
      ? "Operator clarification can resolve this target route."
      : "Operator clarification is blocked because no candidate WorkThread is available.",
    sourceDigest,
    evidenceRefs: normalizeEvidenceRefs([
      { kind: "governance_clarification_packet", id: clarificationPacket.clarificationPacketId, digest: clarificationPacket.clarificationPacketDigest },
      { kind: "operator_broker_resolution", id: operatorBrokerResolution.brokerResolutionId, digest: operatorBrokerResolution.brokerResolutionDigest || operatorBrokerResolution.projectionDigest },
      { kind: "work_target_resolution_report", id: workTargetResolutionReport.reportId, digest: workTargetResolutionReport.reportDigest },
      ...arrayOrEmpty(source.evidenceRefs),
    ], "clarification_target_picker"),
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  picker.pickerDigest = digestFor("direct-clarification-target-picker@1", picker);
  return picker;
}

function buildClarificationTargetAnswer(input = {}, options = {}) {
  const source = isPlainObject(input) ? input : {};
  const picker = isPlainObject(source.targetPicker || source.picker) ? source.targetPicker || source.picker : {};
  const answerKind = ANSWER_KINDS.has(source.answerKind) ? source.answerKind : "keep_blocked";
  const requestedWorkThreadId = normalizeString(source.selectedWorkThreadId || source.workThreadId, "");
  const selectedCandidate = arrayOrEmpty(picker.candidates).find((candidate) => candidate.workThreadId === requestedWorkThreadId) || null;
  const blockerCodes = [];
  if (!picker.pickerDigest) blockerCodes.push("target_picker_missing");
  if (answerKind === "choose_candidate" && !requestedWorkThreadId) blockerCodes.push("selected_work_thread_missing");
  if (answerKind === "choose_candidate" && requestedWorkThreadId && !selectedCandidate) blockerCodes.push("selected_work_thread_not_in_picker");
  if (answerKind === "choose_candidate" && selectedCandidate?.selectable === false) blockerCodes.push("selected_work_thread_not_selectable");
  const accepted = blockerCodes.length === 0;
  const selectedWorkThreadId = accepted && answerKind === "choose_candidate" ? requestedWorkThreadId : "";
  const answer = {
    schema: DIRECT_CLARIFICATION_TARGET_ANSWER_SCHEMA,
    clarificationAnswerId: normalizeString(source.clarificationAnswerId, `clarification_target_answer_${digestFor("direct-clarification-target-answer-source@1", {
      pickerDigest: picker.pickerDigest,
      answerKind,
      requestedWorkThreadId,
      selectedCandidateDigest: selectedCandidate?.rowDigest,
      blockerCodes,
    }).slice(7, 31)}`),
    projectId: normalizeString(source.projectId || picker.projectId, ""),
    createdAt: normalizeString(source.createdAt, nowIso(options.nowMs)),
    targetPickerId: normalizeString(picker.targetPickerId, ""),
    targetPickerDigest: normalizeString(picker.pickerDigest, ""),
    clarificationPacketDigest: normalizeString(picker.clarificationPacketDigest, ""),
    operatorBrokerResolutionDigest: normalizeString(picker.operatorBrokerResolutionDigest, ""),
    answerKind,
    answerState: accepted ? "accepted" : "blocked",
    selectedWorkThreadId,
    rejectedCandidateCount: answerKind === "reject_all" ? Number(picker.candidateCount || arrayOrEmpty(picker.candidates).length || 0) : 0,
    blockerCodes,
    routingEvidenceReady: accepted,
    downstreamRoutePacketConstraints: {
      clarificationAnswerDigest: "",
      selectedWorkThreadId,
      providerCallBlocked: true,
      workspaceMutationBlocked: true,
      toolTransitionBlocked: true,
      workerSpawnBlocked: true,
      nonTargetPreservationRequired: true,
      nonTargetPreservationConstraints: arrayOrEmpty(picker.downstreamRoutePacketConstraints?.nonTargetPreservationConstraints),
    },
    authority: {
      providerCallAuthorityGranted: false,
      workspaceMutationAuthorityGranted: false,
      toolTransitionAuthorityGranted: false,
      workerSpawnAuthorityGranted: false,
      objectAuditAuthorityGranted: false,
      appServerReplacementAuthorityGranted: false,
    },
    evidenceRefs: normalizeEvidenceRefs([
      { kind: "clarification_target_picker", id: picker.targetPickerId, digest: picker.pickerDigest },
      ...arrayOrEmpty(source.evidenceRefs),
    ], "clarification_target_answer"),
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  answer.answerDigest = digestFor("direct-clarification-target-answer@1", answer);
  answer.downstreamRoutePacketConstraints.clarificationAnswerDigest = answer.answerDigest;
  return answer;
}

function assertNoAuthorityLeak(value = {}, label = "target_picker") {
  const authority = isPlainObject(value.authority) ? value.authority : value.actions || {};
  for (const key of [
    "providerCallAuthorityGranted",
    "workspaceMutationAuthorityGranted",
    "toolTransitionAuthorityGranted",
    "workerSpawnAuthorityGranted",
    "objectAuditAuthorityGranted",
    "appServerReplacementAuthorityGranted",
  ]) {
    if (authority[key] === true) throw new Error(`${label}_authority_leak:${key}`);
  }
  if (value.rawTextIncluded !== false || value.rawPathIncluded !== false || value.rawSecretIncluded !== false) {
    throw new Error(`${label}_raw_exposure`);
  }
}

function assertClarificationTargetPickerSafe(picker = {}) {
  if (!isPlainObject(picker) || picker.schema !== DIRECT_CLARIFICATION_TARGET_PICKER_SCHEMA) throw new Error("clarification_target_picker_schema_mismatch");
  if (!PICKER_STATES.has(picker.pickerState)) throw new Error(`clarification_target_picker_state_invalid:${picker.pickerState || ""}`);
  assertNoAuthorityLeak(picker, "clarification_target_picker");
  for (const candidate of arrayOrEmpty(picker.candidates)) {
    if (candidate.rawTextIncluded !== false || candidate.rawPathIncluded !== false || candidate.rawSecretIncluded !== false) throw new Error("clarification_target_candidate_raw_exposure");
  }
  return true;
}

function assertClarificationTargetAnswerSafe(answer = {}) {
  if (!isPlainObject(answer) || answer.schema !== DIRECT_CLARIFICATION_TARGET_ANSWER_SCHEMA) throw new Error("clarification_target_answer_schema_mismatch");
  if (!ANSWER_KINDS.has(answer.answerKind)) throw new Error(`clarification_target_answer_kind_invalid:${answer.answerKind || ""}`);
  if (!ANSWER_STATES.has(answer.answerState)) throw new Error(`clarification_target_answer_state_invalid:${answer.answerState || ""}`);
  assertNoAuthorityLeak(answer, "clarification_target_answer");
  if (answer.answerKind !== "choose_candidate" && answer.selectedWorkThreadId) throw new Error("clarification_target_answer_selected_without_choice");
  return true;
}

module.exports = {
  DIRECT_CLARIFICATION_TARGET_ANSWER_SCHEMA,
  DIRECT_CLARIFICATION_TARGET_PICKER_SCHEMA,
  assertClarificationTargetAnswerSafe,
  assertClarificationTargetPickerSafe,
  buildClarificationTargetAnswer,
  buildClarificationTargetPicker,
};
