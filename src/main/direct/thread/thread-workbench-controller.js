"use strict";

const crypto = require("node:crypto");
const {
  FORK_PREVIEW_PROJECTION_KIND,
  MERGE_PREVIEW_PROJECTION_KIND,
  PRUNE_PREVIEW_PROJECTION_KIND,
  RENDERER_TRANSCRIPT_PROJECTION_KIND,
  THREAD_GRAPH_PROJECTION_KIND,
  THREAD_LIFECYCLE_PROJECTION_KIND,
} = require("./thread-store");
const {
  buildDirectThreadEvidenceWorkbenchProjection,
  validateThreadEvidenceWorkbenchProjection,
} = require("./thread-evidence-workbench");

const DIRECT_THREAD_WORKBENCH_SNAPSHOT_SCHEMA = "renderer_safe_direct_thread_workbench_snapshot@1";
const DIRECT_THREAD_WORKBENCH_CONTROLLER_VERSION = "direct_thread_workbench_controller@1";
const SOFT_DELETE_CONFIRMATION_TTL_MS = 2 * 60 * 1000;
const USER_CREATABLE_BRIDGE_EDGE_KINDS = new Set([
  "related",
  "blocks",
  "supersedes",
  "chatgpt_reference",
  "import_source_reference",
]);
const LINEAGE_EDGE_KINDS = new Set([
  "derived_from",
  "merge_preview_of",
  "prune_preview_of",
  "fork_preview_of",
  "forked_from_preview",
  "forked_from_merge_preview",
  "forked_from_prune_preview",
  "forked_from_thread",
]);
const PREVIEW_KINDS = new Set([
  MERGE_PREVIEW_PROJECTION_KIND,
  PRUNE_PREVIEW_PROJECTION_KIND,
  FORK_PREVIEW_PROJECTION_KIND,
]);
const FORK_START_CONFIRMATION_TTL_MS = 2 * 60 * 1000;

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizeNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function nowIso(nowMs = Date.now()) {
  return new Date(Number(nowMs) || Date.now()).toISOString();
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function makeError(code, message = code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function pageParams(params = {}, fallbackLimit = 60) {
  const offset = Math.max(0, normalizeNumber(params.offset, 0));
  const limit = Math.max(1, Math.min(500, normalizeNumber(params.limit, fallbackLimit)));
  return { offset, limit };
}

function parseJson(value, fallback = {}) {
  try {
    return JSON.parse(value || "");
  } catch {
    return fallback;
  }
}

function safeOperationResult(operation = {}) {
  const result = isPlainObject(operation.result) ? operation.result : {};
  return {
    operationId: normalizeString(operation.operationId, ""),
    operationType: normalizeString(operation.operationType, ""),
    status: normalizeString(operation.status || result.status, "unknown"),
    blockerCode: normalizeString(result.blockerCode, ""),
    changed: {
      threadIds: Array.isArray(operation.target?.threadIds) ? operation.target.threadIds.map(String) : [],
      projectionIds: (Array.isArray(result.effects) ? result.effects : [])
        .filter((effect) => effect?.targetKind === "projection")
        .map((effect) => normalizeString(effect.targetId, ""))
        .filter(Boolean),
      edgeIds: (Array.isArray(result.effects) ? result.effects : [])
        .filter((effect) => effect?.targetKind === "thread_edge")
        .map((effect) => normalizeString(effect.targetId, ""))
        .filter(Boolean),
      previewIds: normalizeString(operation.projectionId, "") ? [operation.projectionId] : [],
    },
    refreshRequired: true,
    resultSummary: {
      lifecycle: isPlainObject(result.lifecycle) ? result.lifecycle : null,
      effectCount: Array.isArray(result.effects) ? result.effects.length : 0,
    },
  };
}

class DirectThreadWorkbenchController {
  constructor(options = {}) {
    if (!options.threadStore) throw new Error("DirectThreadWorkbenchController requires a threadStore.");
    this.threadStore = options.threadStore;
    this.sessionStore = options.sessionStore || null;
    this.projectResolver = typeof options.projectResolver === "function" ? options.projectResolver : null;
    this.liveTextController = options.liveTextController || null;
    this.now = typeof options.now === "function" ? options.now : () => Date.now();
    this.softDeleteConfirmations = new Map();
    this.forkStartConfirmations = new Map();
  }

  async resolveProject(projectOrId) {
    if (isPlainObject(projectOrId)) return projectOrId;
    if (this.projectResolver) return this.projectResolver(projectOrId);
    return { id: normalizeString(projectOrId, "") };
  }

  projectId(project = {}) {
    return normalizeString(project.id, "");
  }

  projectGeneration(project = {}) {
    return normalizeNumber(project.updatedAt ? Date.parse(project.updatedAt) : 0, 0);
  }

  pruneConfirmations(nowMs = this.now()) {
    for (const [confirmationId, confirmation] of this.softDeleteConfirmations.entries()) {
      if (Number(confirmation.expiresAtMs || 0) <= nowMs) this.softDeleteConfirmations.delete(confirmationId);
    }
    for (const [confirmationId, confirmation] of this.forkStartConfirmations.entries()) {
      if (Number(confirmation.expiresAtMs || 0) <= nowMs) this.forkStartConfirmations.delete(confirmationId);
    }
  }

  resolveLiveTextController() {
    const controller = typeof this.liveTextController === "function" ? this.liveTextController() : this.liveTextController;
    if (!controller) throw makeError("direct_runtime_not_enabled");
    return controller;
  }

  ensureIndexed(options = {}) {
    if (this.sessionStore && typeof this.threadStore.indexFromSessionStore === "function") {
      const status = this.threadStore.status();
      if (status.threadCount > 0 && options.forceIndex !== true) return;
      this.threadStore.indexFromSessionStore(this.sessionStore);
    }
  }

  projectionSummary(row) {
    const projection = this.threadStore.projectionFromRow(row);
    if (!projection) return null;
    return {
      projectionId: projection.projectionId,
      projectionKind: projection.projectionKind,
      status: projection.status,
      projectionDigest: projection.projectionDigest,
      unsafeForRenderer: projection.unsafeForRenderer === true,
      unsafeForContextBuild: projection.unsafeForContextBuild === true,
      createdAt: projection.createdAt,
    };
  }

  currentProjectProjectionSummary(projectId, projectionKind) {
    try {
      return this.projectionSummary(this.threadStore.projectCurrentProjectionRow(projectId, projectionKind));
    } catch {
      return null;
    }
  }

  currentThreadProjectionSummary(threadId, projectionKind = RENDERER_TRANSCRIPT_PROJECTION_KIND) {
    try {
      return this.projectionSummary(this.threadStore.currentProjectionRow(threadId, projectionKind));
    } catch {
      return null;
    }
  }

  workbenchRevision(projectId) {
    const operationManifest = this.threadStore.readOperationManifest();
    const lifecycle = this.currentProjectProjectionSummary(projectId, THREAD_LIFECYCLE_PROJECTION_KIND);
    const graph = this.currentProjectProjectionSummary(projectId, THREAD_GRAPH_PROJECTION_KIND);
    const status = this.threadStore.status();
    const input = {
      schema: "direct_thread_workbench_revision@1",
      projectId,
      operationLedgerHeadDigest: normalizeString(operationManifest.hashChainHead, ""),
      lifecycleProjectionDigest: normalizeString(lifecycle?.projectionDigest, ""),
      graphProjectionDigest: normalizeString(graph?.projectionDigest, ""),
      threadCount: Number(status.threadCount || 0),
      operationCount: Number(status.operationCount || 0),
      controllerVersion: DIRECT_THREAD_WORKBENCH_CONTROLLER_VERSION,
    };
    return {
      workbenchRevision: `workbench_${sha256(stableStringify(input)).slice(0, 28)}`,
      operationLedgerHeadDigest: input.operationLedgerHeadDigest,
      lifecycleProjectionDigest: input.lifecycleProjectionDigest,
      graphProjectionDigest: input.graphProjectionDigest,
    };
  }

  assertExpectedRevision(projectId, input = {}) {
    const expected = normalizeString(input.expectedWorkbenchRevision, "");
    const expectedLedger = normalizeString(input.expectedOperationLedgerHeadDigest, "");
    if (!expected && !expectedLedger) return;
    const revision = this.workbenchRevision(projectId);
    if (expected && expected !== revision.workbenchRevision) throw makeError("workbench_revision_stale");
    if (expectedLedger && expectedLedger !== revision.operationLedgerHeadDigest) throw makeError("operation_ledger_changed");
  }

  validateExpectedThread(projectId, input = {}) {
    const threadId = normalizeString(input.threadId || input.sourceThreadId, "");
    if (!threadId) return null;
    const row = this.threadStore.requireThreadInProject(projectId, threadId);
    const expectedState = normalizeString(input.expectedLifecycleState, "");
    if (expectedState && expectedState !== normalizeString(row.lifecycle_state, "active")) {
      throw makeError("lifecycle_state_changed");
    }
    const expectedProjectionId = normalizeString(input.expectedRendererProjectionId || input.expectedSourceProjectionId, "");
    const expectedProjectionDigest = normalizeString(input.expectedRendererProjectionDigest || input.expectedSourceProjectionDigest, "");
    if (expectedProjectionId || expectedProjectionDigest) {
      const projection = this.currentThreadProjectionSummary(threadId, RENDERER_TRANSCRIPT_PROJECTION_KIND);
      if (!projection || projection.status !== "valid" || projection.unsafeForRenderer) {
        throw makeError("stale_source_projection");
      }
      if (expectedProjectionId && expectedProjectionId !== projection.projectionId) {
        throw makeError("source_projection_changed");
      }
      if (expectedProjectionDigest && expectedProjectionDigest !== projection.projectionDigest) {
        throw makeError("source_projection_changed");
      }
    }
    return row;
  }

  ensureProjectProjections(projectId, options = {}) {
    const force = options.force === true;
    try {
      this.threadStore.buildThreadLifecycleProjection(projectId, { force });
    } catch (error) {
      if (!/projection_build_in_progress/.test(error?.message || "")) throw error;
    }
    try {
      this.threadStore.buildThreadGraphProjection(projectId, { force });
    } catch (error) {
      if (!/projection_build_in_progress/.test(error?.message || "")) throw error;
    }
  }

  async getSnapshot(projectOrId, params = {}) {
    const project = await this.resolveProject(projectOrId);
    const projectId = this.projectId(project);
    if (!projectId) throw makeError("project_missing");
    this.ensureIndexed({ forceIndex: params.forceIndex === true || params.refresh === true });
    this.ensureProjectProjections(projectId, { force: params.refresh === true });
    const threadPage = pageParams(params.page?.threads || params.threads || {}, 80);
    const filters = isPlainObject(params.filters) ? params.filters : {};
    const textQuery = normalizeString(filters.textQuery, "");
    const threadQuery = {
      includeHidden: filters.includeHidden === true,
      includeArchived: filters.includeArchived === true,
      includeSoftDeleted: filters.includeSoftDeleted === true,
      textQuery,
    };
    const totalThreads = this.threadStore.countThreadSummaries(projectId, threadQuery);
    const threads = this.threadStore.listThreadSummaries(projectId, {
      ...threadQuery,
      offset: threadPage.offset,
      limit: threadPage.limit,
    }).map((thread) => ({
      ...thread,
      rendererProjection: this.currentThreadProjectionSummary(thread.threadId),
      activeTurnCount: this.threadStore.activeTurnCount(thread.threadId),
    }));
    const lifecycleProjection = this.threadStore.readThreadLifecycleProjection(projectId, { offset: 0, limit: 1 });
    const graphProjection = this.threadStore.readThreadGraphProjection(projectId, { offset: 0, limit: 120 });
    const operations = this.readOperationHistorySync(projectId, params.page?.operations || { limit: 20 });
    const revision = this.workbenchRevision(projectId);
    const snapshot = {
      schema: DIRECT_THREAD_WORKBENCH_SNAPSHOT_SCHEMA,
      projectId,
      projectGeneration: this.projectGeneration(project),
      controllerVersion: DIRECT_THREAD_WORKBENCH_CONTROLLER_VERSION,
      ...revision,
      status: this.threadStore.status(),
      filters: {
        includeHidden: filters.includeHidden === true,
        includeArchived: filters.includeArchived === true,
        includeSoftDeleted: filters.includeSoftDeleted === true,
        textQuery: normalizeString(filters.textQuery, ""),
      },
      search: {
        mode: textQuery ? "projection_index" : "none",
        queryApplied: Boolean(textQuery),
        resultMayBePartial: false,
      },
      lifecycle: {
        projectionId: normalizeString(lifecycleProjection?.projectionId, ""),
        status: normalizeString(lifecycleProjection?.status, "missing"),
        digest: revision.lifecycleProjectionDigest,
        counts: lifecycleProjection?.source?.counts || { active: 0, hidden: 0, archived: 0, soft_deleted: 0 },
      },
      graph: {
        projectionId: normalizeString(graphProjection?.projectionId, ""),
        status: normalizeString(graphProjection?.status, "missing"),
        digest: revision.graphProjectionDigest,
        itemCount: Number(graphProjection?.page?.total || graphProjection?.items?.length || 0),
        items: Array.isArray(graphProjection?.items) ? graphProjection.items.slice(0, 120) : [],
      },
      threads,
      page: {
        threads: {
          ...threadPage,
          returned: threads.length,
          total: totalThreads,
        },
      },
      operationSummary: operations,
      rawExposure: {
        rawPathExposed: false,
        rawChatGptUrlExposed: false,
        rawSourceHashExposed: false,
        rawJsonlExposed: false,
        rawBackendFrameExposed: false,
        rawAuthExposed: false,
      },
    };
    snapshot.evidenceWorkbench = buildDirectThreadEvidenceWorkbenchProjection({ snapshot });
    if (!validateThreadEvidenceWorkbenchProjection(snapshot.evidenceWorkbench)) throw makeError("renderer_projection_unsafe");
    return snapshot;
  }

  async getEvidenceWorkbenchProjection(projectOrId, params = {}) {
    const snapshot = await this.getSnapshot(projectOrId, params);
    return snapshot.evidenceWorkbench;
  }

  async readThreadProjection(projectOrId, threadId, params = {}) {
    const project = await this.resolveProject(projectOrId);
    const projectId = this.projectId(project);
    if (!projectId) throw makeError("project_missing");
    this.ensureIndexed();
    this.threadStore.requireThreadInProject(projectId, threadId);
    const current = this.currentThreadProjectionSummary(threadId, RENDERER_TRANSCRIPT_PROJECTION_KIND);
    if (!current || current.status === "blocked" || current.unsafeForRenderer === true || params.refresh === true) {
      try {
        this.threadStore.buildRendererTranscriptProjection(threadId, { sessionStore: this.sessionStore, force: params.refresh === true });
      } catch (error) {
        if (!/projection_build_in_progress/.test(error?.message || "")) throw error;
      }
    }
    const page = pageParams(params, 100);
    return {
      projection: this.threadStore.readRendererTranscriptProjection(threadId, page),
      meta: {
        projectId,
        projectGeneration: this.projectGeneration(project),
        ...this.workbenchRevision(projectId),
      },
    };
  }

  async readProjectProjection(projectOrId, projectionKind, params = {}) {
    const project = await this.resolveProject(projectOrId);
    const projectId = this.projectId(project);
    if (!projectId) throw makeError("project_missing");
    this.ensureIndexed();
    if (projectionKind === THREAD_LIFECYCLE_PROJECTION_KIND || projectionKind === THREAD_GRAPH_PROJECTION_KIND) {
      this.ensureProjectProjections(projectId, { force: params.refresh === true });
    }
    return {
      projection: this.threadStore.readProjectProjectionByKind(projectId, projectionKind, pageParams(params, 100)),
      meta: {
        projectId,
        projectGeneration: this.projectGeneration(project),
        ...this.workbenchRevision(projectId),
      },
    };
  }

  async readPreviewProjection(projectOrId, previewId, params = {}) {
    const project = await this.resolveProject(projectOrId);
    const projectId = this.projectId(project);
    if (!projectId) throw makeError("project_missing");
    const row = this.threadStore.db.prepare(`
      select projection_kind
      from direct_projections
      where project_id = ? and projection_id = ?
    `).get(projectId, normalizeString(previewId, ""));
    if (!row || !PREVIEW_KINDS.has(row.projection_kind)) throw makeError("preview_projection_not_found");
    const projection = this.threadStore.readProjectProjectionByKind(projectId, row.projection_kind, {
      projectionId: previewId,
      ...pageParams(params, 100),
    });
    if (params.includeSourceRefs !== true && Array.isArray(projection?.items)) {
      projection.items = projection.items.map((item) => {
        const { sourceRefs, ...rest } = item;
        return { ...rest, sourceRefCount: Array.isArray(sourceRefs) ? sourceRefs.length : 0 };
      });
    }
    return {
      projection,
      meta: {
        projectId,
        projectGeneration: this.projectGeneration(project),
        ...this.workbenchRevision(projectId),
      },
    };
  }

  readOperationHistorySync(projectId, params = {}) {
    const page = pageParams(params, 40);
    const operationTypes = Array.isArray(params.operationTypes) ? params.operationTypes.map(String).filter(Boolean) : [];
    const statuses = Array.isArray(params.statuses) ? params.statuses.map(String).filter(Boolean) : [];
    const where = ["project_id = ?"];
    const values = [projectId];
    if (operationTypes.length) {
      where.push(`operation_type in (${operationTypes.map(() => "?").join(", ")})`);
      values.push(...operationTypes);
    }
    if (statuses.length) {
      where.push(`status in (${statuses.map(() => "?").join(", ")})`);
      values.push(...statuses);
    }
    const rows = this.threadStore.db.prepare(`
      select *
      from direct_operations
      where ${where.join(" and ")}
      order by requested_at desc, operation_id desc
      limit ? offset ?
    `).all(...values, page.limit, page.offset);
    const totalRow = this.threadStore.db.prepare(`
      select count(*) as count
      from direct_operations
      where ${where.join(" and ")}
    `).get(...values);
    const operationIds = rows.map((row) => row.operation_id);
    const effectRows = operationIds.length
      ? this.threadStore.db.prepare(`
        select operation_id, effect_kind, target_kind, target_id, renderer_safe_summary, created_at
        from direct_operation_effects
        where operation_id in (${operationIds.map(() => "?").join(", ")})
        order by operation_id asc, effect_ordinal asc
      `).all(...operationIds)
      : [];
    const effectsByOperationId = new Map();
    for (const effect of effectRows) {
      if (!effectsByOperationId.has(effect.operation_id)) effectsByOperationId.set(effect.operation_id, []);
      effectsByOperationId.get(effect.operation_id).push({
        effectKind: effect.effect_kind,
        targetKind: effect.target_kind,
        targetId: effect.target_id,
        rendererSafeSummary: effect.renderer_safe_summary,
        createdAt: effect.created_at,
      });
    }
    const entries = rows.map((row) => {
      const target = parseJson(row.target_json, {});
      const result = parseJson(row.result_json, {});
      const effects = effectsByOperationId.get(row.operation_id) || [];
      return {
        operationId: row.operation_id,
        operationType: row.operation_type,
        status: row.status,
        requestedAt: row.requested_at,
        committedAt: normalizeString(row.committed_at, ""),
        rendererSafeTargets: {
          threadIds: Array.isArray(target.threadIds) ? target.threadIds.map(String) : [],
          edgeId: normalizeString(target.edgeId, ""),
        },
        rendererSafeSummary: normalizeString(result.blockerCode, "") || normalizeString(result.lifecycle?.afterState, "") || row.operation_type,
        blockerCode: normalizeString(result.blockerCode, ""),
        effectCount: effects.length,
        effects,
      };
    });
    return {
      entries,
      page: {
        ...page,
        returned: entries.length,
        total: Number(totalRow?.count || 0),
      },
      rawExposure: {
        rawInputPayloadExposed: false,
        rawErrorPayloadExposed: false,
        rawPathExposed: false,
        rawChatGptUrlExposed: false,
      },
    };
  }

  async readOperationHistory(projectOrId, params = {}) {
    const project = await this.resolveProject(projectOrId);
    const projectId = this.projectId(project);
    if (!projectId) throw makeError("project_missing");
    return {
      history: this.readOperationHistorySync(projectId, params),
      meta: {
        projectId,
        projectGeneration: this.projectGeneration(project),
        ...this.workbenchRevision(projectId),
      },
    };
  }

  async prepareSoftDelete(projectOrId, threadId, input = {}) {
    const project = await this.resolveProject(projectOrId);
    const projectId = this.projectId(project);
    this.ensureIndexed();
    this.assertExpectedRevision(projectId, input);
    const row = this.validateExpectedThread(projectId, { ...input, threadId });
    if (this.threadStore.activeTurnCount(threadId) > 0) throw makeError("active_direct_turn_exists");
    const nowMs = this.now();
    const confirmationId = `soft_delete_${crypto.randomBytes(18).toString("base64url")}`;
    const confirmation = {
      confirmationId,
      projectId,
      threadId,
      expectedWorkbenchRevision: normalizeString(input.expectedWorkbenchRevision, ""),
      operationLedgerHeadDigest: this.workbenchRevision(projectId).operationLedgerHeadDigest,
      expectedLifecycleState: normalizeString(row.lifecycle_state, "active"),
      expiresAtMs: nowMs + SOFT_DELETE_CONFIRMATION_TTL_MS,
    };
    this.pruneConfirmations(nowMs);
    this.softDeleteConfirmations.set(confirmationId, confirmation);
    return {
      confirmationId,
      expiresAt: nowIso(confirmation.expiresAtMs),
      workbenchRevision: confirmation.expectedWorkbenchRevision,
      operationLedgerHeadDigest: confirmation.operationLedgerHeadDigest,
      rendererSafeThreadLabel: normalizeString(row.title, "Direct thread"),
      reversible: true,
      rawPathExposed: false,
    };
  }

  requireSoftDeleteConfirmation(projectId, input = {}) {
    const confirmationId = normalizeString(input.confirmationId, "");
    if (!confirmationId) throw makeError("confirmation_required");
    this.pruneConfirmations();
    const confirmation = this.softDeleteConfirmations.get(confirmationId);
    if (!confirmation) throw makeError("confirmation_expired");
    if (confirmation.projectId !== projectId || confirmation.threadId !== normalizeString(input.threadId, "")) {
      throw makeError("confirmation_project_mismatch");
    }
    this.softDeleteConfirmations.delete(confirmationId);
  }

  async runLifecycleAction(projectOrId, input = {}) {
    const project = await this.resolveProject(projectOrId);
    const projectId = this.projectId(project);
    if (!projectId) throw makeError("project_missing");
    this.ensureIndexed();
    this.assertExpectedRevision(projectId, input);
    const action = normalizeString(input.action, "");
    const threadId = normalizeString(input.threadId, "");
    const row = this.validateExpectedThread(projectId, { ...input, threadId });
    if (action === "archive" && this.threadStore.activeTurnCount(threadId) > 0) throw makeError("active_direct_turn_exists");
    if (action === "soft_delete") this.requireSoftDeleteConfirmation(projectId, { ...input, threadId });
    const common = {
      projectId,
      threadId,
      clientOperationId: normalizeString(input.clientOperationId, `workbench_${action}_${threadId}_${Date.now()}`),
      expectedCurrentLifecycleState: normalizeString(input.expectedLifecycleState, row.lifecycle_state),
      expectedProjectGeneration: this.projectGeneration(project),
      actor: "renderer-workbench",
    };
    const operation = {
      hide: () => this.threadStore.hideThread(common),
      unhide: () => this.threadStore.unhideThread(common),
      archive: () => this.threadStore.archiveThread(common),
      restore: () => this.threadStore.restoreThread(common),
      soft_delete: () => this.threadStore.softDeleteThread({ ...common, requiresConfirmation: true }),
      restore_soft_deleted: () => this.threadStore.restoreSoftDeletedThread(common),
    }[action];
    if (!operation) throw makeError("unsupported_lifecycle_action");
    const result = operation();
    const revision = this.workbenchRevision(projectId);
    return {
      ...safeOperationResult(result),
      nextWorkbenchRevision: revision.workbenchRevision,
      meta: {
        projectId,
        projectGeneration: this.projectGeneration(project),
        ...revision,
      },
    };
  }

  validateBridgeInput(projectId, input = {}) {
    const edgeKind = normalizeString(input.edgeKind, "related");
    if (!USER_CREATABLE_BRIDGE_EDGE_KINDS.has(edgeKind) || LINEAGE_EDGE_KINDS.has(edgeKind)) {
      throw makeError("unsupported_graph_edge_kind");
    }
    const sourceKind = normalizeString(input.sourceKind, "direct_thread");
    const targetKind = normalizeString(input.targetKind, "direct_thread");
    if (edgeKind === "chatgpt_reference" && !(["direct_thread", "derived_projection"].includes(sourceKind) && targetKind === "external_ref")) {
      throw makeError("unsupported_graph_endpoint");
    }
    if (edgeKind === "import_source_reference" && targetKind !== "external_ref") {
      throw makeError("unsupported_graph_endpoint");
    }
    if (["related", "blocks", "supersedes"].includes(edgeKind) && (sourceKind !== "direct_thread" || targetKind !== "direct_thread")) {
      throw makeError("unsupported_graph_endpoint");
    }
    if (sourceKind === "direct_thread") this.validateExpectedThread(projectId, { threadId: input.sourceId, expectedLifecycleState: input.expectedSourceLifecycleState });
    if (targetKind === "direct_thread") this.validateExpectedThread(projectId, { threadId: input.targetId, expectedLifecycleState: input.expectedTargetLifecycleState });
  }

  async createExternalRef(projectOrId, input = {}) {
    const project = await this.resolveProject(projectOrId);
    const projectId = this.projectId(project);
    if (!projectId) throw makeError("project_missing");
    this.assertExpectedRevision(projectId, input);
    if (input.url || input.rawUrl) throw makeError("raw_external_url_not_allowed");
    const ref = this.threadStore.createExternalRef({ ...input, projectId });
    this.threadStore.buildThreadGraphProjection(projectId, { force: true });
    return { ref, meta: { projectId, ...this.workbenchRevision(projectId) } };
  }

  async createBridge(projectOrId, input = {}) {
    const project = await this.resolveProject(projectOrId);
    const projectId = this.projectId(project);
    if (!projectId) throw makeError("project_missing");
    this.ensureIndexed();
    this.assertExpectedRevision(projectId, input);
    this.validateBridgeInput(projectId, input);
    const result = this.threadStore.bridgeThreads({
      ...input,
      projectId,
      clientOperationId: normalizeString(input.clientOperationId, `workbench_bridge_${Date.now()}`),
    });
    const revision = this.workbenchRevision(projectId);
    return {
      ...safeOperationResult(result),
      nextWorkbenchRevision: revision.workbenchRevision,
      meta: { projectId, projectGeneration: this.projectGeneration(project), ...revision },
    };
  }

  async unlinkBridge(projectOrId, input = {}) {
    const project = await this.resolveProject(projectOrId);
    const projectId = this.projectId(project);
    if (!projectId) throw makeError("project_missing");
    this.ensureIndexed();
    this.assertExpectedRevision(projectId, input);
    if (LINEAGE_EDGE_KINDS.has(normalizeString(input.edgeKind, ""))) throw makeError("unsupported_graph_edge_kind");
    const result = this.threadStore.unlinkBridge({
      ...input,
      projectId,
      clientOperationId: normalizeString(input.clientOperationId, `workbench_unlink_${Date.now()}`),
    });
    const revision = this.workbenchRevision(projectId);
    return {
      ...safeOperationResult(result),
      nextWorkbenchRevision: revision.workbenchRevision,
      meta: { projectId, projectGeneration: this.projectGeneration(project), ...revision },
    };
  }

  validatePreviewSources(projectId, sources = []) {
    for (const source of sources) {
      this.validateExpectedThread(projectId, {
        threadId: source.threadId || source.sourceThreadId,
        expectedLifecycleState: source.expectedLifecycleState,
        expectedRendererProjectionId: source.expectedRendererProjectionId,
        expectedRendererProjectionDigest: source.expectedRendererProjectionDigest,
      });
    }
  }

  async createMergePreview(projectOrId, input = {}) {
    const project = await this.resolveProject(projectOrId);
    const projectId = this.projectId(project);
    if (!projectId) throw makeError("project_missing");
    this.ensureIndexed();
    this.assertExpectedRevision(projectId, input);
    const sources = Array.isArray(input.sources) ? input.sources : (Array.isArray(input.sourceThreadIds) ? input.sourceThreadIds.map((threadId) => ({ threadId })) : []);
    this.validatePreviewSources(projectId, sources);
    const result = this.threadStore.createMergePreview({
      ...input,
      projectId,
      sourceThreadIds: sources.map((source) => normalizeString(source.threadId || source.sourceThreadId, "")).filter(Boolean),
      clientOperationId: normalizeString(input.clientOperationId, `workbench_merge_preview_${Date.now()}`),
    });
    const revision = this.workbenchRevision(projectId);
    return { ...safeOperationResult(result), projectionId: result.projectionId, projectionKind: result.projectionKind, nextWorkbenchRevision: revision.workbenchRevision, meta: { projectId, ...revision } };
  }

  async createPrunePreview(projectOrId, input = {}) {
    const project = await this.resolveProject(projectOrId);
    const projectId = this.projectId(project);
    if (!projectId) throw makeError("project_missing");
    this.ensureIndexed();
    this.assertExpectedRevision(projectId, input);
    this.validateExpectedThread(projectId, input);
    const result = this.threadStore.createPrunePreview({
      ...input,
      projectId,
      clientOperationId: normalizeString(input.clientOperationId, `workbench_prune_preview_${Date.now()}`),
    });
    const revision = this.workbenchRevision(projectId);
    return { ...safeOperationResult(result), projectionId: result.projectionId, projectionKind: result.projectionKind, nextWorkbenchRevision: revision.workbenchRevision, meta: { projectId, ...revision } };
  }

  async createForkPreview(projectOrId, input = {}) {
    const project = await this.resolveProject(projectOrId);
    const projectId = this.projectId(project);
    if (!projectId) throw makeError("project_missing");
    this.ensureIndexed();
    this.assertExpectedRevision(projectId, input);
    this.validateExpectedThread(projectId, input);
    const result = this.threadStore.createForkPreview({
      ...input,
      projectId,
      clientOperationId: normalizeString(input.clientOperationId, `workbench_fork_preview_${Date.now()}`),
    });
    const revision = this.workbenchRevision(projectId);
    return { ...safeOperationResult(result), projectionId: result.projectionId, projectionKind: result.projectionKind, nextWorkbenchRevision: revision.workbenchRevision, meta: { projectId, ...revision } };
  }

  forkPreviewRecord(projectId, previewId) {
    const preview = this.threadStore.previewProjectionRecord(projectId, previewId);
    const seedItem = preview.items.find((item) => item.itemKind === "fork_seed_metadata") || preview.items[0] || {};
    const sourceKind = normalizeString(seedItem.seed?.sourceKind || preview.projection.source?.sourceKind, "direct_thread");
    return { ...preview, seedItem, sourceKind };
  }

  derivedPreviewRecord(projectId, previewId, sourcePreviewKind) {
    const kind = normalizeString(sourcePreviewKind, "");
    if (kind !== MERGE_PREVIEW_PROJECTION_KIND && kind !== PRUNE_PREVIEW_PROJECTION_KIND) {
      throw makeError(kind === FORK_PREVIEW_PROJECTION_KIND ? "intermediate_fork_preview_not_supported" : "derived_preview_source_kind_unsupported");
    }
    const preview = this.threadStore.previewProjectionRecord(projectId, previewId, kind);
    const sourcePreviewOperationId = normalizeString(this.threadStore.previewOperationIdForProjection(preview.projection.projectionId), "");
    const sourceThreadIds = Array.from(new Set(preview.items.flatMap((item) => Array.isArray(item.sourceRefs)
      ? item.sourceRefs.map((ref) => normalizeString(ref.threadId, "")).filter(Boolean)
      : [])));
    const sourceItemCount = preview.items.filter((item) => item.itemKind !== "merge_preview_section").length;
    return { ...preview, sourcePreviewKind: kind, sourcePreviewOperationId, sourceThreadIds, sourceItemCount };
  }

  async prepareForkStart(projectOrId, input = {}) {
    const project = await this.resolveProject(projectOrId);
    const projectId = this.projectId(project);
    if (!projectId) throw makeError("project_missing");
    this.ensureIndexed();
    this.assertExpectedRevision(projectId, input);
    const sourcePreviewId = normalizeString(input.sourcePreviewId, "");
    const preview = this.forkPreviewRecord(projectId, sourcePreviewId);
    if (preview.projection.status !== "valid" || preview.projection.unsafeForRenderer === true) throw makeError("source_preview_not_valid");
    const expectedDigest = normalizeString(input.expectedSourcePreviewDigest, "");
    if (expectedDigest && expectedDigest !== preview.projection.projectionDigest) throw makeError("source_preview_digest_mismatch");
    if (preview.sourceKind !== "direct_thread") {
      throw makeError(preview.sourceKind === "merge_preview"
        ? "merge_preview_fork_start_deferred"
        : (preview.sourceKind === "prune_preview" ? "prune_preview_fork_start_deferred" : "fork_preview_source_kind_unsupported"));
    }
    const liveText = this.resolveLiveTextController();
    const status = typeof liveText.assertReady === "function"
      ? liveText.assertReady(project)
      : liveText.statusForProject(project);
    if (status.status !== "ready") throw makeError(status.reason || "direct_runtime_not_enabled");
    const model = normalizeString(input.selectedModel, status.model);
    const nowMs = this.now();
    const confirmationId = `fork_start_${crypto.randomBytes(18).toString("base64url")}`;
    const revision = this.workbenchRevision(projectId);
    const sourceItemCount = Number(preview.seedItem.seed?.selectedItemCount || preview.seedItem.sourceStableItemKeys?.length || 0);
    const confirmation = {
      confirmationId,
      projectId,
      projectGeneration: this.projectGeneration(project),
      workbenchRevision: revision.workbenchRevision,
      operationLedgerHeadDigest: revision.operationLedgerHeadDigest,
      sourcePreviewId,
      sourcePreviewDigest: preview.projection.projectionDigest,
      targetRuntime: "direct-experimental/live-text",
      selectedModel: model,
      modelEvidenceRef: normalizeString(status.evidenceId, ""),
      requestShapeEvidenceRef: "direct_fork_start_live_text@1",
      endpointEvidenceRef: "",
      expiresAtMs: nowMs + FORK_START_CONFIRMATION_TTL_MS,
    };
    this.pruneConfirmations(nowMs);
    this.forkStartConfirmations.set(confirmationId, confirmation);
    return {
      confirmationId,
      expiresAt: nowIso(confirmation.expiresAtMs),
      projectGeneration: confirmation.projectGeneration,
      workbenchRevision: confirmation.workbenchRevision,
      operationLedgerHeadDigest: confirmation.operationLedgerHeadDigest,
      sourcePreviewId,
      sourcePreviewDigest: preview.projection.projectionDigest,
      rendererSafeSourceLabel: normalizeString(preview.seedItem.threadId, "Fork preview"),
      targetRuntime: "direct-experimental/live-text",
      selectedModel: model,
      modelEvidenceRef: confirmation.modelEvidenceRef,
      requestShapeEvidenceRef: confirmation.requestShapeEvidenceRef,
      endpointEvidenceRef: confirmation.endpointEvidenceRef,
      sourceSummary: {
        sourceThreadCount: new Set((preview.seedItem.sourceRefs || []).map((ref) => ref.threadId).filter(Boolean)).size,
        sourceItemCount,
        omittedCounts: preview.projection.caps?.omittedCounts || {},
        truncated: preview.projection.caps?.truncated === true,
        seedCaps: { maxItems: 2000, maxTextChars: 128 * 1024 },
      },
      freshSessionOnly: true,
      previousResponseIdUsed: false,
      providerContinuityAvailable: false,
      rawPathExposed: false,
      rawUrlExposed: false,
      contextTextExposed: false,
    };
  }

  async prepareDerivedPreviewForkStart(projectOrId, input = {}) {
    const project = await this.resolveProject(projectOrId);
    const projectId = this.projectId(project);
    if (!projectId) throw makeError("project_missing");
    this.ensureIndexed();
    this.assertExpectedRevision(projectId, input);
    const sourcePreviewId = normalizeString(input.sourcePreviewId, "");
    const sourcePreviewKind = normalizeString(input.sourcePreviewKind, "");
    const preview = this.derivedPreviewRecord(projectId, sourcePreviewId, sourcePreviewKind);
    if (preview.projection.status !== "valid" || preview.projection.unsafeForRenderer === true) throw makeError("source_preview_not_valid");
    const expectedDigest = normalizeString(input.expectedSourcePreviewDigest, "");
    if (expectedDigest && expectedDigest !== preview.projection.projectionDigest) throw makeError("source_preview_digest_mismatch");
    const expectedOperationId = normalizeString(input.expectedSourcePreviewOperationId, "");
    if (expectedOperationId && expectedOperationId !== preview.sourcePreviewOperationId) throw makeError("source_preview_operation_mismatch");
    if (!preview.sourcePreviewOperationId) throw makeError("source_preview_operation_missing");
    const liveText = this.resolveLiveTextController();
    const status = typeof liveText.assertReady === "function"
      ? liveText.assertReady(project)
      : liveText.statusForProject(project);
    if (status.status !== "ready") throw makeError(status.reason || "direct_runtime_not_enabled");
    const model = normalizeString(input.selectedModel, status.model);
    const nowMs = this.now();
    const confirmationId = `derived_fork_start_${crypto.randomBytes(18).toString("base64url")}`;
    const revision = this.workbenchRevision(projectId);
    const confirmation = {
      confirmationId,
      projectId,
      projectGeneration: this.projectGeneration(project),
      workbenchRevision: revision.workbenchRevision,
      operationLedgerHeadDigest: revision.operationLedgerHeadDigest,
      sourcePreviewId,
      sourcePreviewKind,
      sourcePreviewDigest: preview.projection.projectionDigest,
      sourcePreviewOperationId: preview.sourcePreviewOperationId,
      targetRuntime: "direct-experimental/live-text",
      selectedModel: model,
      modelEvidenceRef: normalizeString(status.evidenceId, ""),
      requestShapeEvidenceRef: "direct_derived_preview_fork_start_live_text@1",
      endpointEvidenceRef: "",
      expiresAtMs: nowMs + FORK_START_CONFIRMATION_TTL_MS,
    };
    this.pruneConfirmations(nowMs);
    this.forkStartConfirmations.set(confirmationId, confirmation);
    return {
      confirmationId,
      expiresAt: nowIso(confirmation.expiresAtMs),
      projectGeneration: confirmation.projectGeneration,
      workbenchRevision: confirmation.workbenchRevision,
      operationLedgerHeadDigest: confirmation.operationLedgerHeadDigest,
      sourcePreviewId,
      sourcePreviewKind,
      sourcePreviewDigest: preview.projection.projectionDigest,
      sourcePreviewOperationId: preview.sourcePreviewOperationId,
      rendererSafeSourceLabel: sourcePreviewKind === MERGE_PREVIEW_PROJECTION_KIND ? "Merge preview" : "Prune preview",
      targetRuntime: "direct-experimental/live-text",
      selectedModel: model,
      modelEvidenceRef: confirmation.modelEvidenceRef,
      requestShapeEvidenceRef: confirmation.requestShapeEvidenceRef,
      endpointEvidenceRef: confirmation.endpointEvidenceRef,
      sourceSummary: {
        sourceThreadCount: preview.sourceThreadIds.length,
        sourceItemCount: preview.sourceItemCount,
        omittedCounts: preview.projection.caps?.omittedCounts || {},
        truncated: preview.projection.caps?.truncated === true,
        seedCaps: { maxItems: 2000, maxTextChars: 128 * 1024 },
      },
      warnings: {
        freshSessionOnly: true,
        providerContinuityAvailable: false,
        sourcePreviewIsCanonical: false,
        toolResultsReplayed: false,
      },
      freshSessionOnly: true,
      previousResponseIdUsed: false,
      providerContinuityAvailable: false,
      rawPathExposed: false,
      rawUrlExposed: false,
      contextTextExposed: false,
    };
  }

  requireForkStartConfirmation(projectId, input = {}) {
    const confirmationId = normalizeString(input.confirmationId, "");
    if (!confirmationId) throw makeError("confirmation_required");
    this.pruneConfirmations();
    const confirmation = this.forkStartConfirmations.get(confirmationId);
    if (!confirmation) throw makeError("confirmation_expired");
    if (
      confirmation.projectId !== projectId ||
      confirmation.sourcePreviewId !== normalizeString(input.sourcePreviewId, "") ||
      confirmation.sourcePreviewDigest !== normalizeString(input.expectedSourcePreviewDigest, "") ||
      (normalizeString(input.selectedModel, confirmation.selectedModel) !== confirmation.selectedModel)
    ) {
      throw makeError("confirmation_scope_mismatch");
    }
    this.forkStartConfirmations.delete(confirmationId);
    return confirmation;
  }

  requireDerivedForkStartConfirmation(projectId, input = {}) {
    const confirmationId = normalizeString(input.confirmationId, "");
    if (!confirmationId) throw makeError("confirmation_required");
    this.pruneConfirmations();
    const confirmation = this.forkStartConfirmations.get(confirmationId);
    if (!confirmation) throw makeError("confirmation_expired");
    if (
      confirmation.projectId !== projectId ||
      confirmation.sourcePreviewId !== normalizeString(input.sourcePreviewId, "") ||
      confirmation.sourcePreviewKind !== normalizeString(input.sourcePreviewKind, "") ||
      confirmation.sourcePreviewDigest !== normalizeString(input.expectedSourcePreviewDigest, "") ||
      (normalizeString(input.selectedModel, confirmation.selectedModel) !== confirmation.selectedModel)
    ) {
      throw makeError("confirmation_scope_mismatch");
    }
    this.forkStartConfirmations.delete(confirmationId);
    return confirmation;
  }

  async startForkFromPreview(projectOrId, input = {}) {
    const project = await this.resolveProject(projectOrId);
    const projectId = this.projectId(project);
    if (!projectId) throw makeError("project_missing");
    this.ensureIndexed();
    this.assertExpectedRevision(projectId, input);
    const confirmation = this.requireForkStartConfirmation(projectId, input);
    const liveText = this.resolveLiveTextController();
    const result = await liveText.startForkFromPreview({
      ...input,
      project,
      sourcePreviewId: confirmation.sourcePreviewId,
      expectedSourcePreviewDigest: confirmation.sourcePreviewDigest,
      selectedModel: confirmation.selectedModel,
      modelEvidenceRef: confirmation.modelEvidenceRef,
      requestShapeEvidenceRef: confirmation.requestShapeEvidenceRef,
      endpointEvidenceRef: confirmation.endpointEvidenceRef,
    });
    const revision = this.workbenchRevision(projectId);
    return {
      ...result,
      openedInLeftCodexSurface: false,
      nextWorkbenchRevision: revision.workbenchRevision,
      meta: { projectId, projectGeneration: this.projectGeneration(project), ...revision },
    };
  }

  async startForkFromDerivedPreview(projectOrId, input = {}) {
    const project = await this.resolveProject(projectOrId);
    const projectId = this.projectId(project);
    if (!projectId) throw makeError("project_missing");
    this.ensureIndexed();
    this.assertExpectedRevision(projectId, input);
    const confirmation = this.requireDerivedForkStartConfirmation(projectId, input);
    const liveText = this.resolveLiveTextController();
    const result = await liveText.startForkFromDerivedPreview({
      ...input,
      project,
      sourcePreviewId: confirmation.sourcePreviewId,
      sourcePreviewKind: confirmation.sourcePreviewKind,
      sourcePreviewOperationId: confirmation.sourcePreviewOperationId,
      expectedSourcePreviewOperationId: confirmation.sourcePreviewOperationId,
      expectedSourcePreviewDigest: confirmation.sourcePreviewDigest,
      selectedModel: confirmation.selectedModel,
      modelEvidenceRef: confirmation.modelEvidenceRef,
      requestShapeEvidenceRef: confirmation.requestShapeEvidenceRef,
      endpointEvidenceRef: confirmation.endpointEvidenceRef,
    });
    const revision = this.workbenchRevision(projectId);
    return {
      ...result,
      openedInLeftCodexSurface: false,
      nextWorkbenchRevision: revision.workbenchRevision,
      meta: { projectId, projectGeneration: this.projectGeneration(project), ...revision },
    };
  }

  async readForkStartStatus(projectOrId, forkStartId) {
    const project = await this.resolveProject(projectOrId);
    const projectId = this.projectId(project);
    const safeForkStartId = normalizeString(forkStartId, "");
    const operation = this.threadStore.db.prepare(`
      select *
      from direct_operations
      where project_id = ? and operation_type = 'start_fork_turn'
      order by requested_at desc
      limit 100
    `).all(projectId).map((row) => this.threadStore.operationResult(row))
      .find((entry) => normalizeString(entry?.result?.forkStartId, "") === safeForkStartId);
    if (!operation) throw makeError("fork_start_not_found");
    let turnState = "";
    try {
      turnState = normalizeString(this.sessionStore?.readTurn?.(
        normalizeString(operation.result?.createdSessionId, ""),
        normalizeString(operation.result?.createdTurnId, ""),
      )?.state, "");
    } catch {}
    return {
      forkStartId: safeForkStartId,
      operationId: operation.operationId,
      projectId,
      threadId: normalizeString(operation.result?.createdThreadId, ""),
      sessionId: normalizeString(operation.result?.createdSessionId, ""),
      turnId: normalizeString(operation.result?.createdTurnId, ""),
      status: turnState || normalizeString(operation.result?.forkStatus, operation.status),
      rendererSafeMessage: "Fork operation committed; provider turn status is tracked on the created turn.",
      lineage: {
        sourcePreviewId: normalizeString(operation.target?.previewId, ""),
        sourceThreadCount: 0,
        sourceItemCount: 0,
        freshSessionOnly: true,
        previousResponseIdUsed: false,
        providerContinuityHandleUsed: false,
      },
      artifacts: {
        forkSeedStored: true,
        contextPackStored: true,
        requestManifestStored: true,
        contextTextExposed: false,
        requestBodyExposed: false,
      },
      rawPathExposed: false,
      rawUrlExposed: false,
      rawCredentialsExposed: false,
      rawBackendFrameExposed: false,
    };
  }

  async rebuildLifecycleProjection(projectOrId, input = {}) {
    const project = await this.resolveProject(projectOrId);
    const projectId = this.projectId(project);
    if (!projectId) throw makeError("project_missing");
    this.ensureIndexed();
    this.assertExpectedRevision(projectId, input);
    const result = this.threadStore.buildThreadLifecycleProjection(projectId, { force: true });
    return { result, meta: { projectId, ...this.workbenchRevision(projectId) } };
  }

  async rebuildGraphProjection(projectOrId, input = {}) {
    const project = await this.resolveProject(projectOrId);
    const projectId = this.projectId(project);
    if (!projectId) throw makeError("project_missing");
    this.ensureIndexed();
    this.assertExpectedRevision(projectId, input);
    const result = this.threadStore.buildThreadGraphProjection(projectId, { force: true });
    return { result, meta: { projectId, ...this.workbenchRevision(projectId) } };
  }

  async rebuildRendererTranscriptProjection(projectOrId, threadId, input = {}) {
    const project = await this.resolveProject(projectOrId);
    const projectId = this.projectId(project);
    if (!projectId) throw makeError("project_missing");
    this.ensureIndexed();
    this.assertExpectedRevision(projectId, input);
    this.validateExpectedThread(projectId, { ...input, threadId });
    const result = this.threadStore.buildRendererTranscriptProjection(threadId, { force: true, sessionStore: this.sessionStore });
    return { result, meta: { projectId, ...this.workbenchRevision(projectId) } };
  }
}

module.exports = {
  DIRECT_THREAD_WORKBENCH_CONTROLLER_VERSION,
  DIRECT_THREAD_WORKBENCH_SNAPSHOT_SCHEMA,
  DirectThreadWorkbenchController,
};
