"use strict";

const {
  dss02Fail,
  immutableId,
  isoNow,
  canonicalJson,
} = require("./dss02-common");

class Dss02Dispatch {
  constructor({ store, ledger, leases, authority, now = undefined, currentGeneration = undefined } = {}) {
    if (!store || !ledger || !leases || !authority) dss02Fail("DSS02_DISPATCH_DEPENDENCY");
    this.store = store;
    this.ledger = ledger;
    this.leases = leases;
    this.authority = authority;
    this.now = now;
    this.currentGeneration = currentGeneration;
  }

  clock() { return isoNow(typeof this.now === "function" ? this.now() : this.now); }

  establish(jobRef) {
    immutableId(jobRef, "jobRef");
    const existing = this.store.get("SELECT * FROM dispatch_boundaries WHERE job_ref=?", jobRef);
    if (existing) return this.describe(existing);
    const now = this.clock();
    this.store.run("INSERT INTO dispatch_boundaries(job_ref,boundary_revision,state,updated_at) VALUES(?,?,?,?)", jobRef, 1, "NOT_DISPATCHED", now);
    return { schema: "direct_semantic_later_tranche_dispatch_boundary@1", jobRef, boundaryRevision: 1, state: "NOT_DISPATCHED", targetTrancheRevision: null, daemonGeneration: null, fencingToken: null, handoffEventDigest: null, updatedAt: now };
  }

  describe(row) { return { schema: "direct_semantic_later_tranche_dispatch_boundary@1", jobRef: row.job_ref, boundaryRevision: row.boundary_revision, state: row.state, targetTrancheRevision: row.target_tranche_revision || null, daemonGeneration: row.daemon_generation || null, fencingToken: row.fencing_token ?? null, handoffEventDigest: row.handoff_event_digest || null, updatedAt: row.updated_at }; }

  get(jobRef) { const row = this.store.get("SELECT * FROM dispatch_boundaries WHERE job_ref=?", jobRef); return row ? this.describe(row) : null; }

  handoff({ jobRef, authorizationReceipt, targetTrancheRevision, leaseRef, leaseRevision, fencingToken, daemonGeneration } = {}) {
    if (!authorizationReceipt || authorizationReceipt.decision !== "AUTHORIZED" || !["handoff", "submit"].includes(authorizationReceipt.operation)) dss02Fail("DSS02_HANDOFF_UNAUTHORIZED");
    immutableId(jobRef, "jobRef"); immutableId(targetTrancheRevision, "targetTrancheRevision");
    const currentGeneration = typeof this.currentGeneration === "function" ? this.currentGeneration() : this.currentGeneration;
    if (currentGeneration && daemonGeneration !== currentGeneration) dss02Fail("DSS02_FOREIGN_GENERATION");
    const boundary = this.store.get("SELECT * FROM dispatch_boundaries WHERE job_ref=?", jobRef);
    if (!boundary) dss02Fail("DSS02_DISPATCH_BOUNDARY_MISSING");
    if (boundary.state === "HANDOFF_COMMITTED") {
      const committed = boundary.handoff_event_digest && this.store.get("SELECT payload_json FROM service_events WHERE event_digest=?", boundary.handoff_event_digest);
      const payload = committed ? JSON.parse(committed.payload_json) : null;
      if (!payload || payload.targetTrancheRevision !== targetTrancheRevision || payload.daemonGeneration !== daemonGeneration || payload.fencingToken !== fencingToken || payload.leaseRef !== leaseRef || payload.leaseRevision !== leaseRevision) dss02Fail("DSS02_HANDOFF_REPLAY_MISMATCH");
      return this.describe(boundary);
    }
    if (boundary.state === "AMBIGUOUS" || boundary.state === "RECOVERY_BLOCKED") dss02Fail("DSS02_DISPATCH_BLOCKED");
    if (boundary.state !== "NOT_DISPATCHED") dss02Fail("DSS02_HANDOFF_NOT_ELIGIBLE");
    const lease = this.leases.validate({ leaseRef, subjectRef: jobRef, operationClass: "handoff", daemonGeneration, fencingToken, leaseRevision });
    const now = this.clock();
    let output;
    this.store.transaction((tx) => {
      const latest = tx.get("SELECT * FROM dispatch_boundaries WHERE job_ref=?", jobRef);
      if (!latest || latest.boundary_revision !== boundary.boundary_revision || latest.state !== "NOT_DISPATCHED") dss02Fail("DSS02_DISPATCH_CONFLICT");
      const event = this.ledger.appendInTransaction(tx, { jobRef, eventType: "later_tranche_handoff_committed", payload: { targetTrancheRevision, daemonGeneration, fencingToken, leaseRevision, boundaryRevision: boundary.boundary_revision, leaseRef }, state: "HANDOFF_COMMITTED", recordedAt: now });
      tx.run("UPDATE dispatch_boundaries SET boundary_revision=boundary_revision+1,state='HANDOFF_COMMITTED',target_tranche_revision=?,daemon_generation=?,fencing_token=?,handoff_event_digest=?,updated_at=? WHERE job_ref=? AND boundary_revision=? AND state='NOT_DISPATCHED'", targetTrancheRevision, daemonGeneration, fencingToken, event.eventDigest, now, jobRef, boundary.boundary_revision);
      output = { schema: "direct_semantic_later_tranche_dispatch_boundary@1", jobRef, boundaryRevision: boundary.boundary_revision + 1, state: "HANDOFF_COMMITTED", targetTrancheRevision, daemonGeneration, fencingToken, handoffEventDigest: event.eventDigest, updatedAt: now };
    });
    return Object.freeze(output);
  }

  markAmbiguous(jobRef, reasonCode = "AMBIGUOUS") {
    const boundary = this.store.get("SELECT * FROM dispatch_boundaries WHERE job_ref=?", jobRef);
    if (!boundary) dss02Fail("DSS02_DISPATCH_BOUNDARY_MISSING");
    this.store.run("UPDATE dispatch_boundaries SET state='AMBIGUOUS',boundary_revision=boundary_revision+1,updated_at=? WHERE job_ref=? AND boundary_revision=?", this.clock(), jobRef, boundary.boundary_revision);
    return this.get(jobRef);
  }
}

function createDss02Dispatch(options) { return new Dss02Dispatch(options); }

module.exports = { Dss02Dispatch, DispatchController: Dss02Dispatch, createDss02Dispatch };
