"use strict";

const crypto = require("node:crypto");

const DIRECT_THREAD_EVIDENCE_WORKBENCH_PROJECTION_SCHEMA = "direct_thread_evidence_workbench_projection@1";
const DIRECT_THREAD_EVIDENCE_WORKBENCH_REPORT_SCHEMA = "direct_thread_evidence_workbench_report@1";

const DIRECT_THREAD_LIFECYCLE_TRANSITIONS = Object.freeze({
  active: Object.freeze({
    hide_thread: "hidden",
    archive_thread: "archived",
    soft_delete_thread: "soft_deleted",
  }),
  hidden: Object.freeze({
    unhide_thread: "active",
    archive_thread: "archived",
    soft_delete_thread: "soft_deleted",
  }),
  archived: Object.freeze({
    restore_thread: "active",
    soft_delete_thread: "soft_deleted",
  }),
  soft_deleted: Object.freeze({
    restore_soft_deleted_thread: "active",
  }),
});

const DIRECT_THREAD_EVIDENCE_WORKBENCH_BLOCKER_CODES = Object.freeze([
  "project_generation_stale",
  "workbench_revision_stale",
  "ui_projection_generation_stale",
  "operation_ledger_changed",
  "thread_missing",
  "thread_project_mismatch",
  "thread_lifecycle_changed",
  "invalid_lifecycle_transition",
  "active_direct_turn_exists",
  "client_operation_id_conflict",
  "store_rebuilding",
  "store_corrupt",
  "operation_ledger_corrupt",
  "renderer_projection_missing",
  "renderer_projection_stale",
  "renderer_projection_blocked",
  "renderer_projection_unsafe",
  "preview_caps_exceeded",
  "source_projection_digest_mismatch",
  "external_ref_binding_missing",
  "unsupported_graph_edge_kind",
  "unsupported_graph_endpoint",
  "lineage_cycle_detected",
  "provider_transport_forbidden",
  "app_server_spawn_forbidden",
  "right_pane_mutation_forbidden",
  "handoff_mutation_forbidden",
  "raw_exposure_blocked",
]);

const USER_CREATABLE_GRAPH_EDGE_KINDS = Object.freeze([
  "related",
  "blocks",
  "supersedes",
  "chatgpt_reference",
  "import_source_reference",
]);

const LINEAGE_GRAPH_EDGE_KINDS = Object.freeze([
  "derived_from",
  "merge_preview_of",
  "prune_preview_of",
  "fork_preview_of",
  "forked_from_preview",
  "forked_from_merge_preview",
  "forked_from_prune_preview",
  "forked_from_thread",
  "supersedes",
]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function stableStringify(value, seen = new WeakSet()) {
  if (Array.isArray(value)) return `[${value.map((entry) => stableStringify(entry, seen)).join(",")}]`;
  if (isPlainObject(value)) {
    if (seen.has(value)) return '"[Circular]"';
    seen.add(value);
    const output = `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key], seen)}`).join(",")}}`;
    seen.delete(value);
    return output;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function digestObject(value) {
  return `sha256:${sha256(stableStringify(value))}`;
}

function nowIso(nowMs = Date.now()) {
  return new Date(Number(nowMs) || Date.now()).toISOString();
}

const RAW_HOST_PATH_PATTERN = /(?:^|["\s])(?:\/home\/|\/mnt\/[a-z]\/|\\\\wsl\.localhost\\|[A-Za-z]:\\)/;
const RAW_CHATGPT_URL_PATTERN = /https?:\/\/chatgpt\.com\//i;
const RAW_PROVIDER_FRAME_PATTERN = /"raw(?:Provider|Response|Request|Frame)"/i;
const RAW_AUTH_TOKEN_PATTERN = /\b(?:sk-[A-Za-z0-9_-]{20,}|Bearer\s+[A-Za-z0-9._-]{20,})\b/;

function sensitiveRawField(keyPath = []) {
  const key = String(keyPath[keyPath.length - 1] || "").toLowerCase();
  return /(^|_)(raw|path|url|root|directory|file|provider|request|response|frame|auth|token|secret)(_|$)/i.test(key)
    || /raw|path|url|root|directory|file|provider|request|response|frame|auth|token|secret/i.test(key);
}

function rawExposureFindings(value) {
  const findings = [];
  const visit = (entry, keyPath = []) => {
    const rawField = sensitiveRawField(keyPath);
    if (typeof entry === "string") {
      if (RAW_AUTH_TOKEN_PATTERN.test(entry)) findings.push("raw_auth_token");
      if (rawField && RAW_HOST_PATH_PATTERN.test(entry)) findings.push("raw_host_path");
      if (rawField && RAW_CHATGPT_URL_PATTERN.test(entry)) findings.push("raw_chatgpt_url");
      if (rawField && RAW_PROVIDER_FRAME_PATTERN.test(entry)) findings.push("raw_provider_frame");
      return;
    }
    if (Array.isArray(entry)) {
      entry.forEach((item, index) => visit(item, [...keyPath, String(index)]));
      return;
    }
    if (isPlainObject(entry)) {
      for (const [key, item] of Object.entries(entry)) {
        if (/^raw[A-Z].*Exposed$/.test(key) && item === true) findings.push("raw_exposure_flag_true");
        visit(item, [...keyPath, key]);
      }
    }
  };
  visit(value);
  return [...new Set(findings)];
}

function assertThreadEvidenceWorkbenchRendererSafe(value) {
  const findings = rawExposureFindings(value);
  if (findings.length) {
    const error = new Error(`raw_exposure_blocked:${findings.join(",")}`);
    error.code = "raw_exposure_blocked";
    error.findings = findings;
    throw error;
  }
  return true;
}

function validateThreadEvidenceWorkbenchProjection(value, schema = DIRECT_THREAD_EVIDENCE_WORKBENCH_PROJECTION_SCHEMA) {
  if (!isPlainObject(value) || value.schema !== schema) return false;
  if (!normalizeString(value.projectId, "")) return false;
  if (!isPlainObject(value.meta) || value.meta.schemaVersion !== schema) return false;
  if (!Array.isArray(value.threads) || !Array.isArray(value.previews) || !Array.isArray(value.externalRefs)) return false;
  if (!isPlainObject(value.operationHistory) || !Array.isArray(value.operationHistory.rows)) return false;
  if (value.runtimeAuthorityExercised !== false || value.providerAuthorityExercised !== false) return false;
  return true;
}

function sourceClassForThread(thread = {}) {
  const value = normalizeString(thread.sourceClass, "direct-native");
  if (value === "direct") return "direct-native";
  if (value === "legacy-codex-jsonl") return "legacy-codex-jsonl-import";
  return value;
}

function lifecycleState(thread = {}) {
  return normalizeString(thread.lifecycle?.state || thread.lifecycleState, "active");
}

function threadSummary(thread = {}) {
  const state = lifecycleState(thread);
  const projection = thread.rendererProjection || {};
  return {
    threadId: normalizeString(thread.threadId, ""),
    displayTitle: normalizeString(thread.title, "Untitled direct thread"),
    sourceClass: sourceClassForThread(thread),
    lifecycleState: state,
    activeTurnCount: Number(thread.activeTurnCount || 0),
    rendererProjection: {
      projectionId: normalizeString(projection.projectionId, ""),
      projectionDigest: normalizeString(projection.projectionDigest, ""),
      status: normalizeString(projection.status, "missing"),
      unsafeForRenderer: projection.unsafeForRenderer === true,
      unsafeForContextBuild: projection.unsafeForContextBuild !== false,
    },
    badges: [
      state,
      sourceClassForThread(thread),
      projection.projectionId ? "renderer_projection" : "projection_missing",
      Number(thread.activeTurnCount || 0) > 0 ? "active_turn" : "",
    ].filter(Boolean),
    runnableState: {
      providerRunnable: false,
      providerContinuityAvailable: false,
      canStartFreshForkInThisPr: false,
      reason: "evidence_workbench_non_runnable",
    },
    rawPathIncluded: false,
    rawSourceHashIncluded: false,
  };
}

function tombstoneSummary(thread = {}) {
  return {
    threadId: normalizeString(thread.threadId, ""),
    lifecycleState: "soft_deleted",
    sourceClass: sourceClassForThread(thread),
    displayTitle: normalizeString(thread.displayTitle || thread.title, "Untitled direct thread"),
    deletedAt: normalizeString(thread.deletedAt || thread.lifecycle?.deletedAt, ""),
    deletedByOperationId: normalizeString(thread.deletedByOperationId, ""),
    canRestore: true,
    hardPurgeAvailable: false,
    rendererSafe: true,
    rawPathIncluded: false,
  };
}

function graphProjection(snapshot = {}) {
  const graph = snapshot.graph || {};
  const nodes = [];
  const edges = [];
  const externalRefItems = [];
  for (const item of Array.isArray(graph.items) ? graph.items : []) {
    if (item.itemKind === "graph_thread_node") nodes.push(item);
    if (item.itemKind === "graph_external_ref") externalRefItems.push(item);
    if (item.edge) {
      edges.push({
        edgeId: normalizeString(item.edge.edgeId, ""),
        edgeKind: normalizeString(item.edge.edgeKind, ""),
        sourceKind: normalizeString(item.edge.sourceKind, ""),
        sourceId: normalizeString(item.edge.sourceId, ""),
        targetKind: normalizeString(item.edge.targetKind, ""),
        targetId: normalizeString(item.edge.targetId, ""),
        userCreatable: USER_CREATABLE_GRAPH_EDGE_KINDS.includes(normalizeString(item.edge.edgeKind, "")),
        lineageLike: LINEAGE_GRAPH_EDGE_KINDS.includes(normalizeString(item.edge.edgeKind, "")),
        providerContinuityImplied: false,
        contextInclusionImplied: false,
        rawEndpointIncluded: false,
      });
    }
  }
  return {
    projectionId: normalizeString(graph.projectionId, ""),
    status: normalizeString(graph.status, "missing"),
    digest: normalizeString(graph.digest, ""),
    nodeCount: nodes.length,
    edgeCount: edges.length,
    externalRefNodeCount: externalRefItems.length,
    edges,
    rawEndpointIncluded: false,
  };
}

function externalRefsFromGraph(snapshot = {}) {
  const graph = snapshot.graph || {};
  return (Array.isArray(graph.items) ? graph.items : [])
    .filter((item) => item.itemKind === "graph_external_ref" && item.externalRef)
    .map((item) => ({
      externalRefId: normalizeString(item.externalRef.externalRefId, ""),
      refKind: normalizeString(item.externalRef.refKind, "unknown"),
      displayTitle: normalizeString(item.text, "External reference"),
      targetEvidenceKey: normalizeString(item.externalRef.targetId, ""),
      rendererSafeUrlHash: normalizeString(item.externalRef.rendererSafeUrlHash, ""),
      transcriptImported: false,
      contributesToDirectReadiness: false,
      rawChatGptUrlIncluded: false,
      rawSourcePathIncluded: false,
      rawSourceShaIncluded: false,
      rightPaneMutationAllowed: false,
      handoffMutationAllowed: false,
    }));
}

function previewSummary(operation = {}) {
  const previewId = normalizeString(operation.effects?.find((effect) => effect.targetKind === "projection")?.targetId, "")
    || normalizeString(operation.changed?.previewIds?.[0], "");
  return {
    previewId,
    operationId: normalizeString(operation.operationId, ""),
    previewKind: normalizeString(operation.operationType, "").replace(/^create_/, "").replace(/_preview$/, "_preview"),
    status: normalizeString(operation.status, "unknown"),
    validForDisplay: normalizeString(operation.status, "") === "committed",
    nonRunnable: true,
    canStartFreshForkInThisPr: false,
    providerContinuityAvailable: false,
    contextPackWritten: false,
    requestManifestWritten: false,
    directSessionCreated: false,
    sourceProjectionDigests: [],
    stablePreviewRowKeysRequired: true,
    structuredOmissionMarkersRequired: /prune/i.test(operation.operationType || ""),
    actionability: {
      actionable: false,
      allowedActions: [],
      reason: "preview_is_non_runnable_in_evidence_workbench",
    },
  };
}

function operationHistoryRows(operationSummary = {}) {
  const entries = Array.isArray(operationSummary.entries) ? operationSummary.entries : [];
  return entries.map((operation) => ({
    rowId: `operation:${normalizeString(operation.operationId, "unknown")}`,
    family: operationFamily(operation.operationType),
    eventKind: normalizeString(operation.operationType, "operation"),
    operationId: normalizeString(operation.operationId, ""),
    status: normalizeString(operation.status, "unknown"),
    requestedAt: normalizeString(operation.requestedAt, ""),
    rendererSafeSummary: normalizeString(operation.rendererSafeSummary, operation.operationType),
    artifactRefs: (Array.isArray(operation.effects) ? operation.effects : []).map((effect) => ({
      artifactKind: normalizeString(effect.targetKind, "artifact"),
      evidenceKey: normalizeString(effect.targetId, ""),
      rendererSafeSummary: normalizeString(effect.rendererSafeSummary, effect.effectKind),
    })),
    evidenceKeys: (Array.isArray(operation.effects) ? operation.effects : []).map((effect) => normalizeString(effect.targetId, "")).filter(Boolean),
    actionability: {
      actionable: false,
      allowedActions: [],
      reason: "history_is_read_only",
    },
    rawPayloadIncluded: false,
  }));
}

function operationFamily(operationType = "") {
  if (/lifecycle|hide|archive|restore|soft_delete/.test(operationType)) return "lifecycle";
  if (/bridge|edge|external_ref/.test(operationType)) return "graph";
  if (/merge|prune|fork/.test(operationType)) return "preview";
  if (/import/.test(operationType)) return "import";
  return "operation";
}

function degradedCapabilities(snapshot = {}) {
  const status = snapshot.status || {};
  const healthy = normalizeString(status.health, "ok") !== "corrupt" && status.rebuilding !== true;
  return {
    canReadThreadsBySafeProjection: true,
    canReadGraph: healthy,
    canReadPreviews: healthy,
    canReadOperations: true,
    canRunLifecycleActions: healthy,
    canCreateExternalRefs: healthy,
    canCreateBridge: healthy,
    canCreatePreview: healthy,
    canRefreshProjection: healthy,
  };
}

function buildDirectThreadEvidenceWorkbenchProjection(input = {}) {
  const snapshot = isPlainObject(input.snapshot) ? input.snapshot : {};
  const generatedAt = normalizeString(input.generatedAt, nowIso(input.nowMs));
  const threads = (Array.isArray(snapshot.threads) ? snapshot.threads : []).map(threadSummary);
  const tombstones = threads.filter((thread) => thread.lifecycleState === "soft_deleted").map(tombstoneSummary);
  const operations = operationHistoryRows(snapshot.operationSummary);
  const previews = (snapshot.operationSummary?.entries || [])
    .filter((operation) => /preview/.test(operation.operationType || ""))
    .map(previewSummary);
  const counts = snapshot.lifecycle?.counts || {};
  const source = {
    schema: "direct_thread_evidence_workbench_source@1",
    projectId: normalizeString(snapshot.projectId, ""),
    workbenchRevision: normalizeString(snapshot.workbenchRevision, ""),
    operationLedgerHeadDigest: normalizeString(snapshot.operationLedgerHeadDigest, ""),
    lifecycleProjectionDigest: normalizeString(snapshot.lifecycleProjectionDigest, snapshot.lifecycle?.digest || ""),
    graphProjectionDigest: normalizeString(snapshot.graphProjectionDigest, snapshot.graph?.digest || ""),
    threadIds: threads.map((thread) => thread.threadId),
    operationIds: operations.map((operation) => operation.operationId),
    previewIds: previews.map((preview) => preview.previewId),
  };
  const sourceDigest = digestObject(source);
  const projection = {
    schema: DIRECT_THREAD_EVIDENCE_WORKBENCH_PROJECTION_SCHEMA,
    projectId: source.projectId,
    generatedAt,
    meta: {
      projectId: source.projectId,
      generatedAt,
      uiProjectionGeneration: Number(input.uiProjectionGeneration || 1),
      sourceDigest,
      operationLedgerHeadDigest: source.operationLedgerHeadDigest,
      lifecycleProjectionDigest: source.lifecycleProjectionDigest,
      graphProjectionDigest: source.graphProjectionDigest,
      workbenchRevision: source.workbenchRevision,
      schemaVersion: DIRECT_THREAD_EVIDENCE_WORKBENCH_PROJECTION_SCHEMA,
    },
    workbenchRevision: source.workbenchRevision,
    store: {
      available: snapshot.status?.available !== false,
      health: normalizeString(snapshot.status?.health, "ok"),
      mode: "evidence_workbench",
      canMutateWorkbench: true,
      currentProjectionPointers: {
        currentRendererTranscriptProjectionId: "",
        currentThreadLifecycleProjectionId: normalizeString(snapshot.lifecycle?.projectionId, ""),
        currentThreadGraphProjectionId: normalizeString(snapshot.graph?.projectionId, ""),
        currentMergePreviewProjectionId: "",
        currentPrunePreviewProjectionId: "",
        currentForkPreviewProjectionId: "",
      },
      rawStorePathIncluded: false,
    },
    capabilities: degradedCapabilities(snapshot),
    lifecycleTransitionMatrix: DIRECT_THREAD_LIFECYCLE_TRANSITIONS,
    blockerCodes: DIRECT_THREAD_EVIDENCE_WORKBENCH_BLOCKER_CODES,
    selectedScope: normalizeString(input.selectedScope, "active-turn"),
    filters: {
      includeHidden: snapshot.filters?.includeHidden === true,
      includeArchived: snapshot.filters?.includeArchived === true,
      includeSoftDeleted: snapshot.filters?.includeSoftDeleted === true,
      sourceClassFilter: Array.isArray(input.sourceClassFilter) ? input.sourceClassFilter.map(String) : [],
      textSearchMode: normalizeString(snapshot.search?.mode, "none"),
      textQueryApplied: snapshot.search?.queryApplied === true,
      textSearchLimitation: snapshot.search?.queryApplied === true ? "projection-backed-current-index" : "none",
    },
    counts: {
      active: Number(counts.active || 0),
      hidden: Number(counts.hidden || 0),
      archived: Number(counts.archived || 0),
      softDeleted: Number(counts.soft_deleted || 0),
      totalThreads: Number(snapshot.page?.threads?.total || threads.length),
      returnedThreads: threads.length,
      externalRefs: externalRefsFromGraph(snapshot).length,
      graphEdges: graphProjection(snapshot).edgeCount,
      previews: previews.length,
      operations: Number(snapshot.operationSummary?.page?.total || operations.length),
    },
    threads,
    tombstones,
    graph: graphProjection(snapshot),
    externalRefs: externalRefsFromGraph(snapshot),
    previews,
    operationHistory: {
      rows: operations,
      nextCursor: "",
      hasMore: Number(snapshot.operationSummary?.page?.total || operations.length) > operations.length,
      sourceLedgerHeadDigest: source.operationLedgerHeadDigest,
      pageDigest: digestObject(operations),
    },
    futureFreshFork: {
      availableInThisPr: false,
      controlLabel: "Preview only",
      startForkTurnIpcReachableFromEvidenceWorkbench: false,
      contextPackBuildsAllowed: false,
      requestManifestBuildsAllowed: false,
      directSessionCreatesAllowed: false,
    },
    rawExposure: {
      rawPathExposed: false,
      rawChatGptUrlExposed: false,
      rawSourceHashExposed: false,
      rawJsonlExposed: false,
      rawBackendFrameExposed: false,
      rawAuthExposed: false,
      rawProviderPayloadExposed: false,
    },
    sentinelCounters: {
      providerTransportCalls: 0,
      appServerSpawnCalls: 0,
      workspaceReadCalls: 0,
      patchApplyCalls: 0,
      commandRunCalls: 0,
      contextPackBuilds: 0,
      requestManifestBuilds: 0,
      directSessionCreates: 0,
      freshForkStartCalls: 0,
      rightPaneMutationCalls: 0,
      handoffMutationCalls: 0,
    },
    runtimeAuthorityExercised: false,
    providerAuthorityExercised: false,
  };
  assertThreadEvidenceWorkbenchRendererSafe(projection);
  return projection;
}

function buildDirectThreadEvidenceWorkbenchReport(input = {}) {
  const projection = buildDirectThreadEvidenceWorkbenchProjection(input);
  const report = {
    schema: DIRECT_THREAD_EVIDENCE_WORKBENCH_REPORT_SCHEMA,
    generatedAt: projection.generatedAt,
    coverageSource: "fixture_workbench",
    matrixPromotionCandidate: false,
    authorityPromotionCandidate: false,
    runtimeAuthorityExercised: false,
    providerAuthorityExercised: false,
    rowsExercised: ["G1", "G2", "G3", "G4", "G5", "G6", "G7", "G10", "C5", "F8", "F10"],
    projection,
    assertions: {
      lifecycleTransitionMatrixPresent: true,
      softDeleteIsReversibleOnly: true,
      previewsNonRunnable: projection.previews.every((preview) => preview.nonRunnable === true && preview.canStartFreshForkInThisPr === false),
      operationHistoryReadOnly: projection.operationHistory.rows.every((row) => row.actionability?.actionable === false),
      rawExposureClear: rawExposureFindings(projection).length === 0,
      sentinelCountersZero: Object.values(projection.sentinelCounters).every((value) => Number(value || 0) === 0),
    },
  };
  assertThreadEvidenceWorkbenchRendererSafe(report);
  return report;
}

module.exports = {
  DIRECT_THREAD_EVIDENCE_WORKBENCH_BLOCKER_CODES,
  DIRECT_THREAD_EVIDENCE_WORKBENCH_PROJECTION_SCHEMA,
  DIRECT_THREAD_EVIDENCE_WORKBENCH_REPORT_SCHEMA,
  DIRECT_THREAD_LIFECYCLE_TRANSITIONS,
  LINEAGE_GRAPH_EDGE_KINDS,
  USER_CREATABLE_GRAPH_EDGE_KINDS,
  assertThreadEvidenceWorkbenchRendererSafe,
  buildDirectThreadEvidenceWorkbenchProjection,
  buildDirectThreadEvidenceWorkbenchReport,
  validateThreadEvidenceWorkbenchProjection,
};
