"use strict";

const {
  dss02Fail,
  isoNow,
  digestObject,
  checkedInteger,
  checkedAdd,
  checkedSubtract,
  randomRef,
  canonicalJson,
} = require("./dss02-common");

const DEFAULT_LIMITS = Object.freeze({
  openJobs: 100,
  requestBytes: 16 * 1024 * 1024,
  retainedProjectionBytes: 16 * 1024 * 1024,
  subscriptions: 100,
  outstandingOffers: 100,
  waiters: 100,
});

const DIMENSIONS = Object.freeze(["openJobs", "requestBytes", "retainedProjectionBytes", "subscriptions", "outstandingOffers", "waiters"]);

class Dss02Capacity {
  constructor({ store, limits = DEFAULT_LIMITS, policyRevision = "capacity-policy@1", now = undefined } = {}) {
    if (!store) dss02Fail("DSS02_CAPACITY_STORE_REQUIRED");
    this.store = store;
    this.limits = Object.freeze({ ...DEFAULT_LIMITS, ...limits });
    this.policyRevision = policyRevision;
    this.now = now;
    for (const dimension of DIMENSIONS) checkedInteger(this.limits[dimension], dimension, 0);
  }

  clock() { return isoNow(typeof this.now === "function" ? this.now() : this.now); }

  row(tx = undefined) {
    const row = (tx || this.store).get("SELECT * FROM capacity_counters WHERE singleton=1");
    if (!row) dss02Fail("DSS02_CAPACITY_UNINITIALIZED");
    return { openJobs: row.open_jobs, requestBytes: row.request_bytes, retainedProjectionBytes: row.retained_projection_bytes, subscriptions: row.subscriptions, outstandingOffers: row.outstanding_offers, waiterCount: 0, counterEventHead: row.counter_event_head, policyRevision: row.policy_revision, updatedAt: row.updated_at };
  }

  vector(tx = undefined, waiterCount = 0) {
    const row = this.row(tx);
    checkedInteger(waiterCount, "waiterCount");
    return { openJobs: row.openJobs, requestBytes: row.requestBytes, retainedProjectionBytes: row.retainedProjectionBytes, subscriptions: row.subscriptions, outstandingOffers: row.outstandingOffers, waiterCount, policyRevision: this.policyRevision, limits: { ...this.limits }, eventHead: row.counterEventHead };
  }

  posture(vector) {
    for (const dimension of DIMENSIONS) {
      const value = dimension === "waiters" ? vector.waiterCount : vector[dimension];
      if (!Number.isSafeInteger(value) || value < 0) return "OVERFLOW_BLOCKED";
      if (value > this.limits[dimension]) return "BACKPRESSURED";
    }
    return "AVAILABLE";
  }

  identity(vector, posture = this.posture(vector)) {
    return digestObject("DirectSemanticService.BackpressureObservation.v1", { policyRevision: this.policyRevision, limits: this.limits, counters: vector, posture });
  }

  observeInTransaction(tx, { waiterCount = 0, eventHead = undefined } = {}) {
    const vector = this.vector(tx, waiterCount);
    if (eventHead !== undefined) vector.eventHead = checkedInteger(eventHead, "eventHead");
    const posture = this.posture(vector);
    const observationRef = randomRef("capacity-observation");
    tx.run("INSERT INTO capacity_observations(observation_ref,policy_revision,open_jobs,request_bytes,retained_projection_bytes,subscriptions,outstanding_offers,waiter_count,limits_json,waiter_population_revision,event_head,posture,recorded_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)", observationRef, this.policyRevision, vector.openJobs, vector.requestBytes, vector.retainedProjectionBytes, vector.subscriptions, vector.outstandingOffers, vector.waiterCount, canonicalJson(this.limits), vector.waiterPopulationRevision || 0, vector.eventHead ?? vector.eventHead ?? 0, posture, this.clock());
    return Object.freeze({ schema: "direct_semantic_backpressure_observation@1", observationRef, policyRevision: this.policyRevision, limits: { ...this.limits }, counters: vector, posture, decisionDigest: this.identity(vector, posture) });
  }

  applyDeltaInTransaction(tx, deltas = {}, { waiterCount = 0, eventHead = undefined } = {}) {
    const current = this.row(tx);
    const next = { openJobs: current.openJobs, requestBytes: current.requestBytes, retainedProjectionBytes: current.retainedProjectionBytes, subscriptions: current.subscriptions, outstandingOffers: current.outstandingOffers };
    for (const dimension of Object.keys(next)) {
      const delta = deltas[dimension] || 0;
      checkedInteger(delta, `${dimension} delta`, -Number.MAX_SAFE_INTEGER);
      next[dimension] = delta >= 0 ? checkedAdd(next[dimension], delta, dimension) : checkedSubtract(next[dimension], -delta, dimension);
    }
    const vector = { ...next, waiterCount, limits: { ...this.limits }, policyRevision: this.policyRevision, eventHead: eventHead === undefined ? current.counterEventHead : checkedInteger(eventHead, "eventHead") };
    const posture = this.posture(vector);
    if (posture === "OVERFLOW_BLOCKED") dss02Fail("DSS02_CAPACITY_OVERFLOW");
    if (posture === "BACKPRESSURED" && deltas._allowOverLimit !== true) dss02Fail("DSS02_BACKPRESSURED");
    tx.run("UPDATE capacity_counters SET open_jobs=?,request_bytes=?,retained_projection_bytes=?,subscriptions=?,outstanding_offers=?,counter_event_head=?,policy_revision=?,updated_at=? WHERE singleton=1", next.openJobs, next.requestBytes, next.retainedProjectionBytes, next.subscriptions, next.outstandingOffers, vector.eventHead, this.policyRevision, this.clock());
    return { vector, posture };
  }

  reserveJobInTransaction(tx, requestBytes, { waiterCount = 0 } = {}) {
    const current = this.vector(tx, waiterCount);
    const next = { ...current, openJobs: checkedAdd(current.openJobs, 1, "openJobs"), requestBytes: checkedAdd(current.requestBytes, requestBytes, "requestBytes") };
    if (this.posture(next) !== "AVAILABLE") dss02Fail("DSS02_BACKPRESSURED");
    return this.applyDeltaInTransaction(tx, { openJobs: 1, requestBytes }, { waiterCount });
  }

  releaseJobInTransaction(tx, requestBytes, { eventHead = undefined } = {}) {
    return this.applyDeltaInTransaction(tx, { openJobs: -1, requestBytes: -requestBytes }, { eventHead });
  }

  reserveSubscriptionInTransaction(tx) { return this.applyDeltaInTransaction(tx, { subscriptions: 1 }); }
  releaseSubscriptionInTransaction(tx) { return this.applyDeltaInTransaction(tx, { subscriptions: -1 }); }
  reserveOfferInTransaction(tx, projectionBytes) { return this.applyDeltaInTransaction(tx, { outstandingOffers: 1, retainedProjectionBytes: projectionBytes }); }
  acknowledgeOfferInTransaction(tx, projectionBytes, { eventHead } = {}) { return this.applyDeltaInTransaction(tx, { outstandingOffers: -1, retainedProjectionBytes: -projectionBytes }, { eventHead }); }

  setCounterEventHeadInTransaction(tx, eventHead) {
    checkedInteger(eventHead, "eventHead");
    tx.run("UPDATE capacity_counters SET counter_event_head=?,updated_at=? WHERE singleton=1", eventHead, this.clock());
  }

  current({ waiterCount = 0 } = {}) {
    const vector = this.vector(undefined, waiterCount);
    return Object.freeze({ schema: "direct_semantic_service_capacity_posture@1", ...vector, posture: this.posture(vector), decisionDigest: this.identity(vector) });
  }
}

function createDss02Capacity(options) { return new Dss02Capacity(options); }

module.exports = { DEFAULT_LIMITS, DIMENSIONS, Dss02Capacity, CapacityController: Dss02Capacity, createDss02Capacity };
