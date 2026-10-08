"use strict";

const { EventEmitter } = require("node:events");
const { canonicalJson, parseJsonStrict, digestObject } = require("./dss02-common");
const { validatePack, snapshotForRequest, runCompiler, materializePage, objectDigest, sha256, exact, fail } = require("./commissioning-compiler");
const { runClosedPage } = require("./commissioning-process");
const { runProviderPage, buildProviderRequest } = require("./commissioning-provider");

const REVISION = "commissioning-v1";
const TABLES = `
CREATE TABLE IF NOT EXISTS commissioning_records (
  sequence INTEGER PRIMARY KEY NOT NULL,
  record_ref TEXT UNIQUE NOT NULL,
  job_ref TEXT,
  kind TEXT NOT NULL,
  envelope_json TEXT NOT NULL,
  record_digest TEXT UNIQUE NOT NULL,
  custody_tag TEXT NOT NULL,
  anchor_digest TEXT UNIQUE NOT NULL
);
CREATE TABLE IF NOT EXISTS commissioning_heads (
  job_ref TEXT PRIMARY KEY NOT NULL,
  revision INTEGER NOT NULL,
  record_ref TEXT UNIQUE NOT NULL
);
CREATE TABLE IF NOT EXISTS commissioning_objects (
  object_ref TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL,
  content_digest TEXT NOT NULL,
  byte_length INTEGER NOT NULL,
  bytes_base64 TEXT NOT NULL
);
`;
const TERMINAL = new Set(["TERMINAL"]);
const TRANSITIONS = Object.freeze({
  QUEUED: ["COMPILER_STARTED", "TERMINAL"],
  COMPILER_STARTED: ["COMPILER_CAPTURED", "TERMINAL"],
  COMPILER_CAPTURED: ["PAGE_MATERIALIZED", "TERMINAL"],
  PAGE_MATERIALIZED: ["WORKER_STARTED", "TERMINAL"],
  WORKER_STARTED: ["RAW_CAPTURED", "TERMINAL"],
  RAW_CAPTURED: ["TERMINAL"],
  TERMINAL: [],
});
const same = (a, b) => canonicalJson(a) === canonicalJson(b);
function now() { return new Date().toISOString(); }
function decodeBase64(text) {
  if (typeof text !== "string") fail("COMMISSIONING_RAW_ENCODING_INVALID");
  const bytes = Buffer.from(text, "base64");
  if (bytes.toString("base64") !== text) fail("COMMISSIONING_RAW_ENCODING_INVALID");
  return bytes;
}

// Pure admission is intentionally independent of the worker's reasoning.
// It checks admissibility and exact bindings; it does not agree with a verdict.
function admitWorkerResponse({ pack, page, attemptRef, observation }) {
  const rejected = (reasonCode) => ({ admission: "REJECTED", disposition: "REMANDS", reasonCode, evidenceRefs: [], proofStatus: "UNPROVEN", authorityEffect: "none" });
  try {
    if (pack.provider) {
      const d = pack.provider;
      if (observation.schema !== "direct_commissioning_provider_observation@1" || observation.status !== "CAPTURED" || observation.attemptRef !== attemptRef || observation.pageDigest !== objectDigest(page) || observation.adapterDigest !== d.adapterDigest || observation.transportDigest !== d.transportDigest || observation.hostNodeDigest !== d.hostNodeDigest || observation.requestDigest !== objectDigest(buildProviderRequest({ attemptRef, page }))) return rejected("PROVIDER_OBSERVATION_BINDING_REJECTED");
      if (!same(observation.isolation, { kind: "remote_closed_request", observedToolCount: 0, priorContext: false, exactRequestBound: true }) || observation.requestCount !== 1 || observation.httpStatus < 200 || observation.httpStatus >= 300) return rejected("PROVIDER_ISOLATION_REJECTED");
      const wire = decodeBase64(observation.wireBase64);
      if (!wire.length || wire.length > d.maximumWireBytes || sha256(wire) !== observation.wireDigest) return rejected("PROVIDER_WIRE_REJECTED");
    } else {
    if (observation.schema !== "direct_commissioning_process_observation@1" || observation.status !== "CAPTURED" || observation.exitCode !== 0 || observation.attemptRef !== attemptRef || observation.pageDigest !== objectDigest(page) || observation.workerDigest !== pack.worker.workerDigest) return rejected("WORKER_OBSERVATION_BINDING_REJECTED");
    const isolation = observation.isolation;
    if (isolation?.network !== "OBSERVED_UNSHARED" || isolation?.work !== "OBSERVED_READ_ONLY" || isolation?.launcherDigest !== pack.worker.launcherDigest || isolation?.nodeDigest !== pack.worker.nodeDigest) return rejected("WORKER_ISOLATION_REJECTED");
    }
    const raw = decodeBase64(observation.stdoutBase64);
    const stderr = decodeBase64(observation.stderrBase64 || "");
    if (raw.length + stderr.length > pack.attemptPolicy.maximumRawBytes) return rejected("WORKER_RAW_BUDGET_REJECTED");
    const value = parseJsonStrict(raw.toString("utf8"));
    exact(value, ["schema", "attemptRef", "pageRef", "status", "reasonCode", "evidenceRefs", "authorityEffect"]);
    if (value.schema !== "direct_commissioning_chain_response@1" || value.attemptRef !== attemptRef || value.pageRef !== page.pageRef || value.authorityEffect !== "none") return rejected("WORKER_RESPONSE_BINDING_REJECTED");
    if (!["SUPPORTS", "REFUTES", "INCONCLUSIVE", "REMANDS"].includes(value.status) || typeof value.reasonCode !== "string" || !/^[A-Z][A-Z0-9_]{0,99}$/.test(value.reasonCode) || !Array.isArray(value.evidenceRefs) || new Set(value.evidenceRefs).size !== value.evidenceRefs.length) return rejected("WORKER_RESPONSE_SHAPE_REJECTED");
    const closedReferences = new Set(page.evidence.nodes.map((node) => node.bindingRef));
    if (value.evidenceRefs.some((ref) => !closedReferences.has(ref))) return rejected("WORKER_EVIDENCE_EXPANSION_REJECTED");
    return { admission: "ADMITTED_ADVISORY", disposition: value.status, reasonCode: value.reasonCode, evidenceRefs: value.evidenceRefs, proofStatus: "UNPROVEN", authorityEffect: "none" };
  } catch (_) { return rejected("WORKER_MALFORMED_RESPONSE"); }
}

class CommissioningCoordinator extends EventEmitter {
  constructor({ daemon, pack }) {
    super();
    this.daemon = daemon;
    this.store = daemon.store;
    this.pack = pack;
    this.active = null;
    this.closing = false;
    this.scheduled = false;
    this.blockedReason = null;
  }

  open() {
    validatePack(this.pack);
    this.store.requireOpen().exec(TABLES);
    const expectedSchema = objectDigest(TABLES);
    const priorSchema = this.store.getMeta("commissioning-schema-v1");
    if (priorSchema && priorSchema !== expectedSchema) fail("COMMISSIONING_SCHEMA_MISMATCH");
    const installation = this.store.get("SELECT * FROM commissioning_records WHERE kind='INSTALL' ORDER BY sequence LIMIT 1");
    if (installation && !priorSchema) fail("COMMISSIONING_SCHEMA_MISSING");
    if (!installation) {
      if (this.store.get("SELECT sequence FROM commissioning_records LIMIT 1") || this.store.get("SELECT object_ref FROM commissioning_objects LIMIT 1")) fail("COMMISSIONING_INSTALLATION_ORPHAN");
      this.store.transaction((tx) => {
        tx.run("INSERT INTO dss_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", "commissioning-schema-v1", canonicalJson(expectedSchema));
        this.append(tx, "INSTALL", null, { packDigest: this.pack.packDigest, revision: REVISION, authorityEffect: "none" });
      });
    }
    this.reconcile();
    // DSS02 admission is the durable outbox. Rebuild any queue row that was
    // not committed before the submitting process/daemon disappeared.
    for (const job of this.store.all("SELECT * FROM jobs ORDER BY created_at,job_ref")) this.ensureJob(job.job_ref);
    for (const row of this.store.all("SELECT job_ref FROM commissioning_heads")) {
      const state = this.state(row.job_ref);
      if (["COMPILER_STARTED", "WORKER_STARTED"].includes(state.status)) this.finish(state, { admission: "NOT_ATTEMPTED", disposition: "REMANDS", reasonCode: "PROCESS_INTERRUPTED_WITHOUT_DURABLE_OUTPUT", evidenceRefs: [], proofStatus: "UNPROVEN", authorityEffect: "none" });
    }
    this.reconcile();
    return this;
  }

  append(tx, kind, jobRef, body) {
    const previous = tx.get("SELECT sequence,record_digest FROM commissioning_records ORDER BY sequence DESC LIMIT 1");
    const sequence = (previous?.sequence || 0) + 1;
    const custodyKeyRevisionRef = this.daemon.keyring.current().custodyKeyRevisionRef;
    const envelope = { schema: "direct_commissioning_custody_record@1", sequence, kind, jobRef, previousDigest: previous?.record_digest || null, body, daemonGeneration: this.daemon.generation.generationRef, custodyKeyRevisionRef };
    const recordDigest = objectDigest(envelope);
    const recordRef = `commissioning-record:${recordDigest.slice(7)}`;
    const custodyTag = this.daemon.keyring.tag(custodyKeyRevisionRef, recordDigest);
    // The frozen ledger sees only an opaque custody commitment, not a later
    // execution event or a reinterpretation of its job state.
    const anchor = this.daemon.ledger.appendInTransaction(tx, { eventType: "commissioning_record_committed", payload: { recordRef, recordDigest, sequence, kind } });
    tx.run("INSERT INTO commissioning_records(sequence,record_ref,job_ref,kind,envelope_json,record_digest,custody_tag,anchor_digest) VALUES(?,?,?,?,?,?,?,?)", sequence, recordRef, jobRef, kind, canonicalJson(envelope), recordDigest, custodyTag, anchor.eventDigest);
    return { recordRef, recordDigest, sequence };
  }

  putObject(tx, kind, value) {
    const bytes = Buffer.from(canonicalJson(value), "utf8");
    if (bytes.length > 4 * 1024 * 1024) fail("COMMISSIONING_OBJECT_BUDGET");
    const digest = sha256(bytes);
    const objectRef = `commissioning-object:${objectDigest({ kind, digest }).slice(7)}`;
    const existing = tx.get("SELECT * FROM commissioning_objects WHERE object_ref=?", objectRef);
    if (existing) {
      if (existing.content_digest !== digest || existing.bytes_base64 !== bytes.toString("base64") || existing.kind !== kind) fail("COMMISSIONING_OBJECT_CONFLICT");
      return objectRef;
    }
    const total = tx.get("SELECT COUNT(*) AS count,COALESCE(SUM(byte_length),0) AS bytes FROM commissioning_objects");
    if (total.count >= 1024 || total.bytes + bytes.length > 128 * 1024 * 1024) fail("COMMISSIONING_OBJECT_CAPACITY");
    tx.run("INSERT INTO commissioning_objects(object_ref,kind,content_digest,byte_length,bytes_base64) VALUES(?,?,?,?,?)", objectRef, kind, digest, bytes.length, bytes.toString("base64"));
    this.append(tx, "OBJECT", null, { objectRef, kind, digest, byteLength: bytes.length });
    return objectRef;
  }

  object(objectRef) {
    const row = this.store.get("SELECT * FROM commissioning_objects WHERE object_ref=?", objectRef);
    if (!row) fail("COMMISSIONING_OBJECT_MISSING");
    const bytes = decodeBase64(row.bytes_base64);
    if (bytes.length !== row.byte_length || sha256(bytes) !== row.content_digest || `commissioning-object:${objectDigest({ kind: row.kind, digest: row.content_digest }).slice(7)}` !== objectRef) fail("COMMISSIONING_OBJECT_CORRUPT");
    return parseJsonStrict(bytes.toString("utf8"), { maximumBytes: 4 * 1024 * 1024 });
  }

  state(jobRef) {
    const row = this.store.get("SELECT r.*,h.revision AS head_revision FROM commissioning_heads h JOIN commissioning_records r ON r.record_ref=h.record_ref WHERE h.job_ref=?", jobRef);
    if (!row) return null;
    const envelope = JSON.parse(row.envelope_json);
    if (envelope.jobRef !== jobRef || envelope.body.jobRef !== jobRef || envelope.body.revision !== row.head_revision || objectDigest(envelope) !== row.record_digest || row.record_ref !== `commissioning-record:${row.record_digest.slice(7)}` || this.daemon.keyring.tag(envelope.custodyKeyRevisionRef, row.record_digest) !== row.custody_tag) fail("COMMISSIONING_CURRENT_STATE_CORRUPT");
    return envelope.body;
  }

  writeState(tx, state) {
    const record = this.append(tx, "JOB", state.jobRef, state);
    tx.run("INSERT INTO commissioning_heads(job_ref,revision,record_ref) VALUES(?,?,?) ON CONFLICT(job_ref) DO UPDATE SET revision=excluded.revision,record_ref=excluded.record_ref", state.jobRef, state.revision, record.recordRef);
    return state;
  }

  transition(state, nextStatus, patch = {}, objects = {}) {
    if (state.status !== nextStatus && !TRANSITIONS[state.status]?.includes(nextStatus)) fail("COMMISSIONING_TRANSITION_INVALID");
    let result;
    this.store.transaction((tx) => {
      const head = tx.get("SELECT revision FROM commissioning_heads WHERE job_ref=?", state.jobRef);
      if (!head || head.revision !== state.revision) fail("COMMISSIONING_STATE_CONFLICT");
      const objectRefs = {};
      for (const [key, value] of Object.entries(objects)) objectRefs[key] = this.putObject(tx, key, value);
      result = this.writeState(tx, { ...state, ...patch, ...objectRefs, status: nextStatus, revision: state.revision + 1, updatedAt: now() });
    });
    queueMicrotask(() => this.emit("change", result.jobRef));
    return result;
  }

  durableAdmission(job) {
    const request = JSON.parse(job.request_json);
    const snapshot = snapshotForRequest(this.pack, request);
    if (digestObject("DirectSemanticService.SemanticJobRequest.v1", request) !== job.request_digest) fail("COMMISSIONING_ADMISSION_REQUEST_CORRUPT");
    const receipt = this.store.get("SELECT * FROM authorization_receipts WHERE decision='AUTHORIZED' AND operation='submit' AND request_digest=? AND principal_ref=? AND verifier_ref=? ORDER BY authorized_at,receipt_ref LIMIT 1", job.request_digest, job.principal_ref, job.verifier_ref);
    if (!receipt) fail("COMMISSIONING_ADMISSION_AUTHORIZATION_MISSING");
    return { receipt, snapshot };
  }

  ensureJob(jobRef) {
    const existing = this.state(jobRef);
    if (existing) return existing;
    const job = this.store.get("SELECT * FROM jobs WHERE job_ref=?", jobRef);
    if (!job) fail("COMMISSIONING_JOB_UNKNOWN");
    const { receipt, snapshot } = this.durableAdmission(job);
    if (this.store.get("SELECT COUNT(*) AS count FROM commissioning_heads").count >= 64) fail("COMMISSIONING_JOB_CAPACITY");
    const state = { schema: "direct_commissioning_job@1", jobRef, principalRef: job.principal_ref, verifierRef: job.verifier_ref, authorizationRef: receipt.receipt_ref, requestDigest: job.request_digest, packDigest: this.pack.packDigest, snapshotRef: snapshot.snapshotRef, status: "QUEUED", revision: 1, attemptRef: `commissioning-attempt:${objectDigest({ jobRef, packDigest: this.pack.packDigest }).slice(7)}`, attemptOrdinal: 0, handoffDigest: null, compilerObservationRef: null, pageRef: null, workerObservationRef: null, disposition: null, subscription: null, delivery: null, createdAt: job.created_at, updatedAt: now() };
    this.store.transaction((tx) => this.writeState(tx, state));
    return state;
  }

  handoff(state) {
    const job = this.store.get("SELECT * FROM jobs WHERE job_ref=?", state.jobRef);
    const { receipt } = this.durableAdmission(job);
    // This is revalidation of a durable delegated admission, not acceptance
    // of an old challenge as a new client proof.
    this.daemon.authority.assertCurrentVerifier(job.verifier_ref, { operation: "submit" });
    const boundary = this.daemon.dispatch.get(state.jobRef);
    if (boundary.state === "HANDOFF_COMMITTED") {
      if (boundary.targetTrancheRevision !== REVISION) fail("COMMISSIONING_FOREIGN_HANDOFF");
      return boundary.handoffEventDigest;
    }
    if (job.state === "CANCELLED_BEFORE_DISPATCH") fail("COMMISSIONING_CANCELLED_BEFORE_DISPATCH");
    const lease = this.daemon.leases.acquire({ subjectRef: state.jobRef, operationClass: "handoff", daemonGeneration: this.daemon.generation.generationRef }).lease;
    try {
      const handoff = this.daemon.dispatch.handoff({ jobRef: state.jobRef, authorizationReceipt: { receiptRef: receipt.receipt_ref, decision: receipt.decision, operation: receipt.operation, principalRef: receipt.principal_ref, verifierRef: receipt.verifier_ref }, targetTrancheRevision: REVISION, leaseRef: lease.leaseRef, leaseRevision: lease.leaseRevision, fencingToken: lease.fencingToken, daemonGeneration: lease.daemonGeneration });
      return handoff.handoffEventDigest;
    } finally { this.daemon.leases.release({ leaseRef: lease.leaseRef, expectedRevision: lease.leaseRevision, fencingToken: lease.fencingToken, daemonGeneration: lease.daemonGeneration }); }
  }

  schedule() {
    if (this.scheduled || this.active || this.closing || this.blockedReason) return;
    this.scheduled = true;
    setImmediate(() => { this.scheduled = false; this.drain().catch((error) => { this.blockedReason = error.code || "COMMISSIONING_COORDINATOR_FAILED"; this.emit("blocked", this.blockedReason); }); });
  }

  async drain() {
    if (this.active || this.closing || this.blockedReason) return;
    const candidate = this.store.all("SELECT job_ref FROM commissioning_heads ORDER BY rowid").map((row) => this.state(row.job_ref)).find((state) => !TERMINAL.has(state.status));
    if (!candidate) return;
    const controller = new AbortController();
    const task = this.runJob(candidate, controller.signal);
    this.active = { controller, task };
    try { await task; } finally { this.active = null; }
    this.schedule();
  }

  async runJob(initial, signal) {
    let state = initial;
    try {
      validatePack(this.pack);
      if (state.status === "QUEUED") {
        const handoffDigest = this.handoff(state);
        state = this.transition(state, "COMPILER_STARTED", { handoffDigest, attemptOrdinal: 1, startedGeneration: this.daemon.generation.generationRef });
        const observation = await runCompiler(this.pack, { signal });
        state = this.transition(this.state(state.jobRef), "COMPILER_CAPTURED", {}, { compilerObservationRef: observation });
      }
      if (state.status === "COMPILER_CAPTURED") {
        const compilerObservation = this.object(state.compilerObservationRef);
        if (compilerObservation.status !== "CAPTURED") return this.finish(state, { admission: "NOT_ATTEMPTED", disposition: "REMANDS", reasonCode: compilerObservation.reasonCode, evidenceRefs: [], proofStatus: "UNPROVEN", authorityEffect: "none" });
        const snapshot = this.pack.snapshots.find((row) => row.snapshotRef === state.snapshotRef);
        const materialized = materializePage(this.pack, snapshot, compilerObservation);
        state = this.transition(state, "PAGE_MATERIALIZED", { pageDigest: materialized.pageDigest, compilationDigest: materialized.compilationDigest, fullObligationCount: materialized.fullObligationCount, selectedObligationCount: materialized.selectedObligationCount }, { pageRef: materialized.page });
      }
      if (state.status === "PAGE_MATERIALIZED") {
        if (signal.aborted || this.closing) fail("COMMISSIONING_HOST_STOPPED_BEFORE_WORKER");
        state = this.transition(state, "WORKER_STARTED");
        const observation = this.pack.provider ? await runProviderPage({ attemptRef: state.attemptRef, page: this.object(state.pageRef), descriptor: this.pack.provider, signal }) : await runClosedPage({ attemptRef: state.attemptRef, page: this.object(state.pageRef), timeoutMs: this.pack.attemptPolicy.workerTimeoutMs, maximumOutputBytes: this.pack.attemptPolicy.maximumRawBytes, signal });
        state = this.transition(this.state(state.jobRef), "RAW_CAPTURED", {}, { workerObservationRef: observation });
      }
      if (state.status === "RAW_CAPTURED") {
        const observation = this.object(state.workerObservationRef);
        const disposition = observation.status === "CAPTURED" ? admitWorkerResponse({ pack: this.pack, page: this.object(state.pageRef), attemptRef: state.attemptRef, observation }) : { admission: "NOT_ATTEMPTED", disposition: "REMANDS", reasonCode: observation.reasonCode, evidenceRefs: [], proofStatus: "UNPROVEN", authorityEffect: "none" };
        return this.finish(state, disposition);
      }
    } catch (error) {
      state = this.state(initial.jobRef);
      if (!state || TERMINAL.has(state.status)) throw error;
      return this.finish(state, { admission: "NOT_ATTEMPTED", disposition: "REMANDS", reasonCode: error.code || "COMMISSIONING_INTERNAL_FAILURE", evidenceRefs: [], proofStatus: "UNPROVEN", authorityEffect: "none" });
    }
  }

  finish(state, disposition) { return this.transition(state, "TERMINAL", { disposition, finalizedAt: now() }); }

  subscribe(state) {
    if (state.subscription) return state;
    return this.transition(state, state.status, { subscription: { subscriptionRef: `commissioning-subscription:${objectDigest({ jobRef: state.jobRef, principalRef: state.principalRef }).slice(7)}`, principalRef: state.principalRef } });
  }

  offer(state) {
    if (!TERMINAL.has(state.status) || state.delivery) return state;
    const projection = { schema: "direct_commissioning_terminal_projection@1", projectionRef: "commissioning-projection-v1", backend: this.pack.provider ? { kind: this.pack.provider.kind, model: this.pack.provider.model, reasoningEffort: this.pack.provider.reasoningEffort } : { kind: "deterministic", revision: this.pack.worker.revision }, jobRef: state.jobRef, principalRef: state.principalRef, requestDigest: state.requestDigest, packDigest: state.packDigest, attemptRef: state.attemptRef, attemptOrdinal: state.attemptOrdinal, pageDigest: state.pageDigest || null, compilationDigest: state.compilationDigest || null, fullObligationCount: state.fullObligationCount || null, selectedObligationCount: state.selectedObligationCount || null, disposition: state.disposition, finalizedAt: state.finalizedAt, authorityEffect: "none" };
    const projectionDigest = objectDigest(projection);
    const delivery = { deliveryAttemptRef: `commissioning-delivery:${objectDigest({ jobRef: state.jobRef, principalRef: state.principalRef, projectionDigest }).slice(7)}`, principalRef: state.principalRef, projectionDigest, state: "OFFERED", acknowledgedAt: null };
    return this.transition(state, state.status, { delivery }, { terminalProjectionRef: projection });
  }

  acknowledge({ deliveryAttemptRef, principalRef, projectionDigest }) {
    const state = this.store.all("SELECT job_ref FROM commissioning_heads").map((row) => this.state(row.job_ref)).find((state) => state.delivery?.deliveryAttemptRef === deliveryAttemptRef);
    if (!state || state.principalRef !== principalRef || state.delivery.principalRef !== principalRef) fail("COMMISSIONING_ACK_SCOPE");
    if (state.delivery.projectionDigest !== projectionDigest || objectDigest(this.object(state.terminalProjectionRef)) !== projectionDigest) fail("COMMISSIONING_ACK_DIGEST_MISMATCH");
    const updated = state.delivery.state === "ACKNOWLEDGED" ? state : this.transition(state, state.status, { delivery: { ...state.delivery, state: "ACKNOWLEDGED", acknowledgedAt: now() } });
    return { schema: "direct_commissioning_acknowledgment@1", jobRef: updated.jobRef, deliveryAttemptRef, projectionDigest, state: "ACKNOWLEDGED", acknowledgedAt: updated.delivery.acknowledgedAt, authorityEffect: "none" };
  }

  view(state, { offer = true } = {}) {
    if (offer) state = this.offer(state);
    return { schema: "direct_commissioning_authorized_view@1", jobRef: state.jobRef, status: state.status, currentCursor: state.revision, subscriptionRef: state.subscription?.subscriptionRef || null, projection: state.terminalProjectionRef ? this.object(state.terminalProjectionRef) : null, delivery: state.delivery ? { deliveryAttemptRef: state.delivery.deliveryAttemptRef, projectionDigest: state.delivery.projectionDigest, state: state.delivery.state } : null, authorityEffect: "none" };
  }

  reconcile() {
    let previous = null;
    const objectBindings = new Map();
    const objectReferences = new Set();
    const jobHeads = new Map();
    let installations = 0;
    for (const row of this.store.all("SELECT * FROM commissioning_records ORDER BY sequence")) {
      const envelope = JSON.parse(row.envelope_json);
      const expectedSequence = previous ? previous.sequence + 1 : 1;
      if (row.sequence !== expectedSequence || envelope.sequence !== row.sequence || envelope.kind !== row.kind || envelope.jobRef !== row.job_ref || envelope.previousDigest !== (previous?.record_digest || null) || objectDigest(envelope) !== row.record_digest || row.record_ref !== `commissioning-record:${row.record_digest.slice(7)}` || this.daemon.keyring.tag(envelope.custodyKeyRevisionRef, row.record_digest) !== row.custody_tag) fail("COMMISSIONING_RECORD_CHAIN_CORRUPT");
      const anchor = this.store.get("SELECT event_type,payload_json FROM service_events WHERE event_digest=?", row.anchor_digest);
      if (!anchor || anchor.event_type !== "commissioning_record_committed" || !same(JSON.parse(anchor.payload_json), { recordRef: row.record_ref, recordDigest: row.record_digest, sequence: row.sequence, kind: row.kind })) fail("COMMISSIONING_CUSTODY_ANCHOR_BROKEN");
      if (row.kind === "INSTALL") {
        installations += 1;
        if (row.sequence !== 1 || envelope.body.packDigest !== this.pack.packDigest || envelope.body.revision !== REVISION) fail("COMMISSIONING_INSTALLATION_MISMATCH");
      } else if (row.kind === "OBJECT") {
        const body = envelope.body;
        if (objectBindings.has(body.objectRef)) fail("COMMISSIONING_OBJECT_REBINDING");
        const object = this.store.get("SELECT * FROM commissioning_objects WHERE object_ref=?", body.objectRef);
        if (!object || object.content_digest !== body.digest || object.kind !== body.kind || object.byte_length !== body.byteLength) fail("COMMISSIONING_OBJECT_CUSTODY_BROKEN");
        this.object(body.objectRef);
        objectBindings.set(body.objectRef, body);
      } else if (row.kind === "JOB") {
        const state = envelope.body;
        const prior = jobHeads.get(row.job_ref);
        if (state.jobRef !== row.job_ref || state.revision !== (prior ? prior.state.revision + 1 : 1) || state.packDigest !== this.pack.packDigest || !TRANSITIONS[state.status]) fail("COMMISSIONING_JOB_HISTORY_BROKEN");
        if (!prior && state.status !== "QUEUED") fail("COMMISSIONING_JOB_GENESIS_BROKEN");
        if (prior && prior.state.status !== state.status && !TRANSITIONS[prior.state.status].includes(state.status)) fail("COMMISSIONING_JOB_TRANSITION_BROKEN");
        if (prior) {
          for (const field of ["jobRef", "principalRef", "verifierRef", "authorizationRef", "requestDigest", "packDigest", "snapshotRef", "attemptRef", "createdAt"]) if (!same(prior.state[field], state[field])) fail("COMMISSIONING_JOB_IDENTITY_REBOUND");
          for (const field of ["handoffDigest", "compilerObservationRef", "pageRef", "workerObservationRef", "terminalProjectionRef", "disposition", "subscription"]) if (prior.state[field] && !same(prior.state[field], state[field])) fail("COMMISSIONING_JOB_SEAL_REBOUND");
          if (prior.state.attemptOrdinal > state.attemptOrdinal || ![0, 1].includes(state.attemptOrdinal)) fail("COMMISSIONING_ATTEMPT_BUDGET_BROKEN");
          if (prior.state.delivery && (prior.state.delivery.deliveryAttemptRef !== state.delivery?.deliveryAttemptRef || prior.state.delivery.projectionDigest !== state.delivery?.projectionDigest || (prior.state.delivery.state === "ACKNOWLEDGED" && !same(prior.state.delivery, state.delivery)))) fail("COMMISSIONING_DELIVERY_REBOUND");
        }
        for (const field of ["compilerObservationRef", "pageRef", "workerObservationRef", "terminalProjectionRef"]) if (state[field]) {
          if (!objectBindings.has(state[field])) fail("COMMISSIONING_FORWARD_OBJECT_REFERENCE");
          objectReferences.add(state[field]);
        }
        const job = this.store.get("SELECT * FROM jobs WHERE job_ref=?", row.job_ref);
        if (!job || job.principal_ref !== state.principalRef || job.verifier_ref !== state.verifierRef || job.request_digest !== state.requestDigest) fail("COMMISSIONING_JOB_ADMISSION_JOIN_BROKEN");
        const { receipt, snapshot } = this.durableAdmission(job);
        if (receipt.receipt_ref !== state.authorizationRef || snapshot.snapshotRef !== state.snapshotRef) fail("COMMISSIONING_JOB_AUTHORIZATION_JOIN_BROKEN");
        if (state.handoffDigest) {
          const boundary = this.daemon.dispatch.get(state.jobRef);
          if (boundary.state !== "HANDOFF_COMMITTED" || boundary.targetTrancheRevision !== REVISION || boundary.handoffEventDigest !== state.handoffDigest) fail("COMMISSIONING_HANDOFF_JOIN_BROKEN");
        }
        if (state.delivery) {
          if (state.status !== "TERMINAL" || state.delivery.principalRef !== state.principalRef || !state.terminalProjectionRef || objectDigest(this.object(state.terminalProjectionRef)) !== state.delivery.projectionDigest) fail("COMMISSIONING_DELIVERY_BINDING_BROKEN");
          if (!["OFFERED", "ACKNOWLEDGED"].includes(state.delivery.state)) fail("COMMISSIONING_DELIVERY_STATE_BROKEN");
        }
        jobHeads.set(row.job_ref, { state, recordRef: row.record_ref });
      } else fail("COMMISSIONING_RECORD_KIND_INVALID");
      previous = row;
    }
    if (installations !== 1 || objectBindings.size !== this.store.get("SELECT COUNT(*) AS count FROM commissioning_objects").count || jobHeads.size !== this.store.get("SELECT COUNT(*) AS count FROM commissioning_heads").count) fail("COMMISSIONING_POPULATION_BROKEN");
    if (objectReferences.size !== objectBindings.size) fail("COMMISSIONING_OBJECT_ORPHAN");
    const anchors = this.store.all("SELECT payload_json FROM service_events WHERE event_type='commissioning_record_committed'");
    if (anchors.length !== (previous?.sequence || 0)) fail("COMMISSIONING_RECORD_DELETION");
    for (const [jobRef, expected] of jobHeads) {
      const head = this.store.get("SELECT * FROM commissioning_heads WHERE job_ref=?", jobRef);
      if (!head || head.revision !== expected.state.revision || head.record_ref !== expected.recordRef) fail("COMMISSIONING_HEAD_RECONSTRUCTION_BROKEN");
      const state = expected.state;
      if (state.pageRef) {
        const materialized = materializePage(this.pack, this.pack.snapshots.find((snapshot) => snapshot.snapshotRef === state.snapshotRef), this.object(state.compilerObservationRef));
        if (!same(materialized.page, this.object(state.pageRef)) || materialized.pageDigest !== state.pageDigest || materialized.compilationDigest !== state.compilationDigest) fail("COMMISSIONING_PAGE_RECONSTRUCTION_BROKEN");
      }
      if (state.status === "TERMINAL" && state.workerObservationRef) {
        const observation = this.object(state.workerObservationRef);
        if (observation.status === "CAPTURED" && !same(admitWorkerResponse({ pack: this.pack, page: this.object(state.pageRef), attemptRef: state.attemptRef, observation }), state.disposition)) fail("COMMISSIONING_ADMISSION_RECONSTRUCTION_BROKEN");
      }
    }
    return { jobs: jobHeads.size, objects: objectBindings.size, records: previous?.sequence || 0 };
  }

  async close() {
    this.closing = true;
    this.active?.controller.abort();
    if (this.active) await this.active.task;
  }
}

module.exports = { CommissioningCoordinator, admitWorkerResponse, REVISION };
