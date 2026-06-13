"use strict";

const crypto = require("node:crypto");
const {
  assertWorkTargetResolutionReportSafe,
  buildWorkTargetResolution,
  buildWorkTargetResolutionReport,
  buildWorkThread,
} = require("../bridge/work-thread-registry");

const OPERATOR_BROKER_RESOLUTION_SCHEMA = "operator_broker_resolution@1";
const OPERATOR_BROKER_RESOLUTION_PROJECTION_SCHEMA = "operator_broker_resolution_projection@1";

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function boundedString(value, maxLength = 280) {
  const text = normalizeString(value, "");
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => (entry === undefined ? "null" : stableStringify(entry))).join(",")}]`;
  return `{${Object.keys(value)
    .filter((key) => value[key] !== undefined && !["resolutionDigest", "projectionDigest", "brokerResolutionDigest", "operatorBrokerResolutionDigest"].includes(key))
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(",")}}`;
}

function digestFor(domain, value) {
  return `sha256:${crypto.createHash("sha256").update(`${domain}\0${stableStringify(value)}`).digest("hex")}`;
}

function nowIso(nowMs = Date.now()) {
  return new Date(Number(nowMs) || Date.now()).toISOString();
}

function arrayOrEmpty(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeRef(input = {}, fallbackKind = "unknown") {
  const source = isPlainObject(input) ? input : {};
  const ref = {
    kind: normalizeString(source.kind || source.refKind, fallbackKind),
    id: normalizeString(source.id || source.refId || source.artifactId, ""),
    digest: normalizeString(source.digest || source.artifactDigest || source.sourceDigest, ""),
    label: boundedString(source.label || source.rendererSafeLabel || source.kind || fallbackKind, 180),
    confidence: normalizeString(source.confidence || source.sourceConfidence, "diagnostic"),
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  ref.refDigest = digestFor("operator-broker-ref@1", ref);
  return ref;
}

function normalizeRefs(values, fallbackKind = "unknown") {
  return arrayOrEmpty(values)
    .map((value) => normalizeRef(value, fallbackKind))
    .filter((ref) => ref.id || ref.digest || ref.label);
}

function normalizeIdentity(input = {}, defaults = {}) {
  const source = isPlainObject(input) ? input : {};
  return {
    ...defaults,
    workspaceKind: normalizeString(source.workspaceKind || defaults.workspaceKind, "unknown"),
    workspaceEvidenceKey: normalizeString(source.workspaceEvidenceKey || defaults.workspaceEvidenceKey, ""),
    workspaceLabel: boundedString(source.workspaceLabel || defaults.workspaceLabel, 180),
    branchName: normalizeString(source.branchName || defaults.branchName, ""),
    branchEvidenceKey: normalizeString(source.branchEvidenceKey || defaults.branchEvidenceKey, ""),
    confidence: normalizeString(source.confidence || defaults.confidence, "diagnostic"),
    rawPathIncluded: false,
    rawUrlIncluded: false,
    rawTextIncluded: false,
  };
}

function normalizeLinkedThread(input = {}, index = 0, sourceKind = "codex") {
  const source = isPlainObject(input) ? input : {};
  return {
    threadId: normalizeString(source.threadId || source.id, `${sourceKind}_thread_${index + 1}`),
    source: normalizeString(source.source, sourceKind),
    title: boundedString(source.title || source.label, 180),
    status: normalizeString(source.status, "linked"),
    evidenceRefs: normalizeRefs(source.evidenceRefs, `${sourceKind}_thread`),
    rawUrlIncluded: false,
    rawPathIncluded: false,
  };
}

function normalizeObligation(input = {}, index = 0) {
  const source = isPlainObject(input) ? input : {};
  return {
    obligationId: normalizeString(source.obligationId || source.id, `obligation_${index + 1}`),
    kind: normalizeString(source.kind || source.obligationKind, "unknown"),
    status: normalizeString(source.status, "open"),
    summary: boundedString(source.summary || source.label || source.description, 240),
    evidenceRefs: normalizeRefs(source.evidenceRefs, "obligation_evidence"),
  };
}

function confidenceLabelForCandidate(candidate = null) {
  const score = Number(candidate?.score || 0);
  if (score >= 80) return "high";
  if (score >= 50) return "medium";
  if (score > 0) return "low";
  return "none";
}

function candidateProjection(candidate = {}, index = 0) {
  return {
    rank: index + 1,
    workThreadId: normalizeString(candidate.workThreadId, ""),
    title: boundedString(candidate.title, 180),
    projectId: normalizeString(candidate.projectId, ""),
    lifecycleState: normalizeString(candidate.lifecycleState, "unknown"),
    score: Number(candidate.score || 0),
    confidenceLabel: confidenceLabelForCandidate(candidate),
    reasons: arrayOrEmpty(candidate.reasons).map((item) => boundedString(item, 90)).filter(Boolean).slice(0, 10),
    digest: normalizeString(candidate.digest, ""),
    rawTextIncluded: false,
    rawPathIncluded: false,
  };
}

function buildWorkWorldSnapshot(source = {}) {
  const workspaceIdentity = normalizeIdentity(source.workspaceIdentity, {
    workspaceKind: normalizeString(source.workspaceKind, "unknown"),
    workspaceEvidenceKey: normalizeString(source.workspaceEvidenceKey, ""),
    workspaceLabel: normalizeString(source.workspaceLabel, ""),
  });
  const branchIdentity = normalizeIdentity(source.branchIdentity, {
    branchName: normalizeString(source.branchName, ""),
    branchEvidenceKey: normalizeString(source.branchEvidenceKey, ""),
  });
  const linkedCodexThreads = arrayOrEmpty(source.linkedCodexThreads)
    .map((thread, index) => normalizeLinkedThread(thread, index, "codex"));
  const linkedChatGptThreads = arrayOrEmpty(source.linkedChatGptThreads)
    .map((thread, index) => normalizeLinkedThread(thread, index, "chatgpt"));
  const openObligations = arrayOrEmpty(source.openObligations)
    .map((item, index) => normalizeObligation(item, index));
  const recentContextRefs = normalizeRefs(source.recentContextRefs || source.contextPacketRefs, "context_packet");
  const snapshot = {
    projectId: normalizeString(source.projectId, ""),
    workspaceIdentity,
    branchIdentity,
    linkedCodexThreadCount: linkedCodexThreads.length,
    linkedChatGptThreadCount: linkedChatGptThreads.length,
    linkedCodexThreads: linkedCodexThreads.slice(0, 8),
    linkedChatGptThreads: linkedChatGptThreads.slice(0, 8),
    openObligationCount: openObligations.length,
    openObligations: openObligations.slice(0, 8),
    recentContextRefs: recentContextRefs.slice(0, 12),
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  snapshot.snapshotDigest = digestFor("operator-broker-work-world-snapshot@1", snapshot);
  return snapshot;
}

function buildConstraintCodes(report = {}, resolution = {}) {
  const codes = new Set([
    "preserve_non_target_workthreads",
    "do_not_mutate_workspace_before_target_resolution",
    "do_not_route_by_chat_recency_only",
    "do_not_switch_project_or_thread_silently",
  ]);
  if (report.clarificationRequired === true) codes.add("ask_operator_for_clarification");
  if (report.routingGateState && report.routingGateState !== "selected_ready") codes.add(`route_gate_${report.routingGateState}`);
  for (const blocker of arrayOrEmpty(report.blockerCodes || resolution.ambiguityBlockers)) {
    const text = normalizeString(blocker, "");
    if (text) codes.add(text);
  }
  return [...codes];
}

function buildOperatorBrokerResolution(input = {}, workThreads = [], options = {}) {
  const source = isPlainObject(input) ? input : {};
  const nowMs = options.nowMs ?? source.nowMs;
  const projectId = normalizeString(source.projectId, "");
  const normalizedWorkThreads = arrayOrEmpty(workThreads).map((thread) => buildWorkThread(thread, { nowMs }));
  const request = {
    projectId,
    userRequest: source.userRequest || source.query || source.requestPreview,
    branchName: source.branchName || source.branchIdentity?.branchName,
    codexThreadId: source.codexThreadId,
    chatGptThreadId: source.chatGptThreadId,
    activeRuntimePath: source.activeRuntimePath,
  };
  const workTargetResolution = isPlainObject(source.workTargetResolution)
    ? source.workTargetResolution
    : buildWorkTargetResolution(request, normalizedWorkThreads, { nowMs });
  const workTargetResolutionReport = isPlainObject(source.workTargetResolutionReport)
    ? source.workTargetResolutionReport
    : buildWorkTargetResolutionReport({
        projectId,
        resolution: workTargetResolution,
        maxAgeMs: source.maxAgeMs,
        expectedProjectId: projectId,
      }, { nowMs, maxAgeMs: source.maxAgeMs });
  assertWorkTargetResolutionReportSafe(workTargetResolutionReport);

  const candidates = arrayOrEmpty(workTargetResolutionReport.candidates || workTargetResolution.candidates)
    .map(candidateProjection);
  const topCandidate = candidates[0] || null;
  const selectedCandidate = candidates.find((candidate) => candidate.workThreadId === workTargetResolutionReport.selectedWorkThreadId) || topCandidate;
  const constraintCodes = buildConstraintCodes(workTargetResolutionReport, workTargetResolution);
  const workWorldSnapshot = buildWorkWorldSnapshot({
    ...source,
    projectId,
  });
  const createdAt = normalizeString(source.createdAt, nowIso(nowMs));
  const sourceDigest = digestFor("operator-broker-resolution-source@1", {
    projectId,
    requestDigest: workTargetResolutionReport.requestDigest,
    workTargetResolutionReportDigest: workTargetResolutionReport.reportDigest,
    workWorldSnapshotDigest: workWorldSnapshot.snapshotDigest,
    candidateIds: candidates.map((candidate) => candidate.workThreadId),
    constraintCodes,
  });
  const resolution = {
    schema: OPERATOR_BROKER_RESOLUTION_SCHEMA,
    brokerResolutionId: normalizeString(source.brokerResolutionId, `operator_broker_resolution_${sourceDigest.slice(7, 31)}`),
    projectId,
    createdAt,
    resolutionState: normalizeString(workTargetResolutionReport.resolutionState, "unresolved"),
    routingGateState: normalizeString(workTargetResolutionReport.routingGateState, "unresolved_blocked"),
    selectedWorkThreadId: normalizeString(workTargetResolutionReport.selectedWorkThreadId, ""),
    candidateCount: candidates.length,
    candidates,
    confidenceLabel: workTargetResolutionReport.selectedWorkThreadId ? confidenceLabelForCandidate(selectedCandidate) : "none",
    ambiguityBlockers: arrayOrEmpty(workTargetResolutionReport.blockerCodes).map((item) => normalizeString(item, "")).filter(Boolean),
    clarificationRequired: workTargetResolutionReport.clarificationRequired === true,
    nonTargetPreservationRequired: workTargetResolutionReport.nonTargetPreservationRequired !== false,
    nonTargetPreservationConstraints: constraintCodes,
    workWorldSnapshot,
    workTargetResolution: {
      resolutionId: normalizeString(workTargetResolution.resolutionId, ""),
      resolutionDigest: normalizeString(workTargetResolution.resolutionDigest, ""),
      requestDigest: normalizeString(workTargetResolution.requestDigest, ""),
      requestRawTextIncluded: false,
    },
    workTargetResolutionReport: {
      reportId: normalizeString(workTargetResolutionReport.reportId, ""),
      reportDigest: normalizeString(workTargetResolutionReport.reportDigest, ""),
      routingGateState: normalizeString(workTargetResolutionReport.routingGateState, ""),
      selectedWorkThreadId: normalizeString(workTargetResolutionReport.selectedWorkThreadId, ""),
    },
    downstreamRoutePacketConstraints: {
      selectedWorkThreadId: normalizeString(workTargetResolutionReport.selectedWorkThreadId, ""),
      workTargetResolutionReportDigest: normalizeString(workTargetResolutionReport.reportDigest, ""),
      operatorBrokerResolutionDigest: sourceDigest,
      providerCallBlocked: workTargetResolutionReport.providerCallBlocked !== false,
      workspaceMutationBlocked: workTargetResolutionReport.mutationBlocked !== false,
      clarificationRequired: workTargetResolutionReport.clarificationRequired === true,
      nonTargetPreservationRequired: workTargetResolutionReport.nonTargetPreservationRequired !== false,
      constraintCodes,
    },
    authority: {
      brokerPerformedWorkerTask: false,
      mutationAuthorityGranted: false,
      providerCallAuthorityGranted: false,
      routingEnforced: false,
      workspaceMutationAllowed: false,
      providerTransportAllowed: false,
      rawTextIncluded: false,
      rawPathIncluded: false,
      rawSecretIncluded: false,
    },
    rendererSafeSummary: workTargetResolutionReport.routingGateState === "selected_ready"
      ? "Operator broker selected a candidate WorkThread; this grants no mutation authority."
      : "Operator broker requires clarification before routing mutation or provider calls.",
    sourceDigest,
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  resolution.brokerResolutionDigest = digestFor("operator-broker-resolution@1", resolution);
  resolution.downstreamRoutePacketConstraints.operatorBrokerResolutionDigest = resolution.brokerResolutionDigest;
  return resolution;
}

function buildOperatorBrokerResolutionProjection(resolution = {}) {
  const source = isPlainObject(resolution) ? resolution : {};
  const projection = {
    schema: OPERATOR_BROKER_RESOLUTION_PROJECTION_SCHEMA,
    brokerResolutionId: normalizeString(source.brokerResolutionId, ""),
    projectId: normalizeString(source.projectId, ""),
    resolutionState: normalizeString(source.resolutionState, "unavailable"),
    routingGateState: normalizeString(source.routingGateState, "unavailable"),
    selectedWorkThreadId: normalizeString(source.selectedWorkThreadId, ""),
    candidateCount: Number(source.candidateCount || arrayOrEmpty(source.candidates).length || 0),
    confidenceLabel: normalizeString(source.confidenceLabel, "none"),
    candidates: arrayOrEmpty(source.candidates).map(candidateProjection).slice(0, 6),
    ambiguityBlockers: arrayOrEmpty(source.ambiguityBlockers).map((item) => normalizeString(item, "")).filter(Boolean),
    clarificationRequired: source.clarificationRequired === true,
    nonTargetPreservationRequired: source.nonTargetPreservationRequired !== false,
    nonTargetPreservationConstraints: arrayOrEmpty(source.nonTargetPreservationConstraints).map((item) => normalizeString(item, "")).filter(Boolean),
    workWorld: {
      linkedCodexThreadCount: Number(source.workWorldSnapshot?.linkedCodexThreadCount || 0),
      linkedChatGptThreadCount: Number(source.workWorldSnapshot?.linkedChatGptThreadCount || 0),
      openObligationCount: Number(source.workWorldSnapshot?.openObligationCount || 0),
      recentContextRefCount: arrayOrEmpty(source.workWorldSnapshot?.recentContextRefs).length,
      workspaceKind: normalizeString(source.workWorldSnapshot?.workspaceIdentity?.workspaceKind, "unknown"),
      branchName: normalizeString(source.workWorldSnapshot?.branchIdentity?.branchName, ""),
    },
    downstreamRoutePacketConstraints: {
      providerCallBlocked: source.downstreamRoutePacketConstraints?.providerCallBlocked !== false,
      workspaceMutationBlocked: source.downstreamRoutePacketConstraints?.workspaceMutationBlocked !== false,
      clarificationRequired: source.downstreamRoutePacketConstraints?.clarificationRequired === true,
      nonTargetPreservationRequired: source.downstreamRoutePacketConstraints?.nonTargetPreservationRequired !== false,
      constraintCodes: arrayOrEmpty(source.downstreamRoutePacketConstraints?.constraintCodes).map((item) => normalizeString(item, "")).filter(Boolean).slice(0, 12),
    },
    authority: {
      brokerPerformedWorkerTask: false,
      mutationAuthorityGranted: false,
      providerCallAuthorityGranted: false,
      routingEnforced: false,
      workspaceMutationAllowed: false,
      providerTransportAllowed: false,
      rawTextIncluded: false,
      rawPathIncluded: false,
      rawSecretIncluded: false,
    },
    brokerResolutionDigest: normalizeString(source.brokerResolutionDigest, ""),
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  projection.projectionDigest = digestFor("operator-broker-resolution-projection@1", projection);
  return projection;
}

function assertOperatorBrokerResolutionSafe(resolution = {}) {
  if (!isPlainObject(resolution) || resolution.schema !== OPERATOR_BROKER_RESOLUTION_SCHEMA) {
    throw new Error("operator_broker_resolution_schema_mismatch");
  }
  const authority = isPlainObject(resolution.authority) ? resolution.authority : {};
  const forbidden = [
    "brokerPerformedWorkerTask",
    "mutationAuthorityGranted",
    "providerCallAuthorityGranted",
    "routingEnforced",
    "workspaceMutationAllowed",
    "providerTransportAllowed",
    "rawTextIncluded",
    "rawPathIncluded",
    "rawSecretIncluded",
  ];
  for (const key of forbidden) {
    if (authority[key] !== false) throw new Error(`operator_broker_resolution_authority_leak:${key}`);
  }
  if (resolution.rawTextIncluded !== false || resolution.rawPathIncluded !== false || resolution.rawSecretIncluded !== false) {
    throw new Error("operator_broker_resolution_raw_exposure");
  }
  if (resolution.clarificationRequired === true && resolution.downstreamRoutePacketConstraints?.providerCallBlocked === false) {
    throw new Error("operator_broker_resolution_clarification_allows_provider");
  }
  return true;
}

function assertOperatorBrokerProjectionSafe(projection = {}) {
  if (!isPlainObject(projection) || projection.schema !== OPERATOR_BROKER_RESOLUTION_PROJECTION_SCHEMA) {
    throw new Error("operator_broker_projection_schema_mismatch");
  }
  const authority = isPlainObject(projection.authority) ? projection.authority : {};
  for (const key of ["mutationAuthorityGranted", "providerCallAuthorityGranted", "routingEnforced", "workspaceMutationAllowed", "providerTransportAllowed", "rawTextIncluded", "rawPathIncluded", "rawSecretIncluded"]) {
    if (authority[key] !== false) throw new Error(`operator_broker_projection_authority_leak:${key}`);
  }
  if (projection.rawTextIncluded !== false || projection.rawPathIncluded !== false || projection.rawSecretIncluded !== false) {
    throw new Error("operator_broker_projection_raw_exposure");
  }
  return true;
}

module.exports = {
  OPERATOR_BROKER_RESOLUTION_PROJECTION_SCHEMA,
  OPERATOR_BROKER_RESOLUTION_SCHEMA,
  assertOperatorBrokerProjectionSafe,
  assertOperatorBrokerResolutionSafe,
  buildOperatorBrokerResolution,
  buildOperatorBrokerResolutionProjection,
};
