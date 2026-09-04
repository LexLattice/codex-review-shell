"use strict";

const {
  dss02Fail,
  ensureObject,
  immutableId,
  digestObject,
  canonicalJson,
  isoNow,
  randomRef,
  assertNoExecutionClaim,
} = require("./dss02-common");

class Dss02Cancellation {
  constructor({ store, ledger, capacity, authority, now = undefined } = {}) {
    if (!store || !ledger || !capacity || !authority) dss02Fail("DSS02_CANCELLATION_DEPENDENCY");
    this.store = store;
    this.ledger = ledger;
    this.capacity = capacity;
    this.authority = authority;
    this.now = now;
  }

  clock() { return isoNow(typeof this.now === "function" ? this.now() : this.now); }

  decide({ jobRef, request, authorizationReceipt, signalRequestedRunningAttemptRefs = [], projectRef = undefined } = {}) {
    immutableId(jobRef, "jobRef");
    ensureObject(request, "DSS02_CANCELLATION_REQUEST_INVALID");
    if (!authorizationReceipt || authorizationReceipt.decision !== "AUTHORIZED" || authorizationReceipt.operation !== "cancel") dss02Fail("DSS02_CANCEL_UNAUTHORIZED");
    if (!Array.isArray(signalRequestedRunningAttemptRefs) || signalRequestedRunningAttemptRefs.length !== 0) dss02Fail("DSS02_CANCEL_RUNNING_ATTEMPT");
    assertNoExecutionClaim(request, "cancellation request");
    const job = this.store.get("SELECT * FROM jobs WHERE job_ref=?", jobRef);
    if (!job) dss02Fail("DSS02_JOB_UNKNOWN");
    const jobRequest = JSON.parse(job.request_json);
    if (projectRef !== undefined && jobRequest.projectRef !== projectRef) dss02Fail("DSS02_CANCEL_PROJECT_MISMATCH");
    if (job.principal_ref !== authorizationReceipt.principalRef && job.principal_ref !== authorizationReceipt.admittedPrincipalRef) dss02Fail("DSS02_CANCEL_SCOPE");
    const boundary = this.store.get("SELECT * FROM dispatch_boundaries WHERE job_ref=?", jobRef);
    if (!boundary) dss02Fail("DSS02_DISPATCH_BOUNDARY_MISSING");
    if (boundary.state === "AMBIGUOUS" || boundary.state === "RECOVERY_BLOCKED") dss02Fail("DSS02_CANCEL_RECOVERY_BLOCKED");
    if (boundary.state !== "NOT_DISPATCHED" || ["CANCELLED_BEFORE_DISPATCH", "HANDOFF_COMMITTED"].includes(job.state)) dss02Fail("DSS02_CANCEL_ALREADY_DISPATCHED");
    const now = this.clock();
    const requestDigest = digestObject("DirectSemanticService.CancellationRequest.v1", request);
    const decision = {
      schema: "direct_semantic_job_cancellation_decision_dss02@1",
      cancellationRef: randomRef("cancellation"),
      jobRef,
      requestDigest,
      principalRef: authorizationReceipt.principalRef || authorizationReceipt.admittedPrincipalRef,
      dispatchBoundaryRevision: boundary.boundary_revision,
      jobEventHeadDigest: job.event_digest,
      signalRequestedRunningAttemptRefs: [],
      decision: "authorized_before_dispatch",
      state: "AUTHORIZED_BEFORE_DISPATCH",
      createdAt: now,
    };
    this.store.transaction((tx) => {
      tx.run("INSERT INTO cancellation_decisions(cancellation_ref,job_ref,request_digest,principal_ref,dispatch_boundary_revision,job_event_head_digest,running_attempt_refs_json,state,created_at) VALUES(?,?,?,?,?,?,?,?,?)", decision.cancellationRef, jobRef, requestDigest, decision.principalRef, boundary.boundary_revision, job.event_digest, canonicalJson([]), decision.state, now);
      const event = this.ledger.appendInTransaction(tx, { jobRef, eventType: "job_cancelled_before_dispatch", payload: { cancellationRef: decision.cancellationRef, requestDigest, principalRef: decision.principalRef, dispatchBoundaryRevision: boundary.boundary_revision }, state: "CANCELLED_BEFORE_DISPATCH", recordedAt: now });
      tx.run("UPDATE dispatch_boundaries SET boundary_revision=boundary_revision+1,state='NOT_DISPATCHED',updated_at=? WHERE job_ref=? AND boundary_revision=? AND state='NOT_DISPATCHED'", now, jobRef, boundary.boundary_revision);
      this.capacity.releaseJobInTransaction(tx, job.request_bytes, { eventHead: event.globalSequence });
      this.capacity.setCounterEventHeadInTransaction(tx, event.globalSequence);
    });
    return Object.freeze(decision);
  }
}

function createDss02Cancellation(options) { return new Dss02Cancellation(options); }

module.exports = { Dss02Cancellation, CancellationController: Dss02Cancellation, createDss02Cancellation };
