"use strict";

const crypto = require("node:crypto");
const { memoryContextEligible } = require("./agent-memory-store");

const DIRECT_CONTEXT_SOURCE_REF_SCHEMA = "direct_context_source_ref@1";
const DIRECT_AGENT_MEMORY_CONTEXT_PROJECTION_SCHEMA = "direct_agent_memory_context_projection@1";
const DIRECT_AGENT_CONTEXT_SOURCE_ADAPTER_SCHEMA = "direct_agent_context_source_adapter@1";
const DEFAULT_AGENT_MEMORY_SELECTION_POLICY_ID = "direct_agent_memory_manual_selection@1";
const DEFAULT_AGENT_MEMORY_BUDGET_POLICY_ID = "direct_agent_memory_projection_budget@1";

const SOURCE_CLASSES = new Set([
  "agent_identity",
  "agent_run",
  "agent_thread_link",
  "agent_memory_row",
  "agent_memory_projection",
  "context_pack",
  "request_manifest",
  "unknown",
]);
const SOURCE_CONFIDENCE = new Set(["exact", "declared", "accepted", "derived", "diagnostic", "fixture", "unknown"]);
const SOURCE_FRESHNESS = new Set(["fresh", "stale", "superseded", "unknown"]);
const AUTHORITY_USE = new Set(["identity_witness", "run_witness", "memory_evidence", "preference_hint", "not_authoritative"]);
const CONTEXT_ROLES = new Set([
  "agent_identity_witness",
  "agent_run_witness",
  "memory_evidence",
  "preference_hint",
  "diagnostic_witness",
  "not_provider_context",
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

function nowIso(nowMs = Date.now()) {
  return new Date(Number(nowMs) || Date.now()).toISOString();
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (isPlainObject(value)) {
    const output = {};
    for (const key of Object.keys(value).sort()) {
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

function safeSlotPart(value, fallback = "context_source") {
  const text = normalizeString(value, fallback);
  return text.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 140) || fallback;
}

function pickEnum(value, allowed, fallback) {
  const normalized = normalizeString(value, fallback);
  return allowed.has(normalized) ? normalized : fallback;
}

function boundedPreview(value, maxChars = 220) {
  const text = preserveString(value).replace(/\s+/g, " ").trim();
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1)).trim()}…`;
}

function normalizeDirectContextSourceRef(input = {}, options = {}) {
  const source = isPlainObject(input) ? input : {};
  const sourceClass = pickEnum(source.sourceClass || source.kind || source.artifactKind, SOURCE_CLASSES, "unknown");
  const sourceId = normalizeString(source.sourceId || source.id || source.artifactId || source.memoryId || source.agentRunId || source.agentId, "");
  const contextRole = pickEnum(source.contextRole, CONTEXT_ROLES, "diagnostic_witness");
  const authorityUse = pickEnum(source.authorityUse, AUTHORITY_USE, contextRole === "preference_hint" ? "preference_hint" : "not_authoritative");
  const ref = {
    schema: DIRECT_CONTEXT_SOURCE_REF_SCHEMA,
    sourceRefId: normalizeString(source.sourceRefId, `direct_context_source_${sha256(`${sourceClass}:${sourceId}:${contextRole}`).slice(0, 24)}`),
    sourceClass,
    sourceId,
    projectId: normalizeString(source.projectId || options.projectId, ""),
    agentId: normalizeString(source.agentId || options.agentId, ""),
    agentRunId: normalizeString(source.agentRunId || options.agentRunId, ""),
    threadId: normalizeString(source.threadId || options.threadId, ""),
    turnId: normalizeString(source.turnId || options.turnId, ""),
    workThreadId: normalizeString(source.workThreadId || options.workThreadId, ""),
    sourceConfidence: pickEnum(source.sourceConfidence || source.confidence, SOURCE_CONFIDENCE, "unknown"),
    freshness: pickEnum(source.freshness, SOURCE_FRESHNESS, "unknown"),
    authorityUse,
    contextRole,
    label: boundedPreview(source.label || source.displayLabel || source.rendererSafeLabel || sourceClass, 180),
    observedAt: normalizeString(source.observedAt, nowIso(options.nowMs)),
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
    providerInstruction: false,
  };
  const digest = normalizeString(source.digest || source.sourceDigest || source.artifactDigest || source.memoryDigest || source.identityDigest || source.runDigest, "");
  if (digest) ref.digest = digest;
  ref.sourceRefDigest = digestValue("direct-context-source-ref@1", ref);
  return ref;
}

function normalizeDirectContextSourceRefs(values = [], options = {}) {
  const refs = (Array.isArray(values) ? values : [])
    .map((value) => normalizeDirectContextSourceRef(value, options))
    .filter((ref) => ref.sourceId || ref.digest || ref.label);
  const byKey = new Map();
  for (const ref of refs) {
    const key = ref.sourceId
      ? `${ref.sourceClass}:${ref.sourceId}:${ref.contextRole}`
      : ref.digest
        ? `digest:${ref.digest}:${ref.contextRole}`
        : ref.sourceRefDigest;
    if (!byKey.has(key)) byKey.set(key, ref);
  }
  return [...byKey.values()];
}

function buildAgentIdentityContextSourceRef(identity = {}, options = {}) {
  return normalizeDirectContextSourceRef({
    sourceClass: "agent_identity",
    sourceId: identity.agentId || identity.identityId,
    projectId: identity.projectId,
    agentId: identity.agentId,
    threadId: identity.primaryThreadId || options.threadId,
    workThreadId: identity.workThreadId || options.workThreadId,
    sourceConfidence: identity.identityConfidence || identity.confidence || "unknown",
    freshness: identity.lifecycleState === "archived" || identity.lifecycleState === "superseded" ? "stale" : "fresh",
    authorityUse: "identity_witness",
    contextRole: "agent_identity_witness",
    label: identity.displayName || identity.agentLabel || identity.agentId || "Agent identity",
    digest: identity.identityDigest || identity.digest,
  }, options);
}

function buildAgentRunContextSourceRef(run = {}, options = {}) {
  return normalizeDirectContextSourceRef({
    sourceClass: "agent_run",
    sourceId: run.agentRunId || run.runId,
    projectId: run.projectId,
    agentId: run.agentId,
    agentRunId: run.agentRunId,
    threadId: run.threadId || (Array.isArray(run.threadIds) ? run.threadIds[0] : ""),
    turnId: run.turnId,
    workThreadId: run.workThreadId || options.workThreadId,
    sourceConfidence: run.sourceConfidence || "declared",
    freshness: ["completed", "failed", "cancelled"].includes(run.lifecycle) ? "stale" : "fresh",
    authorityUse: "run_witness",
    contextRole: "agent_run_witness",
    label: run.displayLabel || run.runKind || run.agentRunId || "Agent run",
    digest: run.runDigest || run.digest,
  }, options);
}

function memoryRowScopeMatches(row = {}, options = {}) {
  const projectId = normalizeString(options.projectId, "");
  const agentId = normalizeString(options.agentId, "");
  const workThreadId = normalizeString(options.workThreadId, "");
  const roleLane = normalizeString(options.roleLane, "");
  if (projectId && row.projectId !== projectId) return false;
  if (agentId && row.agentId !== agentId) return false;
  if (row.scope?.projectId && projectId && row.scope.projectId !== projectId) return false;
  if (row.scope?.memoryScope === "work_thread" && (!workThreadId || row.scope.workThreadId !== workThreadId)) return false;
  if (row.scope?.memoryScope === "project_role" && (!roleLane || row.scope.roleLane !== roleLane)) return false;
  if (row.scope?.memoryScope === "cross_project_explicit") return false;
  return true;
}

function rowExpired(row = {}, nowMs = Date.now()) {
  const expiresAt = normalizeString(row.expiresAt, "");
  if (!expiresAt) return false;
  const timestamp = Date.parse(expiresAt);
  const currentMs = Number(nowMs);
  return Number.isFinite(timestamp) && Number.isFinite(currentMs) && timestamp <= currentMs;
}

function memoryOmissionReason(row = {}, options = {}) {
  if (!memoryRowScopeMatches(row, options)) return "out_of_scope";
  if (row.auditState === "rejected") return "rejected";
  if (row.contextEligibility === "not_eligible_rejected") return "rejected";
  if (row.contextEligibility === "not_eligible_stale" || rowExpired(row, options.nowMs)) return "stale";
  if (row.contextEligibility === "not_eligible_conflicted" || row.conflictState && row.conflictState !== "none") return "conflicted";
  if (!memoryContextEligible(row, options)) return "not_eligible";
  return "";
}

function memoryContextRole(row = {}) {
  return row.authorityUse === "preference_hint" || row.kind === "preference"
    ? "preference_hint"
    : "memory_evidence";
}

function buildMemoryRowSourceRef(row = {}, options = {}) {
  return normalizeDirectContextSourceRef({
    sourceClass: "agent_memory_row",
    sourceId: row.memoryId,
    projectId: row.projectId,
    agentId: row.agentId,
    threadId: options.threadId,
    turnId: options.turnId,
    workThreadId: row.scope?.workThreadId || options.workThreadId,
    sourceConfidence: row.confidence === "exact" ? "exact" : row.confidence === "high" ? "accepted" : "derived",
    freshness: memoryOmissionReason(row, options) === "stale" ? "stale" : "fresh",
    authorityUse: memoryContextRole(row),
    contextRole: memoryContextRole(row),
    label: `${row.kind || "memory"}:${row.memoryId || "unknown"}`,
    digest: row.digest || row.memoryDigest || row.contentSummaryDigest,
  }, options);
}

function buildAgentMemoryContextProjection(input = {}, options = {}) {
  const source = isPlainObject(input) ? input : {};
  const opts = isPlainObject(options) ? options : {};
  const parsedNow = Number(source.nowMs ?? opts.nowMs ?? Date.now());
  const nowMs = Number.isFinite(parsedNow) ? parsedNow : Date.now();
  const projectId = normalizeString(source.projectId || opts.projectId, "");
  const agentId = normalizeString(source.agentId || opts.agentId, "");
  const threadId = normalizeString(source.threadId || opts.threadId, "");
  const turnId = normalizeString(source.turnId || opts.turnId, "");
  const workThreadId = normalizeString(source.workThreadId || opts.workThreadId, "");
  const roleLane = normalizeString(source.roleLane || opts.roleLane, "");
  const selectedIds = new Set((Array.isArray(source.selectedMemoryIds) ? source.selectedMemoryIds : [])
    .map((id) => normalizeString(id, ""))
    .filter(Boolean));
  const selectionEnabled = source.selectionEnabled === true || selectedIds.size > 0;
  const parsedMax = Number(source.maxSelectedRows ?? opts.maxSelectedRows ?? 12);
  const maxSelectedRows = Math.max(0, Number.isFinite(parsedMax) ? parsedMax : 12);
  const selectionPolicyId = normalizeString(source.selectionPolicyId, DEFAULT_AGENT_MEMORY_SELECTION_POLICY_ID);
  const budgetPolicyId = normalizeString(source.budgetPolicyId, DEFAULT_AGENT_MEMORY_BUDGET_POLICY_ID);
  const omissionCounters = {
    outOfScope: 0,
    stale: 0,
    rejected: 0,
    conflicted: 0,
    notEligible: 0,
    notSelected: 0,
    missingDigest: 0,
    overBudget: 0,
  };
  const selectedMemoryRefs = [];
  const rows = Array.isArray(source.memoryRows) ? source.memoryRows : [];
  for (const row of rows) {
    if (!isPlainObject(row)) {
      omissionCounters.notEligible += 1;
      continue;
    }
    const memoryId = normalizeString(row.memoryId, "");
    if (!selectionEnabled) {
      omissionCounters.notSelected += 1;
      continue;
    }
    if (selectedIds.size && !selectedIds.has(memoryId)) {
      omissionCounters.notSelected += 1;
      continue;
    }
    const reason = memoryOmissionReason(row, { projectId, agentId, workThreadId, roleLane, nowMs });
    if (reason) {
      if (reason === "out_of_scope") omissionCounters.outOfScope += 1;
      else if (reason === "stale") omissionCounters.stale += 1;
      else if (reason === "rejected") omissionCounters.rejected += 1;
      else if (reason === "conflicted") omissionCounters.conflicted += 1;
      else omissionCounters.notEligible += 1;
      continue;
    }
    const digest = normalizeString(row.digest || row.memoryDigest || row.contentSummaryDigest, "");
    if (!digest) {
      omissionCounters.missingDigest += 1;
      continue;
    }
    if (selectedMemoryRefs.length >= maxSelectedRows) {
      omissionCounters.overBudget += 1;
      continue;
    }
    const contextRole = memoryContextRole(row);
    selectedMemoryRefs.push({
      schema: "direct_agent_memory_context_ref@1",
      memoryId,
      digest,
      contentSummaryDigest: normalizeString(row.contentSummaryDigest, ""),
      kind: normalizeString(row.kind, "memory"),
      memoryScope: normalizeString(row.scope?.memoryScope, ""),
      selectionPolicyId,
      budgetPolicyId,
      authorityUse: contextRole,
      contextRole,
      inclusionReason: selectedIds.size ? "explicit_fixture_manual_selection" : "explicit_projection_selection",
      sourceRef: buildMemoryRowSourceRef(row, { projectId, agentId, threadId, turnId, workThreadId, roleLane, nowMs }),
      rawMemoryTextIncluded: false,
      rawTranscriptIncluded: false,
      providerInstruction: false,
    });
  }
  const sourceRefs = selectedMemoryRefs.map((ref) => ref.sourceRef);
  const projection = {
    schema: DIRECT_AGENT_MEMORY_CONTEXT_PROJECTION_SCHEMA,
    projectionId: normalizeString(source.projectionId, `agent_memory_context_${sha256(`${projectId}:${agentId}:${threadId}:${turnId}:${selectionPolicyId}:${sourceRefs.map((ref) => ref.sourceRefDigest).join(":")}`).slice(0, 24)}`),
    projectId,
    agentId,
    threadId,
    turnId,
    workThreadId,
    roleLane,
    generatedAt: normalizeString(source.generatedAt, nowIso(nowMs)),
    selectionPolicyId,
    budgetPolicyId,
    selectionEnabled,
    selectedCount: selectedMemoryRefs.length,
    selectedMemoryRefs,
    sourceRefs,
    omissionCounters,
    rawMemoryTextIncluded: false,
    rawTranscriptIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
    providerInstruction: false,
    providerContextTextIncluded: false,
  };
  projection.projectionDigest = digestValue("direct-agent-memory-context-projection@1", projection);
  return projection;
}

function buildAgentMemoryProjectionContextSourceRef(projection = {}, options = {}) {
  return normalizeDirectContextSourceRef({
    sourceClass: "agent_memory_projection",
    sourceId: projection.projectionId,
    projectId: projection.projectId,
    agentId: projection.agentId,
    threadId: projection.threadId,
    turnId: projection.turnId,
    workThreadId: projection.workThreadId,
    sourceConfidence: "derived",
    freshness: "fresh",
    authorityUse: "memory_evidence",
    contextRole: "memory_evidence",
    label: "Agent memory context projection",
    digest: projection.projectionDigest,
  }, options);
}

function adaptAgentContextSourcesForContextPack(input = {}, options = {}) {
  const sourceRefs = normalizeDirectContextSourceRefs(input.sourceRefs || input.agentContextSourceRefs, options);
  const memoryProjection = isPlainObject(input.agentMemoryContextProjection)
    ? input.agentMemoryContextProjection
    : null;
  const refs = memoryProjection?.projectionId
    ? normalizeDirectContextSourceRefs([
        ...sourceRefs,
        buildAgentMemoryProjectionContextSourceRef(memoryProjection, options),
        ...(Array.isArray(memoryProjection.sourceRefs) ? memoryProjection.sourceRefs : []),
      ], options)
    : sourceRefs;
  const omittedCounts = {};
  if (memoryProjection?.omissionCounters) {
    for (const [key, value] of Object.entries(memoryProjection.omissionCounters)) {
      omittedCounts[`agent_memory_${key}`] = Number(value) || 0;
    }
  }
  const adapter = {
    schema: DIRECT_AGENT_CONTEXT_SOURCE_ADAPTER_SCHEMA,
    sourceRefCount: refs.length,
    sourceRefs: refs,
    memoryProjectionRef: memoryProjection?.projectionId ? {
      projectionId: memoryProjection.projectionId,
      projectionDigest: normalizeString(memoryProjection.projectionDigest, ""),
      selectedCount: Number(memoryProjection.selectedCount || 0),
      selectionEnabled: memoryProjection.selectionEnabled === true,
      selectionPolicyId: normalizeString(memoryProjection.selectionPolicyId, ""),
      budgetPolicyId: normalizeString(memoryProjection.budgetPolicyId, ""),
      rawMemoryTextIncluded: false,
      providerInstruction: false,
    } : null,
    omittedCounts,
    providerInputMutation: false,
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  adapter.adapterDigest = digestValue("direct-agent-context-source-adapter@1", adapter);
  return adapter;
}

module.exports = {
  DEFAULT_AGENT_MEMORY_BUDGET_POLICY_ID,
  DEFAULT_AGENT_MEMORY_SELECTION_POLICY_ID,
  DIRECT_AGENT_CONTEXT_SOURCE_ADAPTER_SCHEMA,
  DIRECT_AGENT_MEMORY_CONTEXT_PROJECTION_SCHEMA,
  DIRECT_CONTEXT_SOURCE_REF_SCHEMA,
  adaptAgentContextSourcesForContextPack,
  buildAgentIdentityContextSourceRef,
  buildAgentMemoryContextProjection,
  buildAgentMemoryProjectionContextSourceRef,
  buildAgentRunContextSourceRef,
  normalizeDirectContextSourceRef,
  normalizeDirectContextSourceRefs,
};
