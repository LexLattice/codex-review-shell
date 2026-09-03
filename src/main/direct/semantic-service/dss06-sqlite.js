"use strict";

/*
 * DSS-0.6 durable custody.  The semantic service owns the state envelope and
 * event ledger; this adapter only provides an authenticated, crash-safe
 * transaction boundary.  Keeping the complete envelope in one row is
 * intentional: recovery can compare every derived population with the exact
 * authenticated source in one read.
 */
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { canonicalJson, digestObject, ensureDirectory, atomicWrite, parseJsonStrict, dss02Fail } = require("./dss02-common");

const DSS06_SQLITE_SCHEMA = "direct_semantic_service_dss06_sqlite@1";
const MIGRATION = 1;

function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
function stateDigest(value) { return digestObject("DirectSemanticService.Dss06.State.v1", value); }
function authTag(key, digest) { return crypto.createHmac("sha256", key).update(digest).digest("hex"); }

class Dss06SqliteStore {
  constructor({ root, custodyKey, now, failBeforeCommit = false } = {}) {
    if (!root) dss02Fail("DSS06_SQLITE_ROOT_REQUIRED");
    this.root = path.resolve(root);
    this.dbPath = path.join(this.root, "direct-semantic-dss06.sqlite");
    this.keyPath = path.join(this.root, "dss06-custody.key");
    this.now = now;
    this.failBeforeCommit = failBeforeCommit;
    ensureDirectory(this.root);
    this.key = custodyKey ? Buffer.from(custodyKey) : this._loadKey();
    if (this.key.length !== 32) dss02Fail("DSS06_SQLITE_KEY_INVALID");
    this.lockDb = new DatabaseSync(path.join(this.root, "direct-semantic-dss06.writer-lock.sqlite"));
    try { this.lockDb.exec("PRAGMA busy_timeout=0; BEGIN EXCLUSIVE;"); }
    catch (_) { try { this.lockDb.close(); } catch (__) {} dss02Fail("DSS06_SQLITE_WRITER_LOCKED"); }
    try {
      this.db = new DatabaseSync(this.dbPath);
      this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;");
      this._migrate();
    } catch (error) { this.close(); throw error; }
  }

  _loadKey() {
    if (fs.existsSync(this.keyPath)) {
      const stat = fs.lstatSync(this.keyPath);
      if (!stat.isFile() || stat.isSymbolicLink()) dss02Fail("DSS06_SQLITE_KEY_INVALID");
      const key = fs.readFileSync(this.keyPath);
      if (key.length !== 32) dss02Fail("DSS06_SQLITE_KEY_INVALID");
      return key;
    }
    const key = crypto.randomBytes(32);
    atomicWrite(this.keyPath, key, 0o600);
    return key;
  }

  clock() {
    const value = typeof this.now === "function" ? this.now() : this.now;
    return (value ? new Date(value) : new Date()).toISOString();
  }

  _migrate() {
    this.db.exec("CREATE TABLE IF NOT EXISTS dss06_schema_migrations(version INTEGER PRIMARY KEY NOT NULL, checksum TEXT NOT NULL, applied_at TEXT NOT NULL);");
    const sql = "CREATE TABLE IF NOT EXISTS dss06_state(singleton INTEGER PRIMARY KEY CHECK(singleton=1), payload_json TEXT NOT NULL, payload_digest TEXT NOT NULL, auth_tag TEXT NOT NULL); CREATE TABLE IF NOT EXISTS dss06_objects(kind TEXT NOT NULL, object_ref TEXT NOT NULL, payload_json TEXT NOT NULL, payload_digest TEXT NOT NULL, auth_tag TEXT NOT NULL, PRIMARY KEY(kind,object_ref)); CREATE TABLE IF NOT EXISTS dss06_events(sequence INTEGER PRIMARY KEY NOT NULL, event_digest TEXT NOT NULL UNIQUE, prior_digest TEXT, payload_json TEXT NOT NULL, auth_tag TEXT NOT NULL);";
    const checksum = digestObject("DirectSemanticService.Dss06.SqlSchema.v1", { schema: DSS06_SQLITE_SCHEMA, migration: MIGRATION, sql });
    const rows = this.db.prepare("SELECT version,checksum FROM dss06_schema_migrations ORDER BY version").all();
    if (rows.some((row) => row.version !== MIGRATION || row.checksum !== checksum)) dss02Fail("DSS06_SQLITE_MIGRATION_MISMATCH");
    if (!rows.length) {
      this.db.exec("BEGIN IMMEDIATE");
      try { this.db.exec(sql); this.db.prepare("INSERT INTO dss06_schema_migrations VALUES(?,?,?)").run(MIGRATION, checksum, this.clock()); this.db.exec("COMMIT"); }
      catch (error) { try { this.db.exec("ROLLBACK"); } catch (_) {} throw error; }
    }
  }

  _verify(digest, tag) { return authTag(this.key, digest) === tag; }

  _verifyDurableTables(state) {
    const collections = {
      registries: state.registries, health: state.health, packages: state.packages,
      jobs: state.jobs, attempts: state.attempts, decisions: state.decisions,
      dispositions: state.dispositions, lineages: state.lineages, capabilities: state.capabilities,
      subscriptions: state.subscriptions, offers: state.offers, acknowledgments: state.acknowledgments,
      cursors: state.cursors, wakeups: state.wakeups, recoveryDispositions: state.recoveryDispositions,
      operationInputs: state.operationInputs,
    };
    const expectedObjects = new Map();
    for (const [kind, values] of Object.entries(collections)) {
      for (const [ref, object] of Object.entries(values || {})) expectedObjects.set(`${kind}\u0000${ref}`, { kind, ref, object });
    }
    const objectRows = this.db.prepare("SELECT kind,object_ref,payload_json,payload_digest,auth_tag FROM dss06_objects ORDER BY kind,object_ref").all();
    if (objectRows.length !== expectedObjects.size) dss02Fail("DSS06_SQLITE_OBJECT_AUTH_INVALID");
    for (const row of objectRows) {
      const expected = expectedObjects.get(`${row.kind}\u0000${row.object_ref}`);
      if (!expected) dss02Fail("DSS06_SQLITE_OBJECT_AUTH_INVALID");
      let object;
      try { object = parseJsonStrict(row.payload_json, { maximumBytes: 64 * 1024 * 1024 }); } catch (_) { dss02Fail("DSS06_SQLITE_OBJECT_AUTH_INVALID"); }
      const objectDigest = digestObject(`DirectSemanticService.Dss06.${row.kind}.v1`, object);
      if (canonicalJson(object) !== canonicalJson(expected.object) || row.payload_digest !== objectDigest || !this._verify(row.payload_digest, row.auth_tag)) dss02Fail("DSS06_SQLITE_OBJECT_AUTH_INVALID");
    }
    const eventRows = this.db.prepare("SELECT sequence,event_digest,prior_digest,payload_json,auth_tag FROM dss06_events ORDER BY sequence").all();
    if (eventRows.length !== (state.events || []).length) dss02Fail("DSS06_SQLITE_EVENT_AUTH_INVALID");
    for (let index = 0; index < eventRows.length; index += 1) {
      const row = eventRows[index]; const expected = state.events[index];
      let event;
      try { event = parseJsonStrict(row.payload_json, { maximumBytes: 64 * 1024 * 1024 }); } catch (_) { dss02Fail("DSS06_SQLITE_EVENT_AUTH_INVALID"); }
      if (Number(row.sequence) !== expected.sequence || row.event_digest !== expected.eventDigest || (row.prior_digest || null) !== (expected.priorDigest || null) || canonicalJson(event) !== canonicalJson(expected) || !this._verify(row.event_digest, row.auth_tag)) dss02Fail("DSS06_SQLITE_EVENT_AUTH_INVALID");
    }
  }

  read() {
    const row = this.db.prepare("SELECT payload_json,payload_digest,auth_tag FROM dss06_state WHERE singleton=1").get();
    if (!row) return null;
    let value;
    try { value = JSON.parse(row.payload_json); } catch (_) { dss02Fail("DSS06_SQLITE_STATE_AUTH_INVALID"); }
    if (row.payload_digest !== stateDigest(value) || !this._verify(row.payload_digest, row.auth_tag)) dss02Fail("DSS06_SQLITE_STATE_AUTH_INVALID");
    this._verifyDurableTables(value);
    return clone(parseJsonStrict(row.payload_json, { maximumBytes: 64 * 1024 * 1024 }));
  }

  write(state) {
    const payload = canonicalJson(state);
    const digest = stateDigest(state);
    const tag = authTag(this.key, digest);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (this.failBeforeCommit) { this.failBeforeCommit = false; dss02Fail("DSS06_SQLITE_INJECTED_FAILURE"); }
      this.db.exec("DELETE FROM dss06_objects; DELETE FROM dss06_events; DELETE FROM dss06_state;");
      const collections = {
        registries: state.registries, health: state.health, packages: state.packages,
        jobs: state.jobs, attempts: state.attempts, decisions: state.decisions,
        dispositions: state.dispositions, lineages: state.lineages, capabilities: state.capabilities,
        subscriptions: state.subscriptions, offers: state.offers, acknowledgments: state.acknowledgments,
        cursors: state.cursors, wakeups: state.wakeups, recoveryDispositions: state.recoveryDispositions,
        operationInputs: state.operationInputs,
      };
      for (const [kind, values] of Object.entries(collections)) {
        for (const [ref, object] of Object.entries(values || {})) {
          const text = canonicalJson(object);
          const objectDigest = digestObject(`DirectSemanticService.Dss06.${kind}.v1`, object);
          this.db.prepare("INSERT INTO dss06_objects VALUES(?,?,?,?,?)").run(kind, ref, text, objectDigest, authTag(this.key, objectDigest));
        }
      }
      for (const event of state.events || []) {
        const text = canonicalJson(event);
        this.db.prepare("INSERT INTO dss06_events VALUES(?,?,?,?,?)").run(event.sequence, event.eventDigest, event.priorDigest || null, text, authTag(this.key, event.eventDigest));
      }
      this.db.prepare("INSERT INTO dss06_state VALUES(1,?,?,?)").run(payload, digest, tag);
      this.db.exec("COMMIT");
    } catch (error) { try { this.db.exec("ROLLBACK"); } catch (_) {} throw error; }
  }

  close() {
    if (this.db) { try { this.db.close(); } catch (_) {} this.db = null; }
    if (this.lockDb) { try { this.lockDb.exec("ROLLBACK"); } catch (_) {} try { this.lockDb.close(); } catch (_) {} this.lockDb = null; }
  }
}

module.exports = { DSS06_SQLITE_SCHEMA, Dss06SqliteStore, dss06StateDigest: stateDigest };
