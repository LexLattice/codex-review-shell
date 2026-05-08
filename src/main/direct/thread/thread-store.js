"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const {
  DIRECT_SESSION_SCHEMA,
  DIRECT_TURN_SCHEMA,
  writeJsonAtomic,
} = require("../session/session-store");

const DIRECT_THREAD_STORE_STATUS_SCHEMA = "direct_thread_store_status@1";
const DIRECT_THREAD_OPERATION_EVENT_SCHEMA = "direct_thread_operation_event@1";
const DIRECT_THREAD_OPERATION_LEDGER_MANIFEST_SCHEMA = "direct_thread_operation_ledger_manifest@1";
const DIRECT_ROLLOUT_MANIFEST_SCHEMA = "direct_rollout_manifest@1";
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
  "purge_thread",
  "merge_threads",
  "prune_thread",
  "fork_thread",
  "bridge_threads",
  "unlink_bridge",
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
  "direct_operations",
  "direct_projections",
  "direct_rollouts",
  "direct_threads",
  "direct_turns",
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

function normalizeNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
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
        item_kind text not null,
        source_ref_json text not null,
        text_value text,
        payload_json text,
        content_digest text not null,
        primary key (projection_id, ordinal),
        foreign key(projection_id) references direct_projections(projection_id)
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
        endpoint_class text not null,
        endpoint_hash text not null,
        enabled_features_json text not null,
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
      create index if not exists idx_direct_context_builds_thread
        on direct_context_builds(project_id, thread_id, built_at desc);
    `);
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
      contextBuildsAllowed: this.mode === "context_build_required" || this.mode === "projection_read",
      threadCount: countRows(this.db, "direct_threads"),
      rolloutCount: countRows(this.db, "direct_rollouts"),
      turnCount: countRows(this.db, "direct_turns"),
      operationCount: countRows(this.db, "direct_operations"),
      projectionCount: countRows(this.db, "direct_projections"),
      contextBuildCount: countRows(this.db, "direct_context_builds"),
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
          lifecycle_state = excluded.lifecycle_state,
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

      this.db.prepare("delete from direct_turns where thread_id = ?").run(manifest.threadId);
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
          source_event_start_seq,
          source_event_end_seq
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      let nextEventSeq = 1;
      turns.forEach((turn, index) => {
        const eventCount = normalizeNumber(turn.normalizedEventCount, 0);
        const startSeq = eventCount > 0 ? nextEventSeq : 0;
        const endSeq = eventCount > 0 ? nextEventSeq + eventCount - 1 : 0;
        nextEventSeq = endSeq + 1;
        insertTurn.run(
          requireSafeId(turn.turnId, "turn"),
          manifest.threadId,
          manifest.projectId,
          manifest.rolloutId,
          index + 1,
          normalizeString(turn.state, "created"),
          normalizeString(turn.streamPhase, ""),
          normalizeString(turn.createdAt || turn.requestBuiltAt || turn.streamStartedAt, ""),
          normalizeString(turn.completedAt || turn.failedAt || turn.abortedAt, ""),
          normalizeString(turn.model, session.model),
          normalizeString(turn.requestShapeHash || session.requestShapeHash, ""),
          normalizeString(turn.contextBuildId, ""),
          startSeq,
          endSeq,
        );
      });
      return { manifest, indexedTurnCount: turns.length };
    });
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
          created_at
          ) values (?, ?, ?, ?, ?, ?, ?, ?)
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
  DIRECT_ROLLOUT_MANIFEST_SCHEMA,
  DIRECT_THREAD_OPERATION_EVENT_SCHEMA,
  DIRECT_THREAD_OPERATION_LEDGER_MANIFEST_SCHEMA,
  DIRECT_THREAD_OPERATION_TYPES,
  DIRECT_THREAD_STORE_MODES,
  DIRECT_THREAD_STORE_SCHEMA_VERSION,
  DIRECT_THREAD_STORE_STATUS_SCHEMA,
  DirectThreadStore,
  normalizeStoreMode,
};
