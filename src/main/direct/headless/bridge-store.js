"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");

const HEADLESS_BRIDGE_STORE_SCHEMA = "direct_headless_bridge_store@1";
const EVENT_ENVELOPE_SCHEMA = "bridge_event_envelope@1";
const ROUTE_BINDING_SCHEMA = "bridge_route_binding@1";
const CLIENT_REGISTRATION_SCHEMA = "bridge_client_registration@1";
const HEADLESS_TURN_PACKET_SCHEMA = "headless_turn_packet@1";
const REDUCED_RESULT_SCHEMA = "headless_reduced_result@1";
const HUMAN_DECISION_PACKET_SCHEMA = "human_decision_packet@1";
const HUMAN_DECISION_REPLY_SCHEMA = "human_decision_reply@1";
const PROVIDER_AFFORDANCE_CLAIM_SCHEMA = "headless_provider_affordance_claim@1";
const MAX_EVIDENCE_REFS = 32;
const MAX_EVIDENCE_REF_DEPTH = 1;
const MAX_EVIDENCE_REF_FIELD_LENGTH = 256;
const MAX_EVIDENCE_REF_LABEL_LENGTH = 160;
const SAFE_EVIDENCE_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const SAFE_EVIDENCE_DIGEST_PATTERN = /^(?:sha256:[a-f0-9]{64}|[A-Za-z0-9][A-Za-z0-9._:-]{0,255})$/;
const EVIDENCE_URI_PATTERN = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const EVIDENCE_PATH_PATTERN = /(?:^|[\\/])(?:\.\.?(?:[\\/]|$)|[^\\/]*[\\/])/;
const EVIDENCE_BARE_FILE_PATTERN = /^[^\\/\s]+\.[A-Za-z0-9]{1,16}$/;
const EVIDENCE_CONTROL_PATTERN = /[\u0000-\u001f\u007f]/;
const EVIDENCE_SECRET_PATTERN = /(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|passwd|secret|bearer|private[_ -]?key|authorization|client[_ -]?secret|(?:token|key)\s*[:=]|sk-[a-z0-9]|ghp_[a-z0-9]|github_pat_|xox[baprs]-|akia[0-9a-z]{12,}|aiza[0-9a-z_-]{20,})/i;
const SAFE_EVIDENCE_REF_KEYS = new Set([
  "kind",
  "id",
  "digest",
  "rendererSafeLabel",
  "artifactId",
  "artifactDigest",
  "projectId",
  "refId",
  "evidenceKey",
  "source",
]);

function normalizeString(value, fallback = "") {
  const text = typeof value === "string" ? value.trim() : "";
  return text || fallback;
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return `sha256:${crypto.createHash("sha256").update(String(value)).digest("hex")}`;
}

function clientCapabilityTokenDigest(clientId, token) {
  const safeClientId = normalizeString(clientId, "");
  const safeToken = typeof token === "string" ? token : "";
  if (!safeClientId || !safeToken) return "";
  return sha256(`bridge-client-capability-token:${safeClientId}:${safeToken}`);
}

function digestFor(kind, value) {
  return sha256(`${kind}:${stableStringify(value)}`);
}

function nowIso(nowMs = Date.now()) {
  return new Date(Number(nowMs) || Date.now()).toISOString();
}

function safeJson(value) {
  return JSON.stringify(value ?? null);
}

function parseJson(value, fallback = null) {
  try {
    return JSON.parse(String(value || "null"));
  } catch {
    return fallback;
  }
}

function evidenceRef(kind, label, extra = {}) {
  return {
    kind,
    rendererSafeLabel: label,
    ...extra,
  };
}

function evidenceRefDepth(value, depth = 0) {
  if (!value || typeof value !== "object") return depth;
  if (depth > MAX_EVIDENCE_REF_DEPTH) return depth;
  const values = Array.isArray(value) ? value : Object.values(value);
  return values.reduce((max, child) => Math.max(max, evidenceRefDepth(child, depth + 1)), depth);
}

function validateEvidenceRefs(input) {
  if (input === undefined) return { ok: true, refs: [] };
  if (!Array.isArray(input)) return { ok: false, errorCode: "invalid_evidence_refs" };
  if (input.length > MAX_EVIDENCE_REFS) return { ok: false, errorCode: "evidence_refs_limit_exceeded" };
  const refs = [];
  for (const candidate of input) {
    if (!isPlainObject(candidate) || evidenceRefDepth(candidate) > MAX_EVIDENCE_REF_DEPTH) {
      return { ok: false, errorCode: "invalid_evidence_refs" };
    }
    const keys = Object.keys(candidate);
    if (!keys.length || keys.some((key) => !SAFE_EVIDENCE_REF_KEYS.has(key))) {
      return { ok: false, errorCode: "invalid_evidence_refs" };
    }
    const safe = {};
    for (const key of keys) {
      if (typeof candidate[key] !== "string") return { ok: false, errorCode: "invalid_evidence_refs" };
      const value = candidate[key];
      if (!value || value !== value.trim() || value.length > MAX_EVIDENCE_REF_FIELD_LENGTH) {
        return { ok: false, errorCode: "invalid_evidence_refs" };
      }
      const isIdentifier = ["kind", "id", "artifactId", "projectId", "refId", "evidenceKey"].includes(key);
      const isDigest = ["digest", "artifactDigest"].includes(key);
      if (isIdentifier && !SAFE_EVIDENCE_IDENTIFIER_PATTERN.test(value)) {
        return { ok: false, errorCode: "invalid_evidence_refs" };
      }
      if (isDigest && !SAFE_EVIDENCE_DIGEST_PATTERN.test(value)) {
        return { ok: false, errorCode: "invalid_evidence_refs" };
      }
      if (["rendererSafeLabel", "source"].includes(key)) {
        if (
          value.length > MAX_EVIDENCE_REF_LABEL_LENGTH ||
          EVIDENCE_CONTROL_PATTERN.test(value) ||
          EVIDENCE_URI_PATTERN.test(value) ||
          EVIDENCE_PATH_PATTERN.test(value) ||
          EVIDENCE_BARE_FILE_PATTERN.test(value) ||
          EVIDENCE_SECRET_PATTERN.test(value)
        ) {
          return { ok: false, errorCode: "invalid_evidence_refs" };
        }
      }
      if (value) safe[key] = value;
    }
    if (!safe.kind || !(
      safe.id ||
      safe.refId ||
      safe.evidenceKey ||
      safe.artifactId ||
      safe.rendererSafeLabel
    )) {
      return { ok: false, errorCode: "invalid_evidence_refs" };
    }
    refs.push(safe);
  }
  return { ok: true, refs };
}

function routeDigest(route = {}) {
  return digestFor("bridge_route_binding@1", {
    routeId: normalizeString(route.routeId, ""),
    routeVersion: normalizeString(route.routeVersion, ""),
    ingressContractRef: normalizeString(route.ingressContractRef, ""),
    workThreadId: normalizeString(route.workThreadId, ""),
    candidateWorkThreadIds: Array.isArray(route.candidateWorkThreadIds) ? route.candidateWorkThreadIds.map((id) => normalizeString(id, "")).filter(Boolean).sort() : [],
    targetKind: normalizeString(route.targetKind, ""),
    targetThreadRef: isPlainObject(route.targetThreadRef) ? route.targetThreadRef : null,
    contextPolicyRef: normalizeString(route.contextPolicyRef, ""),
    modelPolicyRef: normalizeString(route.modelPolicyRef, ""),
    outputReducerRef: normalizeString(route.outputReducerRef, ""),
    outputReducer: isPlainObject(route.outputReducer) ? route.outputReducer : null,
    egressPolicyRefs: Array.isArray(route.egressPolicyRefs) ? route.egressPolicyRefs.map((id) => normalizeString(id, "")).filter(Boolean).sort() : [],
    interruptionPolicyRef: normalizeString(route.interruptionPolicyRef, ""),
    authorityBoundaryRef: normalizeString(route.authorityBoundaryRef, ""),
    toolAuthorityMode: normalizeString(route.toolAuthorityMode, "disabled"),
    headlessImplementationPolicy: isPlainObject(route.headlessImplementationPolicy) ? route.headlessImplementationPolicy : null,
  });
}

function normalizeClient(input = {}) {
  const clientId = normalizeString(input.clientId || input.client_id, "");
  if (!clientId) throw new Error("bridge_client_missing_id");
  const capabilityTokenDigest = normalizeString(
    input.capabilityTokenDigest || input.capability_token_digest,
    clientCapabilityTokenDigest(clientId, input.capabilityToken || input.capability_token),
  );
  return {
    schema: CLIENT_REGISTRATION_SCHEMA,
    clientId,
    displayLabel: normalizeString(input.displayLabel || input.display_label, clientId),
    clientKind: normalizeString(input.clientKind || input.client_kind, "unknown"),
    allowedIngressContracts: Array.isArray(input.allowedIngressContracts) ? input.allowedIngressContracts.map((value) => normalizeString(value, "")).filter(Boolean) : [],
    allowedRoutes: Array.isArray(input.allowedRoutes) ? input.allowedRoutes.map((value) => normalizeString(value, "")).filter(Boolean) : [],
    authMode: normalizeString(input.authMode || input.auth_mode, "disabled"),
    capabilityTokenDigest,
    status: normalizeString(input.status, "active"),
  };
}

function normalizeRoute(input = {}) {
  const routeId = normalizeString(input.routeId || input.route_id, "");
  const routeVersion = normalizeString(input.routeVersion || input.route_version, "");
  if (!routeId) throw new Error("bridge_route_missing_id");
  if (!routeVersion) throw new Error("bridge_route_missing_version");
  const route = {
    schema: ROUTE_BINDING_SCHEMA,
    routeId,
    routeVersion,
    status: normalizeString(input.status, "active"),
    ingressContractRef: normalizeString(input.ingressContractRef || input.ingress_contract_ref, ""),
    workThreadId: normalizeString(input.workThreadId || input.work_thread_id, ""),
    candidateWorkThreadIds: Array.isArray(input.candidateWorkThreadIds || input.candidate_work_thread_ids) ? (input.candidateWorkThreadIds || input.candidate_work_thread_ids).map((value) => normalizeString(value, "")).filter(Boolean) : [],
    targetKind: normalizeString(input.targetKind || input.target_kind, "codex_direct_thread"),
    targetThreadRef: isPlainObject(input.targetThreadRef || input.target_thread_ref) ? (input.targetThreadRef || input.target_thread_ref) : null,
    contextPolicyRef: normalizeString(input.contextPolicyRef || input.context_policy_ref, ""),
    modelPolicyRef: normalizeString(input.modelPolicyRef || input.model_policy_ref, ""),
    outputReducerRef: normalizeString(input.outputReducerRef || input.output_reducer_ref, ""),
    outputReducer: isPlainObject(input.outputReducer || input.output_reducer)
      ? (input.outputReducer || input.output_reducer)
      : {},
    egressPolicyRefs: Array.isArray(input.egressPolicyRefs || input.egress_policy_refs) ? (input.egressPolicyRefs || input.egress_policy_refs).map((value) => normalizeString(value, "")).filter(Boolean) : [],
    interruptionPolicyRef: normalizeString(input.interruptionPolicyRef || input.interruption_policy_ref, ""),
    authorityBoundaryRef: normalizeString(input.authorityBoundaryRef || input.authority_boundary_ref, ""),
    toolAuthorityMode: normalizeString(input.toolAuthorityMode || input.tool_authority_mode, "disabled"),
    headlessImplementationPolicy: isPlainObject(input.headlessImplementationPolicy || input.headless_implementation_policy)
      ? (input.headlessImplementationPolicy || input.headless_implementation_policy)
      : {},
  };
  route.dependencyBundle = {
    ingressContractRef: route.ingressContractRef,
    contextPolicyRef: route.contextPolicyRef,
    modelPolicyRef: route.modelPolicyRef,
    outputReducerRef: route.outputReducerRef,
    outputReducer: route.outputReducer,
    egressPolicyRefs: route.egressPolicyRefs,
    interruptionPolicyRef: route.interruptionPolicyRef,
    authorityBoundaryRef: route.authorityBoundaryRef,
    toolAuthorityMode: route.toolAuthorityMode,
    headlessImplementationPolicy: route.headlessImplementationPolicy,
  };
  route.routeDigest = normalizeString(input.routeDigest || input.route_digest, routeDigest(route));
  return route;
}

function normalizeWorkThread(input = {}) {
  const workThreadId = normalizeString(input.workThreadId || input.work_thread_id, "");
  if (!workThreadId) throw new Error("bridge_work_thread_missing_id");
  return {
    workThreadId,
    status: normalizeString(input.status, "active"),
    projectId: normalizeString(input.projectId || input.project_id, ""),
    workspaceIdentity: normalizeString(input.workspaceIdentity || input.workspace_identity, ""),
    branchIdentity: normalizeString(input.branchIdentity || input.branch_identity, ""),
  };
}

function safeEventProjection(row) {
  if (!row) return null;
  const event = parseJson(row.event_json, {});
  const validatedEvidence = validateEvidenceRefs(event.evidenceRefs);
  return {
    schema: EVENT_ENVELOPE_SCHEMA,
    envelopeId: row.envelope_id,
    idempotencyKey: row.idempotency_key,
    processingIdentity: row.processing_identity,
    clientId: row.client_id,
    sourceSystem: event.sourceSystem || "",
    eventSchema: row.event_schema,
    eventClass: row.event_class,
    eventKind: row.event_kind,
    factSourcePosture: event.factSourcePosture || "client_declared",
    lifecycle: row.lifecycle,
    receivedAt: row.created_at,
    declaredWorkThreadId: event.declaredWorkThreadId || "",
    requestedRouteId: row.requested_route_id,
    routeVersion: row.route_version,
    payloadDigest: row.payload_digest,
    rawPayloadIncluded: false,
    routeDecisionId: row.route_decision_id || "",
    evidenceRefs: validatedEvidence.ok ? validatedEvidence.refs : [],
  };
}

class DirectHeadlessBridgeStore {
  constructor(options = {}) {
    const rootDir = normalizeString(options.rootDir, "");
    if (!rootDir) throw new Error("headless_bridge_store_missing_root");
    fs.mkdirSync(rootDir, { recursive: true });
    this.rootDir = rootDir;
    this.dbPath = normalizeString(options.dbPath, path.join(rootDir, "direct-headless-bridge.sqlite"));
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec("pragma journal_mode = WAL");
    this.db.exec("pragma foreign_keys = ON");
    this.ensureSchema();
    this.seed({
      clients: options.clients,
      routes: options.routes,
      workThreads: options.workThreads,
    });
  }

  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  ensureSchema() {
    this.db.exec(`
      create table if not exists direct_bridge_clients (
        client_id text primary key,
        status text not null,
        registration_json text not null,
        created_at text not null,
        updated_at text not null
      );
      create table if not exists direct_bridge_routes (
        route_id text not null,
        route_version text not null,
        status text not null,
        route_digest text not null,
        binding_json text not null,
        created_at text not null,
        updated_at text not null,
        primary key (route_id, route_version)
      );
      create table if not exists direct_bridge_work_threads (
        work_thread_id text primary key,
        status text not null,
        work_thread_json text not null,
        created_at text not null,
        updated_at text not null
      );
      create table if not exists direct_bridge_inbox_events (
        envelope_id text primary key,
        idempotency_key text not null,
        processing_identity text not null,
        client_id text not null,
        event_schema text not null,
        event_class text not null,
        event_kind text not null,
        requested_route_id text not null,
        route_version text not null,
        work_thread_id text not null,
        target_thread_id text not null,
        lifecycle text not null,
        payload_digest text not null,
        event_json text not null,
        route_decision_id text,
        raw_payload_included integer not null default 0,
        created_at text not null,
        updated_at text not null
      );
      create unique index if not exists idx_direct_bridge_inbox_processing_identity
        on direct_bridge_inbox_events(processing_identity);
      create table if not exists direct_bridge_lifecycle_events (
        lifecycle_event_id text primary key,
        envelope_id text not null,
        phase text not null,
        reason_code text not null,
        witness_json text not null,
        created_at text not null
      );
      create index if not exists idx_direct_bridge_lifecycle_envelope
        on direct_bridge_lifecycle_events(envelope_id, created_at);
      create table if not exists direct_bridge_route_decisions (
        decision_id text primary key,
        envelope_id text not null,
        route_id text not null,
        route_version text not null,
        work_thread_id text not null,
        target_thread_id text not null,
        status text not null,
        blocker_code text not null,
        decision_json text not null,
        created_at text not null
      );
      create table if not exists direct_bridge_turn_packets (
        packet_id text primary key,
        envelope_id text not null,
        route_id text not null,
        packet_json text not null,
        created_at text not null
      );
      create table if not exists direct_bridge_reduced_results (
        result_id text primary key,
        packet_id text not null,
        envelope_id text not null,
        route_id text not null,
        status text not null,
        result_json text not null,
        created_at text not null,
        updated_at text not null
      );
      create table if not exists direct_bridge_outbox_actions (
        action_id text primary key,
        envelope_id text not null,
        route_id text not null,
        status text not null,
        action_json text not null,
        created_at text not null,
        updated_at text not null
      );
      create table if not exists direct_bridge_delivery_receipts (
        receipt_id text primary key,
        action_id text not null,
        status text not null,
        receipt_json text not null,
        created_at text not null
      );
      create table if not exists direct_bridge_human_decisions (
        decision_id text primary key,
        envelope_id text not null,
        status text not null,
        decision_json text not null,
        created_at text not null,
        updated_at text not null
      );
      create table if not exists direct_bridge_provider_affordance_claims (
        claim_id text primary key,
        client_id text not null,
        route_id text not null,
        route_version text not null,
        route_digest text not null,
        idempotency_key text not null,
        input_digest text not null,
        status text not null,
        result_json text,
        created_at text not null,
        updated_at text not null
      );
      create unique index if not exists idx_direct_bridge_provider_affordance_identity
        on direct_bridge_provider_affordance_claims(client_id, route_id, route_version, route_digest, idempotency_key);
    `);
    this.db.prepare("create table if not exists direct_bridge_meta (key text primary key, value_json text not null)").run();
    this.db.prepare(`
      insert into direct_bridge_meta (key, value_json)
      values ('schema', ?)
      on conflict(key) do update set value_json = excluded.value_json
    `).run(safeJson({ schema: HEADLESS_BRIDGE_STORE_SCHEMA }));
    this.reconcileProviderAffordanceClaims();
    this.reconcileTurnPacketClaims();
  }

  reconcileProviderAffordanceClaims() {
    const interruptedAt = nowIso();
    const result = safeJson({
      schema: "headless_provider_affordance_interrupted_unknown@1",
      status: "interrupted_unknown",
      blockerCode: "provider_affordance_interrupted_unknown",
      providerRequestStarted: false,
      rawPayloadIncluded: false,
      rawPromptIncluded: false,
      rawProviderPayloadIncluded: false,
      rawProviderFrameIncluded: false,
    });
    this.db.prepare("update direct_bridge_provider_affordance_claims set status='interrupted_unknown', result_json=?, updated_at=? where status='in_progress'").run(result, interruptedAt);
  }

  seed({ clients = [], routes = [], workThreads = [] } = {}) {
    for (const client of Array.isArray(clients) ? clients : []) this.upsertClient(client);
    for (const route of Array.isArray(routes) ? routes : []) this.upsertRoute(route);
    for (const workThread of Array.isArray(workThreads) ? workThreads : []) this.upsertWorkThread(workThread);
  }

  upsertClient(input = {}) {
    const client = normalizeClient(input);
    const at = nowIso();
    this.db.prepare(`
      insert into direct_bridge_clients (client_id, status, registration_json, created_at, updated_at)
      values (?, ?, ?, ?, ?)
      on conflict(client_id) do update set
        status = excluded.status,
        registration_json = excluded.registration_json,
        updated_at = excluded.updated_at
    `).run(client.clientId, client.status, safeJson(client), at, at);
    return client;
  }

  upsertRoute(input = {}) {
    const route = normalizeRoute(input);
    const at = nowIso();
    this.db.prepare(`
      insert into direct_bridge_routes (route_id, route_version, status, route_digest, binding_json, created_at, updated_at)
      values (?, ?, ?, ?, ?, ?, ?)
      on conflict(route_id, route_version) do update set
        status = excluded.status,
        route_digest = excluded.route_digest,
        binding_json = excluded.binding_json,
        updated_at = excluded.updated_at
    `).run(route.routeId, route.routeVersion, route.status, route.routeDigest, safeJson(route), at, at);
    return route;
  }

  upsertWorkThread(input = {}) {
    const workThread = normalizeWorkThread(input);
    const at = nowIso();
    this.db.prepare(`
      insert into direct_bridge_work_threads (work_thread_id, status, work_thread_json, created_at, updated_at)
      values (?, ?, ?, ?, ?)
      on conflict(work_thread_id) do update set
        status = excluded.status,
        work_thread_json = excluded.work_thread_json,
        updated_at = excluded.updated_at
    `).run(workThread.workThreadId, workThread.status, safeJson(workThread), at, at);
    return workThread;
  }

  readClient(clientId = "") {
    const row = this.db.prepare("select registration_json from direct_bridge_clients where client_id = ?").get(normalizeString(clientId, ""));
    return row ? parseJson(row.registration_json, null) : null;
  }

  readRoute(routeId = "", routeVersion = "") {
    const safeRouteId = normalizeString(routeId, "");
    const safeVersion = normalizeString(routeVersion, "");
    const row = safeVersion
      ? this.db.prepare("select binding_json from direct_bridge_routes where route_id = ? and route_version = ?").get(safeRouteId, safeVersion)
      : this.db.prepare("select binding_json from direct_bridge_routes where route_id = ? order by updated_at desc limit 1").get(safeRouteId);
    return row ? parseJson(row.binding_json, null) : null;
  }

  readWorkThread(workThreadId = "") {
    const row = this.db.prepare("select work_thread_json from direct_bridge_work_threads where work_thread_id = ?").get(normalizeString(workThreadId, ""));
    return row ? parseJson(row.work_thread_json, null) : null;
  }

  count(tableName = "") {
    const allowed = new Set([
      "direct_bridge_clients",
      "direct_bridge_routes",
      "direct_bridge_work_threads",
      "direct_bridge_inbox_events",
      "direct_bridge_lifecycle_events",
      "direct_bridge_route_decisions",
      "direct_bridge_turn_packets",
      "direct_bridge_reduced_results",
      "direct_bridge_outbox_actions",
      "direct_bridge_delivery_receipts",
      "direct_bridge_human_decisions",
      "direct_bridge_provider_affordance_claims",
    ]);
    if (!allowed.has(tableName)) throw new Error(`headless_bridge_count_table_invalid:${tableName}`);
    return Number(this.db.prepare(`select count(*) as count from ${tableName}`).get()?.count || 0);
  }

  providerAffordanceIngressCount() {
    return Number(this.db.prepare("select count(*) as count from direct_bridge_provider_affordance_claims").get()?.count || 0);
  }

  providerAffordanceRecord(row, inputDigest = "") {
    return {
      schema: PROVIDER_AFFORDANCE_CLAIM_SCHEMA,
      claimId: row.claim_id,
      clientId: row.client_id,
      routeId: row.route_id,
      routeVersion: row.route_version,
      routeDigest: row.route_digest,
      idempotencyKey: row.idempotency_key,
      inputDigest: row.input_digest,
      status: row.status,
      result: parseJson(row.result_json, null),
      replay: true,
      conflict: row.input_digest !== inputDigest,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  providerAffordanceIdentity(input = {}) {
    const identity = {
      claimId: normalizeString(input.claimId, ""),
      clientId: normalizeString(input.clientId, ""),
      routeId: normalizeString(input.routeId, ""),
      routeVersion: normalizeString(input.routeVersion, ""),
      routeDigest: normalizeString(input.routeDigest, ""),
      idempotencyKey: normalizeString(input.idempotencyKey, ""),
      inputDigest: normalizeString(input.inputDigest, ""),
    };
    if (!identity.claimId || !identity.clientId || !identity.routeId || !identity.routeVersion || !identity.routeDigest || !identity.idempotencyKey || !identity.inputDigest) throw new Error("headless_provider_affordance_claim_invalid");
    return identity;
  }

  readProviderAffordance(input = {}) {
    const identity = this.providerAffordanceIdentity(input);
    const row = this.db.prepare("select * from direct_bridge_provider_affordance_claims where client_id=? and route_id=? and route_version=? and route_digest=? and idempotency_key=?").get(identity.clientId, identity.routeId, identity.routeVersion, identity.routeDigest, identity.idempotencyKey);
    return row ? this.providerAffordanceRecord(row, identity.inputDigest) : null;
  }

  claimProviderAffordance(input = {}) {
    const identity = this.providerAffordanceIdentity(input);
    const { claimId, clientId, routeId, routeVersion, routeDigest, idempotencyKey, inputDigest } = identity;
    const at = normalizeString(input.createdAt, nowIso());
    this.db.exec("begin immediate");
    try {
      const existing = this.db.prepare("select * from direct_bridge_provider_affordance_claims where client_id=? and route_id=? and route_version=? and route_digest=? and idempotency_key=?").get(clientId, routeId, routeVersion, routeDigest, idempotencyKey);
      if (existing) {
        this.db.exec("commit");
        return this.providerAffordanceRecord(existing, inputDigest);
      }
      this.db.prepare("insert into direct_bridge_provider_affordance_claims (claim_id, client_id, route_id, route_version, route_digest, idempotency_key, input_digest, status, result_json, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, 'in_progress', null, ?, ?)").run(claimId, clientId, routeId, routeVersion, routeDigest, idempotencyKey, inputDigest, at, at);
      this.db.exec("commit");
      return { schema: PROVIDER_AFFORDANCE_CLAIM_SCHEMA, claimId, clientId, routeId, routeVersion, routeDigest, idempotencyKey, inputDigest, status: "in_progress", result: null, replay: false, conflict: false, createdAt: at, updatedAt: at };
    } catch (error) {
      try { this.db.exec("rollback"); } catch (_) {}
      throw error;
    }
  }

  completeProviderAffordance(claimId = "", input = {}) {
    const safeClaimId = normalizeString(claimId, "");
    const status = normalizeString(input.status, "failed");
    const result = isPlainObject(input.result) ? input.result : { status, blockerCode: normalizeString(input.blockerCode, "provider_affordance_failed") };
    const at = normalizeString(input.updatedAt, nowIso());
    const row = this.db.prepare("select claim_id from direct_bridge_provider_affordance_claims where claim_id=?").get(safeClaimId);
    if (!row) throw new Error("headless_provider_affordance_claim_missing");
    this.db.prepare("update direct_bridge_provider_affordance_claims set status=?, result_json=?, updated_at=? where claim_id=? and status='in_progress'").run(status, safeJson(result), at, safeClaimId);
    return result;
  }

  statusProjection(extra = {}) {
    const lifecycleRows = this.db.prepare(`
      select phase, count(*) as count
      from direct_bridge_lifecycle_events
      group by phase
    `).all();
    const lifecycle = {};
    for (const row of lifecycleRows) lifecycle[row.phase] = Number(row.count || 0);
    const lastEventRow = this.db.prepare("select max(updated_at) as at from direct_bridge_inbox_events").get();
    return {
      schema: "bridge_daemon_status_projection@1",
      daemonState: extra.daemonState || "ready",
      activeRoutes: this.db.prepare("select count(*) as count from direct_bridge_routes where status = 'active'").get()?.count || 0,
      registeredClients: this.count("direct_bridge_clients"),
      knownWorkThreads: this.count("direct_bridge_work_threads"),
      inboxEvents: this.count("direct_bridge_inbox_events"),
      queuedInboxEvents: Number(lifecycle.accepted_inbox || 0),
      activeTurns: 0,
      queuedEgressActions: this.db.prepare("select count(*) as count from direct_bridge_outbox_actions where status = 'queued'").get()?.count || 0,
      failedEgressActions: this.db.prepare("select count(*) as count from direct_bridge_outbox_actions where status = 'failed'").get()?.count || 0,
      pendingHumanDecisions: this.db.prepare("select count(*) as count from direct_bridge_human_decisions where status = 'pending'").get()?.count || 0,
      completedHumanDecisions: this.db.prepare("select count(*) as count from direct_bridge_human_decisions where status in ('answered', 'completed')").get()?.count || 0,
      lifecycle,
      backpressure: extra.backpressure || null,
      lastEventAt: normalizeString(lastEventRow?.at, ""),
      lastErrorClass: normalizeString(extra.lastErrorClass, ""),
      providerRequestsStarted: 0,
      providerAffordanceClaims: this.providerAffordanceIngressCount(),
      rawSecretsExposed: false,
      rawPayloadsExposed: false,
      rawProviderFramesExposed: false,
      rawPathsExposed: false,
      turnPackets: this.turnPacketSummary(),
      reducedResults: this.reducedResultSummary(),
    };
  }

  turnPacketSummary() {
    const rows = this.db.prepare(`
      select coalesce(json_extract(packet_json, '$.state'), 'unknown') as state, count(*) as count
      from direct_bridge_turn_packets
      group by state
    `).all();
    const byState = {};
    for (const row of rows) {
      const state = normalizeString(row.state, "unknown");
      byState[state] = Number(row.count) || 0;
    }
    return {
      total: Object.values(byState).reduce((sum, count) => sum + count, 0),
      byState,
    };
  }

  appendLifecycle(envelopeId, phase, reasonCode = "", witness = {}, at = nowIso()) {
    const lifecycleEventId = `bridge_lifecycle_${sha256(`${envelopeId}:${phase}:${reasonCode}:${at}:${stableStringify(witness)}`).slice(7, 31)}`;
    const safeWitness = {
      schema: "bridge_event_lifecycle_witness@1",
      envelopeId,
      phase,
      reasonCode: normalizeString(reasonCode, ""),
      at,
      providerRequestStarted: false,
      rawPayloadIncluded: false,
      rawProviderFrameIncluded: false,
      rawPathIncluded: false,
      ...witness,
    };
    this.db.prepare(`
      insert into direct_bridge_lifecycle_events (lifecycle_event_id, envelope_id, phase, reason_code, witness_json, created_at)
      values (?, ?, ?, ?, ?, ?)
    `).run(lifecycleEventId, envelopeId, phase, normalizeString(reasonCode, ""), safeJson(safeWitness), at);
    return safeWitness;
  }

  writeRouteDecision(input = {}) {
    const at = normalizeString(input.createdAt, nowIso());
    const decision = {
      schema: "bridge_route_decision@1",
      decisionId: normalizeString(input.decisionId, `bridge_route_decision_${sha256(stableStringify(input)).slice(7, 31)}`),
      envelopeId: normalizeString(input.envelopeId, ""),
      routeId: normalizeString(input.routeId, ""),
      routeVersion: normalizeString(input.routeVersion, ""),
      routeDigest: normalizeString(input.routeDigest, ""),
      workThreadId: normalizeString(input.workThreadId, ""),
      targetThreadId: normalizeString(input.targetThreadId, ""),
      status: normalizeString(input.status, "blocked"),
      blockerCode: normalizeString(input.blockerCode, ""),
      dependencyBundle: isPlainObject(input.dependencyBundle) ? input.dependencyBundle : {},
      evidenceRefs: Array.isArray(input.evidenceRefs) ? input.evidenceRefs : [],
      createdAt: at,
      providerRequestStarted: false,
      rawPayloadIncluded: false,
    };
    this.db.prepare(`
      insert into direct_bridge_route_decisions (
        decision_id, envelope_id, route_id, route_version, work_thread_id,
        target_thread_id, status, blocker_code, decision_json, created_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      decision.decisionId,
      decision.envelopeId,
      decision.routeId,
      decision.routeVersion,
      decision.workThreadId,
      decision.targetThreadId,
      decision.status,
      decision.blockerCode,
      safeJson(decision),
      at,
    );
    return decision;
  }

  readEvent(envelopeId = "") {
    const row = this.db.prepare("select * from direct_bridge_inbox_events where envelope_id = ?").get(normalizeString(envelopeId, ""));
    if (!row) return null;
    const lifecycle = this.db.prepare(`
      select phase, reason_code, witness_json, created_at
      from direct_bridge_lifecycle_events
      where envelope_id = ?
      order by created_at asc
    `).all(row.envelope_id).map((item) => ({
      phase: item.phase,
      reasonCode: item.reason_code,
      witness: parseJson(item.witness_json, {}),
      at: item.created_at,
    }));
    const routeDecision = row.route_decision_id
      ? this.db.prepare("select decision_json from direct_bridge_route_decisions where decision_id = ?").get(row.route_decision_id)
      : null;
    return {
      event: safeEventProjection(row),
      lifecycle,
      routeDecision: routeDecision ? parseJson(routeDecision.decision_json, null) : null,
    };
  }

  writeTurnPacket(packet = {}, options = {}) {
    const at = normalizeString(options.now, nowIso(options.nowMs));
    const safePacket = {
      schema: HEADLESS_TURN_PACKET_SCHEMA,
      ...packet,
      updatedAt: at,
    };
    const packetId = normalizeString(safePacket.packetId, `headless_turn_packet_${sha256(stableStringify(safePacket)).slice(7, 31)}`);
    safePacket.packetId = packetId;
    if (!safePacket.createdAt) safePacket.createdAt = at;
    this.db.prepare(`
      insert into direct_bridge_turn_packets (packet_id, envelope_id, route_id, packet_json, created_at)
      values (?, ?, ?, ?, ?)
      on conflict(packet_id) do update set
        packet_json = excluded.packet_json
    `).run(
      packetId,
      normalizeString(safePacket.envelopeId, ""),
      normalizeString(safePacket.routeId, ""),
      safeJson(safePacket),
      normalizeString(safePacket.createdAt, at),
    );
    return safePacket;
  }

  readTurnPacket(packetId = "") {
    const row = this.db.prepare("select packet_json from direct_bridge_turn_packets where packet_id = ?").get(normalizeString(packetId, ""));
    return row ? parseJson(row.packet_json, null) : null;
  }

  listTurnPackets(options = {}) {
    const rows = this.db.prepare(
      "select packet_json from direct_bridge_turn_packets order by created_at asc, packet_id asc",
    ).all();
    const states = Array.isArray(options.states) ? new Set(options.states.map((state) => normalizeString(state, ""))) : null;
    return rows
      .map((row) => parseJson(row.packet_json, null))
      .filter((packet) => packet && (!states || states.has(normalizeString(packet.state, ""))));
  }

  claimTurnPacket(packetId = "", options = {}) {
    const safePacketId = normalizeString(packetId, "");
    const runtimeId = normalizeString(options.runtimeId, "headless_runtime");
    if (!safePacketId) return { claimed: false, reason: "missing_packet_id", packet: null };
    this.db.exec("begin immediate");
    try {
      const packet = this.readTurnPacket(safePacketId);
      if (!packet) {
        this.db.exec("commit");
        return { claimed: false, reason: "packet_missing", packet: null };
      }
      if (["provider_completed", "failed", "handoff_unknown", "replay_unsafe"].includes(packet.state)) {
        this.db.exec("commit");
        return { claimed: false, reason: "packet_terminal", packet };
      }
      const existingClaim = isPlainObject(packet.executionClaim) ? packet.executionClaim : null;
      if (existingClaim && ["in_progress", "settled", "reconciled_unknown"].includes(existingClaim.status)) {
        this.db.exec("commit");
        return { claimed: false, reason: existingClaim.status === "in_progress" ? "packet_claimed" : "packet_claim_closed", packet };
      }
      const at = normalizeString(options.now, nowIso(options.nowMs));
      const claimId = `headless_packet_claim_${sha256(`${safePacketId}:${runtimeId}`).slice(7, 31)}`;
      const claimed = {
        ...packet,
        executionClaim: {
          schema: "headless_turn_packet_execution_claim@1",
          claimId,
          runtimeId,
          status: "in_progress",
          claimedAt: at,
          updatedAt: at,
        },
        updatedAt: at,
      };
      this.db.prepare("update direct_bridge_turn_packets set packet_json=? where packet_id=?").run(safeJson(claimed), safePacketId);
      this.db.exec("commit");
      return { claimed: true, reason: "claimed", packet: claimed };
    } catch (error) {
      try { this.db.exec("rollback"); } catch (_) {}
      throw error;
    }
  }

  reconcileTurnPacketClaims(options = {}) {
    const at = normalizeString(options.now, nowIso(options.nowMs));
    const packets = this.listTurnPackets();
    let reconciled = 0;
    this.db.exec("begin immediate");
    try {
      for (const packet of packets) {
        const claim = isPlainObject(packet.executionClaim) ? packet.executionClaim : null;
        if (!claim || claim.status !== "in_progress") continue;
        const next = {
          ...packet,
          state: "failed",
          blockerCode: "headless_turn_restart_in_progress_unknown",
          replayState: "replay_unsafe",
          providerCompleted: false,
          terminalTurnState: "transport_handoff_unknown",
          executionClaim: {
            ...claim,
            status: "reconciled_unknown",
            reconciledAt: at,
            updatedAt: at,
          },
          updatedAt: at,
          statusHistory: [
            ...(Array.isArray(packet.statusHistory) ? packet.statusHistory : []),
            { state: "failed", at, reason: "headless_turn_restart_in_progress_unknown" },
          ],
        };
        this.db.prepare("update direct_bridge_turn_packets set packet_json=? where packet_id=?").run(safeJson(next), packet.packetId);
        reconciled += 1;
      }
      this.db.exec("commit");
      return { reconciled };
    } catch (error) {
      try { this.db.exec("rollback"); } catch (_) {}
      throw error;
    }
  }

  readTurnPacketForEnvelope(envelopeId = "") {
    const row = this.db.prepare("select packet_json from direct_bridge_turn_packets where envelope_id = ? order by created_at desc limit 1").get(normalizeString(envelopeId, ""));
    return row ? parseJson(row.packet_json, null) : null;
  }

  updateTurnPacket(packetId = "", patch = {}, options = {}) {
    const packet = this.readTurnPacket(packetId);
    if (!packet) return null;
    return this.writeTurnPacket({
      ...packet,
      ...patch,
      statusHistory: [
        ...(Array.isArray(packet.statusHistory) ? packet.statusHistory : []),
        ...(Array.isArray(patch.statusHistory) ? patch.statusHistory : []),
      ],
    }, options);
  }

  reducedResultSummary() {
    const rows = this.db.prepare(`
      select coalesce(status, 'unknown') as status, count(*) as count
      from direct_bridge_reduced_results
      group by status
    `).all();
    const byStatus = {};
    for (const row of rows) byStatus[normalizeString(row.status, "unknown")] = Number(row.count) || 0;
    return {
      total: Object.values(byStatus).reduce((sum, count) => sum + count, 0),
      byStatus,
    };
  }

  writeReducedResult(input = {}, options = {}) {
    const at = normalizeString(options.now, nowIso(options.nowMs));
    const result = {
      schema: REDUCED_RESULT_SCHEMA,
      ...input,
      resultId: normalizeString(input.resultId, `headless_reduced_${sha256(stableStringify(input)).slice(7, 31)}`),
      packetId: normalizeString(input.packetId, ""),
      sourceEnvelopeId: normalizeString(input.sourceEnvelopeId || input.envelopeId, ""),
      routeId: normalizeString(input.routeId, ""),
      routeVersion: normalizeString(input.routeVersion, ""),
      routeDigest: normalizeString(input.routeDigest, ""),
      reducerId: normalizeString(input.reducerId, ""),
      reducerVersion: normalizeString(input.reducerVersion, "v1"),
      reducerMode: normalizeString(input.reducerMode, ""),
      reductionStatus: normalizeString(input.reductionStatus || input.status, "valid"),
      sourceOutputDigest: normalizeString(input.sourceOutputDigest, ""),
      contextBuildId: normalizeString(input.contextBuildId, ""),
      requestManifestId: normalizeString(input.requestManifestId, ""),
      evidenceRefs: Array.isArray(input.evidenceRefs) ? input.evidenceRefs : [],
      rawOutputIncluded: input.rawOutputIncluded === true,
      rawProviderPayloadIncluded: input.rawProviderPayloadIncluded === true,
      rawPathIncluded: input.rawPathIncluded === true,
      createdAt: normalizeString(input.createdAt, at),
      updatedAt: at,
    };
    this.db.prepare(`
      insert into direct_bridge_reduced_results (
        result_id, packet_id, envelope_id, route_id, status, result_json, created_at, updated_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?)
      on conflict(result_id) do update set
        status = excluded.status,
        result_json = excluded.result_json,
        updated_at = excluded.updated_at
    `).run(
      result.resultId,
      result.packetId,
      result.sourceEnvelopeId,
      result.routeId,
      result.reductionStatus,
      safeJson(result),
      result.createdAt,
      result.updatedAt,
    );
    return result;
  }

  readReducedResult(resultId = "") {
    const row = this.db.prepare("select result_json from direct_bridge_reduced_results where result_id = ?").get(normalizeString(resultId, ""));
    return row ? parseJson(row.result_json, null) : null;
  }

  writeOutboxAction(input = {}, options = {}) {
    const at = normalizeString(options.now, nowIso(options.nowMs));
    const action = {
      schema: "headless_outbox_action@1",
      ...input,
      actionId: normalizeString(input.actionId, `headless_outbox_${sha256(stableStringify(input)).slice(7, 31)}`),
      sourceEnvelopeId: normalizeString(input.sourceEnvelopeId || input.envelopeId, ""),
      routeId: normalizeString(input.routeId, ""),
      actionKind: normalizeString(input.actionKind, "write_artifact"),
      status: normalizeString(input.status, "queued"),
      rawOutputIncluded: input.rawOutputIncluded === true,
      rawPathIncluded: input.rawPathIncluded === true,
      createdAt: normalizeString(input.createdAt, at),
      updatedAt: at,
    };
    this.db.prepare(`
      insert into direct_bridge_outbox_actions (
        action_id, envelope_id, route_id, status, action_json, created_at, updated_at
      ) values (?, ?, ?, ?, ?, ?, ?)
      on conflict(action_id) do update set
        status = excluded.status,
        action_json = excluded.action_json,
        updated_at = excluded.updated_at
    `).run(
      action.actionId,
      action.sourceEnvelopeId,
      action.routeId,
      action.status,
      safeJson(action),
      action.createdAt,
      action.updatedAt,
    );
    return action;
  }

  readOutboxAction(actionId = "") {
    const row = this.db.prepare("select action_json from direct_bridge_outbox_actions where action_id = ?").get(normalizeString(actionId, ""));
    return row ? parseJson(row.action_json, null) : null;
  }

  writeDeliveryReceipt(input = {}, options = {}) {
    const at = normalizeString(options.now, nowIso(options.nowMs));
    const receipt = {
      schema: "headless_delivery_receipt@1",
      ...input,
      receiptId: normalizeString(input.receiptId, `headless_receipt_${sha256(stableStringify(input)).slice(7, 31)}`),
      actionId: normalizeString(input.actionId, ""),
      status: normalizeString(input.status, "delivered"),
      rawOutputIncluded: input.rawOutputIncluded === true,
      rawPathIncluded: input.rawPathIncluded === true,
      createdAt: normalizeString(input.createdAt, at),
    };
    this.db.prepare(`
      insert into direct_bridge_delivery_receipts (receipt_id, action_id, status, receipt_json, created_at)
      values (?, ?, ?, ?, ?)
      on conflict(receipt_id) do update set
        status = excluded.status,
        receipt_json = excluded.receipt_json
    `).run(receipt.receiptId, receipt.actionId, receipt.status, safeJson(receipt), receipt.createdAt);
    return receipt;
  }

  writeHumanDecisionPacket(input = {}, options = {}) {
    const at = normalizeString(options.now, nowIso(options.nowMs));
    const decision = {
      schema: HUMAN_DECISION_PACKET_SCHEMA,
      ...input,
      decisionId: normalizeString(input.decisionId, `headless_decision_${sha256(stableStringify(input)).slice(7, 31)}`),
      sourceEnvelopeId: normalizeString(input.sourceEnvelopeId || input.envelopeId, ""),
      workThreadId: normalizeString(input.workThreadId, ""),
      status: normalizeString(input.status, "pending"),
      choices: Array.isArray(input.choices) ? input.choices.map((choice) => ({
        choiceId: normalizeString(choice.choiceId || choice.choice_id, ""),
        label: normalizeString(choice.label, ""),
        description: normalizeString(choice.description, ""),
        consequenceClass: normalizeString(choice.consequenceClass || choice.consequence_class, "informational"),
      })).filter((choice) => choice.choiceId && choice.label) : [],
      rawOutputIncluded: input.rawOutputIncluded === true,
      rawFreeTextAuthority: false,
      createdAt: normalizeString(input.createdAt, at),
      updatedAt: at,
    };
    this.db.prepare(`
      insert into direct_bridge_human_decisions (decision_id, envelope_id, status, decision_json, created_at, updated_at)
      values (?, ?, ?, ?, ?, ?)
      on conflict(decision_id) do update set
        status = excluded.status,
        decision_json = excluded.decision_json,
        updated_at = excluded.updated_at
    `).run(
      decision.decisionId,
      decision.sourceEnvelopeId,
      decision.status,
      safeJson(decision),
      decision.createdAt,
      decision.updatedAt,
    );
    return decision;
  }

  readHumanDecisionPacket(decisionId = "") {
    const row = this.db.prepare("select decision_json from direct_bridge_human_decisions where decision_id = ?").get(normalizeString(decisionId, ""));
    return row ? parseJson(row.decision_json, null) : null;
  }

  duplicateEventForProcessingIdentity(processingIdentity = "") {
    const duplicate = this.db.prepare("select * from direct_bridge_inbox_events where processing_identity = ?").get(processingIdentity);
    if (!duplicate) return null;
    return {
      ok: true,
      duplicate: true,
      status: duplicate.lifecycle,
      event: safeEventProjection(duplicate),
    };
  }

  duplicateEventForInput(input = {}, options = {}) {
    const at = nowIso(options.nowMs);
    const validation = this.validateIngress(input, options);
    const processingIdentity = validation.processingIdentity || `invalid:${sha256(`${at}:${validation.errorCode}:${stableStringify(input)}`).slice(7, 31)}`;
    return this.duplicateEventForProcessingIdentity(processingIdentity);
  }

  submitHumanDecisionReply(input = {}, options = {}) {
    const at = normalizeString(options.now, nowIso(options.nowMs));
    const decisionId = normalizeString(input.decisionId || input.decision_id, "");
    const choiceId = normalizeString(input.choiceId || input.choice_id, "");
    const freeTextNote = normalizeString(input.freeTextNote || input.free_text_note, "").slice(0, 2000);
    const operatorEvidenceKey = normalizeString(input.operatorEvidenceKey || input.operator_evidence_key, "");
    const current = this.readHumanDecisionPacket(decisionId);
    if (!current) {
      return {
        ok: false,
        status: "blocked",
        error: "human_decision_not_found",
        rawPayloadIncluded: false,
      };
    }
    if (current.status !== "pending") {
      return {
        ok: false,
        status: current.status,
        error: "human_decision_closed",
        decision: current,
        rawPayloadIncluded: false,
      };
    }
    const choice = (Array.isArray(current.choices) ? current.choices : []).find((item) => item.choiceId === choiceId);
    if (!choice) {
      return {
        ok: false,
        status: "blocked",
        error: "human_reply_invalid_choice",
        decision: current,
        rawPayloadIncluded: false,
      };
    }
    const reply = {
      schema: HUMAN_DECISION_REPLY_SCHEMA,
      decisionId,
      choiceId,
      operatorEvidenceKey,
      receivedAt: at,
      freeTextNote,
      freeTextAuthority: false,
      rawPayloadIncluded: false,
    };
    const next = {
      ...current,
      status: "replied",
      selectedChoiceId: choiceId,
      selectedChoiceLabel: choice.label,
      reply,
      updatedAt: at,
    };
    this.writeHumanDecisionPacket(next, { now: at });
    return {
      ok: true,
      status: "replied",
      decision: next,
      reply,
      rawPayloadIncluded: false,
    };
  }

  submitEvent(input = {}, options = {}) {
    const at = nowIso(options.nowMs);
    const validation = this.validateIngress(input, options);
    if (validation.validationFailedWithoutWrite) {
      return {
        ok: false,
        duplicate: false,
        status: validation.lifecycle,
        error: validation.errorCode,
        event: null,
        routeDecision: null,
        rawPayloadIncluded: false,
      };
    }
    const processingIdentity = validation.processingIdentity || `invalid:${sha256(`${at}:${validation.errorCode}:${stableStringify(input)}`).slice(7, 31)}`;
    const duplicate = this.duplicateEventForProcessingIdentity(processingIdentity);
    if (duplicate) return duplicate;
    const envelopeId = normalizeString(input.envelopeId || input.envelope_id, `bridge_evt_${sha256(`${processingIdentity}:${at}`).slice(7, 31)}`);
    const eventJson = {
      sourceSystem: validation.sourceSystem,
      factSourcePosture: validation.factSourcePosture,
      declaredWorkThreadId: validation.declaredWorkThreadId,
      evidenceRefs: validation.evidenceRefs,
      payloadStorageRef: validation.payloadStorageRef,
      rawPayloadIncluded: false,
    };
    const writeInbox = (lifecycle, routeDecisionId = "") => {
      this.db.prepare(`
        insert into direct_bridge_inbox_events (
          envelope_id, idempotency_key, processing_identity, client_id,
          event_schema, event_class, event_kind, requested_route_id,
          route_version, work_thread_id, target_thread_id, lifecycle,
          payload_digest, event_json, route_decision_id, raw_payload_included,
          created_at, updated_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
      `).run(
        envelopeId,
        validation.idempotencyKey,
        processingIdentity,
        validation.clientId,
        validation.eventSchema,
        validation.eventClass,
        validation.eventKind,
        validation.requestedRouteId,
        validation.routeVersion,
        validation.workThreadId,
        validation.targetThreadId,
        lifecycle,
        validation.payloadDigest,
        safeJson(eventJson),
        routeDecisionId,
        at,
        at,
      );
    };
    this.db.exec("begin immediate");
    try {
      if (!validation.ok) {
        const decision = validation.routeDecision || this.writeRouteDecision({
          envelopeId,
          routeId: validation.requestedRouteId,
          routeVersion: validation.routeVersion,
          workThreadId: validation.workThreadId,
          targetThreadId: validation.targetThreadId,
          status: "blocked",
          blockerCode: validation.errorCode,
          evidenceRefs: validation.evidenceRefs,
          createdAt: at,
        });
        writeInbox(validation.lifecycle, decision.decisionId);
        this.appendLifecycle(envelopeId, "received", "", {}, at);
        this.appendLifecycle(envelopeId, validation.lifecycle, validation.errorCode, {
          routeDecisionId: decision.decisionId,
        }, at);
        const row = this.db.prepare("select * from direct_bridge_inbox_events where envelope_id = ?").get(envelopeId);
        const result = {
          ok: false,
          duplicate: false,
          status: validation.lifecycle,
          error: validation.errorCode,
          event: safeEventProjection(row),
          routeDecision: decision,
        };
        this.db.exec("commit");
        return result;
      }
      const decision = this.writeRouteDecision({
        envelopeId,
        routeId: validation.route.routeId,
        routeVersion: validation.route.routeVersion,
        routeDigest: validation.route.routeDigest,
        workThreadId: validation.workThreadId,
        targetThreadId: validation.targetThreadId,
        status: "resolved",
        dependencyBundle: validation.route.dependencyBundle,
        evidenceRefs: validation.evidenceRefs,
        createdAt: at,
      });
      writeInbox("route_resolved", decision.decisionId);
      this.appendLifecycle(envelopeId, "received", "", {}, at);
      this.appendLifecycle(envelopeId, "accepted_inbox", "", {
        clientId: validation.clientId,
        idempotencyKey: validation.idempotencyKey,
      }, at);
      this.appendLifecycle(envelopeId, "route_resolved", "", {
        routeDecisionId: decision.decisionId,
        routeDigest: validation.route.routeDigest,
        workThreadId: validation.workThreadId,
        targetThreadId: validation.targetThreadId,
      }, at);
      const row = this.db.prepare("select * from direct_bridge_inbox_events where envelope_id = ?").get(envelopeId);
      const result = {
        ok: true,
        duplicate: false,
        status: "route_resolved",
        event: safeEventProjection(row),
        routeDecision: decision,
      };
      this.db.exec("commit");
      return result;
    } catch (error) {
      try {
        this.db.exec("rollback");
      } catch {
        // Preserve the original write failure.
      }
      throw error;
    }
  }

  validateIngress(input = {}, options = {}) {
    if (!isPlainObject(input)) {
      return this.blockedValidation("invalid_json", "blocked_ingress");
    }
    const rawPayloadIncluded = input.rawPayloadIncluded === true || input.raw_payload_included === true || isPlainObject(input.rawPayload) || typeof input.rawPayload === "string" || isPlainObject(input.raw_payload) || typeof input.raw_payload === "string";
    const clientId = normalizeString(input.clientId || input.client_id || options.clientId, "");
    const idempotencyKey = normalizeString(input.idempotencyKey || input.idempotency_key, "");
    const eventSchema = normalizeString(input.eventSchema || input.event_schema || input.schema, "");
    const eventClass = normalizeString(input.eventClass || input.event_class, "diagnostic");
    const eventKind = normalizeString(input.eventKind || input.event_kind, "diagnostic");
    const sourceSystem = normalizeString(input.sourceSystem || input.source_system, "unknown");
    const factSourcePosture = normalizeString(input.factSourcePosture || input.fact_source_posture, "client_declared");
    const requestedRouteId = normalizeString(input.requestedRouteId || input.requestedBridgeRoute || input.requested_route_id, "");
    const routeVersion = normalizeString(input.routeVersion || input.requestedRouteVersion || input.route_version, "");
    const declaredWorkThreadId = normalizeString(input.declaredWorkThreadId || input.workThreadId || input.declared_work_thread_id, "");
    const payloadDigest = normalizeString(input.payloadDigest || input.payload_digest, digestFor("bridge-event-payload", {
      eventSchema,
      eventClass,
      eventKind,
      sourceSystem,
      facts: isPlainObject(input.facts) ? input.facts : null,
      payloadRef: isPlainObject(input.payloadRef || input.payload_ref) ? (input.payloadRef || input.payload_ref) : null,
    }));
    const payloadStorageRef = isPlainObject(input.payloadStorageRef || input.payloadRef || input.payload_ref)
      ? (input.payloadStorageRef || input.payloadRef || input.payload_ref)
      : null;
    const evidenceValidation = validateEvidenceRefs(input.evidenceRefs);
    const evidenceRefs = evidenceValidation.ok ? evidenceValidation.refs : [];
    const base = {
      ok: false,
      clientId,
      idempotencyKey,
      processingIdentity: "",
      eventSchema,
      eventClass,
      eventKind,
      sourceSystem,
      factSourcePosture,
      requestedRouteId,
      routeVersion,
      declaredWorkThreadId,
      workThreadId: declaredWorkThreadId,
      targetThreadId: "",
      payloadDigest,
      payloadStorageRef,
      evidenceRefs,
      route: null,
      routeDecision: null,
      lifecycle: "blocked_ingress",
      errorCode: "",
      validationFailedWithoutWrite: !evidenceValidation.ok,
    };
    if (!evidenceValidation.ok) {
      return {
        ...base,
        errorCode: evidenceValidation.errorCode,
        lifecycle: "blocked_ingress",
        validationFailedWithoutWrite: true,
      };
    }
    if (rawPayloadIncluded) return { ...base, errorCode: "raw_payload_included", lifecycle: "blocked_ingress" };
    if (!clientId) return { ...base, errorCode: "missing_client", lifecycle: "blocked_ingress" };
    if (!idempotencyKey) return { ...base, errorCode: "missing_idempotency_key", lifecycle: "blocked_ingress" };
    if (!eventSchema) return { ...base, errorCode: "missing_event_schema", lifecycle: "blocked_ingress" };
    if (!requestedRouteId) return { ...base, errorCode: "missing_route", lifecycle: "route_blocked" };
    const client = this.readClient(clientId);
    if (!client) return { ...base, errorCode: "unknown_client", lifecycle: "blocked_ingress", processingIdentity: `${clientId}:${idempotencyKey}` };
    if (client.status !== "active") return { ...base, errorCode: "client_inactive", lifecycle: "blocked_ingress", processingIdentity: `${clientId}:${idempotencyKey}` };
    if (!client.allowedIngressContracts.includes(eventSchema)) {
      return { ...base, errorCode: "event_schema_not_allowed", lifecycle: "blocked_ingress", processingIdentity: `${clientId}:${idempotencyKey}:${eventSchema}` };
    }
    if (client.allowedRoutes.length && !client.allowedRoutes.includes(requestedRouteId)) {
      return { ...base, errorCode: "route_not_allowed_for_client", lifecycle: "route_blocked", processingIdentity: `${clientId}:${idempotencyKey}:${requestedRouteId}` };
    }
    const route = this.readRoute(requestedRouteId, routeVersion);
    if (!route) return { ...base, errorCode: "unknown_route", lifecycle: "route_blocked", processingIdentity: `${clientId}:${idempotencyKey}:${requestedRouteId}:${routeVersion || "latest"}` };
    const frozenRouteVersion = route.routeVersion;
    const processingIdentity = `${clientId}:${idempotencyKey}:${route.routeId}:${frozenRouteVersion}:${route.routeDigest}`;
    if (route.status !== "active") {
      return { ...base, route, routeVersion: frozenRouteVersion, errorCode: "route_disabled", lifecycle: "route_blocked", processingIdentity };
    }
    if (route.ingressContractRef && route.ingressContractRef !== eventSchema) {
      return { ...base, route, routeVersion: frozenRouteVersion, errorCode: "route_contract_mismatch", lifecycle: "route_blocked", processingIdentity };
    }
    const candidateIds = Array.isArray(route.candidateWorkThreadIds) ? route.candidateWorkThreadIds.filter(Boolean) : [];
    const workThreadId = normalizeString(declaredWorkThreadId, route.workThreadId || (candidateIds.length === 1 ? candidateIds[0] : ""));
    if (!workThreadId && candidateIds.length > 1) {
      return { ...base, route, routeVersion: frozenRouteVersion, errorCode: "route_ambiguity", lifecycle: "route_blocked", processingIdentity };
    }
    if (!workThreadId) {
      return { ...base, route, routeVersion: frozenRouteVersion, errorCode: "missing_work_thread", lifecycle: "route_blocked", processingIdentity };
    }
    const workThread = this.readWorkThread(workThreadId);
    if (!workThread) {
      return { ...base, route, routeVersion: frozenRouteVersion, workThreadId, errorCode: "work_thread_missing", lifecycle: "route_blocked", processingIdentity };
    }
    if (workThread.status === "archived" || workThread.status === "disabled") {
      return { ...base, route, routeVersion: frozenRouteVersion, workThreadId, errorCode: "work_thread_inactive", lifecycle: "route_blocked", processingIdentity };
    }
    const targetThreadId = normalizeString(route.targetThreadRef?.threadId || route.targetThreadRef?.thread_id, "");
    if (!targetThreadId) {
      return { ...base, route, routeVersion: frozenRouteVersion, workThreadId, errorCode: "target_thread_missing", lifecycle: "route_blocked", processingIdentity };
    }
    return {
      ...base,
      ok: true,
      route,
      routeVersion: frozenRouteVersion,
      workThreadId,
      targetThreadId,
      processingIdentity,
      lifecycle: "route_resolved",
      errorCode: "",
      evidenceRefs,
    };
  }

  blockedValidation(errorCode, lifecycle) {
    return {
      ok: false,
      errorCode,
      lifecycle,
      clientId: "",
      idempotencyKey: "",
      processingIdentity: "",
      eventSchema: "",
      eventClass: "",
      eventKind: "",
      sourceSystem: "",
      factSourcePosture: "client_declared",
      requestedRouteId: "",
      routeVersion: "",
      declaredWorkThreadId: "",
      workThreadId: "",
      targetThreadId: "",
      payloadDigest: "",
      evidenceRefs: [],
      route: null,
      routeDecision: null,
    };
  }
}

module.exports = {
  CLIENT_REGISTRATION_SCHEMA,
  DirectHeadlessBridgeStore,
  EVENT_ENVELOPE_SCHEMA,
  HEADLESS_TURN_PACKET_SCHEMA,
  HEADLESS_BRIDGE_STORE_SCHEMA,
  HUMAN_DECISION_PACKET_SCHEMA,
  HUMAN_DECISION_REPLY_SCHEMA,
  REDUCED_RESULT_SCHEMA,
  ROUTE_BINDING_SCHEMA,
  clientCapabilityTokenDigest,
  digestFor,
  validateEvidenceRefs,
  normalizeClient,
  normalizeRoute,
  normalizeString,
  normalizeWorkThread,
  routeDigest,
  sha256,
  stableStringify,
};
