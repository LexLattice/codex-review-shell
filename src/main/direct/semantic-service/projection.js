"use strict";

const {
  dss02Fail,
  immutableId,
  immutableDigest,
  digestObject,
  safeJson,
  assertNoExecutionClaim,
  isoNow,
} = require("./dss02-common");

// Delivery acknowledgments are custody events, but they are not new
// subscriber disclosure.  Including them would manufacture an endless offer
// after every successful acknowledgment.
const SAFE_EVENT_TYPES = new Set(["job_admitted", "job_cancelled_before_dispatch", "later_tranche_handoff_committed", "recovery_classification", "delivery_subscription_created"]);

class Dss02Projection {
  constructor({ store, ledger, authority, now = undefined } = {}) {
    if (!store || !ledger || !authority) dss02Fail("DSS02_PROJECTION_DEPENDENCY");
    this.store = store;
    this.ledger = ledger;
    this.authority = authority;
    this.now = now;
  }

  clock() { return isoNow(typeof this.now === "function" ? this.now() : this.now); }

  assertRead(authorizationReceipt, operation) {
    if (!authorizationReceipt || authorizationReceipt.decision !== "AUTHORIZED" || authorizationReceipt.operation !== operation) dss02Fail("DSS02_READ_UNAUTHORIZED");
    this.authority.assertCurrentVerifier(authorizationReceipt.verifierRef, { operation });
    return authorizationReceipt;
  }

  projectJob({ jobRef, authorizationReceipt, operation = "inspect", projectionRef = "projection-safe@1", afterSequence = 0, eventTypeFilter = undefined, currentHead = undefined } = {}) {
    immutableId(jobRef, "jobRef");
    this.assertRead(authorizationReceipt, operation);
    const job = this.store.get("SELECT * FROM jobs WHERE job_ref=?", jobRef);
    if (!job) dss02Fail("DSS02_JOB_UNKNOWN");
    if (job.principal_ref !== authorizationReceipt.principalRef && !this.authority.getVerifier(authorizationReceipt.verifierRef)?.objectScopes.includes("*")) dss02Fail("DSS02_READ_SCOPE");
    const events = this.store.all("SELECT * FROM service_events WHERE job_ref=? AND job_sequence>? ORDER BY job_sequence", jobRef, afterSequence);
    if (currentHead !== undefined && Number(currentHead) !== (events.length ? events[events.length - 1].job_sequence : afterSequence)) dss02Fail("DSS02_PROJECTION_STALE_HEAD");
    const filter = Array.isArray(eventTypeFilter) && eventTypeFilter.length > 0 ? new Set(eventTypeFilter) : null;
    const projectedEvents = events.filter((row) => !filter || filter.has(row.event_type)).filter((row) => SAFE_EVENT_TYPES.has(row.event_type)).map((row) => {
      const payload = safeJson(JSON.parse(row.payload_json));
      assertNoExecutionClaim(payload, "projection payload");
      return { sequence: row.job_sequence, globalSequence: row.global_sequence, type: row.event_type, payload, recordedAt: row.recorded_at };
    });
    const request = JSON.parse(job.request_json);
    const projection = {
      schema: "direct_semantic_authorized_safe_projection@1",
      projectionRef,
      jobRef,
      state: job.state,
      requestDigest: job.request_digest,
      admittedPrincipalRef: job.principal_ref,
      operation: "durable-custody-only",
      request: safeJson({ requestId: request.requestId, projectRef: request.projectRef, projectRegistryRevisionRef: request.projectRegistryRevisionRef, targetORevision: request.targetORevision, targetSnapshotReceiptRef: request.targetSnapshotReceiptRef, compilerPinRef: request.compilerPinRef, requestedCompilationRef: request.requestedCompilationRef, selectionMode: request.selectionMode, edgeOccurrenceRefs: request.edgeOccurrenceRefs, attemptPolicyRef: request.attemptPolicyRef, executionProfileRevisionRef: request.executionProfileRevisionRef, deliveryProjectionRef: request.deliveryProjectionRef, idempotencyKey: request.idempotencyKey }),
      events: projectedEvents,
      cursor: afterSequence,
      currentCursor: job.event_sequence,
      generatedAt: this.clock(),
    };
    assertNoExecutionClaim(projection, "projection");
    projection.projectionDigest = digestObject("DirectSemanticService.SafeProjection.v1", projection);
    return Object.freeze(projection);
  }

  projectResults(options = {}) {
    return this.projectJob({ ...options, operation: "results" });
  }
}

function createDss02Projection(options) { return new Dss02Projection(options); }

module.exports = { Dss02Projection, ProjectionService: Dss02Projection, createDss02Projection };
