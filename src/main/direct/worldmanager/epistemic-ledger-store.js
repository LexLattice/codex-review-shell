"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const {
  LEDGER_GENESIS_DIGEST,
  buildEpistemicLedgerEvent,
  buildLedgerActTypeConstitution,
  buildLedgerDeliveryOutboxSeed,
  buildLedgerWriteReceipt,
  buildMaterializedEpistemicProjection,
  epistemicLedgerEventRef,
  exactRef,
  exactRefKey,
  ledgerActTypeConstitutionRef,
  ledgerAppendIntentDigest,
  normalizeLedgerAppendIntent,
  normalizeOutboxSeedIntents,
  projectionKeysForEvent,
  replayLedgerWriteReceipt,
  validateEpistemicLedgerEvent,
  validateLedgerActTypeConstitution,
  validateLedgerDeliveryOutboxSeed,
  validateLedgerWriteReceipt,
  validateMaterializedEpistemicProjection,
  worldManagerEventLedgerIntent,
} = require("./epistemic-ledger-kernel");
const { digestFor } = require("./control-plane");

const EPISTEMIC_LEDGER_STORE_SCHEMA =
  "direct_epistemic_ledger_store@1";
const EPISTEMIC_LEDGER_STORE_FILE_NAME =
  "world-manager-epistemic-ledger.sqlite";

function fail(code, detail = "") {
  const error = new Error(detail ? `${code}:${detail}` : code);
  error.code = code;
  if (detail) error.detail = detail;
  throw error;
}

function text(value, fallback = "") {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : fallback;
}

function json(value) {
  return JSON.stringify(value ?? null);
}

function parseJson(value, label) {
  try {
    return JSON.parse(String(value));
  } catch {
    fail("epistemic_ledger_persisted_json_invalid", label);
  }
}

function jsonEqual(left, right) {
  return json(left) === json(right);
}

function exactEventRefMatches(ref, event) {
  return Boolean(
    ref &&
      event &&
      ref.kind === "epistemic_ledger_event" &&
      ref.id === event.ledgerEventId &&
      ref.digest === event.eventDigest,
  );
}

class DirectEpistemicLedgerStore {
  constructor(options = {}) {
    const rootDir = text(options.rootDir, "");
    const dbPath = text(
      options.dbPath,
      rootDir
        ? path.join(rootDir, EPISTEMIC_LEDGER_STORE_FILE_NAME)
        : "",
    );
    if (!options.db && !dbPath) {
      fail("epistemic_ledger_store_path_required");
    }
    if (!options.db) {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    }
    this.rootDir = rootDir || (dbPath ? path.dirname(dbPath) : "");
    this.dbPath = dbPath;
    this.now = typeof options.now === "function" ? options.now : Date.now;
    this.ownsDatabase = !options.db;
    this.db = options.db || new DatabaseSync(dbPath);
    this.transactionDepth = 0;
    this.readOnlyDiagnosis = null;
    this.ensurePragmas();
    this.ensureSchema();
    this.verifyRestartState({
      repairProjections: options.autoRebuildProjections !== false,
    });
  }

  ensureOpen() {
    if (!this.db) fail("epistemic_ledger_store_closed");
  }

  ensurePragmas() {
    this.ensureOpen();
    this.db.exec("pragma journal_mode = WAL");
    this.db.exec("pragma foreign_keys = ON");
    this.db.exec("pragma busy_timeout = 5000");
  }

  close() {
    if (!this.db) return;
    if (this.ownsDatabase) this.db.close();
    this.db = null;
  }

  ensureSchema() {
    this.ensureOpen();
    this.db.exec(`
      create table if not exists wm_epistemic_meta (
        key text primary key,
        value text not null
      );

      create table if not exists wm_ledger_act_type_constitutions (
        act_type_ref_id text primary key,
        act_type_id text not null,
        revision integer not null,
        operation_name text not null,
        act_class text not null,
        constitution_digest text not null unique,
        constitution_json text not null,
        created_at text not null,
        unique (act_type_id, revision)
      );

      create table if not exists wm_epistemic_events (
        global_sequence integer primary key,
        ledger_event_id text not null unique,
        act_type_ref_id text not null,
        act_class text not null,
        authorship_kind text not null,
        actor_identity text not null,
        role_lane_identity text not null,
        epistemic_posture text not null,
        authority_posture text not null,
        idempotency_key text not null,
        previous_ledger_digest text not null,
        event_digest text not null unique,
        event_json text not null,
        created_at text not null,
        foreign key (act_type_ref_id)
          references wm_ledger_act_type_constitutions(act_type_ref_id)
      );

      create table if not exists wm_epistemic_event_stream_memberships (
        global_sequence integer not null,
        stream_position integer not null,
        stream_key text not null,
        stream_type text not null,
        stream_id text not null,
        stream_ref_json text not null,
        primary key (global_sequence, stream_key),
        unique (global_sequence, stream_position),
        foreign key (global_sequence)
          references wm_epistemic_events(global_sequence)
          on delete restrict
      );

      create index if not exists wm_epistemic_stream_sequence_idx
        on wm_epistemic_event_stream_memberships(
          stream_key,
          global_sequence
        );

      create table if not exists wm_epistemic_projection_heads (
        projection_key text primary key,
        head_sequence integer not null,
        head_event_id text not null,
        head_event_digest text not null,
        epistemic_posture text not null,
        authority_posture text not null,
        projection_digest text not null,
        projection_json text not null,
        updated_at text not null,
        foreign key (head_sequence)
          references wm_epistemic_events(global_sequence)
          on delete restrict
      );

      create table if not exists wm_ledger_write_receipts (
        receipt_id text primary key,
        ledger_event_id text not null unique,
        actor_identity text not null,
        operation_scope text not null,
        idempotency_key text not null,
        append_request_digest text not null,
        receipt_digest text not null unique,
        receipt_json text not null,
        created_at text not null,
        unique (actor_identity, operation_scope, idempotency_key),
        foreign key (ledger_event_id)
          references wm_epistemic_events(ledger_event_id)
          on delete restrict
      );

      create table if not exists wm_ledger_delivery_outbox (
        outbox_seed_id text primary key,
        ledger_event_id text not null,
        subscription_identity text not null,
        recipient_identity text not null,
        delivery_policy text not null,
        dispatch_state text not null,
        seed_digest text not null unique,
        seed_json text not null,
        attempt_count integer not null default 0,
        delivery_ref_json text not null default '',
        delivery_ref_digest text not null default '',
        last_failure_json text not null default '',
        created_at text not null,
        updated_at text not null,
        unique (
          ledger_event_id,
          subscription_identity,
          recipient_identity
        ),
        foreign key (ledger_event_id)
          references wm_epistemic_events(ledger_event_id)
          on delete restrict
      );

      create index if not exists wm_ledger_outbox_pending_idx
        on wm_ledger_delivery_outbox(dispatch_state, created_at);
    `);
    this.ensureColumn(
      "wm_ledger_delivery_outbox",
      "delivery_ref_json",
      "text not null default ''",
    );
    this.ensureColumn(
      "wm_ledger_delivery_outbox",
      "delivery_ref_digest",
      "text not null default ''",
    );
    this.ensureColumn(
      "wm_ledger_delivery_outbox",
      "last_failure_json",
      "text not null default ''",
    );
    this.db.prepare(`
      insert into wm_epistemic_meta (key, value)
      values ('store_schema', ?)
      on conflict(key) do nothing
    `).run(EPISTEMIC_LEDGER_STORE_SCHEMA);
    this.db.prepare(`
      insert into wm_epistemic_meta (key, value)
      values ('genesis_digest', ?)
      on conflict(key) do nothing
    `).run(LEDGER_GENESIS_DIGEST);
    if (
      this.meta("store_schema") !== EPISTEMIC_LEDGER_STORE_SCHEMA ||
      this.meta("genesis_digest") !== LEDGER_GENESIS_DIGEST
    ) {
      fail("epistemic_ledger_store_identity_conflict");
    }
  }

  ensureColumn(tableName, columnName, declaration) {
    const safeTable = text(tableName, "");
    const safeColumn = text(columnName, "");
    if (
      !/^[a-z0-9_]+$/i.test(safeTable) ||
      !/^[a-z0-9_]+$/i.test(safeColumn)
    ) {
      fail("epistemic_ledger_schema_identifier_invalid");
    }
    const columns = this.db.prepare(`pragma table_info(${safeTable})`).all();
    if (columns.some((entry) => entry.name === safeColumn)) return;
    this.db.exec(`alter table ${safeTable} add column ${safeColumn} ${declaration}`);
  }

  meta(key, fallback = "") {
    this.ensureOpen();
    const row = this.db.prepare(`
      select value from wm_epistemic_meta where key = ?
    `).get(key);
    return row ? String(row.value) : fallback;
  }

  transaction(action) {
    this.ensureOpen();
    const databaseAlreadyInTransaction = this.db.isTransaction === true;
    if (this.transactionDepth > 0 || databaseAlreadyInTransaction) {
      return action();
    }
    this.db.exec("begin immediate");
    this.transactionDepth += 1;
    try {
      const result = action();
      this.db.exec("commit");
      return result;
    } catch (error) {
      try {
        this.db.exec("rollback");
      } catch {}
      throw error;
    } finally {
      this.transactionDepth -= 1;
    }
  }

  assertWritable() {
    if (this.readOnlyDiagnosis) {
      fail(
        "epistemic_ledger_integrity_failed",
        this.readOnlyDiagnosis.issue || "diagnostic_read_only",
      );
    }
  }

  registerActTypeConstitution(input = {}) {
    this.assertWritable();
    const constitution = input.schema
      ? input
      : buildLedgerActTypeConstitution(input, { now: this.now });
    validateLedgerActTypeConstitution(constitution);
    const ref = ledgerActTypeConstitutionRef(constitution);
    return this.transaction(() => {
      const existing = this.db.prepare(`
        select constitution_json
        from wm_ledger_act_type_constitutions
        where act_type_ref_id = ?
      `).get(ref.id);
      if (existing) {
        const persisted = parseJson(
          existing.constitution_json,
          `act-type:${ref.id}`,
        );
        validateLedgerActTypeConstitution(persisted);
        if (persisted.digest !== constitution.digest) {
          fail("ledger_act_type_revision_conflict", ref.id);
        }
        return { constitution: persisted, ref, changed: false };
      }
      this.db.prepare(`
        insert into wm_ledger_act_type_constitutions (
          act_type_ref_id,
          act_type_id,
          revision,
          operation_name,
          act_class,
          constitution_digest,
          constitution_json,
          created_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        ref.id,
        constitution.actTypeId,
        constitution.revision,
        constitution.operationName,
        constitution.actClass,
        constitution.digest,
        json(constitution),
        constitution.createdAt,
      );
      return { constitution, ref, changed: true };
    });
  }

  getActTypeConstitution(refOrId) {
    this.ensureOpen();
    const refId = typeof refOrId === "string"
      ? text(refOrId, "")
      : text(refOrId?.id, "");
    if (!refId) return null;
    const row = this.db.prepare(`
      select constitution_json
      from wm_ledger_act_type_constitutions
      where act_type_ref_id = ?
    `).get(refId);
    if (!row) return null;
    const constitution = parseJson(
      row.constitution_json,
      `act-type:${refId}`,
    );
    validateLedgerActTypeConstitution(constitution);
    if (
      typeof refOrId === "object" &&
      text(refOrId.digest, "") &&
      constitution.digest !== refOrId.digest
    ) {
      fail("ledger_act_type_ref_stale", refId);
    }
    return constitution;
  }

  listActTypeConstitutions() {
    this.ensureOpen();
    return this.db.prepare(`
      select constitution_json
      from wm_ledger_act_type_constitutions
      order by act_type_id, revision
    `).all().map((row) => {
      const value = parseJson(row.constitution_json, "act-type-list");
      validateLedgerActTypeConstitution(value);
      return value;
    });
  }

  prepareAppendInput(input = {}) {
    const actTypeRef = input.actTypeRef;
    const constitution = this.getActTypeConstitution(actTypeRef);
    if (!constitution) {
      fail("ledger_act_type_constitution_unknown", text(actTypeRef?.id, ""));
    }
    const prepared = {
      ...input,
      actClass: text(input.actClass, constitution.actClass),
      epistemicPosture: text(
        input.epistemicPosture,
        constitution.defaultEpistemicPosture,
      ),
      authorityPosture: text(
        input.authorityPosture,
        constitution.defaultAuthorityPosture,
      ),
      typedPayloadSchema: text(
        input.typedPayloadSchema,
        constitution.typedPayloadSchema,
      ),
    };
    const intent = normalizeLedgerAppendIntent(prepared);
    if (
      intent.actClass !== constitution.actClass ||
      !constitution.authorshipKinds.includes(intent.authorshipKind) ||
      (constitution.typedPayloadSchema &&
        intent.typedPayloadSchema !== constitution.typedPayloadSchema) ||
      (constitution.allowedRoleLanes.length > 0 &&
        !constitution.allowedRoleLanes.includes(intent.roleLaneRef.id)) ||
      (intent.authorityPosture === "canonical_admission_receipt" &&
        !constitution.canonicalAdmissionCapable)
    ) {
      fail("epistemic_ledger_act_constitution_mismatch", constitution.actTypeId);
    }
    return { intent, constitution };
  }

  appendEvent(input = {}, options = {}) {
    this.assertWritable();
    const { intent } = this.prepareAppendInput(input);
    const outboxSeedIntents = normalizeOutboxSeedIntents(
      options.outboxSeeds || input.outboxSeeds || [],
    );
    // Semantic idempotency belongs to the actor/operation/intent, not to the
    // mutable set of subscribers that happened to match when the event was
    // first appended. Outbox rows are still created atomically for a new
    // event, but later standing/watch changes cannot turn an exact replay into
    // an idempotency conflict.
    const appendRequestDigest = ledgerAppendIntentDigest(intent);
    const actorIdentity = exactRefKey(intent.actorRef, {
      includeDigest: false,
    });
    const operationScope = intent.operationScope;

    return this.transaction(() => {
      const prior = this.db.prepare(`
        select
          ledger_event_id,
          append_request_digest,
          receipt_json
        from wm_ledger_write_receipts
        where actor_identity = ?
          and operation_scope = ?
          and idempotency_key = ?
      `).get(
        actorIdentity,
        operationScope,
        intent.idempotencyKey,
      );
      if (prior) {
        const event = this.getEvent(prior.ledger_event_id);
        const persistedReceipt = parseJson(
          prior.receipt_json,
          `receipt:${prior.ledger_event_id}`,
        );
        validateLedgerWriteReceipt(persistedReceipt);
        // Compare the current semantic intent with the immutable event rather
        // than trusting the stored append digest. Older databases may contain
        // the legacy digest that also covered outbox seed topology; the event
        // and receipt together supply a topology-independent compatibility
        // witness. The receipt owns the intent fields that are not duplicated
        // on the immutable event.
        const persistedSemanticDigest = ledgerAppendIntentDigest({
          ...event,
          operationScope: persistedReceipt.operationScope,
          affectedContextRefs: persistedReceipt.affectedContextRefs,
          lifecycleTransitionRefs:
            persistedReceipt.lifecycleTransitionRefs,
        });
        if (persistedSemanticDigest !== appendRequestDigest) {
          fail(
            "epistemic_ledger_idempotency_conflict",
            `${actorIdentity}:${operationScope}:${intent.idempotencyKey}`,
          );
        }
        return {
          event,
          receipt: replayLedgerWriteReceipt(persistedReceipt),
          persistedReceipt,
          outboxSeeds: this.listOutboxSeeds({
            ledgerEventId: event.ledgerEventId,
          }),
        };
      }

      const head = this.db.prepare(`
        select global_sequence, event_digest
        from wm_epistemic_events
        order by global_sequence desc
        limit 1
      `).get();
      const globalSequence = head
        ? Number(head.global_sequence) + 1
        : 1;
      const previousLedgerDigest = head
        ? String(head.event_digest)
        : LEDGER_GENESIS_DIGEST;
      const createdAt = new Date(Number(this.now())).toISOString();
      const event = buildEpistemicLedgerEvent(intent, {
        globalSequence,
        previousLedgerDigest,
        createdAt,
      });
      this.db.prepare(`
        insert into wm_epistemic_events (
          global_sequence,
          ledger_event_id,
          act_type_ref_id,
          act_class,
          authorship_kind,
          actor_identity,
          role_lane_identity,
          epistemic_posture,
          authority_posture,
          idempotency_key,
          previous_ledger_digest,
          event_digest,
          event_json,
          created_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        event.globalSequence,
        event.ledgerEventId,
        event.actTypeRef.id,
        event.actClass,
        event.authorshipKind,
        actorIdentity,
        exactRefKey(event.roleLaneRef, { includeDigest: false }),
        event.epistemicPosture,
        event.authorityPosture,
        event.idempotencyKey,
        event.previousLedgerDigest,
        event.eventDigest,
        json(event),
        event.createdAt,
      );

      const insertMembership = this.db.prepare(`
        insert into wm_epistemic_event_stream_memberships (
          global_sequence,
          stream_position,
          stream_key,
          stream_type,
          stream_id,
          stream_ref_json
        ) values (?, ?, ?, ?, ?, ?)
      `);
      event.streamRefs.forEach((streamRef, index) => {
        insertMembership.run(
          event.globalSequence,
          index,
          streamRef.streamKey,
          streamRef.streamType,
          streamRef.streamId,
          json(streamRef),
        );
      });

      this.applyProjectionHeadsForEvent(event);

      const outboxSeeds = outboxSeedIntents.map((seedInput) =>
        buildLedgerDeliveryOutboxSeed(seedInput, event, {
          now: () => Number(this.now()),
        }));
      const insertOutbox = this.db.prepare(`
        insert into wm_ledger_delivery_outbox (
          outbox_seed_id,
          ledger_event_id,
          subscription_identity,
          recipient_identity,
          delivery_policy,
          dispatch_state,
          seed_digest,
          seed_json,
          attempt_count,
          created_at,
          updated_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
      `);
      outboxSeeds.forEach((seed) => {
        insertOutbox.run(
          seed.outboxSeedId,
          event.ledgerEventId,
          exactRefKey(seed.subscriptionRef, { includeDigest: false }),
          exactRefKey(seed.recipientRef, { includeDigest: false }),
          seed.deliveryPolicy,
          seed.dispatchState,
          seed.seedDigest,
          json(seed),
          seed.createdAt,
          seed.createdAt,
        );
      });

      const receipt = buildLedgerWriteReceipt({
        event,
        actorIdentity,
        operationScope,
        appendRequestDigest,
        appendState: "appended",
        affectedContextRefs: intent.affectedContextRefs,
        lifecycleTransitionRefs: intent.lifecycleTransitionRefs,
        deliveryDispatchState:
          outboxSeeds.length > 0 ? "outbox_committed" : "none",
        rendererSafeSummary: event.rendererSafeSummary,
        createdAt: event.createdAt,
      });
      this.db.prepare(`
        insert into wm_ledger_write_receipts (
          receipt_id,
          ledger_event_id,
          actor_identity,
          operation_scope,
          idempotency_key,
          append_request_digest,
          receipt_digest,
          receipt_json,
          created_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        receipt.receiptId,
        event.ledgerEventId,
        actorIdentity,
        operationScope,
        event.idempotencyKey,
        appendRequestDigest,
        receipt.receiptDigest,
        json(receipt),
        receipt.createdAt,
      );
      return { event, receipt, persistedReceipt: receipt, outboxSeeds };
    });
  }

  append(input = {}, options = {}) {
    return this.appendEvent(input, options);
  }

  appendWorldManagerEvent(sourceEvent, options = {}) {
    const intent = worldManagerEventLedgerIntent(sourceEvent, options);
    return this.appendEvent(intent, {
      outboxSeeds: options.outboxSeeds || [],
    });
  }

  applyProjectionHeadsForEvent(event) {
    validateEpistemicLedgerEvent(event);
    const upsert = this.db.prepare(`
      insert into wm_epistemic_projection_heads (
        projection_key,
        head_sequence,
        head_event_id,
        head_event_digest,
        epistemic_posture,
        authority_posture,
        projection_digest,
        projection_json,
        updated_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?)
      on conflict(projection_key) do update set
        head_sequence = excluded.head_sequence,
        head_event_id = excluded.head_event_id,
        head_event_digest = excluded.head_event_digest,
        epistemic_posture = excluded.epistemic_posture,
        authority_posture = excluded.authority_posture,
        projection_digest = excluded.projection_digest,
        projection_json = excluded.projection_json,
        updated_at = excluded.updated_at
      where excluded.head_sequence > wm_epistemic_projection_heads.head_sequence
    `);
    projectionKeysForEvent(event).forEach((projectionKey) => {
      const projection = buildMaterializedEpistemicProjection(
        event,
        projectionKey,
      );
      upsert.run(
        projection.projectionKey,
        projection.headSequence,
        projection.headEventRef.id,
        projection.headEventRef.digest,
        projection.epistemicPosture,
        projection.authorityPosture,
        projection.projectionDigest,
        json(projection),
        projection.updatedAt,
      );
    });
  }

  getEvent(ledgerEventId) {
    this.ensureOpen();
    const row = this.db.prepare(`
      select * from wm_epistemic_events where ledger_event_id = ?
    `).get(text(ledgerEventId, ""));
    return row ? this.eventFromRow(row) : null;
  }

  getEventBySequence(globalSequence) {
    this.ensureOpen();
    const row = this.db.prepare(`
      select * from wm_epistemic_events where global_sequence = ?
    `).get(Number(globalSequence));
    return row ? this.eventFromRow(row) : null;
  }

  eventFromRow(row) {
    const event = parseJson(
      row.event_json,
      `event:${row.ledger_event_id}`,
    );
    validateEpistemicLedgerEvent(event);
    if (
      Number(row.global_sequence) !== event.globalSequence ||
      row.ledger_event_id !== event.ledgerEventId ||
      row.act_type_ref_id !== event.actTypeRef.id ||
      row.act_class !== event.actClass ||
      row.authorship_kind !== event.authorshipKind ||
      row.epistemic_posture !== event.epistemicPosture ||
      row.authority_posture !== event.authorityPosture ||
      row.idempotency_key !== event.idempotencyKey ||
      row.previous_ledger_digest !== event.previousLedgerDigest ||
      row.event_digest !== event.eventDigest ||
      row.created_at !== event.createdAt
    ) {
      fail("epistemic_ledger_event_row_mismatch", event.ledgerEventId);
    }
    return event;
  }

  listEvents(options = {}) {
    this.ensureOpen();
    const afterSequence = Math.max(0, Number(options.afterSequence) || 0);
    const limit = Math.max(1, Math.min(10000, Number(options.limit) || 1000));
    return this.db.prepare(`
      select *
      from wm_epistemic_events
      where global_sequence > ?
      order by global_sequence asc
      limit ?
    `).all(afterSequence, limit).map((row) => this.eventFromRow(row));
  }

  listStreamEvents(streamKey, options = {}) {
    this.ensureOpen();
    const key = text(streamKey?.streamKey || streamKey, "");
    const afterSequence = Math.max(0, Number(options.afterSequence) || 0);
    const limit = Math.max(1, Math.min(10000, Number(options.limit) || 1000));
    return this.db.prepare(`
      select e.*
      from wm_epistemic_events e
      join wm_epistemic_event_stream_memberships m
        on m.global_sequence = e.global_sequence
      where m.stream_key = ?
        and e.global_sequence > ?
      order by e.global_sequence asc
      limit ?
    `).all(key, afterSequence, limit).map((row) => this.eventFromRow(row));
  }

  getWriteReceipt(ledgerEventId) {
    this.ensureOpen();
    const row = this.db.prepare(`
      select receipt_json
      from wm_ledger_write_receipts
      where ledger_event_id = ?
    `).get(text(ledgerEventId, ""));
    if (!row) return null;
    const receipt = parseJson(row.receipt_json, `receipt:${ledgerEventId}`);
    validateLedgerWriteReceipt(receipt);
    return receipt;
  }

  getProjectionHead(projectionKey) {
    this.ensureOpen();
    const row = this.db.prepare(`
      select projection_json
      from wm_epistemic_projection_heads
      where projection_key = ?
    `).get(text(projectionKey, ""));
    if (!row) return null;
    const projection = parseJson(
      row.projection_json,
      `projection:${projectionKey}`,
    );
    validateMaterializedEpistemicProjection(projection);
    return projection;
  }

  listProjectionHeads() {
    this.ensureOpen();
    return this.db.prepare(`
      select projection_json
      from wm_epistemic_projection_heads
      order by projection_key asc
    `).all().map((row) => {
      const projection = parseJson(row.projection_json, "projection-list");
      validateMaterializedEpistemicProjection(projection);
      return projection;
    });
  }

  listOutboxSeeds(options = {}) {
    this.ensureOpen();
    const clauses = [];
    const values = [];
    if (text(options.ledgerEventId, "")) {
      clauses.push("ledger_event_id = ?");
      values.push(text(options.ledgerEventId, ""));
    }
    if (text(options.dispatchState, "")) {
      clauses.push("dispatch_state = ?");
      values.push(text(options.dispatchState, ""));
    }
    const where = clauses.length > 0
      ? `where ${clauses.join(" and ")}`
      : "";
    const rows = this.db.prepare(`
      select seed_json
      from wm_ledger_delivery_outbox
      ${where}
      order by created_at asc, outbox_seed_id asc
    `).all(...values);
    return rows.map((row) => {
      const seed = parseJson(row.seed_json, "outbox-seed-list");
      validateLedgerDeliveryOutboxSeed(seed);
      return seed;
    });
  }

  listPendingOutboxSeeds() {
    return this.listOutboxEntries({ pendingOnly: true })
      .map((entry) => entry.seed);
  }

  listOutboxEntries(options = {}) {
    this.ensureOpen();
    const clauses = [];
    const values = [];
    if (text(options.ledgerEventId, "")) {
      clauses.push("ledger_event_id = ?");
      values.push(text(options.ledgerEventId, ""));
    }
    if (options.pendingOnly === true) {
      clauses.push("dispatch_state in ('pending', 'retry_pending')");
    } else if (text(options.dispatchState, "")) {
      clauses.push("dispatch_state = ?");
      values.push(text(options.dispatchState, ""));
    }
    const where = clauses.length > 0
      ? `where ${clauses.join(" and ")}`
      : "";
    return this.db.prepare(`
      select *
      from wm_ledger_delivery_outbox
      ${where}
      order by created_at asc, outbox_seed_id asc
    `).all(...values).map((row) => {
      const seed = parseJson(
        row.seed_json,
        `outbox-seed:${row.outbox_seed_id}`,
      );
      validateLedgerDeliveryOutboxSeed(seed);
      const deliveryRef = text(row.delivery_ref_json, "")
        ? exactRef(
            parseJson(
              row.delivery_ref_json,
              `outbox-delivery-ref:${row.outbox_seed_id}`,
            ),
            "deliveryRef",
          )
        : null;
      const lastFailure = text(row.last_failure_json, "")
        ? parseJson(
            row.last_failure_json,
            `outbox-failure:${row.outbox_seed_id}`,
          )
        : null;
      return {
        seed,
        dispatchState: String(row.dispatch_state),
        attemptCount: Number(row.attempt_count),
        deliveryRef,
        lastFailure,
        updatedAt: String(row.updated_at),
      };
    });
  }

  listPendingOutboxEntries() {
    return this.listOutboxEntries({ pendingOnly: true });
  }

  markOutboxDispatched(outboxSeedId, deliveryRefInput) {
    this.assertWritable();
    const seedId = text(outboxSeedId, "");
    const deliveryRef = exactRef(deliveryRefInput, "deliveryRef");
    return this.transaction(() => {
      const row = this.db.prepare(`
        select *
        from wm_ledger_delivery_outbox
        where outbox_seed_id = ?
      `).get(seedId);
      if (!row) fail("ledger_outbox_seed_unknown", seedId);
      if (row.dispatch_state === "dispatched") {
        const persistedRef = exactRef(
          parseJson(
            row.delivery_ref_json,
            `outbox-delivery-ref:${seedId}`,
          ),
          "deliveryRef",
        );
        if (exactRefKey(persistedRef) !== exactRefKey(deliveryRef)) {
          fail("ledger_outbox_dispatch_conflict", seedId);
        }
        return {
          outboxSeedId: seedId,
          dispatchState: "dispatched",
          deliveryRef: persistedRef,
          changed: false,
        };
      }
      if (!["pending", "retry_pending"].includes(row.dispatch_state)) {
        fail("ledger_outbox_transition_invalid", row.dispatch_state);
      }
      const updatedAt = new Date(Number(this.now())).toISOString();
      const deliveryRefDigest = digestFor(
        "direct_ledger_outbox_delivery_ref@1",
        deliveryRef,
      );
      this.db.prepare(`
        update wm_ledger_delivery_outbox
        set dispatch_state = 'dispatched',
            delivery_ref_json = ?,
            delivery_ref_digest = ?,
            last_failure_json = '',
            updated_at = ?
        where outbox_seed_id = ?
      `).run(
        json(deliveryRef),
        deliveryRefDigest,
        updatedAt,
        seedId,
      );
      return {
        outboxSeedId: seedId,
        dispatchState: "dispatched",
        deliveryRef,
        changed: true,
      };
    });
  }

  markOutboxDispatchFailed(outboxSeedId, input = {}) {
    this.assertWritable();
    const seedId = text(outboxSeedId, "");
    const failureCode = text(input.failureCode || input.code, "");
    if (!failureCode) fail("ledger_outbox_failure_code_required");
    const retryable = input.retryable !== false;
    return this.transaction(() => {
      const row = this.db.prepare(`
        select *
        from wm_ledger_delivery_outbox
        where outbox_seed_id = ?
      `).get(seedId);
      if (!row) fail("ledger_outbox_seed_unknown", seedId);
      if (row.dispatch_state === "dispatched") {
        fail("ledger_outbox_transition_invalid", "dispatched");
      }
      if (row.dispatch_state === "failed_terminal" && retryable) {
        fail("ledger_outbox_transition_invalid", "failed_terminal");
      }
      const attemptCount = Number(row.attempt_count) + 1;
      const updatedAt = new Date(Number(this.now())).toISOString();
      const failure = {
        schema: "direct_ledger_outbox_dispatch_failure@1",
        failureCode,
        rendererSafeSummary: text(
          input.rendererSafeSummary,
          "Delivery dispatch failed.",
        ).slice(0, 480),
        retryable,
        attemptCount,
        observedAt: updatedAt,
      };
      failure.failureDigest = digestFor(
        failure.schema,
        failure,
        ["failureDigest"],
      );
      const dispatchState = retryable
        ? "retry_pending"
        : "failed_terminal";
      this.db.prepare(`
        update wm_ledger_delivery_outbox
        set dispatch_state = ?,
            attempt_count = ?,
            last_failure_json = ?,
            updated_at = ?
        where outbox_seed_id = ?
      `).run(
        dispatchState,
        attemptCount,
        json(failure),
        updatedAt,
        seedId,
      );
      return {
        outboxSeedId: seedId,
        dispatchState,
        attemptCount,
        failure,
      };
    });
  }

  expectedProjectionMap(events = this.listEvents({ limit: 10000 })) {
    const projections = new Map();
    events.forEach((event) => {
      projectionKeysForEvent(event).forEach((key) => {
        projections.set(
          key,
          buildMaterializedEpistemicProjection(event, key),
        );
      });
    });
    return projections;
  }

  verifyProjectionHeads() {
    try {
      const expected = this.expectedProjectionMap();
      const actual = new Map(
        this.listProjectionHeads().map((projection) => [
          projection.projectionKey,
          projection,
        ]),
      );
      if (expected.size !== actual.size) {
        return {
          ok: false,
          issue: "projection_head_count_mismatch",
          expectedCount: expected.size,
          actualCount: actual.size,
        };
      }
      for (const [key, projection] of expected.entries()) {
        if (!actual.has(key) || !jsonEqual(actual.get(key), projection)) {
          return {
            ok: false,
            issue: "projection_head_mismatch",
            projectionKey: key,
          };
        }
      }
      return { ok: true, projectionCount: expected.size };
    } catch (error) {
      return {
        ok: false,
        issue: error.code || "projection_verification_failed",
        detail: error.detail || error.message,
      };
    }
  }

  rebuildProjectionHeads() {
    const chain = this.verifyLedgerIntegrity();
    if (!chain.ok) {
      fail("epistemic_ledger_projection_rebuild_blocked", chain.issue);
    }
    const events = this.listEvents({ limit: 10000 });
    return this.transaction(() => {
      this.db.exec("delete from wm_epistemic_projection_heads");
      events.forEach((event) => this.applyProjectionHeadsForEvent(event));
      const verification = this.verifyProjectionHeads();
      if (!verification.ok) {
        fail("epistemic_ledger_projection_rebuild_failed", verification.issue);
      }
      return {
        rebuilt: true,
        eventCount: events.length,
        projectionCount: verification.projectionCount,
      };
    });
  }

  verifyLedgerIntegrity() {
    try {
      const constitutions = this.listActTypeConstitutions();
      const constitutionByRef = new Map(
        constitutions.map((value) => [
          ledgerActTypeConstitutionRef(value).id,
          value,
        ]),
      );
      const rows = this.db.prepare(`
        select * from wm_epistemic_events order by global_sequence asc
      `).all();
      let priorDigest = LEDGER_GENESIS_DIGEST;
      let expectedSequence = 1;
      for (const row of rows) {
        const event = this.eventFromRow(row);
        if (event.globalSequence !== expectedSequence) {
          fail(
            "epistemic_ledger_sequence_gap",
            `${expectedSequence}->${event.globalSequence}`,
          );
        }
        if (event.previousLedgerDigest !== priorDigest) {
          fail(
            "epistemic_ledger_digest_chain_invalid",
            event.ledgerEventId,
          );
        }
        const constitution = constitutionByRef.get(event.actTypeRef.id);
        if (!constitution || constitution.digest !== event.actTypeRef.digest) {
          fail("epistemic_ledger_act_type_ref_invalid", event.actTypeRef.id);
        }
        const memberships = this.db.prepare(`
          select stream_ref_json
          from wm_epistemic_event_stream_memberships
          where global_sequence = ?
          order by stream_position asc
        `).all(event.globalSequence).map((membership) =>
          parseJson(
            membership.stream_ref_json,
            `stream-membership:${event.ledgerEventId}`,
          ));
        if (!jsonEqual(memberships, event.streamRefs)) {
          fail(
            "epistemic_ledger_stream_membership_mismatch",
            event.ledgerEventId,
          );
        }
        priorDigest = event.eventDigest;
        expectedSequence += 1;
      }

      const eventById = new Map(
        rows.map((row) => [row.ledger_event_id, this.eventFromRow(row)]),
      );
      const receiptRows = this.db.prepare(`
        select * from wm_ledger_write_receipts order by created_at asc
      `).all();
      for (const row of receiptRows) {
        const receipt = parseJson(
          row.receipt_json,
          `receipt:${row.receipt_id}`,
        );
        validateLedgerWriteReceipt(receipt);
        const event = eventById.get(row.ledger_event_id);
        if (
          !event ||
          !exactEventRefMatches(receipt.ledgerEventRef, event) ||
          row.receipt_id !== receipt.receiptId ||
          row.receipt_digest !== receipt.receiptDigest ||
          row.append_request_digest !== receipt.appendRequestDigest ||
          row.actor_identity !== exactRefKey(event.actorRef, {
            includeDigest: false,
          }) ||
          row.actor_identity !== receipt.actorIdentity ||
          row.operation_scope !== receipt.operationScope ||
          row.idempotency_key !== receipt.idempotencyKey ||
          row.idempotency_key !== event.idempotencyKey
        ) {
          fail("epistemic_ledger_receipt_row_mismatch", row.receipt_id);
        }
      }
      if (receiptRows.length !== rows.length) {
        fail(
          "epistemic_ledger_receipt_count_mismatch",
          `${receiptRows.length}:${rows.length}`,
        );
      }

      const outboxRows = this.db.prepare(`
        select * from wm_ledger_delivery_outbox order by created_at asc
      `).all();
      for (const row of outboxRows) {
        const seed = parseJson(
          row.seed_json,
          `outbox-seed:${row.outbox_seed_id}`,
        );
        validateLedgerDeliveryOutboxSeed(seed);
        const event = eventById.get(row.ledger_event_id);
        if (
          !event ||
          !exactEventRefMatches(seed.ledgerEventRef, event) ||
          row.outbox_seed_id !== seed.outboxSeedId ||
          row.seed_digest !== seed.seedDigest ||
          ![
            "pending",
            "retry_pending",
            "dispatched",
            "failed_terminal",
          ].includes(row.dispatch_state)
        ) {
          fail("epistemic_ledger_outbox_row_mismatch", row.outbox_seed_id);
        }
        if (row.dispatch_state === "dispatched") {
          const deliveryRef = exactRef(
            parseJson(
              row.delivery_ref_json,
              `outbox-delivery-ref:${row.outbox_seed_id}`,
            ),
            "deliveryRef",
          );
          if (
            row.delivery_ref_digest !== digestFor(
              "direct_ledger_outbox_delivery_ref@1",
              deliveryRef,
            )
          ) {
            fail(
              "epistemic_ledger_outbox_delivery_ref_mismatch",
              row.outbox_seed_id,
            );
          }
        }
        if (["retry_pending", "failed_terminal"].includes(row.dispatch_state)) {
          const failure = parseJson(
            row.last_failure_json,
            `outbox-failure:${row.outbox_seed_id}`,
          );
          if (
            failure?.schema !== "direct_ledger_outbox_dispatch_failure@1" ||
            !text(failure.failureCode, "") ||
            Number(failure.attemptCount) !== Number(row.attempt_count) ||
            failure.failureDigest !== digestFor(
              failure.schema,
              failure,
              ["failureDigest"],
            )
          ) {
            fail(
              "epistemic_ledger_outbox_failure_mismatch",
              row.outbox_seed_id,
            );
          }
        }
      }
      return {
        ok: true,
        eventCount: rows.length,
        receiptCount: receiptRows.length,
        outboxSeedCount: outboxRows.length,
        headSequence: rows.length,
        headDigest: priorDigest,
      };
    } catch (error) {
      return {
        ok: false,
        issue: error.code || "epistemic_ledger_integrity_verification_failed",
        detail: error.detail || error.message,
      };
    }
  }

  verifyRestartState(options = {}) {
    const chain = this.verifyLedgerIntegrity();
    if (!chain.ok) {
      this.readOnlyDiagnosis = chain;
      return {
        ok: false,
        writable: false,
        chain,
        projections: { ok: false, issue: "not_checked" },
      };
    }
    let projections = this.verifyProjectionHeads();
    let rebuild = null;
    if (!projections.ok && options.repairProjections !== false) {
      rebuild = this.rebuildProjectionHeads();
      projections = this.verifyProjectionHeads();
    }
    if (!projections.ok) {
      this.readOnlyDiagnosis = projections;
      return {
        ok: false,
        writable: false,
        chain,
        projections,
        rebuild,
      };
    }
    this.readOnlyDiagnosis = null;
    return {
      ok: true,
      writable: true,
      chain,
      projections,
      rebuild,
    };
  }

  descriptor() {
    this.ensureOpen();
    const chain = this.verifyLedgerIntegrity();
    const projections = chain.ok
      ? this.verifyProjectionHeads()
      : { ok: false, issue: "not_checked" };
    return {
      schema: EPISTEMIC_LEDGER_STORE_SCHEMA,
      persistence: "sqlite_wal_same_control_plane_custody",
      dbPath: this.dbPath,
      writable: !this.readOnlyDiagnosis,
      chain,
      projections,
      actTypeConstitutionCount: Number(
        this.db.prepare(`
          select count(*) as count
          from wm_ledger_act_type_constitutions
        `).get()?.count || 0,
      ),
      rawChainOfThoughtStored: false,
      rawSecretStored: false,
      canonicalWorldstateWriter: false,
    };
  }
}

module.exports = {
  DirectEpistemicLedgerStore,
  EPISTEMIC_LEDGER_STORE_FILE_NAME,
  EPISTEMIC_LEDGER_STORE_SCHEMA,
};
