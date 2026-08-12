"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const {
  AUDIT_VERDICTS,
  assertAuthorized,
  assertNoRawExposure,
  buildEvent,
  buildPolicySnapshot,
  canonicalJson,
  compileArtifactRoutingPlan,
  digestFor,
  fail,
  normalizeActor,
  normalizeEvidenceRefs,
  normalizeScope,
  safeTransitionProjection,
} = require("./artifact-audit-kernel");

const STORE_SCHEMA = "direct_artifact_audit_store@1";
const EVENT_TYPES = Object.freeze([
  "artifact_requested",
  "production_started",
  "candidate_recorded",
  "audit_started",
  "audit_verdict_recorded",
  "artifact_admitted",
  "artifact_rejected",
  "artifact_remanded",
]);

function parseJson(value, label) {
  try {
    return JSON.parse(String(value));
  } catch {
    fail("artifact_audit_persisted_json_invalid", label);
  }
}

function nowIso(now) {
  return new Date(now()).toISOString();
}

function key(value, label) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(value)) {
    fail("artifact_audit_id_invalid", label);
  }
  return value;
}

class DirectArtifactAuditStore {
  constructor(options = {}) {
    if (!options.db && (!options.dbPath || typeof options.dbPath !== "string")) {
      fail("artifact_audit_store_path_required");
    }
    if (!options.db) fs.mkdirSync(path.dirname(options.dbPath), { recursive: true });
    this.dbPath = options.dbPath || "";
    this.db = options.db || new DatabaseSync(options.dbPath);
    this.ownsDatabase = !options.db;
    this.now = typeof options.now === "function" ? options.now : Date.now;
    this.transactionDepth = 0;
    this.ensurePragmas();
    this.ensureSchema();
  }

  ensureOpen() {
    if (!this.db) fail("artifact_audit_store_closed");
  }

  ensurePragmas() {
    this.db.exec("pragma journal_mode = WAL");
    this.db.exec("pragma foreign_keys = ON");
    this.db.exec("pragma synchronous = FULL");
    this.db.exec("pragma busy_timeout = 5000");
  }

  ensureSchema() {
    this.db.exec(`
      create table if not exists direct_artifact_audit_meta (
        key text primary key,
        value text not null
      );
      create table if not exists direct_artifact_audit_policies (
        project_id text not null,
        artifact_class_id text not null,
        policy_revision integer not null,
        policy_digest text not null unique,
        policy_json text not null,
        declared_by text not null,
        declared_at text not null,
        primary key (project_id, artifact_class_id)
      );
      create table if not exists direct_artifact_audit_heads (
        project_id text not null,
        work_thread_id text not null,
        artifact_id text not null,
        artifact_class_id text not null,
        policy_digest text not null,
        artifact_revision integer not null,
        state text not null,
        head_version integer not null,
        producer_actor_id text not null default '',
        head_event_id text not null,
        updated_at text not null,
        primary key (project_id, work_thread_id, artifact_id),
        foreign key (policy_digest) references direct_artifact_audit_policies(policy_digest)
      );
      create table if not exists direct_artifact_audit_events (
        sequence integer primary key,
        event_id text not null unique,
        project_id text not null,
        work_thread_id text not null,
        artifact_id text not null,
        artifact_class_id text not null,
        artifact_revision integer not null,
        policy_digest text not null,
        operation text not null,
        event_type text not null,
        actor_id text not null,
        actor_role_id text not null,
        idempotency_key text not null,
        input_digest text not null,
        state_from text,
        state_to text not null,
        event_digest text not null unique,
        event_json text not null,
        occurred_at text not null,
        unique (actor_id, operation, idempotency_key),
        foreign key (policy_digest) references direct_artifact_audit_policies(policy_digest)
      );
      create index if not exists direct_artifact_audit_event_scope_idx
        on direct_artifact_audit_events(project_id, work_thread_id, artifact_id, sequence);
      create table if not exists direct_artifact_audits (
        project_id text not null,
        work_thread_id text not null,
        artifact_id text not null,
        artifact_revision integer not null,
        requirement_id text not null,
        auditor_actor_id text not null,
        auditor_role_id text not null,
        verdict text not null,
        event_id text not null unique,
        evidence_json text not null,
        primary key (project_id, work_thread_id, artifact_id, artifact_revision, requirement_id),
        unique (project_id, work_thread_id, artifact_id, artifact_revision, auditor_actor_id),
        foreign key (event_id) references direct_artifact_audit_events(event_id)
      );
      create table if not exists direct_artifact_audit_subscriptions (
        subscription_id text primary key,
        project_id text not null,
        work_thread_id text not null default '',
        artifact_id text not null default '',
        artifact_class_id text not null,
        policy_digest text not null,
        subscriber_actor_id text not null,
        subscriber_role_id text not null,
        event_types_json text not null,
        subscription_digest text not null unique,
        created_at text not null,
        foreign key (policy_digest) references direct_artifact_audit_policies(policy_digest)
      );
      create trigger if not exists direct_artifact_audit_policies_no_update
        before update on direct_artifact_audit_policies begin
          select raise(abort, 'artifact_audit_append_only');
        end;
      create trigger if not exists direct_artifact_audit_policies_no_delete
        before delete on direct_artifact_audit_policies begin
          select raise(abort, 'artifact_audit_append_only');
        end;
      create trigger if not exists direct_artifact_audit_events_no_update
        before update on direct_artifact_audit_events begin
          select raise(abort, 'artifact_audit_append_only');
        end;
      create trigger if not exists direct_artifact_audit_events_no_delete
        before delete on direct_artifact_audit_events begin
          select raise(abort, 'artifact_audit_append_only');
        end;
      create trigger if not exists direct_artifact_audits_no_update
        before update on direct_artifact_audits begin
          select raise(abort, 'artifact_audit_append_only');
        end;
      create trigger if not exists direct_artifact_audits_no_delete
        before delete on direct_artifact_audits begin
          select raise(abort, 'artifact_audit_append_only');
        end;
      create trigger if not exists direct_artifact_audit_subscriptions_no_update
        before update on direct_artifact_audit_subscriptions begin
          select raise(abort, 'artifact_audit_append_only');
        end;
      create trigger if not exists direct_artifact_audit_subscriptions_no_delete
        before delete on direct_artifact_audit_subscriptions begin
          select raise(abort, 'artifact_audit_append_only');
        end;
    `);
    this.db.prepare(`insert into direct_artifact_audit_meta(key, value)
      values ('store_schema', ?) on conflict(key) do nothing`).run(STORE_SCHEMA);
    const row = this.db.prepare(`select value from direct_artifact_audit_meta where key = 'store_schema'`).get();
    if (row?.value !== STORE_SCHEMA) fail("artifact_audit_store_identity_conflict");
  }

  close() {
    if (!this.db) return;
    if (this.ownsDatabase) this.db.close();
    this.db = null;
  }

  transaction(action) {
    this.ensureOpen();
    if (this.transactionDepth || this.db.isTransaction === true) return action();
    this.db.exec("begin immediate");
    this.transactionDepth += 1;
    try {
      const result = action();
      this.db.exec("commit");
      return result;
    } catch (error) {
      try { this.db.exec("rollback"); } catch {}
      throw error;
    } finally {
      this.transactionDepth -= 1;
    }
  }

  declareArtifactClass(input = {}) {
    assertNoRawExposure(input, "declaration");
    const policy = buildPolicySnapshot(input.policy);
    const actor = assertAuthorized(policy, input.actor, "propose", [policy.managerRoleId]);
    return this.transaction(() => {
      const existing = this.db.prepare(`select policy_json from direct_artifact_audit_policies
        where project_id = ? and artifact_class_id = ?`).get(policy.projectId, policy.artifactClassId);
      if (existing) {
        const persisted = parseJson(existing.policy_json, "policy");
        if (persisted.policyDigest !== policy.policyDigest) fail("artifact_audit_policy_substitution");
        return { policy: persisted, changed: false };
      }
      this.db.prepare(`insert into direct_artifact_audit_policies(
        project_id, artifact_class_id, policy_revision, policy_digest, policy_json, declared_by, declared_at
      ) values (?, ?, ?, ?, ?, ?, ?)`).run(
        policy.projectId, policy.artifactClassId, policy.revision, policy.policyDigest,
        canonicalJson(policy), actor.actorId, nowIso(this.now),
      );
      return { policy, changed: true };
    });
  }

  getPolicy(projectId, artifactClassId) {
    const row = this.db.prepare(`select policy_json from direct_artifact_audit_policies
      where project_id = ? and artifact_class_id = ?`).get(projectId, artifactClassId);
    if (!row) return null;
    const persisted = parseJson(row.policy_json, "policy");
    const rebuilt = buildPolicySnapshot({
      artifactClassId: persisted.artifactClassId,
      projectId: persisted.projectId,
      managerRoleId: persisted.managerRoleId,
      roles: persisted.roles,
      producerRoleIds: persisted.producerRoleIds,
      auditRequirements: persisted.auditRequirements,
      admissionRoleId: persisted.admissionRoleId,
      allowedEvidenceKinds: persisted.allowedEvidenceKinds,
      revision: persisted.revision,
    });
    if (canonicalJson(rebuilt) !== canonicalJson(persisted)) fail("artifact_audit_policy_integrity_failed");
    return persisted;
  }

  compileRoutingPlan(input = {}) {
    assertNoRawExposure(input, "routing");
    const scope = normalizeScope(input.scope);
    const policy = this._policyFor(scope, input.policyDigest);
    return compileArtifactRoutingPlan(policy, scope);
  }

  _policyFor(scope, policyDigest) {
    const policy = this.getPolicy(scope.projectId, scope.artifactClassId);
    if (!policy) fail("artifact_audit_policy_missing");
    if (policy.policyDigest !== policyDigest) fail("artifact_audit_policy_substitution");
    return policy;
  }

  _head(scope) {
    return this.db.prepare(`select * from direct_artifact_audit_heads
      where project_id = ? and work_thread_id = ? and artifact_id = ?`).get(
        scope.projectId, scope.workThreadId, scope.artifactId,
      ) || null;
  }

  _inputDigest(operation, input) {
    const bound = { ...input };
    delete bound.idempotencyKey;
    return digestFor(`direct_artifact_audit_${operation}_input@1`, bound);
  }

  _replay(actor, operation, idempotencyKey, inputDigest) {
    const row = this.db.prepare(`select input_digest, event_json from direct_artifact_audit_events
      where actor_id = ? and operation = ? and idempotency_key = ?`).get(
        actor.actorId, operation, idempotencyKey,
      );
    if (!row) return null;
    if (row.input_digest !== inputDigest) fail("artifact_audit_idempotency_input_conflict");
    return parseJson(row.event_json, "event-replay");
  }

  _assertExpected(head, input) {
    if (!head) fail("artifact_audit_head_missing");
    if (head.policy_digest !== input.policyDigest) fail("artifact_audit_policy_substitution");
    if (head.artifact_revision !== input.expectedRevision) fail("artifact_audit_stale_revision");
    if (head.state !== input.expectedState) fail("artifact_audit_stale_state");
  }

  _nextSequence() {
    return Number(this.db.prepare(`select coalesce(max(sequence), 0) + 1 as sequence
      from direct_artifact_audit_events`).get().sequence);
  }

  _appendEvent({ operation, eventType, actor, scope, policy, idempotencyKey, inputDigest,
    revision, stateFrom, stateTo, evidenceRefs = [], audit = null, decision = null }) {
    const sequence = this._nextSequence();
    const eventId = `dae_${digestFor("direct_artifact_audit_event_id@1", {
      operation, actor, scope, idempotencyKey, inputDigest,
    }).slice(7, 31)}`;
    const event = buildEvent({
      eventId, sequence, eventType,
      scope: { ...scope, revision },
      policyRef: { id: policy.artifactClassId, digest: policy.policyDigest },
      actor, stateFrom, stateTo, evidenceRefs,
      occurredAt: nowIso(this.now), audit, decision,
    });
    this.db.prepare(`insert into direct_artifact_audit_events(
      sequence, event_id, project_id, work_thread_id, artifact_id, artifact_class_id,
      artifact_revision, policy_digest, operation, actor_id, actor_role_id,
      event_type, idempotency_key, input_digest, state_from, state_to, event_digest, event_json, occurred_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      sequence, event.eventId, scope.projectId, scope.workThreadId, scope.artifactId,
      scope.artifactClassId, revision, policy.policyDigest, operation, actor.actorId,
      actor.roleId, eventType, idempotencyKey, inputDigest, stateFrom, stateTo, event.eventDigest,
      canonicalJson(event), event.occurredAt,
    );
    return event;
  }

  requestArtifact(input = {}) {
    assertNoRawExposure(input, "request");
    const scope = normalizeScope(input.scope);
    const actor = normalizeActor(input.actor);
    const idempotencyKey = key(input.idempotencyKey, "idempotencyKey");
    const inputDigest = this._inputDigest("request", input);
    return this.transaction(() => {
      const replay = this._replay(actor, "request", idempotencyKey, inputDigest);
      if (replay) return replay;
      const policy = this._policyFor(scope, input.policyDigest);
      assertAuthorized(policy, actor, "propose", [policy.managerRoleId]);
      if (this._head(scope)) fail("artifact_audit_artifact_exists");
      const event = this._appendEvent({ operation: "request", eventType: "artifact_requested",
        actor, scope, policy, idempotencyKey, inputDigest, revision: 1,
        stateFrom: null, stateTo: "requested" });
      this.db.prepare(`insert into direct_artifact_audit_heads(
        project_id, work_thread_id, artifact_id, artifact_class_id, policy_digest,
        artifact_revision, state, head_version, head_event_id, updated_at
      ) values (?, ?, ?, ?, ?, 1, 'requested', 1, ?, ?)`).run(
        scope.projectId, scope.workThreadId, scope.artifactId, scope.artifactClassId,
        policy.policyDigest, event.eventId, event.occurredAt,
      );
      return event;
    });
  }

  _transition(input, config) {
    assertNoRawExposure(input, config.operation);
    const scope = normalizeScope(input.scope);
    const actor = normalizeActor(input.actor);
    const idempotencyKey = key(input.idempotencyKey, "idempotencyKey");
    if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1) fail("artifact_audit_revision_invalid");
    key(input.expectedState, "expectedState");
    const inputDigest = this._inputDigest(config.operation, input);
    return this.transaction(() => {
      const replay = this._replay(actor, config.operation, idempotencyKey, inputDigest);
      if (replay) return replay;
      const policy = this._policyFor(scope, input.policyDigest);
      const head = this._head(scope);
      this._assertExpected(head, input);
      const prepared = config.prepare({ input, policy, head, actor, scope });
      const revision = prepared.revision || head.artifact_revision;
      const stateTo = prepared.stateTo;
      const event = this._appendEvent({
        operation: config.operation, eventType: config.eventType, actor, scope, policy,
        idempotencyKey, inputDigest, revision, stateFrom: head.state, stateTo,
        evidenceRefs: prepared.evidenceRefs, audit: prepared.audit, decision: prepared.decision,
      });
      if (prepared.beforeHeadCas) prepared.beforeHeadCas(event);
      const result = this.db.prepare(`update direct_artifact_audit_heads set
        artifact_revision = ?, state = ?, head_version = head_version + 1,
        producer_actor_id = ?, head_event_id = ?, updated_at = ?
        where project_id = ? and work_thread_id = ? and artifact_id = ?
          and artifact_revision = ? and state = ? and head_version = ?`).run(
        revision, stateTo, prepared.producerActorId ?? head.producer_actor_id,
        event.eventId, event.occurredAt, scope.projectId, scope.workThreadId, scope.artifactId,
        head.artifact_revision, head.state, head.head_version,
      );
      if (Number(result.changes) !== 1) fail("artifact_audit_head_compare_and_swap_failed");
      return event;
    });
  }

  beginProduction(input = {}) {
    return this._transition(input, {
      operation: "begin_production",
      eventType: "production_started",
      prepare: ({ input: value, policy, head, actor }) => {
        assertAuthorized(policy, actor, "propose", policy.producerRoleIds);
        if (!["requested", "remanded"].includes(head.state)) fail("artifact_audit_transition_denied");
        return {
          stateTo: "under_production",
          revision: head.state === "remanded" ? head.artifact_revision + 1 : head.artifact_revision,
          producerActorId: actor.actorId,
        };
      },
    });
  }

  submitCandidate(input = {}) {
    return this._transition(input, {
      operation: "submit_candidate",
      eventType: "candidate_recorded",
      prepare: ({ input: value, policy, head, actor, scope }) => {
        assertAuthorized(policy, actor, "propose", policy.producerRoleIds);
        if (head.state !== "under_production" || head.producer_actor_id !== actor.actorId) {
          fail("artifact_audit_producer_mismatch");
        }
        const evidenceRefs = normalizeEvidenceRefs(value.evidenceRefs,
          { ...scope, revision: head.artifact_revision }, policy.allowedEvidenceKinds);
        return { stateTo: "candidate", evidenceRefs };
      },
    });
  }

  beginAudit(input = {}) {
    return this._transition(input, {
      operation: "begin_audit",
      eventType: "audit_started",
      prepare: ({ policy, head, actor }) => {
        const eligible = [...new Set(policy.auditRequirements.flatMap((entry) => entry.auditorRoleIds))];
        assertAuthorized(policy, actor, "challenge", eligible);
        if (head.state !== "candidate") fail("artifact_audit_transition_denied");
        if (policy.auditRequirements.some((entry) => entry.separationRequired) && head.producer_actor_id === actor.actorId) {
          fail("artifact_audit_self_audit_denied");
        }
        return { stateTo: "under_audit" };
      },
    });
  }

  recordAuditVerdict(input = {}) {
    return this._transition(input, {
      operation: "record_audit_verdict",
      eventType: "audit_verdict_recorded",
      prepare: ({ input: value, policy, head, actor, scope }) => {
        if (head.state !== "under_audit") fail("artifact_audit_transition_denied");
        const requirement = policy.auditRequirements.find((entry) => entry.requirementId === value.requirementId);
        if (!requirement) fail("artifact_audit_requirement_unknown");
        assertAuthorized(policy, actor, "challenge", requirement.auditorRoleIds);
        if (requirement.separationRequired && head.producer_actor_id === actor.actorId) fail("artifact_audit_self_audit_denied");
        if (!AUDIT_VERDICTS.includes(value.verdict)) fail("artifact_audit_verdict_invalid");
        const evidenceRefs = normalizeEvidenceRefs(value.evidenceRefs,
          { ...scope, revision: head.artifact_revision }, requirement.evidenceKinds);
        const existingRequirement = this.db.prepare(`select 1 from direct_artifact_audits
          where project_id = ? and work_thread_id = ? and artifact_id = ?
            and artifact_revision = ? and requirement_id = ?`).get(
              scope.projectId, scope.workThreadId, scope.artifactId, head.artifact_revision, value.requirementId,
            );
        const existingActor = this.db.prepare(`select 1 from direct_artifact_audits
          where project_id = ? and work_thread_id = ? and artifact_id = ?
            and artifact_revision = ? and auditor_actor_id = ?`).get(
              scope.projectId, scope.workThreadId, scope.artifactId, head.artifact_revision, actor.actorId,
            );
        if (existingRequirement || existingActor) fail("artifact_audit_duplicate_audit_identity");
        const prior = this.db.prepare(`select requirement_id, verdict from direct_artifact_audits
          where project_id = ? and work_thread_id = ? and artifact_id = ? and artifact_revision = ?`).all(
            scope.projectId, scope.workThreadId, scope.artifactId, head.artifact_revision,
          );
        const all = [...prior, { requirement_id: value.requirementId, verdict: value.verdict }];
        const complete = policy.auditRequirements.every((entry) => all.some((audit) => audit.requirement_id === entry.requirementId));
        let stateTo = "under_audit";
        if (complete) {
          stateTo = all.some((audit) => audit.verdict === "contradicted")
            ? "contradicted"
            : all.some((audit) => audit.verdict === "requires_revision")
              ? "requires_revision"
              : "supported";
        }
        return {
          stateTo,
          evidenceRefs,
          audit: { requirementId: value.requirementId, verdict: value.verdict },
          beforeHeadCas: (event) => {
            this.db.prepare(`insert into direct_artifact_audits(
              project_id, work_thread_id, artifact_id, artifact_revision, requirement_id,
              auditor_actor_id, auditor_role_id, verdict, event_id, evidence_json
            ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
              scope.projectId, scope.workThreadId, scope.artifactId, head.artifact_revision,
              value.requirementId, actor.actorId, actor.roleId, value.verdict, event.eventId,
              canonicalJson(evidenceRefs),
            );
          },
        };
      },
    });
  }

  decideArtifact(input = {}) {
    return this._transition(input, {
      operation: "decide_artifact",
      eventType: input.decision === "admitted" ? "artifact_admitted"
        : input.decision === "rejected" ? "artifact_rejected" : "artifact_remanded",
      prepare: ({ input: value, policy, head, actor }) => {
        assertAuthorized(policy, actor, "admit", [policy.admissionRoleId]);
        if (!["admitted", "rejected", "remanded"].includes(value.decision)) fail("artifact_audit_decision_invalid");
        if (value.decision === "admitted" && head.state !== "supported") fail("artifact_audit_admission_incomplete");
        if (value.decision === "remanded" && !["requires_revision", "contradicted"].includes(head.state)) {
          fail("artifact_audit_remand_invalid");
        }
        if (value.decision === "rejected" && !["supported", "requires_revision", "contradicted"].includes(head.state)) {
          fail("artifact_audit_rejection_invalid");
        }
        return { stateTo: value.decision, decision: { disposition: value.decision } };
      },
    });
  }

  subscribe(input = {}) {
    assertNoRawExposure(input, "subscription");
    const projectId = key(input.projectId, "projectId");
    const artifactClassId = key(input.artifactClassId, "artifactClassId");
    const actor = normalizeActor(input.actor);
    const policy = this._policyFor({ projectId, artifactClassId }, input.policyDigest);
    assertAuthorized(policy, actor, "subscribe");
    assertAuthorized(policy, actor, "read");
    const eventTypes = Array.isArray(input.eventTypes) ? [...new Set(input.eventTypes)].sort() : [];
    if (!eventTypes.length || eventTypes.some((value) => !EVENT_TYPES.includes(value))) fail("artifact_audit_subscription_event_invalid");
    const subscription = {
      subscriptionId: key(input.subscriptionId, "subscriptionId"),
      projectId,
      workThreadId: input.workThreadId ? key(input.workThreadId, "workThreadId") : "",
      artifactId: input.artifactId ? key(input.artifactId, "artifactId") : "",
      artifactClassId,
      policyDigest: policy.policyDigest,
      actor,
      eventTypes,
      createdAt: nowIso(this.now),
    };
    subscription.subscriptionDigest = digestFor("direct_artifact_audit_subscription@1", {
      subscriptionId: subscription.subscriptionId,
      projectId: subscription.projectId,
      workThreadId: subscription.workThreadId,
      artifactId: subscription.artifactId,
      artifactClassId: subscription.artifactClassId,
      policyDigest: subscription.policyDigest,
      actor: subscription.actor,
      eventTypes: subscription.eventTypes,
    });
    return this.transaction(() => {
      const row = this.db.prepare(`select * from direct_artifact_audit_subscriptions where subscription_id = ?`).get(subscription.subscriptionId);
      if (row) {
        if (row.subscription_digest !== subscription.subscriptionDigest) fail("artifact_audit_subscription_conflict");
        return this._subscriptionFromRow(row);
      }
      this.db.prepare(`insert into direct_artifact_audit_subscriptions(
        subscription_id, project_id, work_thread_id, artifact_id, artifact_class_id,
        policy_digest, subscriber_actor_id, subscriber_role_id, event_types_json,
        subscription_digest, created_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        subscription.subscriptionId, projectId, subscription.workThreadId, subscription.artifactId,
        artifactClassId, policy.policyDigest, actor.actorId, actor.roleId,
        canonicalJson(eventTypes), subscription.subscriptionDigest, subscription.createdAt,
      );
      return subscription;
    });
  }

  _subscriptionFromRow(row) {
    return {
      subscriptionId: row.subscription_id,
      projectId: row.project_id,
      workThreadId: row.work_thread_id,
      artifactId: row.artifact_id,
      artifactClassId: row.artifact_class_id,
      policyDigest: row.policy_digest,
      actor: { actorId: row.subscriber_actor_id, roleId: row.subscriber_role_id },
      eventTypes: parseJson(row.event_types_json, "subscription-events"),
      subscriptionDigest: row.subscription_digest,
      createdAt: row.created_at,
    };
  }

  pollSubscription(input = {}) {
    assertNoRawExposure(input, "poll");
    const id = key(input.subscriptionId, "subscriptionId");
    const actor = normalizeActor(input.actor);
    const row = this.db.prepare(`select * from direct_artifact_audit_subscriptions where subscription_id = ?`).get(id);
    if (!row) fail("artifact_audit_subscription_missing");
    const subscription = this._subscriptionFromRow(row);
    if (canonicalJson(actor) !== canonicalJson(subscription.actor)) fail("artifact_audit_subscription_actor_mismatch");
    const policy = this._policyFor(subscription, subscription.policyDigest);
    assertAuthorized(policy, actor, "subscribe");
    assertAuthorized(policy, actor, "read");
    const afterSequence = Number(input.afterSequence || 0);
    const limit = Number(input.limit || 100);
    if (!Number.isSafeInteger(afterSequence) || afterSequence < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
      fail("artifact_audit_projection_bounds_invalid");
    }
    const eventPlaceholders = subscription.eventTypes.map(() => "?").join(", ");
    const scopeClauses = ["sequence > ?", "project_id = ?", "artifact_class_id = ?", `event_type in (${eventPlaceholders})`];
    const parameters = [afterSequence, subscription.projectId, subscription.artifactClassId, ...subscription.eventTypes];
    if (subscription.workThreadId) {
      scopeClauses.push("work_thread_id = ?");
      parameters.push(subscription.workThreadId);
    }
    if (subscription.artifactId) {
      scopeClauses.push("artifact_id = ?");
      parameters.push(subscription.artifactId);
    }
    parameters.push(limit + 1);
    const events = this.db.prepare(`select event_json from direct_artifact_audit_events
      where ${scopeClauses.join(" and ")} order by sequence limit ?`).all(...parameters)
      .map((entry) => parseJson(entry.event_json, "event-projection"));
    return safeTransitionProjection({ ...subscription, afterSequence, limit }, events);
  }

  inspectHead(input = {}) {
    assertNoRawExposure(input, "inspect");
    const scope = normalizeScope(input.scope);
    const policy = this._policyFor(scope, input.policyDigest);
    assertAuthorized(policy, input.actor, "read");
    const head = this._head(scope);
    if (!head) return null;
    return {
      scope: { ...scope, revision: head.artifact_revision },
      policyRef: { id: policy.artifactClassId, digest: policy.policyDigest },
      state: head.state,
      headVersion: head.head_version,
      headEventId: head.head_event_id,
    };
  }
}

module.exports = {
  DirectArtifactAuditStore,
  EVENT_TYPES,
  STORE_SCHEMA,
};
