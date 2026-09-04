"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const {
  dss02Fail,
  sha256,
  atomicWrite,
  ensureDirectory,
  fsyncDirectory,
  randomRef,
  isoNow,
  checkedInteger,
} = require("./dss02-common");

class Dss02Quarantine {
  constructor({ store, now = undefined } = {}) {
    if (!store) dss02Fail("DSS02_QUARANTINE_STORE_REQUIRED");
    this.store = store;
    this.now = now;
    ensureDirectory(store.paths.quarantine, 0o700);
  }

  clock() { return isoNow(typeof this.now === "function" ? this.now() : this.now); }
  pathFor(ref) { if (typeof ref !== "string" || !/^quarantine-[A-Za-z0-9._-]+$/.test(ref)) dss02Fail("DSS02_QUARANTINE_REF_INVALID"); return path.join(this.store.paths.quarantine, `${ref}.bin`); }

  capture(bytes, { diagnosticCode = null, expiresAt = null } = {}) {
    const value = Buffer.isBuffer(bytes) ? Buffer.from(bytes) : Buffer.from(bytes);
    const quarantineRef = randomRef("quarantine");
    const digest = sha256(value);
    const target = this.pathFor(quarantineRef);
    const temporary = `${target}.${process.pid}.${crypto.randomBytes(8).toString("hex")}.tmp`;
    const fd = fs.openSync(temporary, "wx", 0o600);
    try { fs.writeFileSync(fd, value); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(temporary, target);
    fsyncDirectory(this.store.paths.quarantine);
    const now = this.clock();
    this.store.run("INSERT INTO quarantine_artifacts(quarantine_ref,digest,byte_length,relative_path,diagnostic_code,state,revision,captured_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?)", quarantineRef, digest, value.length, `${quarantineRef}.bin`, diagnosticCode, "QUARANTINED", 1, now, expiresAt);
    return Object.freeze({ schema: "direct_semantic_quarantined_artifact@1", quarantineRef, digest, byteLength: value.length, state: "QUARANTINED", revision: 1, diagnosticCode, capturedAt: now, expiresAt });
  }

  get(quarantineRef) {
    const row = this.store.get("SELECT * FROM quarantine_artifacts WHERE quarantine_ref=?", quarantineRef);
    if (!row) dss02Fail("DSS02_QUARANTINE_UNKNOWN");
    return this.describe(row);
  }

  describe(row) { return { schema: "direct_semantic_quarantined_artifact@1", quarantineRef: row.quarantine_ref, digest: row.digest, byteLength: row.byte_length, state: row.state, revision: row.revision, diagnosticCode: row.diagnostic_code || null, capturedAt: row.captured_at, expiresAt: row.expires_at || null }; }

  readInternal(quarantineRef) {
    const row = this.get(quarantineRef);
    const target = this.pathFor(quarantineRef);
    const stat = fs.lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink()) dss02Fail("DSS02_QUARANTINE_CORRUPT");
    const bytes = fs.readFileSync(target);
    if (bytes.length !== row.byteLength || sha256(bytes) !== row.digest) dss02Fail("DSS02_QUARANTINE_CORRUPT");
    return bytes;
  }

  dispose({ actorVerifierRef, assertAdmin, quarantineRef, expectedRevision, disposition = "EXPIRED" } = {}) {
    if (typeof assertAdmin !== "function") dss02Fail("DSS02_SERVICE_ADMIN_REQUIRED");
    assertAdmin(actorVerifierRef);
    if (!["EXPIRED", "DESTROYED"].includes(disposition)) dss02Fail("DSS02_QUARANTINE_DISPOSITION_INVALID");
    const row = this.store.get("SELECT * FROM quarantine_artifacts WHERE quarantine_ref=?", quarantineRef);
    if (!row) dss02Fail("DSS02_QUARANTINE_UNKNOWN");
    if (row.revision !== expectedRevision) dss02Fail("DSS02_QUARANTINE_STALE_REVISION");
    if (row.state !== "QUARANTINED") {
      if (row.state === disposition) return this.describe(row);
      dss02Fail("DSS02_QUARANTINE_STALE_REVISION");
    }
    const now = this.clock();
    this.store.run("UPDATE quarantine_artifacts SET state=?,revision=revision+1 WHERE quarantine_ref=? AND revision=? AND state='QUARANTINED'", disposition, quarantineRef, expectedRevision);
    // Deletion is not an implicit clock effect.  It is performed only as the
    // explicit disposition operation after the durable state transition.
    try { fs.unlinkSync(this.pathFor(quarantineRef)); fsyncDirectory(this.store.paths.quarantine); } catch (_) { /* recovery will classify CORRUPT */ }
    return this.get(quarantineRef);
  }

  verify() {
    for (const row of this.store.all("SELECT * FROM quarantine_artifacts WHERE state='QUARANTINED'")) this.readInternal(row.quarantine_ref);
    return true;
  }
}

function createDss02Quarantine(options) { return new Dss02Quarantine(options); }

module.exports = { Dss02Quarantine, QuarantineStore: Dss02Quarantine, createDss02Quarantine };
