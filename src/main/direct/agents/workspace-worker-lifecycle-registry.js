"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { assertWorkspaceWorkerCleanupPlanSafe } = require("./workspace-worker-cleanup");

const WORKSPACE_WORKER_LIFECYCLE_REGISTRY_SCHEMA = "direct_workspace_worker_lifecycle_registry@1";
const WORKSPACE_WORKER_SESSION_SCHEMA = "direct_workspace_worker_session@1";
const WORKSPACE_WORKER_LIFECYCLE_EVENT_SCHEMA = "direct_workspace_worker_lifecycle_event@1";
const WORKSPACE_WORKER_REGISTRY_FILE = "direct-workspace-worker-lifecycle.sqlite";

const SESSION_STATES = new Set([
  "registered",
  "active",
  "cancelling",
  "completed",
  "failed",
  "cancelled",
  "cleanup_eligible",
  "cleaned",
]);
const TERMINAL_EXECUTION_STATES = new Set(["completed", "failed", "cancelled"]);
const ALLOWED_TRANSITIONS = new Map([
  ["registered", new Set(["active", "failed", "cancelled"])],
  ["active", new Set(["cancelling", "completed", "failed"])],
  ["cancelling", new Set(["cancelled"])],
  ["completed", new Set(["cleanup_eligible"])],
  ["failed", new Set(["cleanup_eligible"])],
  ["cancelled", new Set(["cleanup_eligible"])],
  ["cleanup_eligible", new Set(["cleaned"])],
  ["cleaned", new Set()],
]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value).filter((key) => value[key] !== undefined).sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function digestFor(domain, value) {
  return `sha256:${crypto.createHash("sha256").update(`${domain}\0${stableStringify(value)}`).digest("hex")}`;
}

function nowIso(now = Date.now) {
  return new Date(now()).toISOString();
}

function parseJson(value, code) {
  try {
    return JSON.parse(String(value));
  } catch {
    fail(code);
  }
}

function safeId(value, label) {
  const id = normalizeString(value, "");
  if (!id || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/.test(id)) {
    fail(`direct_workspace_worker_${label}_invalid`);
  }
  return id;
}

function normalizeBinding(input = {}) {
  if (!isPlainObject(input)) fail("direct_workspace_worker_binding_invalid");
  const binding = {
    workerKey: safeId(input.workerKey, "worker_key"),
    branchName: normalizeString(input.branchName, ""),
    baseCommit: normalizeString(input.baseCommit, ""),
    headCommit: normalizeString(input.headCommit || input.baseCommit, ""),
    worktreePathDigest: normalizeString(input.worktreePathDigest, ""),
    sourceRepositoryDigest: normalizeString(input.sourceRepositoryDigest, ""),
    rawWorkspacePathIncluded: false,
  };
  if (!binding.branchName || !binding.baseCommit || !binding.worktreePathDigest) {
    fail("direct_workspace_worker_binding_incomplete");
  }
  if (Object.keys(input).some((key) => /(^|_)(path|root|directory)$/i.test(key) && key !== "worktreePathDigest")) {
    fail("direct_workspace_worker_binding_raw_path_forbidden");
  }
  binding.bindingDigest = digestFor("direct-workspace-worker-binding@1", binding);
  if (input.bindingDigest && input.bindingDigest !== binding.bindingDigest) {
    fail("direct_workspace_worker_binding_digest_mismatch");
  }
  return binding;
}

function sessionDigest(session) {
  const copy = { ...session };
  delete copy.sessionDigest;
  return digestFor("direct-workspace-worker-session@1", copy);
}

function buildEvent({ operationId, eventKind, before, after, occurredAt }) {
  const event = {
    schema: WORKSPACE_WORKER_LIFECYCLE_EVENT_SCHEMA,
    eventId: `workspace_worker_event_${digestFor("direct-workspace-worker-event-id@1", {
      operationId,
      sessionId: after.sessionId,
    }).slice(7, 31)}`,
    operationId,
    eventKind,
    sessionId: after.sessionId,
    leaseId: after.leaseId,
    fromState: before?.state || "",
    toState: after.state,
    beforeRevision: Number(before?.revision || 0),
    afterRevision: after.revision,
    occurredAt,
    rawWorkspacePathIncluded: false,
  };
  event.eventDigest = digestFor("direct-workspace-worker-lifecycle-event@1", event);
  return event;
}

class WorkspaceWorkerLifecycleRegistry {
  constructor(options = {}) {
    const rootDir = normalizeString(options.rootDir, "");
    const dbPath = normalizeString(
      options.dbPath,
      rootDir ? path.join(rootDir, WORKSPACE_WORKER_REGISTRY_FILE) : "",
    );
    if (!options.db && !dbPath) fail("direct_workspace_worker_registry_path_required");
    if (!options.db) fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.dbPath = dbPath;
    this.db = options.db || new DatabaseSync(dbPath);
    this.ownsDatabase = !options.db;
    this.now = typeof options.now === "function" ? options.now : Date.now;
    this.ensureSchema();
  }

  ensureOpen() {
    if (!this.db) fail("direct_workspace_worker_registry_closed");
  }

  ensureSchema() {
    this.ensureOpen();
    this.db.exec("pragma journal_mode = WAL");
    this.db.exec("pragma foreign_keys = ON");
    this.db.exec("pragma busy_timeout = 5000");
    this.db.exec(`
      create table if not exists workspace_worker_registry_meta (
        key text primary key,
        value text not null
      );
      create table if not exists workspace_worker_sessions (
        session_id text primary key,
        child_agent_id text not null unique,
        lease_id text not null unique,
        state text not null,
        revision integer not null,
        session_digest text not null,
        session_json text not null,
        updated_at text not null
      );
      create table if not exists workspace_worker_lifecycle_events (
        sequence integer primary key autoincrement,
        event_id text not null unique,
        operation_id text not null unique,
        session_id text not null,
        event_kind text not null,
        from_state text not null,
        to_state text not null,
        event_digest text not null unique,
        event_json text not null,
        after_session_json text not null,
        occurred_at text not null,
        foreign key(session_id) references workspace_worker_sessions(session_id)
      );
      create index if not exists workspace_worker_events_session_idx
        on workspace_worker_lifecycle_events(session_id, sequence);
    `);
    const existing = this.db.prepare(
      "select value from workspace_worker_registry_meta where key = 'schema'",
    ).get();
    if (existing && existing.value !== WORKSPACE_WORKER_LIFECYCLE_REGISTRY_SCHEMA) {
      fail("direct_workspace_worker_registry_schema_unsupported");
    }
    this.db.prepare(`
      insert into workspace_worker_registry_meta(key, value) values ('schema', ?)
      on conflict(key) do update set value = excluded.value
    `).run(WORKSPACE_WORKER_LIFECYCLE_REGISTRY_SCHEMA);
  }

  withImmediateTransaction(callback) {
    this.ensureOpen();
    this.db.exec("begin immediate");
    try {
      const result = callback();
      this.db.exec("commit");
      return result;
    } catch (error) {
      try { this.db.exec("rollback"); } catch {}
      throw error;
    }
  }

  readSessionRow(sessionId) {
    return this.db.prepare(
      "select session_json from workspace_worker_sessions where session_id = ?",
    ).get(sessionId);
  }

  session(sessionId) {
    this.ensureOpen();
    const row = this.readSessionRow(safeId(sessionId, "session_id"));
    return row ? parseJson(row.session_json, "direct_workspace_worker_session_json_invalid") : null;
  }

  sessionForChild(childAgentId) {
    this.ensureOpen();
    const row = this.db.prepare(
      "select session_json from workspace_worker_sessions where child_agent_id = ?",
    ).get(safeId(childAgentId, "child_agent_id"));
    return row ? parseJson(row.session_json, "direct_workspace_worker_session_json_invalid") : null;
  }

  sessions(input = {}) {
    this.ensureOpen();
    const projectId = normalizeString(input.projectId, "");
    return this.db.prepare("select session_json from workspace_worker_sessions order by updated_at, session_id")
      .all()
      .map((row) => parseJson(row.session_json, "direct_workspace_worker_session_json_invalid"))
      .filter((session) => !projectId || session.projectId === projectId);
  }

  events(sessionId) {
    this.ensureOpen();
    return this.db.prepare(`
      select event_json from workspace_worker_lifecycle_events
      where session_id = ? order by sequence
    `).all(safeId(sessionId, "session_id"))
      .map((row) => parseJson(row.event_json, "direct_workspace_worker_event_json_invalid"));
  }

  recoverySnapshot() {
    const rows = this.sessions();
    const candidates = rows.filter((session) => ["active", "cancelling"].includes(session.state));
    const snapshot = {
      schema: "direct_workspace_worker_recovery_snapshot@1",
      status: candidates.length ? "reconciliation_required" : "clean",
      candidateCount: candidates.length,
      candidates: candidates.map((session) => ({
        sessionId: session.sessionId,
        leaseId: session.leaseId,
        childAgentId: session.childAgentId,
        state: session.state,
        leaseState: session.leaseState,
        processState: session.processState,
        revision: session.revision,
        bindingDigest: normalizeString(session.binding?.bindingDigest, ""),
        automaticReplayAllowed: false,
        automaticCleanupAllowed: false,
        rawWorkspacePathIncluded: false,
      })),
      rawWorkspacePathIncluded: false,
    };
    snapshot.snapshotDigest = digestFor("direct-workspace-worker-recovery-snapshot@1", snapshot);
    return snapshot;
  }

  openSession(input = {}) {
    const childAgentId = safeId(input.childAgentId, "child_agent_id");
    const sessionId = safeId(
      input.sessionId || `workspace_worker_session_${crypto.randomUUID().replace(/-/g, "")}`,
      "session_id",
    );
    const leaseId = safeId(
      input.leaseId || `workspace_worker_lease_${crypto.randomUUID().replace(/-/g, "")}`,
      "lease_id",
    );
    const operationId = safeId(input.operationId || `open:${sessionId}`, "operation_id");
    const occurredAt = nowIso(this.now);
    return this.withImmediateTransaction(() => {
      const priorOperation = this.db.prepare(
        "select after_session_json from workspace_worker_lifecycle_events where operation_id = ?",
      ).get(operationId);
      if (priorOperation) {
        return parseJson(priorOperation.after_session_json, "direct_workspace_worker_session_json_invalid");
      }
      const existing = this.readSessionRow(sessionId);
      const existingChild = this.db.prepare(
        "select session_json from workspace_worker_sessions where child_agent_id = ?",
      ).get(childAgentId);
      if (existing || existingChild) fail("direct_workspace_worker_session_identity_conflict");
      const session = {
        schema: WORKSPACE_WORKER_SESSION_SCHEMA,
        sessionId,
        leaseId,
        childAgentId,
        projectId: safeId(input.projectId || "project_direct_agents", "project_id"),
        workThreadId: normalizeString(input.workThreadId, ""),
        primaryThreadId: normalizeString(input.primaryThreadId, ""),
        workspaceMode: "isolated_worktree",
        toolProfile: normalizeString(input.toolProfile, "read_only_worker"),
        state: "registered",
        leaseState: "reserved",
        processState: "not_started",
        binding: null,
        cancellation: {
          requested: false,
          reasonCode: "",
          requestedAt: "",
          acknowledged: false,
          acknowledgedAt: "",
        },
        cleanupPlanDigest: "",
        revision: 1,
        createdAt: occurredAt,
        updatedAt: occurredAt,
        rawWorkspacePathIncluded: false,
      };
      session.sessionDigest = sessionDigest(session);
      const event = buildEvent({ operationId, eventKind: "session_registered", before: null, after: session, occurredAt });
      this.db.prepare(`
        insert into workspace_worker_sessions(
          session_id, child_agent_id, lease_id, state, revision,
          session_digest, session_json, updated_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        session.sessionId,
        session.childAgentId,
        session.leaseId,
        session.state,
        session.revision,
        session.sessionDigest,
        JSON.stringify(session),
        session.updatedAt,
      );
      this.insertEvent(event, session);
      return session;
    });
  }

  insertEvent(event, afterSession) {
    this.db.prepare(`
      insert into workspace_worker_lifecycle_events(
        event_id, operation_id, session_id, event_kind, from_state, to_state,
        event_digest, event_json, after_session_json, occurred_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.eventId,
      event.operationId,
      event.sessionId,
      event.eventKind,
      event.fromState,
      event.toState,
      event.eventDigest,
      JSON.stringify(event),
      JSON.stringify(afterSession),
      event.occurredAt,
    );
  }

  mutateSession(sessionId, input = {}) {
    const safeSessionId = safeId(sessionId, "session_id");
    const operationId = safeId(input.operationId, "operation_id");
    const eventKind = safeId(input.eventKind, "event_kind");
    return this.withImmediateTransaction(() => {
      const priorOperation = this.db.prepare(
        "select after_session_json from workspace_worker_lifecycle_events where operation_id = ?",
      ).get(operationId);
      if (priorOperation) {
        return parseJson(priorOperation.after_session_json, "direct_workspace_worker_session_json_invalid");
      }
      const row = this.readSessionRow(safeSessionId);
      if (!row) fail("direct_workspace_worker_session_missing");
      const before = parseJson(row.session_json, "direct_workspace_worker_session_json_invalid");
      if (input.expectedRevision !== undefined && Number(input.expectedRevision) !== before.revision) {
        fail("direct_workspace_worker_session_revision_conflict");
      }
      const nextState = normalizeString(input.nextState, before.state);
      if (!SESSION_STATES.has(nextState)) fail("direct_workspace_worker_session_state_invalid");
      if (nextState !== before.state && !ALLOWED_TRANSITIONS.get(before.state)?.has(nextState)) {
        fail("direct_workspace_worker_session_transition_invalid");
      }
      const patch = typeof input.patch === "function" ? input.patch(before) : input.patch;
      const occurredAt = nowIso(this.now);
      const after = {
        ...before,
        ...(isPlainObject(patch) ? patch : {}),
        schema: WORKSPACE_WORKER_SESSION_SCHEMA,
        sessionId: before.sessionId,
        leaseId: before.leaseId,
        childAgentId: before.childAgentId,
        state: nextState,
        revision: before.revision + 1,
        createdAt: before.createdAt,
        updatedAt: occurredAt,
        rawWorkspacePathIncluded: false,
      };
      after.sessionDigest = sessionDigest(after);
      const event = buildEvent({ operationId, eventKind, before, after, occurredAt });
      const result = this.db.prepare(`
        update workspace_worker_sessions
        set state = ?, revision = ?, session_digest = ?, session_json = ?, updated_at = ?
        where session_id = ? and revision = ?
      `).run(
        after.state,
        after.revision,
        after.sessionDigest,
        JSON.stringify(after),
        after.updatedAt,
        after.sessionId,
        before.revision,
      );
      if (Number(result.changes) !== 1) fail("direct_workspace_worker_session_revision_conflict");
      this.insertEvent(event, after);
      return after;
    });
  }

  bindWorkspace(sessionId, input = {}) {
    const binding = normalizeBinding(input.binding || input);
    return this.mutateSession(sessionId, {
      operationId: input.operationId || `bind:${sessionId}:${binding.bindingDigest}`,
      eventKind: "workspace_bound",
      expectedRevision: input.expectedRevision,
      patch: (before) => {
        if (before.binding && before.binding.bindingDigest !== binding.bindingDigest) {
          fail("direct_workspace_worker_binding_rebind_forbidden");
        }
        return { binding };
      },
    });
  }

  activateLease(sessionId, input = {}) {
    return this.mutateSession(sessionId, {
      operationId: input.operationId || `activate:${sessionId}`,
      eventKind: "lease_activated",
      nextState: "active",
      expectedRevision: input.expectedRevision,
      patch: { leaseState: "active", processState: "running" },
    });
  }

  requestCancellation(sessionId, input = {}) {
    const session = this.session(sessionId);
    if (!session) fail("direct_workspace_worker_session_missing");
    const reasonCode = normalizeString(input.reasonCode, "direct_agent_cancelled");
    if (session.state === "registered") {
      return this.mutateSession(sessionId, {
        operationId: input.operationId || `cancel-before-start:${sessionId}`,
        eventKind: "cancelled_before_start",
        nextState: "cancelled",
        patch: {
          leaseState: "released",
          processState: "quiescent",
          cancellation: {
            requested: true,
            reasonCode,
            requestedAt: nowIso(this.now),
            acknowledged: true,
            acknowledgedAt: nowIso(this.now),
          },
        },
      });
    }
    return this.mutateSession(sessionId, {
      operationId: input.operationId || `request-cancel:${sessionId}`,
      eventKind: "cancellation_requested",
      nextState: "cancelling",
      patch: (before) => ({
        leaseState: "active",
        processState: "cancelling",
        cancellation: {
          ...before.cancellation,
          requested: true,
          reasonCode,
          requestedAt: nowIso(this.now),
          acknowledged: false,
          acknowledgedAt: "",
        },
      }),
    });
  }

  acknowledgeCancellation(sessionId, input = {}) {
    return this.mutateSession(sessionId, {
      operationId: input.operationId || `ack-cancel:${sessionId}`,
      eventKind: "cancellation_acknowledged",
      nextState: "cancelled",
      patch: (before) => ({
        leaseState: "released",
        processState: "quiescent",
        cancellation: {
          ...before.cancellation,
          requested: true,
          reasonCode: normalizeString(input.reasonCode, before.cancellation?.reasonCode || "direct_agent_cancelled"),
          acknowledged: true,
          acknowledgedAt: nowIso(this.now),
        },
      }),
    });
  }

  settleSession(sessionId, input = {}) {
    const state = normalizeString(input.state, "failed");
    if (!new Set(["completed", "failed"]).has(state)) {
      fail("direct_workspace_worker_settlement_state_invalid");
    }
    return this.mutateSession(sessionId, {
      operationId: input.operationId || `settle:${sessionId}:${state}`,
      eventKind: `session_${state}`,
      nextState: state,
      patch: {
        leaseState: "released",
        processState: "quiescent",
        blockerCode: normalizeString(input.blockerCode, ""),
        resultDigest: normalizeString(input.resultDigest, ""),
      },
    });
  }

  markCleanupEligible(sessionId, input = {}) {
    const plan = input.plan;
    if (!isPlainObject(plan) || plan.canRemove !== true || plan.forceRemovalAllowed !== false || !plan.planDigest) {
      fail("direct_workspace_worker_cleanup_plan_not_safe");
    }
    try {
      assertWorkspaceWorkerCleanupPlanSafe(plan);
    } catch {
      fail("direct_workspace_worker_cleanup_plan_not_safe");
    }
    const before = this.session(sessionId);
    if (!before) fail("direct_workspace_worker_session_missing");
    if (
      plan.sessionId !== before.sessionId ||
      Number(plan.sessionRevision) !== before.revision ||
      plan.bindingDigest !== before.binding?.bindingDigest
    ) {
      fail("direct_workspace_worker_cleanup_plan_binding_mismatch");
    }
    return this.mutateSession(sessionId, {
      operationId: input.operationId || `cleanup-eligible:${sessionId}:${plan.planDigest}`,
      eventKind: "cleanup_eligible",
      nextState: "cleanup_eligible",
      patch: { cleanupPlanDigest: plan.planDigest },
    });
  }

  markCleaned(sessionId, input = {}) {
    if (input.removed !== true || input.forced === true || !normalizeString(input.receiptDigest, "")) {
      fail("direct_workspace_worker_cleanup_receipt_unsafe");
    }
    const before = this.session(sessionId);
    if (!before || before.cleanupPlanDigest !== input.planDigest) {
      fail("direct_workspace_worker_cleanup_plan_digest_mismatch");
    }
    return this.mutateSession(sessionId, {
      operationId: input.operationId || `cleaned:${sessionId}:${input.planDigest}`,
      eventKind: "workspace_cleaned",
      nextState: "cleaned",
      patch: {
        cleanupReceiptDigest: normalizeString(input.receiptDigest, ""),
        cleanedAt: nowIso(this.now),
      },
    });
  }

  descriptor() {
    const rows = this.sessions();
    return {
      schema: WORKSPACE_WORKER_LIFECYCLE_REGISTRY_SCHEMA,
      persistence: "sqlite_wal",
      sessionCount: rows.length,
      activeLeaseCount: rows.filter((row) => row.leaseState === "active").length,
      cancellingCount: rows.filter((row) => row.state === "cancelling").length,
      cleanupEligibleCount: rows.filter((row) => row.state === "cleanup_eligible").length,
      rawWorkspacePathIncluded: false,
    };
  }

  close() {
    if (!this.db) return;
    if (this.ownsDatabase) this.db.close();
    this.db = null;
  }
}

module.exports = {
  SESSION_STATES,
  TERMINAL_EXECUTION_STATES,
  WORKSPACE_WORKER_LIFECYCLE_EVENT_SCHEMA,
  WORKSPACE_WORKER_LIFECYCLE_REGISTRY_SCHEMA,
  WORKSPACE_WORKER_REGISTRY_FILE,
  WORKSPACE_WORKER_SESSION_SCHEMA,
  WorkspaceWorkerLifecycleRegistry,
  digestFor,
  normalizeBinding,
};
