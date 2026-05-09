"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const {
  DIRECT_SESSION_SCHEMA,
  DIRECT_TURN_SCHEMA,
  writeJsonAtomic,
} = require("../session/session-store");
const {
  COMPACT_TRANSCRIPT_PROJECTION_KIND,
  RENDERER_TRANSCRIPT_PROJECTION_KIND,
  buildCompactTranscriptProjection,
  buildRendererTranscriptProjection,
} = require("./renderer-transcript-projection");
const {
  CONTEXT_RECENT_DIALOGUE_PROJECTION_KIND,
  DIRECT_IMPORT_CHECKPOINT_CONTINUATION_POLICY_ID,
  DIRECT_READONLY_TOOL_CONTINUATION_POLICY_ID,
  DIRECT_TEXT_TURN_EMPTY_CONTEXT_POLICY_ID,
  DIRECT_TEXT_TURN_RECENT_DIALOGUE_POLICY_ID,
  buildContextPack,
  buildContextRecentDialogueProjection,
  buildRequestManifest,
  policySnapshot,
  rendererSafeContextSummary,
} = require("./context-pack");
const {
  DIRECT_OBLIGATIONS_PROJECTION_KIND,
  TOOL_CONTINUATION_CONTEXT_PROJECTION_KIND,
  TOOL_CONTINUATION_CONTEXT_POLICY_ID,
  buildDirectObligationsProjection,
  buildToolContinuationContextProjection,
} = require("./obligation-projection");

const DIRECT_THREAD_STORE_STATUS_SCHEMA = "direct_thread_store_status@1";
const DIRECT_THREAD_OPERATION_EVENT_SCHEMA = "direct_thread_operation_event@1";
const DIRECT_THREAD_OPERATION_LEDGER_MANIFEST_SCHEMA = "direct_thread_operation_ledger_manifest@1";
const DIRECT_ROLLOUT_MANIFEST_SCHEMA = "direct_rollout_manifest@1";
const THREAD_LIFECYCLE_PROJECTION_KIND = "thread_lifecycle";
const THREAD_GRAPH_PROJECTION_KIND = "thread_graph";
const MERGE_PREVIEW_PROJECTION_KIND = "merge_preview";
const PRUNE_PREVIEW_PROJECTION_KIND = "prune_preview";
const FORK_PREVIEW_PROJECTION_KIND = "fork_preview";
const BRIDGE_SUMMARY_PROJECTION_KIND = "bridge_summary";
const THREAD_LIFECYCLE_PROJECTION_VERSION = "thread_lifecycle@1";
const THREAD_GRAPH_PROJECTION_VERSION = "thread_graph@1";
const MERGE_PREVIEW_PROJECTION_VERSION = "merge_preview@1";
const PRUNE_PREVIEW_PROJECTION_VERSION = "prune_preview@1";
const FORK_PREVIEW_PROJECTION_VERSION = "fork_preview@1";
const BRIDGE_SUMMARY_PROJECTION_VERSION = "bridge_summary@1";
const DIRECT_THREAD_CONTROL_BUILDER_VERSION = "direct_thread_control_builder@1";
const MAX_PREVIEW_ITEMS = 2000;
const MAX_PREVIEW_TEXT_CHARS_PER_ITEM = 16_000;
const MAX_PREVIEW_TOTAL_TEXT_CHARS = 1_000_000;
const MAX_PREVIEW_SOURCE_THREADS = 16;
const MAX_PREVIEW_OMISSION_MARKERS = 1000;
const ACTIVE_DIRECT_TURN_STATES = new Set([
  "created",
  "request_built",
  "streaming",
  "tool_waiting",
  "authority_waiting",
  "continuation_ready",
  "streaming_continuation",
]);
const LIFECYCLE_STATES = new Set(["active", "hidden", "archived", "soft_deleted"]);
const LINEAGE_EDGE_KINDS = new Set(["derived_from", "merge_preview_of", "prune_preview_of", "fork_preview_of", "supersedes"]);
const PREVIEW_PROJECTION_KINDS = new Set([MERGE_PREVIEW_PROJECTION_KIND, PRUNE_PREVIEW_PROJECTION_KIND, FORK_PREVIEW_PROJECTION_KIND]);
const GRAPH_EDGE_KINDS = new Set([
  "related",
  "blocks",
  "supersedes",
  "derived_from",
  "merge_preview_of",
  "prune_preview_of",
  "fork_preview_of",
  "chatgpt_reference",
  "import_source_reference",
]);
const DIRECT_THREAD_STORE_SCHEMA_VERSION = 1;
const DIRECT_THREAD_STORE_MODES = new Set([
  "disabled",
  "index_only",
  "dual_write_shadow",
  "projection_read",
  "context_build_required",
]);
const DIRECT_THREAD_OPERATION_TYPES = new Set([
  "archive_thread",
  "restore_thread",
  "hide_thread",
  "unhide_thread",
  "soft_delete_thread",
  "restore_soft_deleted_thread",
  "purge_thread",
  "merge_threads",
  "prune_thread",
  "fork_thread",
  "bridge_threads",
  "unlink_bridge",
  "preview_merge_threads",
  "preview_prune_thread",
  "preview_fork_thread",
  "materialize_projection_thread",
  "rebuild_projection",
  "repair_index",
]);
const DIRECT_THREAD_OPERATION_EVENT_TYPES = new Set([
  "operation_planned",
  "operation_confirmed",
  "operation_committed",
  "operation_failed",
  "operation_rolled_back",
  "operation_repaired",
]);
const DIRECT_THREAD_COUNT_TABLES = new Set([
  "direct_context_builds",
  "direct_context_policies",
  "direct_operations",
  "direct_projections",
  "direct_request_manifests",
  "direct_rollouts",
  "direct_threads",
  "direct_turns",
]);
const DIRECT_PROJECTION_KINDS = new Set([
  RENDERER_TRANSCRIPT_PROJECTION_KIND,
  COMPACT_TRANSCRIPT_PROJECTION_KIND,
  CONTEXT_RECENT_DIALOGUE_PROJECTION_KIND,
  DIRECT_OBLIGATIONS_PROJECTION_KIND,
  TOOL_CONTINUATION_CONTEXT_PROJECTION_KIND,
  THREAD_LIFECYCLE_PROJECTION_KIND,
  THREAD_GRAPH_PROJECTION_KIND,
  MERGE_PREVIEW_PROJECTION_KIND,
  PRUNE_PREVIEW_PROJECTION_KIND,
  FORK_PREVIEW_PROJECTION_KIND,
  BRIDGE_SUMMARY_PROJECTION_KIND,
]);
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,160}$/;

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function optionalString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function preserveString(value) {
  return typeof value === "string" ? value : "";
}

function normalizeNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeLifecycleState(value, fallback = "active") {
  const state = normalizeString(value, fallback);
  return LIFECYCLE_STATES.has(state) ? state : fallback;
}

function nowIso(nowMs = Date.now()) {
  return new Date(Number(nowMs) || Date.now()).toISOString();
}

function isSafeId(value) {
  return SAFE_ID_PATTERN.test(normalizeString(value, ""));
}

function requireSafeId(value, label) {
  const text = normalizeString(value, "");
  if (isSafeId(text)) return text;
  throw new Error(`Invalid ${label} id.`);
}

function safeStorageKey(value, prefix = "id") {
  const text = normalizeString(value, "");
  if (isSafeId(text)) return text;
  return `${prefix}_${sha256(text).slice(0, 24)}`;
}

function safeIdSuffix(value, max = 48) {
  return String(value || "id").replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, max) || "id";
}

function newId(prefix) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 18)}`;
}

function normalizeStoreMode(value) {
  const mode = normalizeString(value, "index_only");
  return DIRECT_THREAD_STORE_MODES.has(mode) ? mode : "index_only";
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (isPlainObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function operationInputDigest(value) {
  return sha256(stableStringify(value));
}

function rendererSafeOperationSummary(effectKind, targetId) {
  return `${normalizeString(effectKind, "operation_effect")}:${normalizeString(targetId, "target")}`;
}

function truncatePreviewText(value, maxChars = MAX_PREVIEW_TEXT_CHARS_PER_ITEM) {
  const text = preserveString(value);
  if (text.length <= maxChars) return { text, truncated: false, omittedChars: 0 };
  return {
    text: text.slice(0, maxChars),
    truncated: true,
    omittedChars: text.length - maxChars,
  };
}

function escapedSqlLike(value) {
  return String(value || "").toLowerCase().replace(/[\\%_]/g, (match) => `\\${match}`);
}

function threadRowDigest(row = {}) {
  return sha256(stableStringify({
    threadId: normalizeString(row.thread_id || row.threadId, ""),
    projectId: normalizeString(row.project_id || row.projectId, ""),
    lifecycleState: normalizeString(row.lifecycle_state || row.lifecycleState, ""),
    updatedAt: normalizeString(row.updated_at || row.updatedAt, ""),
    hiddenAt: normalizeString(row.hidden_at || row.hiddenAt, ""),
    archivedAt: normalizeString(row.archived_at || row.archivedAt, ""),
    deletedAt: normalizeString(row.deleted_at || row.deletedAt, ""),
  }));
}

function noRawExposureFlags() {
  return {
    rawPathExposed: false,
    rawCredentialsExposed: false,
    rawBackendFrameExposed: false,
    rawRequestBodyExposed: false,
    rawImportedJsonlExposed: false,
    rawChatGptContentExposed: false,
  };
}

function fileSha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    if (error && error.code === "ENOENT") return null;
    throw error;
  }
}

function ensureDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true });
}

function countRows(db, tableName) {
  if (!DIRECT_THREAD_COUNT_TABLES.has(tableName)) throw new Error(`Invalid direct thread store table: ${tableName}`);
  const row = db.prepare(`select count(*) as count from ${tableName}`).get();
  return Number(row?.count || 0);
}

function columnExists(db, tableName, columnName) {
  return db.prepare(`pragma table_info(${tableName})`).all().some((row) => row.name === columnName);
}

function addColumnIfMissing(db, tableName, columnDefinition) {
  const columnName = String(columnDefinition).trim().split(/\s+/)[0];
  if (columnExists(db, tableName, columnName)) return;
  db.exec(`alter table ${tableName} add column ${columnDefinition};`);
}

function sourceClassForSession(session = {}) {
  const sourceClass = normalizeString(session.sourceClass, "");
  if (sourceClass) return sourceClass;
  if (session.importedSessionReadOnly === true) return "imported-readonly";
  if (session.nativeDirectSession === true && session.parentImportLineage) return "import-checkpoint-continuation";
  if (session.nativeDirectSession === true) return "direct-native";
  return "direct-native";
}

function continuityStateForSession(session = {}, sourceClass = sourceClassForSession(session)) {
  if (session.providerContinuityAvailable === true) return "provider_continuity_available";
  if (["imported-readonly", "derived-projection", "merged-projection"].includes(sourceClass)) return "non_runnable_projection";
  if (sourceClass === "import-checkpoint-continuation" || sourceClass === "forked-direct-native" || sourceClass === "direct-native") {
    return "fresh_session_only";
  }
  return "unknown";
}

function composerEnabledForSession(session = {}, sourceClass = sourceClassForSession(session)) {
  if (isPlainObject(session.composer)) return session.composer.enabled === true;
  if (sourceClass === "imported-readonly" || sourceClass === "derived-projection" || sourceClass === "merged-projection") return false;
  return session.nativeDirectSession === true;
}

class DirectThreadStore {
  constructor(options = {}) {
    const rootDir = normalizeString(options.rootDir, "");
    const dbPath = normalizeString(options.dbPath, "");
    if (!rootDir && !dbPath) throw new Error("DirectThreadStore requires rootDir or dbPath.");
    this.rootDir = rootDir ? path.resolve(rootDir) : path.dirname(path.resolve(dbPath));
    this.dbPath = dbPath ? path.resolve(dbPath) : path.join(this.rootDir, "direct-thread-store.sqlite");
    this.mode = normalizeStoreMode(options.mode);
    this.projectionBuildLocks = new Set();
    ensureDirectory(this.rootDir);
    this.db = this.openDatabase();
    this.migrate();
  }

  operationLedgerDir() {
    return path.join(this.rootDir, "control-ledger");
  }

  operationLedgerPath() {
    return path.join(this.operationLedgerDir(), "operations.jsonl");
  }

  operationLedgerManifestPath() {
    return path.join(this.operationLedgerDir(), "operations.manifest.json");
  }

  rolloutManifestPath(projectId, threadId, rolloutId) {
    return path.join(
      this.rootDir,
      "rollouts",
      safeStorageKey(projectId, "project"),
      safeStorageKey(threadId, "thread"),
      `${requireSafeId(rolloutId, "rollout")}.manifest.json`,
    );
  }

  contextPackPath(projectId, threadId, contextBuildId) {
    return path.join(
      this.rootDir,
      "context-packs",
      safeStorageKey(projectId, "project"),
      safeStorageKey(threadId, "thread"),
      `${requireSafeId(contextBuildId, "context build")}.json`,
    );
  }

  requestManifestPath(projectId, threadId, requestManifestId) {
    return path.join(
      this.rootDir,
      "request-manifests",
      safeStorageKey(projectId, "project"),
      safeStorageKey(threadId, "thread"),
      `${requireSafeId(requestManifestId, "request manifest")}.json`,
    );
  }

  openDatabase() {
    let DatabaseSync = null;
    try {
      ({ DatabaseSync } = require("node:sqlite"));
    } catch (error) {
      const reason = error && error.message ? ` ${error.message}` : "";
      throw new Error(`Direct thread store requires runtime SQLite support (node:sqlite).${reason}`.trim());
    }
    const db = new DatabaseSync(this.dbPath);
    db.exec("pragma journal_mode = wal;");
    db.exec("pragma foreign_keys = on;");
    db.exec("pragma busy_timeout = 5000;");
    db.exec("pragma synchronous = normal;");
    return db;
  }

  close() {
    if (!this.db) return;
    this.db.close();
    this.db = null;
  }

  migrate() {
    this.transaction(() => {
      this.db.exec(`
      create table if not exists direct_store_meta (
        key text primary key,
        value_json text not null,
        updated_at text not null
      );

      create table if not exists direct_rollouts (
        rollout_id text primary key,
        project_id text not null,
        thread_id text not null,
        rollout_path_private text not null,
        rollout_display_name text not null,
        event_count integer not null,
        first_event_at text,
        last_event_at text,
        file_size_bytes integer not null,
        file_sha256 text not null,
        manifest_digest text not null,
        recovery_state text not null,
        created_at text not null,
        updated_at text not null,
        unique(project_id, thread_id, rollout_id)
      );

      create table if not exists direct_threads (
        thread_id text primary key,
        project_id text not null,
        title text not null,
        source_class text not null,
        native_direct_session integer not null default 0,
        provider_continuity_available integer not null default 0,
        composer_enabled integer not null default 0,
        continuity_state text not null default 'unknown',
        lifecycle_state text not null,
        current_rollout_id text,
        current_projection_id text,
        current_renderer_projection_id text,
        current_compact_projection_id text,
        current_context_recent_dialogue_projection_id text,
        current_direct_obligations_projection_id text,
        current_tool_continuation_context_projection_id text,
        last_renderer_projection_attempt_id text,
        last_compact_projection_attempt_id text,
        last_context_recent_dialogue_projection_attempt_id text,
        last_direct_obligations_projection_attempt_id text,
        last_tool_continuation_context_projection_attempt_id text,
        created_at text not null,
        updated_at text not null,
        archived_at text,
        hidden_at text,
        deleted_at text,
        purge_state text not null default 'not_requested',
        unique(project_id, thread_id),
        foreign key(current_rollout_id) references direct_rollouts(rollout_id)
      );

      create table if not exists direct_turns (
        turn_id text primary key,
        thread_id text not null,
        project_id text not null,
        rollout_id text not null,
        turn_ordinal integer not null,
        state text not null,
        stream_phase text,
        started_at text,
        completed_at text,
        model text,
        request_shape_hash text,
        context_build_id text,
        request_manifest_id text,
        source_event_start_seq integer,
        source_event_end_seq integer,
        unique(thread_id, turn_ordinal),
        foreign key(thread_id) references direct_threads(thread_id),
        foreign key(rollout_id) references direct_rollouts(rollout_id)
      );

      create table if not exists direct_items (
        item_id text primary key,
        turn_id text not null,
        thread_id text not null,
        project_id text not null,
        item_ordinal integer not null,
        item_kind text not null,
        role text,
        status text not null,
        source_event_start_seq integer,
        source_event_end_seq integer,
        content_digest text,
        text_preview text,
        renderer_safe integer not null default 0,
        unique(turn_id, item_ordinal),
        foreign key(turn_id) references direct_turns(turn_id)
      );

      create table if not exists direct_obligations (
        obligation_id text primary key,
        turn_id text not null,
        thread_id text not null,
        project_id text not null,
        obligation_kind text not null,
        provider_call_type text,
        tool_name text,
        status text not null,
        authority_state text not null,
        side_effect_executed integer not null default 0,
        continuation_sent integer not null default 0,
        source_item_id text,
        result_digest text,
        updated_at text not null,
        foreign key(turn_id) references direct_turns(turn_id)
      );

      create table if not exists direct_operations (
        operation_id text primary key,
        project_id text not null,
        operation_type text not null,
        client_operation_id text,
        status text not null,
        requested_at text not null,
        committed_at text,
        operation_digest text not null,
        ledger_offset integer,
        target_json text not null,
        result_json text not null
      );

      create unique index if not exists idx_direct_operations_client_operation
        on direct_operations(project_id, client_operation_id)
        where client_operation_id is not null;

      create table if not exists direct_operation_effects (
        operation_id text not null,
        effect_ordinal integer not null,
        effect_kind text not null,
        target_kind text not null,
        target_id text not null,
        before_digest text,
        after_digest text,
        created_at text not null,
        primary key (operation_id, effect_ordinal),
        foreign key(operation_id) references direct_operations(operation_id)
      );

      create table if not exists direct_thread_edges (
        edge_id text primary key,
        project_id text not null,
        edge_kind text not null,
        source_kind text not null,
        source_id text not null,
        target_kind text not null,
        target_id text not null,
        operation_id text,
        status text not null,
        created_at text not null,
        metadata_json text not null,
        foreign key(operation_id) references direct_operations(operation_id)
      );

      create table if not exists direct_external_refs (
        external_ref_id text primary key,
        project_id text not null,
        ref_kind text not null,
        display_title text not null,
        renderer_safe_url_hash text,
        target_id text,
        metadata_json text not null,
        created_at text not null
      );

      create table if not exists direct_projections (
        projection_id text primary key,
        project_id text not null,
        thread_id text,
        projection_kind text not null,
        projection_version text not null,
        builder_version text not null,
        policy_id text,
        status text not null,
        source_json text not null,
        projection_digest text not null,
        created_at text not null,
        superseded_by_projection_id text,
        unsafe_for_context_build integer not null default 0,
        unsafe_for_renderer integer not null default 0,
        foreign key(thread_id) references direct_threads(thread_id)
      );

      create table if not exists direct_projection_items (
        projection_id text not null,
        ordinal integer not null,
        item_id text,
        stable_source_item_key text,
        thread_id text,
        turn_id text,
        rollout_id text,
        session_id text,
        source_artifact_kind text,
        source_event_start_seq integer,
        source_event_end_seq integer,
        source_digest text,
        item_kind text not null,
        source_ref_json text not null,
        text_value text,
        payload_json text,
        content_digest text not null,
        primary key (projection_id, ordinal),
        foreign key(projection_id) references direct_projections(projection_id)
      );

      create table if not exists direct_thread_current_projections (
        thread_id text not null,
        projection_kind text not null,
        projection_id text not null,
        last_attempt_projection_id text,
        updated_at text not null,
        primary key (thread_id, projection_kind),
        foreign key(thread_id) references direct_threads(thread_id),
        foreign key(projection_id) references direct_projections(projection_id)
      );

      create table if not exists direct_project_current_projections (
        project_id text not null,
        projection_kind text not null,
        projection_id text,
        last_attempt_projection_id text,
        updated_at text not null,
        primary key (project_id, projection_kind),
        foreign key(projection_id) references direct_projections(projection_id)
      );

      create table if not exists direct_preview_attempts (
        preview_attempt_id text primary key,
        project_id text not null,
        projection_kind text not null,
        projection_id text,
        operation_id text not null,
        status text not null,
        created_at text not null
      );

      create table if not exists direct_context_policies (
        policy_id text primary key,
        policy_version text not null,
        purpose text not null,
        status text not null,
        definition_json text not null,
        created_at text not null
      );

      create table if not exists direct_context_builds (
        context_build_id text primary key,
        project_id text not null,
        thread_id text not null,
        turn_id text,
        policy_id text not null,
        policy_version text not null,
        purpose text not null,
        context_pack_path_private text not null,
        shape_hash text not null,
        content_hash text not null,
        source_json text not null,
        built_at text not null,
        foreign key(thread_id) references direct_threads(thread_id)
      );

      create table if not exists direct_request_manifests (
        request_manifest_id text primary key,
        project_id text not null,
        thread_id text not null,
        turn_id text not null,
        context_build_id text not null,
        runtime_mode text not null,
        transport text not null,
        model text not null,
        model_evidence_ref text not null,
        request_shape_hash text not null,
        request_manifest_path_private text,
        request_shape_evidence_ref text,
        endpoint_evidence_ref text,
        role_mapping_digest text,
        provider_input_shape_hash text,
        provider_input_text_hash text,
        endpoint_class text not null,
        endpoint_hash text not null,
        enabled_features_json text not null,
        continuity_json text,
        capability_evidence_json text,
        request_body_storage_audit_json text,
        raw_auth_exposed integer not null default 0,
        raw_request_body_stored integer not null default 0,
        built_at text not null,
        foreign key(thread_id) references direct_threads(thread_id),
        foreign key(turn_id) references direct_turns(turn_id),
        foreign key(context_build_id) references direct_context_builds(context_build_id)
      );

      create table if not exists direct_compaction_checkpoints (
        checkpoint_id text primary key,
        project_id text not null,
        thread_id text not null,
        projection_id text,
        context_build_id text,
        status text not null,
        source_json text not null,
        summary_digest text not null,
        created_at text not null,
        foreign key(thread_id) references direct_threads(thread_id)
      );

      create table if not exists direct_deletion_plans (
        deletion_plan_id text primary key,
        project_id text not null,
        operation_id text not null,
        status text not null,
        targets_json text not null,
        safety_json text not null,
        created_at text not null,
        committed_at text,
        foreign key(operation_id) references direct_operations(operation_id)
      );

      create index if not exists idx_direct_threads_project_updated
        on direct_threads(project_id, updated_at desc);
      create index if not exists idx_direct_turns_thread_ordinal
        on direct_turns(thread_id, turn_ordinal);
      create index if not exists idx_direct_items_turn_ordinal
        on direct_items(thread_id, turn_id, item_ordinal);
      create index if not exists idx_direct_obligations_project_status
        on direct_obligations(project_id, status);
      create index if not exists idx_direct_operations_project_requested
        on direct_operations(project_id, requested_at desc);
      create index if not exists idx_direct_operation_effects_operation
        on direct_operation_effects(operation_id, effect_ordinal);
      create index if not exists idx_direct_thread_edges_source
        on direct_thread_edges(project_id, edge_kind, source_kind, source_id);
      create index if not exists idx_direct_external_refs_kind
        on direct_external_refs(project_id, ref_kind);
      create index if not exists idx_direct_projections_kind
        on direct_projections(project_id, projection_kind, status);
      create index if not exists idx_direct_projection_items_source_key
        on direct_projection_items(projection_id, stable_source_item_key);
      create index if not exists idx_direct_context_builds_thread
        on direct_context_builds(project_id, thread_id, built_at desc);
      create unique index if not exists idx_direct_thread_edges_active_unique
        on direct_thread_edges(project_id, edge_kind, source_kind, source_id, target_kind, target_id)
        where status = 'active';
      create index if not exists idx_direct_project_current_projections
        on direct_project_current_projections(project_id, projection_kind);
    `);
      addColumnIfMissing(this.db, "direct_threads", "current_renderer_projection_id text");
      addColumnIfMissing(this.db, "direct_threads", "current_compact_projection_id text");
      addColumnIfMissing(this.db, "direct_threads", "current_context_recent_dialogue_projection_id text");
      addColumnIfMissing(this.db, "direct_threads", "current_direct_obligations_projection_id text");
      addColumnIfMissing(this.db, "direct_threads", "current_tool_continuation_context_projection_id text");
      addColumnIfMissing(this.db, "direct_threads", "last_renderer_projection_attempt_id text");
      addColumnIfMissing(this.db, "direct_threads", "last_compact_projection_attempt_id text");
      addColumnIfMissing(this.db, "direct_threads", "last_context_recent_dialogue_projection_attempt_id text");
      addColumnIfMissing(this.db, "direct_threads", "last_direct_obligations_projection_attempt_id text");
      addColumnIfMissing(this.db, "direct_threads", "last_tool_continuation_context_projection_attempt_id text");
      addColumnIfMissing(this.db, "direct_turns", "request_manifest_id text");
      addColumnIfMissing(this.db, "direct_request_manifests", "request_manifest_path_private text");
      addColumnIfMissing(this.db, "direct_request_manifests", "request_shape_evidence_ref text");
      addColumnIfMissing(this.db, "direct_request_manifests", "endpoint_evidence_ref text");
      addColumnIfMissing(this.db, "direct_request_manifests", "role_mapping_digest text");
      addColumnIfMissing(this.db, "direct_request_manifests", "provider_input_shape_hash text");
      addColumnIfMissing(this.db, "direct_request_manifests", "provider_input_text_hash text");
      addColumnIfMissing(this.db, "direct_request_manifests", "continuity_json text");
      addColumnIfMissing(this.db, "direct_request_manifests", "capability_evidence_json text");
      addColumnIfMissing(this.db, "direct_request_manifests", "request_body_storage_audit_json text");
      addColumnIfMissing(this.db, "direct_projection_items", "item_id text");
      addColumnIfMissing(this.db, "direct_projection_items", "stable_source_item_key text");
      addColumnIfMissing(this.db, "direct_projection_items", "thread_id text");
      addColumnIfMissing(this.db, "direct_projection_items", "turn_id text");
      addColumnIfMissing(this.db, "direct_projection_items", "rollout_id text");
      addColumnIfMissing(this.db, "direct_projection_items", "session_id text");
      addColumnIfMissing(this.db, "direct_projection_items", "source_artifact_kind text");
      addColumnIfMissing(this.db, "direct_projection_items", "source_event_start_seq integer");
      addColumnIfMissing(this.db, "direct_projection_items", "source_event_end_seq integer");
      addColumnIfMissing(this.db, "direct_projection_items", "source_digest text");
      addColumnIfMissing(this.db, "direct_projection_items", "payload_json text");
      addColumnIfMissing(this.db, "direct_projection_items", "content_digest text not null default ''");
      addColumnIfMissing(this.db, "direct_thread_edges", "edge_state text not null default 'active'");
      addColumnIfMissing(this.db, "direct_thread_edges", "created_by_operation_id text");
      addColumnIfMissing(this.db, "direct_thread_edges", "removed_by_operation_id text");
      addColumnIfMissing(this.db, "direct_thread_edges", "updated_at text");
      addColumnIfMissing(this.db, "direct_operation_effects", "renderer_safe_summary text not null default ''");
      this.writeMeta("schema", {
        schemaVersion: DIRECT_THREAD_STORE_SCHEMA_VERSION,
        mode: this.mode,
      });
      this.db.exec(`pragma user_version = ${DIRECT_THREAD_STORE_SCHEMA_VERSION};`);
    });
  }

  writeMeta(key, value, nowMs = Date.now()) {
    this.db.prepare(`
      insert into direct_store_meta (key, value_json, updated_at)
      values (?, ?, ?)
      on conflict(key) do update set
        value_json = excluded.value_json,
        updated_at = excluded.updated_at
    `).run(String(key), JSON.stringify(value), nowIso(nowMs));
  }

  transaction(callback) {
    this.db.exec("begin immediate;");
    try {
      const result = callback();
      this.db.exec("commit;");
      return result;
    } catch (error) {
      try {
        this.db.exec("rollback;");
      } catch {}
      throw error;
    }
  }

  status() {
    return {
      schema: DIRECT_THREAD_STORE_STATUS_SCHEMA,
      available: true,
      status: "healthy",
      mode: this.mode,
      schemaVersion: String(DIRECT_THREAD_STORE_SCHEMA_VERSION),
      rootExposed: false,
      dbPathExposed: false,
      projectionsHealthy: true,
      contextBuildsAllowed: this.mode !== "disabled",
      threadCount: countRows(this.db, "direct_threads"),
      rolloutCount: countRows(this.db, "direct_rollouts"),
      turnCount: countRows(this.db, "direct_turns"),
      operationCount: countRows(this.db, "direct_operations"),
      projectionCount: countRows(this.db, "direct_projections"),
      contextBuildCount: countRows(this.db, "direct_context_builds"),
      requestManifestCount: countRows(this.db, "direct_request_manifests"),
      contextPolicyCount: countRows(this.db, "direct_context_policies"),
      context: {
        contextBuildsAllowed: this.mode !== "disabled",
        contextBuildRequiredForNewTurns: this.mode === "context_build_required",
        reasonIfBlocked: "",
      },
      recovery: {
        lastIndexedAt: this.readMeta("last_indexed_at"),
        corruptManifestCount: 0,
        missingArtifactCount: 0,
      },
    };
  }

  readMeta(key) {
    const row = this.db.prepare("select value_json from direct_store_meta where key = ?").get(String(key));
    if (!row) return "";
    try {
      return JSON.parse(row.value_json);
    } catch {
      return "";
    }
  }

  buildCompatRolloutManifest(sessionStore, session, turns = [], options = {}) {
    const projectId = normalizeString(session.projectId, "unknown_project");
    const threadId = requireSafeId(session.sessionId, "thread");
    const rolloutId = requireSafeId(`rollout_${session.sessionId}`, "rollout");
    const sessionPath = sessionStore.sessionPath(session.sessionId);
    const stat = fs.statSync(sessionPath);
    const eventCount = turns.reduce((count, turn) => count + normalizeNumber(turn.normalizedEventCount, 0), 0);
    const firstEventAt = turns.map((turn) => normalizeString(turn.createdAt, "")).filter(Boolean).sort()[0] || normalizeString(session.createdAt, "");
    const lastEventAt = turns.map((turn) => normalizeString(turn.updatedAt || turn.completedAt, "")).filter(Boolean).sort().at(-1) || normalizeString(session.updatedAt, "");
    const manifestBase = {
      schema: DIRECT_ROLLOUT_MANIFEST_SCHEMA,
      rolloutId,
      projectId,
      threadId,
      eventCount,
      firstSeq: eventCount > 0 ? 1 : 0,
      lastSeq: eventCount,
      firstEventAt,
      lastEventAt,
      fileSizeBytes: stat.size,
      fileSha256: fileSha256(sessionPath),
      hashChainHead: sha256(stableStringify({
        sessionId: session.sessionId,
        updatedAt: session.updatedAt,
        turnIds: turns.map((turn) => turn.turnId),
        eventCount,
      })),
      hashAlgorithm: "sha256",
      finalized: false,
      updatedAt: nowIso(options.nowMs),
    };
    return {
      ...manifestBase,
      manifestDigest: sha256(stableStringify(manifestBase)),
      rolloutPathPrivate: sessionPath,
      rolloutDisplayName: `${normalizeString(session.title, session.sessionId)} rollout`,
    };
  }

  writeCompatRolloutManifest(manifest) {
    const manifestPath = this.rolloutManifestPath(manifest.projectId, manifest.threadId, manifest.rolloutId);
    const persisted = {
      schema: manifest.schema,
      rolloutId: manifest.rolloutId,
      projectId: manifest.projectId,
      threadId: manifest.threadId,
      eventCount: manifest.eventCount,
      firstSeq: manifest.firstSeq,
      lastSeq: manifest.lastSeq,
      firstEventAt: manifest.firstEventAt,
      lastEventAt: manifest.lastEventAt,
      fileSizeBytes: manifest.fileSizeBytes,
      fileSha256: manifest.fileSha256,
      hashChainHead: manifest.hashChainHead,
      hashAlgorithm: manifest.hashAlgorithm,
      finalized: manifest.finalized,
      updatedAt: manifest.updatedAt,
    };
    writeJsonAtomic(manifestPath, persisted);
    return manifestPath;
  }

  indexFromSessionStore(sessionStore, options = {}) {
    if (!sessionStore || typeof sessionStore.listSessionIdsFromDisk !== "function") {
      throw new Error("DirectThreadStore index requires a DirectSessionStore-like source.");
    }
    sessionStore.ensure();
    let indexedSessionCount = 0;
    let indexedTurnCount = 0;
    let missingSessionFileCount = 0;
    for (const sessionId of sessionStore.listSessionIdsFromDisk()) {
      const session = sessionStore.readSession(sessionId);
      if (!session || session.schema !== DIRECT_SESSION_SCHEMA) {
        missingSessionFileCount += 1;
        continue;
      }
      const turns = sessionStore.listTurnIdsFromDisk(session.sessionId)
        .map((turnId) => sessionStore.readTurn(session.sessionId, turnId))
        .filter((turn) => turn && turn.schema === DIRECT_TURN_SCHEMA);
      this.indexSessionArtifacts(sessionStore, session, turns, options);
      indexedSessionCount += 1;
      indexedTurnCount += turns.length;
    }
    const result = {
      indexedAt: nowIso(options.nowMs),
      indexedSessionCount,
      indexedTurnCount,
      missingSessionFileCount,
    };
    this.writeMeta("last_indexed_at", result.indexedAt, options.nowMs);
    return result;
  }

  indexSessionArtifacts(sessionStore, session, turns = [], options = {}) {
    const sourceClass = sourceClassForSession(session);
    const continuityState = continuityStateForSession(session, sourceClass);
    const composerEnabled = composerEnabledForSession(session, sourceClass);
    const manifest = this.buildCompatRolloutManifest(sessionStore, session, turns, options);
    this.writeCompatRolloutManifest(manifest);
    return this.transaction(() => {
      this.db.prepare(`
        insert into direct_rollouts (
          rollout_id,
          project_id,
          thread_id,
          rollout_path_private,
          rollout_display_name,
          event_count,
          first_event_at,
          last_event_at,
          file_size_bytes,
          file_sha256,
          manifest_digest,
          recovery_state,
          created_at,
          updated_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        on conflict(rollout_id) do update set
          event_count = excluded.event_count,
          first_event_at = excluded.first_event_at,
          last_event_at = excluded.last_event_at,
          file_size_bytes = excluded.file_size_bytes,
          file_sha256 = excluded.file_sha256,
          manifest_digest = excluded.manifest_digest,
          recovery_state = excluded.recovery_state,
          updated_at = excluded.updated_at
      `).run(
        manifest.rolloutId,
        manifest.projectId,
        manifest.threadId,
        manifest.rolloutPathPrivate,
        manifest.rolloutDisplayName,
        manifest.eventCount,
        manifest.firstEventAt,
        manifest.lastEventAt,
        manifest.fileSizeBytes,
        manifest.fileSha256,
        manifest.manifestDigest,
        "healthy",
        normalizeString(session.createdAt, nowIso(options.nowMs)),
        normalizeString(session.updatedAt, nowIso(options.nowMs)),
      );

      this.db.prepare(`
        insert into direct_threads (
          thread_id,
          project_id,
          title,
          source_class,
          native_direct_session,
          provider_continuity_available,
          composer_enabled,
          continuity_state,
          lifecycle_state,
          current_rollout_id,
          current_projection_id,
          created_at,
          updated_at,
          archived_at,
          hidden_at,
          deleted_at,
          purge_state
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, '', '', '', 'not_requested')
        on conflict(thread_id) do update set
          title = excluded.title,
          source_class = excluded.source_class,
          native_direct_session = excluded.native_direct_session,
          provider_continuity_available = excluded.provider_continuity_available,
          composer_enabled = excluded.composer_enabled,
          continuity_state = excluded.continuity_state,
          current_rollout_id = excluded.current_rollout_id,
          updated_at = excluded.updated_at
      `).run(
        manifest.threadId,
        manifest.projectId,
        normalizeString(session.title, "Untitled direct session"),
        sourceClass,
        session.nativeDirectSession === true ? 1 : 0,
        session.providerContinuityAvailable === true ? 1 : 0,
        composerEnabled ? 1 : 0,
        continuityState,
        "active",
        manifest.rolloutId,
        normalizeString(session.createdAt, nowIso(options.nowMs)),
        normalizeString(session.updatedAt, nowIso(options.nowMs)),
      );

      const insertTurn = this.db.prepare(`
        insert into direct_turns (
          turn_id,
          thread_id,
          project_id,
          rollout_id,
          turn_ordinal,
          state,
          stream_phase,
          started_at,
          completed_at,
          model,
          request_shape_hash,
          context_build_id,
          request_manifest_id,
          source_event_start_seq,
          source_event_end_seq
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        on conflict(turn_id) do update set
          rollout_id = excluded.rollout_id,
          turn_ordinal = excluded.turn_ordinal,
          state = excluded.state,
          stream_phase = excluded.stream_phase,
          started_at = excluded.started_at,
          completed_at = excluded.completed_at,
          model = excluded.model,
          request_shape_hash = excluded.request_shape_hash,
          context_build_id = case
            when excluded.context_build_id != '' then excluded.context_build_id
            else direct_turns.context_build_id
          end,
          request_manifest_id = case
            when excluded.request_manifest_id != '' then excluded.request_manifest_id
            else direct_turns.request_manifest_id
          end,
          source_event_start_seq = excluded.source_event_start_seq,
          source_event_end_seq = excluded.source_event_end_seq
      `);
      const existingTurnOrdinalRows = this.db.prepare(`
        select turn_id, turn_ordinal
        from direct_turns
        where thread_id = ?
      `).all(manifest.threadId);
      const existingTurnOrdinals = new Map(existingTurnOrdinalRows.map((row) => [row.turn_id, Number(row.turn_ordinal || 0)]));
      const usedTurnOrdinals = new Set(existingTurnOrdinalRows.map((row) => Number(row.turn_ordinal || 0)).filter((value) => value > 0));
      let nextTurnOrdinal = 1;
      const ordinalForTurn = (turnId) => {
        const existingOrdinal = existingTurnOrdinals.get(turnId);
        if (existingOrdinal) return existingOrdinal;
        while (usedTurnOrdinals.has(nextTurnOrdinal)) nextTurnOrdinal += 1;
        const ordinal = nextTurnOrdinal;
        usedTurnOrdinals.add(ordinal);
        nextTurnOrdinal += 1;
        return ordinal;
      };
      let nextEventSeq = 1;
      turns.forEach((turn) => {
        const turnId = requireSafeId(turn.turnId, "turn");
        const eventCount = normalizeNumber(turn.normalizedEventCount, 0);
        const startSeq = eventCount > 0 ? nextEventSeq : 0;
        const endSeq = eventCount > 0 ? nextEventSeq + eventCount - 1 : 0;
        nextEventSeq = endSeq + 1;
        insertTurn.run(
          turnId,
          manifest.threadId,
          manifest.projectId,
          manifest.rolloutId,
          ordinalForTurn(turnId),
          normalizeString(turn.state, "created"),
          normalizeString(turn.streamPhase, ""),
          normalizeString(turn.createdAt || turn.requestBuiltAt || turn.streamStartedAt, ""),
          normalizeString(turn.completedAt || turn.failedAt || turn.abortedAt, ""),
          normalizeString(turn.model, session.model),
          normalizeString(turn.requestShapeHash || session.requestShapeHash, ""),
          normalizeString(turn.contextBuildId, ""),
          normalizeString(turn.requestManifestId, ""),
          startSeq,
          endSeq,
        );
      });
      return { manifest, indexedTurnCount: turns.length };
    });
  }

  projectionPointerColumns(projectionKind) {
    if (projectionKind === RENDERER_TRANSCRIPT_PROJECTION_KIND) {
      return {
        currentColumn: "current_renderer_projection_id",
        attemptColumn: "last_renderer_projection_attempt_id",
      };
    }
    if (projectionKind === COMPACT_TRANSCRIPT_PROJECTION_KIND) {
      return {
        currentColumn: "current_compact_projection_id",
        attemptColumn: "last_compact_projection_attempt_id",
      };
    }
    if (projectionKind === CONTEXT_RECENT_DIALOGUE_PROJECTION_KIND) {
      return {
        currentColumn: "current_context_recent_dialogue_projection_id",
        attemptColumn: "last_context_recent_dialogue_projection_attempt_id",
      };
    }
    if (projectionKind === DIRECT_OBLIGATIONS_PROJECTION_KIND) {
      return {
        currentColumn: "current_direct_obligations_projection_id",
        attemptColumn: "last_direct_obligations_projection_attempt_id",
      };
    }
    if (projectionKind === TOOL_CONTINUATION_CONTEXT_PROJECTION_KIND) {
      return {
        currentColumn: "current_tool_continuation_context_projection_id",
        attemptColumn: "last_tool_continuation_context_projection_attempt_id",
      };
    }
    throw new Error(`Unsupported direct projection kind: ${projectionKind}`);
  }

  currentProjectionRow(threadId, projectionKind) {
    if (!DIRECT_PROJECTION_KINDS.has(projectionKind)) throw new Error(`Unsupported direct projection kind: ${projectionKind}`);
    const byKind = this.db.prepare(`
      select p.*
      from direct_thread_current_projections cp
      join direct_projections p on p.projection_id = cp.projection_id
      where cp.thread_id = ? and cp.projection_kind = ?
    `).get(requireSafeId(threadId, "thread"), projectionKind);
    if (byKind) return byKind;
    const { currentColumn } = this.projectionPointerColumns(projectionKind);
    const thread = this.db.prepare(`select ${currentColumn} as projection_id from direct_threads where thread_id = ?`).get(requireSafeId(threadId, "thread"));
    if (!thread?.projection_id) return null;
    return this.db.prepare("select * from direct_projections where projection_id = ? and projection_kind = ?").get(thread.projection_id, projectionKind) || null;
  }

  readProjectionItems(projectionId) {
    return this.db.prepare(`
      select *
      from direct_projection_items
      where projection_id = ?
      order by ordinal asc
    `).all(requireSafeId(projectionId, "projection")).map((row) => {
      let payload = {};
      let sourceRef = {};
      try {
        payload = JSON.parse(row.payload_json || "{}");
      } catch {}
      try {
        sourceRef = JSON.parse(row.source_ref_json || "{}");
      } catch {}
      return {
        ...payload,
        itemId: normalizeString(row.item_id, payload.itemId),
        stableSourceItemKey: normalizeString(row.stable_source_item_key, payload.stableSourceItemKey),
        projectionId: row.projection_id,
        ordinal: Number(row.ordinal || payload.ordinal || 0),
        itemKind: normalizeString(row.item_kind, payload.itemKind),
        text: typeof row.text_value === "string" ? row.text_value : normalizeString(payload.text, ""),
        textDigest: normalizeString(row.content_digest, payload.textDigest),
        sourceRef: {
          ...sourceRef,
          rolloutId: normalizeString(row.rollout_id, sourceRef.rolloutId),
          sessionId: normalizeString(row.session_id, sourceRef.sessionId),
          turnId: normalizeString(row.turn_id, sourceRef.turnId),
          sourceArtifactKind: normalizeString(row.source_artifact_kind, sourceRef.sourceArtifactKind),
          sourceEventStartSeq: row.source_event_start_seq ?? sourceRef.sourceEventStartSeq,
          sourceEventEndSeq: row.source_event_end_seq ?? sourceRef.sourceEventEndSeq,
          sourceDigest: normalizeString(row.source_digest, sourceRef.sourceDigest),
        },
      };
    });
  }

  projectionFromRow(row) {
    if (!row) return null;
    let source = {};
    try {
      source = JSON.parse(row.source_json || "{}");
    } catch {}
    return {
      projectionId: row.projection_id,
      projectId: row.project_id,
      threadId: row.thread_id,
      projectionKind: row.projection_kind,
      projectionVersion: row.projection_version,
      builderVersion: row.builder_version,
      policyId: normalizeString(row.policy_id, ""),
      status: row.status,
      source,
      projectionDigest: row.projection_digest,
      createdAt: row.created_at,
      supersededByProjectionId: normalizeString(row.superseded_by_projection_id, ""),
      unsafeForContextBuild: Number(row.unsafe_for_context_build || 0) === 1,
      unsafeForRenderer: Number(row.unsafe_for_renderer || 0) === 1,
      staleReason: normalizeString(source.staleReason, ""),
      securityReason: normalizeString(source.securityReason, ""),
      safety: isPlainObject(source.safety) ? source.safety : {},
      caps: isPlainObject(source.caps) ? source.caps : {},
      continuity: isPlainObject(source.continuity) ? source.continuity : {},
      lifecycle: isPlainObject(source.lifecycle) ? source.lifecycle : {},
      integrity: {
        projectionDigest: row.projection_digest,
        algorithm: "sha256",
      },
    };
  }

  projectCurrentProjectionRow(projectId, projectionKind) {
    if (!DIRECT_PROJECTION_KINDS.has(projectionKind)) throw new Error(`Unsupported direct projection kind: ${projectionKind}`);
    const safeProjectId = normalizeString(projectId, "");
    if (!safeProjectId) throw new Error("Project projection requires projectId.");
    return this.db.prepare(`
      select p.*
      from direct_project_current_projections cp
      join direct_projections p on p.projection_id = cp.projection_id
      where cp.project_id = ? and cp.projection_kind = ?
    `).get(safeProjectId, projectionKind) || null;
  }

  writeProjectProjectionBuildResult(buildResult = {}, options = {}) {
    const projection = buildResult.projection;
    const items = Array.isArray(buildResult.items) ? buildResult.items : [];
    if (!isPlainObject(projection)) throw new Error("Project projection build result requires a projection.");
    if (!DIRECT_PROJECTION_KINDS.has(projection.projectionKind)) throw new Error(`Unsupported direct projection kind: ${projection.projectionKind}`);
    const projectId = normalizeString(projection.projectId, "");
    if (!projectId) throw new Error("Project projection requires projectId.");
    const projectionId = requireSafeId(projection.projectionId, "projection");
    const createdAt = normalizeString(projection.createdAt, nowIso(options.nowMs));
    const status = normalizeString(projection.status, "failed");
    const canBecomeCurrent = status === "valid" || (status === "stale" && projection.unsafeForRenderer !== true);
    return this.transaction(() => {
      this.db.prepare(`
        insert into direct_projections (
          projection_id,
          project_id,
          thread_id,
          projection_kind,
          projection_version,
          builder_version,
          policy_id,
          status,
          source_json,
          projection_digest,
          created_at,
          superseded_by_projection_id,
          unsafe_for_context_build,
          unsafe_for_renderer
        ) values (?, ?, null, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        on conflict(projection_id) do update set
          status = excluded.status,
          source_json = excluded.source_json,
          projection_digest = excluded.projection_digest,
          superseded_by_projection_id = excluded.superseded_by_projection_id,
          unsafe_for_context_build = excluded.unsafe_for_context_build,
          unsafe_for_renderer = excluded.unsafe_for_renderer
      `).run(
        projectionId,
        projectId,
        projection.projectionKind,
        projection.projectionVersion,
        projection.builderVersion,
        normalizeString(projection.policyId, ""),
        status,
        JSON.stringify({
          ...(projection.source || {}),
          staleReason: normalizeString(projection.staleReason, ""),
          securityReason: normalizeString(projection.securityReason, ""),
          failureSummary: normalizeString(projection.failureSummary, ""),
          safety: projection.safety || {},
          caps: projection.caps || {},
          continuity: projection.continuity || {},
          lifecycle: projection.lifecycle || {},
        }),
        projection.integrity?.projectionDigest || projection.projectionDigest,
        createdAt,
        normalizeString(projection.supersededByProjectionId, ""),
        projection.unsafeForContextBuild === true ? 1 : 0,
        projection.unsafeForRenderer === true ? 1 : 0,
      );
      this.db.prepare("delete from direct_projection_items where projection_id = ?").run(projectionId);
      const insertItem = this.db.prepare(`
        insert into direct_projection_items (
          projection_id,
          ordinal,
          item_id,
          stable_source_item_key,
          thread_id,
          turn_id,
          rollout_id,
          session_id,
          source_artifact_kind,
          source_event_start_seq,
          source_event_end_seq,
          source_digest,
          item_kind,
          source_ref_json,
          text_value,
          payload_json,
          content_digest
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      items.forEach((item, index) => {
        const sourceRef = isPlainObject(item.sourceRef) ? item.sourceRef : {};
        insertItem.run(
          projectionId,
          Number(item.ordinal || index + 1),
          normalizeString(item.itemId || item.previewItemId, `${projectionId}_item_${index + 1}`),
          normalizeString(item.stableSourceItemKey || item.stablePreviewItemKey, ""),
          normalizeString(item.threadId, ""),
          normalizeString(item.turnId, ""),
          normalizeString(sourceRef.rolloutId, ""),
          normalizeString(sourceRef.sessionId, ""),
          normalizeString(sourceRef.sourceArtifactKind, projection.projectionKind),
          Number(sourceRef.sourceEventStartSeq || 0),
          Number(sourceRef.sourceEventEndSeq || 0),
          normalizeString(sourceRef.sourceDigest, ""),
          normalizeString(item.itemKind, "diagnostic"),
          JSON.stringify(sourceRef),
          preserveString(item.text),
          JSON.stringify(item),
          normalizeString(item.textDigest, sha256(preserveString(item.text))),
        );
      });
      if (PREVIEW_PROJECTION_KINDS.has(projection.projectionKind)) {
        this.db.prepare(`
          insert into direct_preview_attempts (
            preview_attempt_id,
            project_id,
            projection_kind,
            projection_id,
            operation_id,
            status,
            created_at
          ) values (?, ?, ?, ?, ?, ?, ?)
          on conflict(preview_attempt_id) do update set
            projection_id = excluded.projection_id,
            status = excluded.status
        `).run(
          normalizeString(options.previewAttemptId, `preview_attempt_${projectionId}`),
          projectId,
          projection.projectionKind,
          projectionId,
          normalizeString(options.operationId, ""),
          status,
          createdAt,
        );
      }
      if (canBecomeCurrent) {
        const previous = this.projectCurrentProjectionRow(projectId, projection.projectionKind);
        if (previous && previous.projection_id !== projectionId && options.force === true) {
          this.db.prepare("update direct_projections set status = 'superseded', superseded_by_projection_id = ? where projection_id = ?")
            .run(projectionId, previous.projection_id);
        }
        this.db.prepare(`
          insert into direct_project_current_projections (
            project_id,
            projection_kind,
            projection_id,
            last_attempt_projection_id,
            updated_at
          ) values (?, ?, ?, ?, ?)
          on conflict(project_id, projection_kind) do update set
            projection_id = excluded.projection_id,
            last_attempt_projection_id = excluded.last_attempt_projection_id,
            updated_at = excluded.updated_at
        `).run(projectId, projection.projectionKind, projectionId, projectionId, createdAt);
      } else {
        const previous = this.projectCurrentProjectionRow(projectId, projection.projectionKind);
        this.db.prepare(`
          insert into direct_project_current_projections (
            project_id,
            projection_kind,
            projection_id,
            last_attempt_projection_id,
            updated_at
          ) values (?, ?, ?, ?, ?)
          on conflict(project_id, projection_kind) do update set
            last_attempt_projection_id = excluded.last_attempt_projection_id,
            updated_at = excluded.updated_at
        `).run(projectId, projection.projectionKind, previous?.projection_id || null, projectionId, createdAt);
      }
      return {
        projectionId,
        projectionKind: projection.projectionKind,
        status,
        becameCurrent: canBecomeCurrent,
        itemCount: items.length,
      };
    });
  }

  writeProjectionBuildResult(buildResult = {}, options = {}) {
    const projection = buildResult.projection;
    const items = Array.isArray(buildResult.items) ? buildResult.items : [];
    if (!isPlainObject(projection)) throw new Error("Projection build result requires a projection.");
    if (!DIRECT_PROJECTION_KINDS.has(projection.projectionKind)) throw new Error(`Unsupported direct projection kind: ${projection.projectionKind}`);
    const threadId = requireSafeId(projection.threadId, "thread");
    const projectionId = requireSafeId(projection.projectionId, "projection");
    const { currentColumn, attemptColumn } = this.projectionPointerColumns(projection.projectionKind);
    const createdAt = normalizeString(projection.createdAt, nowIso(options.nowMs));
    const status = normalizeString(projection.status, "failed");
    const canBecomeCurrent = status === "valid" || (status === "stale" && projection.unsafeForRenderer !== true);
    return this.transaction(() => {
      this.db.prepare(`
        insert into direct_projections (
          projection_id,
          project_id,
          thread_id,
          projection_kind,
          projection_version,
          builder_version,
          policy_id,
          status,
          source_json,
          projection_digest,
          created_at,
          superseded_by_projection_id,
          unsafe_for_context_build,
          unsafe_for_renderer
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        on conflict(projection_id) do update set
          status = excluded.status,
          source_json = excluded.source_json,
          projection_digest = excluded.projection_digest,
          superseded_by_projection_id = excluded.superseded_by_projection_id,
          unsafe_for_context_build = excluded.unsafe_for_context_build,
          unsafe_for_renderer = excluded.unsafe_for_renderer
      `).run(
        projectionId,
        projection.projectId,
        threadId,
        projection.projectionKind,
        projection.projectionVersion,
        projection.builderVersion,
        normalizeString(projection.policyId, ""),
        status,
        JSON.stringify({
          ...(projection.source || {}),
          staleReason: normalizeString(projection.staleReason, ""),
          securityReason: normalizeString(projection.securityReason, ""),
          safety: projection.safety || {},
          caps: projection.caps || {},
          continuity: projection.continuity || {},
          lifecycle: projection.lifecycle || {},
        }),
        projection.integrity?.projectionDigest || projection.projectionDigest,
        createdAt,
        normalizeString(projection.supersededByProjectionId, ""),
        projection.unsafeForContextBuild === true ? 1 : 0,
        projection.unsafeForRenderer === true ? 1 : 0,
      );
      this.db.prepare("delete from direct_projection_items where projection_id = ?").run(projectionId);
      const insertItem = this.db.prepare(`
        insert into direct_projection_items (
          projection_id,
          ordinal,
          item_id,
          stable_source_item_key,
          thread_id,
          turn_id,
          rollout_id,
          session_id,
          source_artifact_kind,
          source_event_start_seq,
          source_event_end_seq,
          source_digest,
          item_kind,
          source_ref_json,
          text_value,
          payload_json,
          content_digest
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      items.forEach((item, index) => {
        const sourceRef = isPlainObject(item.sourceRef) ? item.sourceRef : {};
        insertItem.run(
          projectionId,
          Number(item.ordinal || index + 1),
          normalizeString(item.itemId, `${projectionId}_item_${index + 1}`),
          normalizeString(item.stableSourceItemKey, ""),
          threadId,
          normalizeString(item.turnId, ""),
          normalizeString(sourceRef.rolloutId, ""),
          normalizeString(sourceRef.sessionId, ""),
          normalizeString(sourceRef.sourceArtifactKind, ""),
          Number(sourceRef.sourceEventStartSeq || 0),
          Number(sourceRef.sourceEventEndSeq || 0),
          normalizeString(sourceRef.sourceDigest, ""),
          normalizeString(item.itemKind, "diagnostic"),
          JSON.stringify(sourceRef),
          preserveString(item.text),
          JSON.stringify(item),
          normalizeString(item.textDigest, sha256(preserveString(item.text))),
        );
      });
      if (canBecomeCurrent) {
        const previous = this.currentProjectionRow(threadId, projection.projectionKind);
        if (previous && previous.projection_id !== projectionId && options.force === true) {
          this.db.prepare("update direct_projections set status = 'superseded', superseded_by_projection_id = ? where projection_id = ?")
            .run(projectionId, previous.projection_id);
        }
        this.db.prepare(`
          insert into direct_thread_current_projections (
            thread_id,
            projection_kind,
            projection_id,
            last_attempt_projection_id,
            updated_at
          ) values (?, ?, ?, ?, ?)
          on conflict(thread_id, projection_kind) do update set
            projection_id = excluded.projection_id,
            last_attempt_projection_id = excluded.last_attempt_projection_id,
            updated_at = excluded.updated_at
        `).run(threadId, projection.projectionKind, projectionId, projectionId, createdAt);
        if (projection.projectionKind === RENDERER_TRANSCRIPT_PROJECTION_KIND) {
          this.db.prepare(`update direct_threads set ${currentColumn} = ?, ${attemptColumn} = ?, current_projection_id = ?, updated_at = ? where thread_id = ?`)
            .run(projectionId, projectionId, projectionId, createdAt, threadId);
        } else {
          this.db.prepare(`update direct_threads set ${currentColumn} = ?, ${attemptColumn} = ?, updated_at = ? where thread_id = ?`)
            .run(projectionId, projectionId, createdAt, threadId);
        }
      } else {
        this.db.prepare(`update direct_threads set ${attemptColumn} = ?, updated_at = ? where thread_id = ?`).run(projectionId, createdAt, threadId);
      }
      return {
        projectionId,
        projectionKind: projection.projectionKind,
        status,
        becameCurrent: canBecomeCurrent,
        itemCount: items.length,
      };
    });
  }

  buildRendererTranscriptProjection(threadId, options = {}) {
    const safeThreadId = requireSafeId(threadId, "thread");
    const lockKey = `${safeThreadId}:${RENDERER_TRANSCRIPT_PROJECTION_KIND}`;
    if (this.projectionBuildLocks.has(lockKey)) throw new Error("projection_build_in_progress");
    this.projectionBuildLocks.add(lockKey);
    try {
      const sessionStore = options.sessionStore;
      if (!sessionStore) throw new Error("Renderer transcript projection requires a session store.");
      const session = sessionStore.readSession(safeThreadId);
      if (!session) throw new Error(`Direct session not found for projection: ${safeThreadId}`);
      const turns = sessionStore.listTurnIdsFromDisk(safeThreadId)
        .map((turnId) => sessionStore.readTurn(safeThreadId, turnId))
        .filter(Boolean);
      const rollout = this.db.prepare("select * from direct_rollouts where thread_id = ? order by updated_at desc limit 1").get(safeThreadId) || {};
      const operationManifest = this.readOperationManifest();
      const buildResult = buildRendererTranscriptProjection({
        sessionStore,
        session,
        turns,
        rollout,
        operationManifest,
        nowMs: options.nowMs,
      });
      const existing = this.currentProjectionRow(safeThreadId, RENDERER_TRANSCRIPT_PROJECTION_KIND);
      if (!options.force && existing) {
        const existingSource = this.projectionFromRow(existing)?.source || {};
        if (existingSource.sourceDigest && existingSource.sourceDigest === buildResult.sourceDigest && existing.status === "valid") {
          return {
            projectionId: existing.projection_id,
            projectionKind: RENDERER_TRANSCRIPT_PROJECTION_KIND,
            status: existing.status,
            reused: true,
            itemCount: this.readProjectionItems(existing.projection_id).length,
          };
        }
      }
      return this.writeProjectionBuildResult(buildResult, { ...options, force: options.force === true });
    } finally {
      this.projectionBuildLocks.delete(lockKey);
    }
  }

  buildCompactTranscriptProjection(threadId, options = {}) {
    const safeThreadId = requireSafeId(threadId, "thread");
    const lockKey = `${safeThreadId}:${COMPACT_TRANSCRIPT_PROJECTION_KIND}`;
    if (this.projectionBuildLocks.has(lockKey)) throw new Error("projection_build_in_progress");
    this.projectionBuildLocks.add(lockKey);
    try {
      const rendererRow = this.currentProjectionRow(safeThreadId, RENDERER_TRANSCRIPT_PROJECTION_KIND);
      const rendererProjection = this.projectionFromRow(rendererRow);
      if (!rendererProjection || rendererProjection.status !== "valid" || rendererProjection.unsafeForRenderer === true) {
        throw new Error("Compact transcript projection requires a valid renderer transcript projection.");
      }
      const rendererItems = this.readProjectionItems(rendererProjection.projectionId);
      const buildResult = buildCompactTranscriptProjection({
        rendererProjection,
        rendererItems,
        nowMs: options.nowMs,
      });
      const existing = this.currentProjectionRow(safeThreadId, COMPACT_TRANSCRIPT_PROJECTION_KIND);
      if (!options.force && existing) {
        const existingSource = this.projectionFromRow(existing)?.source || {};
        if (existingSource.sourceDigest && existingSource.sourceDigest === buildResult.sourceDigest && existing.status === "valid") {
          return {
            projectionId: existing.projection_id,
            projectionKind: COMPACT_TRANSCRIPT_PROJECTION_KIND,
            status: existing.status,
            reused: true,
            itemCount: this.readProjectionItems(existing.projection_id).length,
          };
        }
      }
      return this.writeProjectionBuildResult(buildResult, { ...options, force: options.force === true });
    } finally {
      this.projectionBuildLocks.delete(lockKey);
    }
  }

  buildContextRecentDialogueProjection(threadId, options = {}) {
    const safeThreadId = requireSafeId(threadId, "thread");
    const lockKey = `${safeThreadId}:${CONTEXT_RECENT_DIALOGUE_PROJECTION_KIND}`;
    if (this.projectionBuildLocks.has(lockKey)) throw new Error("projection_build_in_progress");
    this.projectionBuildLocks.add(lockKey);
    try {
      const rendererRow = this.currentProjectionRow(safeThreadId, RENDERER_TRANSCRIPT_PROJECTION_KIND);
      const rendererProjection = this.projectionFromRow(rendererRow);
      if (!rendererProjection || rendererProjection.status !== "valid" || rendererProjection.unsafeForRenderer === true) {
        throw new Error("context_recent_dialogue requires a current valid renderer transcript projection.");
      }
      const rendererItems = this.readProjectionItems(rendererProjection.projectionId);
      const buildResult = buildContextRecentDialogueProjection({
        rendererProjection,
        rendererItems,
        nowMs: options.nowMs,
      });
      const existing = this.currentProjectionRow(safeThreadId, CONTEXT_RECENT_DIALOGUE_PROJECTION_KIND);
      if (!options.force && existing) {
        const existingSource = this.projectionFromRow(existing)?.source || {};
        if (existingSource.sourceDigest && existingSource.sourceDigest === buildResult.sourceDigest && existing.status === "valid") {
          return {
            projectionId: existing.projection_id,
            projectionKind: CONTEXT_RECENT_DIALOGUE_PROJECTION_KIND,
            status: existing.status,
            reused: true,
            itemCount: this.readProjectionItems(existing.projection_id).length,
          };
        }
      }
      return this.writeProjectionBuildResult(buildResult, { ...options, force: options.force === true });
    } finally {
      this.projectionBuildLocks.delete(lockKey);
    }
  }

  buildDirectObligationsProjection(threadId, turnId, options = {}) {
    const safeThreadId = requireSafeId(threadId, "thread");
    const safeTurnId = requireSafeId(turnId, "turn");
    const lockKey = `${safeThreadId}:${safeTurnId}:${DIRECT_OBLIGATIONS_PROJECTION_KIND}`;
    if (this.projectionBuildLocks.has(lockKey)) throw new Error("projection_build_in_progress");
    this.projectionBuildLocks.add(lockKey);
    try {
      const sessionStore = options.sessionStore;
      if (!sessionStore) throw new Error("Direct obligations projection requires a session store.");
      const session = sessionStore.readSession(safeThreadId);
      const turn = sessionStore.readTurn(safeThreadId, safeTurnId);
      if (!session || !turn) throw new Error("Direct obligations projection requires session and turn artifacts.");
      const buildResult = buildDirectObligationsProjection({
        session,
        turn,
        operationManifest: this.readOperationManifest(),
        nowMs: options.nowMs,
      });
      const existing = this.currentProjectionRow(safeThreadId, DIRECT_OBLIGATIONS_PROJECTION_KIND);
      if (!options.force && existing) {
        const existingSource = this.projectionFromRow(existing)?.source || {};
        if (
          existingSource.sourceDigest &&
          existingSource.sourceDigest === buildResult.sourceDigest &&
          existingSource.turnId === safeTurnId &&
          existing.status === "valid"
        ) {
          return {
            projectionId: existing.projection_id,
            projectionKind: DIRECT_OBLIGATIONS_PROJECTION_KIND,
            status: existing.status,
            reused: true,
            itemCount: this.readProjectionItems(existing.projection_id).length,
          };
        }
      }
      return this.writeProjectionBuildResult(buildResult, { ...options, force: options.force === true });
    } finally {
      this.projectionBuildLocks.delete(lockKey);
    }
  }

  currentDirectObligationsProjection(threadId, turnId) {
    const projection = this.projectionFromRow(this.currentProjectionRow(threadId, DIRECT_OBLIGATIONS_PROJECTION_KIND));
    if (!projection || projection.status !== "valid" || projection.source?.turnId !== turnId) return null;
    return projection;
  }

  buildToolContinuationContextProjection(input = {}, options = {}) {
    const sessionStore = options.sessionStore || input.sessionStore;
    if (!sessionStore) throw new Error("Tool continuation context projection requires a session store.");
    const safeThreadId = requireSafeId(input.threadId || input.sessionId, "thread");
    const safeTurnId = requireSafeId(input.turnId, "turn");
    const obligationId = requireSafeId(input.obligationId, "obligation");
    const continuationId = requireSafeId(input.continuationRequest?.continuationId || `tool_continuation_${obligationId}`, "continuation");
    const lockKey = `${safeThreadId}:${safeTurnId}:${obligationId}:${continuationId}:${TOOL_CONTINUATION_CONTEXT_PROJECTION_KIND}`;
    if (this.projectionBuildLocks.has(lockKey)) throw new Error("projection_build_in_progress");
    this.projectionBuildLocks.add(lockKey);
    try {
      const session = sessionStore.readSession(safeThreadId);
      const turn = sessionStore.readTurn(safeThreadId, safeTurnId);
      if (!session || !turn) throw new Error("Tool continuation context requires session and turn artifacts.");
      const obligationProjectionResult = this.buildDirectObligationsProjection(safeThreadId, safeTurnId, {
        ...options,
        sessionStore,
      });
      const obligationProjection = this.projectionFromRow(
        this.db.prepare("select * from direct_projections where projection_id = ?").get(obligationProjectionResult.projectionId),
      );
      const obligationItems = this.readProjectionItems(obligationProjection.projectionId);
      const obligationItem = obligationItems.find((item) => item.obligation?.obligationId === obligationId);
      if (!obligationItem) throw new Error(`Direct obligation projection item not found: ${obligationId}`);
      const obligation = (Array.isArray(turn.unresolvedObligations) ? turn.unresolvedObligations : [])
        .find((entry) => entry?.obligationId === obligationId);
      if (!obligation) throw new Error(`Direct tool obligation not found: ${obligationId}`);
      const buildResult = buildToolContinuationContextProjection({
        session,
        turn,
        obligationProjection,
        obligationItem,
        obligation,
        continuationRequest: input.continuationRequest || obligation.continuationRequest || {},
        previousResponseId: normalizeString(input.previousResponseId || turn.responseId, ""),
        nowMs: options.nowMs,
      });
      const existing = this.currentProjectionRow(safeThreadId, TOOL_CONTINUATION_CONTEXT_PROJECTION_KIND);
      if (!options.force && existing) {
        const existingSource = this.projectionFromRow(existing)?.source || {};
        if (
          existingSource.sourceDigest &&
          existingSource.sourceDigest === buildResult.sourceDigest &&
          existingSource.turnId === safeTurnId &&
          existingSource.obligationId === obligationId &&
          existing.status === "valid"
        ) {
          return {
            projectionId: existing.projection_id,
            projectionKind: TOOL_CONTINUATION_CONTEXT_PROJECTION_KIND,
            status: existing.status,
            reused: true,
            itemCount: this.readProjectionItems(existing.projection_id).length,
          };
        }
      }
      return this.writeProjectionBuildResult(buildResult, { ...options, force: options.force === true });
    } finally {
      this.projectionBuildLocks.delete(lockKey);
    }
  }

  upsertContextPolicy(policy, options = {}) {
    const snapshot = isPlainObject(policy) ? policy : policySnapshot(DIRECT_TEXT_TURN_EMPTY_CONTEXT_POLICY_ID);
    this.db.prepare(`
      insert into direct_context_policies (
        policy_id,
        policy_version,
        purpose,
        status,
        definition_json,
        created_at
      ) values (?, ?, ?, 'active', ?, ?)
      on conflict(policy_id) do update set
        policy_version = excluded.policy_version,
        purpose = excluded.purpose,
        status = excluded.status,
        definition_json = excluded.definition_json
    `).run(
      normalizeString(snapshot.policyId, ""),
      normalizeString(snapshot.policyVersion, ""),
      normalizeString(snapshot.purpose, ""),
      JSON.stringify(snapshot),
      nowIso(options.nowMs),
    );
  }

  writeContextPack(contextPack = {}, options = {}) {
    const contextBuildId = requireSafeId(contextPack.contextBuildId, "context build");
    const projectId = normalizeString(contextPack.projectId, "");
    const threadId = requireSafeId(contextPack.threadId, "thread");
    const turnId = normalizeString(contextPack.turnId, "");
    const artifactPath = this.contextPackPath(projectId, threadId, contextBuildId);
    const artifactExisted = fs.existsSync(artifactPath);
    writeJsonAtomic(artifactPath, contextPack);
    try {
      return this.transaction(() => {
        this.upsertContextPolicy(contextPack.policy || policySnapshot(DIRECT_TEXT_TURN_EMPTY_CONTEXT_POLICY_ID), options);
        this.db.prepare(`
          insert into direct_context_builds (
            context_build_id,
            project_id,
            thread_id,
            turn_id,
            policy_id,
            policy_version,
            purpose,
            context_pack_path_private,
            shape_hash,
            content_hash,
            source_json,
            built_at
          ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          on conflict(context_build_id) do update set
            context_pack_path_private = excluded.context_pack_path_private,
            shape_hash = excluded.shape_hash,
            content_hash = excluded.content_hash,
            source_json = excluded.source_json,
            built_at = excluded.built_at
        `).run(
          contextBuildId,
          projectId,
          threadId,
          turnId,
          normalizeString(contextPack.policy?.policyId, ""),
          normalizeString(contextPack.policy?.policyVersion, ""),
          normalizeString(contextPack.purpose, ""),
          artifactPath,
          normalizeString(contextPack.contextPackShapeHash, ""),
          normalizeString(contextPack.contextPackContentHash, ""),
          JSON.stringify({
            sourceArtifacts: contextPack.sourceArtifacts || [],
            sourceProjections: contextPack.sourceProjections || [],
            policyDigest: normalizeString(contextPack.policy?.policyDigest, ""),
            roleMappingDigest: normalizeString(contextPack.roleMapping?.mappingDigest, ""),
            rawExposure: contextPack.rawExposure || {},
            integrity: contextPack.integrity || {},
          }),
          normalizeString(contextPack.builtAt, nowIso(options.nowMs)),
        );
        if (turnId) {
          this.db.prepare("update direct_turns set context_build_id = ? where turn_id = ? and thread_id = ?")
            .run(contextBuildId, turnId, threadId);
        }
        return {
          contextBuildId,
          contextPackPathPrivate: artifactPath,
          contextPackContentHash: normalizeString(contextPack.contextPackContentHash, ""),
          contextPackShapeHash: normalizeString(contextPack.contextPackShapeHash, ""),
        };
      });
    } catch (error) {
      if (!artifactExisted) {
        try {
          fs.unlinkSync(artifactPath);
        } catch {}
      }
      throw error;
    }
  }

  readContextPack(contextBuildId) {
    const row = this.db.prepare("select * from direct_context_builds where context_build_id = ?")
      .get(requireSafeId(contextBuildId, "context build"));
    if (!row) return null;
    return readJsonFile(row.context_pack_path_private);
  }

  writeRequestManifest(requestManifest = {}, options = {}) {
    const requestManifestId = requireSafeId(requestManifest.requestManifestId, "request manifest");
    const projectId = normalizeString(requestManifest.projectId, "");
    const threadId = requireSafeId(requestManifest.threadId, "thread");
    const turnId = requireSafeId(requestManifest.turnId, "turn");
    const contextBuildId = requireSafeId(requestManifest.contextBuildId, "context build");
    const artifactPath = this.requestManifestPath(projectId, threadId, requestManifestId);
    const artifactExisted = fs.existsSync(artifactPath);
    writeJsonAtomic(artifactPath, requestManifest);
    try {
      return this.transaction(() => {
        this.db.prepare(`
          insert into direct_request_manifests (
            request_manifest_id,
            project_id,
            thread_id,
            turn_id,
            context_build_id,
            runtime_mode,
            transport,
            model,
            model_evidence_ref,
            request_shape_hash,
            request_manifest_path_private,
            request_shape_evidence_ref,
            endpoint_evidence_ref,
            role_mapping_digest,
            provider_input_shape_hash,
            provider_input_text_hash,
            endpoint_class,
            endpoint_hash,
            enabled_features_json,
            continuity_json,
            capability_evidence_json,
            request_body_storage_audit_json,
            raw_auth_exposed,
            raw_request_body_stored,
            built_at
          ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          on conflict(request_manifest_id) do update set
            request_manifest_path_private = excluded.request_manifest_path_private,
            request_shape_hash = excluded.request_shape_hash,
            enabled_features_json = excluded.enabled_features_json,
            continuity_json = excluded.continuity_json,
            capability_evidence_json = excluded.capability_evidence_json,
            request_body_storage_audit_json = excluded.request_body_storage_audit_json,
            raw_auth_exposed = excluded.raw_auth_exposed,
            raw_request_body_stored = excluded.raw_request_body_stored,
            built_at = excluded.built_at
        `).run(
          requestManifestId,
          projectId,
          threadId,
          turnId,
          contextBuildId,
          normalizeString(requestManifest.runtimeMode, "direct-experimental"),
          normalizeString(requestManifest.transport, "live-text"),
          normalizeString(requestManifest.model, ""),
          normalizeString(requestManifest.modelEvidenceRef, ""),
          normalizeString(requestManifest.requestShapeHash, ""),
          artifactPath,
          normalizeString(requestManifest.capabilityEvidence?.requestShapeEvidenceRef, ""),
          normalizeString(requestManifest.capabilityEvidence?.endpointEvidenceRef, ""),
          normalizeString(requestManifest.roleMappingDigest, ""),
          normalizeString(requestManifest.providerInputProjection?.providerInputShapeHash, ""),
          normalizeString(requestManifest.providerInputProjection?.providerInputTextHash, ""),
          normalizeString(requestManifest.endpointClass, ""),
          normalizeString(requestManifest.endpointHash, ""),
          JSON.stringify(requestManifest.enabledFeatures || {}),
          JSON.stringify(requestManifest.continuity || {}),
          JSON.stringify(requestManifest.capabilityEvidence || {}),
          JSON.stringify(requestManifest.requestBodyStorageAudit || {}),
          requestManifest.rawAuthExposed === true ? 1 : 0,
          requestManifest.rawRequestBodyStored === true ? 1 : 0,
          normalizeString(requestManifest.builtAt, nowIso(options.nowMs)),
        );
        this.db.prepare("update direct_turns set request_manifest_id = ?, context_build_id = ? where turn_id = ? and thread_id = ?")
          .run(requestManifestId, contextBuildId, turnId, threadId);
        return {
          requestManifestId,
          requestManifestPathPrivate: artifactPath,
          requestShapeHash: normalizeString(requestManifest.requestShapeHash, ""),
          providerInputShapeHash: normalizeString(requestManifest.providerInputProjection?.providerInputShapeHash, ""),
          providerInputTextHash: normalizeString(requestManifest.providerInputProjection?.providerInputTextHash, ""),
        };
      });
    } catch (error) {
      if (!artifactExisted) {
        try {
          fs.unlinkSync(artifactPath);
        } catch {}
      }
      throw error;
    }
  }

  readRequestManifest(requestManifestId) {
    const row = this.db.prepare("select * from direct_request_manifests where request_manifest_id = ?")
      .get(requireSafeId(requestManifestId, "request manifest"));
    if (!row) return null;
    return readJsonFile(row.request_manifest_path_private);
  }

  currentValidContextProjection(threadId) {
    const row = this.currentProjectionRow(threadId, CONTEXT_RECENT_DIALOGUE_PROJECTION_KIND);
    const projection = this.projectionFromRow(row);
    if (!projection || projection.status !== "valid" || projection.unsafeForContextBuild === true) return null;
    return projection;
  }

  buildAndPersistContextForTextTurn(input = {}, options = {}) {
    const session = isPlainObject(input.session) ? input.session : null;
    if (!session) throw new Error("Direct context build requires a session.");
    const projectId = normalizeString(input.projectId || session.projectId, "");
    const threadId = requireSafeId(input.threadId || session.sessionId, "thread");
    const turnId = requireSafeId(input.turnId, "turn");
    let contextProjection = null;
    let contextItems = [];
    if (input.useRecentDialogue !== false) {
      try {
        const built = this.buildContextRecentDialogueProjection(threadId, options);
        if (built.status === "valid") {
          contextProjection = this.projectionFromRow(this.currentProjectionRow(threadId, CONTEXT_RECENT_DIALOGUE_PROJECTION_KIND));
          contextItems = this.readProjectionItems(contextProjection.projectionId);
        }
      } catch (error) {
        if (input.requireRecentDialogue === true) throw error;
      }
    }
    const policyId = contextProjection
      ? DIRECT_TEXT_TURN_RECENT_DIALOGUE_POLICY_ID
      : DIRECT_TEXT_TURN_EMPTY_CONTEXT_POLICY_ID;
    const contextPack = buildContextPack({
      projectId,
      threadId,
      turnId,
      purpose: "direct_text_turn",
      policyId,
      contextProjection,
      contextItems,
      currentUserPrompt: preserveString(input.currentUserPrompt),
      nowMs: options.nowMs,
    });
    this.writeContextPack(contextPack, options);
    const request = buildRequestManifest({
      contextPack,
      model: input.model,
      requestShape: input.requestShape,
      requestShapeHash: input.requestShapeHash,
      endpointClass: input.endpointClass,
      endpointHash: input.endpointHash,
      modelEvidenceRef: input.modelEvidenceRef,
      requestShapeEvidenceRef: input.requestShapeEvidenceRef,
      endpointEvidenceRef: input.endpointEvidenceRef,
      nowMs: options.nowMs,
    });
    this.writeRequestManifest(request.requestManifest, options);
    return {
      contextPack,
      requestManifest: request.requestManifest,
      providerInput: request.providerInput,
      rendererSafeSummary: rendererSafeContextSummary(contextPack, request.requestManifest),
    };
  }

  buildAndPersistContextForCheckpointContinuation(input = {}, options = {}) {
    const session = isPlainObject(input.session) ? input.session : null;
    if (!session) throw new Error("Direct checkpoint context build requires a session.");
    const projectId = normalizeString(input.projectId || session.projectId, "");
    const threadId = requireSafeId(input.threadId || session.sessionId, "thread");
    const turnId = requireSafeId(input.turnId, "turn");
    const seed = isPlainObject(input.seed) ? input.seed : {};
    const contextPack = buildContextPack({
      projectId,
      threadId,
      turnId,
      purpose: "import_checkpoint_continuation",
      policyId: DIRECT_IMPORT_CHECKPOINT_CONTINUATION_POLICY_ID,
      currentUserPrompt: preserveString(input.currentUserPrompt),
      checkpointSeed: seed,
      nowMs: options.nowMs,
    });
    this.writeContextPack(contextPack, options);
    const request = buildRequestManifest({
      contextPack,
      model: input.model,
      requestShape: input.requestShape,
      requestShapeHash: input.requestShapeHash || seed.requestShapeHash,
      endpointClass: input.endpointClass,
      endpointHash: input.endpointHash,
      modelEvidenceRef: input.modelEvidenceRef,
      requestShapeEvidenceRef: input.requestShapeEvidenceRef,
      endpointEvidenceRef: input.endpointEvidenceRef,
      nowMs: options.nowMs,
    });
    this.writeRequestManifest(request.requestManifest, options);
    return {
      contextPack,
      requestManifest: request.requestManifest,
      providerInput: request.providerInput,
      rendererSafeSummary: rendererSafeContextSummary(contextPack, request.requestManifest),
    };
  }

  buildAndPersistContextForToolContinuation(input = {}, options = {}) {
    const sessionStore = options.sessionStore || input.sessionStore;
    if (!sessionStore) throw new Error("Direct tool continuation context build requires a session store.");
    const session = isPlainObject(input.session) ? input.session : sessionStore.readSession(input.sessionId || input.threadId);
    if (!session) throw new Error("Direct tool continuation context build requires a session.");
    const projectId = normalizeString(input.projectId || session.projectId, "");
    const threadId = requireSafeId(input.threadId || input.sessionId || session.sessionId, "thread");
    const turnId = requireSafeId(input.turnId, "turn");
    const obligationId = requireSafeId(input.obligationId, "obligation");
    const continuationRequest = isPlainObject(input.continuationRequest) ? input.continuationRequest : {};
    const previousResponseId = normalizeString(input.previousResponseId || continuationRequest.source?.previousResponseId || "", "");
    const projectionResult = this.buildToolContinuationContextProjection({
      sessionStore,
      session,
      sessionId: threadId,
      threadId,
      turnId,
      obligationId,
      continuationRequest,
      previousResponseId,
    }, options);
    const toolContinuationContext = this.projectionFromRow(
      this.db.prepare("select * from direct_projections where projection_id = ?").get(projectionResult.projectionId),
    );
    if (!toolContinuationContext || toolContinuationContext.status !== "valid" || toolContinuationContext.unsafeForContextBuild === true) {
      throw new Error("Tool continuation context projection is not valid for context build.");
    }
    const toolContinuationItems = this.readProjectionItems(toolContinuationContext.projectionId);
    const contextPack = buildContextPack({
      projectId,
      threadId,
      turnId,
      purpose: "read_only_tool_continuation",
      policyId: DIRECT_READONLY_TOOL_CONTINUATION_POLICY_ID,
      toolContinuationContext,
      toolContinuationItems,
      currentUserPrompt: "",
      nowMs: options.nowMs,
    });
    this.writeContextPack(contextPack, options);
    const requestShape = isPlainObject(input.requestShape) ? input.requestShape : {
      kind: "read_only_tool_continuation",
      stream: true,
      store: false,
      tools: false,
      hasPreviousResponseId: Boolean(previousResponseId),
      functionCallOutputCount: continuationRequest.toolResult?.outputType === "function_call_output" ? 1 : 0,
      customToolCallOutputCount: continuationRequest.toolResult?.outputType === "custom_tool_call_output" ? 1 : 0,
    };
    const request = buildRequestManifest({
      contextPack,
      model: input.model,
      requestShape,
      requestShapeHash: input.requestShapeHash || sha256(stableStringify(requestShape)),
      endpointClass: input.endpointClass,
      endpointHash: input.endpointHash,
      modelEvidenceRef: input.modelEvidenceRef,
      requestShapeEvidenceRef: input.requestShapeEvidenceRef || "continuation.tool_result",
      endpointEvidenceRef: input.endpointEvidenceRef,
      nowMs: options.nowMs,
    });
    const requestManifest = {
      ...request.requestManifest,
      enabledFeatures: {
        ...(request.requestManifest.enabledFeatures || {}),
        store: false,
        tools: false,
        previousResponseId: true,
        includes: false,
      },
      continuity: {
        previousResponseIdUsed: true,
        providerContinuityHandleUsed: true,
        importedContinuityHandleUsed: false,
        continuityPolicy: "native_parent_turn_previous_response_id",
        previousResponseIdSource: "initial_stream",
        previousResponseIdDigest: sha256(previousResponseId),
        previousResponseSourceTurnDigest: sha256(stableStringify({
          threadId,
          turnId,
          responseId: previousResponseId,
        })),
      },
      capabilityEvidence: {
        ...(request.requestManifest.capabilityEvidence || {}),
        requestShapeEvidenceRef: input.requestShapeEvidenceRef || "continuation.tool_result",
        contextPolicyEvidenceRef: contextPack.policy?.policyDigest || "",
        toolCallShapeEvidenceRef: input.toolCallShapeEvidenceRef || "direct_obligations_projection",
      },
      toolContinuation: {
        continuationId: normalizeString(continuationRequest.continuationId, ""),
        obligationId,
        parentTurnId: turnId,
        previousResponseIdSource: "initial_stream",
        sourceProjectionId: toolContinuationContext.projectionId,
      },
    };
    requestManifest.integrity = {
      ...(requestManifest.integrity || {}),
      artifactDigest: sha256(stableStringify({
        ...requestManifest,
        integrity: { ...(requestManifest.integrity || {}), artifactDigest: "" },
      })),
    };
    this.writeRequestManifest(requestManifest, options);
    return {
      contextPack,
      requestManifest,
      providerInput: request.providerInput,
      toolContinuationContext,
      toolContinuationItems,
      rendererSafeSummary: rendererSafeContextSummary(contextPack, requestManifest),
    };
  }

  readProjectionByKind(threadId, projectionKind, options = {}) {
    const safeThreadId = requireSafeId(threadId, "thread");
    const row = options.projectionId
      ? this.db.prepare("select * from direct_projections where projection_id = ? and thread_id = ? and projection_kind = ?")
        .get(requireSafeId(options.projectionId, "projection"), safeThreadId, projectionKind)
      : this.currentProjectionRow(safeThreadId, projectionKind);
    const projection = this.projectionFromRow(row);
    if (!projection) return null;
    if (projection.status === "blocked" || projection.unsafeForRenderer === true) {
      return {
        schema: "renderer_safe_direct_transcript_projection@1",
        projectionId: projection.projectionId,
        projectId: projection.projectId,
        threadId: projection.threadId,
        title: "",
        status: projection.status,
        staleReason: projection.staleReason,
        securityReason: projection.securityReason,
        unsafeForRenderer: true,
        unsafeForContextBuild: true,
        failureSummary: "Projection is blocked by renderer safety policy.",
        sourceClass: normalizeString(projection.continuity?.sourceClass, ""),
        composer: {
          projectionHint: "non-runnable-projection",
          enabledByProjection: false,
          authoritative: false,
          controlAuthority: "runtime-status",
        },
        lifecycle: projection.lifecycle || { state: "active", operationIds: [], rendererListVisible: true },
        caps: projection.caps || { truncated: false, omittedCounts: {} },
        items: [],
        rawExposure: {
          rawPathExposed: false,
          rawCredentialsExposed: false,
          rawBackendFrameExposed: false,
          rawRequestBodyExposed: false,
          rawImportedJsonlExposed: false,
        },
      };
    }
    const allItems = this.readProjectionItems(projection.projectionId);
    const offset = Math.max(0, Number(options.offset || 0));
    const limit = Number.isFinite(Number(options.limit)) && Number(options.limit) > 0 ? Number(options.limit) : allItems.length;
    const items = allItems.slice(offset, offset + limit);
    const thread = this.db.prepare("select title from direct_threads where thread_id = ?").get(safeThreadId);
    return {
      schema: projectionKind === COMPACT_TRANSCRIPT_PROJECTION_KIND
        ? "renderer_safe_direct_compact_projection@1"
        : "renderer_safe_direct_transcript_projection@1",
      projectionId: projection.projectionId,
      projectId: projection.projectId,
      threadId: projection.threadId,
      title: normalizeString(thread?.title, ""),
      status: projection.status,
      staleReason: projection.staleReason,
      securityReason: projection.securityReason,
      unsafeForRenderer: projection.unsafeForRenderer,
      unsafeForContextBuild: projection.unsafeForContextBuild,
      failureSummary: "",
      sourceClass: normalizeString(projection.continuity?.sourceClass, ""),
      composer: projection.continuity?.composer || {
        projectionHint: "runtime-not-attached",
        enabledByProjection: false,
        authoritative: false,
        controlAuthority: "runtime-status",
      },
      lifecycle: projection.lifecycle || { state: "active", operationIds: [], rendererListVisible: true },
      caps: projection.caps || { truncated: false, omittedCounts: {} },
      items,
      page: {
        offset,
        limit,
        returned: items.length,
        total: allItems.length,
      },
      rawExposure: {
        rawPathExposed: false,
        rawCredentialsExposed: false,
        rawBackendFrameExposed: false,
        rawRequestBodyExposed: false,
        rawImportedJsonlExposed: false,
      },
    };
  }

  readRendererTranscriptProjection(threadId, options = {}) {
    return this.readProjectionByKind(threadId, RENDERER_TRANSCRIPT_PROJECTION_KIND, options);
  }

  readCompactTranscriptProjection(threadId, options = {}) {
    return this.readProjectionByKind(threadId, COMPACT_TRANSCRIPT_PROJECTION_KIND, options);
  }

  markProjectionStale(projectionId, reason = "manual_rebuild_requested") {
    const row = this.db.prepare("select * from direct_projections where projection_id = ?").get(requireSafeId(projectionId, "projection"));
    if (!row) return null;
    const projection = this.projectionFromRow(row);
    const staleReason = normalizeString(reason, "manual_rebuild_requested");
    const staleProjectionSource = (entry) => ({
      ...(entry.source || {}),
      staleReason,
      safety: entry.safety || {},
      caps: entry.caps || {},
      continuity: entry.continuity || {},
      lifecycle: entry.lifecycle || {},
    });
    return this.transaction(() => {
      this.db.prepare("update direct_projections set status = 'stale', source_json = ? where projection_id = ?")
        .run(JSON.stringify(staleProjectionSource(projection)), projection.projectionId);
      const invalidatedCompactProjectionIds = [];
      const invalidatedContextProjectionIds = [];
      if (projection.projectionKind === RENDERER_TRANSCRIPT_PROJECTION_KIND) {
        const compactRows = this.db.prepare(`
          select *
          from direct_projections
          where thread_id = ? and projection_kind = ? and status = 'valid'
        `).all(projection.threadId, COMPACT_TRANSCRIPT_PROJECTION_KIND);
        for (const compactRow of compactRows) {
          const compactProjection = this.projectionFromRow(compactRow);
          const sourceProjectionIds = Array.isArray(compactProjection.source?.sourceProjectionIds)
            ? compactProjection.source.sourceProjectionIds
            : [];
          if (!sourceProjectionIds.includes(projection.projectionId)) continue;
          this.db.prepare("update direct_projections set status = 'stale', source_json = ? where projection_id = ?")
            .run(JSON.stringify(staleProjectionSource(compactProjection)), compactProjection.projectionId);
          this.db.prepare(`
            delete from direct_thread_current_projections
            where thread_id = ? and projection_kind = ? and projection_id = ?
          `).run(projection.threadId, COMPACT_TRANSCRIPT_PROJECTION_KIND, compactProjection.projectionId);
          this.db.prepare("update direct_threads set current_compact_projection_id = '', updated_at = ? where thread_id = ? and current_compact_projection_id = ?")
            .run(nowIso(), projection.threadId, compactProjection.projectionId);
          invalidatedCompactProjectionIds.push(compactProjection.projectionId);
        }
        const contextRows = this.db.prepare(`
          select *
          from direct_projections
          where thread_id = ? and projection_kind = ? and status = 'valid'
        `).all(projection.threadId, CONTEXT_RECENT_DIALOGUE_PROJECTION_KIND);
        for (const contextRow of contextRows) {
          const contextProjection = this.projectionFromRow(contextRow);
          const sourceProjectionIds = Array.isArray(contextProjection.source?.sourceProjectionIds)
            ? contextProjection.source.sourceProjectionIds
            : [];
          if (!sourceProjectionIds.includes(projection.projectionId)) continue;
          this.db.prepare("update direct_projections set status = 'stale', source_json = ? where projection_id = ?")
            .run(JSON.stringify(staleProjectionSource(contextProjection)), contextProjection.projectionId);
          this.db.prepare(`
            delete from direct_thread_current_projections
            where thread_id = ? and projection_kind = ? and projection_id = ?
          `).run(projection.threadId, CONTEXT_RECENT_DIALOGUE_PROJECTION_KIND, contextProjection.projectionId);
          this.db.prepare("update direct_threads set current_context_recent_dialogue_projection_id = '', updated_at = ? where thread_id = ? and current_context_recent_dialogue_projection_id = ?")
            .run(nowIso(), projection.threadId, contextProjection.projectionId);
          invalidatedContextProjectionIds.push(contextProjection.projectionId);
        }
      }
      return {
        projectionId: projection.projectionId,
        status: "stale",
        staleReason,
        invalidatedCompactProjectionIds,
        invalidatedContextProjectionIds,
      };
    });
  }

  projectionParityReport(threadId, options = {}) {
    const projection = this.readRendererTranscriptProjection(threadId, { limit: 10_000 });
    const sessionStore = options.sessionStore;
    const session = sessionStore?.readSession?.(threadId);
    const oldReadDigest = sha256(stableStringify({
      sessionId: session?.sessionId || "",
      turns: session?.turns || [],
      messages: session?.messages || [],
    }));
    const projectionReadDigest = sha256(stableStringify({
      projectionId: projection?.projectionId || "",
      items: (projection?.items || []).map((item) => ({
        key: item.stableSourceItemKey,
        kind: item.itemKind,
        status: item.status,
        textDigest: item.textDigest,
      })),
    }));
    const differences = [];
    if (!projection) {
      differences.push({ kind: "missing_item", severity: "blocking" });
    } else if (session && Array.isArray(session.turns) && projection.items.length === 0 && session.turns.length > 0) {
      differences.push({ kind: "missing_item", severity: "warning" });
    }
    return {
      sessionId: normalizeString(session?.sessionId, threadId),
      threadId,
      oldReadDigest,
      projectionReadDigest,
      differences,
    };
  }

  operationByClient(projectId, clientOperationId) {
    const safeProjectId = normalizeString(projectId, "");
    const safeClientId = normalizeString(clientOperationId, "");
    if (!safeProjectId || !safeClientId) return null;
    return this.db.prepare(`
      select *
      from direct_operations
      where project_id = ? and client_operation_id = ?
    `).get(safeProjectId, safeClientId) || null;
  }

  operationResult(row) {
    if (!row) return null;
    let result = {};
    let target = {};
    try {
      result = JSON.parse(row.result_json || "{}");
    } catch {}
    try {
      target = JSON.parse(row.target_json || "{}");
    } catch {}
    return {
      operationId: row.operation_id,
      projectId: row.project_id,
      operationType: row.operation_type,
      clientOperationId: normalizeString(row.client_operation_id, ""),
      status: row.status,
      requestedAt: row.requested_at,
      committedAt: normalizeString(row.committed_at, ""),
      target,
      result,
    };
  }

  returnExistingOperationOrThrowConflict(existing, expected = {}) {
    if (!existing) return null;
    const expectedOperationType = normalizeString(expected.operationType, "");
    if (expectedOperationType && existing.operation_type !== expectedOperationType) {
      throw new Error("client_operation_id_conflict");
    }
    let result = {};
    let target = {};
    try {
      result = JSON.parse(existing.result_json || "{}");
    } catch {}
    try {
      target = JSON.parse(existing.target_json || "{}");
    } catch {}
    const expectedInputDigest = normalizeString(expected.operationInputDigest, "");
    const existingInputDigest = normalizeString(result.operationInputDigest, "");
    if (expectedInputDigest && existingInputDigest && expectedInputDigest !== existingInputDigest) {
      throw new Error("client_operation_id_conflict");
    }
    if (!existingInputDigest && isPlainObject(expected.target) && stableStringify(target) !== stableStringify(expected.target)) {
      throw new Error("client_operation_id_conflict");
    }
    return this.operationResult(existing);
  }

  threadRow(threadId) {
    return this.db.prepare("select * from direct_threads where thread_id = ?").get(requireSafeId(threadId, "thread")) || null;
  }

  requireThreadInProject(projectId, threadId) {
    const row = this.threadRow(threadId);
    if (!row || row.project_id !== projectId) throw new Error("thread_project_mismatch");
    return row;
  }

  activeTurnCount(threadId) {
    const rows = this.db.prepare(`
      select state
      from direct_turns
      where thread_id = ?
    `).all(requireSafeId(threadId, "thread"));
    return rows.filter((row) => ACTIVE_DIRECT_TURN_STATES.has(normalizeString(row.state, ""))).length;
  }

  lifecycleTransition(operationType, currentState) {
    const current = normalizeLifecycleState(currentState);
    if (operationType === "hide_thread") {
      if (current === "soft_deleted") return { valid: false, blockerCode: "invalid_lifecycle_transition" };
      if (current === "hidden") return { valid: true, nextState: "hidden", noop: true };
      return { valid: true, nextState: "hidden", noop: false };
    }
    if (operationType === "unhide_thread") {
      if (current === "active") return { valid: true, nextState: "active", noop: true };
      if (current === "hidden") return { valid: true, nextState: "active", noop: false };
      return { valid: false, blockerCode: "invalid_lifecycle_transition" };
    }
    if (operationType === "archive_thread") {
      if (current === "soft_deleted") return { valid: false, blockerCode: "invalid_lifecycle_transition" };
      if (current === "archived") return { valid: true, nextState: "archived", noop: true };
      return { valid: true, nextState: "archived", noop: false };
    }
    if (operationType === "restore_thread") {
      if (current === "active") return { valid: true, nextState: "active", noop: true };
      if (current === "hidden" || current === "archived") return { valid: true, nextState: "active", noop: false };
      return { valid: false, blockerCode: "restore_soft_deleted_requires_explicit_operation" };
    }
    if (operationType === "soft_delete_thread") {
      if (current === "soft_deleted") return { valid: true, nextState: "soft_deleted", noop: true };
      return { valid: true, nextState: "soft_deleted", noop: false };
    }
    if (operationType === "restore_soft_deleted_thread") {
      if (current === "soft_deleted") return { valid: true, nextState: "active", noop: false };
      if (current === "active") return { valid: true, nextState: "active", noop: true };
      return { valid: false, blockerCode: "invalid_lifecycle_transition" };
    }
    return { valid: false, blockerCode: "unsupported_lifecycle_operation" };
  }

  applyLifecycleOperation(operationType, input = {}, options = {}) {
    const projectId = normalizeString(input.projectId, "");
    const threadId = requireSafeId(input.threadId || input.sessionId, "thread");
    const clientOperationId = normalizeString(input.clientOperationId, "");
    const actor = normalizeString(input.actor, "user");
    const threadBefore = this.requireThreadInProject(projectId, threadId);
    const beforeState = normalizeLifecycleState(threadBefore.lifecycle_state);
    const transition = this.lifecycleTransition(operationType, beforeState);
    const requestedExpectedState = normalizeString(input.expectedCurrentLifecycleState, "");
    const digestInput = {
      schema: "direct_thread_lifecycle_operation_input@1",
      operationType,
      projectId,
      threadId,
      expectedProjectGeneration: normalizeString(input.expectedProjectGeneration, ""),
      expectedCurrentLifecycleState: requestedExpectedState,
      controllerVersion: DIRECT_THREAD_CONTROL_BUILDER_VERSION,
      safetyPolicyVersion: "direct_thread_control_safety@1",
    };
    const inputDigest = operationInputDigest(digestInput);
    const target = { threadIds: [threadId] };
    const existing = this.operationByClient(projectId, clientOperationId);
    const existingResult = this.returnExistingOperationOrThrowConflict(existing, {
      operationType,
      operationInputDigest: inputDigest,
      target,
    });
    if (existingResult) return existingResult;
    if (requestedExpectedState && requestedExpectedState !== beforeState) {
      throw new Error("lifecycle_state_changed");
    }
    const planned = this.planOperation({
      operationType,
      projectId,
      clientOperationId,
      actor,
      target,
      parameters: {
        operationInputDigest: inputDigest,
        expectedCurrentLifecycleState: beforeState,
      },
      safety: { requiresConfirmation: input.requiresConfirmation === true },
    }, options);
    if (!transition.valid) {
      const failed = this.appendOperationEvent({
        operationType,
        operationId: planned.operationId,
        projectId,
        clientOperationId,
        actor,
        eventType: "operation_failed",
        target: { threadIds: [threadId] },
        result: {
          status: "failed",
          blockerCode: transition.blockerCode,
          effects: [{
            effectKind: "operation_failed_no_effect",
            targetKind: "direct_thread",
            targetId: threadId,
            beforeDigest: threadRowDigest(threadBefore),
            afterDigest: threadRowDigest(threadBefore),
            rendererSafeSummary: transition.blockerCode,
          }],
        },
      }, options);
      return this.operationResult(this.db.prepare("select * from direct_operations where operation_id = ?").get(failed.operationId));
    }
    const now = nowIso(options.nowMs);
    const nextState = transition.nextState;
    try {
      this.transaction(() => {
        if (operationType === "soft_delete_thread" && this.activeTurnCount(threadId) > 0) {
          throw new Error("active_direct_turn_exists");
        }
        this.db.prepare(`
          update direct_threads
          set lifecycle_state = ?,
              hidden_at = ?,
              archived_at = ?,
              deleted_at = ?,
              updated_at = ?
          where thread_id = ? and project_id = ?
        `).run(
          nextState,
          nextState === "hidden" ? now : "",
          nextState === "archived" ? now : "",
          nextState === "soft_deleted" ? now : "",
          now,
          threadId,
          projectId,
        );
      });
    } catch (error) {
      if (error && error.message === "active_direct_turn_exists") {
        this.appendOperationEvent({
          operationType,
          operationId: planned.operationId,
          projectId,
          clientOperationId,
          actor,
          eventType: "operation_failed",
          target,
          result: {
            status: "failed",
            blockerCode: "active_direct_turn_exists",
            operationInputDigest: inputDigest,
            effects: [{
              effectKind: "operation_failed_no_effect",
              targetKind: "direct_thread",
              targetId: threadId,
              beforeDigest: threadRowDigest(threadBefore),
              afterDigest: threadRowDigest(threadBefore),
              rendererSafeSummary: "active_direct_turn_exists",
            }],
          },
        }, options);
      }
      throw error;
    }
    const threadAfter = this.threadRow(threadId);
    const effectKind = transition.noop ? "lifecycle_noop_already_applied" : "lifecycle_state_changed";
    const committed = this.commitOperation(planned.operationId, {
      operationType,
      projectId,
      clientOperationId,
      actor,
      target: { threadIds: [threadId] },
      result: {
        status: "committed",
        operationInputDigest: inputDigest,
        lifecycle: {
          beforeState,
          afterState: nextState,
          noop: transition.noop === true,
        },
        effects: [{
          effectKind,
          targetKind: "direct_thread",
          targetId: threadId,
          beforeDigest: threadRowDigest(threadBefore),
          afterDigest: threadRowDigest(threadAfter),
          rendererSafeSummary: `${beforeState} -> ${nextState}`,
        }],
      },
      safety: { requiresConfirmation: input.requiresConfirmation === true },
    }, options);
    this.buildThreadLifecycleProjection(projectId, { ...options, force: true });
    return this.operationResult(this.db.prepare("select * from direct_operations where operation_id = ?").get(committed.operationId));
  }

  hideThread(input = {}, options = {}) {
    return this.applyLifecycleOperation("hide_thread", input, options);
  }

  unhideThread(input = {}, options = {}) {
    return this.applyLifecycleOperation("unhide_thread", input, options);
  }

  archiveThread(input = {}, options = {}) {
    return this.applyLifecycleOperation("archive_thread", input, options);
  }

  restoreThread(input = {}, options = {}) {
    return this.applyLifecycleOperation("restore_thread", input, options);
  }

  softDeleteThread(input = {}, options = {}) {
    return this.applyLifecycleOperation("soft_delete_thread", input, options);
  }

  restoreSoftDeletedThread(input = {}, options = {}) {
    return this.applyLifecycleOperation("restore_soft_deleted_thread", input, options);
  }

  buildThreadLifecycleProjection(projectId, options = {}) {
    const safeProjectId = normalizeString(projectId, "");
    if (!safeProjectId) throw new Error("thread_lifecycle projection requires projectId.");
    const lockKey = `${safeProjectId}:${THREAD_LIFECYCLE_PROJECTION_KIND}`;
    if (this.projectionBuildLocks.has(lockKey)) throw new Error("projection_build_in_progress");
    this.projectionBuildLocks.add(lockKey);
    try {
      const rows = this.db.prepare(`
        select *
        from direct_threads
        where project_id = ?
        order by updated_at desc, thread_id asc
      `).all(safeProjectId);
      const operationManifest = this.readOperationManifest();
      const sourceDigest = sha256(stableStringify({
        schema: "thread_lifecycle_source@1",
        projectId: safeProjectId,
        threadDigests: rows.map(threadRowDigest),
        operationLedgerHeadDigest: operationManifest.hashChainHead,
        builderVersion: DIRECT_THREAD_CONTROL_BUILDER_VERSION,
      }));
      const existing = this.projectCurrentProjectionRow(safeProjectId, THREAD_LIFECYCLE_PROJECTION_KIND);
      if (!options.force && existing) {
        const existingSource = this.projectionFromRow(existing)?.source || {};
        if (existingSource.sourceDigest && existingSource.sourceDigest === sourceDigest && existing.status === "valid") {
          return {
            projectionId: existing.projection_id,
            projectionKind: THREAD_LIFECYCLE_PROJECTION_KIND,
            status: existing.status,
            reused: true,
            itemCount: this.readProjectionItems(existing.projection_id).length,
          };
        }
      }
      const projectionId = `thread_lifecycle_${sha256(`${safeProjectId}:${sourceDigest}`).slice(0, 24)}`;
      const counts = rows.reduce((acc, row) => {
        const state = normalizeLifecycleState(row.lifecycle_state);
        acc[state] = (acc[state] || 0) + 1;
        return acc;
      }, { active: 0, hidden: 0, archived: 0, soft_deleted: 0 });
      const items = rows.map((row, index) => {
        const state = normalizeLifecycleState(row.lifecycle_state);
        return {
          itemId: `${projectionId}_thread_${index + 1}`,
          stableSourceItemKey: `lifecycle:${row.thread_id}`,
          ordinal: index + 1,
          threadId: row.thread_id,
          itemKind: "thread_lifecycle_summary",
          text: normalizeString(row.title, "Untitled direct session"),
          textDigest: sha256(normalizeString(row.title, "")),
          lifecycle: {
            state,
            rendererListVisible: state === "active",
            operationIds: [],
          },
          sourceRef: {
            sourceArtifactKind: "direct_thread_index",
            sourceDigest: threadRowDigest(row),
          },
        };
      });
      return this.writeProjectProjectionBuildResult({
        projection: {
          projectionId,
          projectId: safeProjectId,
          projectionKind: THREAD_LIFECYCLE_PROJECTION_KIND,
          projectionVersion: THREAD_LIFECYCLE_PROJECTION_VERSION,
          builderVersion: DIRECT_THREAD_CONTROL_BUILDER_VERSION,
          policyId: "direct_thread_lifecycle@1",
          status: "valid",
          source: {
            schema: "thread_lifecycle_source@1",
            sourceDigest,
            operationLedgerHeadDigest: operationManifest.hashChainHead,
            counts,
          },
          projectionDigest: sha256(stableStringify({ projectionId, sourceDigest, items: items.map((item) => item.stableSourceItemKey) })),
          unsafeForContextBuild: true,
          unsafeForRenderer: false,
          createdAt: nowIso(options.nowMs),
          caps: { truncated: false, omittedCounts: {} },
          safety: noRawExposureFlags(),
          continuity: {
            composer: {
              projectionHint: "thread-control",
              enabledByProjection: false,
              authoritative: false,
              controlAuthority: "runtime-status",
            },
          },
        },
        items,
      }, { ...options, previewAttemptId: "" });
    } finally {
      this.projectionBuildLocks.delete(lockKey);
    }
  }

  readProjectProjectionByKind(projectId, projectionKind, options = {}) {
    const safeProjectId = normalizeString(projectId, "");
    const row = options.projectionId
      ? this.db.prepare("select * from direct_projections where projection_id = ? and project_id = ? and projection_kind = ?")
        .get(requireSafeId(options.projectionId, "projection"), safeProjectId, projectionKind)
      : this.projectCurrentProjectionRow(safeProjectId, projectionKind);
    const projection = this.projectionFromRow(row);
    if (!projection) return null;
    if (projection.status === "blocked" || projection.unsafeForRenderer === true) {
      return {
        schema: "renderer_safe_direct_project_projection@1",
        projectionId: projection.projectionId,
        projectId: projection.projectId,
        projectionKind,
        status: projection.status,
        unsafeForRenderer: true,
        unsafeForContextBuild: true,
        failureSummary: "Projection is blocked by renderer safety policy.",
        items: [],
        rawExposure: noRawExposureFlags(),
      };
    }
    const allItems = this.readProjectionItems(projection.projectionId);
    const offset = Math.max(0, Number(options.offset || 0));
    const limit = Number.isFinite(Number(options.limit)) && Number(options.limit) > 0 ? Number(options.limit) : allItems.length;
    return {
      schema: "renderer_safe_direct_project_projection@1",
      projectionId: projection.projectionId,
      projectId: projection.projectId,
      projectionKind,
      status: projection.status,
      staleReason: projection.staleReason,
      securityReason: projection.securityReason,
      unsafeForRenderer: projection.unsafeForRenderer,
      unsafeForContextBuild: projection.unsafeForContextBuild,
      source: projection.source,
      continuity: projection.continuity,
      caps: projection.caps || { truncated: false, omittedCounts: {} },
      items: allItems.slice(offset, offset + limit),
      page: {
        offset,
        limit,
        returned: Math.min(limit, Math.max(0, allItems.length - offset)),
        total: allItems.length,
      },
      rawExposure: noRawExposureFlags(),
    };
  }

  readThreadLifecycleProjection(projectId, options = {}) {
    return this.readProjectProjectionByKind(projectId, THREAD_LIFECYCLE_PROJECTION_KIND, options);
  }

  threadSummaryWhereClause(projectId, options = {}) {
    const includeHidden = options.includeHidden === true;
    const includeArchived = options.includeArchived === true;
    const includeSoftDeleted = options.includeSoftDeleted === true;
    const values = [normalizeString(projectId, "")];
    const where = ["project_id = ?"];
    const hiddenStates = [];
    if (!includeHidden) hiddenStates.push("hidden");
    if (!includeArchived) hiddenStates.push("archived");
    if (!includeSoftDeleted) hiddenStates.push("soft_deleted");
    if (hiddenStates.length) {
      where.push(`lifecycle_state not in (${hiddenStates.map(() => "?").join(", ")})`);
      values.push(...hiddenStates);
    }
    const textQuery = normalizeString(options.textQuery, "");
    if (textQuery) {
      where.push("lower(title) like ? escape '\\'");
      values.push(`%${escapedSqlLike(textQuery)}%`);
    }
    return { where: where.join(" and "), values };
  }

  countThreadSummaries(projectId, options = {}) {
    const clause = this.threadSummaryWhereClause(projectId, options);
    const row = this.db.prepare(`
      select count(*) as count
      from direct_threads
      where ${clause.where}
    `).get(...clause.values);
    return Number(row?.count || 0);
  }

  listThreadSummaries(projectId, options = {}) {
    const clause = this.threadSummaryWhereClause(projectId, options);
    const limit = Number.isFinite(Number(options.limit)) && Number(options.limit) > 0
      ? Math.max(1, Math.min(1000, Number(options.limit)))
      : 1000;
    const offset = Math.max(0, Number(options.offset || 0));
    return this.db.prepare(`
      select thread_id, project_id, title, source_class, lifecycle_state, updated_at
      from direct_threads
      where ${clause.where}
      order by updated_at desc, thread_id asc
      limit ? offset ?
    `).all(...clause.values, limit, offset).map((row) => ({
      threadId: row.thread_id,
      projectId: row.project_id,
      title: row.title,
      sourceClass: row.source_class,
      lifecycle: {
        state: normalizeLifecycleState(row.lifecycle_state),
        rendererListVisible: normalizeLifecycleState(row.lifecycle_state) === "active",
      },
      updatedAt: row.updated_at,
    }));
  }

  createExternalRef(input = {}, options = {}) {
    const projectId = normalizeString(input.projectId, "");
    const refKind = normalizeString(input.refKind, "");
    if (!projectId || !refKind) throw new Error("external_ref_requires_project_and_kind");
    if (input.url || input.rawUrl) throw new Error("raw_external_url_not_allowed");
    const externalRefId = normalizeString(input.externalRefId, "")
      || `external_ref_${sha256(stableStringify({
        projectId,
        refKind,
        displayTitle: normalizeString(input.displayTitle, ""),
        targetId: normalizeString(input.targetId, ""),
      })).slice(0, 24)}`;
    const metadata = {
      ...(isPlainObject(input.metadata) ? input.metadata : {}),
      urlStoredInDirectStore: false,
      transcriptImported: false,
      rightPaneMutated: false,
    };
    this.db.prepare(`
      insert into direct_external_refs (
        external_ref_id,
        project_id,
        ref_kind,
        display_title,
        renderer_safe_url_hash,
        target_id,
        metadata_json,
        created_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?)
      on conflict(external_ref_id) do update set
        display_title = excluded.display_title,
        renderer_safe_url_hash = excluded.renderer_safe_url_hash,
        target_id = excluded.target_id,
        metadata_json = excluded.metadata_json
    `).run(
      requireSafeId(externalRefId, "external ref"),
      projectId,
      refKind,
      normalizeString(input.displayTitle, "External reference"),
      normalizeString(input.rendererSafeUrlHash || input.rendererSafeEvidenceKey, ""),
      normalizeString(input.targetId, ""),
      JSON.stringify(metadata),
      nowIso(options.nowMs),
    );
    return {
      externalRefId,
      projectId,
      refKind,
      displayTitle: normalizeString(input.displayTitle, "External reference"),
      urlStoredInDirectStore: false,
      transcriptImported: false,
      rightPaneMutated: false,
    };
  }

  edgeKey(input = {}) {
    return {
      edgeKind: normalizeString(input.edgeKind, "related"),
      sourceKind: normalizeString(input.sourceKind, "direct_thread"),
      sourceId: normalizeString(input.sourceId, ""),
      targetKind: normalizeString(input.targetKind, "direct_thread"),
      targetId: normalizeString(input.targetId, ""),
    };
  }

  validateGraphEndpoint(projectId, kind, id) {
    if (kind === "direct_thread") {
      this.requireThreadInProject(projectId, id);
      return;
    }
    if (kind === "external_ref") {
      const ref = this.db.prepare("select external_ref_id from direct_external_refs where project_id = ? and external_ref_id = ?")
        .get(projectId, requireSafeId(id, "external ref"));
      if (!ref) throw new Error("external_ref_not_found");
      return;
    }
    if (kind === "derived_projection") {
      const projection = this.db.prepare("select projection_id from direct_projections where project_id = ? and projection_id = ?")
        .get(projectId, requireSafeId(id, "projection"));
      if (!projection) throw new Error("projection_not_found");
      return;
    }
    throw new Error("unsupported_graph_endpoint");
  }

  wouldCreateLineageCycle(projectId, edgeKind, sourceKind, sourceId, targetKind, targetId) {
    if (!LINEAGE_EDGE_KINDS.has(edgeKind)) return false;
    const start = `${targetKind}:${targetId}`;
    const target = `${sourceKind}:${sourceId}`;
    const seen = new Set();
    const stack = [start];
    const lineageKinds = [...LINEAGE_EDGE_KINDS];
    const rows = this.db.prepare(`
      select source_kind, source_id, target_kind, target_id
      from direct_thread_edges
      where project_id = ? and edge_kind in (${lineageKinds.map(() => "?").join(", ")}) and status = 'active'
    `).all(projectId, ...lineageKinds);
    const outgoing = new Map();
    for (const row of rows) {
      const key = `${row.source_kind}:${row.source_id}`;
      if (!outgoing.has(key)) outgoing.set(key, []);
      outgoing.get(key).push(`${row.target_kind}:${row.target_id}`);
    }
    while (stack.length) {
      const current = stack.pop();
      if (current === target) return true;
      if (seen.has(current)) continue;
      seen.add(current);
      for (const next of outgoing.get(current) || []) stack.push(next);
    }
    return false;
  }

  bridgeThreads(input = {}, options = {}) {
    const projectId = normalizeString(input.projectId, "");
    const clientOperationId = normalizeString(input.clientOperationId, "");
    const key = this.edgeKey(input);
    if (!GRAPH_EDGE_KINDS.has(key.edgeKind)) throw new Error("unsupported_graph_edge_kind");
    this.validateGraphEndpoint(projectId, key.sourceKind, key.sourceId);
    this.validateGraphEndpoint(projectId, key.targetKind, key.targetId);
    if (this.wouldCreateLineageCycle(projectId, key.edgeKind, key.sourceKind, key.sourceId, key.targetKind, key.targetId)) {
      throw new Error("lineage_cycle_detected");
    }
    const metadata = isPlainObject(input.metadata) ? input.metadata : {};
    const edgeId = normalizeString(input.edgeId, "")
      || `thread_edge_${sha256(stableStringify({ projectId, ...key })).slice(0, 24)}`;
    const inputDigest = operationInputDigest({
      schema: "direct_thread_bridge_operation_input@1",
      projectId,
      ...key,
      metadataDigest: sha256(stableStringify(metadata)),
      controllerVersion: DIRECT_THREAD_CONTROL_BUILDER_VERSION,
    });
    const target = { edgeId, ...key };
    const existing = this.operationByClient(projectId, clientOperationId);
    const existingResult = this.returnExistingOperationOrThrowConflict(existing, {
      operationType: "bridge_threads",
      operationInputDigest: inputDigest,
      target,
    });
    if (existingResult) return existingResult;
    const activeDuplicate = this.db.prepare(`
      select *
      from direct_thread_edges
      where project_id = ? and edge_kind = ? and source_kind = ? and source_id = ? and target_kind = ? and target_id = ? and status = 'active'
    `).get(projectId, key.edgeKind, key.sourceKind, key.sourceId, key.targetKind, key.targetId);
    if (activeDuplicate) {
      let existingMetadata = {};
      try {
        existingMetadata = JSON.parse(activeDuplicate.metadata_json || "{}");
      } catch {}
      const existingMetadataDigest = sha256(stableStringify(existingMetadata));
      const nextMetadataDigest = sha256(stableStringify(metadata));
      if (existingMetadataDigest !== nextMetadataDigest) throw new Error("metadata_conflict");
    }
    const planned = this.planOperation({
      operationType: "bridge_threads",
      projectId,
      clientOperationId,
      target,
      parameters: { operationInputDigest: inputDigest },
      safety: { requiresConfirmation: false },
    }, options);
    const now = nowIso(options.nowMs);
    const beforeDigest = activeDuplicate ? sha256(stableStringify(activeDuplicate)) : "";
    let effectKind = "edge_created";
    if (activeDuplicate) {
      effectKind = "lifecycle_noop_already_applied";
    } else {
      this.db.prepare(`
        insert into direct_thread_edges (
          edge_id,
          project_id,
          edge_kind,
          source_kind,
          source_id,
          target_kind,
          target_id,
          operation_id,
          status,
          created_at,
          metadata_json,
          edge_state,
          created_by_operation_id,
          updated_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, 'active', ?, ?)
      `).run(
        requireSafeId(edgeId, "edge"),
        projectId,
        key.edgeKind,
        key.sourceKind,
        key.sourceId,
        key.targetKind,
        key.targetId,
        planned.operationId,
        now,
        stableStringify(metadata),
        planned.operationId,
        now,
      );
    }
    const edgeRow = this.db.prepare("select * from direct_thread_edges where edge_id = ?").get(edgeId) || activeDuplicate;
    const committed = this.commitOperation(planned.operationId, {
      operationType: "bridge_threads",
      projectId,
      clientOperationId,
      target,
      result: {
        status: "committed",
        operationInputDigest: inputDigest,
        effects: [{
          effectKind,
          targetKind: "thread_edge",
          targetId: edgeId,
          beforeDigest,
          afterDigest: sha256(stableStringify(edgeRow || {})),
          rendererSafeSummary: `${key.edgeKind}:${key.sourceKind}->${key.targetKind}`,
        }],
      },
    }, options);
    this.buildThreadGraphProjection(projectId, { ...options, force: true });
    return this.operationResult(this.db.prepare("select * from direct_operations where operation_id = ?").get(committed.operationId));
  }

  unlinkBridge(input = {}, options = {}) {
    const projectId = normalizeString(input.projectId, "");
    const clientOperationId = normalizeString(input.clientOperationId, "");
    const key = this.edgeKey(input);
    const edgeId = normalizeString(input.edgeId, "");
    const row = edgeId
      ? this.db.prepare("select * from direct_thread_edges where project_id = ? and edge_id = ? and status = 'active'").get(projectId, edgeId)
      : this.db.prepare(`
        select *
        from direct_thread_edges
        where project_id = ? and edge_kind = ? and source_kind = ? and source_id = ? and target_kind = ? and target_id = ? and status = 'active'
      `).get(projectId, key.edgeKind, key.sourceKind, key.sourceId, key.targetKind, key.targetId);
    const targetEdgeId = normalizeString(edgeId || row?.edge_id, "");
    const target = { edgeId: targetEdgeId, ...key };
    const inputDigest = operationInputDigest({
      schema: "direct_thread_unlink_operation_input@1",
      projectId,
      edgeId: targetEdgeId,
      ...key,
    });
    const existing = this.operationByClient(projectId, clientOperationId);
    const existingResult = this.returnExistingOperationOrThrowConflict(existing, {
      operationType: "unlink_bridge",
      operationInputDigest: inputDigest,
      target,
    });
    if (existingResult) return existingResult;
    const planned = this.planOperation({
      operationType: "unlink_bridge",
      projectId,
      clientOperationId,
      target,
      parameters: {
        operationInputDigest: inputDigest,
      },
      safety: { requiresConfirmation: false },
    }, options);
    const now = nowIso(options.nowMs);
    let effectKind = "lifecycle_noop_already_applied";
    if (row) {
      this.db.prepare(`
        update direct_thread_edges
        set status = 'unlinked',
            edge_state = 'unlinked',
            removed_by_operation_id = ?,
            updated_at = ?
        where edge_id = ?
      `).run(planned.operationId, now, row.edge_id);
      effectKind = "edge_removed";
    }
    const committed = this.commitOperation(planned.operationId, {
      operationType: "unlink_bridge",
      projectId,
      clientOperationId,
      target,
      result: {
        status: "committed",
        operationInputDigest: inputDigest,
        effects: [{
          effectKind,
          targetKind: "thread_edge",
          targetId: targetEdgeId,
          beforeDigest: row ? sha256(stableStringify(row)) : "",
          afterDigest: row ? sha256(stableStringify({ ...row, status: "unlinked" })) : "",
          rendererSafeSummary: effectKind,
        }],
      },
    }, options);
    this.buildThreadGraphProjection(projectId, { ...options, force: true });
    return this.operationResult(this.db.prepare("select * from direct_operations where operation_id = ?").get(committed.operationId));
  }

  buildThreadGraphProjection(projectId, options = {}) {
    const safeProjectId = normalizeString(projectId, "");
    const threads = this.db.prepare("select thread_id, title, lifecycle_state from direct_threads where project_id = ? order by thread_id").all(safeProjectId);
    const externalRefs = this.db.prepare("select * from direct_external_refs where project_id = ? order by external_ref_id").all(safeProjectId);
    const edges = this.db.prepare("select * from direct_thread_edges where project_id = ? and status = 'active' order by edge_id").all(safeProjectId);
    const sourceDigest = sha256(stableStringify({
      schema: "thread_graph_source@1",
      projectId: safeProjectId,
      threadIds: threads.map((row) => row.thread_id),
      externalRefIds: externalRefs.map((row) => row.external_ref_id),
      edgeDigests: edges.map((row) => sha256(stableStringify(row))),
      operationLedgerHeadDigest: this.readOperationManifest().hashChainHead,
      builderVersion: DIRECT_THREAD_CONTROL_BUILDER_VERSION,
    }));
    const existing = this.projectCurrentProjectionRow(safeProjectId, THREAD_GRAPH_PROJECTION_KIND);
    if (!options.force && existing) {
      const existingSource = this.projectionFromRow(existing)?.source || {};
      if (existingSource.sourceDigest && existingSource.sourceDigest === sourceDigest && existing.status === "valid") {
        return {
          projectionId: existing.projection_id,
          projectionKind: THREAD_GRAPH_PROJECTION_KIND,
          status: existing.status,
          reused: true,
          itemCount: this.readProjectionItems(existing.projection_id).length,
        };
      }
    }
    const projectionId = `thread_graph_${sha256(`${safeProjectId}:${sourceDigest}`).slice(0, 24)}`;
    const items = [
      ...threads.map((row, index) => ({
        itemId: `${projectionId}_thread_${index + 1}`,
        stableSourceItemKey: `graph-thread:${row.thread_id}`,
        ordinal: index + 1,
        threadId: row.thread_id,
        itemKind: "graph_thread_node",
        text: row.title,
        textDigest: sha256(row.title),
        lifecycle: { state: normalizeLifecycleState(row.lifecycle_state) },
        sourceRef: { sourceArtifactKind: "direct_thread_index", sourceDigest: threadRowDigest(row) },
      })),
      ...externalRefs.map((row, index) => ({
        itemId: `${projectionId}_external_${index + 1}`,
        stableSourceItemKey: `graph-external:${row.external_ref_id}`,
        ordinal: threads.length + index + 1,
        itemKind: "graph_external_ref",
        text: row.display_title,
        textDigest: sha256(row.display_title),
        externalRef: {
          externalRefId: row.external_ref_id,
          refKind: row.ref_kind,
          targetId: normalizeString(row.target_id, ""),
          rendererSafeUrlHash: normalizeString(row.renderer_safe_url_hash, ""),
          urlStoredInDirectStore: false,
          transcriptImported: false,
        },
        sourceRef: { sourceArtifactKind: "direct_external_ref", sourceDigest: sha256(stableStringify(row)) },
      })),
      ...edges.map((row, index) => ({
        itemId: `${projectionId}_edge_${index + 1}`,
        stableSourceItemKey: `graph-edge:${row.edge_id}`,
        ordinal: threads.length + externalRefs.length + index + 1,
        itemKind: LINEAGE_EDGE_KINDS.has(row.edge_kind) ? "lineage_edge" : "bridge_edge",
        text: `${row.edge_kind}:${row.source_kind}->${row.target_kind}`,
        textDigest: sha256(`${row.edge_kind}:${row.source_kind}->${row.target_kind}`),
        edge: {
          edgeId: row.edge_id,
          edgeKind: row.edge_kind,
          sourceKind: row.source_kind,
          sourceId: row.source_id,
          targetKind: row.target_kind,
          targetId: row.target_id,
          edgeState: "active",
        },
        sourceRef: { sourceArtifactKind: "direct_thread_edge", sourceDigest: sha256(stableStringify(row)) },
      })),
    ];
    return this.writeProjectProjectionBuildResult({
      projection: {
        projectionId,
        projectId: safeProjectId,
        projectionKind: THREAD_GRAPH_PROJECTION_KIND,
        projectionVersion: THREAD_GRAPH_PROJECTION_VERSION,
        builderVersion: DIRECT_THREAD_CONTROL_BUILDER_VERSION,
        policyId: "direct_thread_graph@1",
        status: "valid",
        source: {
          schema: "thread_graph_source@1",
          sourceDigest,
          edgeCount: edges.length,
          externalRefCount: externalRefs.length,
        },
        projectionDigest: sha256(stableStringify({ sourceDigest, items: items.map((item) => item.stableSourceItemKey) })),
        unsafeForContextBuild: true,
        unsafeForRenderer: false,
        createdAt: nowIso(options.nowMs),
        caps: { truncated: false, omittedCounts: {} },
        safety: noRawExposureFlags(),
        continuity: {
          composer: {
            projectionHint: "thread-graph",
            enabledByProjection: false,
            authoritative: false,
            controlAuthority: "runtime-status",
          },
        },
      },
      items,
    }, { ...options, previewAttemptId: "" });
  }

  readThreadGraphProjection(projectId, options = {}) {
    return this.readProjectProjectionByKind(projectId, THREAD_GRAPH_PROJECTION_KIND, options);
  }

  currentValidRendererProjectionForThread(projectId, threadId, options = {}) {
    const thread = this.requireThreadInProject(projectId, threadId);
    const state = normalizeLifecycleState(thread.lifecycle_state);
    if (state === "hidden" && options.includeHidden !== true) throw new Error("source_thread_hidden");
    if (state === "archived" && options.includeArchived !== true) throw new Error("source_thread_archived");
    if (state === "soft_deleted" && options.includeSoftDeleted !== true) throw new Error("source_thread_soft_deleted");
    const row = this.currentProjectionRow(threadId, RENDERER_TRANSCRIPT_PROJECTION_KIND);
    const projection = this.projectionFromRow(row);
    if (!projection || projection.status !== "valid" || projection.unsafeForRenderer === true) throw new Error("stale_source_projection");
    return {
      thread,
      projection,
      items: this.readProjectionItems(projection.projectionId),
    };
  }

  previewSourceDigest(kind, input) {
    return sha256(stableStringify({
      schema: `${kind}_source@1`,
      ...input,
      builderVersion: DIRECT_THREAD_CONTROL_BUILDER_VERSION,
      safetyPolicyVersion: "direct_thread_control_safety@1",
    }));
  }

  writePreviewOperation(input = {}, projectionKind, buildPreview, options = {}) {
    const projectId = normalizeString(input.projectId, "");
    const clientOperationId = normalizeString(input.clientOperationId, "");
    const operationTypeByKind = {
      [MERGE_PREVIEW_PROJECTION_KIND]: "preview_merge_threads",
      [PRUNE_PREVIEW_PROJECTION_KIND]: "preview_prune_thread",
      [FORK_PREVIEW_PROJECTION_KIND]: "preview_fork_thread",
    };
    const operationType = operationTypeByKind[projectionKind];
    const target = input.target || {};
    const inputDigest = operationInputDigest({
      schema: `${projectionKind}_operation_input@1`,
      projectId,
      input,
      controllerVersion: DIRECT_THREAD_CONTROL_BUILDER_VERSION,
    });
    const existing = this.operationByClient(projectId, clientOperationId);
    const existingResult = this.returnExistingOperationOrThrowConflict(existing, {
      operationType,
      operationInputDigest: inputDigest,
      target,
    });
    if (existingResult) return existingResult;
    const planned = this.planOperation({
      operationType,
      projectId,
      clientOperationId,
      target,
      parameters: {
        operationInputDigest: inputDigest,
      },
      safety: { requiresConfirmation: false },
    }, options);
    const buildResult = buildPreview(planned.operationId);
    const writeResult = this.writeProjectProjectionBuildResult(buildResult, {
      ...options,
      force: options.force === true,
      operationId: planned.operationId,
      previewAttemptId: `preview_attempt_${planned.operationId}`,
    });
    const committed = this.commitOperation(planned.operationId, {
      operationType,
      projectId,
      clientOperationId,
      target,
      result: {
        status: "committed",
        operationInputDigest: inputDigest,
        effects: [{
          effectKind: "preview_projection_created",
          targetKind: "projection",
          targetId: writeResult.projectionId,
          beforeDigest: "",
          afterDigest: buildResult.projection.projectionDigest,
          rendererSafeSummary: projectionKind,
        }],
      },
    }, options);
    return {
      ...this.operationResult(this.db.prepare("select * from direct_operations where operation_id = ?").get(committed.operationId)),
      projectionId: writeResult.projectionId,
      projectionKind,
      status: writeResult.status,
    };
  }

  createMergePreview(input = {}, options = {}) {
    const projectId = normalizeString(input.projectId, "");
    const sourceThreadIds = Array.isArray(input.sourceThreadIds) ? input.sourceThreadIds.map((id) => requireSafeId(id, "thread")) : [];
    if (!sourceThreadIds.length || sourceThreadIds.length > MAX_PREVIEW_SOURCE_THREADS) throw new Error("preview_source_thread_count_invalid");
    return this.writePreviewOperation({
      ...input,
      projectId,
      target: { threadIds: sourceThreadIds },
    }, MERGE_PREVIEW_PROJECTION_KIND, (operationId) => {
      const sources = sourceThreadIds.map((threadId) => this.currentValidRendererProjectionForThread(projectId, threadId, input));
      const sourceDigest = this.previewSourceDigest("merge_preview", {
        projectId,
        sourceThreadIds,
        sourceProjectionIds: sources.map((entry) => entry.projection.projectionId),
        sourceProjectionDigests: sources.map((entry) => entry.projection.projectionDigest),
        ordering: normalizeString(input.ordering, "source-order"),
        caps: { maxItems: MAX_PREVIEW_ITEMS, maxTotalChars: MAX_PREVIEW_TOTAL_TEXT_CHARS },
        operationId,
      });
      const projectionId = `merge_preview_${sha256(`${projectId}:${sourceDigest}`).slice(0, 24)}`;
      const items = [];
      let totalChars = 0;
      let truncated = false;
      sources.forEach((source, sourceIndex) => {
        items.push({
          itemId: `${projectionId}_section_${sourceIndex + 1}`,
          stablePreviewItemKey: `merge-section:${source.thread.thread_id}`,
          ordinal: items.length + 1,
          threadId: source.thread.thread_id,
          itemKind: "merge_preview_section",
          text: source.thread.title,
          textDigest: sha256(source.thread.title),
          sourceStableItemKeys: [],
          sourceRefs: [{ threadId: source.thread.thread_id, projectionId: source.projection.projectionId }],
          sourceRef: { sourceArtifactKind: "merge_preview_section", sourceDigest },
        });
        for (const item of source.items) {
          if (items.length >= MAX_PREVIEW_ITEMS || totalChars >= MAX_PREVIEW_TOTAL_TEXT_CHARS) {
            truncated = true;
            break;
          }
          const clipped = truncatePreviewText(item.text);
          totalChars += clipped.text.length;
          items.push({
            ...item,
            itemId: `${projectionId}_item_${items.length + 1}`,
            stablePreviewItemKey: `merge:${source.thread.thread_id}:${item.stableSourceItemKey}`,
            ordinal: items.length + 1,
            previewItemId: `${projectionId}_item_${items.length + 1}`,
            itemKind: item.itemKind,
            text: clipped.text,
            textDigest: sha256(clipped.text),
            truncated: item.truncated === true || clipped.truncated,
            sourceStableItemKeys: [item.stableSourceItemKey],
            sourceRefs: [{ threadId: source.thread.thread_id, projectionId: source.projection.projectionId, stableSourceItemKey: item.stableSourceItemKey, turnId: item.turnId }],
            sourceRef: { sourceArtifactKind: "merge_preview_item", sourceDigest },
          });
        }
      });
      return {
        projection: this.previewProjectionBase({
          projectionId,
          projectId,
          projectionKind: MERGE_PREVIEW_PROJECTION_KIND,
          projectionVersion: MERGE_PREVIEW_PROJECTION_VERSION,
          sourceDigest,
          createdAt: nowIso(options.nowMs),
          truncated,
          omittedCounts: truncated ? { item: 1 } : {},
        }),
        items,
      };
    }, options);
  }

  createPrunePreview(input = {}, options = {}) {
    const projectId = normalizeString(input.projectId, "");
    const threadId = requireSafeId(input.threadId || input.sourceThreadId, "thread");
    const excluded = new Set(Array.isArray(input.excludedStableSourceItemKeys) ? input.excludedStableSourceItemKeys.map(String) : []);
    return this.writePreviewOperation({
      ...input,
      projectId,
      target: { threadIds: [threadId] },
    }, PRUNE_PREVIEW_PROJECTION_KIND, (operationId) => {
      const source = this.currentValidRendererProjectionForThread(projectId, threadId, input);
      const omittedItems = source.items.filter((item) => excluded.has(item.stableSourceItemKey));
      const sourceDigest = this.previewSourceDigest("prune_preview", {
        projectId,
        sourceThreadId: threadId,
        sourceRendererProjectionId: source.projection.projectionId,
        sourceRendererProjectionDigest: source.projection.projectionDigest,
        excludedStableSourceItemKeys: [...excluded].sort(),
        caps: { maxItems: MAX_PREVIEW_ITEMS, maxOmissionMarkers: MAX_PREVIEW_OMISSION_MARKERS },
        operationId,
      });
      const projectionId = `prune_preview_${sha256(`${projectId}:${sourceDigest}`).slice(0, 24)}`;
      const items = [];
      let markerWritten = false;
      for (const item of source.items) {
        if (excluded.has(item.stableSourceItemKey)) {
          if (!markerWritten) {
            markerWritten = true;
            items.push({
              itemId: `${projectionId}_omission_1`,
              stablePreviewItemKey: `prune-omission:${threadId}:${sha256([...excluded].sort().join("|")).slice(0, 12)}`,
              ordinal: items.length + 1,
              threadId,
              itemKind: "prune_omission_marker",
              text: `${omittedItems.length} item(s) omitted`,
              textDigest: sha256(`${omittedItems.length} item(s) omitted`),
              omission: {
                itemCount: omittedItems.length,
                turnCount: new Set(omittedItems.map((entry) => entry.turnId).filter(Boolean)).size,
                roleCounts: omittedItems.reduce((acc, entry) => {
                  const role = normalizeString(entry.role, "unknown");
                  acc[role] = (acc[role] || 0) + 1;
                  return acc;
                }, {}),
                toolResultCount: omittedItems.filter((entry) => /tool/i.test(entry.itemKind)).length,
              },
              sourceStableItemKeys: omittedItems.map((entry) => entry.stableSourceItemKey),
              sourceRefs: omittedItems.map((entry) => ({ threadId, projectionId: source.projection.projectionId, stableSourceItemKey: entry.stableSourceItemKey, turnId: entry.turnId })),
              sourceRef: { sourceArtifactKind: "prune_omission_marker", sourceDigest },
            });
          }
          continue;
        }
        const clipped = truncatePreviewText(item.text);
        items.push({
          ...item,
          itemId: `${projectionId}_item_${items.length + 1}`,
          stablePreviewItemKey: `prune:${threadId}:${item.stableSourceItemKey}`,
          ordinal: items.length + 1,
          previewItemId: `${projectionId}_item_${items.length + 1}`,
          text: clipped.text,
          textDigest: sha256(clipped.text),
          sourceStableItemKeys: [item.stableSourceItemKey],
          sourceRefs: [{ threadId, projectionId: source.projection.projectionId, stableSourceItemKey: item.stableSourceItemKey, turnId: item.turnId }],
          sourceRef: { sourceArtifactKind: "prune_preview_item", sourceDigest },
        });
      }
      return {
        projection: this.previewProjectionBase({
          projectionId,
          projectId,
          projectionKind: PRUNE_PREVIEW_PROJECTION_KIND,
          projectionVersion: PRUNE_PREVIEW_PROJECTION_VERSION,
          sourceDigest,
          createdAt: nowIso(options.nowMs),
          truncated: false,
          omittedCounts: { item: omittedItems.length },
        }),
        items: items.slice(0, MAX_PREVIEW_ITEMS),
      };
    }, options);
  }

  createForkPreview(input = {}, options = {}) {
    const projectId = normalizeString(input.projectId, "");
    const threadId = requireSafeId(input.threadId || input.sourceThreadId, "thread");
    const selected = new Set(Array.isArray(input.selectedStableSourceItemKeys) ? input.selectedStableSourceItemKeys.map(String) : []);
    return this.writePreviewOperation({
      ...input,
      projectId,
      target: { threadIds: [threadId] },
    }, FORK_PREVIEW_PROJECTION_KIND, (operationId) => {
      const source = this.currentValidRendererProjectionForThread(projectId, threadId, input);
      const selectedItems = selected.size ? source.items.filter((item) => selected.has(item.stableSourceItemKey)) : source.items;
      const seedShapeHash = sha256(stableStringify({
        schema: "fork_preview_seed_shape@1",
        sourceThreadId: threadId,
        sourceProjectionId: source.projection.projectionId,
        selectedStableSourceItemKeys: selectedItems.map((item) => item.stableSourceItemKey),
        seedPolicyId: "fork_preview_seed_metadata_only@1",
      }));
      const sourceDigest = this.previewSourceDigest("fork_preview", {
        projectId,
        sourceKind: "direct_thread",
        sourceId: threadId,
        sourceDigest: source.projection.projectionDigest,
        selectedStableSourceItemKeys: selectedItems.map((item) => item.stableSourceItemKey),
        seedShapeHash,
        operationId,
      });
      const projectionId = `fork_preview_${sha256(`${projectId}:${sourceDigest}`).slice(0, 24)}`;
      const items = [{
        itemId: `${projectionId}_seed_metadata`,
        stablePreviewItemKey: `fork-seed:${threadId}:${seedShapeHash.slice(0, 12)}`,
        ordinal: 1,
        threadId,
        itemKind: "fork_seed_metadata",
        text: "Fork preview seed metadata only",
        textDigest: sha256("Fork preview seed metadata only"),
        seed: {
          seedShapeHash,
          selectedItemCount: selectedItems.length,
          runnableNow: false,
          contextPackWritten: false,
          requestManifestWritten: false,
          directSessionCreated: false,
        },
        sourceStableItemKeys: selectedItems.map((item) => item.stableSourceItemKey),
        sourceRefs: selectedItems.map((item) => ({ threadId, projectionId: source.projection.projectionId, stableSourceItemKey: item.stableSourceItemKey, turnId: item.turnId })),
        sourceRef: { sourceArtifactKind: "fork_preview_seed_metadata", sourceDigest },
      }];
      return {
        projection: this.previewProjectionBase({
          projectionId,
          projectId,
          projectionKind: FORK_PREVIEW_PROJECTION_KIND,
          projectionVersion: FORK_PREVIEW_PROJECTION_VERSION,
          sourceDigest,
          createdAt: nowIso(options.nowMs),
          truncated: false,
          omittedCounts: {},
          extraContinuity: { seedShapeHash },
        }),
        items,
      };
    }, options);
  }

  previewProjectionBase(input = {}) {
    return {
      projectionId: input.projectionId,
      projectId: input.projectId,
      projectionKind: input.projectionKind,
      projectionVersion: input.projectionVersion,
      builderVersion: DIRECT_THREAD_CONTROL_BUILDER_VERSION,
      policyId: `${input.projectionKind}@1`,
      status: "valid",
      source: {
        schema: `${input.projectionKind}_source@1`,
        sourceDigest: input.sourceDigest,
      },
      projectionDigest: sha256(stableStringify({
        projectionKind: input.projectionKind,
        sourceDigest: input.sourceDigest,
        projectionVersion: input.projectionVersion,
      })),
      unsafeForContextBuild: true,
      unsafeForRenderer: false,
      createdAt: input.createdAt,
      staleReason: "",
      securityReason: "",
      caps: {
        maxItems: MAX_PREVIEW_ITEMS,
        maxTextCharsPerItem: MAX_PREVIEW_TEXT_CHARS_PER_ITEM,
        maxTotalTextChars: MAX_PREVIEW_TOTAL_TEXT_CHARS,
        truncated: input.truncated === true,
        omittedCounts: input.omittedCounts || {},
      },
      safety: noRawExposureFlags(),
      continuity: {
        providerContinuityAvailable: false,
        composerEnabled: false,
        usableForContextBuild: false,
        runnableNow: false,
        ...(input.extraContinuity || {}),
        composer: {
          projectionHint: "non-runnable-projection",
          enabledByProjection: false,
          authoritative: false,
          controlAuthority: "runtime-status",
        },
      },
    };
  }

  readOperationManifest() {
    const manifest = readJsonFile(this.operationLedgerManifestPath());
    if (manifest && manifest.schema === DIRECT_THREAD_OPERATION_LEDGER_MANIFEST_SCHEMA) return manifest;
    return {
      schema: DIRECT_THREAD_OPERATION_LEDGER_MANIFEST_SCHEMA,
      eventCount: 0,
      firstSeq: 0,
      lastSeq: 0,
      fileSizeBytes: 0,
      fileSha256: "",
      hashChainHead: "",
      hashAlgorithm: "sha256",
      updatedAt: "",
    };
  }

  appendOperationEvent(input = {}, options = {}) {
    const operationType = normalizeString(input.operationType, "");
    const eventType = normalizeString(input.eventType, "operation_planned");
    if (!DIRECT_THREAD_OPERATION_TYPES.has(operationType)) throw new Error(`Unsupported direct thread operation: ${operationType}`);
    if (!DIRECT_THREAD_OPERATION_EVENT_TYPES.has(eventType)) throw new Error(`Unsupported direct thread operation event: ${eventType}`);
    const manifest = this.readOperationManifest();
    const operationId = normalizeString(input.operationId, "") || newId("thread_operation");
    const event = {
      schema: DIRECT_THREAD_OPERATION_EVENT_SCHEMA,
      operationId,
      eventId: normalizeString(input.eventId, "") || newId("thread_operation_event"),
      projectId: normalizeString(input.projectId, ""),
      seq: manifest.lastSeq + 1,
      eventType,
      operationType,
      clientOperationId: normalizeString(input.clientOperationId, ""),
      at: normalizeString(input.at, nowIso(options.nowMs)),
      actor: normalizeString(input.actor, "user"),
      target: isPlainObject(input.target) ? input.target : { threadIds: [] },
      parameters: isPlainObject(input.parameters) ? input.parameters : {},
      result: isPlainObject(input.result) ? input.result : {},
      safety: {
        requiresConfirmation: input.safety?.requiresConfirmation === true,
        confirmedAt: normalizeString(input.safety?.confirmedAt, ""),
        deletionPlanId: normalizeString(input.safety?.deletionPlanId, ""),
        rawPathExposedToRenderer: false,
      },
      integrity: {
        previousEventDigest: normalizeString(manifest.hashChainHead, ""),
        eventDigest: "",
        algorithm: "sha256",
      },
    };
    event.integrity.eventDigest = sha256(stableStringify({ ...event, integrity: { ...event.integrity, eventDigest: "" } }));
    ensureDirectory(this.operationLedgerDir());
    fs.appendFileSync(this.operationLedgerPath(), `${JSON.stringify(event)}\n`, "utf8");
    const stat = fs.statSync(this.operationLedgerPath());
    const nextManifest = {
      schema: DIRECT_THREAD_OPERATION_LEDGER_MANIFEST_SCHEMA,
      eventCount: manifest.eventCount + 1,
      firstSeq: manifest.firstSeq || event.seq,
      lastSeq: event.seq,
      fileSizeBytes: stat.size,
      fileSha256: fileSha256(this.operationLedgerPath()),
      hashChainHead: event.integrity.eventDigest,
      hashAlgorithm: "sha256",
      updatedAt: event.at,
    };
    writeJsonAtomic(this.operationLedgerManifestPath(), nextManifest);
    this.applyOperationEvent(event);
    return event;
  }

  applyOperationEvent(event) {
    const statusByEvent = {
      operation_planned: "planned",
      operation_confirmed: "confirmed",
      operation_committed: "committed",
      operation_failed: "failed",
      operation_rolled_back: "rolled_back",
      operation_repaired: "repaired",
    };
    const status = statusByEvent[event.eventType] || "planned";
    this.transaction(() => {
      const existing = this.db.prepare("select requested_at from direct_operations where operation_id = ?").get(event.operationId);
      this.db.prepare(`
        insert into direct_operations (
          operation_id,
          project_id,
          operation_type,
          client_operation_id,
          status,
          requested_at,
          committed_at,
          operation_digest,
          ledger_offset,
          target_json,
          result_json
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        on conflict(operation_id) do update set
          status = excluded.status,
          committed_at = excluded.committed_at,
          operation_digest = excluded.operation_digest,
          ledger_offset = excluded.ledger_offset,
          target_json = excluded.target_json,
          result_json = excluded.result_json
      `).run(
        event.operationId,
        event.projectId,
        event.operationType,
        optionalString(event.clientOperationId),
        status,
        existing?.requested_at || event.at,
        event.eventType === "operation_committed" ? event.at : "",
        event.integrity.eventDigest,
        event.seq,
        JSON.stringify(event.target || {}),
        JSON.stringify(event.result || {}),
      );

      const effects = Array.isArray(event.result?.effects) ? event.result.effects : [];
      if (effects.length) {
        this.db.prepare("delete from direct_operation_effects where operation_id = ?").run(event.operationId);
        const insertEffect = this.db.prepare(`
          insert into direct_operation_effects (
          operation_id,
          effect_ordinal,
          effect_kind,
          target_kind,
          target_id,
          before_digest,
          after_digest,
          created_at,
          renderer_safe_summary
          ) values (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        effects.forEach((effect, index) => {
          insertEffect.run(
            event.operationId,
            index + 1,
            normalizeString(effect.effectKind, "unknown"),
            normalizeString(effect.targetKind, "unknown"),
            normalizeString(effect.targetId, ""),
            normalizeString(effect.beforeDigest, ""),
            normalizeString(effect.afterDigest, ""),
            event.at,
            normalizeString(effect.rendererSafeSummary, rendererSafeOperationSummary(effect.effectKind, effect.targetId)),
          );
        });
      }
    });
  }

  planOperation(input = {}, options = {}) {
    return this.appendOperationEvent({ ...input, eventType: "operation_planned" }, options);
  }

  commitOperation(operationId, input = {}, options = {}) {
    return this.appendOperationEvent({
      ...input,
      operationId,
      eventType: "operation_committed",
    }, options);
  }
}

module.exports = {
  COMPACT_TRANSCRIPT_PROJECTION_KIND,
  CONTEXT_RECENT_DIALOGUE_PROJECTION_KIND,
  DIRECT_OBLIGATIONS_PROJECTION_KIND,
  DIRECT_ROLLOUT_MANIFEST_SCHEMA,
  DIRECT_PROJECTION_KINDS,
  DIRECT_IMPORT_CHECKPOINT_CONTINUATION_POLICY_ID,
  DIRECT_READONLY_TOOL_CONTINUATION_POLICY_ID,
  DIRECT_TEXT_TURN_EMPTY_CONTEXT_POLICY_ID,
  DIRECT_TEXT_TURN_RECENT_DIALOGUE_POLICY_ID,
  FORK_PREVIEW_PROJECTION_KIND,
  MERGE_PREVIEW_PROJECTION_KIND,
  PRUNE_PREVIEW_PROJECTION_KIND,
  DIRECT_THREAD_OPERATION_EVENT_SCHEMA,
  DIRECT_THREAD_OPERATION_LEDGER_MANIFEST_SCHEMA,
  DIRECT_THREAD_OPERATION_TYPES,
  DIRECT_THREAD_STORE_MODES,
  DIRECT_THREAD_STORE_SCHEMA_VERSION,
  DIRECT_THREAD_STORE_STATUS_SCHEMA,
  DirectThreadStore,
  RENDERER_TRANSCRIPT_PROJECTION_KIND,
  THREAD_GRAPH_PROJECTION_KIND,
  THREAD_LIFECYCLE_PROJECTION_KIND,
  TOOL_CONTINUATION_CONTEXT_POLICY_ID,
  TOOL_CONTINUATION_CONTEXT_PROJECTION_KIND,
  normalizeStoreMode,
};
