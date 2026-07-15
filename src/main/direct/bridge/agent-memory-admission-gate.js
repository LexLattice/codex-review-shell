"use strict";

const crypto = require("node:crypto");
const {
  buildAgentMemoryExtractionTransition,
  buildAgentMemoryRow,
  memoryContextEligible,
} = require("./agent-memory-store");
const {
  buildAgentMemoryContextProjection,
  buildLegacyNonWave26AgentMemoryContextProjection,
} = require("./agent-context-source-refs");

const DIRECT_AGENT_MEMORY_CANDIDATE_ENVELOPE_SCHEMA = "direct_agent_memory_candidate_envelope@1";
const DIRECT_AGENT_MEMORY_ADMISSION_TRANSITION_SCHEMA = "direct_agent_memory_admission_transition@1";
const DIRECT_AGENT_MEMORY_ADMISSION_PROOF_SCHEMA = "direct_agent_memory_admission_proof@1";
const DIRECT_AGENT_MEMORY_ADMISSION_REPORT_SCHEMA = "direct_agent_memory_admission_report@1";

const ADMISSION_STATES = new Set(["candidate", "needs_review", "accepted", "rejected"]);
const ADMISSION_DECISION_SOURCES = new Set([
  "operator_curated",
  "manual_fixture",
  "resident_review",
  "policy_gate",
]);
const BLOCKER_KINDS = new Set([
  "missing_identity_scope",
  "missing_source_evidence",
  "missing_extraction_evidence",
  "missing_admission_evidence",
  "candidate_not_accepted",
  "cross_project_scope",
  "current_user_conflict",
  "newer_workspace_evidence",
  "newer_tool_evidence",
  "policy_conflict",
  "provider_hosted_source_only",
  "mcp_source_only",
  "authority_escalation_attempt",
  "raw_payload_leak",
  "automatic_durable_memory_blocked",
  "superseded_memory_conflict",
]);

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype;
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function preserveString(value) {
  return typeof value === "string" ? value : "";
}

function boundedText(value, maxChars = 360) {
  const text = preserveString(value).replace(/\s+/g, " ").trim();
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1)).trim()}…`;
}

function nowIso(nowMs = Date.now()) {
  const parsed = Number(nowMs);
  return new Date(Number.isFinite(parsed) ? parsed : Date.now()).toISOString();
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (isPlainObject(value)) {
    const output = {};
    for (const key of Object.keys(value).sort()) {
      if (["candidateDigest", "transitionDigest", "proofDigest", "reportDigest"].includes(key)) continue;
      if (value[key] !== undefined) output[key] = stableValue(value[key]);
    }
    return output;
  }
  return value;
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function digestValue(prefix, value) {
  return `sha256:${sha256(`${prefix}\0${stableJson(value)}`)}`;
}

function safeSlotPart(value, fallback = "memory") {
  const text = normalizeString(value, fallback);
  return text.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 140) || fallback;
}

function pickEnum(value, allowed, fallback) {
  const normalized = normalizeString(value, fallback);
  return allowed.has(normalized) ? normalized : fallback;
}

function normalizeSourceRef(input = {}, fallbackKind = "memory_source") {
  const source = isPlainObject(input) ? input : {};
  const ref = {
    kind: normalizeString(source.kind || source.refKind || source.sourceKind, fallbackKind),
    id: normalizeString(source.id || source.refId || source.sourceId || source.artifactId, ""),
    digest: normalizeString(source.digest || source.sourceDigest || source.artifactDigest, ""),
    label: boundedText(source.label || source.displayLabel || source.kind || fallbackKind, 180),
    confidence: normalizeString(source.confidence || source.sourceConfidence, "diagnostic"),
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  ref.refDigest = digestValue("direct-agent-memory-admission-source-ref@1", ref);
  return ref;
}

function normalizeSourceRefs(values = [], fallbackKind = "memory_source") {
  const refs = (Array.isArray(values) ? values : [])
    .map((value) => normalizeSourceRef(value, fallbackKind))
    .filter((ref) => ref.id || ref.digest);
  const byKey = new Map();
  for (const ref of refs) {
    const key = ref.id ? `${ref.kind}:${ref.id}` : ref.digest ? `digest:${ref.digest}` : ref.refDigest;
    if (!byKey.has(key)) byKey.set(key, ref);
  }
  return [...byKey.values()].sort((a, b) => `${a.kind}:${a.id}:${a.digest}`.localeCompare(`${b.kind}:${b.id}:${b.digest}`));
}

function normalizeStringList(values = []) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => normalizeString(value, ""))
    .filter(Boolean))]
    .sort();
}

function normalizeScope(scope = {}, fallback = {}) {
  const source = isPlainObject(scope) ? scope : {};
  return {
    projectId: normalizeString(source.projectId || fallback.projectId, ""),
    workThreadId: normalizeString(source.workThreadId || fallback.workThreadId, ""),
    roleLane: normalizeString(source.roleLane || fallback.roleLane, ""),
    memoryScope: normalizeString(source.memoryScope || fallback.memoryScope, "agent_private"),
  };
}

function normalizeProposedMemory(input = {}, fallback = {}) {
  const source = isPlainObject(input) ? input : {};
  const agentId = normalizeString(source.agentId || fallback.agentId, "");
  const revision = Number(source.revision);
  const scope = normalizeScope(source.scope, {
    projectId: source.projectId || fallback.projectId,
    workThreadId: source.workThreadId || fallback.workThreadId,
    roleLane: source.roleLane || fallback.roleLane,
    memoryScope: source.memoryScope || fallback.memoryScope,
  });
  return {
    memoryId: safeSlotPart(source.memoryId || source.id || fallback.memoryId || `direct_agent_memory_candidate_${sha256(stableJson({
      projectId: source.projectId || scope.projectId || fallback.projectId,
      agentId: source.agentId || fallback.agentId,
      kind: source.kind || "preference",
      contentSummary: source.contentSummary || source.summary,
    })).slice(0, 24)}`, "direct_agent_memory_candidate"),
    agentId: agentId ? safeSlotPart(agentId, "direct_agent") : "",
    projectId: normalizeString(source.projectId || scope.projectId || fallback.projectId, ""),
    scope,
    kind: normalizeString(source.kind, "preference"),
    contentSummary: boundedText(source.contentSummary || source.summary, 2000),
    contentSummaryDigest: normalizeString(source.contentSummaryDigest, ""),
    summaryPolicyId: normalizeString(source.summaryPolicyId, "memory_admission_summary@1"),
    confidence: normalizeString(source.confidence, "candidate"),
    authorityUse: normalizeString(source.authorityUse, "not_authoritative"),
    contextEligibility: normalizeString(source.contextEligibility, "not_eligible_candidate"),
    conflictState: normalizeString(source.conflictState, "none"),
    conflictResolution: normalizeString(source.conflictResolution, "unknown"),
    auditState: normalizeString(source.auditState, "unaudited"),
    revision: Number.isFinite(revision) ? Math.max(1, revision) : 1,
    supersedesMemoryId: normalizeString(source.supersedesMemoryId, ""),
    supersededByMemoryId: normalizeString(source.supersededByMemoryId, ""),
    expiresAt: normalizeString(source.expiresAt, ""),
    invalidationRule: boundedText(source.invalidationRule, 360),
  };
}

function candidateIdFor(input = {}) {
  const explicit = normalizeString(input.candidateId || input.id, "");
  if (explicit) return safeSlotPart(explicit, "direct_agent_memory_candidate");
  return `direct_agent_memory_candidate_${sha256(stableJson({
    proposedMemory: input.proposedMemory,
    sourceRefs: normalizeSourceRefs(input.sourceRefs || input.evidenceRefs, "memory_candidate_source"),
    candidatePolicyId: normalizeString(input.candidatePolicyId, "agent_memory_candidate_policy@1"),
  })).slice(0, 24)}`;
}

function buildMemoryCandidateEnvelope(input = {}, options = {}) {
  const source = isPlainObject(input) ? input : {};
  const proposedMemory = normalizeProposedMemory(source.proposedMemory || source.memory || source, source);
  const sourceRefs = normalizeSourceRefs(source.sourceRefs || source.evidenceRefs, "memory_candidate_source");
  const sourceThreadIds = normalizeStringList(source.sourceThreadIds || source.provenance?.sourceThreadIds);
  const sourceTurnIds = normalizeStringList(source.sourceTurnIds || source.provenance?.sourceTurnIds);
  const candidate = {
    schema: DIRECT_AGENT_MEMORY_CANDIDATE_ENVELOPE_SCHEMA,
    candidateId: candidateIdFor({ ...source, proposedMemory, sourceRefs }),
    projectId: proposedMemory.projectId,
    agentId: proposedMemory.agentId,
    workThreadId: normalizeString(source.workThreadId || proposedMemory.scope.workThreadId, ""),
    roleLane: normalizeString(source.roleLane || proposedMemory.scope.roleLane, ""),
    candidateState: pickEnum(source.candidateState, ADMISSION_STATES, "candidate"),
    candidatePolicyId: normalizeString(source.candidatePolicyId, "agent_memory_candidate_policy@1"),
    sourceKind: normalizeString(source.sourceKind, "transcript_or_artifact"),
    proposedMemory,
    sourceRefs,
    sourceThreadIds,
    sourceTurnIds,
    createdAt: normalizeString(source.createdAt, nowIso(options.nowMs)),
    rawTranscriptIncluded: Boolean(source.rawTranscriptIncluded),
    rawTextIncluded: Boolean(source.rawTextIncluded),
    rawPathIncluded: Boolean(source.rawPathIncluded),
    rawSecretIncluded: Boolean(source.rawSecretIncluded),
    actionAuthorityGranted: Boolean(source.actionAuthorityGranted),
  };
  candidate.candidateDigest = digestValue("direct-agent-memory-candidate-envelope@1", candidate);
  return candidate;
}

function transitionIdFor(input = {}) {
  const explicit = normalizeString(input.admissionTransitionId || input.id, "");
  if (explicit) return safeSlotPart(explicit, "direct_agent_memory_admission");
  return `direct_agent_memory_admission_${sha256(stableJson({
    candidateId: input.candidateId,
    admissionState: input.admissionState,
    decisionSource: input.decisionSource,
    reviewerId: input.reviewerId,
  })).slice(0, 24)}`;
}

function normalizedBlocker(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const kind = pickEnum(source.kind || source.blockerKind, BLOCKER_KINDS, "policy_conflict");
  return {
    kind,
    severity: normalizeString(source.severity, kind.includes("missing") ? "blocking" : "review"),
    reason: boundedText(source.reason || source.message || kind, 320),
    evidenceRefs: normalizeSourceRefs(source.evidenceRefs || source.sourceRefs, "memory_admission_blocker"),
  };
}

function builtInBlockers(candidate = {}, options = {}) {
  const blockers = [];
  const memory = candidate.proposedMemory || {};
  const projectId = normalizeString(options.projectId || candidate.projectId || memory.projectId, "");
  if (!candidate.agentId || !candidate.projectId || !memory.agentId || !memory.projectId) {
    blockers.push({ kind: "missing_identity_scope", reason: "Memory admission requires project and agent identity." });
  }
  const hasRealSourceRef = Array.isArray(candidate.sourceRefs)
    && candidate.sourceRefs.some((ref) => normalizeString(ref?.id || ref?.digest, ""));
  if (!hasRealSourceRef && !candidate.sourceThreadIds?.length && !candidate.sourceTurnIds?.length) {
    blockers.push({ kind: "missing_source_evidence", reason: "Memory admission requires transcript or artifact source evidence." });
  }
  if (projectId && ((memory.projectId && memory.projectId !== projectId) || (memory.scope?.projectId && memory.scope.projectId !== projectId))) {
    blockers.push({ kind: "cross_project_scope", reason: "Candidate memory project does not match active project." });
  }
  if (memory.conflictState === "conflicts_with_current_user" || options.currentUserConflict === true) {
    blockers.push({ kind: "current_user_conflict", reason: "Current user intent overrides durable memory admission." });
  }
  if (memory.conflictState === "conflicts_with_workspace_evidence" || options.newerWorkspaceEvidence === true) {
    blockers.push({ kind: "newer_workspace_evidence", reason: "Newer workspace evidence forces review or omission." });
  }
  if (options.newerToolEvidence === true) {
    blockers.push({ kind: "newer_tool_evidence", reason: "Newer tool evidence forces review or omission." });
  }
  if (memory.conflictState === "conflicts_with_policy" || options.policyConflict === true) {
    blockers.push({ kind: "policy_conflict", reason: "Policy conflict blocks context admission." });
  }
  if (candidate.actionAuthorityGranted === true || memory.authorityUse === "constraint_candidate" || options.authorityEscalationAttempt === true) {
    blockers.push({ kind: "authority_escalation_attempt", reason: "Memory cannot grant read, patch, command, sub-agent, or hosted-provider authority." });
  }
  if (candidate.rawTranscriptIncluded || candidate.rawTextIncluded || candidate.rawPathIncluded || candidate.rawSecretIncluded) {
    blockers.push({ kind: "raw_payload_leak", reason: "Candidate envelope must not carry raw transcript, path, text, or secret payloads." });
  }
  if (candidate.sourceKind === "provider_hosted_result" || options.providerHostedSourceOnly === true) {
    blockers.push({ kind: "provider_hosted_source_only", reason: "Provider-hosted results cannot automatically become durable memory in V0." });
  }
  if (candidate.sourceKind === "mcp_result" || options.mcpSourceOnly === true) {
    blockers.push({ kind: "mcp_source_only", reason: "MCP results cannot automatically become durable memory in V0." });
  }
  if (candidate.sourceKind === "automated_mining" || options.automatedDurableMemory === true) {
    blockers.push({ kind: "automatic_durable_memory_blocked", reason: "Autonomous memory mining is a Wave 21 non-goal." });
  }
  return blockers.map(normalizedBlocker);
}

function transitionStateFor(candidate = {}, blockers = [], requestedState = "") {
  const requested = pickEnum(requestedState, ADMISSION_STATES, candidate.candidateState || "candidate");
  if (requested === "rejected") return "rejected";
  if (requested === "accepted" && !blockers.length) return "accepted";
  if (blockers.length) return "needs_review";
  return requested === "candidate" ? "candidate" : requested;
}

function buildMemoryAdmissionTransition(input = {}, options = {}) {
  const source = isPlainObject(input) ? input : {};
  const candidate = source.candidate?.schema === DIRECT_AGENT_MEMORY_CANDIDATE_ENVELOPE_SCHEMA
    ? source.candidate
    : buildMemoryCandidateEnvelope(source.candidate || source, options);
  const blockers = [
    ...builtInBlockers(candidate, { ...options, ...source }),
    ...(Array.isArray(source.blockers) ? source.blockers.map(normalizedBlocker) : []),
  ];
  const admissionState = transitionStateFor(candidate, blockers, source.admissionState || source.decision);
  const transition = {
    schema: DIRECT_AGENT_MEMORY_ADMISSION_TRANSITION_SCHEMA,
    admissionTransitionId: transitionIdFor({
      ...source,
      candidateId: candidate.candidateId,
      admissionState,
    }),
    candidateId: candidate.candidateId,
    candidateDigest: candidate.candidateDigest,
    projectId: candidate.projectId,
    agentId: candidate.agentId,
    memoryId: candidate.proposedMemory.memoryId,
    admissionState,
    decisionSource: pickEnum(source.decisionSource, ADMISSION_DECISION_SOURCES, "manual_fixture"),
    reviewerId: normalizeString(source.reviewerId, ""),
    admissionPolicyId: normalizeString(source.admissionPolicyId, "agent_memory_admission_policy@1"),
    blockers,
    blockerCount: blockers.length,
    contextEligibilityDecision: admissionState === "accepted" ? "eligible_after_projection" : "not_eligible_candidate",
    supersedesMemoryId: normalizeString(source.supersedesMemoryId || candidate.proposedMemory.supersedesMemoryId, ""),
    conflictResolution: normalizeString(source.conflictResolution || candidate.proposedMemory.conflictResolution, admissionState === "accepted" ? "newer_evidence_wins" : "manual_review_required"),
    evidenceRefs: normalizeSourceRefs([
      ...candidate.sourceRefs,
      ...(Array.isArray(source.evidenceRefs) ? source.evidenceRefs : []),
    ], "memory_admission_evidence"),
    decidedAt: normalizeString(source.decidedAt, nowIso(options.nowMs)),
    rawTranscriptIncluded: Boolean(source.rawTranscriptIncluded || candidate.rawTranscriptIncluded),
    rawTextIncluded: Boolean(source.rawTextIncluded || candidate.rawTextIncluded),
    rawPathIncluded: Boolean(source.rawPathIncluded || candidate.rawPathIncluded),
    rawSecretIncluded: Boolean(source.rawSecretIncluded || candidate.rawSecretIncluded),
    actionAuthorityGranted: Boolean(source.actionAuthorityGranted || candidate.actionAuthorityGranted),
  };
  transition.transitionDigest = digestValue("direct-agent-memory-admission-transition@1", transition);
  return transition;
}

function buildExtractionTransitionForCandidate(candidate = {}, transition = {}, options = {}) {
  return buildAgentMemoryExtractionTransition({
    extractionTransitionId: normalizeString(options.extractionTransitionId, `direct_agent_memory_extraction_${sha256(`${candidate.candidateId}:${transition.admissionTransitionId}`).slice(0, 24)}`),
    projectId: candidate.projectId,
    agentId: candidate.agentId,
    extractionMode: transition.decisionSource === "operator_curated" ? "operator_curated" : "manual_fixture",
    outputMemoryIds: [candidate.proposedMemory.memoryId],
    extractionPolicyId: normalizeString(options.extractionPolicyId, "agent_memory_admission_extraction@1"),
    sourceRefs: candidate.sourceRefs,
  }, options);
}

function buildMemoryRowFromAdmission(candidate = {}, transition = {}, extractionTransition = {}, options = {}) {
  if (transition.admissionState !== "accepted") {
    throw new Error("accepted memory requires accepted admission transition");
  }
  if (!extractionTransition?.extractionTransitionId) {
    throw new Error("accepted memory requires extraction evidence");
  }
  const proposed = candidate.proposedMemory || {};
  return buildAgentMemoryRow({
    ...proposed,
    confidence: proposed.confidence === "candidate" ? "high" : proposed.confidence,
    authorityUse: proposed.authorityUse === "not_authoritative" ? "context_evidence" : proposed.authorityUse,
    contextEligibility: "eligible",
    conflictState: proposed.conflictState === "none" ? "none" : proposed.conflictState,
    conflictResolution: transition.conflictResolution || proposed.conflictResolution,
    auditState: "accepted",
    supersedesMemoryId: transition.supersedesMemoryId || proposed.supersedesMemoryId,
    provenance: {
      sourceThreadIds: candidate.sourceThreadIds,
      sourceTurnIds: candidate.sourceTurnIds,
      sourceArtifactRefs: candidate.sourceRefs,
      extractionTransitionId: extractionTransition.extractionTransitionId,
    },
  }, options);
}

function buildMemoryAdmissionProof(input = {}, options = {}) {
  const source = isPlainObject(input) ? input : {};
  const candidate = source.candidate;
  const admissionTransition = source.admissionTransition;
  const extractionTransition = source.extractionTransition || null;
  const memoryRow = source.memoryRow || null;
  const projection = source.memoryContextProjection || null;
  const blockers = [];
  if (!candidate || candidate.schema !== DIRECT_AGENT_MEMORY_CANDIDATE_ENVELOPE_SCHEMA) blockers.push("missing_candidate");
  if (!admissionTransition || admissionTransition.schema !== DIRECT_AGENT_MEMORY_ADMISSION_TRANSITION_SCHEMA) blockers.push("missing_admission_transition");
  if (admissionTransition && admissionTransition.admissionState !== "accepted") blockers.push("candidate_not_accepted");
  if (admissionTransition?.admissionState === "accepted" && !extractionTransition?.extractionTransitionId) blockers.push("missing_extraction_evidence");
  if (admissionTransition?.admissionState === "accepted" && !memoryRow?.memoryId) blockers.push("missing_memory_row");
  if (admissionTransition?.admissionState === "accepted" && !projection?.projectionId) blockers.push("missing_context_projection");
  if (candidate?.rawTranscriptIncluded || candidate?.rawTextIncluded || candidate?.rawPathIncluded || candidate?.rawSecretIncluded
    || admissionTransition?.rawTranscriptIncluded || admissionTransition?.rawTextIncluded || admissionTransition?.rawPathIncluded || admissionTransition?.rawSecretIncluded) {
    blockers.push("raw_payload_leak");
  }
  if (candidate?.actionAuthorityGranted || admissionTransition?.actionAuthorityGranted) blockers.push("memory_authority_leak");
  if (memoryRow?.actionAuthorityGranted === true) blockers.push("memory_authority_leak");
  if (memoryRow && !memoryContextEligible(memoryRow, options)) blockers.push("memory_not_context_eligible");
  if (projection && projection.selectedMemoryRefs?.some((ref) => ref.memoryId === memoryRow?.memoryId) !== true) {
    blockers.push("accepted_memory_not_projected");
  }
  const proof = {
    schema: DIRECT_AGENT_MEMORY_ADMISSION_PROOF_SCHEMA,
    candidateId: normalizeString(candidate?.candidateId, ""),
    admissionTransitionId: normalizeString(admissionTransition?.admissionTransitionId, ""),
    extractionTransitionId: normalizeString(extractionTransition?.extractionTransitionId, ""),
    memoryId: normalizeString(memoryRow?.memoryId, ""),
    proofState: blockers.length ? "blocked" : "proved",
    blockers,
    contextProjectionRequired: true,
    contextProjectionSatisfied: Boolean(projection && memoryRow && projection.selectedMemoryRefs?.some((ref) => ref.memoryId === memoryRow.memoryId)),
    memoryCannotOverrideCurrentUser: true,
    memoryGrantsAuthority: false,
    rawTranscriptIncluded: Boolean(candidate?.rawTranscriptIncluded || admissionTransition?.rawTranscriptIncluded),
    rawTextIncluded: Boolean(candidate?.rawTextIncluded || admissionTransition?.rawTextIncluded),
    rawPathIncluded: Boolean(candidate?.rawPathIncluded || admissionTransition?.rawPathIncluded),
    rawSecretIncluded: Boolean(candidate?.rawSecretIncluded || admissionTransition?.rawSecretIncluded),
    createdAt: nowIso(options.nowMs),
  };
  proof.proofDigest = digestValue("direct-agent-memory-admission-proof@1", proof);
  return proof;
}

function runMemoryAdmissionWorkflowInternal(input = {}, options = {}, posture = "wave26") {
  const source = isPlainObject(input) ? input : {};
  const candidate = buildMemoryCandidateEnvelope(source.candidate || source, options);
  const admissionTransition = buildMemoryAdmissionTransition({
    ...(source.admission || {}),
    candidate,
  }, options);
  let extractionTransition = null;
  let memoryRow = null;
  let memoryContextProjection = null;
  if (admissionTransition.admissionState === "accepted") {
    extractionTransition = buildExtractionTransitionForCandidate(candidate, admissionTransition, options);
    memoryRow = buildMemoryRowFromAdmission(candidate, admissionTransition, extractionTransition, options);
    const memoryContextInput = {
      projectId: memoryRow.projectId,
      agentId: memoryRow.agentId,
      workThreadId: memoryRow.scope.workThreadId,
      roleLane: memoryRow.scope.roleLane,
      threadId: options.threadId,
      turnId: options.turnId,
      selectionEnabled: true,
      selectedMemoryIds: [memoryRow.memoryId],
      memoryRows: [memoryRow],
    };
    memoryContextProjection = posture === "legacy_non_wave26"
      ? buildLegacyNonWave26AgentMemoryContextProjection(memoryContextInput, options)
      : buildAgentMemoryContextProjection(memoryContextInput, options);
  }
  const admissionProof = buildMemoryAdmissionProof({
    candidate,
    admissionTransition,
    extractionTransition,
    memoryRow,
    memoryContextProjection,
  }, {
    projectId: candidate.projectId,
    agentId: candidate.agentId,
    workThreadId: candidate.proposedMemory.scope.workThreadId,
    roleLane: candidate.proposedMemory.scope.roleLane,
    nowMs: options.nowMs,
  });
  const report = {
    schema: DIRECT_AGENT_MEMORY_ADMISSION_REPORT_SCHEMA,
    candidate,
    admissionTransition,
    extractionTransition,
    memoryRow,
    memoryContextProjection,
    admissionProof,
    acceptedMemoryRequiresProjection: true,
    actionAuthorityGranted: Boolean(candidate.actionAuthorityGranted || admissionTransition.actionAuthorityGranted || memoryRow?.actionAuthorityGranted),
    rawTranscriptIncluded: Boolean(candidate.rawTranscriptIncluded || admissionTransition.rawTranscriptIncluded),
    rawTextIncluded: Boolean(candidate.rawTextIncluded || admissionTransition.rawTextIncluded),
    rawPathIncluded: Boolean(candidate.rawPathIncluded || admissionTransition.rawPathIncluded),
    rawSecretIncluded: Boolean(candidate.rawSecretIncluded || admissionTransition.rawSecretIncluded),
  };
  report.reportDigest = digestValue("direct-agent-memory-admission-report@1", report);
  return report;
}

// The live/Wave26 workflow is always cutover-runtime governed.  In
// particular, an admission caller cannot select a historical path by adding a
// boolean opt-out or by supplying a resolver/registry snapshot.
function runMemoryAdmissionWorkflow(input = {}, options = {}) {
  const source = isPlainObject(input) ? input : {};
  const opts = isPlainObject(options) ? options : {};
  if (source.legacyNonWave26Context === true || opts.legacyNonWave26Context === true)
    throw Object.assign(new Error("direct_agent_memory_wave26_legacy_optout_forbidden"), { code: "direct_agent_memory_wave26_legacy_optout_forbidden" });
  if (source.memoryAuthorityResolver || opts.memoryAuthorityResolver || source.memoryAuthorityCutoverRegistry || opts.memoryAuthorityCutoverRegistry || source.registry || opts.registry || source.memoryAuthorityRuntime)
    throw Object.assign(new Error("direct_agent_memory_caller_authority_forbidden"), { code: "direct_agent_memory_caller_authority_forbidden" });
  return runMemoryAdmissionWorkflowInternal(source, opts, "wave26");
}

// Historical AgentMemory readback remains available, but it is deliberately
// not reachable through runMemoryAdmissionWorkflow.
function runLegacyNonWave26MemoryAdmissionWorkflow(input = {}, options = {}) {
  return runMemoryAdmissionWorkflowInternal(input, options, "legacy_non_wave26");
}

module.exports = {
  DIRECT_AGENT_MEMORY_ADMISSION_PROOF_SCHEMA,
  DIRECT_AGENT_MEMORY_ADMISSION_REPORT_SCHEMA,
  DIRECT_AGENT_MEMORY_ADMISSION_TRANSITION_SCHEMA,
  DIRECT_AGENT_MEMORY_CANDIDATE_ENVELOPE_SCHEMA,
  buildMemoryAdmissionProof,
  buildMemoryAdmissionTransition,
  buildMemoryCandidateEnvelope,
  buildMemoryRowFromAdmission,
  runMemoryAdmissionWorkflow,
  runLegacyNonWave26MemoryAdmissionWorkflow,
};
