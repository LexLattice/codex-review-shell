"use strict";

const crypto = require("node:crypto");

const DIRECT_LIVE_PROMOTION_CANDIDATE_QUEUE_SCHEMA = "direct_live_promotion_candidate_queue@1";
const DIRECT_LIVE_PROMOTION_ATTEMPT_RECORD_SCHEMA = "direct_live_promotion_attempt_record@1";

const CANDIDATE_DEFINITIONS = [
  {
    candidateId: "direct_text_turn_live_promotion",
    capabilityId: "direct_text_turn",
    label: "Direct text turn",
    capabilityKind: "text_turn",
    authorityClass: "provider_turn",
    fixtureEvidenceRefs: ["direct_text_turn_empty_context@1", "direct_real_usage_regression@1"],
    requiredLiveEvidence: ["live_provider_turn_completed", "usage_or_missing_usage_witness"],
    allowedNextRunLabel: "manual live text-turn smoke",
  },
  {
    candidateId: "direct_read_live_promotion",
    capabilityId: "direct_read",
    label: "Read continuation",
    capabilityKind: "read_tool",
    authorityClass: "read_only_tool_continuation",
    fixtureEvidenceRefs: ["direct_read_tool_loop_regression@1", "direct_electron_read_approval@1"],
    requiredLiveEvidence: ["live_read_request_completed", "post_read_continuation_completed"],
    allowedNextRunLabel: "manual live read approval smoke",
  },
  {
    candidateId: "direct_patch_live_promotion",
    capabilityId: "direct_patch",
    label: "Patch continuation",
    capabilityKind: "patch_tool",
    authorityClass: "workspace_mutation_tool_continuation",
    fixtureEvidenceRefs: ["direct_patch_tool_loop_regression@1", "direct_workspace_mutation_regression@1"],
    requiredLiveEvidence: ["live_patch_request_completed", "workspace_effect_truth_recorded", "post_patch_continuation_completed"],
    allowedNextRunLabel: "bounded manual patch smoke",
  },
  {
    candidateId: "direct_command_live_promotion",
    capabilityId: "direct_command",
    label: "Command continuation",
    capabilityKind: "command_tool",
    authorityClass: "command_tool_continuation",
    fixtureEvidenceRefs: ["direct_command_tool_loop_regression@1", "direct_tool_continuation_repair_loop_regression@1"],
    requiredLiveEvidence: ["live_command_request_completed", "command_policy_witness_recorded", "post_command_continuation_completed"],
    allowedNextRunLabel: "bounded manual command smoke",
  },
  {
    candidateId: "direct_repair_live_promotion",
    capabilityId: "direct_repair",
    label: "Repair loop",
    capabilityKind: "repair_loop",
    authorityClass: "bounded_repair_loop",
    fixtureEvidenceRefs: ["direct_iterative_repair_regression@1", "direct_tool_continuation_repair_loop_regression@1"],
    requiredLiveEvidence: ["live_repair_loop_started", "repair_iteration_cap_observed", "repair_stop_condition_observed"],
    allowedNextRunLabel: "manual repair-loop smoke",
  },
  {
    candidateId: "direct_recovery_live_promotion",
    capabilityId: "direct_recovery",
    label: "Recovery scanner",
    capabilityKind: "recovery",
    authorityClass: "recovery_projection",
    fixtureEvidenceRefs: ["direct_recovery_regression@1", "direct_ui_operation_history_regression@1"],
    requiredLiveEvidence: ["live_recovery_transition_observed", "stale_state_guard_observed"],
    allowedNextRunLabel: "manual recovery-state smoke",
  },
  {
    candidateId: "direct_usage_live_promotion",
    capabilityId: "direct_usage",
    label: "Usage witness",
    capabilityKind: "usage",
    authorityClass: "usage_observability",
    fixtureEvidenceRefs: ["direct_real_usage_regression@1", "direct_usage_readiness_regression@1", "direct_agent_usage_ledger_regression@1"],
    requiredLiveEvidence: ["live_usage_row_recorded", "missing_usage_row_recorded_when_unavailable"],
    allowedNextRunLabel: "manual usage witness smoke",
  },
  {
    candidateId: "direct_ui_readiness_live_promotion",
    capabilityId: "direct_ui_readiness",
    label: "UI readiness",
    capabilityKind: "ui_readiness",
    authorityClass: "renderer_safe_status",
    fixtureEvidenceRefs: ["direct_manual_smoke_gate_surface_regression@1", "direct_electron_settings_smoke_regression@1"],
    requiredLiveEvidence: ["electron_manual_smoke_passed", "renderer_safe_projection_confirmed"],
    allowedNextRunLabel: "Electron manual smoke",
  },
];

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function stableValue(value, seen = new WeakSet()) {
  if (Array.isArray(value)) {
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
    return value.map((item) => stableValue(item, seen));
  }
  if (value && typeof value === "object") {
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
    if (typeof value.toJSON === "function") {
      return stableValue(value.toJSON(), seen);
    }
    const output = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] !== undefined) output[key] = stableValue(value[key], seen);
    }
    return output;
  }
  return value;
}

function digestValue(value) {
  return `sha256:${crypto.createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex")}`;
}

function nowIso(input) {
  if (input instanceof Date) return input.toISOString();
  return normalizeString(input, "") || new Date().toISOString();
}

function toTimeMs(value) {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : NaN;
  }
  const parsed = Date.parse(normalizeString(value, ""));
  return Number.isFinite(parsed) ? parsed : NaN;
}

function evidenceRef(kind, refId, state = "present") {
  return {
    kind: normalizeString(kind, "evidence"),
    refId: normalizeString(refId, "unknown"),
    state: normalizeString(state, "present"),
    rendererSafe: true,
    rawPayloadIncluded: false,
    rawPathIncluded: false,
  };
}

function normalizeEvidenceRefs(refs, defaultKind) {
  return safeArray(refs).map((ref, index) => {
    if (typeof ref === "string") return evidenceRef(defaultKind, ref);
    if (isPlainObject(ref)) {
      return evidenceRef(ref.kind || defaultKind, ref.refId || ref.evidenceKey || `evidence_${index}`, ref.state || "present");
    }
    return evidenceRef(defaultKind, `evidence_${index}`);
  });
}

function evidenceExpired(expiresAt, referenceAt) {
  const expiresMs = toTimeMs(expiresAt);
  if (!Number.isFinite(expiresMs)) return false;
  const parsedReferenceMs = toTimeMs(referenceAt);
  const referenceMs = Number.isFinite(parsedReferenceMs) ? parsedReferenceMs : Date.now();
  return Number.isFinite(referenceMs) && expiresMs <= referenceMs;
}

function normalizeEvidenceState(input, fallbackState = "missing", referenceAt = "") {
  if (typeof input === "string") {
    return { state: input, evidenceRefs: [], observedAt: "", expiresAt: "", expired: false };
  }
  if (!isPlainObject(input)) return { state: fallbackState, evidenceRefs: [], observedAt: "", expiresAt: "", expired: false };
  const expiresAt = input.expiresAt instanceof Date ? input.expiresAt.toISOString() : normalizeString(input.expiresAt, "");
  const expired = evidenceExpired(expiresAt, referenceAt);
  const state = normalizeString(input.state || input.status, fallbackState);
  return {
    state: expired && isFreshSatisfied(state) ? "stale" : state,
    observedAt: input.observedAt instanceof Date ? input.observedAt.toISOString() : normalizeString(input.observedAt, ""),
    expiresAt,
    expired,
    evidenceRefs: normalizeEvidenceRefs(input.evidenceRefs, "runtime_evidence"),
  };
}

function isFreshSatisfied(evidenceOrState) {
  if (isPlainObject(evidenceOrState) && evidenceOrState.expired === true) return false;
  const state = isPlainObject(evidenceOrState) ? evidenceOrState.state : evidenceOrState;
  return [
    "accepted",
    "available",
    "fresh",
    "local_green",
    "passed",
    "profile_declared",
    "ready",
    "runtime_probed",
    "satisfied",
  ].includes(normalizeString(state, ""));
}

function isStale(state) {
  return ["stale", "expired"].includes(normalizeString(state, ""));
}

function candidateFixtureEvidence(definition, fixtureEvidenceByCapability = {}, referenceAt = "") {
  const hasOverride = Object.prototype.hasOwnProperty.call(Object(fixtureEvidenceByCapability), definition.capabilityId);
  const override = normalizeEvidenceState(hasOverride ? fixtureEvidenceByCapability[definition.capabilityId] : { state: "local_green" }, "local_green", referenceAt);
  const state = override.state;
  const refs = override.evidenceRefs.length
    ? override.evidenceRefs
    : definition.fixtureEvidenceRefs.map((refId) => evidenceRef("fixture_or_local_evidence", refId, state));
  return {
    state,
    evidenceRefs: refs,
  };
}

function buildRequirementRows(definition, liveEvidenceByCapability = {}, referenceAt = "") {
  const liveEvidence = liveEvidenceByCapability && isPlainObject(liveEvidenceByCapability[definition.capabilityId])
    ? liveEvidenceByCapability[definition.capabilityId]
    : {};
  return definition.requiredLiveEvidence.map((requirementId) => {
    const requirementEvidence = normalizeEvidenceState(liveEvidence[requirementId], "missing", referenceAt);
    return {
      requirementId,
      state: requirementEvidence.state,
      blockerCode: isFreshSatisfied(requirementEvidence)
        ? ""
        : isStale(requirementEvidence.state)
          ? `${requirementId}_stale`
          : `${requirementId}_missing`,
      evidenceRefs: requirementEvidence.evidenceRefs,
      rendererSafe: true,
      rawPayloadIncluded: false,
    };
  });
}

function normalizeAttempt(input, candidateId) {
  if (!isPlainObject(input)) return null;
  const status = normalizeString(input.status, "");
  if (!["skipped", "blocked", "failed", "passed"].includes(status)) return null;
  return {
    schema: DIRECT_LIVE_PROMOTION_ATTEMPT_RECORD_SCHEMA,
    attemptId: normalizeString(input.attemptId, `${candidateId}_attempt_${digestValue(input).slice(7, 19)}`),
    candidateId,
    status,
    attemptedAt: normalizeString(input.attemptedAt, ""),
    reasonCode: normalizeString(input.reasonCode, status),
    evidenceRefs: normalizeEvidenceRefs(input.evidenceRefs, "promotion_attempt_evidence"),
    reportOnly: true,
    changedDefaults: false,
    changedMatrixRows: false,
    providerTransportAuthorityGranted: false,
    workspaceMutationAuthorityGranted: false,
    recursiveWorkerAuthorityGranted: false,
    appServerFallbackAuthorityGranted: false,
    rendererSafe: true,
    rawProviderPayloadIncluded: false,
    rawLocalPathIncluded: false,
    rawToolOutputIncluded: false,
  };
}

function latestAttemptForCandidate(candidateId, attempts = []) {
  const normalized = safeArray(attempts)
    .map((attempt) => normalizeAttempt(attempt, normalizeString(attempt?.candidateId, candidateId)))
    .filter((attempt) => attempt && attempt.candidateId === candidateId);
  return normalized[normalized.length - 1] || null;
}

function buildCandidate(definition, input = {}) {
  const referenceAt = nowIso(input.generatedAt);
  const fixtureEvidence = candidateFixtureEvidence(definition, input.fixtureEvidenceByCapability, referenceAt);
  const requirements = buildRequirementRows(definition, input.liveEvidenceByCapability, referenceAt);
  const blockers = [];
  if (!isFreshSatisfied(fixtureEvidence)) {
    blockers.push("fixture_or_local_evidence_missing");
  }
  for (const requirement of requirements) {
    if (requirement.blockerCode) blockers.push(requirement.blockerCode);
  }
  if (input.operatorOptIn !== true) {
    blockers.push("operator_opt_in_missing");
  }
  const latestAttempt = latestAttemptForCandidate(definition.candidateId, input.attempts);
  const gateState = blockers.length ? "blocked" : "ready";
  const promotionState = latestAttempt?.status || "candidate";
  const sourceDigest = digestValue({ definition, fixtureEvidence, requirements, blockers, latestAttempt });
  return {
    candidateId: definition.candidateId,
    capabilityId: definition.capabilityId,
    label: definition.label,
    capabilityKind: definition.capabilityKind,
    authorityClass: definition.authorityClass,
    gateState,
    promotionState,
    fixtureEvidenceState: fixtureEvidence.state,
    fixtureEvidenceRefs: fixtureEvidence.evidenceRefs,
    requiredLiveEvidence: requirements,
    blockerCodes: blockers,
    latestAttempt,
    allowedNextPromotionRun: {
      label: definition.allowedNextRunLabel,
      gateState,
      operatorOptInRequired: true,
      manualSmokeRequired: true,
      canRunFromRenderer: false,
      transitionExposed: false,
      reason: gateState === "ready" ? "promotion_runner_not_exposed_in_pr43" : "evidence_gate_blocked",
    },
    authority: {
      providerTransportAuthorityGranted: false,
      workspaceMutationAuthorityGranted: false,
      recursiveWorkerAuthorityGranted: false,
      appServerFallbackAuthorityGranted: false,
      matrixRowMutationAuthorityGranted: false,
      defaultMutationAuthorityGranted: false,
    },
    sourceDigest,
    rendererSafe: true,
    rawProviderPayloadIncluded: false,
    rawLocalPathIncluded: false,
    rawToolOutputIncluded: false,
  };
}

function buildLivePromotionAttemptRecord(input = {}) {
  const candidateId = normalizeString(input.candidateId, "unknown_candidate");
  const attempt = normalizeAttempt(input, candidateId);
  if (!attempt) {
    const error = new Error("invalid_live_promotion_attempt_status");
    error.code = "invalid_live_promotion_attempt_status";
    throw error;
  }
  assertLivePromotionAttemptRecordSafe(attempt);
  return attempt;
}

function buildLivePromotionCandidateQueue(input = {}) {
  const projectId = normalizeString(input.projectId, "");
  const generatedAt = nowIso(input.generatedAt);
  const candidates = CANDIDATE_DEFINITIONS.map((definition) => buildCandidate(definition, input));
  const attemptRecords = safeArray(input.attempts)
    .map((attempt) => normalizeAttempt(attempt, normalizeString(attempt?.candidateId, "")))
    .filter(Boolean);
  const readyCount = candidates.filter((candidate) => candidate.gateState === "ready").length;
  const blockedCount = candidates.filter((candidate) => candidate.gateState === "blocked").length;
  const passedAttemptCount = attemptRecords.filter((attempt) => attempt.status === "passed").length;
  const queueDigest = digestValue({ projectId, generatedAt, candidates, attemptRecords });
  const queue = {
    schema: DIRECT_LIVE_PROMOTION_CANDIDATE_QUEUE_SCHEMA,
    projectId,
    generatedAt,
    source: "direct-readiness-live-promotion-candidate-gate",
    queueState: readyCount > 0 ? "has_ready_candidates" : "blocked",
    candidateCount: candidates.length,
    readyCount,
    blockedCount,
    attemptCount: attemptRecords.length,
    passedAttemptCount,
    candidates,
    attemptRecords,
    blockerCodes: [...new Set(candidates.flatMap((candidate) => candidate.blockerCodes))],
    authority: {
      displayOnly: true,
      promotionExecutionAuthorityGranted: false,
      providerTransportAuthorityGranted: false,
      workspaceMutationAuthorityGranted: false,
      recursiveWorkerAuthorityGranted: false,
      appServerFallbackAuthorityGranted: false,
      matrixRowMutationAuthorityGranted: false,
      defaultMutationAuthorityGranted: false,
    },
    reportEffects: {
      changesDefaults: false,
      changesMatrixRows: false,
      changesRuntimeSelection: false,
      grantsWorkspaceMutation: false,
      grantsRecursiveWorker: false,
      grantsAppServerFallback: false,
    },
    queueDigest,
    rendererSafe: true,
    rawProviderPayloadIncluded: false,
    rawLocalPathIncluded: false,
    rawToolOutputIncluded: false,
  };
  assertLivePromotionCandidateQueueSafe(queue);
  return queue;
}

function collectStrings(value, output = [], seen = new WeakSet()) {
  if (typeof value === "string") {
    output.push(value);
    return output;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) return output;
    seen.add(value);
    for (const item of value) collectStrings(item, output, seen);
    return output;
  }
  if (value && typeof value === "object") {
    if (seen.has(value)) return output;
    seen.add(value);
    for (const item of Object.values(value)) collectStrings(item, output, seen);
  }
  return output;
}

function assertNoRawExposure(value) {
  const text = collectStrings(value).join("\n");
  const forbidden = [
    /sk-[A-Za-z0-9_-]{16,}/,
    /Bearer\s+[A-Za-z0-9._-]{16,}/i,
    /\/home\/[^/\s]+\/[^\s]+/,
    /\/mnt\/[a-z]\/[^\s]+/i,
    /\\\\wsl\.localhost\\/i,
    /https:\/\/chatgpt\.com\/[^\s)]+/i,
  ];
  for (const pattern of forbidden) {
    if (pattern.test(text)) {
      const error = new Error("direct_live_promotion_raw_exposure");
      error.code = "direct_live_promotion_raw_exposure";
      throw error;
    }
  }
  return true;
}

function assertLivePromotionAttemptRecordSafe(attempt) {
  if (!isPlainObject(attempt) || attempt.schema !== DIRECT_LIVE_PROMOTION_ATTEMPT_RECORD_SCHEMA) {
    throw new Error("invalid_live_promotion_attempt_record");
  }
  if (attempt.changedDefaults || attempt.changedMatrixRows) throw new Error("live_promotion_attempt_mutates_report_state");
  if (attempt.providerTransportAuthorityGranted || attempt.workspaceMutationAuthorityGranted || attempt.recursiveWorkerAuthorityGranted || attempt.appServerFallbackAuthorityGranted) {
    throw new Error("live_promotion_attempt_grants_authority");
  }
  if (attempt.rendererSafe !== true || attempt.rawProviderPayloadIncluded !== false || attempt.rawLocalPathIncluded !== false || attempt.rawToolOutputIncluded !== false) {
    throw new Error("live_promotion_attempt_not_renderer_safe");
  }
  assertNoRawExposure(attempt);
  return true;
}

function assertLivePromotionCandidateQueueSafe(queue) {
  if (!isPlainObject(queue) || queue.schema !== DIRECT_LIVE_PROMOTION_CANDIDATE_QUEUE_SCHEMA) {
    throw new Error("invalid_live_promotion_candidate_queue");
  }
  if (!Array.isArray(queue.candidates) || queue.candidates.length !== CANDIDATE_DEFINITIONS.length) {
    throw new Error("live_promotion_candidate_count_mismatch");
  }
  if (queue.authority?.promotionExecutionAuthorityGranted || queue.authority?.providerTransportAuthorityGranted || queue.authority?.workspaceMutationAuthorityGranted) {
    throw new Error("live_promotion_queue_grants_authority");
  }
  if (queue.reportEffects?.changesDefaults || queue.reportEffects?.changesMatrixRows || queue.reportEffects?.changesRuntimeSelection) {
    throw new Error("live_promotion_queue_mutates_status_truth");
  }
  for (const candidate of queue.candidates) {
    if (candidate.authority?.providerTransportAuthorityGranted || candidate.authority?.workspaceMutationAuthorityGranted || candidate.authority?.recursiveWorkerAuthorityGranted || candidate.authority?.appServerFallbackAuthorityGranted || candidate.authority?.matrixRowMutationAuthorityGranted) {
      throw new Error(`live_promotion_candidate_grants_authority:${candidate.candidateId}`);
    }
    if (candidate.allowedNextPromotionRun?.canRunFromRenderer || candidate.allowedNextPromotionRun?.transitionExposed) {
      throw new Error(`live_promotion_candidate_exposes_runner:${candidate.candidateId}`);
    }
    if (candidate.gateState === "blocked" && !candidate.blockerCodes.length) {
      throw new Error(`live_promotion_candidate_missing_blocker:${candidate.candidateId}`);
    }
  }
  for (const attempt of safeArray(queue.attemptRecords)) assertLivePromotionAttemptRecordSafe(attempt);
  if (queue.rendererSafe !== true || queue.rawProviderPayloadIncluded !== false || queue.rawLocalPathIncluded !== false || queue.rawToolOutputIncluded !== false) {
    throw new Error("live_promotion_queue_not_renderer_safe");
  }
  assertNoRawExposure(queue);
  return true;
}

module.exports = {
  DIRECT_LIVE_PROMOTION_ATTEMPT_RECORD_SCHEMA,
  DIRECT_LIVE_PROMOTION_CANDIDATE_QUEUE_SCHEMA,
  buildLivePromotionAttemptRecord,
  buildLivePromotionCandidateQueue,
  assertLivePromotionAttemptRecordSafe,
  assertLivePromotionCandidateQueueSafe,
};
