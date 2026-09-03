"use strict";

/*
 * DSS-0.5 custody store.  The store is intentionally smaller than the
 * predecessor's compilation store: one authenticated state envelope and one
 * append-only event table are enough for this page-confined tranche.  The
 * service, rather than this adapter, owns all lifecycle decisions.
 */
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { canonicalJson, digestObject, ensureDirectory, atomicWrite, parseJsonStrict, dss02Fail } = require("./dss02-common");

const DSS05_SQLITE_SCHEMA = "direct_semantic_service_dss05_sqlite@1";
const MIGRATION = 1;

function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
function stateDigest(value) { return digestObject("DirectSemanticService.Dss05.State.v1", value); }
function authTag(key, digest) { return crypto.createHmac("sha256", key).update(digest).digest("hex"); }

class Dss05SqliteStore {
  constructor({ root, custodyKey, now, failBeforeCommit = false } = {}) {
    if (!root) dss02Fail("DSS05_SQLITE_ROOT_REQUIRED");
    this.root = path.resolve(root);
    this.dbPath = path.join(this.root, "direct-semantic-dss05.sqlite");
    this.keyPath = path.join(this.root, "dss05-custody.key");
    this.now = now;
    this.failBeforeCommit = failBeforeCommit;
    ensureDirectory(this.root);
    this.key = custodyKey ? Buffer.from(custodyKey) : this._loadKey();
    if (this.key.length !== 32) dss02Fail("DSS05_SQLITE_KEY_INVALID");
    this.lockDb = new DatabaseSync(path.join(this.root, "direct-semantic-dss05.writer-lock.sqlite"));
    try { this.lockDb.exec("PRAGMA busy_timeout=0; BEGIN EXCLUSIVE;"); }
    catch (_) { try { this.lockDb.close(); } catch (__) {} dss02Fail("DSS05_SQLITE_WRITER_LOCKED"); }
    try {
      this.db = new DatabaseSync(this.dbPath);
      this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;");
      this._migrate();
    } catch (error) { this.close(); throw error; }
  }

  _loadKey() {
    if (fs.existsSync(this.keyPath)) {
      const stat = fs.lstatSync(this.keyPath);
      if (!stat.isFile() || stat.isSymbolicLink()) dss02Fail("DSS05_SQLITE_KEY_INVALID");
      const key = fs.readFileSync(this.keyPath);
      if (key.length !== 32) dss02Fail("DSS05_SQLITE_KEY_INVALID");
      return key;
    }
    const key = crypto.randomBytes(32);
    atomicWrite(this.keyPath, key, 0o600);
    return key;
  }

  clock() { const value = typeof this.now === "function" ? this.now() : this.now; return (value ? new Date(value) : new Date()).toISOString(); }

  _migrate() {
    this.db.exec("CREATE TABLE IF NOT EXISTS dss05_schema_migrations(version INTEGER PRIMARY KEY NOT NULL, checksum TEXT NOT NULL, applied_at TEXT NOT NULL);");
    const sql = "CREATE TABLE IF NOT EXISTS dss05_state(singleton INTEGER PRIMARY KEY CHECK(singleton=1), payload_json TEXT NOT NULL, payload_digest TEXT NOT NULL, auth_tag TEXT NOT NULL); CREATE TABLE IF NOT EXISTS dss05_events(sequence INTEGER PRIMARY KEY NOT NULL, event_digest TEXT NOT NULL UNIQUE, prior_digest TEXT, payload_json TEXT NOT NULL, auth_tag TEXT NOT NULL);";
    const checksum = digestObject("DirectSemanticService.Dss05.SqlSchema.v1", { schema: DSS05_SQLITE_SCHEMA, migration: MIGRATION, sql });
    const rows = this.db.prepare("SELECT version,checksum FROM dss05_schema_migrations ORDER BY version").all();
    if (rows.some((row) => row.version !== MIGRATION || row.checksum !== checksum)) dss02Fail("DSS05_SQLITE_MIGRATION_MISMATCH");
    if (!rows.length) {
      this.db.exec("BEGIN IMMEDIATE");
      try { this.db.exec(sql); this.db.prepare("INSERT INTO dss05_schema_migrations VALUES(?,?,?)").run(MIGRATION, checksum, this.clock()); this.db.exec("COMMIT"); }
      catch (error) { try { this.db.exec("ROLLBACK"); } catch (_) {} throw error; }
    }
  }

  _verify(digest, tag) { return authTag(this.key, digest) === tag; }

  read() {
    const row = this.db.prepare("SELECT payload_json,payload_digest,auth_tag FROM dss05_state WHERE singleton=1").get();
    if (!row) return null;
    let value;
    try { value = JSON.parse(row.payload_json); } catch (_) { dss02Fail("DSS05_SQLITE_STATE_AUTH_INVALID"); }
    if (row.payload_digest !== stateDigest(value) || !this._verify(row.payload_digest, row.auth_tag)) dss02Fail("DSS05_SQLITE_STATE_AUTH_INVALID");
    return clone(parseJsonStrict(row.payload_json, { maximumBytes: 64 * 1024 * 1024 }));
  }

  write(state) {
    const payload = canonicalJson(state);
    const digest = stateDigest(state);
    const tag = authTag(this.key, digest);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (this.failBeforeCommit) { this.failBeforeCommit = false; dss02Fail("DSS05_SQLITE_INJECTED_FAILURE"); }
      this.db.exec("DELETE FROM dss05_state; DELETE FROM dss05_events;");
      for (const event of state.events || []) {
        this.db.prepare("INSERT INTO dss05_events VALUES(?,?,?,?,?)").run(event.sequence, event.eventDigest, event.priorDigest || null, canonicalJson(event), authTag(this.key, event.eventDigest));
      }
      this.db.prepare("INSERT INTO dss05_state VALUES(1,?,?,?)").run(payload, digest, tag);
      this.db.exec("COMMIT");
    } catch (error) { try { this.db.exec("ROLLBACK"); } catch (_) {} throw error; }
  }

  close() {
    if (this.db) { try { this.db.close(); } catch (_) {} this.db = null; }
    if (this.lockDb) { try { this.lockDb.exec("ROLLBACK"); } catch (_) {} try { this.lockDb.close(); } catch (_) {} this.lockDb = null; }
  }
}

module.exports = { DSS05_SQLITE_SCHEMA, Dss05SqliteStore, dss05StateDigest: stateDigest };
