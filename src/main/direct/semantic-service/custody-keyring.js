"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const {
  Dss02Error,
  dss02Fail,
  ensureDirectory,
  atomicWrite,
  fsyncDirectory,
  randomRef,
  isoNow,
  publicKeyFingerprint,
  hmacSha256,
  digestBytes,
  checkedInteger,
} = require("./dss02-common");

class Dss02CustodyKeyring {
  constructor({ store, ledger = undefined, now = undefined } = {}) {
    if (!store) dss02Fail("DSS02_KEYRING_STORE_REQUIRED");
    this.store = store;
    this.ledger = ledger;
    this.now = now;
    ensureDirectory(store.paths.keyring, 0o700);
  }

  clock() { return isoNow(typeof this.now === "function" ? this.now() : this.now); }

  pathFor(revisionRef) {
    if (typeof revisionRef !== "string" || !/^[A-Za-z0-9._-]+$/.test(revisionRef)) dss02Fail("DSS02_KEY_REVISION_INVALID");
    return path.join(this.store.paths.keyring, `${revisionRef}.key`);
  }

  initialize({ admittedByCapabilityRef = "grant.daemon-credential-bootstrap", effectiveAfterGlobalSequence = 0 } = {}) {
    const existing = this.store.get("SELECT * FROM custody_keys ORDER BY effective_after_global_sequence LIMIT 1");
    if (existing) dss02Fail("DSS02_CUSTODY_ALREADY_INITIALIZED");
    const prepared = this.prepareInitial({ admittedByCapabilityRef, effectiveAfterGlobalSequence });
    try {
      this.store.transaction((tx) => this.initializeInTransaction(tx, prepared));
    } catch (error) {
      try { fs.unlinkSync(this.pathFor(prepared.custodyKeyRevisionRef)); } catch (_) {}
      throw error;
    }
    return Object.freeze(prepared);
  }

  prepareInitial({ admittedByCapabilityRef = "grant.daemon-credential-bootstrap", effectiveAfterGlobalSequence = 0 } = {}) {
    checkedInteger(effectiveAfterGlobalSequence, "effectiveAfterGlobalSequence");
    const revisionRef = randomRef("custody-key");
    const bytes = crypto.randomBytes(32);
    const keyFingerprint = digestBytes("DirectSemanticService.CustodyKeyFingerprint.v1", bytes);
    atomicWrite(this.pathFor(revisionRef), bytes, 0o600);
    const now = this.clock();
    return Object.freeze({ schema: "direct_semantic_custody_key_revision@1", custodyKeyRevisionRef: revisionRef, keyFingerprint, predecessorRevisionRef: null, effectiveAfterGlobalSequence, admittedByCapabilityRef, admittedAt: now });
  }

  initializeInTransaction(tx, prepared) {
    if (!prepared || !prepared.custodyKeyRevisionRef) dss02Fail("DSS02_CUSTODY_DESCRIPTOR_INVALID");
    if (tx.get("SELECT custody_key_revision_ref FROM custody_keys LIMIT 1")) dss02Fail("DSS02_CUSTODY_ALREADY_INITIALIZED");
    tx.run("INSERT INTO custody_keys(custody_key_revision_ref,key_fingerprint,predecessor_revision_ref,effective_after_global_sequence,admitted_by_capability_ref,admitted_at,state) VALUES(?,?,?,?,?,?,?)", prepared.custodyKeyRevisionRef, prepared.keyFingerprint, null, prepared.effectiveAfterGlobalSequence, prepared.admittedByCapabilityRef, prepared.admittedAt, "CURRENT");
    return prepared;
  }

  current() {
    const row = this.store.get("SELECT * FROM custody_keys ORDER BY effective_after_global_sequence DESC LIMIT 1");
    if (!row) dss02Fail("DSS02_CUSTODY_UNINITIALIZED");
    return this.describe(row);
  }

  describe(row) {
    return { schema: "direct_semantic_custody_key_revision@1", custodyKeyRevisionRef: row.custody_key_revision_ref, keyFingerprint: row.key_fingerprint, predecessorRevisionRef: row.predecessor_revision_ref || null, effectiveAfterGlobalSequence: row.effective_after_global_sequence, admittedByCapabilityRef: row.admitted_by_capability_ref, admittedAt: row.admitted_at, state: row.state };
  }

  get(revisionRef) {
    const row = this.store.get("SELECT * FROM custody_keys WHERE custody_key_revision_ref=?", revisionRef);
    if (!row) dss02Fail("DSS02_CUSTODY_KEY_MISSING");
    return this.describe(row);
  }

  readKey(revisionRef) {
    const descriptor = this.get(revisionRef);
    const filePath = this.pathFor(revisionRef);
    let stat;
    try { stat = fs.lstatSync(filePath); } catch (error) { dss02Fail("DSS02_CUSTODY_KEY_MISSING"); }
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== 32) dss02Fail("DSS02_CUSTODY_KEY_CORRUPT");
    const bytes = fs.readFileSync(filePath);
    const actual = digestBytes("DirectSemanticService.CustodyKeyFingerprint.v1", bytes);
    if (actual !== descriptor.keyFingerprint) dss02Fail("DSS02_CUSTODY_KEY_FINGERPRINT_MISMATCH");
    return bytes;
  }

  tag(revisionRef, digest) {
    return hmacSha256(this.readKey(revisionRef), Buffer.from(digest, "utf8"));
  }

  rotate({ actorVerifierRef, assertAdmin, effectiveAfterGlobalSequence, lastPriorKeyGlobalCustodyDigest } = {}) {
    if (typeof assertAdmin !== "function") dss02Fail("DSS02_SERVICE_ADMIN_REQUIRED");
    assertAdmin(actorVerifierRef);
    checkedInteger(effectiveAfterGlobalSequence, "effectiveAfterGlobalSequence");
    const prior = this.current();
    const currentHead = this.store.latestGlobalSequence();
    const priorEvent = currentHead ? this.store.get("SELECT global_custody_digest FROM service_events WHERE global_sequence=?", currentHead) : null;
    const priorDigest = priorEvent?.global_custody_digest || null;
    if (lastPriorKeyGlobalCustodyDigest !== priorDigest || effectiveAfterGlobalSequence !== currentHead + 1 || effectiveAfterGlobalSequence <= prior.effectiveAfterGlobalSequence) dss02Fail("DSS02_CUSTODY_EFFECTIVE_RANGE");
    const nextRef = randomRef("custody-key");
    const nextBytes = crypto.randomBytes(32);
    const nextFingerprint = digestBytes("DirectSemanticService.CustodyKeyFingerprint.v1", nextBytes);
    atomicWrite(this.pathFor(nextRef), nextBytes, 0o600);
    const priorTag = this.tag(prior.custodyKeyRevisionRef, priorDigest);
    const nextTag = hmacSha256(nextBytes, Buffer.from(priorDigest, "utf8"));
    const rotationRef = randomRef("custody-rotation");
    const now = this.clock();
    try {
      this.store.transaction((tx) => {
        tx.run("UPDATE custody_keys SET state='HISTORICAL' WHERE custody_key_revision_ref=?", prior.custodyKeyRevisionRef);
        tx.run("INSERT INTO custody_keys(custody_key_revision_ref,key_fingerprint,predecessor_revision_ref,effective_after_global_sequence,admitted_by_capability_ref,admitted_at,state) VALUES(?,?,?,?,?,?,?)", nextRef, nextFingerprint, prior.custodyKeyRevisionRef, effectiveAfterGlobalSequence, actorVerifierRef, now, "CURRENT");
        tx.run("INSERT INTO custody_rotations(rotation_ref,prior_key_revision_ref,next_key_revision_ref,last_prior_key_global_custody_digest,prior_key_custody_tag,next_key_custody_tag,effective_after_global_sequence,created_at) VALUES(?,?,?,?,?,?,?,?)", rotationRef, prior.custodyKeyRevisionRef, nextRef, priorDigest, priorTag, nextTag, effectiveAfterGlobalSequence, now);
        if (this.ledger) this.ledger.appendInTransaction(tx, { eventType: "custody_key_rotation", payload: { rotationRef, priorKeyRevisionRef: prior.custodyKeyRevisionRef, nextKeyRevisionRef: nextRef, lastPriorKeyGlobalCustodyDigest: priorDigest, effectiveAfterGlobalSequence, priorKeyCustodyTag: priorTag, nextKeyCustodyTag: nextTag, actorVerifierRef }, recordedAt: now });
      });
    } catch (error) {
      try { fs.unlinkSync(this.pathFor(nextRef)); } catch (_) {}
      throw error;
    }
    return Object.freeze({ schema: "direct_semantic_custody_key_rotation@1", rotationRef, priorKeyRevisionRef: prior.custodyKeyRevisionRef, nextKeyRevisionRef: nextRef, lastPriorKeyGlobalCustodyDigest: priorDigest, priorKeyCustodyTag: priorTag, nextKeyCustodyTag: nextTag, effectiveAfterGlobalSequence });
  }

  verifyLineage() {
    const rows = this.store.all("SELECT * FROM custody_keys ORDER BY effective_after_global_sequence ASC");
    if (rows.length === 0) dss02Fail("DSS02_CUSTODY_UNINITIALIZED");
    let prior = null;
    if (rows[0].effective_after_global_sequence !== 0 || rows.filter((row) => row.state === "CURRENT").length !== 1) dss02Fail("DSS02_CUSTODY_LINEAGE_BROKEN");
    for (const row of rows) {
      this.readKey(row.custody_key_revision_ref);
      if (prior && (row.predecessor_revision_ref !== prior.custody_key_revision_ref || row.effective_after_global_sequence <= prior.effective_after_global_sequence)) dss02Fail("DSS02_CUSTODY_LINEAGE_BROKEN");
      prior = row;
    }
    const rotations = this.store.all("SELECT * FROM custody_rotations ORDER BY effective_after_global_sequence ASC");
    if (rotations.length !== Math.max(0, rows.length - 1)) dss02Fail("DSS02_CUSTODY_ROTATION_BROKEN");
    for (const rotation of rotations) {
      if (!rows.some((row) => row.custody_key_revision_ref === rotation.prior_key_revision_ref) || !rows.some((row) => row.custody_key_revision_ref === rotation.next_key_revision_ref)) dss02Fail("DSS02_CUSTODY_ROTATION_BROKEN");
      const priorRow = rows.find((row) => row.custody_key_revision_ref === rotation.prior_key_revision_ref); const nextRow = rows.find((row) => row.custody_key_revision_ref === rotation.next_key_revision_ref);
      if (!priorRow || !nextRow || nextRow.predecessor_revision_ref !== priorRow.custody_key_revision_ref || nextRow.effective_after_global_sequence !== rotation.effective_after_global_sequence) dss02Fail("DSS02_CUSTODY_ROTATION_BROKEN");
      const priorEvent = rotation.effective_after_global_sequence > 0 && this.store.get("SELECT global_custody_digest FROM service_events WHERE global_sequence=?", rotation.effective_after_global_sequence - 1);
      if ((priorEvent?.global_custody_digest || null) !== rotation.last_prior_key_global_custody_digest) dss02Fail("DSS02_CUSTODY_ROTATION_BROKEN");
      const priorTag = this.tag(rotation.prior_key_revision_ref, rotation.last_prior_key_global_custody_digest);
      const nextTag = this.tag(rotation.next_key_revision_ref, rotation.last_prior_key_global_custody_digest);
      if (priorTag !== rotation.prior_key_custody_tag || nextTag !== rotation.next_key_custody_tag) dss02Fail("DSS02_CUSTODY_ROTATION_BROKEN");
    }
    return true;
  }
}

function createDss02CustodyKeyring(options) { return new Dss02CustodyKeyring(options); }

module.exports = { Dss02CustodyKeyring, CustodyKeyring: Dss02CustodyKeyring, createDss02CustodyKeyring };
