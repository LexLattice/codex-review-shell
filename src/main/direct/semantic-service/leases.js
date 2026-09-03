"use strict";

const { dss02Fail, immutableId, isoNow, epochMs, randomRef, checkedInteger, checkedAdd } = require("./dss02-common");

class Dss02Leases {
  constructor({ store, ledger = undefined, authority = undefined, now = undefined, defaultTtlMs = 30_000, currentGeneration = undefined } = {}) {
    if (!store) dss02Fail("DSS02_LEASE_STORE_REQUIRED");
    this.store = store; this.ledger = ledger; this.authority = authority; this.now = now; this.defaultTtlMs = defaultTtlMs; this.currentGeneration = currentGeneration;
  }

  clock() { return isoNow(typeof this.now === "function" ? this.now() : this.now); }
  current(subjectRef, operationClass) { return this.store.get("SELECT * FROM leases WHERE subject_ref=? AND operation_class=? AND state='ACTIVE' ORDER BY lease_revision DESC LIMIT 1", subjectRef, operationClass); }
  describe(row) { return row ? { schema: "direct_semantic_job_mutation_lease@1", leaseRef: row.lease_ref, subjectRef: row.subject_ref, operationClass: row.operation_class, daemonGeneration: row.daemon_generation, fencingToken: row.fencing_token, leaseRevision: row.lease_revision, state: row.state, acquiredAt: row.acquired_at, expiresAt: row.expires_at, releasedAt: row.released_at || null, disposition: row.disposition || null } : null; }
  checkTtl(ttlMs) { checkedInteger(ttlMs, "lease ttl", 100); if (ttlMs > 300_000) dss02Fail("DSS02_LEASE_TTL_INVALID"); }
  assertCurrentGeneration(daemonGeneration) {
    const current = typeof this.currentGeneration === "function" ? this.currentGeneration() : this.currentGeneration;
    if (current && daemonGeneration !== current) dss02Fail("DSS02_FOREIGN_GENERATION");
  }
  append(tx, eventType, payload, recordedAt) { return this.ledger ? this.ledger.appendInTransaction(tx, { eventType, payload, recordedAt }) : null; }

  acquire({ subjectRef, operationClass, daemonGeneration, ttlMs = this.defaultTtlMs } = {}) {
    immutableId(subjectRef, "subjectRef"); immutableId(operationClass, "operationClass"); immutableId(daemonGeneration, "daemonGeneration"); this.assertCurrentGeneration(daemonGeneration); this.checkTtl(ttlMs);
    const now = this.clock(); const existing = this.current(subjectRef, operationClass);
    if (existing && existing.daemon_generation === daemonGeneration && epochMs(existing.expires_at) > epochMs(now)) return { status: "AUTHORIZED", lease: this.describe(existing) };
    const row = { leaseRef: randomRef("lease"), subjectRef, operationClass, daemonGeneration, state: "ACTIVE", acquiredAt: now, expiresAt: new Date(epochMs(now) + ttlMs).toISOString() };
    let output;
    this.store.transaction((tx) => {
      const live = tx.get("SELECT * FROM leases WHERE subject_ref=? AND operation_class=? AND state='ACTIVE' ORDER BY lease_revision DESC LIMIT 1", subjectRef, operationClass);
      if (live && live.daemon_generation === daemonGeneration && epochMs(live.expires_at) > epochMs(now)) { output = { status: "AUTHORIZED", lease: this.describe(live) }; return; }
      if (live) this.append(tx, "lease_expired", { leaseRef: live.lease_ref, subjectRef, operationClass, priorGeneration: live.daemon_generation, classification: "EXPIRED" }, now);
      if (live) tx.run("UPDATE leases SET state='EXPIRED',disposition='EXPIRE',released_at=? WHERE lease_ref=? AND state='ACTIVE'", now, live.lease_ref);
      const previous = tx.get("SELECT MAX(fencing_token) AS token, MAX(lease_revision) AS revision FROM leases WHERE subject_ref=? AND operation_class=?", subjectRef, operationClass);
      row.fencingToken = checkedAdd(Number(previous?.token || 0), 1, "lease fencing token"); row.leaseRevision = checkedAdd(Number(previous?.revision || 0), 1, "lease revision");
      tx.run("INSERT INTO leases(lease_ref,subject_ref,operation_class,daemon_generation,fencing_token,lease_revision,state,acquired_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?)", row.leaseRef, row.subjectRef, row.operationClass, row.daemonGeneration, row.fencingToken, row.leaseRevision, row.state, row.acquiredAt, row.expiresAt);
      this.append(tx, "lease_acquired", { leaseRef: row.leaseRef, subjectRef, operationClass, daemonGeneration, fencingToken: row.fencingToken, leaseRevision: row.leaseRevision, expiresAt: row.expiresAt }, now);
      output = { status: "AUTHORIZED", lease: Object.freeze(row) };
    });
    return output;
  }

  renew({ leaseRef, expectedRevision, fencingToken, daemonGeneration, ttlMs = this.defaultTtlMs } = {}) {
    immutableId(leaseRef, "leaseRef"); immutableId(daemonGeneration, "daemonGeneration"); this.assertCurrentGeneration(daemonGeneration); checkedInteger(expectedRevision, "lease revision"); checkedInteger(fencingToken, "fencing token"); this.checkTtl(ttlMs);
    const now = this.clock(); let output;
    this.store.transaction((tx) => {
      const row = tx.get("SELECT * FROM leases WHERE lease_ref=?", leaseRef);
      if (!row) dss02Fail("DSS02_LEASE_UNKNOWN");
      if (row.state !== "ACTIVE" || row.daemon_generation !== daemonGeneration || row.lease_revision !== expectedRevision || row.fencing_token !== fencingToken || epochMs(row.expires_at) <= epochMs(now)) dss02Fail("DSS02_STALE_LEASE");
      const nextRevision = checkedAdd(row.lease_revision, 1, "lease revision"); const nextToken = checkedAdd(row.fencing_token, 1, "lease fencing token"); const expiresAt = new Date(epochMs(now) + ttlMs).toISOString();
      this.append(tx, "lease_renewed", { leaseRef, daemonGeneration, priorRevision: row.lease_revision, leaseRevision: nextRevision, priorFencingToken: row.fencing_token, fencingToken: nextToken, expiresAt }, now);
      const changed = tx.run("UPDATE leases SET lease_revision=?,fencing_token=?,expires_at=? WHERE lease_ref=? AND state='ACTIVE' AND lease_revision=? AND fencing_token=?", nextRevision, nextToken, expiresAt, leaseRef, expectedRevision, fencingToken);
      if (!changed.changes) dss02Fail("DSS02_STALE_LEASE");
      output = Object.freeze({ ...this.describe({ ...row, lease_revision: nextRevision, fencing_token: nextToken, expires_at: expiresAt }), state: "ACTIVE" });
    });
    return output;
  }

  release({ leaseRef, expectedRevision, fencingToken, daemonGeneration, disposition = "RELEASED" } = {}) {
    if (!["RELEASED", "ABANDONED"].includes(disposition)) dss02Fail("DSS02_LEASE_DISPOSITION_INVALID");
    immutableId(daemonGeneration, "daemonGeneration"); this.assertCurrentGeneration(daemonGeneration);
    const now = this.clock(); let output;
    this.store.transaction((tx) => {
      const row = tx.get("SELECT * FROM leases WHERE lease_ref=?", leaseRef);
      if (!row) dss02Fail("DSS02_LEASE_UNKNOWN");
      if (row.state !== "ACTIVE") {
        if (row.disposition === disposition && row.lease_revision === expectedRevision) { output = { status: "EXACT_REPLAY", lease: this.describe(row) }; return; }
        dss02Fail("DSS02_STALE_LEASE");
      }
      if (row.daemon_generation !== daemonGeneration || row.lease_revision !== expectedRevision || row.fencing_token !== fencingToken) dss02Fail("DSS02_STALE_LEASE");
      this.append(tx, "lease_released", { leaseRef, daemonGeneration, leaseRevision: expectedRevision, fencingToken, disposition }, now);
      const changed = tx.run("UPDATE leases SET state=?,disposition=?,released_at=? WHERE lease_ref=? AND state='ACTIVE' AND lease_revision=? AND fencing_token=?", disposition, disposition, now, leaseRef, expectedRevision, fencingToken);
      if (!changed.changes) dss02Fail("DSS02_STALE_LEASE");
      output = { status: disposition, lease: this.describe({ ...row, state: disposition, disposition, released_at: now }) };
    });
    return output;
  }

  expire({ leaseRef, expectedRevision, now = this.clock() } = {}) {
    const row = this.store.get("SELECT * FROM leases WHERE lease_ref=?", leaseRef);
    if (!row) dss02Fail("DSS02_LEASE_UNKNOWN");
    if (row.lease_revision !== expectedRevision) dss02Fail("DSS02_STALE_LEASE");
    if (row.state === "EXPIRED") return { status: "EXACT_REPLAY", lease: this.describe(row) };
    if (row.state !== "ACTIVE" || epochMs(row.expires_at) > epochMs(now)) dss02Fail("DSS02_LEASE_NOT_EXPIRED");
    let output;
    this.store.transaction((tx) => {
      this.append(tx, "lease_expired", { leaseRef, leaseRevision: expectedRevision, classification: "EXPIRED" }, now);
      const changed = tx.run("UPDATE leases SET state='EXPIRED',disposition='EXPIRE',released_at=? WHERE lease_ref=? AND state='ACTIVE' AND lease_revision=?", now, leaseRef, expectedRevision);
      if (!changed.changes) dss02Fail("DSS02_STALE_LEASE");
      output = { status: "EXPIRED", lease: this.describe({ ...row, state: "EXPIRED", disposition: "EXPIRE", released_at: now }) };
    });
    return output;
  }

  validate({ leaseRef, subjectRef, operationClass, daemonGeneration, fencingToken, leaseRevision } = {}) {
    immutableId(daemonGeneration, "daemonGeneration"); this.assertCurrentGeneration(daemonGeneration);
    const row = this.store.get("SELECT * FROM leases WHERE lease_ref=?", leaseRef);
    if (!row || row.state !== "ACTIVE" || row.subject_ref !== subjectRef || row.operation_class !== operationClass || row.daemon_generation !== daemonGeneration || row.fencing_token !== fencingToken || row.lease_revision !== leaseRevision || epochMs(row.expires_at) <= epochMs(this.clock())) dss02Fail("DSS02_STALE_LEASE");
    return this.describe(row);
  }
}

function createDss02Leases(options) { return new Dss02Leases(options); }
module.exports = { Dss02Leases, JobMutationLeases: Dss02Leases, createDss02Leases };
