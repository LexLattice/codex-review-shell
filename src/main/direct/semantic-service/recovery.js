"use strict";

const { dss02Fail, digestObject, isoNow, randomRef, canonicalJson, checkedInteger } = require("./dss02-common");
const bootstrap = require("./bootstrap-provisioning");

/* Recovery is one durable cut: classifications and their ledger witnesses
 * commit together, so a crash cannot expose a half-applied restart policy. */
class Dss02Recovery {
  constructor({ store, ledger, cas, quarantine, authority, capacity, waiterGate = undefined, installationRoot = undefined, profileRoot = undefined, now = undefined } = {}) {
    if (!store || !ledger || !cas || !quarantine || !authority || !capacity) dss02Fail("DSS02_RECOVERY_DEPENDENCY");
    this.store = store; this.ledger = ledger; this.cas = cas; this.quarantine = quarantine; this.authority = authority; this.capacity = capacity; this.waiterGate = waiterGate; this.installationRoot = installationRoot; this.profileRoot = profileRoot; this.now = now;
  }

  clock() { return isoNow(typeof this.now === "function" ? this.now() : this.now); }

  reconcileJobs() {
    const jobs = this.store.all("SELECT job_ref,event_digest,event_sequence,state FROM jobs");
    const bindings = this.store.all("SELECT job_ref FROM idempotency_bindings");
    const heads = this.store.all("SELECT job_ref FROM job_heads");
    const boundaries = this.store.all("SELECT job_ref,state FROM dispatch_boundaries");
    const bindingSet = new Set(bindings.map((row) => row.job_ref)); const headSet = new Set(heads.map((row) => row.job_ref)); const boundarySet = new Set(boundaries.map((row) => row.job_ref));
    for (const job of jobs) {
      if (!bindingSet.has(job.job_ref) || !headSet.has(job.job_ref) || !boundarySet.has(job.job_ref)) dss02Fail("DSS02_JOB_BIJECTION_BROKEN");
      const boundary = boundaries.find((row) => row.job_ref === job.job_ref);
      if ((boundary.state === "HANDOFF_COMMITTED") !== (job.state === "HANDOFF_COMMITTED")) dss02Fail("DSS02_DISPATCH_RECONSTRUCTION_MISMATCH");
    }
    if (bindingSet.size !== jobs.length || headSet.size !== jobs.length || boundarySet.size !== jobs.length) dss02Fail("DSS02_JOB_ORPHAN_POPULATION");
    return jobs.length;
  }

  reconcileBootstrap() {
    const commitment = this.store.get("SELECT * FROM bootstrap_commitments WHERE profile_ref=?", this.store.profileRef);
    const attempt = this.store.get("SELECT * FROM bootstrap_attempts WHERE commitment_ref=?", commitment?.commitment_ref);
    const authorization = this.store.get("SELECT * FROM bootstrap_authorizations WHERE commitment_ref=?", commitment?.commitment_ref);
    if (!commitment || !attempt || !authorization || commitment.state !== "CONSUMED" || authorization.state !== "AUTHORIZED_ONCE") dss02Fail("DSS02_BOOTSTRAP_CHAIN_BROKEN");
    if (!this.installationRoot || !this.profileRoot) dss02Fail("DSS02_BOOTSTRAP_ROOT_CONTEXT_MISSING");
    bootstrap.verifyBootstrapArtifacts({ installationRoot: this.installationRoot, profileRoot: this.profileRoot, commitmentRow: commitment, attemptRow: attempt, authorizationRow: authorization });
    if (attempt.commitment_ref !== commitment.commitment_ref || authorization.attempt_ref !== attempt.attempt_ref || authorization.commitment_ref !== commitment.commitment_ref) dss02Fail("DSS02_BOOTSTRAP_CHAIN_BROKEN");
    return true;
  }

  reconcileCapacity() {
    const counter = this.store.get("SELECT * FROM capacity_counters WHERE singleton=1");
    if (!counter) dss02Fail("DSS02_CAPACITY_UNINITIALIZED");
    const jobs = this.store.all("SELECT state,request_bytes FROM jobs");
    const openStates = new Set(["ADMITTED", "HANDOFF_COMMITTED", "RECOVERY_BLOCKED"]);
    const openJobs = jobs.filter((job) => openStates.has(job.state));
    const expectedBytes = openJobs.reduce((total, job) => total + Number(job.request_bytes), 0);
    const expectedSubscriptions = Number(this.store.get("SELECT COUNT(*) AS count FROM subscriptions WHERE state='ACTIVE'").count);
    const expectedOffers = Number(this.store.get("SELECT COUNT(*) AS count FROM delivery_offers WHERE state='OFFERED'").count);
    const expectedRetained = Number(this.store.get("SELECT COALESCE(SUM(a.byte_length),0) AS bytes FROM delivery_offers o JOIN artifacts a ON a.artifact_ref=o.projection_artifact_ref WHERE o.state='OFFERED'").bytes);
    if (Number(counter.open_jobs) !== openJobs.length || Number(counter.request_bytes) !== expectedBytes || Number(counter.subscriptions) !== expectedSubscriptions || Number(counter.outstanding_offers) !== expectedOffers || Number(counter.retained_projection_bytes) !== expectedRetained) dss02Fail("DSS02_CAPACITY_RECONSTRUCTION_MISMATCH");
    checkedInteger(Number(counter.counter_event_head), "capacity counter event head");
    if (Number(counter.counter_event_head) > this.store.latestGlobalSequence()) dss02Fail("DSS02_CAPACITY_RECONSTRUCTION_MISMATCH");
    return true;
  }

  reconcileDelivery() {
    const subscriptions = this.store.all("SELECT * FROM subscriptions");
    for (const subscription of subscriptions) {
      const cursor = this.store.get("SELECT * FROM delivery_cursors WHERE subscription_ref=?", subscription.subscription_ref);
      const job = this.store.get("SELECT event_sequence FROM jobs WHERE job_ref=?", subscription.job_ref);
      if (!cursor || !job || cursor.subscription_revision !== subscription.revision || cursor.acknowledged_sequence < subscription.starting_cursor || cursor.acknowledged_sequence > job.event_sequence) dss02Fail("DSS02_DELIVERY_CURSOR_RECONSTRUCTION_MISMATCH");
    }
    for (const offer of this.store.all("SELECT * FROM delivery_offers")) {
      if (!this.store.get("SELECT subscription_ref FROM subscriptions WHERE subscription_ref=?", offer.subscription_ref)) dss02Fail("DSS02_DELIVERY_OFFER_ORPHAN");
      if (offer.projection_artifact_ref && !this.store.get("SELECT artifact_ref FROM artifacts WHERE artifact_ref=?", offer.projection_artifact_ref)) dss02Fail("DSS02_DELIVERY_OFFER_ARTIFACT_ORPHAN");
      if (offer.state === "ACKNOWLEDGED" && !this.store.get("SELECT acknowledgment_ref FROM delivery_acknowledgments WHERE delivery_attempt_ref=?", offer.delivery_attempt_ref)) dss02Fail("DSS02_DELIVERY_ACK_RECONSTRUCTION_MISMATCH");
    }
    return true;
  }

  reconcileGenerationReferences(generationRef) {
    const generations = new Set(this.store.all("SELECT generation_ref FROM daemon_generations").map((row) => row.generation_ref));
    if (!generations.has(generationRef)) dss02Fail("DSS02_GENERATION_UNOPENED");
    for (const row of this.store.all("SELECT daemon_generation FROM authorization_challenges WHERE daemon_generation NOT IN (SELECT generation_ref FROM daemon_generations)")) dss02Fail("DSS02_RECOVERY_GENERATION_ORPHAN", row.daemon_generation);
    for (const row of this.store.all("SELECT daemon_generation FROM leases WHERE daemon_generation NOT IN (SELECT generation_ref FROM daemon_generations)")) dss02Fail("DSS02_RECOVERY_GENERATION_ORPHAN", row.daemon_generation);
    for (const row of this.store.all("SELECT generation_revision FROM delivery_offers WHERE generation_revision NOT IN (SELECT generation_ref FROM daemon_generations)")) dss02Fail("DSS02_RECOVERY_GENERATION_ORPHAN", row.generation_revision);
    return true;
  }

  reconcileForeignKeys() {
    for (const receipt of this.store.all("SELECT * FROM authorization_receipts")) {
      if (!this.store.get("SELECT challenge_ref FROM authorization_challenges WHERE challenge_ref=?", receipt.challenge_ref)) dss02Fail("DSS02_AUTHORIZATION_RECEIPT_ORPHAN");
      if (receipt.verifier_ref && !this.store.get("SELECT verifier_ref FROM verifiers WHERE verifier_ref=?", receipt.verifier_ref)) dss02Fail("DSS02_AUTHORIZATION_RECEIPT_ORPHAN");
    }
    for (const verifier of this.store.all("SELECT * FROM verifiers")) {
      if (!this.store.get("SELECT principal_ref FROM principals WHERE principal_ref=?", verifier.principal_ref)) dss02Fail("DSS02_VERIFIER_PRINCIPAL_ORPHAN");
      if (verifier.issuer_revision !== "owner-bootstrap-issuer@1" && !this.store.get("SELECT verifier_revision FROM verifiers WHERE verifier_revision=?", verifier.issuer_revision)) dss02Fail("DSS02_VERIFIER_ISSUER_ORPHAN");
      for (const revision of JSON.parse(verifier.registry_revisions_json)) if (!this.store.get("SELECT revision_ref FROM registry_revisions WHERE revision_ref=?", revision)) dss02Fail("DSS02_REGISTRY_REVISION_ORPHAN");
    }
    for (const acknowledgment of this.store.all("SELECT * FROM delivery_acknowledgments")) if (!this.store.get("SELECT delivery_attempt_ref FROM delivery_offers WHERE delivery_attempt_ref=?", acknowledgment.delivery_attempt_ref)) dss02Fail("DSS02_ACKNOWLEDGMENT_ORPHAN");
    for (const cancellation of this.store.all("SELECT * FROM cancellation_decisions")) if (!this.store.get("SELECT job_ref FROM jobs WHERE job_ref=?", cancellation.job_ref)) dss02Fail("DSS02_CANCELLATION_ORPHAN");
    return true;
  }

  reconcileDatabase() {
    const integrity = this.store.all("PRAGMA integrity_check");
    if (!integrity.length || integrity.some((row) => Object.values(row)[0] !== "ok")) dss02Fail("DSS02_SQLITE_INTEGRITY_FAILURE");
    if (this.store.all("PRAGMA foreign_key_check").length) dss02Fail("DSS02_SQLITE_FOREIGN_KEY_FAILURE");
  }

  recover({ generationRef, ownerRootStatus = "PINNED", ownerRootFingerprint = undefined, waiterGate = this.waiterGate } = {}) {
    if (ownerRootStatus !== "PINNED") return this.blocked(generationRef, "DSS02_OWNER_ROOT_BROKEN");
    const startedAt = this.clock(); let inventoryBefore;
    try {
      inventoryBefore = this.store.inventory();
      const root = this.store.get("SELECT * FROM owner_roots WHERE profile_ref=?", this.store.profileRef);
      if (!root) return this.blocked(generationRef, "DSS02_OWNER_ROOT_RECORD_MISSING");
      if (ownerRootFingerprint && root.owner_root_fingerprint !== ownerRootFingerprint) return this.blocked(generationRef, "DSS02_OWNER_ROOT_MISMATCH");
      this.reconcileDatabase(); this.ledger.verify(); this.ledger.assertHeads(); this.cas.verifyReferences(); this.quarantine.verify();
      this.reconcileBootstrap(); this.authority.reconcileEvents(); this.reconcileForeignKeys(); this.reconcileGenerationReferences(generationRef); this.reconcileJobs(); this.reconcileDelivery(); this.reconcileCapacity();
    } catch (error) { return this.blocked(generationRef, error.code || "DSS02_RECOVERY_INTEGRITY_FAILURE"); }
    const classifications = []; const now = this.clock();
    try {
      this.store.transaction((tx) => {
        const challengeResult = tx.run("UPDATE authorization_challenges SET state='INVALIDATED_BY_RESTART',state_revision=state_revision+1,consumed_at=? WHERE daemon_generation<>? AND state='ISSUED'", now, generationRef);
        if (challengeResult.changes) classifications.push({ kind: "authorization_challenge", count: challengeResult.changes, classification: "INVALIDATED_BY_RESTART" });
        const leaseResult = tx.run("UPDATE leases SET state='ABANDONED',disposition='ABANDON',released_at=? WHERE daemon_generation<>? AND state='ACTIVE'", now, generationRef);
        if (leaseResult.changes) classifications.push({ kind: "lease", count: leaseResult.changes, classification: "ABANDONED" });
        const oldOffers = tx.all("SELECT * FROM delivery_offers WHERE state='OFFERED' AND generation_revision<>?", generationRef);
        for (const offer of oldOffers) {
          tx.run("UPDATE delivery_offers SET state='EXPIRED_UNACKNOWLEDGED' WHERE delivery_attempt_ref=? AND state='OFFERED'", offer.delivery_attempt_ref);
          const artifact = tx.get("SELECT byte_length FROM artifacts WHERE artifact_ref=?", offer.projection_artifact_ref);
          if (artifact) tx.run("UPDATE artifacts SET reference_count=CASE WHEN reference_count>0 THEN reference_count-1 ELSE 0 END WHERE artifact_ref=?", offer.projection_artifact_ref);
          const event = this.ledger.appendInTransaction(tx, { eventType: "recovery_classification", payload: { kind: "delivery_offer", deliveryAttemptRef: offer.delivery_attempt_ref, classification: "EXPIRED_UNACKNOWLEDGED" }, recordedAt: now });
          this.capacity.acknowledgeOfferInTransaction(tx, Number(artifact?.byte_length || 0), { eventHead: event.globalSequence });
          this.capacity.setCounterEventHeadInTransaction(tx, event.globalSequence);
        }
        if (oldOffers.length) classifications.push({ kind: "delivery_offer", count: oldOffers.length, classification: "EXPIRED_UNACKNOWLEDGED" });
        const waiterBefore = waiterGate?.observation();
        if (waiterBefore?.activeCount) classifications.push({ kind: "waiter_population", classification: "RESET", count: waiterBefore.activeCount });
        for (const classification of classifications.filter((item) => item.kind !== "waiter_population" || item.count)) this.ledger.appendInTransaction(tx, { eventType: "recovery_classification", payload: classification, recordedAt: now });
      });
    } catch (error) { return this.blocked(generationRef, error.code || "DSS02_RECOVERY_CLASSIFICATION_FAILED"); }
    if (waiterGate) waiterGate.invalidateRestart(generationRef);
    const inventoryAfter = this.store.inventory();
    const disposition = { schema: "direct_semantic_recovery_disposition@1", dispositionRef: randomRef("recovery"), daemonGeneration: generationRef, inventoryDigest: inventoryBefore.inventoryDigest, populationDigests: inventoryBefore.populations, classifications, globalEventHead: this.store.latestGlobalSequence(), state: classifications.length ? "RECOVERY_EVENTS_APPENDED" : "READY", startedAt, recordedAt: now, postInventoryDigest: inventoryAfter.inventoryDigest };
    this.store.run("INSERT INTO recovery_dispositions(disposition_ref,daemon_generation,inventory_digest,population_digests_json,state,classifications_json,global_event_head,recorded_at) VALUES(?,?,?,?,?,?,?,?)", disposition.dispositionRef, generationRef, disposition.inventoryDigest, canonicalJson(disposition.populationDigests), disposition.state, canonicalJson(classifications), disposition.globalEventHead, now);
    this.store.ready = true;
    return Object.freeze(disposition);
  }

  blocked(generationRef, reasonCode) {
    const now = this.clock(); const inventory = this.store.inventory();
    const disposition = { schema: "direct_semantic_recovery_disposition@1", dispositionRef: randomRef("recovery"), daemonGeneration: generationRef, inventoryDigest: inventory.inventoryDigest, populationDigests: inventory.populations, classifications: [{ classification: "BLOCKED", reasonCode }], globalEventHead: this.store.latestGlobalSequence(), state: "BLOCKED", recordedAt: now };
    this.store.run("INSERT INTO recovery_dispositions(disposition_ref,daemon_generation,inventory_digest,population_digests_json,state,classifications_json,global_event_head,recorded_at) VALUES(?,?,?,?,?,?,?,?)", disposition.dispositionRef, generationRef, disposition.inventoryDigest, canonicalJson(disposition.populationDigests), disposition.state, canonicalJson(disposition.classifications), disposition.globalEventHead, now);
    this.store.ready = false; return Object.freeze(disposition);
  }

  latest() { const row = this.store.get("SELECT * FROM recovery_dispositions ORDER BY recorded_at DESC LIMIT 1"); return row ? { schema: "direct_semantic_recovery_disposition@1", dispositionRef: row.disposition_ref, daemonGeneration: row.daemon_generation, inventoryDigest: row.inventory_digest, populationDigests: JSON.parse(row.population_digests_json), state: row.state, classifications: JSON.parse(row.classifications_json), globalEventHead: row.global_event_head, recordedAt: row.recorded_at } : null; }
}

function createDss02Recovery(options) { return new Dss02Recovery(options); }

module.exports = { Dss02Recovery, RecoveryService: Dss02Recovery, createDss02Recovery };
