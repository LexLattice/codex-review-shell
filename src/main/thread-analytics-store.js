"use strict";

const fs = require("node:fs");
const path = require("node:path");

const DB_SCHEMA_VERSION = 1;

function nowIso() {
  return new Date().toISOString();
}

function normalizeText(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function normalizeNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeNullableNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function buildThreadKey(sourceHome, threadId) {
  return `${normalizeText(sourceHome, "")}::${normalizeText(threadId, "")}`;
}

class ThreadAnalyticsStore {
  constructor(dbPath) {
    this.dbPath = String(dbPath || "").trim();
    if (!this.dbPath) throw new Error("Analytics database path is required.");
    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    let DatabaseSync = null;
    try {
      ({ DatabaseSync } = require("node:sqlite"));
    } catch (error) {
      const reason = error && error.message ? ` ${error.message}` : "";
      throw new Error(
        `Thread analytics requires runtime SQLite support (node:sqlite).${reason}`.trim(),
      );
    }
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec("pragma journal_mode = wal;");
    this.db.exec("pragma synchronous = normal;");
    this.migrate();
  }

  migrate() {
    this.db.exec(`
      create table if not exists analytics_threads (
        thread_key text primary key,
        source_home text not null,
        thread_id text not null,
        session_file_path text not null,
        title_snapshot text not null,
        cwd_snapshot text not null,
        originator text not null,
        created_at text,
        last_session_updated_at text,
        is_subagent integer not null default 0,
        first_seen_at text not null,
        last_seen_at text not null,
        last_scan_status text not null default 'never processed',
        current_snapshot_id integer,
        unique (source_home, thread_id)
      );

      create table if not exists analytics_snapshots (
        id integer primary key,
        thread_key text not null references analytics_threads(thread_key),
        analyzer_version text not null,
        session_updated_at text,
        file_mtime_ms integer not null,
        file_size_bytes integer not null,
        line_count integer not null,
        last_rollout_at text,
        tail_hash text not null,
        processed_at text not null,
        parse_status text not null,
        error_message text
      );

      create table if not exists analytics_events (
        snapshot_id integer not null references analytics_snapshots(id),
        seq integer not null,
        at text,
        turn_id text,
        turn_ordinal integer,
        fact_kind text not null,
        subtype text,
        phase text,
        status text,
        duration_ms integer,
        payload_json text,
        primary key (snapshot_id, seq)
      );

      create table if not exists analytics_metrics (
        snapshot_id integer not null references analytics_snapshots(id),
        metric_key text not null,
        num_value real,
        text_value text,
        unit text,
        evidence_grade text not null,
        primary key (snapshot_id, metric_key)
      );

      create table if not exists analytics_series (
        snapshot_id integer not null references analytics_snapshots(id),
        series_key text not null,
        ordinal integer not null,
        x_value text,
        y_value real,
        payload_json text,
        primary key (snapshot_id, series_key, ordinal)
      );

      create table if not exists analytics_scan_runs (
        id integer primary key,
        mode text not null,
        scope_project_id text,
        started_at text not null,
        completed_at text,
        discovered_count integer not null default 0,
        processed_count integer not null default 0,
        skipped_count integer not null default 0,
        failed_count integer not null default 0,
        notes text
      );

      create table if not exists analytics_project_links (
        project_id text not null,
        thread_key text not null references analytics_threads(thread_key),
        lane text,
        binding_id text,
        linked_at text,
        last_seen_at text not null,
        primary key (project_id, thread_key)
      );

      create index if not exists idx_analytics_threads_updated
        on analytics_threads(last_session_updated_at desc);
      create index if not exists idx_analytics_project_links_project
        on analytics_project_links(project_id, last_seen_at desc);
      create index if not exists idx_analytics_snapshots_thread
        on analytics_snapshots(thread_key, processed_at desc);
      create index if not exists idx_analytics_metrics_snapshot
        on analytics_metrics(snapshot_id);
      create index if not exists idx_analytics_series_snapshot
        on analytics_series(snapshot_id, series_key, ordinal);
    `);

    this.db.exec(`pragma user_version = ${DB_SCHEMA_VERSION};`);
  }

  close() {
    if (!this.db) return;
    this.db.close();
    this.db = null;
  }

  transaction(callback) {
    if (!this.db) throw new Error("Analytics database is closed.");
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

  startScanRun(mode, scopeProjectId = "") {
    const stmt = this.db.prepare(`
      insert into analytics_scan_runs (
        mode,
        scope_project_id,
        started_at,
        discovered_count,
        processed_count,
        skipped_count,
        failed_count
      ) values (?, ?, ?, 0, 0, 0, 0)
    `);
    const startedAt = nowIso();
    const result = stmt.run(normalizeText(mode, "manual"), normalizeText(scopeProjectId, ""), startedAt);
    return Number(result.lastInsertRowid || 0);
  }

  finishScanRun(runId, counts = {}, notes = "") {
    if (!Number.isFinite(Number(runId)) || Number(runId) <= 0) return;
    const stmt = this.db.prepare(`
      update analytics_scan_runs
      set
        completed_at = ?,
        discovered_count = ?,
        processed_count = ?,
        skipped_count = ?,
        failed_count = ?,
        notes = ?
      where id = ?
    `);
    stmt.run(
      nowIso(),
      normalizeNumber(counts.discovered, 0),
      normalizeNumber(counts.processed, 0),
      normalizeNumber(counts.skipped, 0),
      normalizeNumber(counts.failed, 0),
      normalizeText(notes, ""),
      Number(runId),
    );
  }

  upsertDiscoveredThreads(projectId, entries = [], linkHints = new Map(), seenAt = nowIso()) {
    const normalizedProjectId = normalizeText(projectId, "");
    if (!normalizedProjectId) return [];

    const upsertThread = this.db.prepare(`
      insert into analytics_threads (
        thread_key,
        source_home,
        thread_id,
        session_file_path,
        title_snapshot,
        cwd_snapshot,
        originator,
        created_at,
        last_session_updated_at,
        is_subagent,
        first_seen_at,
        last_seen_at,
        last_scan_status,
        current_snapshot_id
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, null)
      on conflict(thread_key) do update set
        source_home = excluded.source_home,
        thread_id = excluded.thread_id,
        session_file_path = case
          when excluded.session_file_path != '' then excluded.session_file_path
          else analytics_threads.session_file_path
        end,
        title_snapshot = excluded.title_snapshot,
        cwd_snapshot = excluded.cwd_snapshot,
        originator = excluded.originator,
        created_at = coalesce(excluded.created_at, analytics_threads.created_at),
        last_session_updated_at = excluded.last_session_updated_at,
        is_subagent = excluded.is_subagent,
        last_seen_at = excluded.last_seen_at,
        last_scan_status = case
          when analytics_threads.last_scan_status = 'unavailable' then 'stale'
          else analytics_threads.last_scan_status
        end
    `);

    const upsertLink = this.db.prepare(`
      insert into analytics_project_links (
        project_id,
        thread_key,
        lane,
        binding_id,
        linked_at,
        last_seen_at
      ) values (?, ?, ?, ?, ?, ?)
      on conflict(project_id, thread_key) do update set
        lane = excluded.lane,
        binding_id = excluded.binding_id,
        linked_at = coalesce(analytics_project_links.linked_at, excluded.linked_at),
        last_seen_at = excluded.last_seen_at
    `);

    const seenKeys = new Set();
    this.transaction(() => {
      for (const entry of Array.isArray(entries) ? entries : []) {
        const sourceHome = normalizeText(entry.sourceHome, "");
        const threadId = normalizeText(entry.threadId, "");
        if (!sourceHome || !threadId) continue;
        const threadKey = buildThreadKey(sourceHome, threadId);
        const hint = linkHints instanceof Map ? (linkHints.get(threadKey) || null) : null;
        upsertThread.run(
          threadKey,
          sourceHome,
          threadId,
          normalizeText(entry.sessionFilePath, ""),
          normalizeText(entry.title, "Untitled Codex thread"),
          normalizeText(entry.cwd, ""),
          normalizeText(entry.originator, "unknown"),
          normalizeText(entry.createdAt, ""),
          normalizeText(entry.updatedAt, ""),
          entry.isSubagent ? 1 : 0,
          seenAt,
          seenAt,
          "never processed",
        );
        upsertLink.run(
          normalizedProjectId,
          threadKey,
          normalizeText(hint?.lane, ""),
          normalizeText(hint?.bindingId, ""),
          normalizeText(hint?.linkedAt, seenAt),
          seenAt,
        );
        seenKeys.add(threadKey);
      }
    });
    return Array.from(seenKeys);
  }

  getCurrentSnapshotFingerprint(threadKey) {
    const stmt = this.db.prepare(`
      select
        s.id as snapshotId,
        s.analyzer_version as analyzerVersion,
        s.session_updated_at as sessionUpdatedAt,
        s.file_mtime_ms as fileMtimeMs,
        s.file_size_bytes as fileSizeBytes,
        s.parse_status as parseStatus
      from analytics_threads t
      left join analytics_snapshots s on s.id = t.current_snapshot_id
      where t.thread_key = ?
      limit 1
    `);
    return stmt.get(normalizeText(threadKey, ""));
  }

  markThreadReady(threadKey, sessionUpdatedAt = "", seenAt = nowIso()) {
    const stmt = this.db.prepare(`
      update analytics_threads
      set
        last_scan_status = 'ready',
        last_session_updated_at = ?,
        last_seen_at = ?
      where thread_key = ?
    `);
    stmt.run(
      normalizeText(sessionUpdatedAt, ""),
      normalizeText(seenAt, nowIso()),
      normalizeText(threadKey, ""),
    );
  }

  markThreadUnavailable(threadKey, sessionUpdatedAt = "", seenAt = nowIso()) {
    const stmt = this.db.prepare(`
      update analytics_threads
      set
        last_scan_status = 'unavailable',
        last_session_updated_at = ?,
        last_seen_at = ?
      where thread_key = ?
    `);
    stmt.run(
      normalizeText(sessionUpdatedAt, ""),
      normalizeText(seenAt, nowIso()),
      normalizeText(threadKey, ""),
    );
  }

  insertErrorSnapshot(threadKey, entry, analyzerVersion, errorMessage, processedAt = nowIso()) {
    const insertSnapshot = this.db.prepare(`
      insert into analytics_snapshots (
        thread_key,
        analyzer_version,
        session_updated_at,
        file_mtime_ms,
        file_size_bytes,
        line_count,
        last_rollout_at,
        tail_hash,
        processed_at,
        parse_status,
        error_message
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, 'error', ?)
    `);

    const updateThread = this.db.prepare(`
      update analytics_threads
      set
        last_scan_status = 'error',
        last_session_updated_at = ?,
        last_seen_at = ?,
        current_snapshot_id = ?
      where thread_key = ?
    `);

    this.transaction(() => {
      const snapshotResult = insertSnapshot.run(
        normalizeText(threadKey, ""),
        normalizeText(analyzerVersion, "analytics-v0"),
        normalizeText(entry?.updatedAt, ""),
        Math.round(normalizeNumber(entry?.sessionFileMtimeMs, 0)),
        Math.round(normalizeNumber(entry?.sessionFileSizeBytes, 0)),
        0,
        "",
        "",
        normalizeText(processedAt, nowIso()),
        normalizeText(errorMessage, "Unknown analytics error"),
      );
      const snapshotId = Number(snapshotResult.lastInsertRowid || 0);
      updateThread.run(
        normalizeText(entry?.updatedAt, ""),
        normalizeText(processedAt, nowIso()),
        snapshotId,
        normalizeText(threadKey, ""),
      );
    });
  }

  insertSuccessfulSnapshot(threadKey, entry, analysis, analyzerVersion, processedAt = nowIso()) {
    const fingerprint = analysis?.fingerprint || {};
    const metrics = Array.isArray(analysis?.metrics) ? analysis.metrics : [];
    const series = Array.isArray(analysis?.series) ? analysis.series : [];

    const insertSnapshot = this.db.prepare(`
      insert into analytics_snapshots (
        thread_key,
        analyzer_version,
        session_updated_at,
        file_mtime_ms,
        file_size_bytes,
        line_count,
        last_rollout_at,
        tail_hash,
        processed_at,
        parse_status,
        error_message
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready', '')
    `);

    const insertMetric = this.db.prepare(`
      insert into analytics_metrics (
        snapshot_id,
        metric_key,
        num_value,
        text_value,
        unit,
        evidence_grade
      ) values (?, ?, ?, ?, ?, ?)
    `);

    const insertSeriesPoint = this.db.prepare(`
      insert into analytics_series (
        snapshot_id,
        series_key,
        ordinal,
        x_value,
        y_value,
        payload_json
      ) values (?, ?, ?, ?, ?, ?)
    `);

    const updateThread = this.db.prepare(`
      update analytics_threads
      set
        last_scan_status = 'ready',
        last_session_updated_at = ?,
        last_seen_at = ?,
        current_snapshot_id = ?,
        session_file_path = ?,
        title_snapshot = ?,
        cwd_snapshot = ?,
        originator = ?
      where thread_key = ?
    `);

    this.transaction(() => {
      const snapshotResult = insertSnapshot.run(
        normalizeText(threadKey, ""),
        normalizeText(analyzerVersion, "analytics-v0"),
        normalizeText(fingerprint.sessionUpdatedAt, normalizeText(entry?.updatedAt, "")),
        Math.round(normalizeNumber(fingerprint.fileMtimeMs, normalizeNumber(entry?.sessionFileMtimeMs, 0))),
        Math.round(normalizeNumber(fingerprint.fileSizeBytes, normalizeNumber(entry?.sessionFileSizeBytes, 0))),
        Math.round(normalizeNumber(fingerprint.lineCount, 0)),
        normalizeText(fingerprint.lastRolloutAt, ""),
        normalizeText(fingerprint.tailHash, ""),
        normalizeText(processedAt, nowIso()),
      );
      const snapshotId = Number(snapshotResult.lastInsertRowid || 0);

      for (const metric of metrics) {
        const key = normalizeText(metric?.key, "");
        if (!key) continue;
        insertMetric.run(
          snapshotId,
          key,
          normalizeNullableNumber(metric?.numValue),
          normalizeText(metric?.textValue, ""),
          normalizeText(metric?.unit, ""),
          normalizeText(metric?.evidenceGrade, "estimated"),
        );
      }

      for (const seriesBlock of series) {
        const seriesKey = normalizeText(seriesBlock?.seriesKey, "");
        if (!seriesKey) continue;
        const points = Array.isArray(seriesBlock?.points) ? seriesBlock.points : [];
        for (let ordinal = 0; ordinal < points.length; ordinal += 1) {
          const point = points[ordinal] || {};
          insertSeriesPoint.run(
            snapshotId,
            seriesKey,
            ordinal,
            normalizeText(point.xValue, ""),
            normalizeNullableNumber(point.yValue),
            JSON.stringify(point.payload ?? null),
          );
        }
      }

      updateThread.run(
        normalizeText(fingerprint.sessionUpdatedAt, normalizeText(entry?.updatedAt, "")),
        normalizeText(processedAt, nowIso()),
        snapshotId,
        normalizeText(entry?.sessionFilePath, ""),
        normalizeText(entry?.title, "Untitled Codex thread"),
        normalizeText(entry?.cwd, ""),
        normalizeText(entry?.originator, "unknown"),
        normalizeText(threadKey, ""),
      );
    });
  }

  listProjectThreads(projectId, limit = 220) {
    const stmt = this.db.prepare(`
      select
        t.thread_key as threadKey,
        t.thread_id as threadId,
        t.source_home as sourceHome,
        t.session_file_path as sessionFilePath,
        t.title_snapshot as title,
        t.cwd_snapshot as cwd,
        t.originator as originator,
        t.last_scan_status as status,
        t.last_session_updated_at as updatedAt,
        t.last_seen_at as lastSeenAt,
        l.lane as lane,
        l.binding_id as bindingId,
        s.id as snapshotId,
        s.processed_at as processedAt,
        s.parse_status as parseStatus,
        s.error_message as errorMessage,
        (select num_value from analytics_metrics where snapshot_id = s.id and metric_key = 'turn_count') as turnCount,
        (select num_value from analytics_metrics where snapshot_id = s.id and metric_key = 'thread_wall_clock_span_ms') as wallClockSpanMs,
        (select num_value from analytics_metrics where snapshot_id = s.id and metric_key = 'command_execution_count') as commandExecutionCount
      from analytics_project_links l
      join analytics_threads t on t.thread_key = l.thread_key
      left join analytics_snapshots s on s.id = t.current_snapshot_id
      where l.project_id = ?
      order by coalesce(t.last_session_updated_at, '') desc, coalesce(s.processed_at, '') desc, t.title_snapshot asc
      limit ?
    `);
    return stmt.all(normalizeText(projectId, ""), Math.max(1, Math.min(Number(limit) || 220, 500)));
  }

  getProjectThreadDashboard(projectId, threadKey) {
    const threadStmt = this.db.prepare(`
      select
        t.thread_key as threadKey,
        t.thread_id as threadId,
        t.source_home as sourceHome,
        t.session_file_path as sessionFilePath,
        t.title_snapshot as title,
        t.cwd_snapshot as cwd,
        t.originator as originator,
        t.last_scan_status as status,
        t.last_session_updated_at as updatedAt,
        l.lane as lane,
        l.binding_id as bindingId,
        s.id as snapshotId,
        s.processed_at as processedAt,
        s.parse_status as parseStatus,
        s.error_message as errorMessage,
        s.line_count as lineCount,
        s.last_rollout_at as lastRolloutAt
      from analytics_project_links l
      join analytics_threads t on t.thread_key = l.thread_key
      left join analytics_snapshots s on s.id = t.current_snapshot_id
      where l.project_id = ? and t.thread_key = ?
      limit 1
    `);
    const row = threadStmt.get(normalizeText(projectId, ""), normalizeText(threadKey, ""));
    if (!row) return null;

    const snapshotId = Number(row.snapshotId || 0);
    const metricsStmt = this.db.prepare(`
      select
        metric_key as key,
        num_value as numValue,
        text_value as textValue,
        unit,
        evidence_grade as evidenceGrade
      from analytics_metrics
      where snapshot_id = ?
      order by metric_key asc
    `);

    const seriesStmt = this.db.prepare(`
      select
        series_key as seriesKey,
        ordinal,
        x_value as xValue,
        y_value as yValue,
        payload_json as payloadJson
      from analytics_series
      where snapshot_id = ?
      order by series_key asc, ordinal asc
    `);

    const metricsRows = snapshotId > 0 ? metricsStmt.all(snapshotId) : [];
    const seriesRows = snapshotId > 0 ? seriesStmt.all(snapshotId) : [];
    const metrics = {};
    for (const metric of metricsRows) {
      metrics[metric.key] = {
        key: metric.key,
        numValue: metric.numValue,
        textValue: metric.textValue || "",
        unit: metric.unit || "",
        evidenceGrade: metric.evidenceGrade || "estimated",
      };
    }

    const series = {};
    for (const point of seriesRows) {
      if (!series[point.seriesKey]) series[point.seriesKey] = [];
      let payload = null;
      if (point.payloadJson) {
        try {
          payload = JSON.parse(point.payloadJson);
        } catch {
          payload = null;
        }
      }
      series[point.seriesKey].push({
        xValue: point.xValue || "",
        yValue: point.yValue,
        payload,
      });
    }

    return {
      thread: row,
      snapshot: snapshotId > 0
        ? {
            id: snapshotId,
            processedAt: row.processedAt || "",
            parseStatus: row.parseStatus || "ready",
            errorMessage: row.errorMessage || "",
            lineCount: row.lineCount || 0,
            lastRolloutAt: row.lastRolloutAt || "",
          }
        : null,
      metrics,
      series,
    };
  }
}

module.exports = {
  ThreadAnalyticsStore,
  buildThreadKey,
};
