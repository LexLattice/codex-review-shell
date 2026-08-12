"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const {
  assertWorkspaceWorkerCleanupPlanSafe,
  assertWorkspaceWorkerCleanupReceiptSafe,
} = require("./workspace-worker-cleanup");

const WORKSPACE_WORKER_LIFECYCLE_REGISTRY_SCHEMA = "direct_workspace_worker_lifecycle_registry@1";
const WORKSPACE_WORKER_SESSION_SCHEMA = "direct_workspace_worker_session@1";
const WORKSPACE_WORKER_LIFECYCLE_EVENT_SCHEMA = "direct_workspace_worker_lifecycle_event@1";
const WORKSPACE_WORKER_RECONCILIATION_RECEIPT_SCHEMA = "direct_workspace_worker_reconciliation_receipt@1";
const WORKSPACE_WORKER_SETTLEMENT_RECEIPT_SCHEMA = "direct_workspace_worker_settlement_receipt@1";
const WORKSPACE_WORKER_REGISTRY_FILE = "direct-workspace-worker-lifecycle.sqlite";
const WORKSPACE_WORKER_LAUNCH_IDENTITY_SCHEMA = "direct_workspace_worker_launch_identity@1";
const WORKSPACE_WORKER_DELEGATION_AUTHORITY_BINDING_SCHEMA = "direct_workspace_worker_delegation_authority_binding@1";

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
  ["cancelling", new Set(["cancelled", "failed"])],
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

function publicLifecycleErrorCode(value, fallback = "") {
  const code = normalizeString(value, "");
  return /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/.test(code) ? code : fallback;
}

function lifecycleResultDigest(value) {
  const digest = normalizeString(value, "");
  if (digest && !/^sha256:[a-f0-9]{64}$/.test(digest)) {
    fail("direct_workspace_worker_result_digest_invalid");
  }
  return digest;
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

function normalizeMutationOutcome(value) {
  if (value == null) return null;
  if (!isPlainObject(value) || value.schema !== "workspace_backend_mutation_outcome@1") {
    fail("direct_workspace_worker_mutation_outcome_invalid");
  }
  const committed = value.committed === true;
  const base = {
    schema: "workspace_backend_mutation_outcome@1",
    requestId: normalizeString(value.requestId, ""),
    method: normalizeString(value.method, ""),
    commitKind: normalizeString(value.commitKind, ""),
    committed,
    ...(committed ? {} : {
      indeterminate: value.indeterminate === true,
      partialMutationPossible: value.partialMutationPossible === true,
    }),
    retainedForInspection: value.retainedForInspection === true,
    ...(committed
      ? { resultDigest: normalizeString(value.resultDigest, "") }
      : { failureCode: publicLifecycleErrorCode(value.failureCode, "") }),
    rawPathIncluded: false,
  };
  const expectedDigest = `sha256:${crypto.createHash("sha256").update(stableStringify(base)).digest("hex")}`;
  if (
    !base.requestId || !base.method || !base.commitKind ||
    value.rawPathIncluded !== false ||
    value.outcomeDigest !== expectedDigest ||
    (committed && !/^sha256:[a-f0-9]{64}$/.test(base.resultDigest)) ||
    (!committed && (
      base.indeterminate !== true ||
      base.partialMutationPossible !== true ||
      !base.failureCode
    ))
  ) fail("direct_workspace_worker_mutation_outcome_invalid");
  return { ...base, outcomeDigest: expectedDigest };
}

function mergeMutationOutcome(existingValue, incomingValue) {
  const existing = normalizeMutationOutcome(existingValue);
  const incoming = normalizeMutationOutcome(incomingValue);
  if (existing && incoming && existing.outcomeDigest !== incoming.outcomeDigest) {
    fail("direct_workspace_worker_mutation_outcome_conflict");
  }
  return incoming || existing;
}

function normalizeRuntimeCancellationReceipt(value, mutationOutcome = null, expected = {}) {
  if (value == null) return null;
  if (!isPlainObject(value) || value.schema !== "direct_workspace_worker_cancellation_receipt@1") {
    fail("direct_workspace_worker_cancellation_receipt_invalid");
  }
  const base = {
    schema: "direct_workspace_worker_cancellation_receipt@1",
    targetRequestId: normalizeString(value.targetRequestId, ""),
    launchDigest: normalizeString(value.launchDigest, ""),
    lifecycleSessionId: normalizeString(value.lifecycleSessionId, ""),
    lifecycleLeaseId: normalizeString(value.lifecycleLeaseId, ""),
    reasonCode: normalizeString(value.reasonCode, ""),
    acknowledged: value.acknowledged === true,
    quiesced: value.quiesced === true,
    acknowledgementKind: normalizeString(value.acknowledgementKind, ""),
    outcomeDigest: normalizeString(value.outcomeDigest, ""),
    rawProcessDetailsIncluded: false,
  };
  const expectedDigest = digestFor("direct-workspace-worker-cancellation-receipt@1", base);
  if (
    base.acknowledged !== true ||
    base.quiesced !== true ||
    !/^sha256:[a-f0-9]{64}$/.test(base.launchDigest) ||
    !/^[A-Za-z][A-Za-z0-9._:-]{0,127}$/.test(base.reasonCode) ||
    !/^[a-z0-9][a-z0-9._:-]{0,127}$/.test(base.acknowledgementKind) ||
    value.rawProcessDetailsIncluded !== false ||
    value.receiptDigest !== expectedDigest ||
    base.outcomeDigest !== normalizeString(mutationOutcome?.outcomeDigest, "") ||
    (mutationOutcome && base.targetRequestId !== mutationOutcome.requestId) ||
    (expected.launchDigest && base.launchDigest !== expected.launchDigest) ||
    (expected.sessionId && base.lifecycleSessionId !== expected.sessionId) ||
    (expected.leaseId && base.lifecycleLeaseId !== expected.leaseId) ||
    (expected.reasonCode && base.reasonCode !== expected.reasonCode)
  ) fail("direct_workspace_worker_cancellation_receipt_invalid");
  return { ...base, receiptDigest: expectedDigest };
}

function buildLifecycleCancellationReceipt(session, runtimeReceipt, reasonCode) {
  if (!runtimeReceipt) return null;
  const base = {
    schema: "direct_workspace_worker_lifecycle_cancellation_receipt@1",
    sessionId: session.sessionId,
    leaseId: session.leaseId,
    reasonCode: normalizeString(reasonCode, "direct_agent_cancelled"),
    launchDigest: runtimeReceipt.launchDigest,
    runtimeLifecycleSessionId: runtimeReceipt.lifecycleSessionId,
    runtimeLifecycleLeaseId: runtimeReceipt.lifecycleLeaseId,
    runtimeReceiptDigest: runtimeReceipt.receiptDigest,
    targetRequestId: runtimeReceipt.targetRequestId,
    acknowledgementKind: runtimeReceipt.acknowledgementKind,
    outcomeDigest: runtimeReceipt.outcomeDigest,
    acknowledged: true,
    quiesced: true,
    rawWorkspacePathIncluded: false,
  };
  return {
    ...base,
    receiptDigest: digestFor("direct-workspace-worker-lifecycle-cancellation-receipt@1", base),
  };
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

function exactDigest(value, code, optional = false) {
  const digest = normalizeString(value, "");
  if (optional && !digest) return "";
  if (!/^sha256:[a-f0-9]{64}$/i.test(digest)) fail(code);
  return digest.toLowerCase();
}

function normalizeDelegationAuthority(input) {
  if (input === undefined || input === null) return null;
  if (!isPlainObject(input)) fail("direct_workspace_worker_delegation_authority_binding_invalid");
  const policyId = safeId(input.policyId, "delegation_policy_id");
  const policyRevision = Number(input.policyRevision || 0);
  const sourceId = safeId(input.sourceId, "delegation_source_id");
  const sourceDigest = exactDigest(input.sourceDigest, "direct_workspace_worker_delegation_source_digest_invalid");
  const upstreamToolPolicyDigest = exactDigest(
    input.upstreamToolPolicyDigest,
    "direct_workspace_worker_upstream_tool_policy_digest_invalid",
  );
  const projectId = safeId(input.projectId, "delegation_project_id");
  const workThreadId = safeId(input.workThreadId, "delegation_work_thread_id");
  const roleLane = normalizeString(input.roleLane, "");
  const authorityLineageDigest = digestFor(
    "direct-workspace-worker-delegation-authority-lineage@1",
    {
      policyId,
      policyRevision,
      sourceId,
      sourceDigest,
      upstreamToolPolicyDigest,
      projectId,
      workThreadId,
      roleLane,
    },
  );
  const base = {
    schema: WORKSPACE_WORKER_DELEGATION_AUTHORITY_BINDING_SCHEMA,
    parentAuthorityBoundaryDigest: exactDigest(
      input.parentAuthorityBoundaryDigest,
      "direct_workspace_worker_parent_authority_digest_invalid",
    ),
    policyId,
    policyRevision,
    policyDigest: exactDigest(input.policyDigest, "direct_workspace_worker_delegation_policy_digest_invalid"),
    sourceId,
    sourceDigest,
    upstreamToolPolicyDigest,
    authorityLineageDigest,
    issuedAt: normalizeString(input.issuedAt, ""),
    expiresAt: normalizeString(input.expiresAt, ""),
    projectId,
    workThreadId,
    roleLane,
    rawAuthorityPacketIncluded: false,
    rawWorkspacePathIncluded: false,
  };
  if (
    input.schema !== WORKSPACE_WORKER_DELEGATION_AUTHORITY_BINDING_SCHEMA ||
    input.authorityLineageDigest !== authorityLineageDigest ||
    !Number.isInteger(base.policyRevision) || base.policyRevision < 1 ||
    base.roleLane !== "implementation_worker" ||
    !Number.isFinite(Date.parse(base.issuedAt)) ||
    !Number.isFinite(Date.parse(base.expiresAt)) ||
    Date.parse(base.expiresAt) <= Date.parse(base.issuedAt) ||
    input.rawAuthorityPacketIncluded !== false ||
    input.rawWorkspacePathIncluded !== false
  ) {
    fail("direct_workspace_worker_delegation_authority_binding_invalid");
  }
  const authorityDigest = digestFor("direct-workspace-worker-delegation-authority-binding@1", base);
  if (input.authorityDigest !== authorityDigest) {
    fail("direct_workspace_worker_delegation_authority_digest_mismatch");
  }
  return { ...base, authorityDigest };
}

function normalizeLaunchIdentity(input) {
  if (input === undefined || input === null) return null;
  if (!isPlainObject(input)) fail("direct_workspace_worker_launch_identity_invalid");
  const base = {
    schema: WORKSPACE_WORKER_LAUNCH_IDENTITY_SCHEMA,
    launchOperationId: safeId(input.launchOperationId, "launch_operation_id"),
    operationKeyDigest: exactDigest(input.operationKeyDigest, "direct_workspace_worker_launch_operation_key_digest_invalid"),
    parentSessionDigest: exactDigest(input.parentSessionDigest, "direct_workspace_worker_parent_session_digest_invalid"),
    parentTurnDigest: exactDigest(input.parentTurnDigest, "direct_workspace_worker_parent_turn_digest_invalid"),
    obligationDigest: exactDigest(input.obligationDigest, "direct_workspace_worker_obligation_digest_invalid"),
    callDigest: exactDigest(input.callDigest, "direct_workspace_worker_call_digest_invalid", true),
    taskName: safeId(input.taskName, "launch_task_name"),
    canonicalInputDigest: exactDigest(input.canonicalInputDigest, "direct_workspace_worker_launch_input_digest_invalid"),
    authorityDigest: exactDigest(input.authorityDigest, "direct_workspace_worker_launch_authority_digest_invalid"),
    authorityLineageDigest: exactDigest(
      input.authorityLineageDigest,
      "direct_workspace_worker_launch_authority_lineage_digest_invalid",
    ),
    rawProviderArgumentsIncluded: false,
    rawTaskIncluded: false,
    rawWorkspacePathIncluded: false,
  };
  if (
    input.schema !== WORKSPACE_WORKER_LAUNCH_IDENTITY_SCHEMA ||
    input.rawProviderArgumentsIncluded !== false ||
    input.rawTaskIncluded !== false ||
    input.rawWorkspacePathIncluded !== false
  ) {
    fail("direct_workspace_worker_launch_identity_invalid");
  }
  const launchIdentityDigest = digestFor("direct-workspace-worker-launch-identity@1", base);
  if (input.launchIdentityDigest !== launchIdentityDigest) {
    fail("direct_workspace_worker_launch_identity_digest_mismatch");
  }
  return { ...base, launchIdentityDigest };
}

function sessionDigest(session) {
  const copy = { ...session };
  delete copy.sessionDigest;
  return digestFor("direct-workspace-worker-session@1", copy);
}

function buildWorkspaceWorkerReconciliationReceipt(input = {}) {
  const receipt = {
    schema: WORKSPACE_WORKER_RECONCILIATION_RECEIPT_SCHEMA,
    sessionId: safeId(input.sessionId, "session_id"),
    expectedRevision: Number(input.expectedRevision),
    outcome: normalizeString(input.outcome, "failed"),
    reasonCode: normalizeString(input.reasonCode, "direct_workspace_worker_restart_interrupted"),
    providerAcknowledged: input.providerAcknowledged === true,
    backendQuiesced: input.backendQuiesced === true,
    providerAcknowledgementDigest: normalizeString(input.providerAcknowledgementDigest, ""),
    backendQuiescenceDigest: normalizeString(input.backendQuiescenceDigest, ""),
    verifierId: safeId(input.verifierId, "reconciliation_verifier_id"),
    processIdentityRecovered: input.processIdentityRecovered === true,
    bindingRetainedForInspection: input.bindingRetainedForInspection === true,
    rawWorkspacePathIncluded: false,
  };
  if (!Number.isInteger(receipt.expectedRevision) || receipt.expectedRevision < 1) {
    fail("direct_workspace_worker_reconciliation_revision_invalid");
  }
  if (!["failed", "cancelled"].includes(receipt.outcome)) {
    fail("direct_workspace_worker_reconciliation_outcome_invalid");
  }
  if (
    !/^sha256:[a-f0-9]{64}$/.test(receipt.providerAcknowledgementDigest) ||
    !/^sha256:[a-f0-9]{64}$/.test(receipt.backendQuiescenceDigest)
  ) {
    fail("direct_workspace_worker_reconciliation_evidence_invalid");
  }
  receipt.receiptDigest = digestFor("direct-workspace-worker-reconciliation-receipt@1", receipt);
  return receipt;
}

function buildEvent({ operationId, operationDigest, eventKind, before, after, occurredAt }) {
  const event = {
    schema: WORKSPACE_WORKER_LIFECYCLE_EVENT_SCHEMA,
    eventId: `workspace_worker_event_${digestFor("direct-workspace-worker-event-id@1", {
      operationId,
      sessionId: after.sessionId,
    }).slice(7, 31)}`,
    operationId,
    operationDigest,
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
        operation_digest text not null,
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
    const eventColumns = new Set(this.db.prepare("pragma table_info(workspace_worker_lifecycle_events)")
      .all().map((column) => column.name));
    if (!eventColumns.has("operation_digest")) {
      this.db.exec("alter table workspace_worker_lifecycle_events add column operation_digest text not null default ''");
    }
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

  sessionForLaunchOperation(launchOperationId) {
    this.ensureOpen();
    const row = this.db.prepare(`
      select session_id from workspace_worker_lifecycle_events
      where operation_id = ? and event_kind = 'session_registered'
    `).get(safeId(launchOperationId, "launch_operation_id"));
    return row ? this.session(row.session_id) : null;
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

  settlementReceipt(sessionId) {
    this.ensureOpen();
    const safeSessionId = safeId(sessionId, "session_id");
    const sessionRow = this.db.prepare(`select * from workspace_worker_sessions
      where session_id = ?`).get(safeSessionId);
    if (!sessionRow) fail("direct_workspace_worker_session_missing");
    const session = parseJson(sessionRow.session_json, "direct_workspace_worker_session_json_invalid");
    const binding = normalizeBinding(session.binding || {});
    const expectedCustody = {
      state: "bound",
      workerKey: binding.workerKey,
      branchName: binding.branchName,
      bindingDigest: binding.bindingDigest,
      retainedForInspection: true,
      rawWorkspacePathIncluded: false,
    };
    expectedCustody.custodyDigest = digestFor("direct-workspace-worker-custody@1", expectedCustody);
    if (session.schema !== WORKSPACE_WORKER_SESSION_SCHEMA || session.sessionId !== safeSessionId ||
        session.workspaceMode !== "isolated_worktree" || session.rawWorkspacePathIncluded !== false ||
        stableStringify(session.binding) !== stableStringify(binding) ||
        stableStringify(session.workspaceCustody) !== stableStringify(expectedCustody) ||
        session.state !== "completed" || session.leaseState !== "released" ||
        session.processState !== "quiescent" || !session.binding?.bindingDigest ||
        !/^sha256:[a-f0-9]{64}$/.test(normalizeString(session.resultDigest, ""))) {
      fail("direct_workspace_worker_settlement_receipt_unavailable");
    }
    if (session.sessionDigest !== sessionDigest(session) || sessionRow.session_digest !== session.sessionDigest ||
        Number(sessionRow.revision) !== session.revision || sessionRow.state !== session.state ||
        sessionRow.child_agent_id !== session.childAgentId || sessionRow.lease_id !== session.leaseId) {
      fail("direct_workspace_worker_settlement_session_integrity_failed");
    }
    const eventRow = this.db.prepare(`select * from workspace_worker_lifecycle_events
      where session_id = ? order by sequence desc limit 1`).get(safeSessionId);
    if (!eventRow) fail("direct_workspace_worker_settlement_event_missing");
    const event = parseJson(eventRow.event_json, "direct_workspace_worker_event_json_invalid");
    const after = parseJson(eventRow.after_session_json, "direct_workspace_worker_session_json_invalid");
    const eventForDigest = { ...event };
    delete eventForDigest.eventDigest;
    if (stableStringify(after) !== stableStringify(session) || event.eventDigest !==
        digestFor("direct-workspace-worker-lifecycle-event@1", eventForDigest) ||
        eventRow.event_digest !== event.eventDigest || eventRow.event_id !== event.eventId ||
        event.sessionId !== session.sessionId || event.toState !== "completed" ||
        event.afterRevision !== session.revision || eventRow.to_state !== event.toState ||
        eventRow.event_kind !== "session_completed") {
      fail("direct_workspace_worker_settlement_event_integrity_failed");
    }
    const receipt = {
      schema: WORKSPACE_WORKER_SETTLEMENT_RECEIPT_SCHEMA,
      sessionId: session.sessionId,
      childAgentId: session.childAgentId,
      projectId: session.projectId,
      workThreadId: session.workThreadId,
      state: session.state,
      leaseState: session.leaseState,
      processState: session.processState,
      revision: session.revision,
      bindingDigest: session.binding.bindingDigest,
      resultDigest: session.resultDigest,
      sessionDigest: session.sessionDigest,
      terminalEventId: event.eventId,
      terminalEventDigest: event.eventDigest,
      rawWorkspacePathIncluded: false,
    };
    receipt.receiptDigest = digestFor("direct-workspace-worker-settlement-receipt@1", receipt);
    return Object.freeze(receipt);
  }

  recoverySnapshot() {
    const rows = this.sessions();
    const candidates = rows.filter((session) =>
      ["registered", "active", "cancelling"].includes(session.state) ||
      ["reserved", "active"].includes(session.leaseState));
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
        custodyState: normalizeString(session.workspaceCustody?.state, "unbound"),
        custodyDigest: normalizeString(session.workspaceCustody?.custodyDigest, ""),
        mutationOutcomeDigest: normalizeString(session.mutationOutcome?.outcomeDigest, ""),
        partialMutationPossible: session.mutationOutcome?.partialMutationPossible === true,
        launchOperationId: normalizeString(session.launchIdentity?.launchOperationId, ""),
        launchIdentityDigest: normalizeString(session.launchIdentity?.launchIdentityDigest, ""),
        delegationAuthorityDigest: normalizeString(session.delegationAuthority?.authorityDigest, ""),
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
    const launchDigest = normalizeString(input.launchDigest, "");
    if (!/^sha256:[a-f0-9]{64}$/.test(launchDigest)) {
      fail("direct_workspace_worker_launch_digest_invalid");
    }
    const launchIdentity = normalizeLaunchIdentity(input.launchIdentity);
    const delegationAuthority = normalizeDelegationAuthority(input.delegationAuthority);
    if (Boolean(launchIdentity) !== Boolean(delegationAuthority)) {
      fail("direct_workspace_worker_launch_authority_binding_incomplete");
    }
    if (launchIdentity && launchIdentity.authorityDigest !== delegationAuthority.authorityDigest) {
      fail("direct_workspace_worker_launch_authority_digest_mismatch");
    }
    if (launchIdentity && launchIdentity.authorityLineageDigest !== delegationAuthority.authorityLineageDigest) {
      fail("direct_workspace_worker_launch_authority_lineage_mismatch");
    }
    const projectId = safeId(input.projectId || "project_direct_agents", "project_id");
    const workThreadId = normalizeString(input.workThreadId, "");
    const primaryThreadId = normalizeString(input.primaryThreadId, "");
    if (delegationAuthority && (
      delegationAuthority.projectId !== projectId ||
      delegationAuthority.workThreadId !== workThreadId ||
      launchIdentity.parentSessionDigest !== digestFor(
        "direct-workspace-worker-parent-session-id@1",
        primaryThreadId,
      )
    )) {
      fail("direct_workspace_worker_launch_authority_scope_mismatch");
    }
    const operationId = safeId(
      input.operationId || launchIdentity?.launchOperationId || `open:${sessionId}`,
      "operation_id",
    );
    if (launchIdentity && operationId !== launchIdentity.launchOperationId) {
      fail("direct_workspace_worker_launch_operation_id_mismatch");
    }
    const operationDigest = digestFor("direct-workspace-worker-lifecycle-operation@1", {
      eventKind: "session_registered",
      sessionId,
      leaseId,
      childAgentId,
      launchDigest,
      projectId,
      workThreadId,
      primaryThreadId,
      toolProfile: normalizeString(input.toolProfile, "read_only_worker"),
      launchIdentity,
      delegationAuthority,
    });
    const occurredAt = nowIso(this.now);
    return this.withImmediateTransaction(() => {
      const priorOperation = this.readPriorOperation(operationId, {
        operationDigest,
        sessionId,
        eventKind: "session_registered",
      });
      if (priorOperation) {
        return priorOperation;
      }
      const existing = this.readSessionRow(sessionId);
      const existingChild = this.db.prepare(
        "select session_json from workspace_worker_sessions where child_agent_id = ?",
      ).get(childAgentId);
      const existingLaunch = this.db.prepare(
        "select session_json from workspace_worker_sessions",
      ).all().some((row) => parseJson(
        row.session_json,
        "direct_workspace_worker_session_json_invalid",
      ).launchDigest === launchDigest);
      if (existing || existingChild || existingLaunch) {
        fail("direct_workspace_worker_session_identity_conflict");
      }
      const session = {
        schema: WORKSPACE_WORKER_SESSION_SCHEMA,
        sessionId,
        leaseId,
        childAgentId,
        launchDigest,
        projectId,
        workThreadId,
        primaryThreadId,
        workspaceMode: "isolated_worktree",
        toolProfile: normalizeString(input.toolProfile, "read_only_worker"),
        launchIdentity,
        delegationAuthority,
        state: "registered",
        leaseState: "reserved",
        processState: "not_started",
        binding: null,
        workspaceCustody: {
          state: "unbound",
          workerKey: "",
          branchName: "",
          custodyDigest: "",
          retainedForInspection: true,
          rawWorkspacePathIncluded: false,
        },
        cancellation: {
          requested: false,
          reasonCode: "",
          requestedAt: "",
          acknowledged: false,
          acknowledgedAt: "",
        },
        mutationOutcome: null,
        cleanupPlanDigest: "",
        revision: 1,
        createdAt: occurredAt,
        updatedAt: occurredAt,
        rawWorkspacePathIncluded: false,
      };
      session.sessionDigest = sessionDigest(session);
      const event = buildEvent({
        operationId,
        operationDigest,
        eventKind: "session_registered",
        before: null,
        after: session,
        occurredAt,
      });
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
        event_id, operation_id, operation_digest, session_id, event_kind, from_state, to_state,
        event_digest, event_json, after_session_json, occurred_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.eventId,
      event.operationId,
      event.operationDigest,
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

  readPriorOperation(operationId, expected = {}) {
    const row = this.db.prepare(`select session_id, event_kind, operation_digest,
      event_json, after_session_json from workspace_worker_lifecycle_events
      where operation_id = ?`).get(operationId);
    if (!row) return null;
    const event = parseJson(row.event_json, "direct_workspace_worker_event_json_invalid");
    const storedOperationDigest = normalizeString(row.operation_digest || event.operationDigest, "");
    if (!storedOperationDigest) {
      fail("direct_workspace_worker_operation_digest_unverifiable");
    }
    if (
      row.session_id !== expected.sessionId ||
      row.event_kind !== expected.eventKind ||
      storedOperationDigest !== expected.operationDigest
    ) fail("direct_workspace_worker_operation_id_conflict");
    return parseJson(row.after_session_json, "direct_workspace_worker_session_json_invalid");
  }

  mutateSession(sessionId, input = {}) {
    const safeSessionId = safeId(sessionId, "session_id");
    const operationId = safeId(input.operationId, "operation_id");
    const eventKind = safeId(input.eventKind, "event_kind");
    const nextStateIntent = normalizeString(input.nextState, "");
    const operationDigest = digestFor("direct-workspace-worker-lifecycle-operation@1", {
      eventKind,
      sessionId: safeSessionId,
      nextState: nextStateIntent,
      expectedRevision: input.expectedRevision === undefined ? null : Number(input.expectedRevision),
      operationInput: isPlainObject(input.operationInput) ? input.operationInput : {},
    });
    return this.withImmediateTransaction(() => {
      const priorOperation = this.readPriorOperation(operationId, {
        operationDigest,
        sessionId: safeSessionId,
        eventKind,
      });
      if (priorOperation) {
        return priorOperation;
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
      const event = buildEvent({ operationId, operationDigest, eventKind, before, after, occurredAt });
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
      operationInput: { binding },
      patch: (before) => {
        if (before.binding && before.binding.bindingDigest !== binding.bindingDigest) {
          fail("direct_workspace_worker_binding_rebind_forbidden");
        }
        if (before.workspaceCustody?.state !== "provisioning" && before.workspaceCustody?.state !== "bound") {
          fail("direct_workspace_worker_binding_without_provisioning_custody");
        }
        if (
          before.workspaceCustody.workerKey !== binding.workerKey ||
          before.workspaceCustody.branchName !== binding.branchName
        ) {
          fail("direct_workspace_worker_binding_provisioning_custody_mismatch");
        }
        const workspaceCustody = {
          state: "bound",
          workerKey: binding.workerKey,
          branchName: binding.branchName,
          bindingDigest: binding.bindingDigest,
          retainedForInspection: true,
          rawWorkspacePathIncluded: false,
        };
        workspaceCustody.custodyDigest = digestFor("direct-workspace-worker-custody@1", workspaceCustody);
        return { binding, workspaceCustody };
      },
    });
  }

  beginProvisioning(sessionId, input = {}) {
    const workerKey = safeId(input.workerKey, "worker_key");
    const branchName = normalizeString(input.branchName, "");
    if (!branchName) fail("direct_workspace_worker_provisioning_branch_missing");
    const workspaceCustody = {
      state: "provisioning",
      workerKey,
      branchName,
      bindingDigest: "",
      retainedForInspection: true,
      rawWorkspacePathIncluded: false,
    };
    workspaceCustody.custodyDigest = digestFor("direct-workspace-worker-custody@1", workspaceCustody);
    return this.mutateSession(sessionId, {
      operationId: input.operationId || `provision:${sessionId}:${workspaceCustody.custodyDigest}`,
      eventKind: "workspace_provisioning_started",
      operationInput: { workspaceCustody },
      patch: (before) => {
        if (before.workspaceCustody?.state === "bound") {
          fail("direct_workspace_worker_provisioning_after_binding_forbidden");
        }
        if (
          before.workspaceCustody?.state === "provisioning" &&
          before.workspaceCustody.custodyDigest !== workspaceCustody.custodyDigest
        ) {
          fail("direct_workspace_worker_provisioning_custody_conflict");
        }
        return { workspaceCustody };
      },
    });
  }

  activateLease(sessionId, input = {}) {
    return this.mutateSession(sessionId, {
      operationId: input.operationId || `activate:${sessionId}`,
      eventKind: "lease_activated",
      nextState: "active",
      expectedRevision: input.expectedRevision,
      operationInput: {},
      patch: { leaseState: "active", processState: "running" },
    });
  }

  requestCancellation(sessionId, input = {}) {
    const session = this.session(sessionId);
    if (!session) fail("direct_workspace_worker_session_missing");
    const reasonCode = normalizeString(input.reasonCode, "direct_agent_cancelled");
    if (!/^[A-Za-z][A-Za-z0-9._:-]{0,127}$/.test(reasonCode)) {
      fail("direct_workspace_worker_cancellation_reason_invalid");
    }
    if (session.state === "registered") {
      return this.mutateSession(sessionId, {
        operationId: input.operationId || `cancel-before-start:${sessionId}`,
        eventKind: "cancelled_before_start",
        nextState: "cancelled",
        operationInput: { reasonCode },
        patch: {
          leaseState: "released",
          processState: "quiescent",
          blockerCode: reasonCode,
          resultDigest: "",
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
      operationInput: { reasonCode },
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

  recordMutationOutcome(sessionId, input = {}) {
    const mutationOutcome = normalizeMutationOutcome(input.mutationOutcome || input);
    if (!mutationOutcome) fail("direct_workspace_worker_mutation_outcome_required");
    return this.mutateSession(sessionId, {
      operationId: input.operationId ||
        `record-mutation-outcome:${sessionId}:${mutationOutcome.outcomeDigest.slice(7, 31)}`,
      eventKind: "mutation_outcome_recorded",
      operationInput: { mutationOutcome },
      patch: (before) => {
        if (!["registered", "active", "cancelling"].includes(before.state)) {
          fail("direct_workspace_worker_mutation_outcome_state_invalid");
        }
        if (
          before.mutationOutcome &&
          before.mutationOutcome.outcomeDigest !== mutationOutcome.outcomeDigest
        ) fail("direct_workspace_worker_mutation_outcome_conflict");
        return { mutationOutcome };
      },
    });
  }

  acknowledgeCancellation(sessionId, input = {}) {
    const current = this.session(sessionId);
    if (!current) fail("direct_workspace_worker_session_missing");
    const mutationOutcome = mergeMutationOutcome(current.mutationOutcome, input.mutationOutcome);
    const establishedReason = normalizeString(
      current.cancellation?.reasonCode,
      "direct_agent_cancelled",
    );
    const suppliedReason = normalizeString(input.reasonCode, establishedReason);
    if (suppliedReason !== establishedReason) {
      fail("direct_workspace_worker_cancellation_reason_conflict");
    }
    const reasonCode = establishedReason;
    const runtimeReceipt = normalizeRuntimeCancellationReceipt(
      input.cancellationReceipt,
      mutationOutcome,
      {
        launchDigest: current.launchDigest,
        sessionId: current.sessionId,
        leaseId: current.leaseId,
        reasonCode,
      },
    );
    if (!runtimeReceipt) fail("direct_workspace_worker_cancellation_receipt_required");
    const blockerCode = publicLifecycleErrorCode(input.blockerCode, reasonCode);
    const resultDigest = lifecycleResultDigest(input.resultDigest);
    return this.mutateSession(sessionId, {
      operationId: input.operationId || `ack-cancel:${sessionId}`,
      eventKind: "cancellation_acknowledged",
      nextState: "cancelled",
      operationInput: { reasonCode, blockerCode, resultDigest, mutationOutcome, runtimeReceipt },
      patch: (before) => {
        const effectiveOutcome = mergeMutationOutcome(before.mutationOutcome, mutationOutcome);
        normalizeRuntimeCancellationReceipt(runtimeReceipt, effectiveOutcome, {
          launchDigest: before.launchDigest,
          sessionId: before.sessionId,
          leaseId: before.leaseId,
          reasonCode: before.cancellation?.reasonCode,
        });
        if (before.cancellation?.reasonCode !== reasonCode) {
          fail("direct_workspace_worker_cancellation_reason_conflict");
        }
        return {
          leaseState: "released",
          processState: "quiescent",
          blockerCode,
          resultDigest,
          cancellation: {
            ...before.cancellation,
            requested: true,
            reasonCode,
            acknowledged: true,
            acknowledgedAt: nowIso(this.now),
          },
          cancellationReceipt: buildLifecycleCancellationReceipt(before, runtimeReceipt, reasonCode),
          mutationOutcome: effectiveOutcome,
        };
      },
    });
  }

  settleSession(sessionId, input = {}) {
    const state = normalizeString(input.state, "failed");
    if (!new Set(["completed", "failed"]).has(state)) {
      fail("direct_workspace_worker_settlement_state_invalid");
    }
    const current = this.session(sessionId);
    if (!current) fail("direct_workspace_worker_session_missing");
    if (state === "completed" && normalizeString(input.blockerCode, "")) {
      fail("direct_workspace_worker_completed_blocker_forbidden");
    }
    const resultDigest = lifecycleResultDigest(input.resultDigest);
    const mutationOutcome = mergeMutationOutcome(current.mutationOutcome, input.mutationOutcome);
    const reasonCode = normalizeString(
      current.cancellation?.reasonCode,
      input.blockerCode || "direct_agent_cancelled",
    );
    const blockerCode = publicLifecycleErrorCode(
      input.blockerCode,
      current.cancellation?.requested === true
        ? publicLifecycleErrorCode(reasonCode, "direct_agent_cancelled")
        : state === "completed" ? "" : "direct_workspace_worker_failed",
    );
    if (
      current.cancellation?.requested === true &&
      input.reasonCode &&
      normalizeString(input.reasonCode, "") !== reasonCode
    ) fail("direct_workspace_worker_cancellation_reason_conflict");
    const runtimeReceipt = input.cancellationReceipt == null
      ? null
      : normalizeRuntimeCancellationReceipt(input.cancellationReceipt, mutationOutcome, {
          launchDigest: current.launchDigest,
          sessionId: current.sessionId,
          leaseId: current.leaseId,
          reasonCode,
        });
    return this.mutateSession(sessionId, {
      operationId: input.operationId || `settle:${sessionId}:${state}`,
      eventKind: `session_${state}`,
      nextState: state,
      operationInput: {
        state,
        blockerCode,
        resultDigest,
        mutationOutcome,
        runtimeReceipt,
      },
      patch: (before) => {
        if (before.state === "cancelling" && !runtimeReceipt) {
          fail("direct_workspace_worker_cancellation_receipt_required");
        }
        const effectiveOutcome = mergeMutationOutcome(before.mutationOutcome, mutationOutcome);
        if (runtimeReceipt) {
          normalizeRuntimeCancellationReceipt(runtimeReceipt, effectiveOutcome, {
            launchDigest: before.launchDigest,
            sessionId: before.sessionId,
            leaseId: before.leaseId,
            reasonCode: before.cancellation?.reasonCode,
          });
        }
        return {
          leaseState: "released",
          processState: "quiescent",
          blockerCode,
          resultDigest,
          mutationOutcome: effectiveOutcome,
          ...(runtimeReceipt ? {
            cancellation: {
              ...before.cancellation,
              requested: true,
              reasonCode,
              acknowledged: true,
              acknowledgedAt: nowIso(this.now),
            },
            cancellationReceipt: buildLifecycleCancellationReceipt(before, runtimeReceipt, reasonCode),
          } : {}),
        };
      },
    });
  }

  reconcileInterruptedSession(sessionId, input = {}) {
    const receipt = buildWorkspaceWorkerReconciliationReceipt(input.receipt || input);
    if (receipt.sessionId !== sessionId || input.receipt?.receiptDigest &&
      input.receipt.receiptDigest !== receipt.receiptDigest) {
      fail("direct_workspace_worker_reconciliation_receipt_mismatch");
    }
    if (!receipt.providerAcknowledged || !receipt.backendQuiesced) {
      fail("direct_workspace_worker_reconciliation_quiescence_unproven");
    }
    const before = this.session(sessionId);
    if (!before) fail("direct_workspace_worker_session_missing");
    if (!["registered", "active", "cancelling"].includes(before.state)) {
      fail("direct_workspace_worker_reconciliation_state_invalid");
    }
    if (before.revision !== receipt.expectedRevision) {
      fail("direct_workspace_worker_session_revision_conflict");
    }
    if (
      (before.state === "cancelling" && receipt.outcome !== "cancelled") ||
      (before.state !== "cancelling" && receipt.outcome !== "failed")
    ) {
      fail("direct_workspace_worker_reconciliation_outcome_state_mismatch");
    }
    const nextState = before.state === "cancelling" ? "cancelled" : "failed";
    return this.mutateSession(sessionId, {
      operationId: input.operationId || `reconcile:${sessionId}:${receipt.receiptDigest}`,
      eventKind: "restart_reconciled",
      nextState,
      expectedRevision: receipt.expectedRevision,
      operationInput: { receipt },
      patch: {
        leaseState: "released",
        processState: "quiescent",
        reconciliationReceipt: receipt,
        reconciliationReceiptDigest: receipt.receiptDigest,
        blockerCode: receipt.reasonCode,
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
      plan.bindingDigest !== before.binding?.bindingDigest ||
      normalizeString(plan.mutationOutcomeDigest, "") !==
        normalizeString(before.mutationOutcome?.outcomeDigest, "") ||
      plan.mutationOutcomeIndeterminate !== (
        before.mutationOutcome?.indeterminate === true ||
        before.mutationOutcome?.partialMutationPossible === true
      )
    ) {
      fail("direct_workspace_worker_cleanup_plan_binding_mismatch");
    }
    return this.mutateSession(sessionId, {
      operationId: input.operationId || `cleanup-eligible:${sessionId}:${plan.planDigest}`,
      eventKind: "cleanup_eligible",
      nextState: "cleanup_eligible",
      expectedRevision: plan.sessionRevision,
      operationInput: {
        planDigest: plan.planDigest,
        bindingDigest: plan.bindingDigest,
        mutationOutcomeDigest: normalizeString(plan.mutationOutcomeDigest, ""),
        sessionRevision: plan.sessionRevision,
      },
      patch: { cleanupPlanDigest: plan.planDigest },
    });
  }

  markCleaned(sessionId, input = {}) {
    const receipt = input.receipt;
    try {
      assertWorkspaceWorkerCleanupReceiptSafe(receipt);
    } catch {
      fail("direct_workspace_worker_cleanup_receipt_unsafe");
    }
    const before = this.session(sessionId);
    if (
      !before ||
      before.cleanupPlanDigest !== receipt.planDigest ||
      receipt.sessionId !== before.sessionId ||
      receipt.sessionRevision !== before.revision ||
      receipt.bindingDigest !== before.binding?.bindingDigest
    ) {
      fail("direct_workspace_worker_cleanup_plan_digest_mismatch");
    }
    return this.mutateSession(sessionId, {
      operationId: input.operationId || `cleaned:${sessionId}:${receipt.planDigest}`,
      eventKind: "workspace_cleaned",
      nextState: "cleaned",
      expectedRevision: receipt.sessionRevision,
      operationInput: {
        receiptDigest: receipt.receiptDigest,
        planDigest: receipt.planDigest,
        bindingDigest: receipt.bindingDigest,
        sessionRevision: receipt.sessionRevision,
      },
      patch: {
        cleanupReceipt: receipt,
        cleanupReceiptDigest: receipt.receiptDigest,
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
  WORKSPACE_WORKER_RECONCILIATION_RECEIPT_SCHEMA,
  WORKSPACE_WORKER_SETTLEMENT_RECEIPT_SCHEMA,
  WORKSPACE_WORKER_LIFECYCLE_REGISTRY_SCHEMA,
  WORKSPACE_WORKER_REGISTRY_FILE,
  WORKSPACE_WORKER_SESSION_SCHEMA,
  WorkspaceWorkerLifecycleRegistry,
  buildWorkspaceWorkerReconciliationReceipt,
  digestFor,
  normalizeBinding,
};
