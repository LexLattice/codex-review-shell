"use strict";

const {
  DSS02_EVENT_DOMAIN,
  DSS02_GLOBAL_CUSTODY_DOMAIN,
  Dss02Error,
  dss02Fail,
  ensureObject,
  canonicalJson,
  digestObject,
  assertNoExecutionClaim,
  isoNow,
  randomRef,
  checkedInteger,
} = require("./dss02-common");

const FORBIDDEN_EVENTS = /(?:execute|execution|microresult|micro_result|evaluate|evaluation|seal|completion|completed|model[_-]?output|worker[_-]?run)/i;

function safeEventType(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(value) || FORBIDDEN_EVENTS.test(value)) dss02Fail("DSS02_EVENT_TYPE_FORBIDDEN");
  return value;
}

function eventEnvelope(input) {
  return {
    schema: "direct_semantic_job_event@1",
    jobRef: input.jobRef || null,
    jobSequence: input.jobSequence === undefined ? null : input.jobSequence,
    globalSequence: input.globalSequence,
    eventType: input.eventType,
    payload: input.payload,
    artifactRef: input.artifactRef || null,
    priorJobEventDigest: input.priorJobEventDigest || null,
    priorGlobalCustodyDigest: input.priorGlobalCustodyDigest || null,
    custodyKeyRevisionRef: input.custodyKeyRevisionRef,
    daemonGeneration: input.daemonGeneration,
    recordedAt: input.recordedAt,
  };
}

class Dss02EventLedger {
  constructor({ store, keyring, now = undefined } = {}) {
    if (!store || !keyring) dss02Fail("DSS02_EVENT_LEDGER_DEPENDENCY");
    this.store = store;
    this.keyring = keyring;
    this.now = now;
    this.listeners = new Set();
  }

  subscribe(listener) {
    if (typeof listener !== "function") return () => {};
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  clock() { return isoNow(typeof this.now === "function" ? this.now() : this.now); }

  currentGeneration(tx = undefined) {
    const row = tx ? tx.get("SELECT * FROM daemon_generations WHERE profile_ref=? AND status='OPEN' ORDER BY opened_at DESC LIMIT 1", this.store.profileRef) : this.store.currentGeneration();
    if (!row) dss02Fail("DSS02_GENERATION_UNOPENED");
    return row.generation_ref;
  }

  keyForSequence(sequence, tx = undefined) {
    const row = (tx || this.store).get("SELECT * FROM custody_keys WHERE effective_after_global_sequence<=? ORDER BY effective_after_global_sequence DESC LIMIT 1", sequence);
    if (!row) dss02Fail("DSS02_CUSTODY_KEY_MISSING");
    return row.custody_key_revision_ref;
  }

  appendInTransaction(tx, { jobRef = null, eventType, payload = {}, artifactRef = null, state = undefined, reducerRevision = "dss02-reducer@1", recordedAt = undefined, daemonGeneration = undefined } = {}) {
    safeEventType(eventType);
    ensureObject(payload, "DSS02_EVENT_PAYLOAD_INVALID");
    assertNoExecutionClaim(payload, "event payload");
    if (artifactRef !== null && typeof artifactRef !== "string") dss02Fail("DSS02_ARTIFACT_REF_INVALID");
    const generation = daemonGeneration || this.currentGeneration(tx);
    if (jobRef !== null) {
      const job = tx.get("SELECT * FROM jobs WHERE job_ref=?", jobRef);
      if (!job) dss02Fail("DSS02_JOB_UNKNOWN");
    }
    const previousGlobal = tx.get("SELECT * FROM service_events ORDER BY global_sequence DESC LIMIT 1");
    const globalSequence = (previousGlobal?.global_sequence || 0) + 1;
    const previousJob = jobRef === null ? null : tx.get("SELECT * FROM service_events WHERE job_ref=? ORDER BY job_sequence DESC LIMIT 1", jobRef);
    const jobSequence = jobRef === null ? null : (previousJob?.job_sequence || 0) + 1;
    const custodyKeyRevisionRef = this.keyForSequence(globalSequence, tx);
    const recorded = recordedAt || this.clock();
    const envelope = eventEnvelope({ jobRef, jobSequence, globalSequence, eventType, payload, artifactRef, priorJobEventDigest: previousJob?.event_digest || null, priorGlobalCustodyDigest: previousGlobal?.global_custody_digest || null, custodyKeyRevisionRef, daemonGeneration: generation, recordedAt: recorded });
    const eventDigest = digestObject(DSS02_EVENT_DOMAIN, envelope);
    const globalCustodyDigest = digestObject(DSS02_GLOBAL_CUSTODY_DOMAIN, { priorGlobalCustodyDigest: previousGlobal?.global_custody_digest || null, eventDigest, globalSequence, custodyKeyRevisionRef });
    const custodyTag = this.keyring.tag(custodyKeyRevisionRef, globalCustodyDigest);
    tx.run("INSERT INTO service_events(global_sequence,job_ref,job_sequence,event_type,payload_json,artifact_ref,prior_job_event_digest,prior_global_custody_digest,custody_key_revision_ref,event_digest,global_custody_digest,custody_tag,daemon_generation,recorded_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)", globalSequence, jobRef, jobSequence, eventType, canonicalJson(payload), artifactRef, previousJob?.event_digest || null, previousGlobal?.global_custody_digest || null, custodyKeyRevisionRef, eventDigest, globalCustodyDigest, custodyTag, generation, recorded);
    if (jobRef !== null) {
      const nextState = state || this.stateForEvent(eventType, tx.get("SELECT state FROM jobs WHERE job_ref=?", jobRef)?.state || "ADMITTED");
      const projectionDigest = digestObject("DirectSemanticService.JobHead.v1", { jobRef, jobSequence, eventDigest, state: nextState, reducerRevision });
      tx.run("UPDATE jobs SET event_sequence=?, event_digest=?, state=?, updated_at=? WHERE job_ref=?", jobSequence, eventDigest, nextState, recorded, jobRef);
      tx.run("INSERT INTO job_heads(job_ref,event_sequence,event_digest,state,reducer_revision,projection_digest,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(job_ref) DO UPDATE SET event_sequence=excluded.event_sequence,event_digest=excluded.event_digest,state=excluded.state,reducer_revision=excluded.reducer_revision,projection_digest=excluded.projection_digest,updated_at=excluded.updated_at", jobRef, jobSequence, eventDigest, nextState, reducerRevision, projectionDigest, recorded);
    }
    const event = Object.freeze({ schema: "direct_semantic_job_event@1", ...envelope, eventDigest, globalCustodyDigest, custodyTag });
    for (const listener of this.listeners) queueMicrotask(() => {
      try { listener(event); } catch (_) {}
    });
    return event;
  }

  append(options = {}) { return this.store.transaction((tx) => this.appendInTransaction(tx, options)); }

  stateForEvent(eventType, current) {
    const normalized = eventType.toLowerCase();
    if (normalized.includes("admit")) return "ADMITTED";
    if (normalized.includes("cancel")) return "CANCELLED_BEFORE_DISPATCH";
    if (normalized.includes("handoff")) return "HANDOFF_COMMITTED";
    if (normalized.includes("recovery") || normalized.includes("block")) return "RECOVERY_BLOCKED";
    return current;
  }

  eventsForJob(jobRef) {
    return this.store.all("SELECT * FROM service_events WHERE job_ref=? ORDER BY job_sequence", jobRef).map((row) => this.rowToEvent(row));
  }

  rowToEvent(row) {
    return { schema: "direct_semantic_job_event@1", jobRef: row.job_ref, jobSequence: row.job_sequence, globalSequence: row.global_sequence, eventType: row.event_type, payload: JSON.parse(row.payload_json), artifactRef: row.artifact_ref, priorJobEventDigest: row.prior_job_event_digest, priorGlobalCustodyDigest: row.prior_global_custody_digest, custodyKeyRevisionRef: row.custody_key_revision_ref, eventDigest: row.event_digest, globalCustodyDigest: row.global_custody_digest, custodyTag: row.custody_tag, daemonGeneration: row.daemon_generation, recordedAt: row.recorded_at };
  }

  verify() {
    this.keyring.verifyLineage();
    const rows = this.store.all("SELECT * FROM service_events ORDER BY global_sequence");
    let priorGlobal = null;
    const priorJob = new Map();
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      if (row.global_sequence !== index + 1) dss02Fail("DSS02_EVENT_GLOBAL_SEQUENCE_GAP");
      const expectedJobSequence = row.job_ref === null ? null : ((priorJob.get(row.job_ref)?.job_sequence || 0) + 1);
      if (row.job_sequence !== expectedJobSequence) dss02Fail("DSS02_EVENT_JOB_SEQUENCE_GAP");
      const envelope = eventEnvelope({ jobRef: row.job_ref, jobSequence: row.job_sequence, globalSequence: row.global_sequence, eventType: row.event_type, payload: JSON.parse(row.payload_json), artifactRef: row.artifact_ref, priorJobEventDigest: row.prior_job_event_digest, priorGlobalCustodyDigest: row.prior_global_custody_digest, custodyKeyRevisionRef: row.custody_key_revision_ref, daemonGeneration: row.daemon_generation, recordedAt: row.recorded_at });
      if (row.prior_global_custody_digest !== (priorGlobal?.global_custody_digest || null)) dss02Fail("DSS02_EVENT_GLOBAL_CHAIN_BROKEN");
      if (row.job_ref !== null && row.prior_job_event_digest !== (priorJob.get(row.job_ref)?.event_digest || null)) dss02Fail("DSS02_EVENT_JOB_CHAIN_BROKEN");
      const eventDigest = digestObject(DSS02_EVENT_DOMAIN, envelope);
      if (eventDigest !== row.event_digest) dss02Fail("DSS02_EVENT_DIGEST_MISMATCH");
      const globalDigest = digestObject(DSS02_GLOBAL_CUSTODY_DOMAIN, { priorGlobalCustodyDigest: row.prior_global_custody_digest, eventDigest, globalSequence: row.global_sequence, custodyKeyRevisionRef: row.custody_key_revision_ref });
      if (globalDigest !== row.global_custody_digest || this.keyring.tag(row.custody_key_revision_ref, globalDigest) !== row.custody_tag) dss02Fail("DSS02_EVENT_CUSTODY_MISMATCH");
      priorGlobal = row;
      if (row.job_ref !== null) priorJob.set(row.job_ref, row);
    }
    return { globalHead: rows.length, globalDigest: priorGlobal?.global_custody_digest || null };
  }

  assertHeads() {
    const jobs = this.store.all("SELECT * FROM jobs");
    for (const job of jobs) {
      const head = this.store.get("SELECT * FROM job_heads WHERE job_ref=?", job.job_ref);
      const event = this.store.get("SELECT * FROM service_events WHERE job_ref=? ORDER BY job_sequence DESC LIMIT 1", job.job_ref);
      const expectedProjectionDigest = head ? digestObject("DirectSemanticService.JobHead.v1", { jobRef: job.job_ref, jobSequence: event?.job_sequence, eventDigest: event?.event_digest, state: job.state, reducerRevision: head.reducer_revision }) : null;
      if (!head || !event || head.event_sequence !== event.job_sequence || head.event_digest !== event.event_digest || job.event_sequence !== event.job_sequence || job.event_digest !== event.event_digest || head.state !== job.state || head.projection_digest !== expectedProjectionDigest) dss02Fail("DSS02_REDUCER_HEAD_DRIFT");
    }
    return true;
  }
}

function createDss02EventLedger(options) { return new Dss02EventLedger(options); }

module.exports = { Dss02EventLedger, EventLedger: Dss02EventLedger, createDss02EventLedger, eventEnvelope };
