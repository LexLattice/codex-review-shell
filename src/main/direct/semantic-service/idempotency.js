"use strict";

const { canonicalJson, digestObject, dss02Fail, randomRef, isoNow, ensureObject, assertNoExecutionClaim } = require("./dss02-common");
const { validateContract } = require("./contract-schemas");

class Dss02Idempotency {
  constructor({ store, now = undefined } = {}) {
    if (!store) dss02Fail("DSS02_IDEMPOTENCY_STORE_REQUIRED");
    this.store = store;
    this.now = now;
  }

  clock() { return isoNow(typeof this.now === "function" ? this.now() : this.now); }

  key(principalRef, operation, idempotencyKey) { return `${principalRef}\u0000${operation}\u0000${idempotencyKey}`; }

  find(principalRef, operation, idempotencyKey) {
    return this.store.get("SELECT * FROM idempotency_bindings WHERE principal_ref=? AND operation=? AND idempotency_key=?", principalRef, operation, idempotencyKey) || null;
  }

  reserveInTransaction(tx, { principalRef, operation, idempotencyKey, requestDigest, jobRef, admissionEventDigest, principalLineageRevision, verifierRevision, creationGlobalSequence, createdAt = this.clock() }) {
    const existing = tx.get("SELECT * FROM idempotency_bindings WHERE principal_ref=? AND operation=? AND idempotency_key=?", principalRef, operation, idempotencyKey);
    if (existing) {
      if (existing.request_digest !== requestDigest) dss02Fail("DSS02_IDEMPOTENCY_CONFLICT");
      return { replay: true, binding: existing };
    }
    tx.run("INSERT INTO idempotency_bindings(principal_ref,operation,idempotency_key,request_digest,job_ref,admission_event_digest,principal_lineage_revision,verifier_revision,creation_global_sequence,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)", principalRef, operation, idempotencyKey, requestDigest, jobRef, admissionEventDigest, principalLineageRevision, verifierRevision, creationGlobalSequence, createdAt);
    return { replay: false, binding: { principalRef, operation, idempotencyKey, requestDigest, jobRef, admissionEventDigest, principalLineageRevision, verifierRevision, creationGlobalSequence, createdAt } };
  }

  receiptForBinding(binding) {
    const job = this.store.get("SELECT * FROM jobs WHERE job_ref=?", binding.job_ref || binding.jobRef);
    if (!job) dss02Fail("DSS02_IDEMPOTENCY_ORPHAN");
    return {
      schema: "direct_semantic_job_receipt@1",
      jobRef: job.job_ref,
      requestDigest: job.request_digest,
      admittedPrincipalRef: job.principal_ref,
      admittedVerifierRef: job.verifier_ref,
      acceptedAt: job.created_at,
      eventCursor: job.event_sequence,
      state: job.state,
    };
  }

  inventoryDigest() {
    return digestObject("DirectSemanticService.IdempotencyInventory.v1", this.store.all("SELECT * FROM idempotency_bindings ORDER BY principal_ref,operation,idempotency_key"));
  }
}

class Dss02JobAdmission {
  constructor({ store, ledger, capacity, dispatch, authority, idempotency = undefined, now = undefined } = {}) {
    if (!store || !ledger || !capacity || !dispatch || !authority) dss02Fail("DSS02_JOB_ADMISSION_DEPENDENCY");
    this.store = store; this.ledger = ledger; this.capacity = capacity; this.dispatch = dispatch; this.authority = authority; this.idempotency = idempotency || new Dss02Idempotency({ store, now }); this.now = now;
  }

  clock() { return isoNow(typeof this.now === "function" ? this.now() : this.now); }

  admit({ request, authorizationReceipt, transportObservation = undefined } = {}) {
    ensureObject(request, "DSS02_REQUEST_INVALID");
    if (validateContract("SemanticJobRequest", request) === false) dss02Fail("DSS02_REQUEST_CONTRACT_INVALID");
    assertNoExecutionClaim(request, "job request");
    if (!authorizationReceipt || authorizationReceipt.decision !== "AUTHORIZED" || authorizationReceipt.operation !== "submit") dss02Fail("DSS02_SUBMIT_UNAUTHORIZED");
    const principalRef = authorizationReceipt.principalRef || authorizationReceipt.admittedPrincipalRef;
    const verifierRef = authorizationReceipt.verifierRef;
    if (!principalRef || !verifierRef) dss02Fail("DSS02_AUTHORITY_RECEIPT_INVALID");
    const requestDigest = digestObject("DirectSemanticService.SemanticJobRequest.v1", request);
    const existing = this.idempotency.find(principalRef, "submit", request.idempotencyKey);
    if (existing) {
      if (existing.request_digest !== requestDigest) dss02Fail("DSS02_IDEMPOTENCY_CONFLICT");
      return Object.freeze({ ...this.idempotency.receiptForBinding(existing), replay: true });
    }
    const principal = this.authority.getPrincipal(principalRef);
    const verifier = this.authority.getVerifier(verifierRef);
    if (!principal || !verifier || verifier.principalRef !== principalRef) dss02Fail("DSS02_AUTHORITY_RECEIPT_INVALID");
    const now = this.clock();
    const jobRef = randomRef("job");
    const requestBytes = Buffer.byteLength(canonicalJson(request), "utf8");
    let receipt;
    this.store.transaction((tx) => {
      this.capacity.reserveJobInTransaction(tx, requestBytes);
      tx.run("INSERT INTO jobs(job_ref,request_json,request_digest,principal_ref,verifier_ref,principal_lineage_revision,verifier_revision,operation,state,event_sequence,event_digest,created_at,updated_at,request_bytes) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)", jobRef, canonicalJson(request), requestDigest, principalRef, verifierRef, principal.lineageRevision, verifier.verifierRevision, "submit", "UNSEEN", 0, null, now, now, requestBytes);
      tx.run("INSERT INTO dispatch_boundaries(job_ref,boundary_revision,state,updated_at) VALUES(?,?,?,?)", jobRef, 1, "NOT_DISPATCHED", now);
      const event = this.ledger.appendInTransaction(tx, { jobRef, eventType: "job_admitted", payload: { requestDigest, principalRef, verifierRef, operation: "submit", idempotencyKey: request.idempotencyKey, requestBytes }, state: "ADMITTED", recordedAt: now });
      this.idempotency.reserveInTransaction(tx, { principalRef, operation: "submit", idempotencyKey: request.idempotencyKey, requestDigest, jobRef, admissionEventDigest: event.eventDigest, principalLineageRevision: principal.lineageRevision, verifierRevision: verifier.verifierRevision, creationGlobalSequence: event.globalSequence, createdAt: now });
      this.capacity.setCounterEventHeadInTransaction(tx, event.globalSequence);
      receipt = { schema: "direct_semantic_job_receipt@1", jobRef, requestDigest, admittedPrincipalRef: principalRef, admittedVerifierRef: verifierRef, projectRegistryRevisionRef: request.projectRegistryRevisionRef, targetSnapshotReceiptRef: request.targetSnapshotReceiptRef, compilerPinRef: request.compilerPinRef, acceptedAt: now, eventCursor: event.jobSequence, state: "ADMITTED" };
    });
    return Object.freeze(receipt);
  }
}

function createDss02Idempotency(options) { return new Dss02Idempotency(options); }

module.exports = { Dss02Idempotency, IdempotencyStore: Dss02Idempotency, Dss02JobAdmission, JobAdmission: Dss02JobAdmission, createDss02Idempotency, createDss02JobAdmission: (options) => new Dss02JobAdmission(options) };
