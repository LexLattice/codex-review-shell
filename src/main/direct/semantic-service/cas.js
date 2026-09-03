"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const {
  dss02Fail,
  canonicalBytes,
  canonicalJson,
  digestBytes,
  sha256,
  immutableId,
  immutableDigest,
  ensureDirectory,
  fsyncDirectory,
  randomRef,
  isoNow,
  parseJsonStrict,
} = require("./dss02-common");

class Dss02Cas {
  constructor({ store, now = undefined } = {}) {
    if (!store) dss02Fail("DSS02_CAS_STORE_REQUIRED");
    this.store = store;
    this.now = now;
    ensureDirectory(store.paths.cas, 0o700);
  }

  clock() { return isoNow(typeof this.now === "function" ? this.now() : this.now); }

  pathForDigest(digest) {
    immutableDigest(digest);
    return path.join(this.store.paths.cas, digest.slice(7));
  }

  verifyPath(digest) {
    const target = this.pathForDigest(digest);
    let stat;
    try { stat = fs.lstatSync(target); } catch (error) { dss02Fail("DSS02_CAS_MISSING"); }
    if (stat.isSymbolicLink() || !stat.isFile()) dss02Fail("DSS02_CAS_NOT_REGULAR");
    const bytes = fs.readFileSync(target);
    if (sha256(bytes) !== digest) dss02Fail("DSS02_CAS_DIGEST_MISMATCH");
    return { path: target, bytes, byteLength: bytes.length };
  }

  publish(value, { digest = undefined, kind = "admitted-request", artifactRef = randomRef("artifact"), simulateCrashBeforeReference = false } = {}) {
    const bytes = Buffer.isBuffer(value) ? Buffer.from(value) : canonicalBytes(value);
    const computed = sha256(bytes);
    if (digest !== undefined && digest !== computed) dss02Fail("DSS02_CAS_DIGEST_MISMATCH");
    const target = this.pathForDigest(computed);
    ensureDirectory(this.store.paths.cas, 0o700);
    if (fs.existsSync(target)) {
      this.verifyPath(computed);
    } else {
      const temporary = path.join(this.store.paths.cas, `.${computed.slice(7)}.${process.pid}.${crypto.randomBytes(8).toString("hex")}.tmp`);
      const fd = fs.openSync(temporary, "wx", 0o600);
      try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      const verification = fs.readFileSync(temporary);
      if (sha256(verification) !== computed) { try { fs.unlinkSync(temporary); } catch (_) {} dss02Fail("DSS02_CAS_DIGEST_MISMATCH"); }
      try {
        // link() is an atomic no-replace publication on the same filesystem.
        fs.linkSync(temporary, target);
        fs.unlinkSync(temporary);
      } catch (error) {
        if (error.code === "EEXIST") { try { fs.unlinkSync(temporary); } catch (_) {} this.verifyPath(computed); }
        else { try { fs.unlinkSync(temporary); } catch (_) {} dss02Fail("DSS02_CAS_PUBLICATION_FAILED"); }
      }
      fsyncDirectory(this.store.paths.cas);
    }
    if (simulateCrashBeforeReference) return Object.freeze({ status: "ORPHANED", digest: computed, artifactRef, byteLength: bytes.length });
    const verification = this.verifyPath(computed);
    const now = this.clock();
    let descriptor;
    this.store.transaction((tx) => {
      const conflictingRef = tx.get("SELECT digest FROM artifacts WHERE artifact_ref=?", artifactRef);
      if (conflictingRef && conflictingRef.digest !== computed) dss02Fail("DSS02_CAS_METADATA_MISMATCH");
      tx.run("INSERT INTO artifacts(artifact_ref,digest,kind,relative_path,byte_length,state,created_at,reference_count) VALUES(?,?,?,?,?,?,?,0) ON CONFLICT DO NOTHING", artifactRef, computed, kind, computed.slice(7), bytes.length, "PUBLISHED", now);
      descriptor = tx.get("SELECT * FROM artifacts WHERE digest=?", computed);
      if (!descriptor || descriptor.digest !== computed || verification.byteLength !== bytes.length || typeof descriptor.artifact_ref !== "string" || !descriptor.artifact_ref || typeof descriptor.kind !== "string" || !descriptor.kind || typeof descriptor.relative_path !== "string" || descriptor.relative_path !== computed.slice(7) || !Number.isSafeInteger(descriptor.byte_length) || descriptor.byte_length !== bytes.length || typeof descriptor.created_at !== "string" || !descriptor.created_at || !["PUBLISHED", "REFERENCED"].includes(descriptor.state) || !Number.isSafeInteger(descriptor.reference_count) || descriptor.reference_count < 0) {
        dss02Fail("DSS02_CAS_METADATA_MISMATCH");
      }
    });
    return Object.freeze({ ...this.describe(descriptor), status: descriptor.state });
  }

  referenceInTransaction(tx, { artifactRef, digest, kind = undefined } = {}) {
    const descriptor = tx.get("SELECT * FROM artifacts WHERE artifact_ref=? AND digest=?", artifactRef, digest);
    if (!descriptor) dss02Fail("DSS02_CAS_REFERENCE_UNKNOWN");
    this.verifyPath(digest);
    tx.run("UPDATE artifacts SET state='REFERENCED',reference_count=reference_count+1 WHERE artifact_ref=? AND digest=?", artifactRef, digest);
    return this.describe({ ...descriptor, state: "REFERENCED", reference_count: descriptor.reference_count + 1 });
  }

  describe(row) { return { schema: "direct_semantic_cas_artifact@1", artifactRef: row.artifact_ref, digest: row.digest, kind: row.kind, byteLength: row.byte_length, state: row.state, relativePath: row.relative_path, createdAt: row.created_at, referenceCount: row.reference_count }; }

  read(digest) { return this.verifyPath(digest).bytes; }

  readJson(digest) {
    const bytes = this.read(digest);
    return parseJsonStrict(bytes.toString("utf8"));
  }

  verifyReferences() {
    for (const row of this.store.all("SELECT * FROM artifacts")) this.verifyPath(row.digest);
    return true;
  }

  orphanDigests() {
    const known = new Set(this.store.all("SELECT digest FROM artifacts").map((row) => row.digest));
    return fs.readdirSync(this.store.paths.cas, { withFileTypes: true }).filter((entry) => entry.isFile() && !entry.isSymbolicLink() && !known.has(`sha256:${entry.name}`)).map((entry) => `sha256:${entry.name}`);
  }
}

function createDss02Cas(options) { return new Dss02Cas(options); }

module.exports = { Dss02Cas, ContentAddressedStore: Dss02Cas, createDss02Cas };
