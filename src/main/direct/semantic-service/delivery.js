"use strict";

const {
  dss02Fail,
  immutableId,
  digestObject,
  canonicalJson,
  isoNow,
  randomRef,
  epochMs,
  safeJson,
} = require("./dss02-common");

class Dss02Delivery {
  constructor({ store, ledger, authority, projection, cas, capacity, now = undefined } = {}) {
    if (!store || !ledger || !authority || !projection || !cas || !capacity) dss02Fail("DSS02_DELIVERY_DEPENDENCY");
    this.store = store; this.ledger = ledger; this.authority = authority; this.projection = projection; this.cas = cas; this.capacity = capacity; this.now = now;
  }

  clock() { return isoNow(typeof this.now === "function" ? this.now() : this.now); }
  assertRead(receipt, operation) { if (!receipt || receipt.decision !== "AUTHORIZED" || receipt.operation !== operation) dss02Fail("DSS02_DELIVERY_UNAUTHORIZED"); this.authority.assertCurrentVerifier(receipt.verifierRef, { operation }); }

  // Planned-owner surface: delivery owns the authorized view consumed by
  // subscribers, while the small projection helper only performs reduction.
  projectAuthorizedJobView(options = {}) {
    return this.projection.projectJob(options);
  }

  createSubscription({ jobRef, authorizationReceipt, returnProjectionRef, eventTypeFilter = [], startingCursor = 0, deliveryAdapterRef = "cli_poll" } = {}) {
    immutableId(jobRef, "jobRef"); this.assertRead(authorizationReceipt, "subscribe");
    const verifier = this.authority.getVerifier(authorizationReceipt.verifierRef);
    const principalRef = authorizationReceipt.principalRef;
    const existing = this.store.get("SELECT * FROM subscriptions WHERE job_ref=? AND subscriber_principal_ref=? AND projection_ref=? AND state='ACTIVE'", jobRef, principalRef, returnProjectionRef);
    if (existing && existing.read_verifier_revision === verifier.verifierRevision) return this.describeSubscription(existing);
    const job = this.store.get("SELECT * FROM jobs WHERE job_ref=?", jobRef); if (!job) dss02Fail("DSS02_JOB_UNKNOWN");
    const subscriptionRef = randomRef("subscription"); const now = this.clock();
    let result;
    this.store.transaction((tx) => {
      this.capacity.reserveSubscriptionInTransaction(tx);
      tx.run("INSERT INTO subscriptions(subscription_ref,job_ref,subscriber_principal_ref,read_verifier_revision,read_capability_ref,event_filter_json,projection_ref,starting_cursor,current_cursor,revision,adapter_ref,state,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)", subscriptionRef, jobRef, principalRef, verifier.verifierRevision, authorizationReceipt.verifierRef, canonicalJson([...new Set(eventTypeFilter)].sort()), returnProjectionRef, startingCursor, startingCursor, 1, deliveryAdapterRef, "ACTIVE", now);
      tx.run("INSERT INTO delivery_cursors(subscription_ref,subscription_revision,acknowledged_sequence,acknowledgment_digest,global_event_head,state,updated_at) VALUES(?,?,?,?,?,?,?)", subscriptionRef, 1, startingCursor, null, this.store.latestGlobalSequence(), "CURRENT", now);
      this.ledger.appendInTransaction(tx, { jobRef: null, eventType: "delivery_subscription_created", payload: { subscriptionRef, jobRef, principalRef, projectionRef: returnProjectionRef, startingCursor }, recordedAt: now });
      result = { schema: "direct_semantic_delivery_subscription@1", subscriptionRef, jobRef, subscriberPrincipalRef: principalRef, readVerifierRevision: verifier.verifierRevision, readCapabilityRef: authorizationReceipt.verifierRef, eventTypeFilter: [...new Set(eventTypeFilter)].sort(), returnProjectionRef, startingCursor, currentCursor: startingCursor, revision: 1, deliveryAdapterRef, state: "ACTIVE", createdAt: now };
    });
    return Object.freeze(result);
  }

  describeSubscription(row) { return { schema: "direct_semantic_delivery_subscription@1", subscriptionRef: row.subscription_ref, jobRef: row.job_ref, subscriberPrincipalRef: row.subscriber_principal_ref, readVerifierRevision: row.read_verifier_revision, readCapabilityRef: row.read_capability_ref, eventTypeFilter: JSON.parse(row.event_filter_json), returnProjectionRef: row.projection_ref, startingCursor: row.starting_cursor, currentCursor: row.current_cursor, revision: row.revision, deliveryAdapterRef: row.adapter_ref, state: row.state, createdAt: row.created_at }; }

  activeSubscription({ jobRef, subscriptionRef = undefined, authorizationReceipt } = {}) {
    immutableId(jobRef, "jobRef");
    this.assertRead(authorizationReceipt, "subscribe");
    const verifier = this.authority.getVerifier(authorizationReceipt.verifierRef);
    let rows;
    if (subscriptionRef) {
      const row = this.store.get("SELECT * FROM subscriptions WHERE subscription_ref=?", subscriptionRef);
      rows = row && row.job_ref === jobRef && row.subscriber_principal_ref === authorizationReceipt.principalRef && row.state === "ACTIVE" ? [row] : [];
    } else {
      rows = this.store.all("SELECT * FROM subscriptions WHERE job_ref=? AND subscriber_principal_ref=? AND state='ACTIVE' ORDER BY created_at, subscription_ref", jobRef, authorizationReceipt.principalRef);
    }
    if (!rows.length) dss02Fail(subscriptionRef ? "DSS02_SUBSCRIPTION_UNKNOWN" : "DSS02_SUBSCRIPTION_REQUIRED");
    if (rows.length !== 1) dss02Fail("DSS02_SUBSCRIPTION_AMBIGUOUS");
    const row = rows[0];
    if (row.read_verifier_revision !== verifier.verifierRevision) dss02Fail("DSS02_SUBSCRIPTION_AUTHORITY_INVALIDATED");
    return row;
  }

  hasEventsAfter({ jobRef, subscriptionRef = undefined, authorizationReceipt, afterSequence = 0 } = {}) {
    const row = this.activeSubscription({ jobRef, subscriptionRef, authorizationReceipt });
    const cursor = Math.max(Number(row.current_cursor) || 0, Number(afterSequence) || 0);
    const projection = this.projectAuthorizedJobView({
      jobRef: row.job_ref,
      authorizationReceipt,
      operation: "subscribe",
      projectionRef: row.projection_ref,
      afterSequence: cursor,
      eventTypeFilter: JSON.parse(row.event_filter_json),
    });
    return { row, cursor, projection, qualifies: projection.events.length > 0 };
  }

  noNewEvents({ jobRef, subscriptionRef = undefined, authorizationReceipt, afterSequence = 0 } = {}) {
    const row = this.activeSubscription({ jobRef, subscriptionRef, authorizationReceipt });
    const requestedCursor = Number(afterSequence) || 0;
    const cursor = Math.max(Number(row.current_cursor) || 0, requestedCursor);
    const projection = this.projectAuthorizedJobView({
      jobRef: row.job_ref,
      authorizationReceipt,
      operation: "subscribe",
      projectionRef: row.projection_ref,
      afterSequence: cursor,
      eventTypeFilter: JSON.parse(row.event_filter_json),
    });
    return Object.freeze({
      schema: "direct_semantic_wait_result@1",
      status: "NO_NEW_EVENTS",
      jobRef: row.job_ref,
      subscriptionRef: row.subscription_ref,
      projectionRef: row.projection_ref,
      afterSequence: requestedCursor,
      cursor: row.current_cursor,
      currentCursor: projection.currentCursor,
      projection,
    });
  }

  offer({ subscriptionRef, authorizationReceipt, lease, deadlineMs = 30_000 } = {}) {
    const row = this.store.get("SELECT * FROM subscriptions WHERE subscription_ref=?", subscriptionRef); if (!row) dss02Fail("DSS02_SUBSCRIPTION_UNKNOWN");
    this.assertRead(authorizationReceipt, "subscribe");
    const verifier = this.authority.getVerifier(authorizationReceipt.verifierRef);
    if (row.state !== "ACTIVE" || row.subscriber_principal_ref !== authorizationReceipt.principalRef || row.read_verifier_revision !== verifier.verifierRevision) dss02Fail("DSS02_SUBSCRIPTION_AUTHORITY_INVALIDATED");
    const projection = this.projectAuthorizedJobView({ jobRef: row.job_ref, authorizationReceipt, operation: "subscribe", projectionRef: row.projection_ref, afterSequence: row.current_cursor, eventTypeFilter: JSON.parse(row.event_filter_json) });
    if (projection.events.length === 0) return { status: "NO_NEW_EVENTS", subscription: this.describeSubscription(row) };
    // The cursor advances over the complete job-event interval.  The safe
    // projection may omit events, but an acknowledged offer still establishes
    // a contiguous durable cursor boundary from the subscriber's prior head.
    const first = row.current_cursor + 1; const last = projection.events[projection.events.length - 1].sequence;
    // Canonicalization is bounded and happens before the admission
    // transaction, but publication itself must remain behind both the latest
    // subscription check and the retained-projection reservation.
    const preparedArtifact = this.cas.prepare(projection, { kind: "authorized-safe-projection" });
    const now = this.clock(); const attemptRef = randomRef("delivery-attempt"); const deadline = new Date(Date.now() + deadlineMs).toISOString();
    let result;
    let publication = null;
    let createdFilePath = null;
    try {
      this.store.transaction((tx) => {
        const latest = tx.get("SELECT * FROM subscriptions WHERE subscription_ref=?", subscriptionRef); if (!latest || latest.revision !== row.revision || latest.current_cursor !== row.current_cursor) dss02Fail("DSS02_DELIVERY_CONFLICT");
        this.capacity.reserveOfferInTransaction(tx, preparedArtifact.byteLength);
        publication = this.cas.publishPreparedInTransaction(tx, preparedArtifact, {
          onCreatedFile: (filePath) => { createdFilePath = filePath; },
        });
        const artifact = publication.descriptor;
        tx.run("UPDATE artifacts SET reference_count=reference_count+1,state='REFERENCED' WHERE artifact_ref=?", artifact.artifact_ref);
        tx.run("INSERT INTO delivery_offers(delivery_attempt_ref,subscription_ref,capability_validation_receipt_ref,first_event_sequence,last_event_sequence,projection_digest,projection_artifact_ref,offered_at,acknowledgment_deadline,state,generation_revision) VALUES(?,?,?,?,?,?,?,?,?,?,?)", attemptRef, subscriptionRef, authorizationReceipt.receiptRef || authorizationReceipt.authorizationDigest, first, last, projection.projectionDigest, artifact.artifact_ref, now, deadline, "OFFERED", this.store.currentGeneration()?.generation_ref || "unknown");
        result = { schema: "direct_semantic_delivery_attempt@1", deliveryAttemptRef: attemptRef, subscriptionRef, capabilityValidationReceiptRef: authorizationReceipt.receiptRef || authorizationReceipt.authorizationDigest, firstEventSequence: first, lastEventSequence: last, projectionDigest: projection.projectionDigest, projectionArtifactRef: artifact.artifact_ref, offeredAt: now, acknowledgmentDeadline: deadline, state: "OFFERED", projection };
      });
    } catch (error) {
      this.cas.discardUnreferencedPublication({ digest: preparedArtifact.digest, createdFilePath: createdFilePath || publication?.createdFilePath });
      throw error;
    }
    return Object.freeze(result);
  }

  acknowledge({ deliveryAttemptRef, authorizationReceipt, projectionDigest, subscriberPrincipalRef, jobRef = undefined } = {}) {
    const offer = this.store.get("SELECT * FROM delivery_offers WHERE delivery_attempt_ref=?", deliveryAttemptRef); if (!offer) dss02Fail("DSS02_DELIVERY_ATTEMPT_UNKNOWN");
    this.assertRead(authorizationReceipt, "acknowledge");
    const subscription = this.store.get("SELECT * FROM subscriptions WHERE subscription_ref=?", offer.subscription_ref); if (!subscription) dss02Fail("DSS02_SUBSCRIPTION_UNKNOWN");
    if (jobRef !== undefined && subscription.job_ref !== jobRef) dss02Fail("DSS02_DELIVERY_ACK_REJECTED");
    const verifier = this.authority.getVerifier(authorizationReceipt.verifierRef);
    if (offer.state === "ACKNOWLEDGED" && projectionDigest === offer.projection_digest && subscription.subscriber_principal_ref === (subscriberPrincipalRef || authorizationReceipt.principalRef) && subscription.read_verifier_revision === verifier.verifierRevision) return { status: "EXACT_REPLAY", acknowledgmentRef: this.store.get("SELECT acknowledgment_ref FROM delivery_acknowledgments WHERE delivery_attempt_ref=?", deliveryAttemptRef)?.acknowledgment_ref };
    if (offer.state !== "OFFERED" || offer.projection_digest !== projectionDigest || subscription.subscriber_principal_ref !== (subscriberPrincipalRef || authorizationReceipt.principalRef) || subscription.read_verifier_revision !== verifier.verifierRevision) dss02Fail("DSS02_DELIVERY_ACK_REJECTED");
    if (epochMs(offer.acknowledgment_deadline) <= epochMs(this.clock())) dss02Fail("DSS02_DELIVERY_ACK_EXPIRED");
    const now = this.clock(); const acknowledgmentRef = randomRef("acknowledgment"); let result;
    this.store.transaction((tx) => {
      const currentOffer = tx.get("SELECT * FROM delivery_offers WHERE delivery_attempt_ref=?", deliveryAttemptRef); const cursor = tx.get("SELECT * FROM delivery_cursors WHERE subscription_ref=?", subscription.subscription_ref);
      if (!currentOffer || currentOffer.state !== "OFFERED" || !cursor || cursor.acknowledged_sequence + 1 !== currentOffer.first_event_sequence) dss02Fail("DSS02_DELIVERY_ACK_STALE_CURSOR");
      tx.run("INSERT INTO delivery_acknowledgments(acknowledgment_ref,delivery_attempt_ref,subscriber_principal_ref,projection_digest,acknowledged_at) VALUES(?,?,?,?,?)", acknowledgmentRef, deliveryAttemptRef, subscriberPrincipalRef || authorizationReceipt.principalRef, projectionDigest, now);
      tx.run("UPDATE delivery_offers SET state='ACKNOWLEDGED' WHERE delivery_attempt_ref=? AND state='OFFERED'", deliveryAttemptRef);
      tx.run("UPDATE artifacts SET reference_count=CASE WHEN reference_count>0 THEN reference_count-1 ELSE 0 END WHERE artifact_ref=?", currentOffer.projection_artifact_ref);
      const event = this.ledger.appendInTransaction(tx, { jobRef: subscription.job_ref, eventType: "delivery_offer_acknowledged", payload: { subscriptionRef: subscription.subscription_ref, deliveryAttemptRef, acknowledgmentRef, lastEventSequence: currentOffer.last_event_sequence }, recordedAt: now });
      tx.run("UPDATE delivery_cursors SET acknowledged_sequence=?,acknowledgment_digest=?,global_event_head=?,updated_at=? WHERE subscription_ref=? AND acknowledged_sequence=?", currentOffer.last_event_sequence, digestObject("DirectSemanticService.DeliveryAcknowledgment.v1", { acknowledgmentRef, deliveryAttemptRef, projectionDigest }), event.globalSequence, now, subscription.subscription_ref, cursor.acknowledged_sequence);
      this.capacity.acknowledgeOfferInTransaction(tx, Number((this.store.get("SELECT byte_length FROM artifacts WHERE artifact_ref=?", currentOffer.projection_artifact_ref)?.byte_length) || 0), { eventHead: event.globalSequence });
      this.capacity.setCounterEventHeadInTransaction(tx, event.globalSequence);
      tx.run("UPDATE subscriptions SET current_cursor=? WHERE subscription_ref=? AND current_cursor=?", currentOffer.last_event_sequence, subscription.subscription_ref, cursor.acknowledged_sequence);
      result = { schema: "direct_semantic_delivery_acknowledgment@1", acknowledgmentRef, deliveryAttemptRef, subscriberPrincipalRef: subscriberPrincipalRef || authorizationReceipt.principalRef, projectionDigest, acknowledgedAt: now, acknowledgedSequence: currentOffer.last_event_sequence };
    });
    return Object.freeze(result);
  }

  expireOffers() {
    const now = this.clock();
    let count = 0;
    this.store.transaction((tx) => {
      const rows = tx.all("SELECT * FROM delivery_offers WHERE state='OFFERED' AND acknowledgment_deadline<=?", now);
      for (const offer of rows) {
        tx.run("UPDATE delivery_offers SET state='EXPIRED_UNACKNOWLEDGED' WHERE delivery_attempt_ref=? AND state='OFFERED'", offer.delivery_attempt_ref);
        const artifact = tx.get("SELECT byte_length FROM artifacts WHERE artifact_ref=?", offer.projection_artifact_ref);
        tx.run("UPDATE artifacts SET reference_count=CASE WHEN reference_count>0 THEN reference_count-1 ELSE 0 END WHERE artifact_ref=?", offer.projection_artifact_ref);
        const event = this.ledger.appendInTransaction(tx, { eventType: "delivery_offer_expired", payload: { deliveryAttemptRef: offer.delivery_attempt_ref, subscriptionRef: offer.subscription_ref, classification: "EXPIRED_UNACKNOWLEDGED" }, recordedAt: now });
        this.capacity.acknowledgeOfferInTransaction(tx, Number(artifact?.byte_length || 0), { eventHead: event.globalSequence });
        this.capacity.setCounterEventHeadInTransaction(tx, event.globalSequence);
        count += 1;
      }
    });
    return count;
  }
}

function createDss02Delivery(options) { return new Dss02Delivery(options); }

module.exports = { Dss02Delivery, DeliveryService: Dss02Delivery, createDss02Delivery };
