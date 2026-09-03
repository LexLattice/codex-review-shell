"use strict";

/*
 * Durable storage boundary for DSS-0.4.  The service deliberately keeps its
 * domain reducers in dss04.js; this class only provides an authenticated,
 * transactional JSON state and an append-only event chain.  The separation is
 * useful in tests and, more importantly, prevents a projection from becoming
 * the authority for a later operation.
 */
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const { canonicalJson, digestObject, ensureDirectory, atomicWrite, parseJsonStrict, dss02Fail } = require("./dss02-common");

const SCHEMA = "direct_semantic_service_dss04_sqlite@1";
const MIGRATION = 1;
// The JSON state is the authenticated representation of every generation-8
// carrier.  Keep empty populations durable too: their absence is not
// equivalent to an empty, enumerated population during recovery.
const TABLES = ["pins", "generations", "registry_revisions", "snapshot_receipts", "snapshot_artifacts", "evidence_runtimes", "sealed_results", "compilation_requests", "idempotency_bindings", "allocations", "leases", "observations", "raw_compiler_outputs", "output_bundles", "route_sets", "materialization_plans", "closed_evidence_pages", "page_completeness_receipts", "page_sufficiency_receipts", "known_insufficiency_remands", "page_fault_candidates", "novel_edge_candidates", "candidate_validation_records", "materialization_batch_seals", "derived_heads", "accounting", "recovery_dispositions", "validator_revisions", "events"];

function tag(key, value) { return `sha256:${crypto.createHmac("sha256", key).update(value).digest("hex")}`; }
function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
function stateDigest(value) { return digestObject("DirectSemanticService.Dss04.State.v1", value); }

class Dss04SqliteStore {
  constructor({ root, custodyKey, now, failBeforeCommit = false } = {}) {
    if (!root) dss02Fail("DSS04_SQLITE_ROOT_REQUIRED");
    this.root = path.resolve(root); this.dbPath = path.join(this.root, "direct-semantic-dss04.sqlite"); this.failBeforeCommit = failBeforeCommit;
    this.keyPath = path.join(this.root, "dss04-custody.key"); this.now = now;
    ensureDirectory(this.root);
    this.key = custodyKey ? Buffer.from(custodyKey) : this._loadKey();
    if (this.key.length !== 32) dss02Fail("DSS04_SQLITE_KEY_INVALID");
    this.lockDb = new DatabaseSync(path.join(this.root, "direct-semantic-dss04.writer-lock.sqlite"));
    try { this.lockDb.exec("PRAGMA busy_timeout=0; BEGIN EXCLUSIVE;"); } catch (_) { this.lockDb.close(); dss02Fail("DSS04_SQLITE_WRITER_LOCKED"); }
    try { this.db = new DatabaseSync(this.dbPath); this.db.exec("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;"); this._migrate(); }
    catch (error) { this.close(); throw error; }
  }
  _loadKey() { if (fs.existsSync(this.keyPath)) { const stat = fs.lstatSync(this.keyPath); if (!stat.isFile() || stat.isSymbolicLink()) dss02Fail("DSS04_SQLITE_KEY_INVALID"); const key = fs.readFileSync(this.keyPath); if (key.length !== 32) dss02Fail("DSS04_SQLITE_KEY_INVALID"); return key; } const key = crypto.randomBytes(32); atomicWrite(this.keyPath, key, 0o600); return key; }
  clock() { const value = typeof this.now === "function" ? this.now() : this.now; return (value ? new Date(value) : new Date()).toISOString(); }
  _migrate() {
    this.db.exec("CREATE TABLE IF NOT EXISTS dss04_schema_migrations(version INTEGER PRIMARY KEY NOT NULL, checksum TEXT NOT NULL, applied_at TEXT NOT NULL);");
    const sql = `CREATE TABLE IF NOT EXISTS dss04_state(singleton INTEGER PRIMARY KEY CHECK(singleton=1), payload_json TEXT NOT NULL, payload_digest TEXT NOT NULL, auth_tag TEXT NOT NULL); CREATE TABLE IF NOT EXISTS dss04_objects(kind TEXT NOT NULL, object_ref TEXT NOT NULL, payload_json TEXT NOT NULL, payload_digest TEXT NOT NULL, auth_tag TEXT NOT NULL, PRIMARY KEY(kind,object_ref)); CREATE TABLE IF NOT EXISTS dss04_events(sequence INTEGER PRIMARY KEY NOT NULL, event_digest TEXT NOT NULL UNIQUE, prior_digest TEXT, payload_json TEXT NOT NULL, auth_tag TEXT NOT NULL);`;
    const checksum = digestObject("DirectSemanticService.Dss04.SqlSchema.v1", { schema: SCHEMA, migration: MIGRATION, sql });
    const rows = this.db.prepare("SELECT version,checksum FROM dss04_schema_migrations ORDER BY version").all();
    if (rows.some((row) => row.version !== MIGRATION || row.checksum !== checksum)) dss02Fail("DSS04_SQLITE_MIGRATION_MISMATCH");
    if (!rows.length) { this.db.exec("BEGIN IMMEDIATE"); try { this.db.exec(sql); this.db.prepare("INSERT INTO dss04_schema_migrations VALUES(?,?,?)").run(MIGRATION, checksum, this.clock()); this.db.exec("COMMIT"); } catch (error) { try { this.db.exec("ROLLBACK"); } catch (_) {} throw error; } }
  }
  _tx(fn) { this.db.exec("BEGIN IMMEDIATE"); try { const value = fn(this.db); if (this.failBeforeCommit) { this.failBeforeCommit = false; dss02Fail("DSS04_SQLITE_INJECTED_FAILURE"); } this.db.exec("COMMIT"); return value; } catch (error) { try { this.db.exec("ROLLBACK"); } catch (_) {} throw error; } }
  _auth(payloadDigest) { return tag(this.key, payloadDigest); }
  _verify(payloadDigest, authTag) { return this._auth(payloadDigest) === authTag; }
  read() {
    const row = this.db.prepare("SELECT payload_json,payload_digest,auth_tag FROM dss04_state WHERE singleton=1").get();
    if (!row) return null;
    if (row.payload_digest !== stateDigest(JSON.parse(row.payload_json)) || !this._verify(row.payload_digest, row.auth_tag)) dss02Fail("DSS04_SQLITE_STATE_AUTH_INVALID");
    // Generation 8 persists the exact normalized 1,518-route population and
    // its authenticated derived carriers.  Keep the generic DSS-0.2 parser
    // ceiling intact while allowing this bounded DSS-0.4 state envelope.
    return clone(parseJsonStrict(row.payload_json, { maximumBytes: 64 * 1024 * 1024 }));
  }
  write(state) {
    const payload = canonicalJson(state); const digest = stateDigest(state); const auth = this._auth(digest);
    this._tx((db) => { db.exec("DELETE FROM dss04_objects; DELETE FROM dss04_events; DELETE FROM dss04_state;");
      const collections = { pins: state.pins, generations: state.generations, registry_revisions: state.registryRevisions, snapshot_receipts: state.snapshotReceipts, snapshot_artifacts: state.snapshotArtifacts, evidence_runtimes: state.evidenceRuntimes, sealed_results: state.sealedResults, compilation_requests: state.compilationRequests, idempotency_bindings: state.idempotencyBindings, allocations: state.allocations, leases: state.leases, observations: state.observations, raw_compiler_outputs: state.rawCompilerOutputs, output_bundles: state.outputBundles, route_sets: state.routeSets, materialization_plans: state.materializationPlans, closed_evidence_pages: state.closedEvidencePages, page_completeness_receipts: state.pageCompletenessReceipts, page_sufficiency_receipts: state.pageSufficiencyReceipts, known_insufficiency_remands: state.knownInsufficiencyRemands, page_fault_candidates: state.pageFaultCandidates, novel_edge_candidates: state.novelEdgeCandidates, candidate_validation_records: state.candidateValidationRecords, materialization_batch_seals: state.materializationBatchSeals, derived_heads: state.derivedHeads, accounting: state.accounting, recovery_dispositions: state.recoveryDispositions, validator_revisions: state.validatorRevisions };
      for (const [kind, values] of Object.entries(collections)) for (const [ref, object] of Object.entries(values || {})) { const text = canonicalJson(object); const digestValue = digestObject(`DirectSemanticService.Dss04.${kind}.v1`, object); const objectAuth = this._auth(digestValue); db.prepare("INSERT INTO dss04_objects VALUES(?,?,?,?,?)").run(kind, ref, text, digestValue, objectAuth); }
      for (const event of state.events || []) { const text = canonicalJson(event); db.prepare("INSERT INTO dss04_events VALUES(?,?,?,?,?)").run(event.sequence, event.eventDigest, event.priorDigest || null, text, this._auth(event.eventDigest)); }
      db.prepare("INSERT INTO dss04_state VALUES(1,?,?,?)").run(payload, digest, auth);
    });
  }
  close() { if (this.db) { try { this.db.close(); } catch (_) {} this.db = null; } if (this.lockDb) { try { this.lockDb.exec("ROLLBACK"); } catch (_) {} try { this.lockDb.close(); } catch (_) {} this.lockDb = null; } }
}

module.exports = { DSS04_SQLITE_SCHEMA: SCHEMA, Dss04SqliteStore };
