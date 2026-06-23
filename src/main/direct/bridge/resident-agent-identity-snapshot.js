"use strict";

const crypto = require("node:crypto");
const {
  RESIDENT_EPISTEMIC_CONTEXT_ITEM_SCHEMA,
  buildResidentEpistemicContextItem,
  buildResidentEpistemicRow,
  buildResidentEpistemicSnapshot,
  validateResidentEpistemicSnapshot,
} = require("./resident-epistemic-snapshot");
const {
  buildAgentIdentityContextSourceRef,
  buildAgentRunContextSourceRef,
} = require("./agent-context-source-refs");

const RESIDENT_AGENT_IDENTITY_SNAPSHOT_SCHEMA = "resident_agent_identity_snapshot@1";
const RESIDENT_AGENT_CONTEXT_WITNESS_SCHEMA = "resident_agent_context_witness@1";
const RESIDENT_AGENT_IDENTITY_SNAPSHOT_POLICY_ID = "resident_agent_identity_snapshot_policy@1";

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

function boundedString(value, maxLength = 320) {
  const text = preserveString(value).replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
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
      if (["snapshotDigest", "witnessDigest"].includes(key)) continue;
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

function normalizeRef(input = {}, fallbackSource = "audit_row") {
  const source = isPlainObject(input) ? input : {};
  const refId = normalizeString(source.refId || source.id || source.sourceId, "");
  if (!refId) return null;
  return {
    refId: boundedString(refId, 180),
    source: normalizeString(source.source, fallbackSource),
    digest: normalizeString(source.digest || source.sourceDigest || source.artifactDigest, "") || undefined,
  };
}

function compactRefs(values = [], fallbackSource = "audit_row") {
  const refs = (Array.isArray(values) ? values : [])
    .map((value) => normalizeRef(value, fallbackSource))
    .filter(Boolean);
  const byKey = new Map();
  for (const ref of refs) byKey.set(`${ref.source}:${ref.refId}:${ref.digest || ""}`, ref);
  return [...byKey.values()].sort((a, b) => `${a.source}:${a.refId}`.localeCompare(`${b.source}:${b.refId}`));
}

function currentThreadRef(threadId, link = null) {
  const id = normalizeString(threadId || link?.threadId || link?.sessionId, "");
  if (!id) return null;
  return {
    threadId: id,
    linkKind: normalizeString(link?.linkKind, "resident_primary"),
    relationship: normalizeString(link?.relationship, "owned_by_agent"),
    linkState: normalizeString(link?.linkState, "active"),
    linkDigest: normalizeString(link?.linkDigest, ""),
    transcriptVisible: "metadata_only",
    fullTranscriptIncluded: false,
  };
}

function findCurrentThreadLink(threadLinks = [], threadId = "") {
  const id = normalizeString(threadId, "");
  return (Array.isArray(threadLinks) ? threadLinks : []).find((link) =>
    normalizeString(link?.threadId || link?.sessionId, "") === id) || null;
}

function countBy(values = [], keyFn) {
  const counts = {};
  for (const value of Array.isArray(values) ? values : []) {
    const key = normalizeString(keyFn(value), "unknown");
    counts[key] = Number(counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function activeRun(run = {}) {
  return ["planned", "running", "waiting", "recovery_required"].includes(normalizeString(run.lifecycle, ""));
}

function buildIdentitySection({ identity = {}, currentThreadId = "", currentWorkThreadId = "", nowMs = Date.now() } = {}) {
  const sourceRef = buildAgentIdentityContextSourceRef(identity, {
    threadId: currentThreadId,
    workThreadId: currentWorkThreadId,
    nowMs,
  });
  return {
    schema: "resident_agent_identity_section@1",
    agentId: normalizeString(identity.agentId, ""),
    projectId: normalizeString(identity.projectId, ""),
    displayName: boundedString(identity.displayName || identity.agentLabel || identity.agentId || "Resident agent", 180),
    roleLane: normalizeString(identity.roleLane, "primary"),
    agentClass: normalizeString(identity.agentClass, "primary_resident"),
    lifecycleState: normalizeString(identity.lifecycleState, "unknown"),
    identityConfidence: normalizeString(identity.identityConfidence, "unknown"),
    currentWorkThreadId: normalizeString(currentWorkThreadId, ""),
    currentThreadRef: currentThreadRef(currentThreadId),
    sourceRef,
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
}

function buildContinuitySection({ identity = {}, threadLinks = [], agentRuns = [], currentThreadId = "", nowMs = Date.now() } = {}) {
  const agentId = normalizeString(identity.agentId, "");
  const links = (Array.isArray(threadLinks) ? threadLinks : []).filter((link) => !agentId || link?.agentId === agentId);
  const runs = (Array.isArray(agentRuns) ? agentRuns : []).filter((run) => !agentId || run?.agentId === agentId);
  const currentLink = findCurrentThreadLink(links, currentThreadId);
  const linkedRunId = normalizeString(currentLink?.agentRunId, "");
  const currentRun = (linkedRunId ? runs.find((run) => run?.agentRunId === linkedRunId) : null)
    || runs.find((run) => Array.isArray(run?.threadIds) && run.threadIds.includes(currentThreadId))
    || null;
  return {
    schema: "resident_agent_continuity_section@1",
    linkedThreadCount: links.length,
    linkedThreadCountsByKind: countBy(links, (link) => link.linkKind),
    linkedThreadCountsByState: countBy(links, (link) => link.linkState),
    currentThreadRef: currentThreadRef(currentThreadId, currentLink),
    fullLinkedThreadIdsIncluded: false,
    linkedThreadIds: [],
    runCount: runs.length,
    activeRunCount: runs.filter(activeRun).length,
    runCountsByKind: countBy(runs, (run) => run.runKind),
    runCountsByLifecycle: countBy(runs, (run) => run.lifecycle),
    currentRunRef: currentRun ? {
      agentRunId: currentRun.agentRunId,
      runKind: currentRun.runKind,
      lifecycle: currentRun.lifecycle,
      runDigest: currentRun.runDigest,
      sourceRef: buildAgentRunContextSourceRef(currentRun, { nowMs }),
    } : null,
    rawTranscriptIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
}

function buildMemoryScopeInventory(memoryInventoryProjection = {}, options = {}) {
  const rows = Array.isArray(memoryInventoryProjection.rows) ? memoryInventoryProjection.rows : [];
  const projectId = normalizeString(options.projectId || memoryInventoryProjection.projectId, "");
  const agentId = normalizeString(options.agentId || memoryInventoryProjection.agentId, "");
  const filteredRows = rows
    .filter((row) => !projectId || row?.projectId === projectId)
    .filter((row) => !agentId || row?.agentId === agentId);
  return {
    schema: "resident_agent_memory_scope_inventory@1",
    projectionId: normalizeString(memoryInventoryProjection.projectionId, ""),
    projectionDigest: normalizeString(memoryInventoryProjection.projectionDigest, ""),
    rowCount: filteredRows.length,
    contextEligibleCount: filteredRows.filter((row) => row.contextEligible === true).length,
    acceptedCount: filteredRows.filter((row) => row.auditState === "accepted").length,
    rejectedCount: filteredRows.filter((row) => row.auditState === "rejected").length,
    countsByScope: countBy(filteredRows, (row) => row.memoryScope),
    countsByKind: countBy(filteredRows, (row) => row.kind),
    countsByEligibility: countBy(filteredRows, (row) => row.contextEligibility),
    contentSummariesIncluded: false,
    memoryIdsIncluded: false,
    rawMemoryTextIncluded: false,
    rawTranscriptIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
}

function capabilityStatusForTool(row = {}) {
  if (row.promotionState === "direct_enabled" || row.promotionState === "direct_restricted") return "known_available";
  if (row.promotionState === "unsupported") return "known_disabled";
  if (row.promotionState === "diagnostic_only" || row.promotionState === "fixture_only") return "shadow_only";
  if (row.promotionState === "activation_gated") return "blocked_by_missing_evidence";
  return "unknown";
}

function capabilityRowsFromRegistry(registry = {}, statusProjection = {}) {
  const rows = Array.isArray(registry.rows) ? registry.rows : [];
  return rows.slice(0, 80).filter(Boolean).map((row) => buildResidentEpistemicRow({
    subjectKind: "tool",
    subjectId: row.toolId,
    displayLabel: row.displayName || row.toolId,
    family: row.odeuFamily,
    status: capabilityStatusForTool(row),
    knowledgeClass: row.capabilityState === "runtime_probed" ? "harness_observed" : "registry_declared",
    residentVisible: true,
    callableInCurrentRequest: false,
    declaredAsProviderTool: ["declared_fixture_only", "declared_live_unproved", "declared_live_accepted"].includes(row.providerDeclarationState),
    controlState: row.promotionState === "direct_restricted" || row.promotionState === "direct_enabled" ? "known_available" : "not_applicable",
    perCallAuthorityRequired: row.approvalMode !== "none" && row.approvalMode !== "display_only",
    channels: {
      epistemic: { visibleToResident: true, visibility: "summary_only" },
      control: {
        controlAvailable: false,
        availableActions: [],
        blockedActions: row.promotionState === "unsupported" ? ["unsupported"] : [],
        authorityRequired: row.approvalMode !== "none" && row.approvalMode !== "display_only",
      },
      transcript: { transcriptVisible: "not_applicable", transcriptSourceRefs: [] },
    },
    epistemicUse: "self_status",
    authorityUse: "none",
    priority: row.promotionState === "direct_restricted" || row.promotionState === "direct_enabled" ? "high" : "normal",
    freshness: "fresh",
    evidenceRefs: [
      {
        refId: row.toolId,
        source: "activation_registry",
        digest: row.rowDigest,
      },
      statusProjection.projectionDigest ? {
        refId: statusProjection.registryId || registry.registryId || "tool_capability_status",
        source: "promotion_decision",
        digest: statusProjection.projectionDigest,
      } : null,
    ].filter(Boolean),
    compactText: `${row.displayName || row.toolId}: ${row.promotionState}; implementation=${row.implementationState}; authority=${row.authorityRequired}.`,
  }));
}

function buildCapabilitySection({ toolCapabilityRegistry = {}, toolCapabilityStatusProjection = {} } = {}) {
  const rows = (Array.isArray(toolCapabilityRegistry.rows) ? toolCapabilityRegistry.rows : []).filter(Boolean);
  const status = isPlainObject(toolCapabilityStatusProjection) ? toolCapabilityStatusProjection : {};
  return {
    schema: "resident_agent_capability_section@1",
    registryId: normalizeString(toolCapabilityRegistry.registryId, ""),
    registryDigest: normalizeString(toolCapabilityRegistry.registryDigest, ""),
    statusProjectionDigest: normalizeString(status.projectionDigest, ""),
    rowCount: rows.length,
    directRestrictedCount: Number(status.directRestrictedCount ?? rows.filter((row) => row?.promotionState === "direct_restricted").length),
    unsupportedCount: Number(status.unsupportedCount ?? rows.filter((row) => row?.promotionState === "unsupported").length),
    byPromotionState: isPlainObject(status.byPromotionState) ? status.byPromotionState : countBy(rows, (row) => row.promotionState),
    byFamily: isPlainObject(status.byFamily) ? status.byFamily : countBy(rows, (row) => row.odeuFamily),
    statusRows: capabilityRowsFromRegistry(toolCapabilityRegistry, status),
    capabilityRowsIncludeAuthority: false,
    rawToolPayloadIncluded: false,
    rawSecretIncluded: false,
  };
}

function buildResidentRowsFromSections({ identitySection, continuitySection, memoryScopeInventory, capabilitySection }) {
  const rows = [
    buildResidentEpistemicRow({
      subjectKind: "thread",
      subjectId: identitySection.agentId || "resident_agent",
      displayLabel: identitySection.displayName || "Resident agent identity",
      family: "agent_identity",
      status: identitySection.agentId ? "known_available" : "unknown",
      knowledgeClass: identitySection.identityConfidence === "exact" ? "exact_runtime" : "derived_projection",
      residentVisible: true,
      channels: {
        epistemic: { visibleToResident: true, visibility: "full_status" },
        control: { controlAvailable: false, availableActions: [], blockedActions: [], authorityRequired: false },
        transcript: { transcriptVisible: "metadata_only", transcriptSourceRefs: [] },
      },
      epistemicUse: "self_status",
      authorityUse: "none",
      priority: "critical",
      freshness: "fresh",
      evidenceRefs: compactRefs([{
        refId: identitySection.sourceRef?.sourceRefId || identitySection.agentId,
        source: "activation_registry",
        digest: identitySection.sourceRef?.sourceRefDigest,
      }]),
      compactText: `agentId=${identitySection.agentId || "unknown"} roleLane=${identitySection.roleLane}; currentWorkThread=${identitySection.currentWorkThreadId || "unknown"}.`,
    }),
    buildResidentEpistemicRow({
      subjectKind: "thread",
      subjectId: continuitySection.currentThreadRef?.threadId || "linked_threads",
      displayLabel: "Agent continuity",
      family: "agent_continuity",
      status: "known_available",
      knowledgeClass: "derived_projection",
      residentVisible: true,
      channels: {
        epistemic: { visibleToResident: true, visibility: "summary_only" },
        control: { controlAvailable: false, availableActions: [], blockedActions: [], authorityRequired: false },
        transcript: { transcriptVisible: "metadata_only", transcriptSourceRefs: [] },
      },
      epistemicUse: "self_status",
      authorityUse: "none",
      priority: "high",
      freshness: "fresh",
      compactText: `${continuitySection.linkedThreadCount} linked thread(s), ${continuitySection.activeRunCount}/${continuitySection.runCount} active run(s); full linked-thread ids omitted.`,
    }),
    buildResidentEpistemicRow({
      subjectKind: "memory",
      subjectId: memoryScopeInventory.projectionDigest || "memory_scope_inventory",
      displayLabel: "Memory scopes",
      family: "agent_memory",
      status: memoryScopeInventory.rowCount ? "known_available" : "known_disabled",
      knowledgeClass: "derived_projection",
      residentVisible: true,
      channels: {
        epistemic: { visibleToResident: true, visibility: "summary_only" },
        control: { controlAvailable: false, availableActions: [], blockedActions: ["memory_mutation_disabled"], authorityRequired: false },
        transcript: { transcriptVisible: "not_applicable", transcriptSourceRefs: [] },
      },
      epistemicUse: "self_status",
      authorityUse: "may_not_act",
      priority: "normal",
      freshness: "fresh",
      evidenceRefs: compactRefs([{
        refId: "memory_inventory_projection",
        source: "memory_frontier",
        digest: memoryScopeInventory.projectionDigest,
      }]),
      compactText: `${memoryScopeInventory.rowCount} memory row(s) across ${Object.keys(memoryScopeInventory.countsByScope).length} scope class(es); content summaries and memory ids omitted.`,
    }),
    ...capabilitySection.statusRows,
  ];
  return rows;
}

function buildResidentAgentIdentitySnapshot(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const nowMs = Number.isFinite(Number(source.nowMs)) ? Number(source.nowMs) : Date.now();
  const identity = isPlainObject(source.identity) ? source.identity : {};
  const threadLinks = Array.isArray(source.threadLinks) ? source.threadLinks : [];
  const agentRuns = Array.isArray(source.agentRuns) ? source.agentRuns : [];
  const currentThreadId = normalizeString(source.currentThreadId || source.threadId, "");
  const currentWorkThreadId = normalizeString(source.currentWorkThreadId || source.workThreadId, "");
  const identitySection = buildIdentitySection({ identity, currentThreadId, currentWorkThreadId, nowMs });
  const continuitySection = buildContinuitySection({ identity, threadLinks, agentRuns, currentThreadId, nowMs });
  const memoryScopeInventory = buildMemoryScopeInventory(source.memoryInventoryProjection, {
    projectId: identitySection.projectId,
    agentId: identitySection.agentId,
  });
  const capabilitySection = buildCapabilitySection({
    toolCapabilityRegistry: source.toolCapabilityRegistry,
    toolCapabilityStatusProjection: source.toolCapabilityStatusProjection,
  });
  const rows = buildResidentRowsFromSections({
    identitySection,
    continuitySection,
    memoryScopeInventory,
    capabilitySection,
  });
  const residentEpistemicSnapshot = buildResidentEpistemicSnapshot({
    snapshotId: source.residentEpistemicSnapshotId,
    workThreadId: currentWorkThreadId || "work_thread_unknown",
    codexThreadId: currentThreadId,
    runtimeFamily: "direct",
    nowMs,
    projectionBudget: source.projectionBudget || { maxRows: 14, maxChars: 2600, truncationPolicy: "priority_then_summary" },
    declarationDigest: identitySection.sourceRef?.sourceRefDigest,
    sourceDigests: [
      identitySection.sourceRef?.sourceRefDigest,
      memoryScopeInventory.projectionDigest,
      capabilitySection.statusProjectionDigest || capabilitySection.registryDigest,
    ].filter(Boolean),
    rows,
  });
  validateResidentEpistemicSnapshot(residentEpistemicSnapshot);
  const contextItem = buildResidentEpistemicContextItem(residentEpistemicSnapshot);
  const snapshot = {
    schema: RESIDENT_AGENT_IDENTITY_SNAPSHOT_SCHEMA,
    snapshotId: normalizeString(source.snapshotId, `resident_agent_identity_${sha256(`${identitySection.agentId}:${currentThreadId}:${currentWorkThreadId}:${residentEpistemicSnapshot.snapshotDigest}`).slice(0, 24)}`),
    generatedAt: nowIso(nowMs),
    policyId: RESIDENT_AGENT_IDENTITY_SNAPSHOT_POLICY_ID,
    identity: identitySection,
    continuity: continuitySection,
    memoryScopeInventory,
    capabilityWitness: {
      schema: capabilitySection.schema,
      registryId: capabilitySection.registryId,
      registryDigest: capabilitySection.registryDigest,
      statusProjectionDigest: capabilitySection.statusProjectionDigest,
      rowCount: capabilitySection.rowCount,
      directRestrictedCount: capabilitySection.directRestrictedCount,
      unsupportedCount: capabilitySection.unsupportedCount,
      byPromotionState: capabilitySection.byPromotionState,
      byFamily: capabilitySection.byFamily,
      statusRowCount: capabilitySection.statusRows.length,
      capabilityRowsIncludeAuthority: false,
    },
    residentEpistemicSnapshot,
    contextWitness: {
      schema: RESIDENT_AGENT_CONTEXT_WITNESS_SCHEMA,
      contextItem,
      contextItemSchema: RESIDENT_EPISTEMIC_CONTEXT_ITEM_SCHEMA,
      compactText: residentEpistemicSnapshot.compactResidentText,
      compactTextDigest: residentEpistemicSnapshot.compactTextDigest,
      grantsAuthority: false,
      rawPrivateMemoryIncluded: false,
      fullLinkedThreadIdsIncluded: false,
      broadCrossThreadTranscriptIncluded: false,
    },
    rawPrivateMemoryIncluded: false,
    rawTranscriptIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
    authorityGranted: false,
  };
  snapshot.snapshotDigest = digestValue("resident-agent-identity-snapshot@1", snapshot);
  return snapshot;
}

function validateResidentAgentIdentitySnapshot(snapshot = {}) {
  if (!isPlainObject(snapshot) || snapshot.schema !== RESIDENT_AGENT_IDENTITY_SNAPSHOT_SCHEMA) {
    throw new Error("resident_agent_identity_snapshot_schema_mismatch");
  }
  if (!snapshot.identity?.agentId) throw new Error("resident_agent_identity_snapshot_missing_agent_id");
  if (!snapshot.identity?.roleLane) throw new Error("resident_agent_identity_snapshot_missing_role_lane");
  if (snapshot.continuity?.fullLinkedThreadIdsIncluded !== false) throw new Error("resident_agent_identity_snapshot_linked_ids_exposed");
  if (Array.isArray(snapshot.continuity?.linkedThreadIds) && snapshot.continuity.linkedThreadIds.length) {
    throw new Error("resident_agent_identity_snapshot_linked_ids_exposed");
  }
  if (snapshot.memoryScopeInventory?.contentSummariesIncluded !== false || snapshot.memoryScopeInventory?.memoryIdsIncluded !== false) {
    throw new Error("resident_agent_identity_snapshot_memory_content_exposed");
  }
  if (snapshot.contextWitness?.grantsAuthority !== false || snapshot.authorityGranted !== false) {
    throw new Error("resident_agent_identity_snapshot_authority_leak");
  }
  if (
    snapshot.rawPrivateMemoryIncluded !== false ||
    snapshot.rawTranscriptIncluded !== false ||
    snapshot.rawPathIncluded !== false ||
    snapshot.rawSecretIncluded !== false
  ) {
    throw new Error("resident_agent_identity_snapshot_raw_exposure");
  }
  validateResidentEpistemicSnapshot(snapshot.residentEpistemicSnapshot);
  if (snapshot.snapshotDigest !== digestValue("resident-agent-identity-snapshot@1", snapshot)) {
    throw new Error("resident_agent_identity_snapshot_digest_mismatch");
  }
  return true;
}

module.exports = {
  RESIDENT_AGENT_CONTEXT_WITNESS_SCHEMA,
  RESIDENT_AGENT_IDENTITY_SNAPSHOT_POLICY_ID,
  RESIDENT_AGENT_IDENTITY_SNAPSHOT_SCHEMA,
  buildMemoryScopeInventory,
  buildResidentAgentIdentitySnapshot,
  validateResidentAgentIdentitySnapshot,
};
