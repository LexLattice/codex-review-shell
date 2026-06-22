"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const DIRECT_AGENT_MEMORY_INDEX_SCHEMA = "direct_agent_memory_index@1";
const DIRECT_AGENT_MEMORY_ROW_SCHEMA = "direct_agent_memory_row@1";
const DIRECT_AGENT_MEMORY_EXTRACTION_TRANSITION_SCHEMA = "direct_agent_memory_extraction_transition@1";
const DIRECT_AGENT_MEMORY_INVENTORY_PROJECTION_SCHEMA = "direct_agent_memory_inventory_projection@1";

const MEMORY_SCOPES = new Set(["agent_private", "project_role", "work_thread", "cross_project_explicit"]);
const MEMORY_KINDS = new Set(["preference", "project_fact", "decision", "constraint", "open_question", "risk", "pattern", "procedure"]);
const MEMORY_CONFIDENCE = new Set(["exact", "high", "derived", "candidate", "stale", "conflicted"]);
const MEMORY_AUTHORITY_USE = new Set(["context_evidence", "preference_hint", "constraint_candidate", "not_authoritative"]);
const MEMORY_CONTEXT_ELIGIBILITY = new Set([
  "eligible",
  "eligible_with_warning",
  "not_eligible_candidate",
  "not_eligible_stale",
  "not_eligible_conflicted",
  "not_eligible_rejected",
  "not_eligible_out_of_scope",
]);
const MEMORY_CONFLICT_STATES = new Set([
  "none",
  "conflicts_with_current_user",
  "conflicts_with_newer_memory",
  "conflicts_with_workspace_evidence",
  "conflicts_with_policy",
  "unknown",
]);
const MEMORY_CONFLICT_RESOLUTIONS = new Set([
  "current_user_wins",
  "newer_evidence_wins",
  "memory_omitted",
  "manual_review_required",
  "unknown",
]);
const MEMORY_AUDIT_STATES = new Set(["unaudited", "accepted", "rejected", "needs_review"]);
const MEMORY_EXTRACTION_MODES = new Set(["manual_fixture", "operator_curated", "model_suggested", "automated_candidate"]);
const V0_ROW_CREATION_EXTRACTION_MODES = new Set(["manual_fixture", "operator_curated"]);
const V0_CONTEXT_ELIGIBLE_KINDS = new Set(["preference", "decision", "constraint", "open_question", "risk", "procedure"]);

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
      if (["digest", "indexDigest", "memoryDigest", "transitionDigest", "projectionDigest", "refDigest"].includes(key)) continue;
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

function boundedPreview(value, maxChars = 220) {
  const text = preserveString(value).replace(/\s+/g, " ").trim();
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1)).trim()}…`;
}

function safeSlotPart(value, fallback = "memory") {
  const text = normalizeString(value, fallback);
  const safe = text.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 140);
  return safe || fallback;
}

function pickEnum(value, allowed, fallback) {
  const normalized = normalizeString(value, fallback);
  return allowed.has(normalized) ? normalized : fallback;
}

function ensureDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true });
}

function writeJsonAtomic(targetPath, value) {
  ensureDirectory(path.dirname(targetPath));
  const tempPath = path.join(path.dirname(targetPath), `.${path.basename(targetPath)}.${process.pid}.${Date.now()}.tmp`);
  try {
    fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fs.renameSync(tempPath, targetPath);
  } catch (error) {
    try {
      fs.unlinkSync(tempPath);
    } catch {}
    throw error;
  }
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function normalizeRef(input = {}, fallbackKind = "unknown") {
  const source = isPlainObject(input) ? input : {};
  const ref = {
    kind: normalizeString(source.kind || source.refKind || source.artifactKind, fallbackKind),
    id: normalizeString(source.id || source.refId || source.artifactId || source.sourceId, ""),
    digest: normalizeString(source.digest || source.artifactDigest || source.sourceDigest, ""),
    label: boundedPreview(source.label || source.rendererSafeLabel || source.kind || fallbackKind, 180),
    confidence: normalizeString(source.confidence || source.sourceConfidence, "diagnostic"),
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  ref.refDigest = digestValue("direct-agent-memory-ref@1", ref);
  return ref;
}

function normalizeRefList(values, fallbackKind = "unknown") {
  const refs = (Array.isArray(values) ? values : [])
    .map((value) => normalizeRef(value, fallbackKind))
    .filter((ref) => ref.id || ref.digest || ref.label);
  const byKey = new Map();
  for (const ref of refs) {
    const key = ref.id ? `${ref.kind}:${ref.id}` : ref.digest ? `digest:${ref.digest}` : ref.refDigest;
    if (!byKey.has(key)) byKey.set(key, ref);
  }
  return [...byKey.values()];
}

function normalizeStringList(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => normalizeString(value, ""))
    .filter(Boolean))]
    .sort();
}

function normalizeMemoryScope(scope = {}, fallback = {}) {
  const source = isPlainObject(scope) ? scope : {};
  return {
    projectId: normalizeString(source.projectId || fallback.projectId, ""),
    workThreadId: normalizeString(source.workThreadId || fallback.workThreadId, ""),
    roleLane: normalizeString(source.roleLane || fallback.roleLane, ""),
    memoryScope: pickEnum(source.memoryScope, MEMORY_SCOPES, "agent_private"),
  };
}

function normalizeMemoryKind(value) {
  return pickEnum(value, MEMORY_KINDS, "preference");
}

function normalizeMemoryConfidence(value) {
  return pickEnum(value, MEMORY_CONFIDENCE, "candidate");
}

function normalizeAuthorityUse(value) {
  return pickEnum(value, MEMORY_AUTHORITY_USE, "not_authoritative");
}

function normalizeConflictState(value) {
  return pickEnum(value, MEMORY_CONFLICT_STATES, "none");
}

function normalizeConflictResolution(value) {
  return pickEnum(value, MEMORY_CONFLICT_RESOLUTIONS, "unknown");
}

function normalizeAuditState(value) {
  return pickEnum(value, MEMORY_AUDIT_STATES, "unaudited");
}

function normalizeExtractionMode(value) {
  return pickEnum(value, MEMORY_EXTRACTION_MODES, "manual_fixture");
}

function isExpired(row, nowMs) {
  const expiresAt = normalizeString(row.expiresAt, "");
  if (!expiresAt) return false;
  const timestamp = Date.parse(expiresAt);
  const currentMs = nowMs ?? Date.now();
  return Number.isFinite(timestamp) && timestamp <= Number(currentMs);
}

function normalizedContextEligibility(input = {}, options = {}) {
  const confidence = normalizeMemoryConfidence(input.confidence);
  const conflictState = normalizeConflictState(input.conflictState);
  const auditState = normalizeAuditState(input.auditState);
  const requested = pickEnum(input.contextEligibility, MEMORY_CONTEXT_ELIGIBILITY, "not_eligible_candidate");
  if (auditState === "rejected") return "not_eligible_rejected";
  if (auditState === "unaudited" || auditState === "needs_review") return "not_eligible_candidate";
  if (confidence === "candidate") return "not_eligible_candidate";
  if (confidence === "stale") return "not_eligible_stale";
  if (confidence === "conflicted" || conflictState !== "none") return "not_eligible_conflicted";
  if (isExpired(input, options.nowMs)) return "not_eligible_stale";
  return requested;
}

function memoryContextEligible(row = {}, options = {}) {
  const projectId = normalizeString(options.projectId, "");
  const workThreadId = normalizeString(options.workThreadId, "");
  const roleLane = normalizeString(options.roleLane, "");
  if (projectId && row.projectId !== projectId) return false;
  if (row.scope?.projectId && projectId && row.scope.projectId !== projectId) return false;
  if (row.scope?.memoryScope === "work_thread" && (!workThreadId || row.scope.workThreadId !== workThreadId)) return false;
  if (row.scope?.memoryScope === "project_role" && (!roleLane || row.scope.roleLane !== roleLane)) return false;
  if (row.scope?.memoryScope === "cross_project_explicit") return false;
  if (!["eligible", "eligible_with_warning"].includes(row.contextEligibility)) return false;
  if (row.auditState !== "accepted") return false;
  if (!["exact", "high", "derived"].includes(row.confidence)) return false;
  if (row.authorityUse === "not_authoritative") return false;
  if (row.conflictState !== "none") return false;
  if (isExpired(row, options.nowMs)) return false;
  if (V0_CONTEXT_ELIGIBLE_KINDS.has(row.kind)) return true;
  return row.kind === "project_fact" && ["exact", "high"].includes(row.confidence);
}

function memoryIdFor(input = {}) {
  const explicit = normalizeString(input.memoryId || input.id, "");
  if (explicit) return safeSlotPart(explicit, "direct_agent_memory");
  const scope = normalizeMemoryScope(input.scope, input);
  return `direct_agent_memory_${sha256(stableJson({
    projectId: normalizeString(input.projectId || scope.projectId, ""),
    agentId: normalizeString(input.agentId, ""),
    kind: normalizeMemoryKind(input.kind),
    scope,
    contentSummaryDigest: normalizeString(input.contentSummaryDigest, ""),
    revision: Number(input.revision || 1),
  })).slice(0, 24)}`;
}

function extractionTransitionIdFor(input = {}) {
  const explicit = normalizeString(input.extractionTransitionId || input.id, "");
  if (explicit) return safeSlotPart(explicit, "direct_agent_memory_extraction");
  return `direct_agent_memory_extraction_${sha256(stableJson({
    projectId: normalizeString(input.projectId, ""),
    agentId: normalizeString(input.agentId, ""),
    extractionMode: normalizeExtractionMode(input.extractionMode),
    outputMemoryIds: normalizeStringList(input.outputMemoryIds),
    sourceRefs: normalizeRefList(input.sourceRefs, "memory_extraction_source"),
    extractionPolicyId: normalizeString(input.extractionPolicyId, "manual_fixture_memory_extraction@1"),
  })).slice(0, 24)}`;
}

function buildAgentMemoryExtractionTransition(input = {}, options = {}) {
  const now = normalizeString(input.createdAt, nowIso(options.nowMs));
  const agentId = normalizeString(input.agentId, "");
  const transition = {
    schema: DIRECT_AGENT_MEMORY_EXTRACTION_TRANSITION_SCHEMA,
    extractionTransitionId: extractionTransitionIdFor(input),
    agentId: agentId ? safeSlotPart(agentId, "direct_agent") : "",
    projectId: normalizeString(input.projectId, ""),
    sourceRefs: normalizeRefList(input.sourceRefs, "memory_extraction_source"),
    extractionMode: normalizeExtractionMode(input.extractionMode),
    outputMemoryIds: normalizeStringList(input.outputMemoryIds),
    extractionPolicyId: normalizeString(input.extractionPolicyId, "manual_fixture_memory_extraction@1"),
    createdAt: now,
    rawTranscriptIncluded: false,
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  transition.digest = digestValue("direct-agent-memory-extraction-transition@1", transition);
  transition.transitionDigest = transition.digest;
  return transition;
}

function normalizeMemoryProvenance(input = {}) {
  const source = isPlainObject(input) ? input : {};
  return {
    sourceThreadIds: normalizeStringList(source.sourceThreadIds),
    sourceTurnIds: normalizeStringList(source.sourceTurnIds),
    sourceArtifactRefs: normalizeRefList(source.sourceArtifactRefs || source.sourceRefs, "memory_source_artifact"),
    extractionTransitionId: normalizeString(source.extractionTransitionId, ""),
  };
}

function validateMemoryProvenance(memoryRow, transition) {
  if (!memoryRow.agentId) throw new Error("Agent memory row requires agentId.");
  if (!memoryRow.projectId) throw new Error("Agent memory row requires projectId.");
  const provenance = memoryRow.provenance || {};
  if (!provenance.extractionTransitionId) {
    throw new Error("Agent memory row requires extractionTransitionId provenance.");
  }
  if (!transition || transition.schema !== DIRECT_AGENT_MEMORY_EXTRACTION_TRANSITION_SCHEMA) {
    throw new Error("Agent memory row requires a real AgentMemoryExtractionTransition artifact.");
  }
  const hasSource = Boolean(
    provenance.sourceThreadIds?.length
      || provenance.sourceTurnIds?.length
      || provenance.sourceArtifactRefs?.length
      || transition.sourceRefs?.length,
  );
  if (!hasSource) throw new Error("Agent memory row requires source provenance.");
  if (transition.extractionTransitionId !== provenance.extractionTransitionId) {
    throw new Error("Agent memory extraction transition id mismatch.");
  }
  if (transition.agentId !== memoryRow.agentId || transition.projectId !== memoryRow.projectId) {
    throw new Error("Agent memory extraction transition scope mismatch.");
  }
  if (!V0_ROW_CREATION_EXTRACTION_MODES.has(transition.extractionMode)) {
    throw new Error("Agent memory V0 only accepts manual fixture/operator curated extraction modes.");
  }
  if (!transition.outputMemoryIds.includes(memoryRow.memoryId)) {
    throw new Error("Agent memory extraction transition does not cite output memory id.");
  }
  return true;
}

function buildAgentMemoryRow(input = {}, options = {}) {
  const now = normalizeString(input.updatedAt, nowIso(options.nowMs));
  const scope = normalizeMemoryScope(input.scope, input);
  const contentSummary = boundedPreview(input.contentSummary || input.summary, 2000);
  const contentSummaryDigest = normalizeString(input.contentSummaryDigest, digestValue("direct-agent-memory-summary@1", {
    summaryPolicyId: normalizeString(input.summaryPolicyId, "manual_fixture_summary@1"),
    contentSummary,
  }));
  const rowInput = {
    ...input,
    contentSummaryDigest,
    scope,
  };
  const row = {
    schema: DIRECT_AGENT_MEMORY_ROW_SCHEMA,
    memoryId: memoryIdFor(rowInput),
    agentId: normalizeString(input.agentId, "") ? safeSlotPart(input.agentId, "direct_agent") : "",
    projectId: normalizeString(input.projectId || scope.projectId, ""),
    scope,
    kind: normalizeMemoryKind(input.kind),
    contentSummary,
    contentSummaryDigest,
    summaryPolicyId: normalizeString(input.summaryPolicyId, "manual_fixture_summary@1"),
    rawSourceQuoted: false,
    provenance: normalizeMemoryProvenance(input.provenance),
    confidence: normalizeMemoryConfidence(input.confidence),
    authorityUse: normalizeAuthorityUse(input.authorityUse),
    contextEligibility: normalizedContextEligibility(input, options),
    conflictState: normalizeConflictState(input.conflictState),
    conflictResolution: normalizeConflictResolution(input.conflictResolution),
    revision: Math.max(1, Number(input.revision || 1)),
    supersedesMemoryId: normalizeString(input.supersedesMemoryId, ""),
    supersededByMemoryId: normalizeString(input.supersededByMemoryId, ""),
    expiresAt: normalizeString(input.expiresAt, ""),
    invalidationRule: boundedPreview(input.invalidationRule, 360),
    auditState: normalizeAuditState(input.auditState),
    actionAuthorityGranted: false,
    createdAt: normalizeString(input.createdAt, now),
    updatedAt: now,
    rawTranscriptIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  row.digest = digestValue("direct-agent-memory-row@1", row);
  row.memoryDigest = row.digest;
  return row;
}

function buildMemoryInventoryProjection(rows = [], options = {}) {
  const projectId = normalizeString(options.projectId, "");
  const agentId = normalizeString(options.agentId, "");
  const workThreadId = normalizeString(options.workThreadId, "");
  const roleLane = normalizeString(options.roleLane, "");
  const nowMs = Number(options.nowMs ?? Date.now());
  const filteredRows = (Array.isArray(rows) ? rows : [])
    .filter((row) => !projectId || row.projectId === projectId)
    .filter((row) => !agentId || row.agentId === agentId)
    .sort((left, right) =>
      String(left.projectId).localeCompare(String(right.projectId))
      || String(left.agentId).localeCompare(String(right.agentId))
      || String(left.scope?.memoryScope || "").localeCompare(String(right.scope?.memoryScope || ""))
      || String(left.kind).localeCompare(String(right.kind))
      || String(left.memoryId).localeCompare(String(right.memoryId)));
  const projectionRows = filteredRows.map((row) => {
    const contextEligible = memoryContextEligible(row, { projectId, workThreadId, roleLane, nowMs });
    return {
      schema: "direct_agent_memory_inventory_row@1",
      memoryId: row.memoryId,
      agentId: row.agentId,
      projectId: row.projectId,
      memoryScope: row.scope.memoryScope,
      workThreadId: row.scope.workThreadId,
      roleLane: row.scope.roleLane,
      kind: row.kind,
      contentSummary: row.contentSummary,
      contentSummaryDigest: row.contentSummaryDigest,
      summaryPolicyId: row.summaryPolicyId,
      confidence: row.confidence,
      authorityUse: row.authorityUse,
      contextEligibility: row.contextEligibility,
      contextEligible,
      conflictState: row.conflictState,
      conflictResolution: row.conflictResolution,
      revision: row.revision,
      supersedesMemoryId: row.supersedesMemoryId,
      supersededByMemoryId: row.supersededByMemoryId,
      auditState: row.auditState,
      sourceThreadCount: row.provenance.sourceThreadIds.length,
      sourceTurnCount: row.provenance.sourceTurnIds.length,
      sourceArtifactCount: row.provenance.sourceArtifactRefs.length,
      extractionTransitionId: row.provenance.extractionTransitionId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      digest: row.digest,
      rawTranscriptIncluded: false,
      rawPathIncluded: false,
      rawSecretIncluded: false,
    };
  });
  const projection = {
    schema: DIRECT_AGENT_MEMORY_INVENTORY_PROJECTION_SCHEMA,
    projectId,
    agentId,
    generatedAt: normalizeString(options.generatedAt, nowIso(nowMs)),
    rowCount: projectionRows.length,
    contextEligibleCount: projectionRows.filter((row) => row.contextEligible).length,
    acceptedCount: projectionRows.filter((row) => row.auditState === "accepted").length,
    rejectedCount: projectionRows.filter((row) => row.auditState === "rejected").length,
    staleCount: projectionRows.filter((row) => row.contextEligibility === "not_eligible_stale").length,
    conflictedCount: projectionRows.filter((row) => row.contextEligibility === "not_eligible_conflicted").length,
    candidateCount: projectionRows.filter((row) => row.contextEligibility === "not_eligible_candidate").length,
    rows: projectionRows,
    rawTranscriptIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  projection.projectionDigest = digestValue("direct-agent-memory-inventory-projection@1", projection);
  return projection;
}

class AgentMemoryStore {
  constructor(options = {}) {
    const rootDir = normalizeString(options.rootDir, "");
    if (!rootDir) throw new Error("AgentMemoryStore requires an explicit rootDir.");
    this.rootDir = path.resolve(rootDir);
    this.now = typeof options.now === "function" ? options.now : () => Date.now();
  }

  memoryRoot() {
    return path.join(this.rootDir, "agent-memory");
  }

  indexPath() {
    return path.join(this.memoryRoot(), "index.json");
  }

  memoryPath(memoryId) {
    return path.join(this.memoryRoot(), "rows", safeSlotPart(memoryId, "direct_agent_memory"), "memory.json");
  }

  extractionTransitionPath(extractionTransitionId) {
    return path.join(this.memoryRoot(), "extraction-transitions", `${safeSlotPart(extractionTransitionId, "direct_agent_memory_extraction")}.json`);
  }

  ensureRoot() {
    ensureDirectory(path.join(this.memoryRoot(), "rows"));
    ensureDirectory(path.join(this.memoryRoot(), "extraction-transitions"));
    if (!fs.existsSync(this.indexPath())) this.writeIndex([], []);
  }

  buildIndex(memoryRefs = [], extractionTransitionRefs = []) {
    const index = {
      schema: DIRECT_AGENT_MEMORY_INDEX_SCHEMA,
      updatedAt: nowIso(this.now()),
      memoryRefs: Array.isArray(memoryRefs) ? memoryRefs : [],
      extractionTransitionRefs: Array.isArray(extractionTransitionRefs) ? extractionTransitionRefs : [],
      rawTranscriptIncluded: false,
      rawPathIncluded: false,
      rawSecretIncluded: false,
    };
    index.indexDigest = digestValue("direct-agent-memory-index@1", index);
    return index;
  }

  readIndex() {
    return readJsonFile(this.indexPath()) || this.buildIndex([], []);
  }

  writeIndex(memoryRefs, extractionTransitionRefs) {
    const index = this.buildIndex(memoryRefs, extractionTransitionRefs);
    writeJsonAtomic(this.indexPath(), index);
    return index;
  }

  readExtractionTransition(extractionTransitionId) {
    const id = normalizeString(extractionTransitionId, "");
    if (!id) return null;
    return readJsonFile(this.extractionTransitionPath(id));
  }

  readMemoryRow(memoryId) {
    const id = normalizeString(memoryId, "");
    if (!id) return null;
    return readJsonFile(this.memoryPath(id));
  }

  upsertExtractionTransition(input = {}, options = {}) {
    this.ensureRoot();
    const transition = buildAgentMemoryExtractionTransition(input, { nowMs: this.now() });
    if (!transition.agentId || !transition.projectId) {
      throw new Error("Agent memory extraction transition requires agentId and projectId.");
    }
    if (!transition.sourceRefs.length) {
      throw new Error("Agent memory extraction transition requires source refs.");
    }
    writeJsonAtomic(this.extractionTransitionPath(transition.extractionTransitionId), transition);
    if (options.skipIndexUpdate !== true) this.updateIndex({ extractionTransition: transition });
    return transition;
  }

  upsertMemoryRow(input = {}, options = {}) {
    this.ensureRoot();
    const candidate = buildAgentMemoryRow(input, { nowMs: this.now() });
    const transition = this.readExtractionTransition(candidate.provenance.extractionTransitionId);
    validateMemoryProvenance(candidate, transition);
    const existing = this.readMemoryRow(candidate.memoryId);
    const merged = buildAgentMemoryRow({
      ...(existing || {}),
      ...candidate,
      createdAt: existing?.createdAt || candidate.createdAt,
      provenance: {
        ...candidate.provenance,
        sourceThreadIds: normalizeStringList([
          ...(existing?.provenance?.sourceThreadIds || []),
          ...(candidate.provenance.sourceThreadIds || []),
        ]),
        sourceTurnIds: normalizeStringList([
          ...(existing?.provenance?.sourceTurnIds || []),
          ...(candidate.provenance.sourceTurnIds || []),
        ]),
        sourceArtifactRefs: normalizeRefList([
          ...(existing?.provenance?.sourceArtifactRefs || []),
          ...(candidate.provenance.sourceArtifactRefs || []),
        ], "memory_source_artifact"),
        extractionTransitionId: candidate.provenance.extractionTransitionId,
      },
    }, { nowMs: this.now() });
    validateMemoryProvenance(merged, transition);
    writeJsonAtomic(this.memoryPath(merged.memoryId), merged);
    if (options.skipIndexUpdate !== true) this.updateIndex({ memoryRow: merged });
    return merged;
  }

  updateIndex({ memoryRow = null, extractionTransition = null, memoryRows = [], extractionTransitions = [] } = {}) {
    const index = this.readIndex();
    const memoryRefs = new Map((index.memoryRefs || []).map((ref) => [ref.memoryId, ref]));
    const transitionRefs = new Map((index.extractionTransitionRefs || []).map((ref) => [ref.extractionTransitionId, ref]));
    for (const entry of [memoryRow, ...(Array.isArray(memoryRows) ? memoryRows : [])].filter(Boolean)) {
      memoryRefs.set(entry.memoryId, {
        memoryId: entry.memoryId,
        projectId: entry.projectId,
        agentId: entry.agentId,
        memoryScope: entry.scope.memoryScope,
        kind: entry.kind,
        auditState: entry.auditState,
        contextEligibility: entry.contextEligibility,
        updatedAt: entry.updatedAt,
        digest: entry.digest,
      });
    }
    for (const entry of [extractionTransition, ...(Array.isArray(extractionTransitions) ? extractionTransitions : [])].filter(Boolean)) {
      transitionRefs.set(entry.extractionTransitionId, {
        extractionTransitionId: entry.extractionTransitionId,
        projectId: entry.projectId,
        agentId: entry.agentId,
        extractionMode: entry.extractionMode,
        outputMemoryIds: entry.outputMemoryIds,
        createdAt: entry.createdAt,
        digest: entry.digest,
      });
    }
    this.writeIndex(
      [...memoryRefs.values()].sort((a, b) => String(a.projectId).localeCompare(String(b.projectId)) || String(a.agentId).localeCompare(String(b.agentId)) || String(a.memoryId).localeCompare(String(b.memoryId))),
      [...transitionRefs.values()].sort((a, b) => String(a.projectId).localeCompare(String(b.projectId)) || String(a.agentId).localeCompare(String(b.agentId)) || String(a.extractionTransitionId).localeCompare(String(b.extractionTransitionId))),
    );
  }

  listMemoryRows(options = {}) {
    this.ensureRoot();
    const projectId = normalizeString(options.projectId, "");
    const agentId = normalizeString(options.agentId, "");
    const memoryScope = normalizeString(options.memoryScope, "");
    return (this.readIndex().memoryRefs || [])
      .map((ref) => this.readMemoryRow(ref.memoryId))
      .filter(Boolean)
      .filter((row) => !projectId || row.projectId === projectId)
      .filter((row) => !agentId || row.agentId === agentId)
      .filter((row) => !memoryScope || row.scope.memoryScope === memoryScope);
  }

  listExtractionTransitions(options = {}) {
    this.ensureRoot();
    const projectId = normalizeString(options.projectId, "");
    const agentId = normalizeString(options.agentId, "");
    return (this.readIndex().extractionTransitionRefs || [])
      .map((ref) => this.readExtractionTransition(ref.extractionTransitionId))
      .filter(Boolean)
      .filter((transition) => !projectId || transition.projectId === projectId)
      .filter((transition) => !agentId || transition.agentId === agentId);
  }

  buildInventoryProjection(options = {}) {
    return buildMemoryInventoryProjection(this.listMemoryRows(options), {
      ...options,
      generatedAt: nowIso(this.now()),
      nowMs: this.now(),
    });
  }
}

module.exports = {
  DIRECT_AGENT_MEMORY_EXTRACTION_TRANSITION_SCHEMA,
  DIRECT_AGENT_MEMORY_INDEX_SCHEMA,
  DIRECT_AGENT_MEMORY_INVENTORY_PROJECTION_SCHEMA,
  DIRECT_AGENT_MEMORY_ROW_SCHEMA,
  AgentMemoryStore,
  buildAgentMemoryExtractionTransition,
  buildAgentMemoryRow,
  buildMemoryInventoryProjection,
  extractionTransitionIdFor,
  memoryContextEligible,
  memoryIdFor,
  validateMemoryProvenance,
};
