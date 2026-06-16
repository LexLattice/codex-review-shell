"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");

const HEADLESS_BRIDGE_STORE_SCHEMA = "direct_headless_bridge_store@1";
const EVENT_ENVELOPE_SCHEMA = "bridge_event_envelope@1";
const ROUTE_BINDING_SCHEMA = "bridge_route_binding@1";
const CLIENT_REGISTRATION_SCHEMA = "bridge_client_registration@1";

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
    egressPolicyRefs: Array.isArray(route.egressPolicyRefs) ? route.egressPolicyRefs.map((id) => normalizeString(id, "")).filter(Boolean).sort() : [],
    interruptionPolicyRef: normalizeString(route.interruptionPolicyRef, ""),
    authorityBoundaryRef: normalizeString(route.authorityBoundaryRef, ""),
    toolAuthorityMode: normalizeString(route.toolAuthorityMode, "disabled"),
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
    egressPolicyRefs: Array.isArray(input.egressPolicyRefs || input.egress_policy_refs) ? (input.egressPolicyRefs || input.egress_policy_refs).map((value) => normalizeString(value, "")).filter(Boolean) : [],
    interruptionPolicyRef: normalizeString(input.interruptionPolicyRef || input.interruption_policy_ref, ""),
    authorityBoundaryRef: normalizeString(input.authorityBoundaryRef || input.authority_boundary_ref, ""),
    toolAuthorityMode: normalizeString(input.toolAuthorityMode || input.tool_authority_mode, "disabled"),
  };
  route.dependencyBundle = {
    ingressContractRef: route.ingressContractRef,
    contextPolicyRef: route.contextPolicyRef,
    modelPolicyRef: route.modelPolicyRef,
    outputReducerRef: route.outputReducerRef,
    egressPolicyRefs: route.egressPolicyRefs,
    interruptionPolicyRef: route.interruptionPolicyRef,
    authorityBoundaryRef: route.authorityBoundaryRef,
    toolAuthorityMode: route.toolAuthorityMode,
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
    evidenceRefs: Array.isArray(event.evidenceRefs) ? event.evidenceRefs : [],
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
    `);
    this.db.prepare("create table if not exists direct_bridge_meta (key text primary key, value_json text not null)").run();
    this.db.prepare(`
      insert into direct_bridge_meta (key, value_json)
      values ('schema', ?)
      on conflict(key) do update set value_json = excluded.value_json
    `).run(safeJson({ schema: HEADLESS_BRIDGE_STORE_SCHEMA }));
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
      "direct_bridge_outbox_actions",
      "direct_bridge_delivery_receipts",
      "direct_bridge_human_decisions",
    ]);
    if (!allowed.has(tableName)) throw new Error(`headless_bridge_count_table_invalid:${tableName}`);
    return Number(this.db.prepare(`select count(*) as count from ${tableName}`).get()?.count || 0);
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
      lifecycle,
      backpressure: extra.backpressure || null,
      lastEventAt: normalizeString(lastEventRow?.at, ""),
      lastErrorClass: normalizeString(extra.lastErrorClass, ""),
      providerRequestsStarted: 0,
      rawSecretsExposed: false,
      rawPayloadsExposed: false,
      rawProviderFramesExposed: false,
      rawPathsExposed: false,
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

  submitEvent(input = {}, options = {}) {
    const at = nowIso(options.nowMs);
    const validation = this.validateIngress(input, options);
    const processingIdentity = validation.processingIdentity || `invalid:${sha256(`${at}:${validation.errorCode}:${stableStringify(input)}`).slice(7, 31)}`;
    const duplicate = this.db.prepare("select * from direct_bridge_inbox_events where processing_identity = ?").get(processingIdentity);
    if (duplicate) {
      return {
        ok: true,
        duplicate: true,
        status: duplicate.lifecycle,
        event: safeEventProjection(duplicate),
      };
    }
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
    const evidenceRefs = [
      evidenceRef("bridge_ingress", "Headless bridge ingress validation"),
      ...(Array.isArray(input.evidenceRefs) ? input.evidenceRefs : []),
    ];
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
    };
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
      evidenceRefs: [
        ...evidenceRefs,
        evidenceRef("bridge_route_binding", "Route binding resolved", { artifactDigest: route.routeDigest }),
        evidenceRef("work_thread", "WorkThread resolved", { artifactId: workThreadId }),
      ],
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
  HEADLESS_BRIDGE_STORE_SCHEMA,
  ROUTE_BINDING_SCHEMA,
  clientCapabilityTokenDigest,
  digestFor,
  normalizeClient,
  normalizeRoute,
  normalizeString,
  normalizeWorkThread,
  routeDigest,
  sha256,
  stableStringify,
};
