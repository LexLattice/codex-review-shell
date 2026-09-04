"use strict";

/*
 * The DSS-0.2 store is intentionally the only place that opens SQLite.  The
 * daemon owns one instance and all clients speak the protocol instead of
 * reaching around it.  The schema is compact, but each durable population
 * named by the contract has its own table so recovery can detect orphaned or
 * held-back rows instead of hiding them in a generic blob.
 */

const fs = require("node:fs");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const {
  DSS02_SCHEMA,
  Dss02Error,
  dss02Fail,
  deriveProfilePaths,
  ensureDirectory,
  fsyncDirectory,
  isoNow,
  parseStoredJson,
  canonicalJson,
  digestObject,
  randomRef,
  checkedInteger,
} = require("./dss02-common");

const MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS dss_meta (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY NOT NULL,
  checksum TEXT NOT NULL,
  applied_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS daemon_generations (
  generation_ref TEXT PRIMARY KEY NOT NULL,
  profile_ref TEXT NOT NULL,
  schema_revision TEXT NOT NULL,
  schema_checksum TEXT NOT NULL,
  opened_at TEXT NOT NULL,
  status TEXT NOT NULL,
  recovery_inventory_digest TEXT,
  UNIQUE(profile_ref, generation_ref)
);
CREATE TABLE IF NOT EXISTS owner_roots (
  root_ref TEXT PRIMARY KEY NOT NULL,
  profile_ref TEXT NOT NULL UNIQUE,
  owner_root_fingerprint TEXT NOT NULL,
  owner_root_algorithm TEXT NOT NULL,
  installation_configuration_revision TEXT NOT NULL,
  root_pin_digest TEXT NOT NULL,
  installation_event_digest TEXT NOT NULL,
  status TEXT NOT NULL,
  observed_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS bootstrap_commitments (
  commitment_ref TEXT PRIMARY KEY NOT NULL,
  profile_ref TEXT NOT NULL UNIQUE,
  payload_json TEXT NOT NULL,
  commitment_digest TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  maximum_attempts INTEGER NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS bootstrap_attempts (
  attempt_ref TEXT PRIMARY KEY NOT NULL,
  commitment_ref TEXT NOT NULL UNIQUE,
  payload_json TEXT NOT NULL,
  attempt_digest TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL,
  claimed_at TEXT NOT NULL,
  outcome_code TEXT
);
CREATE TABLE IF NOT EXISTS bootstrap_authorizations (
  authorization_ref TEXT PRIMARY KEY NOT NULL,
  commitment_ref TEXT NOT NULL UNIQUE,
  attempt_ref TEXT NOT NULL UNIQUE,
  payload_json TEXT NOT NULL,
  authorization_digest TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL,
  authorized_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS principals (
  principal_ref TEXT PRIMARY KEY NOT NULL,
  principal_id TEXT NOT NULL UNIQUE,
  lineage_revision TEXT NOT NULL UNIQUE,
  issuer_revision TEXT NOT NULL,
  principal_class TEXT NOT NULL,
  subject_ref TEXT NOT NULL,
  project_scopes_json TEXT NOT NULL,
  purpose_scopes_json TEXT NOT NULL,
  state TEXT NOT NULL,
  created_at TEXT NOT NULL,
  superseded_by TEXT
);
CREATE TABLE IF NOT EXISTS verifiers (
  verifier_ref TEXT PRIMARY KEY NOT NULL,
  verifier_revision TEXT NOT NULL UNIQUE,
  principal_ref TEXT NOT NULL,
  principal_lineage_revision TEXT NOT NULL,
  issuer_revision TEXT NOT NULL,
  public_key TEXT NOT NULL,
  public_key_fingerprint TEXT NOT NULL,
  operations_json TEXT NOT NULL,
  purpose_scopes_json TEXT NOT NULL,
  object_scopes_json TEXT NOT NULL,
  registry_revisions_json TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revocation_epoch INTEGER NOT NULL,
  state TEXT NOT NULL,
  superseded_by TEXT
);
CREATE TABLE IF NOT EXISTS registry_revisions (
  revision_ref TEXT PRIMARY KEY NOT NULL,
  registry_digest TEXT NOT NULL,
  state TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS authorization_challenges (
  challenge_ref TEXT PRIMARY KEY NOT NULL,
  profile_ref TEXT NOT NULL,
  protocol_revision TEXT NOT NULL,
  connection_ref TEXT NOT NULL,
  daemon_generation TEXT NOT NULL,
  nonce TEXT NOT NULL,
  challenge_digest TEXT NOT NULL UNIQUE,
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  state TEXT NOT NULL,
  state_revision INTEGER NOT NULL,
  consumed_at TEXT
);
CREATE TABLE IF NOT EXISTS authorization_receipts (
  receipt_ref TEXT PRIMARY KEY NOT NULL,
  challenge_ref TEXT NOT NULL,
  proof_digest TEXT NOT NULL,
  request_digest TEXT NOT NULL,
  operation TEXT NOT NULL,
  principal_ref TEXT,
  verifier_ref TEXT,
  decision TEXT NOT NULL,
  reason_code TEXT,
  authorized_at TEXT NOT NULL,
  challenge_state_revision INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS idempotency_bindings (
  principal_ref TEXT NOT NULL,
  operation TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_digest TEXT NOT NULL,
  job_ref TEXT NOT NULL,
  admission_event_digest TEXT NOT NULL,
  principal_lineage_revision TEXT NOT NULL,
  verifier_revision TEXT NOT NULL,
  creation_global_sequence INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(principal_ref, operation, idempotency_key),
  UNIQUE(job_ref)
);
CREATE TABLE IF NOT EXISTS jobs (
  job_ref TEXT PRIMARY KEY NOT NULL,
  request_json TEXT NOT NULL,
  request_digest TEXT NOT NULL,
  principal_ref TEXT NOT NULL,
  verifier_ref TEXT NOT NULL,
  principal_lineage_revision TEXT NOT NULL,
  verifier_revision TEXT NOT NULL,
  operation TEXT NOT NULL,
  state TEXT NOT NULL,
  event_sequence INTEGER NOT NULL DEFAULT 0,
  event_digest TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  request_bytes INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS service_events (
  global_sequence INTEGER PRIMARY KEY NOT NULL,
  job_ref TEXT,
  job_sequence INTEGER,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  artifact_ref TEXT,
  prior_job_event_digest TEXT,
  prior_global_custody_digest TEXT,
  custody_key_revision_ref TEXT NOT NULL,
  event_digest TEXT NOT NULL UNIQUE,
  global_custody_digest TEXT NOT NULL UNIQUE,
  custody_tag TEXT NOT NULL,
  daemon_generation TEXT NOT NULL,
  recorded_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS job_heads (
  job_ref TEXT PRIMARY KEY NOT NULL,
  event_sequence INTEGER NOT NULL,
  event_digest TEXT,
  state TEXT NOT NULL,
  reducer_revision TEXT NOT NULL,
  projection_digest TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS artifacts (
  artifact_ref TEXT PRIMARY KEY NOT NULL,
  digest TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  byte_length INTEGER NOT NULL,
  state TEXT NOT NULL,
  created_at TEXT NOT NULL,
  reference_count INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS quarantine_artifacts (
  quarantine_ref TEXT PRIMARY KEY NOT NULL,
  digest TEXT NOT NULL,
  byte_length INTEGER NOT NULL,
  relative_path TEXT NOT NULL,
  diagnostic_code TEXT,
  state TEXT NOT NULL,
  revision INTEGER NOT NULL,
  captured_at TEXT NOT NULL,
  expires_at TEXT
);
CREATE TABLE IF NOT EXISTS custody_keys (
  custody_key_revision_ref TEXT PRIMARY KEY NOT NULL,
  key_fingerprint TEXT NOT NULL UNIQUE,
  predecessor_revision_ref TEXT,
  effective_after_global_sequence INTEGER NOT NULL,
  admitted_by_capability_ref TEXT NOT NULL,
  admitted_at TEXT NOT NULL,
  state TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS custody_rotations (
  rotation_ref TEXT PRIMARY KEY NOT NULL,
  prior_key_revision_ref TEXT NOT NULL,
  next_key_revision_ref TEXT NOT NULL,
  last_prior_key_global_custody_digest TEXT NOT NULL,
  prior_key_custody_tag TEXT NOT NULL,
  next_key_custody_tag TEXT NOT NULL,
  effective_after_global_sequence INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS leases (
  lease_ref TEXT PRIMARY KEY NOT NULL,
  subject_ref TEXT NOT NULL,
  operation_class TEXT NOT NULL,
  daemon_generation TEXT NOT NULL,
  fencing_token INTEGER NOT NULL,
  lease_revision INTEGER NOT NULL,
  state TEXT NOT NULL,
  acquired_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  released_at TEXT,
  disposition TEXT
);
CREATE TABLE IF NOT EXISTS capacity_observations (
  observation_ref TEXT PRIMARY KEY NOT NULL,
  policy_revision TEXT NOT NULL,
  open_jobs INTEGER NOT NULL,
  request_bytes INTEGER NOT NULL,
  retained_projection_bytes INTEGER NOT NULL,
  subscriptions INTEGER NOT NULL,
  outstanding_offers INTEGER NOT NULL,
  waiter_count INTEGER NOT NULL,
  limits_json TEXT NOT NULL,
  waiter_population_revision INTEGER NOT NULL,
  event_head INTEGER NOT NULL,
  posture TEXT NOT NULL,
  recorded_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS capacity_counters (
  singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
  open_jobs INTEGER NOT NULL,
  request_bytes INTEGER NOT NULL,
  retained_projection_bytes INTEGER NOT NULL,
  subscriptions INTEGER NOT NULL,
  outstanding_offers INTEGER NOT NULL,
  counter_event_head INTEGER NOT NULL,
  policy_revision TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS dispatch_boundaries (
  job_ref TEXT PRIMARY KEY NOT NULL,
  boundary_revision INTEGER NOT NULL,
  state TEXT NOT NULL,
  target_tranche_revision TEXT,
  daemon_generation TEXT,
  fencing_token INTEGER,
  handoff_event_digest TEXT,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS cancellation_decisions (
  cancellation_ref TEXT PRIMARY KEY NOT NULL,
  job_ref TEXT NOT NULL,
  request_digest TEXT NOT NULL,
  principal_ref TEXT NOT NULL,
  dispatch_boundary_revision INTEGER NOT NULL,
  job_event_head_digest TEXT,
  running_attempt_refs_json TEXT NOT NULL,
  state TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS subscriptions (
  subscription_ref TEXT PRIMARY KEY NOT NULL,
  job_ref TEXT NOT NULL,
  subscriber_principal_ref TEXT NOT NULL,
  read_verifier_revision TEXT NOT NULL,
  read_capability_ref TEXT NOT NULL,
  event_filter_json TEXT NOT NULL,
  projection_ref TEXT NOT NULL,
  starting_cursor INTEGER NOT NULL,
  current_cursor INTEGER NOT NULL,
  revision INTEGER NOT NULL,
  adapter_ref TEXT NOT NULL,
  state TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS delivery_offers (
  delivery_attempt_ref TEXT PRIMARY KEY NOT NULL,
  subscription_ref TEXT NOT NULL,
  capability_validation_receipt_ref TEXT NOT NULL,
  first_event_sequence INTEGER NOT NULL,
  last_event_sequence INTEGER NOT NULL,
  projection_digest TEXT NOT NULL,
  projection_artifact_ref TEXT,
  offered_at TEXT NOT NULL,
  acknowledgment_deadline TEXT NOT NULL,
  state TEXT NOT NULL,
  generation_revision TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS delivery_acknowledgments (
  acknowledgment_ref TEXT PRIMARY KEY NOT NULL,
  delivery_attempt_ref TEXT NOT NULL UNIQUE,
  subscriber_principal_ref TEXT NOT NULL,
  projection_digest TEXT NOT NULL,
  acknowledged_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS delivery_cursors (
  subscription_ref TEXT PRIMARY KEY NOT NULL,
  subscription_revision INTEGER NOT NULL,
  acknowledged_sequence INTEGER NOT NULL,
  acknowledgment_digest TEXT,
  global_event_head INTEGER NOT NULL,
  state TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS recovery_dispositions (
  disposition_ref TEXT PRIMARY KEY NOT NULL,
  daemon_generation TEXT NOT NULL,
  inventory_digest TEXT NOT NULL,
  population_digests_json TEXT NOT NULL,
  state TEXT NOT NULL,
  classifications_json TEXT NOT NULL,
  global_event_head INTEGER NOT NULL,
  recorded_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS service_events_job_idx ON service_events(job_ref, job_sequence);
CREATE INDEX IF NOT EXISTS auth_challenges_generation_idx ON authorization_challenges(daemon_generation, state);
CREATE INDEX IF NOT EXISTS leases_subject_idx ON leases(subject_ref, operation_class, state);
CREATE INDEX IF NOT EXISTS subscriptions_job_idx ON subscriptions(job_ref, state);
`;

const MIGRATION_CHECKSUM = `sha256:${crypto.createHash("sha256").update(MIGRATION_SQL).digest("hex")}`;

class Dss02Store {
  constructor(options = {}) {
    if (!options || typeof options !== "object") dss02Fail("DSS02_STORE_OPTIONS_INVALID");
    const allowed = new Set(["profileRoot", "profileRef", "now"]);
    for (const key of Object.keys(options)) if (!allowed.has(key)) dss02Fail("DSS02_STORE_OPTIONS_INVALID", key);
    this.profileRef = options.profileRef || "direct-profile";
    this.paths = deriveProfilePaths(options.profileRoot);
    this.now = options.now;
    this.db = null;
    this.lockFd = null;
    this.generation = null;
    this.ready = false;
    this._transaction = false;
  }

  clock() { return isoNow(typeof this.now === "function" ? this.now() : this.now); }

  acquireGenerationLock() {
    ensureDirectory(this.paths.profileRoot);
    try {
      this.lockFd = fs.openSync(this.paths.lock, "wx", 0o600);
      fs.writeFileSync(this.lockFd, `${process.pid}\n${this.clock()}\n`);
      fs.fsyncSync(this.lockFd);
      fsyncDirectory(this.paths.profileRoot);
    } catch (error) {
      if (this.lockFd !== null) { try { fs.closeSync(this.lockFd); } catch (_) {} this.lockFd = null; }
      if (error?.code !== "EEXIST") dss02Fail("DSS02_SECOND_WRITER", "profile generation lock is held");
      // A crashed daemon can leave the ownership marker behind. Reclaim it
      // only when its recorded PID is demonstrably dead; an unreadable or
      // live marker remains fail-closed and cannot admit a second writer.
      let ownerPid;
      try { ownerPid = Number(fs.readFileSync(this.paths.lock, "utf8").split(/\s+/)[0]); }
      catch (_) { dss02Fail("DSS02_SECOND_WRITER", "profile generation lock is held"); }
      if (!Number.isSafeInteger(ownerPid) || ownerPid <= 0) dss02Fail("DSS02_SECOND_WRITER", "profile generation lock is held");
      try {
        process.kill(ownerPid, 0);
        dss02Fail("DSS02_SECOND_WRITER", "profile generation lock is held");
      } catch (probeError) {
        if (probeError?.code !== "ESRCH") dss02Fail("DSS02_SECOND_WRITER", "profile generation lock is held");
      }
      try { fs.unlinkSync(this.paths.lock); fsyncDirectory(this.paths.profileRoot); }
      catch (_) { dss02Fail("DSS02_SECOND_WRITER", "profile generation lock is held"); }
      try {
        this.lockFd = fs.openSync(this.paths.lock, "wx", 0o600);
        fs.writeFileSync(this.lockFd, `${process.pid}\n${this.clock()}\n`);
        fs.fsyncSync(this.lockFd);
        fsyncDirectory(this.paths.profileRoot);
      } catch (_) {
        if (this.lockFd !== null) { try { fs.closeSync(this.lockFd); } catch (__) {} this.lockFd = null; }
        dss02Fail("DSS02_SECOND_WRITER", "profile generation lock is held");
      }
    }
  }

  releaseGenerationLock() {
    if (this.lockFd !== null) {
      try { fs.closeSync(this.lockFd); } catch (_) {}
      this.lockFd = null;
      try { fs.unlinkSync(this.paths.lock); } catch (_) {}
      fsyncDirectory(this.paths.profileRoot);
    }
  }

  open() {
    if (this.db) return this;
    this.acquireGenerationLock();
    try {
      ensureDirectory(this.paths.cas);
      ensureDirectory(this.paths.quarantine);
      ensureDirectory(this.paths.keyring);
      ensureDirectory(this.paths.bootstrap);
      ensureDirectory(this.paths.recovery);
      this.db = new DatabaseSync(this.paths.database);
      this.db.exec("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;");
      this.db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY NOT NULL, checksum TEXT NOT NULL, applied_at TEXT NOT NULL);");
      const userVersion = Number(this.db.prepare("PRAGMA user_version").get().user_version || 0);
      if (!Number.isSafeInteger(userVersion) || userVersion > 1) dss02Fail("DSS02_UNKNOWN_SCHEMA_VERSION");
      const existing = this.db.prepare("SELECT version, checksum FROM schema_migrations ORDER BY version").all();
      if (existing.some((row) => row.version !== 1 || row.checksum !== MIGRATION_CHECKSUM)) dss02Fail("DSS02_SCHEMA_CHECKSUM_MISMATCH");
      if (userVersion === 0) {
        this.db.exec("BEGIN IMMEDIATE");
        try {
          this.db.exec(MIGRATION_SQL);
          this.db.prepare("INSERT INTO schema_migrations(version, checksum, applied_at) VALUES(?, ?, ?)").run(1, MIGRATION_CHECKSUM, this.clock());
          this.db.exec("PRAGMA user_version=1");
          this.db.exec("COMMIT");
        } catch (error) {
          try { this.db.exec("ROLLBACK"); } catch (_) {}
          throw error;
        }
      }
      // A profile with no capacity row has not opened a generation yet.
      const count = this.db.prepare("SELECT COUNT(*) AS count FROM capacity_counters").get().count;
      if (count === 0) {
        this.db.prepare("INSERT INTO capacity_counters(singleton, open_jobs, request_bytes, retained_projection_bytes, subscriptions, outstanding_offers, counter_event_head, policy_revision, updated_at) VALUES(1, 0, 0, 0, 0, 0, 0, ?, ?)").run("capacity-policy@1", this.clock());
      }
      return this;
    } catch (error) {
      try { if (this.db) this.db.close(); } catch (_) {}
      this.db = null;
      this.releaseGenerationLock();
      if (error instanceof Dss02Error) throw error;
      dss02Fail("DSS02_STORE_OPEN_FAILED", error.message);
    }
  }

  close() {
    this.ready = false;
    if (this.db) { try { this.db.close(); } catch (_) {} this.db = null; }
    this.releaseGenerationLock();
  }

  requireOpen() {
    if (!this.db) dss02Fail("DSS02_STORE_CLOSED");
    return this.db;
  }

  transaction(callback) {
    const db = this.requireOpen();
    if (this._transaction) dss02Fail("DSS02_NESTED_TRANSACTION");
    this._transaction = true;
    db.exec("BEGIN IMMEDIATE");
    const tx = {
      run: (sql, ...params) => db.prepare(sql).run(...params),
      get: (sql, ...params) => db.prepare(sql).get(...params),
      all: (sql, ...params) => db.prepare(sql).all(...params),
      exec: (sql) => db.exec(sql),
      json: (value) => canonicalJson(value),
    };
    try {
      const result = callback(tx);
      db.exec("COMMIT");
      return result;
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch (_) {}
      throw error;
    } finally {
      this._transaction = false;
    }
  }

  run(sql, ...params) { return this.requireOpen().prepare(sql).run(...params); }
  get(sql, ...params) { return this.requireOpen().prepare(sql).get(...params); }
  all(sql, ...params) { return this.requireOpen().prepare(sql).all(...params); }

  setMeta(key, value) {
    this.run("INSERT INTO dss_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", key, typeof value === "string" ? value : canonicalJson(value));
  }

  getMeta(key) {
    const row = this.get("SELECT value FROM dss_meta WHERE key=?", key);
    return row ? parseStoredJson(row.value, key) : null;
  }

  createGeneration(schemaRevision = DSS02_SCHEMA) {
    const generationRef = randomRef("generation");
    const openedAt = this.clock();
    const checksum = digestObject("DirectSemanticService.SchemaRevision.v1", { schemaRevision });
    this.transaction((tx) => {
      tx.run("UPDATE daemon_generations SET status='CLOSED' WHERE profile_ref=? AND status='OPEN'", this.profileRef);
      tx.run("INSERT INTO daemon_generations(generation_ref,profile_ref,schema_revision,schema_checksum,opened_at,status) VALUES(?,?,?,?,?,?)", generationRef, this.profileRef, schemaRevision, checksum, openedAt, "OPEN");
    });
    this.generation = generationRef;
    this.ready = false;
    return { generationRef, profileRef: this.profileRef, schemaRevision, schemaChecksum: checksum, openedAt };
  }

  currentGeneration() {
    return this.get("SELECT * FROM daemon_generations WHERE profile_ref=? AND status='OPEN' ORDER BY opened_at DESC LIMIT 1", this.profileRef) || null;
  }

  latestGlobalSequence() {
    const value = this.get("SELECT COALESCE(MAX(global_sequence),0) AS sequence FROM service_events").sequence;
    checkedInteger(Number(value), "global sequence");
    return Number(value);
  }

  tableRows(table) {
    if (!/^[a-z_]+$/.test(table)) dss02Fail("DSS02_TABLE_INVALID");
    return this.all(`SELECT * FROM ${table}`);
  }

  inventory() {
    const tables = [
      "owner_roots", "bootstrap_commitments", "bootstrap_attempts", "bootstrap_authorizations",
      "daemon_generations", "principals", "verifiers", "registry_revisions", "authorization_challenges", "authorization_receipts",
      "idempotency_bindings", "jobs", "service_events", "job_heads", "artifacts", "quarantine_artifacts",
      "custody_keys", "custody_rotations", "leases", "capacity_observations", "dispatch_boundaries",
      "cancellation_decisions", "subscriptions", "delivery_offers", "delivery_acknowledgments",
      "delivery_cursors", "recovery_dispositions",
    ];
    const populations = {};
    for (const table of tables) {
      const rows = this.tableRows(table);
      populations[table] = {
        count: rows.length,
        digest: digestObject(`DirectSemanticService.Inventory.${table}.v1`, rows),
      };
    }
    const inventoryDigest = digestObject("DirectSemanticService.Inventory.v1", populations);
    populations.owner_root_inventory_digest = populations.owner_roots.digest;
    populations.job_inventory_digest = populations.jobs.digest;
    return { populations, inventoryDigest, globalHead: this.latestGlobalSequence() };
  }

  static migrationChecksum() { return MIGRATION_CHECKSUM; }
}

function createDss02Store(options) { return new Dss02Store(options).open(); }

module.exports = {
  Dss02Store,
  DirectSemanticServiceStore: Dss02Store,
  createDss02Store,
  MIGRATION_CHECKSUM,
  MIGRATION_SQL,
};
