"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const {
  DIRECT_EPISTEMIC_CONTEXT_RESULT_SCHEMA,
  DIRECT_EPISTEMIC_E_REVISION_SCHEMA,
  DIRECT_EPISTEMIC_O_REVISION_SCHEMA,
  DIRECT_EPISTEMIC_PORT_SCHEMA,
  DIRECT_EPISTEMIC_RECORD_SCHEMA,
  DIRECT_EPISTEMIC_SUBJECT_SCHEMA,
  buildContextResult,
  buildERevision,
  buildEpistemicRecord,
  buildORevision,
  buildSemanticPort,
  buildSubject,
  canonicalJson,
  digestFor,
  text,
} = require("./kernel");

const DIRECT_EPISTEMIC_STORE_SCHEMA = "direct_epistemic_store@2";
const DIRECT_EPISTEMIC_STORE_FILE = "direct-epistemic-context-v2.sqlite";

function json(value) {
  return JSON.stringify(value ?? null);
}

function parse(value, label) {
  try {
    return JSON.parse(String(value));
  } catch {
    const error = new Error(`direct_epistemic_persisted_json_invalid:${label}`);
    error.code = "direct_epistemic_persisted_json_invalid";
    throw error;
  }
}

function assertSchema(value, schema, code) {
  if (value?.schema === schema) return;
  const error = new Error(code);
  error.code = code;
  throw error;
}

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function assertCanonicalEntity(input, rebuilt, idField, digestField, code) {
  if (
    !rebuilt ||
    input?.[idField] !== rebuilt[idField] ||
    input?.[digestField] !== rebuilt[digestField] ||
    canonicalJson(input) !== canonicalJson(rebuilt)
  ) fail(code);
  return rebuilt;
}

function matchesSelector(record, selector = {}, requestFacets = []) {
  const recordTypes = Array.isArray(selector.recordTypes) ? selector.recordTypes : [];
  const portFacets = Array.isArray(selector.facets) ? selector.facets : [];
  const standings = Array.isArray(selector.standings) ? selector.standings : [];
  const semanticKeys = Array.isArray(selector.semanticKeys) ? selector.semanticKeys : [];
  const facets = Array.isArray(requestFacets) && requestFacets.length ? requestFacets : portFacets;
  if (recordTypes.length && !recordTypes.includes(record.recordType)) return false;
  if (standings.length && !standings.includes(record.standing)) return false;
  if (semanticKeys.length && !semanticKeys.includes(record.semanticKey)) return false;
  if (portFacets.length && !portFacets.includes(record.facet)) return false;
  if (facets.length && !facets.includes(record.facet)) return false;
  return true;
}

class DirectEpistemicStore {
  constructor(options = {}) {
    const rootDir = text(options.rootDir);
    const dbPath = text(options.dbPath, rootDir ? path.join(rootDir, DIRECT_EPISTEMIC_STORE_FILE) : "");
    if (!options.db && !dbPath) throw new Error("DirectEpistemicStore requires rootDir or dbPath.");
    if (!options.db) fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.dbPath = dbPath;
    this.ownsDatabase = !options.db;
    this.db = options.db || new DatabaseSync(dbPath);
    this.now = typeof options.now === "function" ? options.now : Date.now;
    try {
      this.ensureSchema();
      this.verifyPersistedIntegrity();
      this.recoverInterruptedTranscriptionJobs();
    } catch (error) {
      if (this.ownsDatabase) {
        try { this.db?.close(); } catch {}
        this.db = null;
      }
      throw error;
    }
  }

  assertOpen() {
    if (this.db) return;
    const error = new Error("direct_epistemic_store_closed");
    error.code = "direct_epistemic_store_closed";
    throw error;
  }

  withImmediateTransaction(callback) {
    this.assertOpen();
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

  ensureSchema() {
    this.db.exec("pragma journal_mode = WAL");
    this.db.exec("pragma foreign_keys = ON");
    this.db.exec("pragma busy_timeout = 5000");
    this.db.exec(`
      create table if not exists direct_epistemic_meta (
        key text primary key,
        value text not null
      );
      create table if not exists direct_epistemic_subjects (
        subject_id text primary key,
        kind text not null,
        external_id text not null,
        project_id text not null,
        subject_digest text not null,
        subject_json text not null,
        updated_at text not null,
        unique(kind, external_id)
      );
      create table if not exists direct_epistemic_o_revisions (
        o_revision_id text primary key,
        subject_id text not null,
        revision_digest text not null,
        o_revision_json text not null,
        observed_at text not null,
        foreign key(subject_id) references direct_epistemic_subjects(subject_id)
      );
      create index if not exists direct_epistemic_o_subject_idx
        on direct_epistemic_o_revisions(subject_id, observed_at);
      create table if not exists direct_epistemic_e_revisions (
        e_revision_id text primary key,
        subject_id text not null,
        o_revision_id text not null,
        parent_e_revision_id text not null,
        revision_digest text not null,
        e_revision_json text not null,
        created_at text not null,
        foreign key(subject_id) references direct_epistemic_subjects(subject_id),
        foreign key(o_revision_id) references direct_epistemic_o_revisions(o_revision_id)
      );
      create index if not exists direct_epistemic_e_subject_idx
        on direct_epistemic_e_revisions(subject_id, o_revision_id, created_at);
      create table if not exists direct_epistemic_heads (
        subject_id text primary key,
        o_revision_id text not null,
        e_revision_id text not null,
        updated_at text not null,
        foreign key(subject_id) references direct_epistemic_subjects(subject_id),
        foreign key(o_revision_id) references direct_epistemic_o_revisions(o_revision_id),
        foreign key(e_revision_id) references direct_epistemic_e_revisions(e_revision_id)
      );
      create table if not exists direct_epistemic_records (
        record_id text primary key,
        subject_id text not null,
        o_revision_id text not null,
        e_revision_id text not null,
        semantic_key text not null,
        record_type text not null,
        facet text not null,
        standing text not null,
        record_digest text not null,
        record_json text not null,
        created_at text not null,
        foreign key(subject_id) references direct_epistemic_subjects(subject_id),
        foreign key(o_revision_id) references direct_epistemic_o_revisions(o_revision_id),
        foreign key(e_revision_id) references direct_epistemic_e_revisions(e_revision_id)
      );
      create index if not exists direct_epistemic_record_revision_idx
        on direct_epistemic_records(e_revision_id, semantic_key);
      create index if not exists direct_epistemic_record_subject_idx
        on direct_epistemic_records(subject_id, record_type, facet);
      create table if not exists direct_epistemic_ports (
        port_id text primary key,
        subject_id text not null,
        name text not null,
        port_digest text not null,
        port_json text not null,
        updated_at text not null,
        unique(subject_id, name),
        foreign key(subject_id) references direct_epistemic_subjects(subject_id)
      );
      create table if not exists direct_epistemic_context_imports (
        import_id text primary key,
        subject_id text not null,
        o_revision_id text not null,
        e_revision_id text not null,
        port_id text not null,
        import_digest text not null,
        result_json text not null,
        created_at text not null
      );
      create table if not exists direct_epistemic_transcription_jobs (
        job_id text primary key,
        subject_id text not null,
        o_revision_id text not null,
        source_digest text not null,
        model text not null,
        effort text not null,
        status text not null,
        result_e_revision_id text not null,
        error_code text not null,
        job_json text not null,
        updated_at text not null
      );
    `);
    const existingSchema = this.db.prepare("select value from direct_epistemic_meta where key = ?").get("schema");
    if (existingSchema && existingSchema.value !== DIRECT_EPISTEMIC_STORE_SCHEMA) {
      const error = new Error("direct_epistemic_store_schema_mismatch");
      error.code = "direct_epistemic_store_schema_mismatch";
      throw error;
    }
    this.db.prepare("insert or ignore into direct_epistemic_meta(key, value) values (?, ?)")
      .run("schema", DIRECT_EPISTEMIC_STORE_SCHEMA);
    const integrity = this.db.prepare("pragma quick_check").all();
    if (!integrity.length || integrity.some((row) => !Object.values(row).includes("ok"))) {
      const error = new Error("direct_epistemic_store_integrity_check_failed");
      error.code = "direct_epistemic_store_integrity_check_failed";
      throw error;
    }
  }

  verifyPersistedIntegrity() {
    this.assertOpen();
    const subjects = new Map();
    for (const row of this.db.prepare(`select subject_id, kind, external_id, project_id,
      subject_digest, subject_json from direct_epistemic_subjects`).all()) {
      const value = parse(row.subject_json, "subject");
      const rebuilt = buildSubject(value);
      if (
        rebuilt.subjectId !== row.subject_id ||
        rebuilt.subjectDigest !== row.subject_digest ||
        rebuilt.kind !== row.kind ||
        rebuilt.externalId !== row.external_id ||
        rebuilt.projectId !== row.project_id ||
        canonicalJson(value) !== canonicalJson(rebuilt)
      ) fail("direct_epistemic_subject_integrity_failed");
      subjects.set(rebuilt.subjectId, rebuilt);
    }
    const oRevisions = new Map();
    for (const row of this.db.prepare(`select o_revision_id, subject_id, revision_digest,
      o_revision_json, observed_at from direct_epistemic_o_revisions`).all()) {
      const value = parse(row.o_revision_json, "o_revision");
      const subject = subjects.get(value.subjectId);
      const rebuilt = subject && buildORevision({
        subject,
        substrateKind: value.substrateKind,
        substrateIdentity: value.substrateIdentity,
        posture: value.posture,
        observedAt: value.observedAt,
      });
      if (
        !rebuilt ||
        rebuilt.oRevisionId !== row.o_revision_id ||
        rebuilt.subjectId !== row.subject_id ||
        rebuilt.revisionDigest !== row.revision_digest ||
        rebuilt.observedAt !== row.observed_at ||
        canonicalJson(value) !== canonicalJson(rebuilt)
      ) fail("direct_epistemic_o_revision_integrity_failed");
      oRevisions.set(rebuilt.oRevisionId, rebuilt);
    }
    const eRevisions = new Map();
    for (const row of this.db.prepare(`select e_revision_id, subject_id, o_revision_id,
      parent_e_revision_id, revision_digest, e_revision_json, created_at
      from direct_epistemic_e_revisions`).all()) {
      const value = parse(row.e_revision_json, "e_revision");
      const subject = subjects.get(value.subjectId);
      const oRevision = oRevisions.get(value.oRevisionId);
      const rebuilt = subject && oRevision && buildERevision({
        subject,
        oRevision,
        parentERevisionId: value.parentERevisionId,
        revisionClass: value.revisionClass,
        basisDigest: value.basisDigest,
        standing: value.standing,
        coverage: value.coverage,
        createdAt: value.createdAt,
      });
      if (
        !rebuilt ||
        rebuilt.eRevisionId !== row.e_revision_id ||
        rebuilt.subjectId !== row.subject_id ||
        rebuilt.oRevisionId !== row.o_revision_id ||
        rebuilt.parentERevisionId !== row.parent_e_revision_id ||
        rebuilt.revisionDigest !== row.revision_digest ||
        rebuilt.createdAt !== row.created_at ||
        canonicalJson(value) !== canonicalJson(rebuilt)
      ) fail("direct_epistemic_e_revision_integrity_failed");
      eRevisions.set(rebuilt.eRevisionId, rebuilt);
    }
    for (const revision of eRevisions.values()) {
      if (!revision.parentERevisionId) continue;
      const parent = eRevisions.get(revision.parentERevisionId);
      if (
        !parent ||
        parent.subjectId !== revision.subjectId ||
        parent.oRevisionId !== revision.oRevisionId
      ) fail("direct_epistemic_e_revision_parent_integrity_failed");
    }
    const records = new Map();
    for (const row of this.db.prepare(`select record_id, subject_id, o_revision_id, e_revision_id,
      semantic_key, record_type, facet, standing, record_digest, record_json, created_at
      from direct_epistemic_records`).all()) {
      const value = parse(row.record_json, "record");
      const subject = subjects.get(value.subjectId);
      const oRevision = oRevisions.get(value.oRevisionId);
      const eRevision = eRevisions.get(value.eRevisionId);
      const rebuilt = subject && oRevision && eRevision && buildEpistemicRecord({
        ...value,
        subject,
        oRevision,
        eRevision,
      });
      if (
        !rebuilt ||
        rebuilt.recordId !== row.record_id ||
        rebuilt.subjectId !== row.subject_id ||
        rebuilt.oRevisionId !== row.o_revision_id ||
        rebuilt.eRevisionId !== row.e_revision_id ||
        rebuilt.semanticKey !== row.semantic_key ||
        rebuilt.recordType !== row.record_type ||
        rebuilt.facet !== row.facet ||
        rebuilt.standing !== row.standing ||
        rebuilt.recordDigest !== row.record_digest ||
        rebuilt.createdAt !== row.created_at ||
        canonicalJson(value) !== canonicalJson(rebuilt)
      ) fail("direct_epistemic_record_integrity_failed");
      records.set(rebuilt.recordId, rebuilt);
    }
    const ports = new Map();
    for (const row of this.db.prepare(`select port_id, subject_id, name, port_digest, port_json
      from direct_epistemic_ports`).all()) {
      const value = parse(row.port_json, "port");
      const subject = subjects.get(value.subjectId);
      const rebuilt = subject && buildSemanticPort({ ...value, subject });
      if (
        !rebuilt ||
        rebuilt.portId !== row.port_id ||
        rebuilt.subjectId !== row.subject_id ||
        rebuilt.name !== row.name ||
        rebuilt.portDigest !== row.port_digest ||
        canonicalJson(value) !== canonicalJson(rebuilt)
      ) fail("direct_epistemic_port_integrity_failed");
      ports.set(rebuilt.portId, rebuilt);
    }
    for (const row of this.db.prepare(`select import_id, subject_id, o_revision_id, e_revision_id,
      port_id, import_digest, result_json, created_at from direct_epistemic_context_imports`).all()) {
      const value = parse(row.result_json, "context_import");
      const rebuilt = buildContextResult(value);
      const subject = subjects.get(row.subject_id);
      const oRevision = oRevisions.get(row.o_revision_id);
      const eRevision = eRevisions.get(row.e_revision_id);
      const port = ports.get(row.port_id);
      const lineageIds = new Set();
      let cursor = eRevision;
      while (cursor && !lineageIds.has(cursor.eRevisionId)) {
        lineageIds.add(cursor.eRevisionId);
        cursor = cursor.parentERevisionId ? eRevisions.get(cursor.parentERevisionId) : null;
      }
      const recordBodiesMatch = rebuilt.records.every((record) => {
        const persisted = records.get(record.recordId);
        return persisted &&
          persisted.subjectId === subject?.subjectId &&
          persisted.oRevisionId === oRevision?.oRevisionId &&
          lineageIds.has(persisted.eRevisionId) &&
          canonicalJson(record) === canonicalJson(persisted);
      });
      if (
        rebuilt.importId !== row.import_id ||
        rebuilt.subjectRef?.id !== row.subject_id ||
        rebuilt.oRevisionRef?.id !== row.o_revision_id ||
        rebuilt.eRevisionRef?.id !== row.e_revision_id ||
        rebuilt.portRef?.id !== row.port_id ||
        rebuilt.importDigest !== row.import_digest ||
        rebuilt.createdAt !== row.created_at ||
        canonicalJson(value) !== canonicalJson(rebuilt) ||
        canonicalJson(rebuilt.subjectRef) !== canonicalJson(subject?.ref) ||
        canonicalJson(rebuilt.oRevisionRef) !== canonicalJson(oRevision?.ref) ||
        canonicalJson(rebuilt.eRevisionRef) !== canonicalJson(eRevision?.ref) ||
        canonicalJson(rebuilt.portRef) !== canonicalJson(port?.ref) ||
        oRevision?.subjectId !== subject?.subjectId ||
        eRevision?.subjectId !== subject?.subjectId ||
        eRevision?.oRevisionId !== oRevision?.oRevisionId ||
        port?.subjectId !== subject?.subjectId ||
        !recordBodiesMatch
      ) fail("direct_epistemic_context_import_integrity_failed");
    }
    for (const row of this.db.prepare(`select subject_id, o_revision_id, e_revision_id
      from direct_epistemic_heads`).all()) {
      const subject = subjects.get(row.subject_id);
      const oRevision = oRevisions.get(row.o_revision_id);
      const eRevision = eRevisions.get(row.e_revision_id);
      if (
        !subject ||
        oRevision?.subjectId !== subject.subjectId ||
        eRevision?.subjectId !== subject.subjectId ||
        eRevision?.oRevisionId !== oRevision?.oRevisionId
      ) fail("direct_epistemic_head_integrity_failed");
    }
  }

  recoverInterruptedTranscriptionJobs() {
    const rows = this.db.prepare(`select job_json from direct_epistemic_transcription_jobs
      where status = 'running'`).all();
    for (const row of rows) {
      const job = parse(row.job_json, "transcription_job");
      this.putTranscriptionJob({
        ...job,
        status: "failed",
        errorCode: "direct_epistemic_transcription_interrupted",
        updatedAt: new Date(this.now()).toISOString(),
      });
    }
  }

  close() {
    if (!this.db) return;
    if (this.ownsDatabase) this.db.close();
    this.db = null;
  }

  putSubject(subject) {
    assertSchema(subject, DIRECT_EPISTEMIC_SUBJECT_SCHEMA, "direct_epistemic_subject_invalid");
    const canonical = assertCanonicalEntity(
      subject,
      buildSubject(subject),
      "subjectId",
      "subjectDigest",
      "direct_epistemic_subject_canonical_invalid",
    );
    const now = new Date(this.now()).toISOString();
    this.db.prepare(`
      insert into direct_epistemic_subjects(
        subject_id, kind, external_id, project_id, subject_digest, subject_json, updated_at
      ) values (?, ?, ?, ?, ?, ?, ?)
      on conflict(subject_id) do update set
        project_id = excluded.project_id,
        subject_digest = excluded.subject_digest,
        subject_json = excluded.subject_json,
        updated_at = excluded.updated_at
    `).run(
      canonical.subjectId,
      canonical.kind,
      canonical.externalId,
      canonical.projectId,
      canonical.subjectDigest,
      json(canonical),
      now,
    );
    return canonical;
  }

  readSubject(subjectId) {
    const row = this.db.prepare("select subject_json from direct_epistemic_subjects where subject_id = ?").get(text(subjectId));
    return row ? parse(row.subject_json, "subject") : null;
  }

  findSubject(kind, externalId) {
    const row = this.db.prepare(`select subject_json from direct_epistemic_subjects
      where kind = ? and external_id = ?`).get(text(kind), text(externalId));
    return row ? parse(row.subject_json, "subject") : null;
  }

  listSubjects(options = {}) {
    const projectId = text(options.projectId);
    const kind = text(options.kind);
    const clauses = [];
    const values = [];
    if (projectId) { clauses.push("project_id = ?"); values.push(projectId); }
    if (kind) { clauses.push("kind = ?"); values.push(kind); }
    const rows = this.db.prepare(`select subject_json from direct_epistemic_subjects${
      clauses.length ? ` where ${clauses.join(" and ")}` : ""
    } order by updated_at desc`).all(...values);
    return rows.map((row) => parse(row.subject_json, "subject"));
  }

  putORevision(revision) {
    assertSchema(revision, DIRECT_EPISTEMIC_O_REVISION_SCHEMA, "direct_epistemic_o_revision_invalid");
    const subject = this.readSubject(revision.subjectId);
    if (!subject) fail("direct_epistemic_o_revision_subject_invalid");
    const canonical = assertCanonicalEntity(revision, buildORevision({
      subject,
      substrateKind: revision.substrateKind,
      substrateIdentity: revision.substrateIdentity,
      posture: revision.posture,
      observedAt: revision.observedAt,
    }), "oRevisionId", "revisionDigest", "direct_epistemic_o_revision_canonical_invalid");
    const existing = this.db.prepare(`select revision_digest, o_revision_json
      from direct_epistemic_o_revisions where o_revision_id = ?`).get(canonical.oRevisionId);
    if (existing) {
      if (existing.revision_digest !== canonical.revisionDigest) {
        const error = new Error("direct_epistemic_o_revision_identity_conflict");
        error.code = "direct_epistemic_o_revision_identity_conflict";
        throw error;
      }
      return parse(existing.o_revision_json, "o_revision");
    }
    this.db.prepare(`insert into direct_epistemic_o_revisions(
      o_revision_id, subject_id, revision_digest, o_revision_json, observed_at
    ) values (?, ?, ?, ?, ?)`).run(
      canonical.oRevisionId,
      canonical.subjectId,
      canonical.revisionDigest,
      json(canonical),
      canonical.observedAt,
    );
    return canonical;
  }

  readORevision(oRevisionId) {
    const row = this.db.prepare("select o_revision_json from direct_epistemic_o_revisions where o_revision_id = ?").get(text(oRevisionId));
    return row ? parse(row.o_revision_json, "o_revision") : null;
  }

  putERevision(revision, options = {}) {
    assertSchema(revision, DIRECT_EPISTEMIC_E_REVISION_SCHEMA, "direct_epistemic_e_revision_invalid");
    const subject = this.readSubject(revision.subjectId);
    const oRevision = this.readORevision(revision.oRevisionId);
    if (!subject || !oRevision || oRevision.subjectId !== subject.subjectId) {
      fail("direct_epistemic_e_revision_lineage_invalid");
    }
    const canonical = assertCanonicalEntity(revision, buildERevision({
      subject,
      oRevision,
      parentERevisionId: revision.parentERevisionId,
      revisionClass: revision.revisionClass,
      basisDigest: revision.basisDigest,
      standing: revision.standing,
      coverage: revision.coverage,
      createdAt: revision.createdAt,
    }), "eRevisionId", "revisionDigest", "direct_epistemic_e_revision_canonical_invalid");
    if (canonical.parentERevisionId) {
      const parent = this.readERevision(canonical.parentERevisionId);
      if (
        !parent ||
        parent.subjectId !== canonical.subjectId ||
        parent.oRevisionId !== canonical.oRevisionId
      ) fail("direct_epistemic_e_revision_parent_invalid");
    }
    const existing = this.db.prepare(`select revision_digest, e_revision_json
      from direct_epistemic_e_revisions where e_revision_id = ?`).get(canonical.eRevisionId);
    let stored = canonical;
    if (existing) {
      if (existing.revision_digest !== canonical.revisionDigest) {
        const error = new Error("direct_epistemic_e_revision_identity_conflict");
        error.code = "direct_epistemic_e_revision_identity_conflict";
        throw error;
      }
      stored = parse(existing.e_revision_json, "e_revision");
    } else {
      this.db.prepare(`insert into direct_epistemic_e_revisions(
      e_revision_id, subject_id, o_revision_id, parent_e_revision_id,
      revision_digest, e_revision_json, created_at
    ) values (?, ?, ?, ?, ?, ?, ?)`).run(
      canonical.eRevisionId,
      canonical.subjectId,
      canonical.oRevisionId,
      canonical.parentERevisionId,
      canonical.revisionDigest,
      json(canonical),
      canonical.createdAt,
    );
    }
    if (options.setHead !== false) this.setHead(stored.subjectId, stored.oRevisionId, stored.eRevisionId);
    return stored;
  }

  readERevision(eRevisionId) {
    const row = this.db.prepare("select e_revision_json from direct_epistemic_e_revisions where e_revision_id = ?").get(text(eRevisionId));
    return row ? parse(row.e_revision_json, "e_revision") : null;
  }

  setHead(subjectId, oRevisionId, eRevisionId) {
    const subject = this.readSubject(subjectId);
    const oRevision = this.readORevision(oRevisionId);
    const eRevision = this.readERevision(eRevisionId);
    if (
      !subject ||
      oRevision?.subjectId !== subject.subjectId ||
      eRevision?.subjectId !== subject.subjectId ||
      eRevision?.oRevisionId !== oRevision?.oRevisionId
    ) fail("direct_epistemic_head_lineage_invalid");
    const now = new Date(this.now()).toISOString();
    this.db.prepare(`insert into direct_epistemic_heads(
      subject_id, o_revision_id, e_revision_id, updated_at
    ) values (?, ?, ?, ?)
    on conflict(subject_id) do update set
      o_revision_id = excluded.o_revision_id,
      e_revision_id = excluded.e_revision_id,
      updated_at = excluded.updated_at`).run(subjectId, oRevisionId, eRevisionId, now);
  }

  readHead(subjectId) {
    const row = this.db.prepare(`select o_revision_id, e_revision_id, updated_at
      from direct_epistemic_heads where subject_id = ?`).get(text(subjectId));
    if (!row) return null;
    return {
      subject: this.readSubject(subjectId),
      oRevision: this.readORevision(row.o_revision_id),
      eRevision: this.readERevision(row.e_revision_id),
      updatedAt: row.updated_at,
    };
  }

  appendRecords(records = [], options = {}) {
    const statement = this.db.prepare(`insert or ignore into direct_epistemic_records(
      record_id, subject_id, o_revision_id, e_revision_id, semantic_key,
      record_type, facet, standing, record_digest, record_json, created_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    let inserted = 0;
    const append = () => {
      for (const record of Array.isArray(records) ? records : []) {
        assertSchema(record, DIRECT_EPISTEMIC_RECORD_SCHEMA, "direct_epistemic_record_invalid");
        const subject = this.readSubject(record.subjectId);
        const oRevision = this.readORevision(record.oRevisionId);
        const eRevision = this.readERevision(record.eRevisionId);
        if (!subject || !oRevision || !eRevision) fail("direct_epistemic_record_lineage_invalid");
        const canonical = assertCanonicalEntity(record, buildEpistemicRecord({
          ...record,
          subject,
          oRevision,
          eRevision,
        }), "recordId", "recordDigest", "direct_epistemic_record_canonical_invalid");
        const existing = this.db.prepare(`select record_digest from direct_epistemic_records
          where record_id = ?`).get(canonical.recordId);
        if (existing) {
          if (existing.record_digest !== canonical.recordDigest) {
            const error = new Error("direct_epistemic_record_identity_conflict");
            error.code = "direct_epistemic_record_identity_conflict";
            throw error;
          }
          continue;
        }
        const result = statement.run(
          canonical.recordId,
          canonical.subjectId,
          canonical.oRevisionId,
          canonical.eRevisionId,
          canonical.semanticKey,
          canonical.recordType,
          canonical.facet,
          canonical.standing,
          canonical.recordDigest,
          json(canonical),
          canonical.createdAt,
        );
        inserted += Number(result.changes || 0);
      }
    };
    if (options.inTransaction) append();
    else this.withImmediateTransaction(append);
    return { inserted, attempted: Array.isArray(records) ? records.length : 0 };
  }

  revisionLineage(eRevisionId) {
    const revisions = [];
    const seen = new Set();
    let cursor = this.readERevision(eRevisionId);
    const leafSubjectId = cursor?.subjectId;
    const leafORevisionId = cursor?.oRevisionId;
    while (cursor) {
      if (seen.has(cursor.eRevisionId)) fail("direct_epistemic_e_revision_cycle");
      if (cursor.subjectId !== leafSubjectId || cursor.oRevisionId !== leafORevisionId) {
        fail("direct_epistemic_e_revision_lineage_invalid");
      }
      seen.add(cursor.eRevisionId);
      revisions.push(cursor);
      if (!cursor.parentERevisionId) break;
      cursor = this.readERevision(cursor.parentERevisionId);
      if (!cursor) fail("direct_epistemic_e_revision_parent_invalid");
    }
    return revisions.reverse();
  }

  recordsForRevision(eRevisionId) {
    const lineage = this.revisionLineage(eRevisionId);
    const recordsBySemanticKey = new Map();
    for (const revision of lineage) {
      const rows = this.db.prepare(`select record_json from direct_epistemic_records
        where e_revision_id = ? order by created_at, record_id`).all(revision.eRevisionId);
      for (const row of rows) {
        const record = parse(row.record_json, "record");
        recordsBySemanticKey.set(record.semanticKey, record);
      }
    }
    return [...recordsBySemanticKey.values()];
  }

  putPort(port) {
    assertSchema(port, DIRECT_EPISTEMIC_PORT_SCHEMA, "direct_epistemic_port_invalid");
    const subject = this.readSubject(port.subjectId);
    if (!subject) fail("direct_epistemic_port_subject_invalid");
    const canonical = assertCanonicalEntity(
      port,
      buildSemanticPort({ ...port, subject }),
      "portId",
      "portDigest",
      "direct_epistemic_port_canonical_invalid",
    );
    const now = new Date(this.now()).toISOString();
    const exact = this.db.prepare(`select port_digest, port_json from direct_epistemic_ports
      where port_id = ?`).get(canonical.portId);
    if (exact) {
      if (exact.port_digest !== canonical.portDigest) {
        const error = new Error("direct_epistemic_port_identity_conflict");
        error.code = "direct_epistemic_port_identity_conflict";
        throw error;
      }
      return parse(exact.port_json, "port");
    }
    this.db.prepare(`insert into direct_epistemic_ports(
      port_id, subject_id, name, port_digest, port_json, updated_at
    ) values (?, ?, ?, ?, ?, ?)
    on conflict(subject_id, name) do update set
      port_id = excluded.port_id,
      port_digest = excluded.port_digest,
      port_json = excluded.port_json,
      updated_at = excluded.updated_at`).run(
      canonical.portId,
      canonical.subjectId,
      canonical.name,
      canonical.portDigest,
      json(canonical),
      now,
    );
    return canonical;
  }

  listPorts(subjectId) {
    return this.db.prepare(`select port_json from direct_epistemic_ports
      where subject_id = ? order by name`).all(text(subjectId))
      .map((row) => parse(row.port_json, "port"));
  }

  readPort(subjectId, name) {
    const row = this.db.prepare(`select port_json from direct_epistemic_ports
      where subject_id = ? and name = ?`).get(text(subjectId), text(name));
    return row ? parse(row.port_json, "port") : null;
  }

  importContext(input = {}) {
    const subject = this.readSubject(input.subjectId);
    const head = subject ? this.readHead(subject.subjectId) : null;
    if (!subject || !head?.oRevision || !head?.eRevision) throw new Error("direct_epistemic_subject_head_unavailable");
    const requestedO = text(input.oRevisionId, head.oRevision.oRevisionId);
    const requestedE = text(input.eRevisionId, head.eRevision.eRevisionId);
    if (requestedO !== head.oRevision.oRevisionId || requestedE !== head.eRevision.eRevisionId) {
      throw new Error("direct_epistemic_context_revision_stale");
    }
    const port = this.readPort(subject.subjectId, input.portName);
    if (!port) throw new Error(`direct_epistemic_port_unknown:${text(input.portName)}`);
    const detailDepth = text(input.detailDepth, "typed_records");
    const rawEvidencePolicy = text(input.rawEvidencePolicy, "references_only");
    const tokenBudget = Number.isFinite(Number(input.tokenBudget)) ? Math.max(0, Number(input.tokenBudget)) : 0;
    if (detailDepth !== "typed_records") {
      const error = new Error("direct_epistemic_context_detail_depth_unsupported");
      error.code = "direct_epistemic_context_detail_depth_unsupported";
      throw error;
    }
    if (rawEvidencePolicy !== "references_only") {
      const error = new Error("direct_epistemic_context_raw_evidence_policy_unsupported");
      error.code = "direct_epistemic_context_raw_evidence_policy_unsupported";
      throw error;
    }
    if (tokenBudget > 0) {
      const error = new Error("direct_epistemic_context_token_budget_unsupported");
      error.code = "direct_epistemic_context_token_budget_unsupported";
      throw error;
    }
    const requestedFacets = Array.isArray(input.facets) ? input.facets.map((value) => text(value)).filter(Boolean) : [];
    const sinceRevision = text(input.sinceRevision);
    let allRecords = this.recordsForRevision(head.eRevision.eRevisionId);
    if (sinceRevision) {
      const lineageIds = new Set(this.revisionLineage(head.eRevision.eRevisionId).map((revision) => revision.eRevisionId));
      if (!lineageIds.has(sinceRevision)) {
        const error = new Error("direct_epistemic_context_since_revision_not_in_lineage");
        error.code = "direct_epistemic_context_since_revision_not_in_lineage";
        throw error;
      }
      const baseline = new Map(this.recordsForRevision(sinceRevision)
        .map((record) => [record.semanticKey, record.recordDigest]));
      allRecords = allRecords.filter((record) => baseline.get(record.semanticKey) !== record.recordDigest);
    }
    const traversal = new Map((Array.isArray(port.traversal) ? port.traversal : [])
      .map((facet, index) => [facet, index]));
    const records = allRecords
      .filter((record) => matchesSelector(record, port.selector, requestedFacets))
      .sort((left, right) => {
        const leftOrder = traversal.has(left.facet) ? traversal.get(left.facet) : Number.MAX_SAFE_INTEGER;
        const rightOrder = traversal.has(right.facet) ? traversal.get(right.facet) : Number.MAX_SAFE_INTEGER;
        return leftOrder - rightOrder || left.semanticKey.localeCompare(right.semanticKey);
      });
    const selectedFacets = new Set(records.map((record) => record.facet));
    const omissions = [];
    const omissionWitnesses = [];
    if (!records.length) omissions.push("port_selected_no_records");
    if (sinceRevision && !records.length) omissions.push("no_selected_changes_since_revision");
    for (const omission of Array.isArray(head.eRevision.coverage?.omissions) ? head.eRevision.coverage.omissions : []) {
      if (omission && typeof omission === "object" && !Array.isArray(omission)) omissionWitnesses.push(omission);
      const label = typeof omission === "string"
        ? text(omission)
        : text(omission?.code, omission?.witnessDigest ? `witness:${omission.witnessDigest}` : "typed_omission");
      omissions.push(`e_revision:${label}`);
    }
    for (const facet of requestedFacets) {
      if (!selectedFacets.has(facet)) omissions.push(`facet_unavailable:${facet}`);
    }
    const result = buildContextResult({
      subjectRef: subject.ref,
      oRevisionRef: head.oRevision.ref,
      eRevisionRef: head.eRevision.ref,
      portRef: port.ref,
      purpose: port.purpose,
      purposeId: port.name,
      requestIntent: text(input.purpose || input.requestIntent),
      facets: requestedFacets.length ? requestedFacets : port.selector.facets,
      records,
      omissions,
      omissionWitnesses,
      freshness: text(input.freshness, "exact"),
      detailDepth,
      sinceRevision,
      rawEvidencePolicy,
      tokenBudget,
      createdAt: new Date(this.now()).toISOString(),
    });
    assertSchema(result, DIRECT_EPISTEMIC_CONTEXT_RESULT_SCHEMA, "direct_epistemic_context_result_invalid");
    const existing = this.db.prepare(`select import_digest, result_json
      from direct_epistemic_context_imports where import_id = ?`).get(result.importId);
    if (existing) {
      if (existing.import_digest !== result.importDigest) {
        const error = new Error("direct_epistemic_context_import_identity_conflict");
        error.code = "direct_epistemic_context_import_identity_conflict";
        throw error;
      }
      return parse(existing.result_json, "context_import");
    }
    this.db.prepare(`insert into direct_epistemic_context_imports(
      import_id, subject_id, o_revision_id, e_revision_id, port_id,
      import_digest, result_json, created_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      result.importId,
      subject.subjectId,
      head.oRevision.oRevisionId,
      head.eRevision.eRevisionId,
      port.portId,
      result.importDigest,
      json(result),
      result.createdAt,
    );
    return result;
  }

  admitProjection(input = {}) {
    const hasExpectedHead = Object.prototype.hasOwnProperty.call(input, "expectedHead");
    return this.withImmediateTransaction(() => {
      const currentRow = this.db.prepare(`select o_revision_id, e_revision_id
        from direct_epistemic_heads where subject_id = ?`).get(input.subject.subjectId);
      if (hasExpectedHead) {
        const expected = input.expectedHead;
        const matches = expected === null
          ? !currentRow
          : currentRow?.o_revision_id === expected?.oRevisionId &&
            currentRow?.e_revision_id === expected?.eRevisionId;
        if (!matches) {
          const error = new Error("direct_epistemic_head_compare_and_swap_failed");
          error.code = "direct_epistemic_head_compare_and_swap_failed";
          throw error;
        }
      }
      const subject = this.putSubject(input.subject);
      const oRevision = this.putORevision(input.oRevision);
      const eRevision = this.putERevision(input.eRevision, { setHead: false });
      const recordResult = this.appendRecords(input.records, { inTransaction: true });
      const ports = [];
      for (const port of Array.isArray(input.ports) ? input.ports : []) ports.push(this.putPort(port));
      if (input.transcriptionJob) this.putTranscriptionJob(input.transcriptionJob);
      if (input.setHead !== false) this.setHead(subject.subjectId, oRevision.oRevisionId, eRevision.eRevisionId);
      return { subject, oRevision, eRevision, ports, recordResult };
    });
  }

  putTranscriptionJob(job = {}) {
    const normalized = {
      jobId: text(job.jobId, `ep_job_${digestFor(job).slice(0, 24)}`),
      subjectId: text(job.subjectId),
      oRevisionId: text(job.oRevisionId),
      sourceDigest: text(job.sourceDigest),
      model: text(job.model),
      effort: text(job.effort),
      status: text(job.status, "pending"),
      resultERevisionId: text(job.resultERevisionId),
      errorCode: text(job.errorCode),
      omissionCount: Number(job.omissionCount || 0),
      omissionDigest: text(job.omissionDigest),
      constraintDigest: text(job.constraintDigest),
      updatedAt: text(job.updatedAt, new Date(this.now()).toISOString()),
    };
    this.db.prepare(`insert into direct_epistemic_transcription_jobs(
      job_id, subject_id, o_revision_id, source_digest, model, effort,
      status, result_e_revision_id, error_code, job_json, updated_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    on conflict(job_id) do update set
      status = excluded.status,
      result_e_revision_id = excluded.result_e_revision_id,
      error_code = excluded.error_code,
      job_json = excluded.job_json,
      updated_at = excluded.updated_at`).run(
      normalized.jobId,
      normalized.subjectId,
      normalized.oRevisionId,
      normalized.sourceDigest,
      normalized.model,
      normalized.effort,
      normalized.status,
      normalized.resultERevisionId,
      normalized.errorCode,
      json(normalized),
      normalized.updatedAt,
    );
    return normalized;
  }

  readTranscriptionJob(jobId) {
    const row = this.db.prepare(`select job_json from direct_epistemic_transcription_jobs
      where job_id = ?`).get(text(jobId));
    return row ? parse(row.job_json, "transcription_job") : null;
  }

  latestTranscriptionJob(subjectId) {
    const row = this.db.prepare(`select job_json from direct_epistemic_transcription_jobs
      where subject_id = ? order by updated_at desc limit 1`).get(text(subjectId));
    return row ? parse(row.job_json, "transcription_job") : null;
  }

  latestContextImport(subjectId) {
    const row = this.db.prepare(`select result_json from direct_epistemic_context_imports
      where subject_id = ? order by created_at desc limit 1`).get(text(subjectId));
    return row ? parse(row.result_json, "context_import") : null;
  }

  subjectSummary(subjectId) {
    const head = this.readHead(subjectId);
    if (!head) return null;
    const records = this.recordsForRevision(head.eRevision.eRevisionId);
    const counts = {};
    for (const record of records) counts[record.recordType] = Number(counts[record.recordType] || 0) + 1;
    return {
      subject: head.subject,
      oRevision: head.oRevision,
      eRevision: head.eRevision,
      recordCount: records.length,
      recordCounts: counts,
      ports: this.listPorts(subjectId),
      latestImport: this.latestContextImport(subjectId),
      latestTranscription: this.latestTranscriptionJob(subjectId),
      updatedAt: head.updatedAt,
    };
  }
}

module.exports = {
  DIRECT_EPISTEMIC_STORE_FILE,
  DIRECT_EPISTEMIC_STORE_SCHEMA,
  DirectEpistemicStore,
  matchesSelector,
};
