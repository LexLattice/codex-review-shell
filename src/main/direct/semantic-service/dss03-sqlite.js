"use strict";

/*
 * The DSS-0.3 worker has no authority to invent a second database protocol.
 * This small store is the durable authority for the offline fixture harness;
 * when a DSS-0.2 daemon is attached its database is used for CAS/quarantine
 * and its custody keyring authenticates this extension's rows.
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const { canonicalJson, digestObject, isoNow, atomicWrite, ensureDirectory, parseJsonStrict, dss02Fail } = require("./dss02-common");

const DSS03_SQLITE_SCHEMA = "direct_semantic_service_dss03_sqlite@1";
const DSS03_SQLITE_MIGRATION = 1;
const POPULATIONS = ["generations", "fixtures", "handoffs", "plans", "cells", "witnesses", "capsules", "assurances", "attempts", "leases", "observations", "cancellations", "raw", "admissions", "microresults", "candidates", "assessments", "assessment_members", "attestations", "attestation_members", "evaluations", "evaluation_attestations", "coverages", "dispositions", "seals", "seal_artifacts", "accounting", "cas"];
// Children are deleted before their parents.  Keep this explicit: SQLite's
// foreign-key pragma is part of the custody boundary, not a best-effort hint.
const DELETE_ORDER = ["seal_artifacts", "cas", "seals", "dispositions", "coverages", "evaluation_attestations", "evaluations", "attestation_members", "attestations", "assessment_members", "assessments", "candidates", "admissions", "microresults", "raw", "cancellations", "observations", "accounting", "leases", "attempts", "assurances", "witnesses", "capsules", "cells", "plans", "handoffs", "fixtures", "generations"];

const MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS dss03_meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS dss03_snapshot (singleton INTEGER PRIMARY KEY CHECK(singleton=1), payload_json TEXT NOT NULL, payload_digest TEXT NOT NULL, auth_tag TEXT NOT NULL, custody_key_revision_ref TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS dss03_events (event_sequence INTEGER PRIMARY KEY NOT NULL, event_digest TEXT NOT NULL UNIQUE, prior_digest TEXT, payload_json TEXT NOT NULL, auth_tag TEXT NOT NULL, custody_key_revision_ref TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS dss03_generations (generation_ref TEXT PRIMARY KEY NOT NULL, payload_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS dss03_fixtures (singleton INTEGER PRIMARY KEY CHECK(singleton=1), fixture_digest TEXT NOT NULL, payload_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS dss03_handoffs (job_ref TEXT PRIMARY KEY NOT NULL, payload_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS dss03_plans (plan_ref TEXT PRIMARY KEY NOT NULL, job_ref TEXT NOT NULL REFERENCES dss03_handoffs(job_ref), payload_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS dss03_cells (cell_ref TEXT PRIMARY KEY NOT NULL, plan_ref TEXT NOT NULL REFERENCES dss03_plans(plan_ref), payload_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS dss03_witnesses (witness_ref TEXT PRIMARY KEY NOT NULL, cell_ref TEXT NOT NULL REFERENCES dss03_cells(cell_ref), plan_ref TEXT NOT NULL REFERENCES dss03_plans(plan_ref), payload_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS dss03_capsules (capsule_ref TEXT PRIMARY KEY NOT NULL, cell_ref TEXT NOT NULL REFERENCES dss03_cells(cell_ref), plan_ref TEXT NOT NULL REFERENCES dss03_plans(plan_ref), payload_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS dss03_assurances (assurance_ref TEXT PRIMARY KEY NOT NULL, capsule_ref TEXT NOT NULL REFERENCES dss03_capsules(capsule_ref), payload_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS dss03_attempts (attempt_ref TEXT PRIMARY KEY NOT NULL, capsule_ref TEXT NOT NULL REFERENCES dss03_capsules(capsule_ref), cell_ref TEXT NOT NULL REFERENCES dss03_cells(cell_ref), plan_ref TEXT NOT NULL REFERENCES dss03_plans(plan_ref), payload_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS dss03_leases (lease_ref TEXT PRIMARY KEY NOT NULL, attempt_ref TEXT NOT NULL REFERENCES dss03_attempts(attempt_ref), payload_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS dss03_observations (observation_ref TEXT PRIMARY KEY NOT NULL, attempt_ref TEXT REFERENCES dss03_attempts(attempt_ref), payload_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS dss03_cancellations (cancellation_ref TEXT PRIMARY KEY NOT NULL, attempt_ref TEXT NOT NULL REFERENCES dss03_attempts(attempt_ref), payload_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS dss03_raw (raw_ref TEXT PRIMARY KEY NOT NULL, attempt_ref TEXT NOT NULL REFERENCES dss03_attempts(attempt_ref), payload_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS dss03_admissions (raw_ref TEXT PRIMARY KEY NOT NULL REFERENCES dss03_raw(raw_ref), microresult_ref TEXT NOT NULL REFERENCES dss03_microresults(microresult_ref), attempt_ref TEXT NOT NULL REFERENCES dss03_attempts(attempt_ref), payload_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS dss03_microresults (microresult_ref TEXT PRIMARY KEY NOT NULL, attempt_ref TEXT NOT NULL REFERENCES dss03_attempts(attempt_ref), cell_ref TEXT NOT NULL REFERENCES dss03_cells(cell_ref), payload_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS dss03_candidates (candidate_ref TEXT PRIMARY KEY NOT NULL, attempt_ref TEXT NOT NULL REFERENCES dss03_attempts(attempt_ref), payload_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS dss03_assessments (assessment_ref TEXT PRIMARY KEY NOT NULL, payload_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS dss03_assessment_members (assessment_ref TEXT NOT NULL REFERENCES dss03_assessments(assessment_ref), microresult_ref TEXT NOT NULL REFERENCES dss03_microresults(microresult_ref), PRIMARY KEY(assessment_ref,microresult_ref));
CREATE TABLE IF NOT EXISTS dss03_attestations (attestation_ref TEXT PRIMARY KEY NOT NULL, assessment_ref TEXT NOT NULL REFERENCES dss03_assessments(assessment_ref), payload_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS dss03_attestation_members (attestation_ref TEXT NOT NULL REFERENCES dss03_attestations(attestation_ref), microresult_ref TEXT NOT NULL REFERENCES dss03_microresults(microresult_ref), PRIMARY KEY(attestation_ref,microresult_ref));
CREATE TABLE IF NOT EXISTS dss03_evaluations (evaluation_ref TEXT PRIMARY KEY NOT NULL, cell_ref TEXT NOT NULL REFERENCES dss03_cells(cell_ref), payload_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS dss03_evaluation_attestations (evaluation_ref TEXT NOT NULL REFERENCES dss03_evaluations(evaluation_ref), attestation_ref TEXT NOT NULL REFERENCES dss03_attestations(attestation_ref), PRIMARY KEY(evaluation_ref,attestation_ref));
CREATE TABLE IF NOT EXISTS dss03_coverages (coverage_ref TEXT PRIMARY KEY NOT NULL, plan_ref TEXT NOT NULL REFERENCES dss03_plans(plan_ref), payload_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS dss03_dispositions (disposition_ref TEXT PRIMARY KEY NOT NULL, plan_ref TEXT NOT NULL REFERENCES dss03_plans(plan_ref), coverage_ref TEXT NOT NULL REFERENCES dss03_coverages(coverage_ref), payload_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS dss03_seals (seal_ref TEXT PRIMARY KEY NOT NULL, plan_ref TEXT NOT NULL REFERENCES dss03_plans(plan_ref), coverage_ref TEXT NOT NULL REFERENCES dss03_coverages(coverage_ref), disposition_ref TEXT NOT NULL REFERENCES dss03_dispositions(disposition_ref), payload_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS dss03_seal_artifacts (seal_ref TEXT NOT NULL REFERENCES dss03_seals(seal_ref), artifact_ref TEXT NOT NULL REFERENCES dss03_cas(artifact_ref), PRIMARY KEY(seal_ref,artifact_ref));
CREATE TABLE IF NOT EXISTS dss03_accounting (attempt_ref TEXT PRIMARY KEY NOT NULL REFERENCES dss03_attempts(attempt_ref), payload_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS dss03_cas (artifact_ref TEXT PRIMARY KEY NOT NULL, object_ref TEXT NOT NULL, plan_ref TEXT REFERENCES dss03_plans(plan_ref), job_ref TEXT, payload_json TEXT NOT NULL);
`;

function localTag(key, value) { return `sha256:${crypto.createHmac("sha256", key).update(value).digest("hex")}`; }
function snapshotDigest(state) { return digestObject("DirectSemanticService.Dss03SqliteSnapshot.v1", state); }
function json(value) { return canonicalJson(value); }

class Dss03SqliteStore {
  constructor({ root, dss02 = undefined, now = undefined } = {}) {
    if (!root) dss02Fail("DSS03_SQLITE_ROOT_REQUIRED");
    this.root = path.resolve(root); this.dbPath = path.join(this.root, "direct-semantic-dss03.sqlite"); this.keyPath = path.join(this.root, "dss03-custody.key"); this.lockDbPath = path.join(this.root, "direct-semantic-dss03.writer-lock.sqlite"); this.dss02 = dss02; this.now = now; this.db = null; this.lockDb = null;
    ensureDirectory(this.root);
    try { this.lockDb = new DatabaseSync(this.lockDbPath); this.lockDb.exec("PRAGMA busy_timeout=0; BEGIN EXCLUSIVE;"); } catch (_) { if (this.lockDb) { try { this.lockDb.close(); } catch (_) {} this.lockDb = null; } dss02Fail("DSS03_SQLITE_WRITER_LOCKED"); }
    try { this.key = this._loadKey(); this.open(); } catch (error) { this.close(); throw error; }
  }
  clock() { return isoNow(typeof this.now === "function" ? this.now() : this.now); }
  _loadKey() { if (this.dss02?.keyring) return null; if (fs.existsSync(this.keyPath)) { const stat = fs.lstatSync(this.keyPath); if (stat.isSymbolicLink() || !stat.isFile()) dss02Fail("DSS03_SQLITE_KEY_INVALID"); const key = fs.readFileSync(this.keyPath); if (key.length !== 32) dss02Fail("DSS03_SQLITE_KEY_INVALID"); return key; } const key = crypto.randomBytes(32); atomicWrite(this.keyPath, key, 0o600); return key; }
  open() { this.db = new DatabaseSync(this.dbPath); this.db.exec("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;"); this.db.exec("CREATE TABLE IF NOT EXISTS dss03_schema_migrations (version INTEGER PRIMARY KEY NOT NULL, checksum TEXT NOT NULL, applied_at TEXT NOT NULL);"); const rows = this.db.prepare("SELECT version,checksum FROM dss03_schema_migrations ORDER BY version").all(); const checksum = snapshotDigest({ schema: DSS03_SQLITE_SCHEMA, migration: DSS03_SQLITE_MIGRATION, sql: MIGRATION_SQL }); if (rows.some((row) => row.version !== DSS03_SQLITE_MIGRATION || row.checksum !== checksum)) dss02Fail("DSS03_SQLITE_MIGRATION_MISMATCH"); if (!rows.length) { this.db.exec("BEGIN IMMEDIATE"); try { this.db.exec(MIGRATION_SQL); this.db.prepare("INSERT INTO dss03_schema_migrations(version,checksum,applied_at) VALUES(?,?,?)").run(DSS03_SQLITE_MIGRATION, checksum, this.clock()); this.db.exec("COMMIT"); } catch (error) { try { this.db.exec("ROLLBACK"); } catch (_) {} throw error; } } }
  _tag(value) { if (this.dss02?.keyring) { const current = this.dss02.keyring.current(); return { keyRef: current.custodyKeyRevisionRef, tag: this.dss02.keyring.tag(current.custodyKeyRevisionRef, value) }; } return { keyRef: "dss03-local-custody-key-1", tag: localTag(this.key, value) }; }
  _verifyTag(keyRef, value, tag) { if (this.dss02?.keyring) return this.dss02.keyring.tag(keyRef, value) === tag; return keyRef === "dss03-local-custody-key-1" && localTag(this.key, value) === tag; }
  _tx(callback) { this.db.exec("BEGIN IMMEDIATE"); try { const value = callback(this.db); this.db.exec("COMMIT"); return value; } catch (error) { try { this.db.exec("ROLLBACK"); } catch (_) {} throw error; } }
  readState() { const row = this.db.prepare("SELECT * FROM dss03_snapshot WHERE singleton=1").get(); if (!row) return null; if (row.payload_digest !== snapshotDigest(JSON.parse(row.payload_json)) || !this._verifyTag(row.custody_key_revision_ref, row.payload_digest, row.auth_tag)) dss02Fail("DSS03_SQLITE_SNAPSHOT_AUTH_INVALID"); const state = parseJsonStrict(row.payload_json); this.verifyState(state); return state; }
  writeState(state) { const payload = json(state); const payloadDigest = snapshotDigest(state); const tag = this._tag(payloadDigest); this._tx((db) => { for (const table of DELETE_ORDER) { try { db.exec(`DELETE FROM dss03_${table}`); } catch (error) { error.message = `${error.message} [delete dss03_${table}]`; throw error; } } db.exec("DELETE FROM dss03_events; DELETE FROM dss03_snapshot;"); this._insertPopulations(db, state); for (const event of state.events || []) { const eventPayload = json(event); const eventTag = this._tag(event.eventDigest); db.prepare("INSERT INTO dss03_events(event_sequence,event_digest,prior_digest,payload_json,auth_tag,custody_key_revision_ref) VALUES(?,?,?,?,?,?)").run(event.sequence, event.eventDigest, event.priorDigest, eventPayload, eventTag.tag, eventTag.keyRef); } db.prepare("INSERT INTO dss03_snapshot(singleton,payload_json,payload_digest,auth_tag,custody_key_revision_ref,updated_at) VALUES(1,?,?,?,?,?)").run(payload, payloadDigest, tag.tag, tag.keyRef, this.clock()); }); }
  _insert(db, table, columns, values) { try { db.prepare(`INSERT INTO dss03_${table}(${columns.join(",")}) VALUES(${columns.map(() => "?").join(",")})`).run(...values); } catch (error) { error.message = `${error.message} [dss03_${table}]`; throw error; } }
  _insertPopulations(db, state) {
    if (state.generation) this._insert(db, "generations", ["generation_ref","payload_json"], [state.generation.generationRef, json(state.generation)]);
    if (state.fixture) this._insert(db, "fixtures", ["singleton","fixture_digest","payload_json"], [1, state.fixture.bundleDigest, json(state.fixture)]);
    for (const value of Object.values(state.handoffs || {})) this._insert(db, "handoffs", ["job_ref","payload_json"], [value.jobRef, json(value)]);
    for (const value of Object.values(state.plans || {})) this._insert(db, "plans", ["plan_ref","job_ref","payload_json"], [value.planRef, value.jobRef, json(value)]);
    for (const value of Object.values(state.cells || {})) this._insert(db, "cells", ["cell_ref","plan_ref","payload_json"], [value.cellRef, value.planRef, json(value)]);
    for (const value of Object.values(state.cells || {})) if (value.terminalWitness) this._insert(db, "witnesses", ["witness_ref","cell_ref","plan_ref","payload_json"], [value.terminalWitness.witnessRef, value.cellRef, value.planRef, json(value.terminalWitness)]);
    for (const value of Object.values(state.capsules || {})) this._insert(db, "capsules", ["capsule_ref","cell_ref","plan_ref","payload_json"], [value.capsuleRef, value.cellRef, value.planRef, json(value)]);
    for (const value of Object.values(state.assurances || {})) this._insert(db, "assurances", ["assurance_ref","capsule_ref","payload_json"], [value.assuranceRef, value.capsuleRef, json(value)]);
    for (const value of Object.values(state.attempts || {})) this._insert(db, "attempts", ["attempt_ref","capsule_ref","cell_ref","plan_ref","payload_json"], [value.attemptRef, value.capsuleRef, value.cellRef, value.planRef, json(value)]);
    for (const value of Object.values(state.leases || {})) this._insert(db, "leases", ["lease_ref","attempt_ref","payload_json"], [value.leaseRef, value.attemptRef, json(value)]);
    for (const value of Object.values(state.observations || {})) this._insert(db, "observations", ["observation_ref","attempt_ref","payload_json"], [value.observationRef || value.cancellationRef, value.attemptRef || null, json(value)]);
    for (const value of Object.values(state.observations || {})) if (value.cancellationRef) this._insert(db, "cancellations", ["cancellation_ref","attempt_ref","payload_json"], [value.cancellationRef, value.attemptRef, json(value)]);
    for (const value of Object.values(state.raw || {})) this._insert(db, "raw", ["raw_ref","attempt_ref","payload_json"], [value.rawRef, value.attemptRef, json(value)]);
    for (const value of Object.values(state.microresults || {})) this._insert(db, "microresults", ["microresult_ref","attempt_ref","cell_ref","payload_json"], [value.microresultRef, value.attemptRef, value.cellRef, json(value)]);
    for (const value of Object.values(state.admissions || {})) this._insert(db, "admissions", ["raw_ref","microresult_ref","attempt_ref","payload_json"], [value.rawRef, value.microresultRef, value.attemptRef, json(value)]);
    for (const value of Object.values(state.candidates || {})) this._insert(db, "candidates", ["candidate_ref","attempt_ref","payload_json"], [value.candidateRef, value.attemptRef, json(value)]);
    for (const value of Object.values(state.assessments || {})) { this._insert(db, "assessments", ["assessment_ref","payload_json"], [value.assessmentRef, json(value)]); for (const ref of value.microresultRefs || []) this._insert(db, "assessment_members", ["assessment_ref","microresult_ref"], [value.assessmentRef, ref]); }
    for (const value of Object.values(state.attestations || {})) { this._insert(db, "attestations", ["attestation_ref","assessment_ref","payload_json"], [value.attestationRef, value.independenceRef, json(value)]); for (const ref of value.microresultRefs || []) this._insert(db, "attestation_members", ["attestation_ref","microresult_ref"], [value.attestationRef, ref]); }
    for (const value of Object.values(state.evaluations || {})) { this._insert(db, "evaluations", ["evaluation_ref","cell_ref","payload_json"], [value.evaluationRef, value.cellRef, json(value)]); for (const ref of value.attestationRefs || []) this._insert(db, "evaluation_attestations", ["evaluation_ref","attestation_ref"], [value.evaluationRef, ref]); }
    for (const value of Object.values(state.coverages || {})) this._insert(db, "coverages", ["coverage_ref","plan_ref","payload_json"], [value.coverageReceiptRef, value.planRef, json(value)]);
    for (const value of Object.values(state.dispositions || {})) this._insert(db, "dispositions", ["disposition_ref","plan_ref","coverage_ref","payload_json"], [value.dispositionRef, value.planRef, value.coverageReceiptRef, json(value)]);
    for (const value of Object.values(state.cas || {})) this._insert(db, "cas", ["artifact_ref","object_ref","plan_ref","job_ref","payload_json"], [value.artifactRef, value.objectRef, value.planRef || null, value.jobRef || null, json(value)]);
    for (const value of Object.values(state.seals || {})) { this._insert(db, "seals", ["seal_ref","plan_ref","coverage_ref","disposition_ref","payload_json"], [value.resultSealRef, value.planRef, value.coverageReceiptRef, value.dispositionRef, json(value)]); for (const ref of value.artifactRefs || []) this._insert(db, "seal_artifacts", ["seal_ref","artifact_ref"], [value.resultSealRef, ref]); }
    for (const value of Object.values(state.accounting || {})) this._insert(db, "accounting", ["attempt_ref","payload_json"], [value.attemptRef, json(value)]);
  }
  verifyState(state) {
    const integrity = this.db.prepare("PRAGMA integrity_check").all(); if (!integrity.length || integrity.some((row) => Object.values(row)[0] !== "ok")) dss02Fail("DSS03_SQLITE_INTEGRITY_FAILURE");
    if (this.db.prepare("PRAGMA foreign_key_check").all().length) dss02Fail("DSS03_SQLITE_FOREIGN_KEY_FAILURE");
    const snapshot = this.db.prepare("SELECT payload_digest,payload_json FROM dss03_snapshot WHERE singleton=1").get(); if (snapshot && (snapshot.payload_digest !== snapshotDigest(state) || snapshot.payload_json !== json(state))) dss02Fail("DSS03_SQLITE_STATE_DIVERGENCE");
    if (snapshot) {
      const expected = this._expectedPopulationRows(state);
      for (const [table, rows] of Object.entries(expected)) {
        const actual = this.db.prepare(`SELECT * FROM dss03_${table}`).all();
        if (actual.length !== rows.length) dss02Fail("DSS03_SQLITE_POPULATION_RECONCILIATION", table);
        const memberColumns = { assessment_members: [["assessment_ref", "assessmentRef"], ["microresult_ref", "microresultRef"]], attestation_members: [["attestation_ref", "attestationRef"], ["microresult_ref", "microresultRef"]], evaluation_attestations: [["evaluation_ref", "evaluationRef"], ["attestation_ref", "attestationRef"]], seal_artifacts: [["seal_ref", "sealRef"], ["artifact_ref", "artifactRef"]] };
        const actualPayloads = memberColumns[table]
          ? actual.map((row) => JSON.stringify(Object.fromEntries(memberColumns[table].map(([column, key]) => [key, row[column]])))).sort()
          : actual.map((row) => row.payload_json).sort();
        const expectedPayloads = rows.map((row) => row.payload_json).sort();
        if (actualPayloads.some((value, index) => value !== expectedPayloads[index])) dss02Fail("DSS03_SQLITE_POPULATION_RECONCILIATION", table);
      }
    }
    const eventRows = this.db.prepare("SELECT * FROM dss03_events ORDER BY event_sequence"); const rows = eventRows.all(); const stateEvents = state.events || []; if (rows.length !== stateEvents.length) dss02Fail("DSS03_SQLITE_EVENT_RECONCILIATION"); let prior = null; for (let index = 0; index < rows.length; index += 1) { const row = rows[index]; const expected = stateEvents[index]; if (row.event_sequence !== index + 1 || row.event_digest !== expected.eventDigest || row.prior_digest !== (expected.priorDigest || null) || row.payload_json !== json(expected) || !this._verifyTag(row.custody_key_revision_ref, row.event_digest, row.auth_tag)) dss02Fail("DSS03_SQLITE_EVENT_AUTH_INVALID"); const unsigned = parseJsonStrict(row.payload_json); delete unsigned.eventDigest; if (digestObject("DirectSemanticService.Dss03ExecutionEvent.v1", unsigned) !== row.event_digest || row.prior_digest !== prior) dss02Fail("DSS03_SQLITE_EVENT_AUTH_INVALID"); prior = row.event_digest; }
    return true;
  }
  _expectedPopulationRows(state) {
    const rows = Object.fromEntries(POPULATIONS.map((table) => [table, []]));
    const add = (table, value) => rows[table].push({ payload_json: json(value) });
    if (state.generation) add("generations", state.generation);
    if (state.fixture) add("fixtures", state.fixture);
    for (const value of Object.values(state.handoffs || {})) add("handoffs", value);
    for (const value of Object.values(state.plans || {})) add("plans", value);
    for (const value of Object.values(state.cells || {})) add("cells", value);
    for (const value of Object.values(state.cells || {})) if (value.terminalWitness) add("witnesses", value.terminalWitness);
    for (const value of Object.values(state.capsules || {})) add("capsules", value);
    for (const value of Object.values(state.assurances || {})) add("assurances", value);
    for (const value of Object.values(state.attempts || {})) add("attempts", value);
    for (const value of Object.values(state.leases || {})) add("leases", value);
    for (const value of Object.values(state.observations || {})) add("observations", value);
    for (const value of Object.values(state.observations || {})) if (value.cancellationRef) add("cancellations", value);
    for (const value of Object.values(state.raw || {})) add("raw", value);
    for (const value of Object.values(state.admissions || {})) add("admissions", value);
    for (const value of Object.values(state.microresults || {})) add("microresults", value);
    for (const value of Object.values(state.candidates || {})) add("candidates", value);
    for (const value of Object.values(state.assessments || {})) { add("assessments", value); for (const ref of value.microresultRefs || []) rows.assessment_members.push({ payload_json: JSON.stringify({ assessmentRef: value.assessmentRef, microresultRef: ref }) }); }
    for (const value of Object.values(state.attestations || {})) { add("attestations", value); for (const ref of value.microresultRefs || []) rows.attestation_members.push({ payload_json: JSON.stringify({ attestationRef: value.attestationRef, microresultRef: ref }) }); }
    for (const value of Object.values(state.evaluations || {})) { add("evaluations", value); for (const ref of value.attestationRefs || []) rows.evaluation_attestations.push({ payload_json: JSON.stringify({ evaluationRef: value.evaluationRef, attestationRef: ref }) }); }
    for (const value of Object.values(state.coverages || {})) add("coverages", value);
    for (const value of Object.values(state.dispositions || {})) add("dispositions", value);
    for (const value of Object.values(state.seals || {})) { add("seals", value); for (const ref of value.artifactRefs || []) rows.seal_artifacts.push({ payload_json: JSON.stringify({ sealRef: value.resultSealRef, artifactRef: ref }) }); }
    for (const value of Object.values(state.accounting || {})) add("accounting", value);
    for (const value of Object.values(state.cas || {})) add("cas", value);
    return rows;
  }
  close() { if (this.db) { this.db.close(); this.db = null; } if (this.lockDb) { try { this.lockDb.exec("ROLLBACK"); } catch (_) {} try { this.lockDb.close(); } catch (_) {} this.lockDb = null; } }
}

module.exports = { Dss03SqliteStore, DSS03_SQLITE_SCHEMA, DSS03_SQLITE_MIGRATION };
