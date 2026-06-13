"use strict";

const crypto = require("node:crypto");

const DIRECT_GOVERNANCE_ENFORCEMENT_PREFLIGHT_SCHEMA = "direct_governance_enforcement_preflight@1";
const DIRECT_GOVERNANCE_CLARIFICATION_PACKET_SCHEMA = "direct_governance_clarification_packet@1";

const TRANSITION_KINDS = new Set([
  "provider_call",
  "workspace_mutation",
  "tool_transition",
  "unknown",
]);

const GATE_STATES = new Set([
  "allowed",
  "blocked",
  "clarification_required",
]);

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
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function nowIso(nowMs = Date.now()) {
  return new Date(Number(nowMs) || Date.now()).toISOString();
}

function arrayOrEmpty(value) {
  return Array.isArray(value) ? value : [];
}

function stableStringify(value) {
  if (value && typeof value.toJSON === "function") return stableStringify(value.toJSON());
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => (entry === undefined ? "null" : stableStringify(entry))).join(",")}]`;
  return `{${Object.keys(value)
    .filter((key) => value[key] !== undefined && !["preflightDigest", "clarificationPacketDigest"].includes(key))
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(",")}}`;
}

function digestFor(domain, value) {
  return `sha256:${crypto.createHash("sha256").update(`${domain}\0${stableStringify(value)}`).digest("hex")}`;
}

function normalizeTransitionKind(value) {
  const kind = normalizeString(value, "unknown");
  return TRANSITION_KINDS.has(kind) ? kind : "unknown";
}

function normalizeBlockerCodes(values = []) {
  return [...new Set(arrayOrEmpty(values).map((item) => normalizeString(item, "")).filter(Boolean))];
}

function normalizeEvidenceRef(input = {}, fallbackKind = "unknown") {
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
  ref.refDigest = digestFor("direct-governance-enforcement-ref@1", ref);
  return ref;
}

function normalizeEvidenceRefs(values, fallbackKind = "unknown") {
  return arrayOrEmpty(values)
    .filter((value) => isPlainObject(value) && (
      value.id ||
      value.refId ||
      value.artifactId ||
      value.digest ||
      value.artifactDigest ||
      value.sourceDigest ||
      value.label ||
      value.rendererSafeLabel ||
      value.kind
    ))
    .map((value) => normalizeEvidenceRef(value, fallbackKind));
}

function normalizeAuthorityBoundary(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const allowedActions = arrayOrEmpty(source.allowedActions).map(String).filter(Boolean);
  const forbiddenActions = arrayOrEmpty(source.forbiddenActions).map(String).filter(Boolean);
  const summary = boundedString(source.summary || source.rendererSafeSummary, 320);
  const evidenceRefs = normalizeEvidenceRefs(source.evidenceRefs, "authority_boundary");
  const hasBoundary = Boolean(summary || allowedActions.length || forbiddenActions.length || evidenceRefs.length);
  return {
    present: hasBoundary,
    mutationAllowedBeforeResolution: source.mutationAllowedBeforeResolution === true,
    allowedActions,
    forbiddenActions,
    summary,
    evidenceRefs,
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
}

function normalizeCandidate(candidate = {}, index = 0) {
  const source = isPlainObject(candidate) ? candidate : {};
  return {
    rank: Number(source.rank || index + 1),
    workThreadId: normalizeString(source.workThreadId, ""),
    title: boundedString(source.title, 180),
    projectId: normalizeString(source.projectId, ""),
    score: Number(source.score || 0),
    confidenceLabel: normalizeString(source.confidenceLabel, ""),
    reasons: arrayOrEmpty(source.reasons).map((item) => boundedString(item, 90)).filter(Boolean).slice(0, 8),
    digest: normalizeString(source.digest, ""),
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
}

function selectedWorkThreadIdFor(workTargetResolutionReport = {}, operatorBrokerResolution = {}, input = {}) {
  return normalizeString(
    input.selectedWorkThreadId ||
      operatorBrokerResolution.selectedWorkThreadId ||
      operatorBrokerResolution.downstreamRoutePacketConstraints?.selectedWorkThreadId ||
      workTargetResolutionReport.selectedWorkThreadId,
    "",
  );
}

function normalizeNonTargetPreservationConstraints(workTargetResolutionReport = {}, operatorBrokerResolution = {}) {
  return normalizeBlockerCodes([
    "preserve_non_target_workthreads",
    "do_not_route_by_chat_recency_only",
    "do_not_switch_project_or_thread_silently",
    ...arrayOrEmpty(workTargetResolutionReport.blockerCodes),
    ...arrayOrEmpty(operatorBrokerResolution.nonTargetPreservationConstraints),
    ...arrayOrEmpty(operatorBrokerResolution.downstreamRoutePacketConstraints?.constraintCodes),
  ]);
}

function candidatesFor(workTargetResolutionReport = {}, operatorBrokerResolution = {}) {
  const candidates = arrayOrEmpty(operatorBrokerResolution.candidates).length
    ? operatorBrokerResolution.candidates
    : arrayOrEmpty(workTargetResolutionReport.candidates);
  return candidates.map(normalizeCandidate).slice(0, 8);
}

function workThreadBranchName(workThread = {}) {
  return normalizeString(workThread?.branchIdentity?.branchName || workThread?.branchName, "");
}

function workThreadAuthorityBoundary(workThread = {}) {
  return isPlainObject(workThread?.authorityBoundary) ? workThread.authorityBoundary : {};
}

function collectBlockers(normalized = {}) {
  const {
    selectedWorkThreadId,
    expectedWorkThreadId,
    workTargetResolutionReport,
    operatorBrokerResolution,
    authorityBoundary,
    activeBranchName,
    expectedBranchName,
    targetBranchName,
    transitionKind,
  } = normalized;
  const blockers = new Set([
    ...arrayOrEmpty(workTargetResolutionReport.blockerCodes),
    ...arrayOrEmpty(operatorBrokerResolution.ambiguityBlockers),
  ].map((item) => normalizeString(item, "")).filter(Boolean));

  const resolutionState = normalizeString(workTargetResolutionReport.resolutionState || operatorBrokerResolution.resolutionState, "unresolved");
  const routingGateState = normalizeString(workTargetResolutionReport.routingGateState || operatorBrokerResolution.routingGateState, "");
  const brokerClarification = operatorBrokerResolution.clarificationRequired === true ||
    operatorBrokerResolution.downstreamRoutePacketConstraints?.clarificationRequired === true;

  if (!selectedWorkThreadId) blockers.add("work_target_unresolved");
  if (resolutionState !== "selected" || routingGateState === "clarification_required" || workTargetResolutionReport.clarificationRequired === true) {
    blockers.add(resolutionState === "ambiguous" ? "work_target_clarification_required" : "work_target_unresolved");
  }
  if (brokerClarification) blockers.add("operator_broker_clarification_required");
  if (expectedWorkThreadId && selectedWorkThreadId && expectedWorkThreadId !== selectedWorkThreadId) {
    blockers.add("operator_broker_work_thread_mismatch");
  }
  if (workTargetResolutionReport.stale === true) blockers.add("work_target_resolution_stale");
  if (!authorityBoundary.present) blockers.add("authority_boundary_missing");
  if (normalizeString(operatorBrokerResolution.confidenceLabel, "none") === "low") blockers.add("target_confidence_too_low");
  if (targetBranchName && activeBranchName && targetBranchName !== activeBranchName) blockers.add("branch_mismatch");
  if (expectedBranchName && activeBranchName && expectedBranchName !== activeBranchName) blockers.add("branch_mismatch");
  if (transitionKind === "unknown") blockers.add("unsupported_transition_kind");

  const nonTargetConstraints = normalizeNonTargetPreservationConstraints(workTargetResolutionReport, operatorBrokerResolution);
  if (!nonTargetConstraints.includes("preserve_non_target_workthreads")) blockers.add("non_target_preservation_missing");

  return normalizeBlockerCodes([...blockers]);
}

function buildGovernanceClarificationPacket(input = {}, normalized = {}) {
  const now = normalizeString(input.createdAt || input.generatedAt, nowIso(input.nowMs));
  const transitionKind = normalizeTransitionKind(input.transitionKind);
  const projectId = normalizeString(input.projectId || normalized.workTargetResolutionReport?.projectId || normalized.operatorBrokerResolution?.projectId, "");
  const candidates = candidatesFor(normalized.workTargetResolutionReport, normalized.operatorBrokerResolution);
  const blockerCodes = normalizeBlockerCodes(input.blockerCodes || normalized.blockerCodes);
  const nonTargetPreservationConstraints = normalizeNonTargetPreservationConstraints(
    normalized.workTargetResolutionReport,
    normalized.operatorBrokerResolution,
  );
  const source = {
    projectId,
    transitionKind,
    selectedWorkThreadId: normalizeString(normalized.selectedWorkThreadId, ""),
    candidates,
    blockerCodes,
    workTargetResolutionReportDigest: normalizeString(normalized.workTargetResolutionReport?.reportDigest, ""),
    operatorBrokerResolutionDigest: normalizeString(normalized.operatorBrokerResolution?.brokerResolutionDigest, ""),
  };
  const packet = {
    schema: DIRECT_GOVERNANCE_CLARIFICATION_PACKET_SCHEMA,
    clarificationPacketId: normalizeString(input.clarificationPacketId, `governance_clarification_${digestFor("direct-governance-clarification-source@1", source).slice(7, 31)}`),
    projectId,
    transitionKind,
    createdAt: now,
    selectedWorkThreadId: normalizeString(normalized.selectedWorkThreadId, ""),
    gateState: "clarification_required",
    reasonCodes: blockerCodes,
    blockerCodes,
    candidates,
    operatorQuestion: boundedString(input.operatorQuestion || "Which active work thread and authority boundary should this transition use?", 220),
    workTargetResolutionReportDigest: normalizeString(normalized.workTargetResolutionReport?.reportDigest, ""),
    operatorBrokerResolutionDigest: normalizeString(normalized.operatorBrokerResolution?.brokerResolutionDigest, ""),
    nonTargetPreservationConstraints,
    authority: {
      providerTransportAllowed: false,
      workspaceMutationAllowed: false,
      toolTransitionAllowed: false,
      executionAuthorityGranted: false,
      brokerPerformedObjectAudit: false,
      brokerPerformedWorkerTask: false,
    },
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  packet.clarificationPacketDigest = digestFor("direct-governance-clarification-packet@1", packet);
  return packet;
}

function buildGovernanceEnforcementPreflight(input = {}, options = {}) {
  const workTargetResolutionReport = isPlainObject(input.workTargetResolutionReport) ? input.workTargetResolutionReport : {};
  const operatorBrokerResolution = isPlainObject(input.operatorBrokerResolution) ? input.operatorBrokerResolution : {};
  const workThread = isPlainObject(input.workThread) ? input.workThread : {};
  const transitionKind = normalizeTransitionKind(input.transitionKind);
  const selectedWorkThreadId = selectedWorkThreadIdFor(workTargetResolutionReport, operatorBrokerResolution, input);
  const expectedWorkThreadId = normalizeString(input.expectedWorkThreadId || workThread.workThreadId, "");
  const authorityBoundary = normalizeAuthorityBoundary(input.authorityBoundary || workThreadAuthorityBoundary(workThread));
  const activeBranchName = normalizeString(input.activeBranchName || input.branchName, "");
  const expectedBranchName = normalizeString(input.expectedBranchName, "");
  const targetBranchName = workThreadBranchName(workThread);
  const normalized = {
    selectedWorkThreadId,
    expectedWorkThreadId,
    workTargetResolutionReport,
    operatorBrokerResolution,
    authorityBoundary,
    activeBranchName,
    expectedBranchName,
    targetBranchName,
    transitionKind,
  };
  const blockerCodes = collectBlockers(normalized);
  const clarificationRequired = blockerCodes.some((code) => [
    "work_target_clarification_required",
    "work_target_unresolved",
    "operator_broker_clarification_required",
    "candidate_confidence_below_threshold",
    "target_resolution_ambiguous",
    "target_resolution_unresolved",
  ].includes(code));
  const gateState = blockerCodes.length === 0 ? "allowed" : clarificationRequired ? "clarification_required" : "blocked";
  const allowed = gateState === "allowed";
  const providerTransportAllowed = allowed && ["provider_call", "tool_transition"].includes(transitionKind);
  const workspaceMutationAllowed = allowed && transitionKind === "workspace_mutation";
  const toolTransitionAllowed = allowed && transitionKind === "tool_transition";
  const nonTargetPreservationConstraints = normalizeNonTargetPreservationConstraints(workTargetResolutionReport, operatorBrokerResolution);
  const evidenceRefs = normalizeEvidenceRefs([
    {
      kind: "work_target_resolution_report",
      id: normalizeString(workTargetResolutionReport.reportId, ""),
      digest: normalizeString(workTargetResolutionReport.reportDigest, ""),
      confidence: "governance_precondition",
    },
    {
      kind: "operator_broker_resolution",
      id: normalizeString(operatorBrokerResolution.brokerResolutionId, ""),
      digest: normalizeString(operatorBrokerResolution.brokerResolutionDigest, ""),
      confidence: "governance_precondition",
    },
    ...arrayOrEmpty(input.evidenceRefs),
  ], "governance_enforcement");
  const createdAt = normalizeString(input.createdAt || input.generatedAt, nowIso(options.nowMs ?? input.nowMs));
  const source = {
    projectId: input.projectId,
    transitionKind,
    selectedWorkThreadId,
    expectedWorkThreadId,
    blockerCodes,
    reportDigest: workTargetResolutionReport.reportDigest,
    brokerDigest: operatorBrokerResolution.brokerResolutionDigest,
  };
  const clarificationPacket = gateState === "clarification_required"
    ? buildGovernanceClarificationPacket({
        ...input,
        transitionKind,
        blockerCodes,
        createdAt,
      }, {
        ...normalized,
        blockerCodes,
      })
    : null;
  const preflight = {
    schema: DIRECT_GOVERNANCE_ENFORCEMENT_PREFLIGHT_SCHEMA,
    preflightId: normalizeString(input.preflightId, `governance_enforcement_${digestFor("direct-governance-enforcement-source@1", source).slice(7, 31)}`),
    projectId: normalizeString(input.projectId || workTargetResolutionReport.projectId || operatorBrokerResolution.projectId, ""),
    transitionKind,
    createdAt,
    gateState,
    allowed,
    selectedWorkThreadId,
    expectedWorkThreadId,
    workTargetResolutionReportDigest: normalizeString(workTargetResolutionReport.reportDigest, ""),
    operatorBrokerResolutionDigest: normalizeString(operatorBrokerResolution.brokerResolutionDigest, ""),
    confidenceLabel: normalizeString(operatorBrokerResolution.confidenceLabel, selectedWorkThreadId ? "unknown" : "none"),
    activeBranchName,
    targetBranchName,
    expectedBranchName,
    authorityBoundary: {
      present: authorityBoundary.present,
      allowedActions: authorityBoundary.allowedActions,
      forbiddenActions: authorityBoundary.forbiddenActions,
      summary: authorityBoundary.summary,
      evidenceRefs: authorityBoundary.evidenceRefs,
      rawTextIncluded: false,
      rawPathIncluded: false,
      rawSecretIncluded: false,
    },
    blockerCodes,
    clarificationRequired: gateState === "clarification_required",
    clarificationPacketDigest: normalizeString(clarificationPacket?.clarificationPacketDigest, ""),
    clarificationPacket,
    nonTargetPreservationRequired: true,
    nonTargetPreservationConstraints,
    preconditionSatisfied: allowed,
    providerTransportAllowed,
    workspaceMutationAllowed,
    toolTransitionAllowed,
    executionAuthorityGranted: false,
    brokerPerformedObjectAudit: false,
    brokerPerformedWorkerTask: false,
    rendererSafeSummary: allowed
      ? "Governance preconditions are satisfied for this narrow transition."
      : gateState === "clarification_required"
        ? "Governance preconditions require operator clarification before this transition."
        : "Governance preconditions block this transition.",
    evidenceRefs,
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  preflight.preflightDigest = digestFor("direct-governance-enforcement-preflight@1", preflight);
  return preflight;
}

function assertGovernanceClarificationPacketSafe(packet = {}) {
  if (!isPlainObject(packet) || packet.schema !== DIRECT_GOVERNANCE_CLARIFICATION_PACKET_SCHEMA) {
    throw new Error("governance_clarification_packet_schema_mismatch");
  }
  if (packet.rawTextIncluded !== false || packet.rawPathIncluded !== false || packet.rawSecretIncluded !== false) {
    throw new Error("governance_clarification_packet_raw_exposure");
  }
  const authority = isPlainObject(packet.authority) ? packet.authority : {};
  for (const key of ["providerTransportAllowed", "workspaceMutationAllowed", "toolTransitionAllowed", "executionAuthorityGranted", "brokerPerformedObjectAudit", "brokerPerformedWorkerTask"]) {
    if (authority[key] !== false) throw new Error(`governance_clarification_packet_authority_leak:${key}`);
  }
  return true;
}

function validateGovernanceEnforcementPreflight(preflight = {}) {
  if (!isPlainObject(preflight) || preflight.schema !== DIRECT_GOVERNANCE_ENFORCEMENT_PREFLIGHT_SCHEMA) {
    throw new Error("governance_enforcement_preflight_schema_mismatch");
  }
  if (!GATE_STATES.has(preflight.gateState)) throw new Error(`governance_enforcement_invalid_gate:${preflight.gateState || ""}`);
  if (!TRANSITION_KINDS.has(preflight.transitionKind)) throw new Error(`governance_enforcement_invalid_transition:${preflight.transitionKind || ""}`);
  if (preflight.rawTextIncluded !== false || preflight.rawPathIncluded !== false || preflight.rawSecretIncluded !== false) {
    throw new Error("governance_enforcement_raw_exposure");
  }
  if (preflight.executionAuthorityGranted !== false || preflight.brokerPerformedObjectAudit !== false || preflight.brokerPerformedWorkerTask !== false) {
    throw new Error("governance_enforcement_authority_overclaim");
  }
  if (preflight.allowed !== true && (
    preflight.providerTransportAllowed === true ||
    preflight.workspaceMutationAllowed === true ||
    preflight.toolTransitionAllowed === true
  )) {
    throw new Error("governance_enforcement_blocked_allows_transition");
  }
  if (preflight.allowed === true && preflight.transitionKind === "unknown") {
    throw new Error("governance_enforcement_unknown_transition_allowed");
  }
  if (preflight.gateState === "clarification_required") {
    assertGovernanceClarificationPacketSafe(preflight.clarificationPacket);
  }
  if (preflight.gateState !== "allowed" && !arrayOrEmpty(preflight.blockerCodes).length) {
    throw new Error("governance_enforcement_blocked_without_reason");
  }
  return true;
}

module.exports = {
  DIRECT_GOVERNANCE_CLARIFICATION_PACKET_SCHEMA,
  DIRECT_GOVERNANCE_ENFORCEMENT_PREFLIGHT_SCHEMA,
  assertGovernanceClarificationPacketSafe,
  buildGovernanceClarificationPacket,
  buildGovernanceEnforcementPreflight,
  validateGovernanceEnforcementPreflight,
};
