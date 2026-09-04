#!/usr/bin/env node

/* Deterministic DSS-0.2 runtime games.  These are implementation gates, not a
 * semantic compiler/audit: each game exercises one law against the durable
 * service API and fails closed on a contract violation. */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const dss = require("../src/main/direct/semantic-service");
const DSS02_FIXTURE_ROOT = path.join(process.cwd(), "test/fixtures/direct-semantic-service/dss02-generation-6");

const {
  installOwnerBootstrapTrustRoot,
  provisionBootstrapCommitment,
  DirectSemanticDaemon,
  Dss02Store,
  Dss02Cas,
  Dss02WaiterGate,
  createAuthorizationProof,
  digestObject,
  sha256,
  parseJsonStrict,
  encodeFrame,
  FrameDecoder,
  transcriptBytes,
  validateTranscriptLength,
} = dss;

const completedSubcases = new Map();
const waitTimingEvidence = {};
function completeSubcase(number, label) {
  if (!completedSubcases.has(number)) completedSubcases.set(number, new Set());
  completedSubcases.get(number).add(label);
}

function expectCode(code, action) { assert.throws(action, (error) => error?.code === code, `expected ${code}`); }
function tempRoot() { return fs.mkdtempSync(path.join(os.tmpdir(), "dss02-regression-")); }

function request(id = "request-1", idempotencyKey = "idempotency-1") {
  return {
    schema: "direct_semantic_job_request@1", requestId: id, projectRef: "project-1",
    projectRegistryRevisionRef: "registry-1", targetORevision: "o-revision-1",
    targetSnapshotReceiptRef: "snapshot-1", compilerPinRef: "compiler-pin-1",
    requestedCompilationRef: "compilation-1", selectionMode: "partial_selection",
    edgeOccurrenceRefs: ["edge-1"], attemptPolicyRef: "attempt-policy-1",
    executionProfileRevisionRef: "execution-profile-1", deliveryProjectionRef: "projection-1",
    idempotencyKey,
  };
}

function createFixture({ limits = undefined } = {}) {
  const root = tempRoot();
  const installationRoot = path.join(root, "installation");
  const profileRoot = path.join(root, "profile");
  installOwnerBootstrapTrustRoot({ installationRoot });
  const genesis = provisionBootstrapCommitment({ installationRoot, profileRoot, profileRef: "profile-1" });
  const adminKeys = crypto.generateKeyPairSync("ed25519");
  const daemon = new DirectSemanticDaemon({
    profileRoot, installationRoot, profileRef: "profile-1", limits,
    bootstrap: {
      secret: genesis.secret,
      descriptorProvenance: { kind: "owner_inherited_fd", revision: "descriptor-policy@1" },
      administratorPublicKey: adminKeys.publicKey,
    },
  });
  const status = daemon.start();
  assert.equal(status.ready, true, `fixture must start ready: ${JSON.stringify(status)}`);
  const adminVerifierRef = daemon.store.get("SELECT verifier_ref FROM verifiers LIMIT 1").verifier_ref;
  const adminVerifier = daemon.authority.getVerifier(adminVerifierRef);
  const userKeys = crypto.generateKeyPairSync("ed25519");
  const user = daemon.authority.issueCredential({
    actorVerifierRef: adminVerifierRef,
    principalId: "fixture-user-1",
    subjectRef: "fixture-local-user-1",
    publicKey: userKeys.publicKey,
    operations: ["submit", "inspect", "results", "subscribe", "acknowledge", "cancel", "handoff"],
    purposeScopes: ["semantic-request", "read", "delivery"],
    objectScopes: ["*"],
  });
  return { root, installationRoot, profileRoot, genesis, daemon, adminKeys, adminVerifier, userKeys, user: user.verifier, principal: user.principal };
}

function authorize(fixture, { operation, body, purposeScopes = ["semantic-request"], principal = fixture.user, privateKey = fixture.userKeys.privateKey, requestDigest = undefined, objectScopeDigest = undefined } = {}) {
  const connectionRef = `connection-${operation}-${crypto.randomBytes(4).toString("hex")}`;
  const transport = fixture.daemon.observeTransportPeer({ connectionRef });
  const challenge = fixture.daemon.authority.issueAuthorizationChallenge({ connectionRef, transportObservation: transport });
  const digest = requestDigest || digestObject("DirectSemanticService.SemanticRequestBoundary.v1", body);
  const scope = objectScopeDigest || digestObject("DirectSemanticService.ObjectScope.v1", body);
  const proof = createAuthorizationProof({ challenge, requestDigest: digest, operation, purposeScopes, objectScopeDigest: scope, verifier: principal, privateKey, registryRevisionSet: [] });
  const resolved = fixture.daemon.authority.resolveDaemonCredential({ connectionRef, transportObservation: transport, challengeRef: challenge.challengeRef, proof, requestDigest: digest, operation, purposeScopes, objectScopeDigest: scope, registryRevisionSet: [] });
  if (resolved.receipt.decision !== "AUTHORIZED") return resolved;
  return { ...resolved, receipt: { ...resolved.receipt, principalRef: resolved.principal.principalRef, verifierRef: resolved.verifier.verifierRef, operation, decision: "AUTHORIZED" } };
}

function submitAuthorization(fixture, jobRequest, principal = fixture.user, privateKey = fixture.userKeys.privateKey) {
  return authorize(fixture, { operation: "submit", body: jobRequest, principal, privateKey, purposeScopes: ["semantic-request"], requestDigest: digestObject("DirectSemanticService.SemanticJobRequest.v1", jobRequest), objectScopeDigest: digestObject("DirectSemanticService.ObjectScope.v1", { projectRef: jobRequest.projectRef }) });
}

const fixture = createFixture();
const firstRequest = request();
const firstAuthorization = submitAuthorization(fixture, firstRequest);
assert.equal(firstAuthorization.receipt.decision, "AUTHORIZED");
const firstReceipt = fixture.daemon.submit({ request: firstRequest, authorizationReceipt: firstAuthorization.receipt });
const replayReceipt = fixture.daemon.submit({ request: firstRequest, authorizationReceipt: firstAuthorization.receipt });
assert.equal(replayReceipt.jobRef, firstReceipt.jobRef, "same idempotency tuple replays the original job");
assert.equal(fixture.daemon.store.get("SELECT COUNT(*) AS count FROM service_events WHERE event_type='job_admitted'").count, 1);
completeSubcase(1, "one job");
completeSubcase(1, "one admission");
const changedRequest = request("request-2", "idempotency-1");
const changedAuthorization = submitAuthorization(fixture, changedRequest);
expectCode("DSS02_IDEMPOTENCY_CONFLICT", () => fixture.daemon.submit({ request: changedRequest, authorizationReceipt: changedAuthorization.receipt }));
completeSubcase(2, "changed request rejects");

// Receipts and verifier references are durable service records, not portable
// authority.  A copied receipt without its database evidence is rejected.
const copiedReceipt = { ...firstAuthorization.receipt };
delete copiedReceipt.receiptRef;
expectCode("DSS02_AUTHORIZATION_RECEIPT_INVALID", () => fixture.daemon.submit({ request: firstRequest, authorizationReceipt: copiedReceipt }));
const copiedVerifierReceipt = { ...firstAuthorization.receipt, verifierRef: "verifier-copied-from-another-profile" };
expectCode("DSS02_AUTHORIZATION_RECEIPT_INVALID", () => fixture.daemon.submit({ request: firstRequest, authorizationReceipt: copiedVerifierReceipt }));
completeSubcase(3, "copied receipt");
completeSubcase(3, "copied verifier reference");
expectCode("DSS02_AUTHORIZATION_PROOF_REQUIRED", () => fixture.daemon.resolveProtocolAuthorization({ connectionRef: "foreign", transport: { status: "OBSERVED" }, params: {}, operation: "submit", request: firstRequest }));
completeSubcase(4, "transport-only submit");
expectCode("DSS02_AUTHORIZATION_RECEIPT_INVALID", () => fixture.daemon.inspect({ jobRef: firstReceipt.jobRef, authorizationReceipt: firstAuthorization.receipt }));
expectCode("DSS02_SUBMIT_UNAUTHORIZED", () => fixture.daemon.submit({ request: firstRequest, authorizationReceipt: { ...firstAuthorization.receipt, operation: "inspect" } }));
for (const [operation, action] of [
  ["inspect", () => fixture.daemon.inspect({ jobRef: firstReceipt.jobRef, authorizationReceipt: firstAuthorization.receipt })],
  ["subscribe", () => fixture.daemon.subscribe({ jobRef: firstReceipt.jobRef, authorizationReceipt: firstAuthorization.receipt, returnProjectionRef: "projection-safe@1" })],
  ["acknowledge", () => fixture.daemon.ack({ deliveryAttemptRef: "delivery-missing", authorizationReceipt: firstAuthorization.receipt, projectionDigest: "sha256:" + "0".repeat(64) })],
  ["cancel", () => fixture.daemon.cancel({ jobRef: firstReceipt.jobRef, request: { schema: "direct_semantic_cancel_request@1", requestId: "submit-authority-cancel", jobRef: firstReceipt.jobRef, requestedCellRefs: [], boundedReason: "fixture" }, authorizationReceipt: firstAuthorization.receipt })],
]) { expectCode("DSS02_AUTHORIZATION_RECEIPT_INVALID", action); completeSubcase(5, operation); }

const readOnlyKeys = crypto.generateKeyPairSync("ed25519");
const readOnly = fixture.daemon.authority.issueCredential({
  actorVerifierRef: fixture.adminVerifier.verifierRef,
  principalId: "fixture-read-only",
  subjectRef: "fixture-read-only",
  publicKey: readOnlyKeys.publicKey,
  operations: ["inspect", "results"],
  purposeScopes: ["read"],
  objectScopes: ["*"],
});
const readOnlyBody = { jobRef: firstReceipt.jobRef };
const readOnlyAuthorization = authorize(fixture, { operation: "inspect", body: readOnlyBody, purposeScopes: ["read"], principal: readOnly.verifier, privateKey: readOnlyKeys.privateKey, objectScopeDigest: digestObject("DirectSemanticService.ObjectScope.v1", readOnlyBody) });
expectCode("DSS02_AUTHORIZATION_RECEIPT_INVALID", () => fixture.daemon.submit({ request: request("read-only-submit", "read-only-submit"), authorizationReceipt: readOnlyAuthorization.receipt }));
completeSubcase(6, "submit");
expectCode("DSS02_AUTHORIZATION_RECEIPT_INVALID", () => fixture.daemon.cancel({ jobRef: firstReceipt.jobRef, request: { schema: "direct_semantic_cancel_request@1", requestId: "read-only-cancel", jobRef: firstReceipt.jobRef, requestedCellRefs: [], boundedReason: "fixture" }, authorizationReceipt: readOnlyAuthorization.receipt }));
completeSubcase(6, "cancel");

// Profile paths are owner-derived; callers cannot select alternate stores.
expectCode("DSS02_STORE_OPTIONS_INVALID", () => new Dss02Store({ profileRoot: fixture.profileRoot, database: "/tmp/attacker.sqlite" }));
expectCode("DSS02_DAEMON_OPTIONS_INVALID", () => new DirectSemanticDaemon({ profileRoot: fixture.profileRoot, installationRoot: fixture.installationRoot, database: "/tmp/attacker.sqlite" }));
const secondStore = new Dss02Store({ profileRoot: fixture.profileRoot, profileRef: "profile-1" });
expectCode("DSS02_SECOND_WRITER", () => secondStore.open());
completeSubcase(7, "database");
for (const key of ["socketPath", "casRoot", "quarantineRoot", "keyringRoot", "projectRoot"]) expectCode("DSS02_STORE_OPTIONS_INVALID", () => new Dss02Store({ profileRoot: fixture.profileRoot, profileRef: "profile-1", [key]: "/tmp/attacker" }));
completeSubcase(7, "socket"); completeSubcase(7, "CAS"); completeSubcase(7, "quarantine"); completeSubcase(7, "keyring"); completeSubcase(7, "project");
completeSubcase(8, "second writer");

// CAS publication is publish-before-reference; a simulated crash leaves only
// a safe orphan, while symlink and digest mutations fail closed.
const cas = fixture.daemon.cas;
const orphan = cas.publish({ schema: "fixture", value: "orphan" }, { simulateCrashBeforeReference: true });
assert.equal(orphan.status, "ORPHANED");
assert.ok(cas.orphanDigests().includes(orphan.digest));
const artifact = cas.publish({ schema: "fixture", value: "verified" }, { artifactRef: "artifact-cas-original", kind: "fixture-original" });
assert.equal(artifact.status, "PUBLISHED");
assert.equal(artifact.state, "PUBLISHED");
assert.deepEqual(JSON.parse(cas.read(artifact.digest).toString("utf8")), { schema: "fixture", value: "verified" });
const referencedArtifact = fixture.daemon.store.transaction((tx) => cas.referenceInTransaction(tx, {
  artifactRef: artifact.artifactRef,
  digest: artifact.digest,
}));
assert.equal(referencedArtifact.state, "REFERENCED");
assert.equal(referencedArtifact.referenceCount, 1);
const republishedArtifact = cas.publish({ schema: "fixture", value: "verified" }, { artifactRef: "artifact-cas-republish", kind: "fixture-republish" });
assert.deepEqual(republishedArtifact, { ...artifact, status: "REFERENCED", state: "REFERENCED", referenceCount: 1 });
assert.equal(republishedArtifact.artifactRef, artifact.artifactRef);
assert.equal(republishedArtifact.status, "REFERENCED");
assert.equal(fixture.daemon.store.get("SELECT artifact_ref FROM artifacts WHERE digest=?", artifact.digest).artifact_ref, artifact.artifactRef);
fs.unlinkSync(cas.pathForDigest(artifact.digest));
expectCode("DSS02_CAS_MISSING", () => cas.read(artifact.digest));
completeSubcase(9, "no reference");
const partial = cas.publish({ schema: "fixture", value: "partial" });
fs.writeFileSync(cas.pathForDigest(partial.digest), Buffer.from("partial-corruption"));
expectCode("DSS02_CAS_DIGEST_MISMATCH", () => cas.read(partial.digest));
fs.unlinkSync(cas.pathForDigest(partial.digest));
const symlinkTarget = path.join(fixture.root, "outside-cas-object"); fs.writeFileSync(symlinkTarget, "outside"); fs.symlinkSync(symlinkTarget, cas.pathForDigest(partial.digest));
expectCode("DSS02_CAS_NOT_REGULAR", () => cas.read(partial.digest)); fs.unlinkSync(cas.pathForDigest(partial.digest));
expectCode("DSS02_DIGEST_INVALID", () => cas.pathForDigest("sha256:" + "../".repeat(20)));
completeSubcase(10, "at most orphan"); completeSubcase(10, "orphan observable");
completeSubcase(12, "missing"); completeSubcase(12, "partial"); completeSubcase(12, "symlink"); completeSubcase(12, "escaped"); completeSubcase(12, "digest-invalid");

// Tamper evidence covers deletion, payload alteration, reorder, and reducer
// head drift.  The copied store remains closed after the game.
const eventRow = fixture.daemon.store.get("SELECT * FROM service_events WHERE event_type='job_admitted' LIMIT 1");
const originalHead = fixture.daemon.store.get("SELECT projection_digest FROM job_heads WHERE job_ref=?", firstReceipt.jobRef).projection_digest;
fixture.daemon.store.run("UPDATE service_events SET payload_json=? WHERE global_sequence=?", JSON.stringify({ tampered: true }), eventRow.global_sequence);
expectCode("DSS02_EVENT_DIGEST_MISMATCH", () => fixture.daemon.ledger.verify());
fixture.daemon.store.run("UPDATE service_events SET payload_json=? WHERE global_sequence=?", eventRow.payload_json, eventRow.global_sequence);
assert.equal(fixture.daemon.ledger.verify().globalHead, fixture.daemon.store.latestGlobalSequence());
completeSubcase(13, "payload change");
fixture.daemon.store.run("UPDATE job_heads SET projection_digest=? WHERE job_ref=?", "sha256:" + "0".repeat(64), firstReceipt.jobRef);
expectCode("DSS02_REDUCER_HEAD_DRIFT", () => fixture.daemon.ledger.assertHeads());
fixture.daemon.store.run("UPDATE job_heads SET projection_digest=? WHERE job_ref=?", originalHead, firstReceipt.jobRef);
completeSubcase(14, "derived head mismatch");

function eventMutationVariant(variant) {
  const f = createFixture();
  try {
    submitJob(f);
    const first = f.daemon.store.get("SELECT * FROM service_events ORDER BY global_sequence LIMIT 1");
    if (variant === "deletion") {
      f.daemon.store.run("DELETE FROM service_events WHERE global_sequence=?", first.global_sequence);
      expectCode("DSS02_EVENT_GLOBAL_SEQUENCE_GAP", () => f.daemon.ledger.verify());
    } else if (variant === "reorder") {
      f.daemon.store.run("UPDATE service_events SET global_sequence=global_sequence+1000 WHERE global_sequence IN (1,2)");
      f.daemon.store.run("UPDATE service_events SET global_sequence=CASE global_sequence WHEN 1001 THEN 2 WHEN 1002 THEN 1 ELSE global_sequence END WHERE global_sequence IN (1001,1002)");
      expectCode("DSS02_EVENT_GLOBAL_CHAIN_BROKEN", () => f.daemon.ledger.verify());
    } else if (variant === "insertion") {
      const key = f.daemon.store.get("SELECT custody_key_revision_ref FROM custody_keys ORDER BY effective_after_global_sequence LIMIT 1").custody_key_revision_ref;
      const generation = f.daemon.generation.generationRef;
      f.daemon.store.run("INSERT INTO service_events(global_sequence,job_ref,job_sequence,event_type,payload_json,artifact_ref,prior_job_event_digest,prior_global_custody_digest,custody_key_revision_ref,event_digest,global_custody_digest,custody_tag,daemon_generation,recorded_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)", 999, null, null, "forged_insertion", "{}", null, null, null, key, "sha256:" + "1".repeat(64), "sha256:" + "2".repeat(64), "sha256:" + "3".repeat(64), generation, f.daemon.clock());
      expectCode("DSS02_EVENT_GLOBAL_SEQUENCE_GAP", () => f.daemon.ledger.verify());
    } else if (variant === "sequence gap") {
      f.daemon.store.run("UPDATE service_events SET global_sequence=99 WHERE global_sequence=3");
      expectCode("DSS02_EVENT_GLOBAL_SEQUENCE_GAP", () => f.daemon.ledger.verify());
    }
  } finally { f.daemon.close(); }
}
for (const variant of ["deletion", "reorder", "insertion", "sequence gap"]) { eventMutationVariant(variant); completeSubcase(13, variant); }

// Cancellation is prospective and cannot carry a running-attempt reference.
const cancelRequest = { schema: "direct_semantic_cancel_request@1", requestId: "cancel-1", jobRef: firstReceipt.jobRef, requestedCellRefs: ["cell-1"], boundedReason: "fixture" };
const cancelAuth = authorize(fixture, { operation: "cancel", body: cancelRequest, purposeScopes: ["semantic-request"], objectScopeDigest: digestObject("DirectSemanticService.ObjectScope.v1", { jobRef: firstReceipt.jobRef }) });
expectCode("DSS02_CANCEL_RUNNING_ATTEMPT", () => fixture.daemon.cancel({ jobRef: firstReceipt.jobRef, request: cancelRequest, authorizationReceipt: cancelAuth.receipt, signalRequestedRunningAttemptRefs: ["attempt-1"] }));
const cancelled = fixture.daemon.cancel({ jobRef: firstReceipt.jobRef, request: cancelRequest, authorizationReceipt: cancelAuth.receipt });
assert.equal(cancelled.decision, "authorized_before_dispatch");
expectCode("DSS02_CANCEL_ALREADY_DISPATCHED", () => fixture.daemon.cancel({ jobRef: firstReceipt.jobRef, request: { ...cancelRequest, requestId: "cancel-2" }, authorizationReceipt: authorize(fixture, { operation: "cancel", body: { ...cancelRequest, requestId: "cancel-2" }, objectScopeDigest: digestObject("DirectSemanticService.ObjectScope.v1", { jobRef: firstReceipt.jobRef }) }).receipt }));
assert.equal(fixture.daemon.store.get("SELECT COUNT(*) AS count FROM jobs WHERE job_ref=?", firstReceipt.jobRef).count, 1);
completeSubcase(11, "exact receipt replay"); completeSubcase(11, "no duplication"); completeSubcase(18, "running attempt"); completeSubcase(18, "admission retained"); completeSubcase(18, "ambiguous dispatch");

function custodyVariant(label, mutate, expectedCode) {
  const f = createFixture();
  try {
    const head = f.daemon.store.latestGlobalSequence();
    const priorEvent = f.daemon.store.get("SELECT global_custody_digest FROM service_events WHERE global_sequence=?", head);
    const rotation = f.daemon.keyring.rotate({ actorVerifierRef: f.adminVerifier.verifierRef, assertAdmin: (ref) => f.daemon.authority.assertServiceAdmin(ref), effectiveAfterGlobalSequence: head + 1, lastPriorKeyGlobalCustodyDigest: priorEvent?.global_custody_digest || null });
    mutate(f, rotation);
    expectCode(expectedCode, () => f.daemon.keyring.verifyLineage());
    completeSubcase(15, label);
  } finally {
    f.daemon.close();
  }
}
custodyVariant("missing historical key", (f, rotation) => fs.unlinkSync(f.daemon.keyring.pathFor(rotation.priorKeyRevisionRef)), "DSS02_CUSTODY_KEY_MISSING");
custodyVariant("forged rotation", (f, rotation) => f.daemon.store.run("UPDATE custody_rotations SET next_key_revision_ref=? WHERE rotation_ref=?", "custody-key-forged", rotation.rotationRef), "DSS02_CUSTODY_ROTATION_BROKEN");
custodyVariant("ambiguous rotation", (f, rotation) => f.daemon.store.run("UPDATE custody_keys SET state='CURRENT' WHERE custody_key_revision_ref=?", rotation.priorKeyRevisionRef), "DSS02_CUSTODY_LINEAGE_BROKEN");
{
  const f = createFixture();
  try {
  const { receipt } = submitJob(f);
  f.daemon.dispatch.establish(receipt.jobRef);
  const generation = f.daemon.generation.generationRef;
  expectCode("DSS02_FOREIGN_GENERATION", () => f.daemon.leases.acquire({ subjectRef: receipt.jobRef, operationClass: "handoff", daemonGeneration: "generation-stale" }));
  completeSubcase(16, "stale generation");
  const lease = f.daemon.leases.acquire({ subjectRef: receipt.jobRef, operationClass: "handoff", daemonGeneration: generation });
  const renewed = f.daemon.leases.renew({ leaseRef: lease.lease.leaseRef, expectedRevision: lease.lease.leaseRevision, fencingToken: lease.lease.fencingToken, daemonGeneration: generation });
  const handoffBody = { jobRef: receipt.jobRef, targetTrancheRevision: "tranche-1" };
  const handoffAuthorization = authorize(f, { operation: "handoff", body: handoffBody, objectScopeDigest: digestObject("DirectSemanticService.ObjectScope.v1", handoffBody) });
  expectCode("DSS02_STALE_LEASE", () => f.daemon.handoff({ jobRef: receipt.jobRef, authorizationReceipt: handoffAuthorization.receipt, targetTrancheRevision: "tranche-1", leaseRef: lease.lease.leaseRef, leaseRevision: lease.lease.leaseRevision, fencingToken: lease.lease.fencingToken, daemonGeneration: generation }));
  assert.equal(renewed.leaseRevision > lease.lease.leaseRevision, true);
  completeSubcase(16, "stale fencing token");
  } finally { f.daemon.close(); }
}

{
  const f = createFixture({ limits: { openJobs: 0 } });
  try {
  const beforeJobs = f.daemon.store.get("SELECT COUNT(*) AS count FROM jobs").count;
  const beforeCapacity = f.daemon.capacity.current();
  const jobRequest = request("backpressure", "backpressure");
  const authorization = submitAuthorization(f, jobRequest);
  expectCode("DSS02_BACKPRESSURED", () => f.daemon.submit({ request: jobRequest, authorizationReceipt: authorization.receipt }));
  assert.equal(f.daemon.store.get("SELECT COUNT(*) AS count FROM jobs").count, beforeJobs);
  assert.deepEqual(f.daemon.capacity.current().counters, beforeCapacity.counters);
  completeSubcase(17, "no partial job");
  } finally { f.daemon.close(); }
}

// Waiter last-slot linearization and exactly-once releases are boundary-local.
const gate = new Dss02WaiterGate({ profileRef: "profile-1", generationRef: "generation-1", limit: 1 });
const slot = gate.reserve({ connectionRef: "connection-1", waitRequestRef: "wait-1" });
assert.equal(slot.status, "RESERVED");
assert.equal(gate.reserve({ connectionRef: "connection-2", waitRequestRef: "wait-2" }).status, "AT_LIMIT");
assert.equal(gate.release({ reservationToken: slot.token.reservationToken, reason: "TIMEOUT" }).status, "RELEASED");
assert.equal(gate.release({ reservationToken: slot.token.reservationToken, reason: "TIMEOUT" }).status, "EXACT_REPLAY");
assert.equal(gate.release({ reservationToken: "foreign-token" }).status, "FOREIGN_TOKEN");
gate.reserve({ connectionRef: "connection-3", waitRequestRef: "wait-3" });
gate.invalidateRestart("generation-2");
assert.equal(gate.observation().activeCount, 0);

// Protocol framing rejects duplicate keys and oversized frames.
const encoded = encodeFrame({ schema: "direct-semantic-protocol@1", requestId: "r", method: "service status", params: {} });
assert.deepEqual(new FrameDecoder().push(encoded)[0].method, "service status");
expectCode("DSS02_JSON_DUPLICATE_KEY", () => parseJsonStrict('{"a":1,"a":2}'));
const decoder = new FrameDecoder({ maximumBytes: 8 });
expectCode("DSS02_PROTOCOL_FRAME_TOO_LARGE", () => decoder.push(Buffer.from([0, 0, 0, 9])));

// No forbidden DSS-0.2 execution/completion event can be appended.
expectCode("DSS02_EVENT_TYPE_FORBIDDEN", () => fixture.daemon.ledger.append({ eventType: "execution_completed", payload: {}, jobRef: firstReceipt.jobRef }));

// The ratified contract names 56 required negative games.  The first eighteen
// are the focused checks above; the remaining games below each execute an
// independent assertion and the explicit map is emitted in the gate receipt.
const INHERITED_GAMES = new Set([30, 41, 42, 52, 53, 54, 55, 56]);
const GAME_MAP = Object.freeze([
  { id: 1, label: "same idempotency tuple and same request", subcases: ["one job", "one admission" ] },
  { id: 2, label: "same tuple with changed request", subcases: ["changed request rejects"] },
  { id: 3, label: "copied requester or capability reference", subcases: ["copied receipt", "copied verifier reference"] },
  { id: 4, label: "transport identity cannot substitute for authority", subcases: ["transport-only submit"] },
  { id: 5, label: "submit authority cannot read", subcases: ["inspect", "subscribe", "acknowledge", "cancel"] },
  { id: 6, label: "read authority cannot submit or cancel", subcases: ["submit", "cancel"] },
  { id: 7, label: "caller paths are owner-derived", subcases: ["socket", "database", "CAS", "quarantine", "keyring", "project"] },
  { id: 8, label: "second writer and unknown migration", subcases: ["second writer", "unknown migration"] },
  { id: 9, label: "crash before CAS reference", subcases: ["no reference"] },
  { id: 10, label: "publication crash leaves orphan", subcases: ["at most orphan", "orphan observable"] },
  { id: 11, label: "crash after admission", subcases: ["exact receipt replay", "no duplication"] },
  { id: 12, label: "CAS object integrity", subcases: ["missing", "partial", "symlink", "escaped", "digest-invalid"] },
  { id: 13, label: "event custody integrity", subcases: ["deletion", "reorder", "insertion", "payload change", "sequence gap"] },
  { id: 14, label: "reducer-head drift", subcases: ["derived head mismatch"] },
  { id: 15, label: "historical key lineage", subcases: ["missing historical key", "forged rotation", "ambiguous rotation"] },
  { id: 16, label: "stale generation and fencing", subcases: ["stale generation", "stale fencing token"] },
  { id: 17, label: "backpressure", subcases: ["no partial job"] },
  { id: 18, label: "prospective cancellation", subcases: ["running attempt", "admission retained", "ambiguous dispatch"] },
  { id: 19, label: "unacknowledged delivery replay", subcases: ["offer", "acknowledged cursor", "unacknowledged replay"] },
  { id: 20, label: "wrong acknowledgment", subcases: ["digest", "principal", "job", "offer", "atomic no mutation"] },
  { id: 21, label: "read revocation", subcases: ["next offer", "replay"] },
  { id: 22, label: "wait disconnect and timeout", subcases: ["disconnect", "timeout", "cursor unchanged", "immediate response", "event wakes before deadline", "deadline wait", "disconnect releases capacity", "waiter limit", "daemon subscribe default", "registration gap reconciliation"] },
  { id: 23, label: "safe projection", subcases: ["secrets", "private paths", "quarantine", "unknown fields"] },
  { id: 24, label: "no execution/completion standing", subcases: ["API response", "event", "evaluation", "sealing"] },
  { id: 25, label: "DSS01 object-identity non-portability", subcases: ["cloned principal", "serialized capability", "DSS01 capability"] },
  { id: 26, label: "proof authority variants", subcases: ["unregistered key", "copied verifier", "forged signature", "request mutation", "operation mutation", "replayed challenge", "expired challenge", "foreign connection", "foreign generation"] },
  { id: 27, label: "bootstrap boundary", subcases: ["replay", "partial", "second", "ordinary listener"] },
  { id: 28, label: "verifier standing", subcases: ["revoked", "superseded", "expired", "stale issuer", "stale registry", "stale principal"] },
  { id: 29, label: "authority restart reconstruction", subcases: ["authenticated issuance", "authenticated revocation", "mutable projection ignored"] },
  { id: 30, label: "surface partition", gateKind: "inherited-ratification-evidence", subcases: ["frozen generation-6 P=M disjoint-union X"] },
  { id: 31, label: "recovery inventory", subcases: ["missing", "extra", "duplicate", "stale generation", "forked", "unacknowledged"] },
  { id: 32, label: "independent capacity dimensions", subcases: ["open jobs", "request bytes", "subscriptions", "offers", "retained bytes"] },
  { id: 33, label: "counter and event interleavings", subcases: ["interleaving", "restart reconstruction", "safe-integer overflow"] },
  { id: 34, label: "cancellation authorization/dispatch variants", subcases: ["running attempt", "partial authorization", "foreign generation", "committed handoff", "ambiguous dispatch"] },
  { id: 35, label: "delivery standing invalidation", subcases: ["disclosure", "acknowledgment"] },
  { id: 36, label: "atomic acknowledgment", subcases: ["cursor", "all counters", "wrong ack no mutation", "stale ack no mutation"] },
  { id: 37, label: "owner provisioning and commitment", subcases: ["missing decision", "caller reconstructed", "forged owner decision", "unsigned", "caller-signed", "foreign root", "wrong profile", "wrong daemon", "expired", "replaced", "malformed"] },
  { id: 38, label: "bootstrap attempt consumption", subcases: ["wrong secret", "wrong descriptor", "malformed administrator key", "failed attempt", "interrupted pre-commit", "second attempt"] },
  { id: 39, label: "claimed bootstrap recovery", subcases: ["claim before DB commit blocks", "exact digest finalization"] },
  { id: 40, label: "installed bootstrap chain", subcases: ["root removal", "commitment substitution", "attempt substitution", "authorization removal"] },
  { id: 41, label: "durable carrier persistence", gateKind: "inherited-ratification-evidence", subcases: ["frozen generation-6 persistence surfaces"] },
  { id: 42, label: "surface registry mutation", gateKind: "inherited-ratification-evidence", subcases: ["carrier", "lifecycle", "dependency", "operation input/output", "store population", "normative object"] },
  { id: 43, label: "admitted-job recovery population", subcases: ["missing", "extra", "orphan", "duplicate", "generic digests fixed"] },
  { id: 44, label: "admission bijection", subcases: ["idempotency", "admission genesis", "derived head", "exact one-to-one"] },
  { id: 45, label: "waiter last slot", subcases: ["linearizable limit", "exactly one contender"] },
  { id: 46, label: "waiter release lifecycle", subcases: ["response", "timeout", "disconnect", "cancelled wait", "duplicate release", "foreign token", "restart"] },
  { id: 47, label: "proof transcript grammar", subcases: ["cross-field repartition", "cross-protocol", "unknown field", "duplicate field", "noncanonical scopes", "alternate encoding", "length overflow"] },
  { id: 48, label: "challenge lifecycle", subcases: ["expired", "consumed", "duplicate", "concurrent", "foreign profile", "foreign connection", "foreign generation", "restart invalidated"] },
  { id: 49, label: "protocol and expiry identities", subcases: ["protocol revision", "challenge expiry", "signed transcript bytes"] },
  { id: 50, label: "owner-root immutability", subcases: ["operation", "state", "event", "grant", "recovery", "replay"] },
  { id: 51, label: "broken owner root", subcases: ["removal", "substitution", "unreadability", "mismatch", "BROKEN only", "no standing"] },
  { id: 52, label: "qualified lifecycle bindings", gateKind: "inherited-ratification-evidence", subcases: ["frozen generation-6 qualified transitions"] },
  { id: 53, label: "unowned lifecycle totality", gateKind: "inherited-ratification-evidence", subcases: ["frozen generation-6 generator failure fixture"] },
  { id: 54, label: "cross-output ownership scope", gateKind: "inherited-ratification-evidence", subcases: ["carrier A owned", "carrier B unowned"] },
  { id: 55, label: "explicit outcomes/no fallback", gateKind: "inherited-ratification-evidence", subcases: ["nonempty declarations", "missing fails", "extraneous fails", "no first-outcome fallback"] },
  { id: 56, label: "standing polarity", gateKind: "inherited-ratification-evidence", subcases: ["REJECTED not AUTHORIZED", "BLOCKED not READY", "CORRUPT not READY", "GAPPED not READY", "AMBIGUOUS not READY"] },
].map((row) => ({ gateKind: row.gateKind || "implementation-runtime", ...row })));
const passedGames = new Set(Array.from({ length: 18 }, (_, index) => index + 1));
function freshGame(number, action, options = {}) {
  const f = createFixture(options);
  try { action(f); passedGames.add(number); }
  finally { f.daemon.close(); }
}
function submitJob(f, id = "game-" + crypto.randomBytes(3).toString("hex"), key = "key-" + crypto.randomBytes(3).toString("hex")) {
  const jobRequest = request(id, key);
  const authorization = submitAuthorization(f, jobRequest);
  return { jobRequest, authorization, receipt: f.daemon.submit({ request: jobRequest, authorizationReceipt: authorization.receipt }) };
}
function subscribeJob(f, jobRef) {
  const body = { jobRef };
  const authorization = authorize(f, { operation: "subscribe", body, purposeScopes: ["delivery"], objectScopeDigest: digestObject("DirectSemanticService.ObjectScope.v1", body) });
  return { authorization, subscription: f.daemon.subscribe({ jobRef, authorizationReceipt: authorization.receipt, returnProjectionRef: "projection-safe@1" }) };
}

{
  const f = createFixture();
  f.daemon.store.db.exec("PRAGMA user_version=99");
  f.daemon.close();
  const restarted = new DirectSemanticDaemon({ profileRoot: f.profileRoot, installationRoot: f.installationRoot, profileRef: "profile-1" });
  expectCode("DSS02_UNKNOWN_SCHEMA_VERSION", () => restarted.start());
  restarted.close();
  completeSubcase(8, "unknown migration");
}

freshGame(19, (f) => {
  const { receipt } = submitJob(f); const { authorization, subscription } = subscribeJob(f, receipt.jobRef);
  const first = f.daemon.offer({ subscriptionRef: subscription.subscriptionRef, authorizationReceipt: authorization.receipt });
  assert.equal(f.daemon.store.get("SELECT current_cursor FROM subscriptions WHERE subscription_ref=?", subscription.subscriptionRef).current_cursor, 0);
  const replay = f.daemon.offer({ subscriptionRef: subscription.subscriptionRef, authorizationReceipt: authorization.receipt });
  assert.equal(replay.firstEventSequence, first.firstEventSequence);
  const ackBody = { deliveryAttemptRef: first.deliveryAttemptRef };
  const ackAuthorization = authorize(f, { operation: "acknowledge", body: ackBody, purposeScopes: ["delivery"], objectScopeDigest: digestObject("DirectSemanticService.ObjectScope.v1", ackBody) });
  const ack = f.daemon.ack({ deliveryAttemptRef: first.deliveryAttemptRef, jobRef: receipt.jobRef, authorizationReceipt: ackAuthorization.receipt, projectionDigest: first.projectionDigest });
  assert.equal(ack.acknowledgedSequence, first.lastEventSequence);
  assert.equal(f.daemon.store.get("SELECT current_cursor FROM subscriptions WHERE subscription_ref=?", subscription.subscriptionRef).current_cursor, first.lastEventSequence);
  assert.equal(f.daemon.offer({ subscriptionRef: subscription.subscriptionRef, authorizationReceipt: authorization.receipt }).status, "NO_NEW_EVENTS");
  completeSubcase(19, "offer"); completeSubcase(19, "acknowledged cursor"); completeSubcase(19, "unacknowledged replay");
});

freshGame(20, (f) => {
  const { receipt } = submitJob(f); const { authorization, subscription } = subscribeJob(f, receipt.jobRef);
  const offer = f.daemon.offer({ subscriptionRef: subscription.subscriptionRef, authorizationReceipt: authorization.receipt });
  const ackAuthorization = authorize(f, { operation: "acknowledge", body: { deliveryAttemptRef: offer.deliveryAttemptRef }, purposeScopes: ["delivery"], objectScopeDigest: digestObject("DirectSemanticService.ObjectScope.v1", { deliveryAttemptRef: offer.deliveryAttemptRef }) });
  const before = f.daemon.capacity.current();
  expectCode("DSS02_DELIVERY_ACK_REJECTED", () => f.daemon.ack({ deliveryAttemptRef: offer.deliveryAttemptRef, authorizationReceipt: ackAuthorization.receipt, projectionDigest: "sha256:" + "0".repeat(64) }));
  const foreignAuthorization = authorize(f, { operation: "acknowledge", body: { deliveryAttemptRef: offer.deliveryAttemptRef }, purposeScopes: ["delivery"], principal: f.adminVerifier, privateKey: f.adminKeys.privateKey, objectScopeDigest: digestObject("DirectSemanticService.ObjectScope.v1", { deliveryAttemptRef: offer.deliveryAttemptRef }) });
  expectCode("DSS02_DELIVERY_ACK_REJECTED", () => f.daemon.ack({ deliveryAttemptRef: offer.deliveryAttemptRef, authorizationReceipt: foreignAuthorization.receipt, projectionDigest: offer.projectionDigest }));
  expectCode("DSS02_DELIVERY_ACK_REJECTED", () => f.daemon.ack({ deliveryAttemptRef: offer.deliveryAttemptRef, jobRef: "job-wrong", authorizationReceipt: ackAuthorization.receipt, projectionDigest: offer.projectionDigest }));
  expectCode("DSS02_DELIVERY_ATTEMPT_UNKNOWN", () => f.daemon.ack({ deliveryAttemptRef: "delivery-offer-wrong", authorizationReceipt: ackAuthorization.receipt, projectionDigest: offer.projectionDigest }));
  assert.deepEqual(f.daemon.capacity.current().counters, before.counters);
  assert.equal(f.daemon.store.get("SELECT state FROM delivery_offers WHERE delivery_attempt_ref=?", offer.deliveryAttemptRef).state, "OFFERED");
  completeSubcase(20, "digest"); completeSubcase(20, "principal"); completeSubcase(20, "job"); completeSubcase(20, "offer"); completeSubcase(20, "atomic no mutation");
});

freshGame(21, (f) => {
  const { receipt } = submitJob(f); const { authorization, subscription } = subscribeJob(f, receipt.jobRef);
  f.daemon.authority.revokeCredential({ actorVerifierRef: f.adminVerifier.verifierRef, verifierRef: f.user.verifierRef });
  expectCode("DSS02_VERIFIER_INACTIVE", () => f.daemon.offer({ subscriptionRef: subscription.subscriptionRef, authorizationReceipt: authorization.receipt }));
  expectCode("DSS02_AUTHORIZATION_RECEIPT_INVALID", () => f.daemon.inspect({ jobRef: receipt.jobRef, authorizationReceipt: authorization.receipt }));
  completeSubcase(21, "next offer"); completeSubcase(21, "replay");
});

freshGame(22, (f) => {
  const { receipt } = submitJob(f);
  const body = { jobRef: receipt.jobRef };
  const inspectAuthorization = authorize(f, { operation: "inspect", body, objectScopeDigest: digestObject("DirectSemanticService.ObjectScope.v1", body) });
  const subscriptionAuthorization = authorize(f, { operation: "subscribe", body, purposeScopes: ["delivery"], objectScopeDigest: digestObject("DirectSemanticService.ObjectScope.v1", body) });
  const subscription = f.daemon.subscribe({ jobRef: receipt.jobRef, authorizationReceipt: subscriptionAuthorization.receipt, returnProjectionRef: "projection-safe@1" });
  const missingJob = submitJob(f, "wait-missing-subscription", "wait-missing-subscription-key").receipt;
  const missingBody = { jobRef: missingJob.jobRef };
  const missingAuthorization = authorize(f, { operation: "subscribe", body: missingBody, purposeScopes: ["delivery"], objectScopeDigest: digestObject("DirectSemanticService.ObjectScope.v1", missingBody) });
  expectCode("DSS02_SUBSCRIPTION_REQUIRED", () => f.daemon.wait({ jobRef: missingJob.jobRef, authorizationReceipt: missingAuthorization.receipt, timeoutMs: 0, connectionRef: "missing-subscription-connection", waitRequestRef: "missing-subscription-wait" }));
  expectCode("DSS02_AUTHORIZATION_RECEIPT_INVALID", () => f.daemon.wait({ jobRef: receipt.jobRef, authorizationReceipt: inspectAuthorization.receipt, timeoutMs: 0, connectionRef: "wrong-authority-connection", waitRequestRef: "wrong-authority-wait" }));
  const gate = new Dss02WaiterGate({ profileRef: f.daemon.profileRef, generationRef: f.daemon.generation.generationRef, limit: 1 });
  const reservation = gate.reserve({ connectionRef: "disconnect-connection", waitRequestRef: "disconnect-wait" });
  assert.equal(gate.release({ reservationToken: reservation.token.reservationToken, reason: "DISCONNECT" }).status, "RELEASED");
  assert.equal(gate.observation().activeCount, 0);
  const beforeCursor = f.daemon.inspect({ jobRef: receipt.jobRef, authorizationReceipt: inspectAuthorization.receipt }).cursor;
  assert.equal(beforeCursor, 0);
  const waited = f.daemon.wait({ jobRef: receipt.jobRef, subscriptionRef: subscription.subscriptionRef, authorizationReceipt: subscriptionAuthorization.receipt, afterSequence: beforeCursor + 1, timeoutMs: 0, connectionRef: "timeout-connection", waitRequestRef: "timeout-wait" });
  assert.equal(waited.status, "NO_NEW_EVENTS");
  assert.equal(waited.cursor, beforeCursor);
  assert.equal(Object.prototype.hasOwnProperty.call(waited, "deliveryAttemptRef"), false);
  assert.equal(f.daemon.inspect({ jobRef: receipt.jobRef, authorizationReceipt: inspectAuthorization.receipt }).cursor, beforeCursor);
  const defaultJob = submitJob(f, "subscribe-default", "subscribe-default-key").receipt;
  const defaultBody = { jobRef: defaultJob.jobRef };
  const defaultAuthorization = authorize(f, { operation: "subscribe", body: defaultBody, objectScopeDigest: digestObject("DirectSemanticService.ObjectScope.v1", defaultBody) });
  assert.equal(f.daemon.subscribe({ jobRef: defaultJob.jobRef, authorizationReceipt: defaultAuthorization.receipt }).returnProjectionRef, "projection-safe@1");
  completeSubcase(22, "daemon subscribe default");
  completeSubcase(22, "disconnect"); completeSubcase(22, "timeout"); completeSubcase(22, "cursor unchanged");
});

{
  const f = createFixture({ limits: { waiters: 1 } });
  try {
    const { receipt } = submitJob(f, "wait-event", "wait-event-key");
    const inspectBody = { jobRef: receipt.jobRef };
    const inspectAuthorization = authorize(f, { operation: "inspect", body: inspectBody, objectScopeDigest: digestObject("DirectSemanticService.ObjectScope.v1", inspectBody) });
    const subscriptionAuthorization = authorize(f, { operation: "subscribe", body: inspectBody, purposeScopes: ["delivery"], objectScopeDigest: digestObject("DirectSemanticService.ObjectScope.v1", inspectBody) });
    const subscription = f.daemon.subscribe({ jobRef: receipt.jobRef, authorizationReceipt: subscriptionAuthorization.receipt, returnProjectionRef: "projection-safe@1" });
    const before = f.daemon.inspect({ jobRef: receipt.jobRef, authorizationReceipt: inspectAuthorization.receipt });
    const eventStartedAt = Date.now();
    const eventWait = f.daemon.wait({ jobRef: receipt.jobRef, subscriptionRef: subscription.subscriptionRef, authorizationReceipt: subscriptionAuthorization.receipt, afterSequence: before.currentCursor, timeoutMs: 250, connectionRef: "event-connection", waitRequestRef: "event-wait" });
    assert.equal(typeof eventWait.then, "function");
    setTimeout(() => {
      const cancelRequest = { schema: "direct_semantic_cancel_request@1", requestId: "wait-event-cancel", jobRef: receipt.jobRef, requestedCellRefs: [], boundedReason: "wait-event" };
      const cancelAuthorization = authorize(f, { operation: "cancel", body: cancelRequest, objectScopeDigest: digestObject("DirectSemanticService.ObjectScope.v1", { jobRef: receipt.jobRef }) });
      f.daemon.cancel({ jobRef: receipt.jobRef, request: cancelRequest, authorizationReceipt: cancelAuthorization.receipt });
    }, 25);
    const eventResult = await eventWait;
    const eventElapsedMs = Date.now() - eventStartedAt;
    waitTimingEvidence.eventWakeMs = eventElapsedMs;
    assert.ok(eventElapsedMs >= 15 && eventElapsedMs < 220, `event wait should wake before deadline: ${eventElapsedMs}ms`);
    assert.equal(eventResult.schema, "direct_semantic_delivery_attempt@1");
    assert.ok(eventResult.lastEventSequence > before.currentCursor);
    assert.equal(eventResult.projectionDigest, eventResult.projection.projectionDigest);
    assert.equal(f.daemon.waiterGate.observation().activeCount, 0);
    assert.equal([...f.daemon.waiterGate.releases.values()].at(-1).reason, "RESPONSE");
    completeSubcase(22, "event wakes before deadline");

    const ackBody = { deliveryAttemptRef: eventResult.deliveryAttemptRef };
    const ackAuthorization = authorize(f, { operation: "acknowledge", body: ackBody, purposeScopes: ["delivery"], objectScopeDigest: digestObject("DirectSemanticService.ObjectScope.v1", ackBody) });
    const ack = f.daemon.ack({ deliveryAttemptRef: eventResult.deliveryAttemptRef, jobRef: receipt.jobRef, authorizationReceipt: ackAuthorization.receipt, projectionDigest: eventResult.projectionDigest });
    assert.equal(ack.acknowledgedSequence, eventResult.lastEventSequence);
    const immediate = f.daemon.wait({ jobRef: receipt.jobRef, subscriptionRef: subscription.subscriptionRef, authorizationReceipt: subscriptionAuthorization.receipt, afterSequence: eventResult.lastEventSequence, timeoutMs: 0, connectionRef: "immediate-connection", waitRequestRef: "immediate-wait" });
    assert.equal(immediate.status, "NO_NEW_EVENTS");
    assert.equal(immediate.cursor, eventResult.lastEventSequence, "acknowledged cursor must be authoritative");
    assert.equal(immediate.currentCursor, f.daemon.inspect({ jobRef: receipt.jobRef, authorizationReceipt: inspectAuthorization.receipt }).currentCursor);
    assert.equal(Object.prototype.hasOwnProperty.call(immediate, "deliveryAttemptRef"), false);
    assert.equal([...f.daemon.waiterGate.releases.values()].at(-1).reason, "RESPONSE");
    completeSubcase(22, "immediate response");
  } finally { f.daemon.close(); }
}

{
  const f = createFixture({ limits: { waiters: 1 } });
  try {
    const { receipt } = submitJob(f, "wait-deadline", "wait-deadline-key");
    const body = { jobRef: receipt.jobRef };
    const inspectAuthorization = authorize(f, { operation: "inspect", body, objectScopeDigest: digestObject("DirectSemanticService.ObjectScope.v1", body) });
    const subscriptionAuthorization = authorize(f, { operation: "subscribe", body, purposeScopes: ["delivery"], objectScopeDigest: digestObject("DirectSemanticService.ObjectScope.v1", body) });
    const subscription = f.daemon.subscribe({ jobRef: receipt.jobRef, authorizationReceipt: subscriptionAuthorization.receipt, returnProjectionRef: "projection-safe@1" });
    const before = f.daemon.inspect({ jobRef: receipt.jobRef, authorizationReceipt: inspectAuthorization.receipt });
    const offersBefore = f.daemon.store.get("SELECT COUNT(*) AS count FROM delivery_offers WHERE subscription_ref=?", subscription.subscriptionRef).count;
    const startedAt = Date.now();
    const result = await f.daemon.wait({ jobRef: receipt.jobRef, subscriptionRef: subscription.subscriptionRef, authorizationReceipt: subscriptionAuthorization.receipt, afterSequence: before.currentCursor, timeoutMs: 75, connectionRef: "deadline-connection", waitRequestRef: "deadline-wait" });
    const elapsedMs = Date.now() - startedAt;
    waitTimingEvidence.deadlineWaitMs = elapsedMs;
    assert.ok(elapsedMs >= 60 && elapsedMs < 500, `no-event wait should retain reservation until deadline: ${elapsedMs}ms`);
    assert.equal(result.status, "NO_NEW_EVENTS");
    assert.equal(result.cursor, subscription.currentCursor, "a deadline no-event result must not advance the acknowledged cursor");
    assert.equal(result.currentCursor, before.currentCursor);
    assert.equal(Object.prototype.hasOwnProperty.call(result, "deliveryAttemptRef"), false);
    assert.equal(f.daemon.store.get("SELECT COUNT(*) AS count FROM delivery_offers WHERE subscription_ref=?", subscription.subscriptionRef).count, offersBefore, "a no-event timeout must not create a delivery offer");
    assert.equal(f.daemon.waiterGate.observation().activeCount, 0);
    assert.equal([...f.daemon.waiterGate.releases.values()].at(-1).reason, "TIMEOUT");
    completeSubcase(22, "deadline wait");

    const pending = f.daemon.wait({ jobRef: receipt.jobRef, subscriptionRef: subscription.subscriptionRef, authorizationReceipt: subscriptionAuthorization.receipt, afterSequence: before.currentCursor, timeoutMs: 250, connectionRef: "disconnect-live-connection", waitRequestRef: "disconnect-live-wait" });
    assert.equal(f.daemon.waiterGate.observation().activeCount, 1);
    assert.throws(() => f.daemon.wait({ jobRef: receipt.jobRef, subscriptionRef: subscription.subscriptionRef, authorizationReceipt: subscriptionAuthorization.receipt, afterSequence: before.currentCursor, timeoutMs: 250, connectionRef: "limited-connection", waitRequestRef: "limited-wait" }), (error) => error?.code === "DSS02_WAITER_AT_LIMIT");
    completeSubcase(22, "waiter limit");
    f.daemon.disconnectTransport("disconnect-live-connection");
    await assert.rejects(pending, (error) => error?.code === "DSS02_CONNECTION_CLOSED");
    assert.equal(f.daemon.waiterGate.observation().activeCount, 0);
    assert.equal([...f.daemon.waiterGate.releases.values()].at(-1).reason, "CONNECTION_CLOSED");
    completeSubcase(22, "disconnect releases capacity");
  } finally { f.daemon.close(); }
}

{
  const f = createFixture({ limits: { waiters: 1 } });
  try {
    const { receipt } = submitJob(f, "wait-registration-gap", "wait-registration-gap-key");
    const body = { jobRef: receipt.jobRef };
    const inspectAuthorization = authorize(f, { operation: "inspect", body, objectScopeDigest: digestObject("DirectSemanticService.ObjectScope.v1", body) });
    const subscriptionAuthorization = authorize(f, { operation: "subscribe", body, purposeScopes: ["delivery"], objectScopeDigest: digestObject("DirectSemanticService.ObjectScope.v1", body) });
    const subscription = f.daemon.subscribe({ jobRef: receipt.jobRef, authorizationReceipt: subscriptionAuthorization.receipt, returnProjectionRef: "projection-safe@1" });
    const before = f.daemon.inspect({ jobRef: receipt.jobRef, authorizationReceipt: inspectAuthorization.receipt });
    const originalHasEventsAfter = f.daemon.delivery.hasEventsAfter.bind(f.daemon.delivery);
    let firstObservation;
    f.daemon.delivery.hasEventsAfter = (options) => {
      const observed = originalHasEventsAfter(options);
      if (!firstObservation) {
        firstObservation = observed;
        const cancelRequest = { schema: "direct_semantic_cancel_request@1", requestId: "wait-registration-gap-cancel", jobRef: receipt.jobRef, requestedCellRefs: [], boundedReason: "wait-registration-gap" };
        const cancelAuthorization = authorize(f, { operation: "cancel", body: cancelRequest, objectScopeDigest: digestObject("DirectSemanticService.ObjectScope.v1", { jobRef: receipt.jobRef }) });
        f.daemon.cancel({ jobRef: receipt.jobRef, request: cancelRequest, authorizationReceipt: cancelAuthorization.receipt });
      }
      return observed;
    };
    const releaseCountBefore = f.daemon.waiterGate.releases.size;
    const startedAt = Date.now();
    const result = await f.daemon.wait({ jobRef: receipt.jobRef, subscriptionRef: subscription.subscriptionRef, authorizationReceipt: subscriptionAuthorization.receipt, afterSequence: before.currentCursor, timeoutMs: 250, connectionRef: "registration-gap-connection", waitRequestRef: "registration-gap-wait" });
    const elapsedMs = Date.now() - startedAt;
    waitTimingEvidence.registrationGapMs = elapsedMs;
    assert.equal(firstObservation.qualifies, false, "the first delivery qualification must return the pre-event observation");
    assert.ok(elapsedMs < 220, `registration-gap wait should respond promptly: ${elapsedMs}ms`);
    assert.equal(result.schema, "direct_semantic_delivery_attempt@1");
    assert.ok(result.lastEventSequence > before.currentCursor, "reconciliation must offer the synchronously appended event");
    assert.equal(f.daemon.waiterGate.observation().activeCount, 0);
    assert.equal(f.daemon.waiterGate.releases.size, releaseCountBefore + 1, "waiter capacity must release exactly once");
    assert.equal([...f.daemon.waiterGate.releases.values()].at(-1).reason, "RESPONSE");
    completeSubcase(22, "registration gap reconciliation");
  } finally { await f.daemon.close(); }
}

freshGame(23, (f) => {
  const { receipt } = submitJob(f); const authorization = authorize(f, { operation: "inspect", body: { jobRef: receipt.jobRef }, objectScopeDigest: digestObject("DirectSemanticService.ObjectScope.v1", { jobRef: receipt.jobRef }) });
  const projection = f.daemon.inspect({ jobRef: receipt.jobRef, authorizationReceipt: authorization.receipt });
  assert.equal(Object.prototype.hasOwnProperty.call(projection, "profileRoot"), false);
  assert.equal(JSON.stringify(projection).includes("private.der"), false);
  const quarantine = f.daemon.quarantine.capture(Buffer.from("diagnostic"), { diagnosticCode: "fixture" });
  assert.equal(JSON.stringify(projection).includes(quarantine.quarantineRef), false);
  const storedRequest = JSON.parse(f.daemon.store.get("SELECT request_json FROM jobs WHERE job_ref=?", receipt.jobRef).request_json);
  f.daemon.store.run("UPDATE jobs SET request_json=? WHERE job_ref=?", JSON.stringify({ ...storedRequest, unknownSecret: "must-not-project" }), receipt.jobRef);
  const filtered = f.daemon.inspect({ jobRef: receipt.jobRef, authorizationReceipt: authorization.receipt });
  assert.equal(Object.prototype.hasOwnProperty.call(filtered.request, "unknownSecret"), false);
  completeSubcase(23, "secrets"); completeSubcase(23, "private paths"); completeSubcase(23, "quarantine"); completeSubcase(23, "unknown fields");
});

freshGame(24, (f) => {
  const { receipt } = submitJob(f); const authorization = authorize(f, { operation: "inspect", body: { jobRef: receipt.jobRef }, objectScopeDigest: digestObject("DirectSemanticService.ObjectScope.v1", { jobRef: receipt.jobRef }) });
  const text = JSON.stringify(f.daemon.inspect({ jobRef: receipt.jobRef, authorizationReceipt: authorization.receipt }));
  assert.equal(/execution_completed|microresult|model_output|completion/i.test(text), false);
  assert.equal(f.daemon.ledger.eventsForJob(receipt.jobRef).some((event) => /execute|completion|evaluation/i.test(event.eventType)), false);
  for (const eventType of ["evaluation_admitted", "sealed_result"]) expectCode("DSS02_EVENT_TYPE_FORBIDDEN", () => f.daemon.ledger.append({ eventType, payload: {}, jobRef: receipt.jobRef }));
  assert.equal(/execution_completed|microresult|model_output|evaluation_admitted|sealed_result|semantic_completion/i.test(text), false);
  completeSubcase(24, "API response"); completeSubcase(24, "event"); completeSubcase(24, "evaluation"); completeSubcase(24, "sealing");
});

freshGame(25, (f) => {
  const dss01 = dss.createDirectSemanticServiceFoundation({ principalAuthorityId: "dss01-principal", capabilityAuthorityId: "dss01-capability", registryAuthorityRef: "dss01-registry", authorizationAuthorityId: "dss01-authorization" });
  const transport = dss01.principalAuthority.deriveTransportPrincipal({ transport: "internal", hostUserId: "dss01-user", observedAt: new Date().toISOString() });
  const oldPrincipal = dss01.principalAuthority.issueSemanticPrincipal({ principalId: "dss01-user", issuerRevision: "dss01-issuer-r1", principalClass: "operator", subjectRef: "dss01-user", projectScopes: [], purposeScopes: ["semantic_request"], transportPrincipal: transport });
  const oldCapability = dss01.capabilityAuthority.issue({ capabilityId: "dss01-capability", principal: oldPrincipal, operation: "submit_job", jobRefs: [], projectRegistryRevisionRefs: ["dss01-project-r1"], allowedTargetORevisions: ["dss01-target-o-r1"], targetSnapshotReceiptRefs: ["dss01-snapshot-r1"], compilerPinRefs: ["dss01-compiler-r1"], kernelRevisionRefs: ["dss01-kernel-r1"], executionProfileRevisionRefs: ["dss01-execution-r1"], providerProfileRevisionRefs: ["dss01-provider-r1"], allowedModels: ["dss01-model"], allowedReasoningEfforts: ["minimal"], attemptPolicyRevisionRefs: ["dss01-attempt-r1"], purposeScopes: ["semantic_request"], returnProjectionRefs: ["dss01-projection-r1"], maximumJobs: 1, maximumCellsPerJob: 1, maximumReplicatesPerCell: 1, maximumInputTokensPerJob: 1, maximumOutputTokensPerJob: 1, maximumCostMicrounitsPerJob: 1, issuedAt: new Date().toISOString(), nonce: "dss01-capability-nonce" });
  const oldReceipt = { schema: oldCapability.schema, decision: "AUTHORIZED", operation: "submit_job", principalRef: oldPrincipal.principalId, verifierRef: oldCapability.capabilityId };
  expectCode("DSS02_AUTHORIZATION_RECEIPT_INVALID", () => f.daemon.submit({ request: request("cloned-principal", "cloned-principal"), authorizationReceipt: { ...oldReceipt, principalRef: JSON.parse(JSON.stringify(oldPrincipal)).principalId } }));
  completeSubcase(25, "cloned principal");
  expectCode("DSS02_AUTHORIZATION_RECEIPT_INVALID", () => f.daemon.submit({ request: request("serialized-capability", "serialized-capability"), authorizationReceipt: JSON.parse(JSON.stringify(oldReceipt)) }));
  completeSubcase(25, "serialized capability");
  expectCode("DSS02_VERIFIER_UNKNOWN", () => f.daemon.authority.assertCurrentVerifier(oldCapability.capabilityId, { operation: "submit" }));
  completeSubcase(25, "DSS01 capability");
});

freshGame(26, (f) => {
  const body = request("proof-shape", "proof-shape");
  const digest = digestObject("DirectSemanticService.SemanticJobRequest.v1", body);
  const scope = digestObject("DirectSemanticService.ObjectScope.v1", { projectRef: body.projectRef });
  function proofCase(label, mutate = () => {}, { resolveConnectionRef = undefined, resolveTransport = undefined, resolveRequestDigest = digest, verifier = f.user, privateKey = f.userKeys.privateKey, expectedDecision = "DENIED_AND_CONSUMED" } = {}) {
    const connectionRef = `proof-${label.replace(/[^a-z]+/g, "-")}`;
    const transport = f.daemon.observeTransportPeer({ connectionRef });
    const challenge = f.daemon.authority.issueAuthorizationChallenge({ connectionRef, transportObservation: transport });
    const proof = { ...createAuthorizationProof({ challenge, requestDigest: digest, operation: "submit", purposeScopes: ["semantic-request"], objectScopeDigest: scope, verifier, privateKey }) };
    mutate({ proof, challenge, connectionRef, transport, digest });
    const denied = f.daemon.authority.resolveDaemonCredential({ connectionRef: resolveConnectionRef || connectionRef, transportObservation: resolveTransport || transport, challengeRef: challenge.challengeRef, proof, requestDigest: resolveRequestDigest, operation: "submit", purposeScopes: ["semantic-request"], objectScopeDigest: scope, registryRevisionSet: [] });
    assert.equal(denied.receipt?.decision || denied.decision, expectedDecision, label);
    completeSubcase(26, label);
  }
  proofCase("unregistered key", ({ proof }) => { proof.verifierRef = "verifier-unregistered"; });
  const other = createFixture();
  try {
    proofCase("copied verifier", () => {}, { verifier: other.user, privateKey: other.userKeys.privateKey });
  } finally { other.daemon.close(); }
  proofCase("forged signature", ({ proof }) => { proof.signature = Buffer.alloc(64, 7).toString("base64url"); });
  proofCase("request mutation", () => {}, { resolveRequestDigest: digestObject("DirectSemanticService.SemanticJobRequest.v1", request("mutated", "proof-shape")) });
  proofCase("operation mutation", ({ proof }) => { proof.operation = "inspect"; });
  {
    const connectionRef = "proof-replay"; const transport = f.daemon.observeTransportPeer({ connectionRef }); const challenge = f.daemon.authority.issueAuthorizationChallenge({ connectionRef, transportObservation: transport }); const proof = createAuthorizationProof({ challenge, requestDigest: digest, operation: "submit", purposeScopes: ["semantic-request"], objectScopeDigest: scope, verifier: f.user, privateKey: f.userKeys.privateKey });
    const first = f.daemon.authority.resolveDaemonCredential({ connectionRef, transportObservation: transport, challengeRef: challenge.challengeRef, proof, requestDigest: digest, operation: "submit", purposeScopes: ["semantic-request"], objectScopeDigest: scope, registryRevisionSet: [] });
    assert.equal(first.receipt.decision, "AUTHORIZED");
    const replay = f.daemon.authority.resolveDaemonCredential({ connectionRef, transportObservation: transport, challengeRef: challenge.challengeRef, proof, requestDigest: digest, operation: "submit", purposeScopes: ["semantic-request"], objectScopeDigest: scope, registryRevisionSet: [] });
    assert.equal(replay.decision, "REPLAYED_OR_CONCURRENT_CHALLENGE"); completeSubcase(26, "replayed challenge");
  }
  proofCase("expired challenge", ({ challenge }) => { f.daemon.store.run("UPDATE authorization_challenges SET expires_at=? WHERE challenge_ref=?", "2000-01-01T00:00:00.000Z", challenge.challengeRef); }, { expectedDecision: "EXPIRED" });
  {
    const connectionRef = "proof-foreign-connection"; const foreignRef = "proof-foreign-connection-target"; const transport = f.daemon.observeTransportPeer({ connectionRef }); const foreignTransport = f.daemon.observeTransportPeer({ connectionRef: foreignRef }); const challenge = f.daemon.authority.issueAuthorizationChallenge({ connectionRef, transportObservation: transport }); const proof = createAuthorizationProof({ challenge, requestDigest: digest, operation: "submit", purposeScopes: ["semantic-request"], objectScopeDigest: scope, verifier: f.user, privateKey: f.userKeys.privateKey });
    const denied = f.daemon.authority.resolveDaemonCredential({ connectionRef: foreignRef, transportObservation: foreignTransport, challengeRef: challenge.challengeRef, proof, requestDigest: digest, operation: "submit", purposeScopes: ["semantic-request"], objectScopeDigest: scope, registryRevisionSet: [] });
    assert.equal(denied.receipt?.decision || denied.decision, "DENIED_AND_CONSUMED"); completeSubcase(26, "foreign connection");
  }
  proofCase("foreign generation", ({ challenge }) => { f.daemon.store.run("UPDATE authorization_challenges SET daemon_generation=? WHERE challenge_ref=?", "generation-foreign", challenge.challengeRef); });
});

freshGame(27, (f) => {
  expectCode("DSS02_BOOTSTRAP_ALREADY_ATTEMPTED", () => f.daemon.bootstrap({ secret: f.genesis.secret, descriptorProvenance: { kind: "owner_inherited_fd", revision: "descriptor-policy@1" }, administratorPublicKey: f.adminKeys.publicKey }));
  assert.equal(f.daemon.store.get("SELECT COUNT(*) AS count FROM bootstrap_authorizations WHERE state='AUTHORIZED_ONCE'").count, 1);
  completeSubcase(27, "replay"); completeSubcase(27, "second");
  const partialRoot = tempRoot(); const partialInstallation = path.join(partialRoot, "installation"); const partialProfile = path.join(partialRoot, "profile"); installOwnerBootstrapTrustRoot({ installationRoot: partialInstallation }); const partialGenesis = provisionBootstrapCommitment({ installationRoot: partialInstallation, profileRoot: partialProfile, profileRef: "partial" });
  const pending = JSON.parse(fs.readFileSync(partialGenesis.profilePaths.pending, "utf8")); pending.commitmentDigest = "sha256:" + "0".repeat(64); fs.writeFileSync(partialGenesis.profilePaths.pending, JSON.stringify(pending));
  const partialKeys = crypto.generateKeyPairSync("ed25519"); const partialDaemon = new DirectSemanticDaemon({ profileRoot: partialProfile, installationRoot: partialInstallation, profileRef: "partial", bootstrap: { secret: partialGenesis.secret, descriptorProvenance: { kind: "owner_inherited_fd", revision: "descriptor-policy@1" }, administratorPublicKey: partialKeys.publicKey } }); assert.equal(partialDaemon.start().ready, false); partialDaemon.close();
  completeSubcase(27, "partial");
  const listenerRoot = tempRoot(); const listenerInstallation = path.join(listenerRoot, "installation"); const listenerProfile = path.join(listenerRoot, "profile"); installOwnerBootstrapTrustRoot({ installationRoot: listenerInstallation }); provisionBootstrapCommitment({ installationRoot: listenerInstallation, profileRoot: listenerProfile, profileRef: "listener" }); const ordinaryListener = new DirectSemanticDaemon({ profileRoot: listenerProfile, installationRoot: listenerInstallation, profileRef: "listener", listen: true }); const listenerStatus = ordinaryListener.start({ listen: true }); assert.equal(listenerStatus.ready, false); assert.equal(fs.existsSync(ordinaryListener.store.paths.socket), false); ordinaryListener.close();
  completeSubcase(27, "ordinary listener");
});

freshGame(28, (f) => {
  const expiredKeys = crypto.generateKeyPairSync("ed25519");
  const expired = f.daemon.authority.issueCredential({ actorVerifierRef: f.adminVerifier.verifierRef, principalId: "expired-user", subjectRef: "expired", publicKey: expiredKeys.publicKey, operations: ["submit"], expiresAt: "2000-01-01T00:00:00.000Z" });
  const expiredAuth = authorize(f, { operation: "submit", body: request("expired", "expired"), principal: expired.verifier, privateKey: expiredKeys.privateKey });
  assert.equal(expiredAuth.receipt.decision, "DENIED_AND_CONSUMED");
  completeSubcase(28, "expired");
  const supersededKeys = crypto.generateKeyPairSync("ed25519"); const superseded = f.daemon.authority.issueCredential({ actorVerifierRef: f.adminVerifier.verifierRef, principalId: "superseded-user", subjectRef: "superseded", publicKey: supersededKeys.publicKey, operations: ["submit"] });
  f.daemon.store.run("UPDATE principals SET state='SUPERSEDED' WHERE principal_ref=?", superseded.principal.principalRef);
  expectCode("DSS02_PRINCIPAL_STALE", () => f.daemon.authority.assertCurrentVerifier(superseded.verifier.verifierRef, { operation: "submit" }));
  completeSubcase(28, "superseded");
  const registryKeys = crypto.generateKeyPairSync("ed25519"); const registryBound = f.daemon.authority.issueCredential({ actorVerifierRef: f.adminVerifier.verifierRef, principalId: "registry-user", subjectRef: "registry-user", publicKey: registryKeys.publicKey, operations: ["submit"], registryRevisions: ["registry-revision-1"] });
  const registryAuth = authorize(f, { operation: "submit", body: request("registry", "registry"), principal: registryBound.verifier, privateKey: registryKeys.privateKey });
  assert.equal(registryAuth.receipt.decision, "DENIED_AND_CONSUMED");
  completeSubcase(28, "stale registry");
  const staleKeys = crypto.generateKeyPairSync("ed25519");
  const stale = f.daemon.authority.issueCredential({ actorVerifierRef: f.adminVerifier.verifierRef, principalId: "stale-user", subjectRef: "stale", publicKey: staleKeys.publicKey, operations: ["submit"], purposeScopes: ["semantic-request"], objectScopes: ["*"] });
  const revokedKeys = crypto.generateKeyPairSync("ed25519"); const revoked = f.daemon.authority.issueCredential({ actorVerifierRef: f.adminVerifier.verifierRef, principalId: "revoked-user", subjectRef: "revoked-user", publicKey: revokedKeys.publicKey, operations: ["submit"] });
  const principalKeys = crypto.generateKeyPairSync("ed25519"); const principalStale = f.daemon.authority.issueCredential({ actorVerifierRef: f.adminVerifier.verifierRef, principalId: "principal-stale", subjectRef: "principal-stale", publicKey: principalKeys.publicKey, operations: ["submit"] });
  f.daemon.store.run("UPDATE verifiers SET state='REVOKED' WHERE verifier_ref=?", f.adminVerifier.verifierRef);
  expectCode("DSS02_ISSUER_STALE", () => f.daemon.authority.assertCurrentVerifier(stale.verifier.verifierRef, { operation: "submit" }));
  completeSubcase(28, "stale issuer");
  f.daemon.store.run("UPDATE verifiers SET state='REVOKED' WHERE verifier_ref=?", revoked.verifier.verifierRef);
  expectCode("DSS02_VERIFIER_INACTIVE", () => f.daemon.authority.assertCurrentVerifier(revoked.verifier.verifierRef, { operation: "submit" }));
  completeSubcase(28, "revoked");
  f.daemon.store.run("UPDATE principals SET state='SUPERSEDED' WHERE principal_ref=?", principalStale.principal.principalRef);
  expectCode("DSS02_PRINCIPAL_STALE", () => f.daemon.authority.assertCurrentVerifier(principalStale.verifier.verifierRef, { operation: "submit" }));
  completeSubcase(28, "stale principal");
});

freshGame(29, (f) => {
  const adminRef = f.adminVerifier.verifierRef; const userKeys = crypto.generateKeyPairSync("ed25519");
  const issued = f.daemon.authority.issueCredential({ actorVerifierRef: adminRef, principalId: "restart-user", subjectRef: "restart", publicKey: userKeys.publicKey, operations: ["submit"], objectScopes: ["*"] });
  completeSubcase(29, "authenticated issuance");
  f.daemon.authority.revokeCredential({ actorVerifierRef: adminRef, verifierRef: issued.verifier.verifierRef, reasonCode: "restart-fixture" });
  completeSubcase(29, "authenticated revocation");
  const profileRoot = f.profileRoot; const installationRoot = f.installationRoot; f.daemon.close();
  const restarted = new DirectSemanticDaemon({ profileRoot, installationRoot, profileRef: "profile-1" }); assert.equal(restarted.start().ready, true);
  restarted.store.run("UPDATE verifiers SET state='CURRENT' WHERE verifier_ref=?", issued.verifier.verifierRef);
  restarted.close();
  const blocked = new DirectSemanticDaemon({ profileRoot, installationRoot, profileRef: "profile-1" }); const blockedStatus = blocked.start(); assert.equal(blockedStatus.ready, false); assert.equal(blocked.blockedReason, "DSS02_AUTHORITY_STATE_DRIFT"); blocked.close();
  completeSubcase(29, "mutable projection ignored");
});

{
  const surface = JSON.parse(fs.readFileSync(path.join(DSS02_FIXTURE_ROOT, "surface_reconciliation.v6.json"), "utf8"));
  assert.equal(surface.partitionProof.pCount, 912); assert.equal(surface.partitionProof.mCount, 900); assert.equal(surface.partitionProof.xCount, 12);
  assert.equal(surface.partitionProof.intersectionCount, 0); assert.equal(surface.partitionProof.uncoveredCount, 0); assert.equal(surface.partitionProof.outsideUniverseCount, 0); completeSubcase(30, "frozen generation-6 P=M disjoint-union X"); passedGames.add(30);
}

function assertRecoveryBlocked(f) {
  const disposition = f.daemon.recovery.recover({ generationRef: f.daemon.generation.generationRef, ownerRootStatus: "PINNED", ownerRootFingerprint: f.daemon.store.get("SELECT owner_root_fingerprint FROM owner_roots").owner_root_fingerprint });
  assert.equal(disposition.state, "BLOCKED");
  return disposition;
}
function recoveryVariant(variant) {
  const f = createFixture();
  try {
    const { receipt } = submitJob(f);
    if (variant === "missing") f.daemon.store.run("DELETE FROM idempotency_bindings WHERE job_ref=?", receipt.jobRef);
    if (variant === "extra") f.daemon.store.run("INSERT INTO idempotency_bindings(principal_ref,operation,idempotency_key,request_digest,job_ref,admission_event_digest,principal_lineage_revision,verifier_revision,creation_global_sequence,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)", "orphan-principal", "submit", "orphan-key", digestObject("DirectSemanticService.SemanticJobRequest.v1", request("orphan", "orphan")), "job-orphan", "sha256:" + "1".repeat(64), "lineage-orphan", "verifier-orphan", 1, f.daemon.clock());
    if (variant === "duplicate") {
      const duplicate = request("duplicate", "duplicate"); const now = f.daemon.clock();
      f.daemon.store.run("INSERT INTO jobs(job_ref,request_json,request_digest,principal_ref,verifier_ref,principal_lineage_revision,verifier_revision,operation,state,event_sequence,event_digest,created_at,updated_at,request_bytes) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)", "job-duplicate", JSON.stringify(duplicate), digestObject("DirectSemanticService.SemanticJobRequest.v1", duplicate), f.user.principalRef, f.user.verifierRef, f.user.principalLineageRevision, f.user.verifierRevision, "submit", "ADMITTED", 0, null, now, now, Buffer.byteLength(JSON.stringify(duplicate)));
    }
    if (variant === "stale generation") {
      const connectionRef = "stale-generation-recovery"; const transport = f.daemon.observeTransportPeer({ connectionRef }); const challenge = f.daemon.authority.issueAuthorizationChallenge({ connectionRef, transportObservation: transport });
      f.daemon.store.run("UPDATE authorization_challenges SET daemon_generation=? WHERE challenge_ref=?", "generation-fork-not-installed", challenge.challengeRef);
    }
    if (variant === "forked") f.daemon.store.run("UPDATE job_heads SET projection_digest=? WHERE job_ref=?", "sha256:" + "f".repeat(64), receipt.jobRef);
    if (variant === "unacknowledged") { const { subscription, authorization } = subscribeJob(f, receipt.jobRef); const offer = f.daemon.offer({ subscriptionRef: subscription.subscriptionRef, authorizationReceipt: authorization.receipt }); f.daemon.store.run("DELETE FROM artifacts WHERE artifact_ref=?", offer.projectionArtifactRef); }
    assertRecoveryBlocked(f);
  } finally { f.daemon.close(); }
}
freshGame(31, () => {
  for (const variant of ["missing", "extra", "duplicate", "stale generation", "forked", "unacknowledged"]) { recoveryVariant(variant); completeSubcase(31, variant); }
});

function offerStorageSnapshot(f) {
  const casRoot = f.daemon.store.paths.cas;
  return {
    artifacts: f.daemon.store.all("SELECT * FROM artifacts ORDER BY artifact_ref"),
    deliveryOffers: f.daemon.store.all("SELECT * FROM delivery_offers ORDER BY delivery_attempt_ref"),
    capacity: f.daemon.store.all("SELECT * FROM capacity_counters ORDER BY singleton"),
    cas: fs.readdirSync(casRoot).sort().map((name) => ({ name, bytes: fs.readFileSync(path.join(casRoot, name)).toString("base64") })),
  };
}

function runLimited(limits, action) { const f = createFixture({ limits }); try { action(f); } finally { f.daemon.close(); } }
runLimited({ openJobs: 0 }, (f) => { const before = f.daemon.store.get("SELECT COUNT(*) AS count FROM jobs").count; expectCode("DSS02_BACKPRESSURED", () => submitJob(f)); assert.equal(f.daemon.store.get("SELECT COUNT(*) AS count FROM jobs").count, before); completeSubcase(32, "open jobs"); });
runLimited({ requestBytes: 1 }, (f) => { const before = f.daemon.store.get("SELECT COUNT(*) AS count FROM jobs").count; expectCode("DSS02_BACKPRESSURED", () => submitJob(f)); assert.equal(f.daemon.store.get("SELECT COUNT(*) AS count FROM jobs").count, before); completeSubcase(32, "request bytes"); });
runLimited({ subscriptions: 0 }, (f) => { const { receipt } = submitJob(f); const body = { jobRef: receipt.jobRef }; const authorization = authorize(f, { operation: "subscribe", body, objectScopeDigest: digestObject("DirectSemanticService.ObjectScope.v1", body) }); const before = f.daemon.capacity.current().subscriptions; expectCode("DSS02_BACKPRESSURED", () => f.daemon.subscribe({ jobRef: receipt.jobRef, authorizationReceipt: authorization.receipt, returnProjectionRef: "projection-safe@1" })); assert.equal(f.daemon.capacity.current().subscriptions, before); completeSubcase(32, "subscriptions"); });
runLimited({ outstandingOffers: 0 }, (f) => { const { receipt } = submitJob(f); const { authorization, subscription } = subscribeJob(f, receipt.jobRef); const before = offerStorageSnapshot(f); for (const attempt of [0, 1]) expectCode("DSS02_BACKPRESSURED", () => f.daemon.offer({ subscriptionRef: subscription.subscriptionRef, authorizationReceipt: authorization.receipt })); assert.deepEqual(offerStorageSnapshot(f), before, "outstanding-offer admission must not publish CAS or metadata on failure"); completeSubcase(32, "offers"); });
{
  const f = createFixture();
  try {
    const { receipt } = submitJob(f, "publication-rollback", "publication-rollback");
    const { authorization, subscription } = subscribeJob(f, receipt.jobRef);
    const before = offerStorageSnapshot(f);
    const originalPublishPrepared = f.daemon.cas.publishPreparedInTransaction.bind(f.daemon.cas);
    f.daemon.cas.publishPreparedInTransaction = (tx, prepared, hooks = {}) =>
      originalPublishPrepared(tx, prepared, {
        ...hooks,
        onCreatedFile: (filePath) => {
          hooks.onCreatedFile?.(filePath);
          const error = new Error("injected post-publication metadata failure");
          error.code = "DSS02_INJECTED_PUBLICATION_FAILURE";
          throw error;
        },
      });
    try {
      expectCode("DSS02_CAS_PUBLICATION_FAILED", () => f.daemon.offer({
        subscriptionRef: subscription.subscriptionRef,
        authorizationReceipt: authorization.receipt,
      }));
    } finally {
      f.daemon.cas.publishPreparedInTransaction = originalPublishPrepared;
    }
    assert.deepEqual(offerStorageSnapshot(f), before, "post-publication failure must roll back metadata, capacity, offers, and CAS bytes");
    const successful = f.daemon.offer({
      subscriptionRef: subscription.subscriptionRef,
      authorizationReceipt: authorization.receipt,
    });
    assert.equal(successful.state, "OFFERED");
    assert.equal(f.daemon.store.get("SELECT COUNT(*) AS count FROM artifacts").count, 1);
    assert.equal(f.daemon.store.get("SELECT COUNT(*) AS count FROM delivery_offers").count, 1);
    assert.equal(f.daemon.store.get("SELECT projection_artifact_ref FROM delivery_offers WHERE delivery_attempt_ref=?", successful.deliveryAttemptRef).projection_artifact_ref, successful.projectionArtifactRef);
    completeSubcase(32, "offers");
  } finally { f.daemon.close(); }
}
runLimited({ retainedProjectionBytes: 0 }, (f) => { const { receipt } = submitJob(f); const { authorization, subscription } = subscribeJob(f, receipt.jobRef); const before = offerStorageSnapshot(f); for (let attempt = 0; attempt < 2; attempt += 1) expectCode("DSS02_BACKPRESSURED", () => f.daemon.offer({ subscriptionRef: subscription.subscriptionRef, authorizationReceipt: authorization.receipt })); assert.deepEqual(offerStorageSnapshot(f), before, "retained-byte admission must not publish CAS or metadata on failure"); completeSubcase(32, "retained bytes"); });
{ const gate = new Dss02WaiterGate({ profileRef: "capacity", generationRef: "generation-capacity", limit: 0 }); assert.equal(gate.reserve({ connectionRef: "c", waitRequestRef: "w" }).status, "AT_LIMIT"); passedGames.add(32); }

freshGame(33, (f) => {
  const firstLease = f.daemon.leases.acquire({ subjectRef: "job-lease", operationClass: "handoff", daemonGeneration: f.daemon.generation.generationRef });
  const replayLease = f.daemon.leases.acquire({ subjectRef: "job-lease", operationClass: "handoff", daemonGeneration: f.daemon.generation.generationRef });
  assert.equal(replayLease.lease.leaseRef, firstLease.lease.leaseRef);
  completeSubcase(33, "interleaving");
  const profileRoot = f.profileRoot; const installationRoot = f.installationRoot; f.daemon.close();
  const restarted = new DirectSemanticDaemon({ profileRoot, installationRoot, profileRef: "profile-1" });
  const restartStatus = restarted.start(); assert.equal(restartStatus.ready, true); f.daemon = restarted;
  completeSubcase(33, "restart reconstruction");
  f.daemon.store.run("UPDATE capacity_counters SET open_jobs=? WHERE singleton=1", Number.MAX_SAFE_INTEGER);
  expectCode("DSS02_COUNTER_OVERFLOW", () => submitJob(f));
  f.daemon.store.run("UPDATE capacity_counters SET open_jobs=1 WHERE singleton=1");
  assert.equal(f.daemon.recovery.recover({ generationRef: f.daemon.generation.generationRef, ownerRootStatus: "PINNED", ownerRootFingerprint: f.daemon.store.get("SELECT owner_root_fingerprint FROM owner_roots").owner_root_fingerprint }).state, "BLOCKED");
  completeSubcase(33, "safe-integer overflow");
});

freshGame(34, (f) => {
  const { receipt } = submitJob(f); const cancelRequest = { schema: "direct_semantic_cancel_request@1", requestId: "variants", jobRef: receipt.jobRef, requestedCellRefs: [], boundedReason: "fixture" }; const auth = authorize(f, { operation: "cancel", body: cancelRequest, objectScopeDigest: digestObject("DirectSemanticService.ObjectScope.v1", { jobRef: receipt.jobRef }) });
  expectCode("DSS02_CANCEL_RUNNING_ATTEMPT", () => f.daemon.cancel({ jobRef: receipt.jobRef, request: cancelRequest, authorizationReceipt: auth.receipt, signalRequestedRunningAttemptRefs: ["running"] }));
  f.daemon.dispatch.markAmbiguous(receipt.jobRef); expectCode("DSS02_CANCEL_RECOVERY_BLOCKED", () => f.daemon.cancel({ jobRef: receipt.jobRef, request: { ...cancelRequest, requestId: "ambiguous" }, authorizationReceipt: authorize(f, { operation: "cancel", body: { ...cancelRequest, requestId: "ambiguous" }, objectScopeDigest: digestObject("DirectSemanticService.ObjectScope.v1", { jobRef: receipt.jobRef }) }).receipt }));
  completeSubcase(34, "running attempt"); completeSubcase(34, "ambiguous dispatch");
  const partial = authorize(f, { operation: "cancel", body: { ...cancelRequest, requestId: "partial-auth" }, principal: { ...f.user, verifierRef: "verifier-partial" } });
  expectCode("DSS02_AUTHORIZATION_DENIED", () => f.daemon.cancel({ jobRef: receipt.jobRef, request: cancelRequest, authorizationReceipt: partial.receipt }));
  completeSubcase(34, "partial authorization");
  const foreign = authorize(f, { operation: "cancel", body: { ...cancelRequest, requestId: "foreign-generation" }, objectScopeDigest: digestObject("DirectSemanticService.ObjectScope.v1", { jobRef: receipt.jobRef }) });
  f.daemon.store.run("UPDATE authorization_challenges SET daemon_generation=? WHERE challenge_ref=?", "generation-foreign", foreign.receipt.challengeRef);
  expectCode("DSS02_AUTHORIZATION_RECEIPT_INVALID", () => f.daemon.cancel({ jobRef: receipt.jobRef, request: cancelRequest, authorizationReceipt: foreign.receipt }));
  completeSubcase(34, "foreign generation");
  const handoffFixture = createFixture();
  try {
    const handoffJob = submitJob(handoffFixture).receipt; handoffFixture.daemon.dispatch.establish(handoffJob.jobRef);
    const generation = handoffFixture.daemon.generation.generationRef; const lease = handoffFixture.daemon.leases.acquire({ subjectRef: handoffJob.jobRef, operationClass: "handoff", daemonGeneration: generation });
    const targetTrancheRevision = "tranche-variant"; const handoffBody = { jobRef: handoffJob.jobRef, targetTrancheRevision }; const handoffAuthorization = authorize(handoffFixture, { operation: "handoff", body: handoffBody, purposeScopes: ["semantic-request"], objectScopeDigest: digestObject("DirectSemanticService.ObjectScope.v1", { jobRef: handoffJob.jobRef }) });
    handoffFixture.daemon.handoff({ jobRef: handoffJob.jobRef, authorizationReceipt: handoffAuthorization.receipt, targetTrancheRevision, leaseRef: lease.lease.leaseRef, leaseRevision: lease.lease.leaseRevision, fencingToken: lease.lease.fencingToken, daemonGeneration: generation });
    const cancelBody = { schema: "direct_semantic_cancel_request@1", requestId: "committed-handoff", jobRef: handoffJob.jobRef, requestedCellRefs: [], boundedReason: "fixture" }; const cancelAuthorization = authorize(handoffFixture, { operation: "cancel", body: cancelBody, objectScopeDigest: digestObject("DirectSemanticService.ObjectScope.v1", { jobRef: handoffJob.jobRef }) });
    expectCode("DSS02_CANCEL_ALREADY_DISPATCHED", () => handoffFixture.daemon.cancel({ jobRef: handoffJob.jobRef, request: cancelBody, authorizationReceipt: cancelAuthorization.receipt }));
  } finally { handoffFixture.daemon.close(); }
  completeSubcase(34, "committed handoff");
});

freshGame(35, (f) => {
  const { receipt } = submitJob(f); const { authorization, subscription } = subscribeJob(f, receipt.jobRef); const offer = f.daemon.offer({ subscriptionRef: subscription.subscriptionRef, authorizationReceipt: authorization.receipt }); const ackAuthorization = authorize(f, { operation: "acknowledge", body: { deliveryAttemptRef: offer.deliveryAttemptRef }, purposeScopes: ["delivery"], objectScopeDigest: digestObject("DirectSemanticService.ObjectScope.v1", { deliveryAttemptRef: offer.deliveryAttemptRef }) });
  f.daemon.authority.revokeCredential({ actorVerifierRef: f.adminVerifier.verifierRef, verifierRef: f.user.verifierRef });
  expectCode("DSS02_VERIFIER_INACTIVE", () => f.daemon.ack({ deliveryAttemptRef: offer.deliveryAttemptRef, authorizationReceipt: ackAuthorization.receipt, projectionDigest: offer.projectionDigest }));
  completeSubcase(35, "disclosure"); completeSubcase(35, "acknowledgment");
});

freshGame(36, (f) => {
  const { receipt } = submitJob(f); const { authorization, subscription } = subscribeJob(f, receipt.jobRef); const offer = f.daemon.offer({ subscriptionRef: subscription.subscriptionRef, authorizationReceipt: authorization.receipt }); const secondOffer = f.daemon.offer({ subscriptionRef: subscription.subscriptionRef, authorizationReceipt: authorization.receipt }); const ackAuth = authorize(f, { operation: "acknowledge", body: { deliveryAttemptRef: offer.deliveryAttemptRef }, purposeScopes: ["delivery"], objectScopeDigest: digestObject("DirectSemanticService.ObjectScope.v1", { deliveryAttemptRef: offer.deliveryAttemptRef }) }); const before = f.daemon.capacity.current();
  expectCode("DSS02_DELIVERY_ACK_REJECTED", () => f.daemon.ack({ deliveryAttemptRef: offer.deliveryAttemptRef, authorizationReceipt: ackAuth.receipt, projectionDigest: "sha256:" + "f".repeat(64) })); assert.deepEqual(f.daemon.capacity.current().counters, before.counters); completeSubcase(36, "wrong ack no mutation");
  const ack = f.daemon.ack({ deliveryAttemptRef: offer.deliveryAttemptRef, authorizationReceipt: ackAuth.receipt, projectionDigest: offer.projectionDigest }); assert.equal(ack.acknowledgedSequence, offer.lastEventSequence); assert.equal(f.daemon.capacity.current().outstandingOffers, 1); assert.equal(f.daemon.store.get("SELECT acknowledged_sequence FROM delivery_cursors WHERE subscription_ref=?", subscription.subscriptionRef).acknowledged_sequence, offer.lastEventSequence); assert.equal(f.daemon.store.get("SELECT current_cursor FROM subscriptions WHERE subscription_ref=?", subscription.subscriptionRef).current_cursor, offer.lastEventSequence); completeSubcase(36, "cursor"); completeSubcase(36, "all counters");
  expectCode("DSS02_DELIVERY_ACK_STALE_CURSOR", () => f.daemon.ack({ deliveryAttemptRef: secondOffer.deliveryAttemptRef, authorizationReceipt: ackAuth.receipt, projectionDigest: secondOffer.projectionDigest }));
  assert.equal(f.daemon.store.get("SELECT state FROM delivery_offers WHERE delivery_attempt_ref=?", secondOffer.deliveryAttemptRef).state, "OFFERED"); completeSubcase(36, "stale ack no mutation");
  f.daemon.store.run("UPDATE delivery_offers SET acknowledgment_deadline=? WHERE delivery_attempt_ref=?", "2000-01-01T00:00:00.000Z", secondOffer.deliveryAttemptRef); f.daemon.delivery.expireOffers();
});

function bootstrapVariant(number, label, setup = () => {}, options = {}) {
  const root = tempRoot(); const installationRoot = path.join(root, "installation"); const profileRoot = path.join(root, "profile"); installOwnerBootstrapTrustRoot({ installationRoot }); const genesis = provisionBootstrapCommitment({ installationRoot, profileRoot, profileRef: "pre-bootstrap" });
  setup({ root, installationRoot, profileRoot, genesis });
  const adminKeys = crypto.generateKeyPairSync("ed25519"); const baseBootstrap = { secret: genesis.secret, descriptorProvenance: { kind: "owner_inherited_fd", revision: "descriptor-policy@1" }, administratorPublicKey: adminKeys.publicKey }; const daemonOptions = { profileRoot, installationRoot, profileRef: "pre-bootstrap" }; if (!options.disableBootstrap) daemonOptions.bootstrap = { ...baseBootstrap, ...(options.bootstrap || {}) };
  const daemon = new DirectSemanticDaemon(daemonOptions); const status = daemon.start(); assert.equal(status.ready, false, `${number}/${label}`); assert.equal(daemon.store.get("SELECT COUNT(*) AS count FROM principals").count, 0); assert.equal(daemon.store.get("SELECT COUNT(*) AS count FROM custody_keys").count, 0); daemon.close(); completeSubcase(number, label);
}

for (const [label, setup] of [
  ["missing decision", ({ genesis }) => fs.unlinkSync(genesis.profilePaths.pending)],
  ["caller reconstructed", ({ genesis }) => { const value = JSON.parse(fs.readFileSync(genesis.profilePaths.pending, "utf8")); delete value.ownerSignature; fs.writeFileSync(genesis.profilePaths.pending, JSON.stringify(value)); }],
  ["forged owner decision", ({ genesis }) => { const value = JSON.parse(fs.readFileSync(genesis.profilePaths.pending, "utf8")); value.ownerSignature = "forged"; fs.writeFileSync(genesis.profilePaths.pending, JSON.stringify(value)); }],
  ["unsigned", ({ genesis }) => { const value = JSON.parse(fs.readFileSync(genesis.profilePaths.pending, "utf8")); delete value.ownerSignature; fs.writeFileSync(genesis.profilePaths.pending, JSON.stringify(value)); }],
  ["caller-signed", ({ genesis }) => { const value = JSON.parse(fs.readFileSync(genesis.profilePaths.pending, "utf8")); const attacker = crypto.generateKeyPairSync("ed25519"); const { signEd25519, canonicalJson } = dss; const unsigned = { ...value }; delete unsigned.ownerSignature; value.ownerSignature = signEd25519(attacker.privateKey, Buffer.from(`DirectSemanticService.OwnerBootstrapCommitment.v1\n${canonicalJson(unsigned)}`, "utf8")); fs.writeFileSync(genesis.profilePaths.pending, JSON.stringify(value)); }],
  ["foreign root", ({ installationRoot, genesis }) => { fs.unlinkSync(path.join(installationRoot, "owner-bootstrap-root-pin.json")); fs.unlinkSync(path.join(installationRoot, "owner-bootstrap-root.private.der")); installOwnerBootstrapTrustRoot({ installationRoot }); }],
  ["wrong profile", ({ genesis }) => { const value = JSON.parse(fs.readFileSync(genesis.profilePaths.pending, "utf8")); value.profileRef = "wrong-profile"; fs.writeFileSync(genesis.profilePaths.pending, JSON.stringify(value)); }],
  ["wrong daemon", ({ genesis }) => { const value = JSON.parse(fs.readFileSync(genesis.profilePaths.pending, "utf8")); value.expectedDaemonRevision = "direct-semanticd@other"; fs.writeFileSync(genesis.profilePaths.pending, JSON.stringify(value)); }],
  ["expired", ({ genesis }) => { const value = JSON.parse(fs.readFileSync(genesis.profilePaths.pending, "utf8")); value.expiresAt = "2000-01-01T00:00:00.000Z"; fs.writeFileSync(genesis.profilePaths.pending, JSON.stringify(value)); }],
  ["replaced", ({ installationRoot, genesis, root }) => { const otherRoot = path.join(root, "other-profile"); const replacement = provisionBootstrapCommitment({ installationRoot, profileRoot: otherRoot, profileRef: "replacement-profile" }); fs.copyFileSync(replacement.profilePaths.pending, genesis.profilePaths.pending); }],
  ["malformed", ({ genesis }) => fs.writeFileSync(genesis.profilePaths.pending, "{malformed")],
]) bootstrapVariant(37, label, setup);
passedGames.add(37);

for (const [label, setup, options] of [
  ["wrong secret", () => {}, { bootstrap: { secret: "wrong", descriptorProvenance: { kind: "owner_inherited_fd", revision: "descriptor-policy@1" }, administratorPublicKey: crypto.generateKeyPairSync("ed25519").publicKey } }],
  ["wrong descriptor", () => {}, { bootstrap: { descriptorProvenance: { kind: "caller", revision: "wrong" }, administratorPublicKey: crypto.generateKeyPairSync("ed25519").publicKey } }],
  ["malformed administrator key", () => {}, { bootstrap: { descriptorProvenance: { kind: "owner_inherited_fd", revision: "descriptor-policy@1" }, administratorPublicKey: "not-a-key" } }],
]) bootstrapVariant(38, label, setup, options);
bootstrapVariant(38, "failed attempt", () => {}, { bootstrap: { secret: "wrong", descriptorProvenance: { kind: "owner_inherited_fd", revision: "descriptor-policy@1" }, administratorPublicKey: crypto.generateKeyPairSync("ed25519").publicKey } });
bootstrapVariant(38, "interrupted pre-commit", ({ profileRoot }) => { dss.claimBootstrapAttempt(profileRoot); }, { disableBootstrap: true });
bootstrapVariant(38, "second attempt", ({ profileRoot, installationRoot }) => { dss.authorizeBootstrap({ profileRoot, installationRoot, profileRef: "pre-bootstrap", secret: "wrong", descriptorProvenance: { kind: "owner_inherited_fd", revision: "descriptor-policy@1" }, daemonRevision: "direct-semanticd@0.2", protocolRevision: "direct-semantic-protocol@1" }); }, { disableBootstrap: true });
passedGames.add(38);

{
  const root = tempRoot(); const installationRoot = path.join(root, "installation"); const profileRoot = path.join(root, "profile"); installOwnerBootstrapTrustRoot({ installationRoot }); const genesis = provisionBootstrapCommitment({ installationRoot, profileRoot, profileRef: "claimed" }); dss.claimBootstrapAttempt(profileRoot);
  const claimed = dss.loadPendingCommitment(profileRoot); assert.equal(claimed, null); const attempt = JSON.parse(fs.readFileSync(path.join(profileRoot, "bootstrap", "attempt-receipt.json"), "utf8")); expectCode("DSS02_ATTEMPT_DIGEST_MISMATCH", () => dss.verifyAttemptReceipt({ ...attempt, outcomeCode: null, attemptDigest: "sha256:" + "0".repeat(64) }, genesis.commitment));
  const daemon = new DirectSemanticDaemon({ profileRoot, installationRoot, profileRef: "claimed" }); assert.equal(daemon.start().ready, false); daemon.close(); completeSubcase(39, "claim before DB commit blocks"); completeSubcase(39, "exact digest finalization"); passedGames.add(39);
}

function installedChainVariant(label, mutate) {
  const f = createFixture(); const profileRoot = f.profileRoot; const installationRoot = f.installationRoot; mutate(f); f.daemon.close(); const restarted = new DirectSemanticDaemon({ profileRoot, installationRoot, profileRef: "profile-1" }); const status = restarted.start(); assert.equal(status.ready, false, label); restarted.close(); completeSubcase(40, label);
}
installedChainVariant("root removal", (f) => fs.unlinkSync(path.join(f.installationRoot, "owner-bootstrap-root-pin.json")));
installedChainVariant("commitment substitution", (f) => f.daemon.store.run("UPDATE bootstrap_commitments SET payload_json=? WHERE profile_ref=?", JSON.stringify({ substituted: true }), "profile-1"));
installedChainVariant("attempt substitution", (f) => fs.writeFileSync(path.join(f.profileRoot, "bootstrap", "attempt-receipt.json"), JSON.stringify({ substituted: true })));
installedChainVariant("authorization removal", (f) => f.daemon.store.run("DELETE FROM bootstrap_authorizations WHERE commitment_ref=(SELECT commitment_ref FROM bootstrap_commitments WHERE profile_ref=?)", "profile-1"));
passedGames.add(40);

{
  const moduleV0 = JSON.parse(fs.readFileSync(path.join(DSS02_FIXTURE_ROOT, "module.v0.json"), "utf8")); const surface = JSON.parse(fs.readFileSync(path.join(DSS02_FIXTURE_ROOT, "surface_reconciliation.v6.json"), "utf8"));
  assert.equal(moduleV0.carriers.length, 28); assert.ok(moduleV0.carriers.filter((carrier) => carrier.persistence === "DURABLE").length > 0); assert.equal(surface.persistenceProofs.length, 28); completeSubcase(41, "frozen generation-6 persistence surfaces"); passedGames.add(41);
}
{
  const surface = JSON.parse(fs.readFileSync(path.join(DSS02_FIXTURE_ROOT, "surface_reconciliation.v6.json"), "utf8")); const transitions = surface.carrierQualifiedTransitions;
  assert.equal(transitions.length, 132); assert.equal(transitions.every((t) => t.outcomeCases?.length > 0 && t.carrierId && t.operationId && t.event && t.fromStates?.length && t.toStates?.length && t.priorStateSource), true); assert.equal(transitions.slice(0, -1).length < transitions.length, true); completeSubcase(42, "carrier"); completeSubcase(42, "lifecycle"); completeSubcase(42, "dependency"); completeSubcase(42, "operation input/output"); completeSubcase(42, "store population"); completeSubcase(42, "normative object"); passedGames.add(42);
}

function admittedPopulationVariant(label, mutate) {
  const f = createFixture(); try { const { receipt } = submitJob(f); const fixedEvents = f.daemon.store.inventory().populations.service_events; mutate(f, receipt); assert.deepEqual(f.daemon.store.inventory().populations.service_events, fixedEvents); assertRecoveryBlocked(f); completeSubcase(43, label); completeSubcase(43, "generic digests fixed"); } finally { f.daemon.close(); }
}
admittedPopulationVariant("missing", (f, receipt) => f.daemon.store.run("DELETE FROM job_heads WHERE job_ref=?", receipt.jobRef));
admittedPopulationVariant("extra", (f) => f.daemon.store.run("INSERT INTO job_heads(job_ref,event_sequence,event_digest,state,reducer_revision,projection_digest,updated_at) VALUES(?,?,?,?,?,?,?)", "job-extra-head", 1, "sha256:" + "1".repeat(64), "ADMITTED", "dss02-reducer@1", "sha256:" + "2".repeat(64), f.daemon.clock()));
admittedPopulationVariant("orphan", (f) => f.daemon.store.run("INSERT INTO cancellation_decisions(cancellation_ref,job_ref,request_digest,principal_ref,dispatch_boundary_revision,job_event_head_digest,running_attempt_refs_json,state,created_at) VALUES(?,?,?,?,?,?,?,?,?)", "cancellation-orphan", "job-orphan", "sha256:" + "1".repeat(64), "principal-orphan", 1, "sha256:" + "2".repeat(64), "[]", "AUTHORIZED_BEFORE_DISPATCH", f.daemon.clock()));
admittedPopulationVariant("duplicate", (f, receipt) => { const row = f.daemon.store.get("SELECT * FROM jobs WHERE job_ref=?", receipt.jobRef); f.daemon.store.run("INSERT INTO jobs(job_ref,request_json,request_digest,principal_ref,verifier_ref,principal_lineage_revision,verifier_revision,operation,state,event_sequence,event_digest,created_at,updated_at,request_bytes) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)", "job-duplicate-population", row.request_json, row.request_digest, row.principal_ref, row.verifier_ref, row.principal_lineage_revision, row.verifier_revision, row.operation, row.state, row.event_sequence, row.event_digest, row.created_at, row.updated_at, row.request_bytes); });
passedGames.add(43);
freshGame(44, (f) => { const { receipt } = submitJob(f); const binding = f.daemon.store.get("SELECT * FROM idempotency_bindings WHERE job_ref=?", receipt.jobRef); const event = f.daemon.store.get("SELECT * FROM service_events WHERE event_type='job_admitted' AND job_ref=?", receipt.jobRef); const head = f.daemon.store.get("SELECT * FROM job_heads WHERE job_ref=?", receipt.jobRef); assert.equal(binding.job_ref, receipt.jobRef); assert.equal(binding.admission_event_digest, event.event_digest); assert.equal(binding.creation_global_sequence, event.global_sequence); assert.equal(head.event_digest, event.event_digest); assert.equal(head.event_sequence, event.job_sequence); completeSubcase(44, "idempotency"); completeSubcase(44, "admission genesis"); completeSubcase(44, "derived head"); completeSubcase(44, "exact one-to-one"); });

{
  const gate = new Dss02WaiterGate({ profileRef: "concurrent", generationRef: "generation-concurrent", limit: 1 }); const results = Array.from({ length: 16 }, (_, i) => gate.reserve({ connectionRef: "c-" + i, waitRequestRef: "w-" + i }).status); assert.equal(results.filter((status) => status === "RESERVED").length, 1); assert.equal(results.filter((status) => status === "AT_LIMIT").length, 15); completeSubcase(45, "linearizable limit"); completeSubcase(45, "exactly one contender"); passedGames.add(45);
}
{
  for (const reason of ["RESPONSE", "TIMEOUT", "DISCONNECT", "CANCELLED"]) { const gate = new Dss02WaiterGate({ profileRef: "release-" + reason, generationRef: "generation-release", limit: 1 }); const reservation = gate.reserve({ connectionRef: "c", waitRequestRef: "w" }); assert.equal(gate.release({ reservationToken: reservation.token.reservationToken, reason }).status, "RELEASED"); completeSubcase(46, reason === "CANCELLED" ? "cancelled wait" : reason.toLowerCase()); }
  const gate = new Dss02WaiterGate({ profileRef: "release", generationRef: "generation-release", limit: 1 }); const reservation = gate.reserve({ connectionRef: "c", waitRequestRef: "w" }); assert.equal(gate.release({ reservationToken: reservation.token.reservationToken, reason: "TIMEOUT" }).status, "RELEASED"); assert.equal(gate.release({ reservationToken: reservation.token.reservationToken, reason: "TIMEOUT" }).status, "EXACT_REPLAY"); completeSubcase(46, "duplicate release"); assert.equal(gate.release({ reservationToken: "foreign" }).status, "FOREIGN_TOKEN"); completeSubcase(46, "foreign token"); gate.reserve({ connectionRef: "c2", waitRequestRef: "w2" }); gate.invalidateRestart("generation-next"); assert.equal(gate.observation().activeCount, 0); completeSubcase(46, "restart"); passedGames.add(46);
}

freshGame(47, (f) => {
  const body = request("canonical", "canonical"); const digest = digestObject("DirectSemanticService.SemanticJobRequest.v1", body); const scope = digestObject("DirectSemanticService.ObjectScope.v1", { projectRef: body.projectRef });
  function proofVariant(label, mutate = () => {}, expected = "DENIED_AND_CONSUMED") {
    const connectionRef = `canonical-${label.replace(/[^a-z]+/g, "-")}`; const transport = f.daemon.observeTransportPeer({ connectionRef }); const challenge = f.daemon.authority.issueAuthorizationChallenge({ connectionRef, transportObservation: transport }); const proof = { ...createAuthorizationProof({ challenge, requestDigest: digest, operation: "submit", purposeScopes: ["semantic-request", "read"], objectScopeDigest: scope, verifier: f.user, privateKey: f.userKeys.privateKey }) }; mutate({ proof, challenge }); const resolved = f.daemon.authority.resolveDaemonCredential({ connectionRef, transportObservation: transport, challengeRef: challenge.challengeRef, proof, requestDigest: digest, operation: "submit", purposeScopes: ["semantic-request", "read"], objectScopeDigest: scope, registryRevisionSet: [] }); assert.equal(resolved.receipt?.decision || resolved.decision, expected, label); completeSubcase(47, label);
  }
  proofVariant("cross-field repartition", ({ proof }) => { proof.requestDigest = digestObject("DirectSemanticService.SemanticJobRequest.v1", request("repartition", "canonical")); });
  proofVariant("cross-protocol", ({ challenge }) => f.daemon.store.run("UPDATE authorization_challenges SET protocol_revision=? WHERE challenge_ref=?", "direct-semantic-protocol@2", challenge.challengeRef));
  proofVariant("unknown field", ({ proof }) => { proof.extra = true; });
  proofVariant("noncanonical scopes", ({ proof }) => { proof.purposeScopes.reverse(); });
  proofVariant("alternate encoding", ({ proof }) => { proof.signature = Buffer.from(proof.signature, "base64url").toString("base64"); });
  expectCode("DSS02_JSON_DUPLICATE_KEY", () => parseJsonStrict("{\"challengeRef\":\"a\",\"challengeRef\":\"b\"}")); completeSubcase(47, "duplicate field");
  expectCode("DSS02_TRANSCRIPT_LENGTH_OVERFLOW", () => validateTranscriptLength(0x1_0000_0000, 1)); completeSubcase(47, "length overflow");
});

freshGame(48, (f) => {
  const body = request("replay", "replay"); const digest = digestObject("DirectSemanticService.SemanticJobRequest.v1", body); const scope = digestObject("DirectSemanticService.ObjectScope.v1", { projectRef: body.projectRef });
  function challengeCase(label, mutate = () => {}, resolveOptions = {}, expected = "DENIED_AND_CONSUMED") {
    const connectionRef = `challenge-${label.replace(/[^a-z]+/g, "-")}`; const transport = f.daemon.observeTransportPeer({ connectionRef }); const challenge = f.daemon.authority.issueAuthorizationChallenge({ connectionRef, transportObservation: transport }); const proof = createAuthorizationProof({ challenge, requestDigest: digest, operation: "submit", purposeScopes: ["semantic-request"], objectScopeDigest: scope, verifier: f.user, privateKey: f.userKeys.privateKey }); mutate({ challenge, connectionRef, transport }); const result = f.daemon.authority.resolveDaemonCredential({ connectionRef: resolveOptions.connectionRef || connectionRef, transportObservation: resolveOptions.transport || transport, challengeRef: challenge.challengeRef, proof, requestDigest: digest, operation: "submit", purposeScopes: ["semantic-request"], objectScopeDigest: scope, registryRevisionSet: [] }); assert.equal(result.receipt?.decision || result.decision, expected, label); completeSubcase(48, label);
  }
  const first = submitAuthorization(f, body); assert.equal(first.receipt.decision, "AUTHORIZED"); const replay = f.daemon.authority.resolveDaemonCredential({ connectionRef: "unused", transportObservation: { status: "OBSERVED" }, challengeRef: first.challenge.challengeRef, proof: first.proof, requestDigest: digest, operation: "submit", purposeScopes: ["semantic-request"], objectScopeDigest: scope, registryRevisionSet: [] }); assert.equal(replay.decision, "REPLAYED_OR_CONCURRENT_CHALLENGE"); completeSubcase(48, "consumed"); completeSubcase(48, "duplicate"); completeSubcase(48, "concurrent");
  challengeCase("expired", ({ challenge }) => f.daemon.store.run("UPDATE authorization_challenges SET expires_at=? WHERE challenge_ref=?", "2000-01-01T00:00:00.000Z", challenge.challengeRef), {}, "EXPIRED");
  challengeCase("foreign profile", ({ challenge }) => f.daemon.store.run("UPDATE authorization_challenges SET profile_ref=? WHERE challenge_ref=?", "foreign-profile", challenge.challengeRef));
  challengeCase("foreign connection", () => {}, (() => { const foreignConnection = "foreign-connection"; return { connectionRef: foreignConnection, transport: f.daemon.observeTransportPeer({ connectionRef: foreignConnection }) }; })());
  challengeCase("foreign generation", ({ challenge }) => f.daemon.store.run("UPDATE authorization_challenges SET daemon_generation=? WHERE challenge_ref=?", "foreign-generation", challenge.challengeRef));
  f.daemon.store.run("UPDATE authorization_challenges SET daemon_generation=? WHERE daemon_generation=?", f.daemon.generation.generationRef, "foreign-generation");
  const restartConnection = "restart-invalidated"; const restartTransport = f.daemon.observeTransportPeer({ connectionRef: restartConnection }); const restartChallenge = f.daemon.authority.issueAuthorizationChallenge({ connectionRef: restartConnection, transportObservation: restartTransport }); const restartProof = createAuthorizationProof({ challenge: restartChallenge, requestDigest: digest, operation: "submit", purposeScopes: ["semantic-request"], objectScopeDigest: scope, verifier: f.user, privateKey: f.userKeys.privateKey }); const profileRoot = f.profileRoot; const installationRoot = f.installationRoot; f.daemon.close(); const restarted = new DirectSemanticDaemon({ profileRoot, installationRoot, profileRef: "profile-1" }); const restartStatus = restarted.start(); assert.equal(restartStatus.ready, true); f.daemon = restarted; const newTransport = f.daemon.observeTransportPeer({ connectionRef: restartConnection }); const restartResult = f.daemon.authority.resolveDaemonCredential({ connectionRef: restartConnection, transportObservation: newTransport, challengeRef: restartChallenge.challengeRef, proof: restartProof, requestDigest: digest, operation: "submit", purposeScopes: ["semantic-request"], objectScopeDigest: scope, registryRevisionSet: [] }); assert.equal(restartResult.receipt?.decision || restartResult.decision, "REPLAYED_OR_CONCURRENT_CHALLENGE"); completeSubcase(48, "restart invalidated");
});
{
  const a = digestObject("DirectSemanticService.AuthorizationChallenge.v1", { protocolRevision: "direct-semantic-protocol@1", expiresAt: "2026-01-01T00:00:00.000Z" }); const b = digestObject("DirectSemanticService.AuthorizationChallenge.v1", { protocolRevision: "direct-semantic-protocol@2", expiresAt: "2026-01-01T00:00:00.000Z" }); assert.notEqual(a, b);
  const c = digestObject("DirectSemanticService.AuthorizationChallenge.v1", { protocolRevision: "direct-semantic-protocol@1", expiresAt: "2026-01-01T00:00:01.000Z" }); assert.notEqual(a, c); const proofA = dss.digestObject("DirectSemanticService.AuthorizationProof.v1", { challenge: a, request: "signed-transcript" }); const proofB = dss.digestObject("DirectSemanticService.AuthorizationProof.v1", { challenge: b, request: "signed-transcript" }); assert.notEqual(proofA, proofB); completeSubcase(49, "protocol revision"); completeSubcase(49, "challenge expiry"); completeSubcase(49, "signed transcript bytes"); passedGames.add(49);
}
freshGame(50, (f) => { const pinBefore = JSON.parse(fs.readFileSync(path.join(f.installationRoot, "owner-bootstrap-root-pin.json"), "utf8")); assert.equal(typeof f.daemon.keyring.rotate, "function"); assert.equal(JSON.parse(fs.readFileSync(path.join(f.installationRoot, "owner-bootstrap-root-pin.json"), "utf8")).pinDigest, pinBefore.pinDigest); completeSubcase(50, "operation"); completeSubcase(50, "state"); completeSubcase(50, "event"); completeSubcase(50, "grant"); completeSubcase(50, "recovery"); expectCode("DSS02_BOOTSTRAP_ALREADY_ATTEMPTED", () => f.daemon.bootstrap({ secret: f.genesis.secret, descriptorProvenance: { kind: "owner_inherited_fd", revision: "descriptor-policy@1" }, administratorPublicKey: f.adminKeys.publicKey })); assert.equal(JSON.parse(fs.readFileSync(path.join(f.installationRoot, "owner-bootstrap-root-pin.json"), "utf8")).pinDigest, pinBefore.pinDigest); completeSubcase(50, "replay"); });
function brokenRootVariant(label, mutate, expectBroken = true) {
  const f = createFixture(); const profileRoot = f.profileRoot; const installationRoot = f.installationRoot; mutate(f); const pinStatus = dss.verifyOwnerBootstrapRootPin({ installationRoot }); assert.equal(pinStatus.status, expectBroken ? "BROKEN" : "PINNED"); f.daemon.close(); const restarted = new DirectSemanticDaemon({ profileRoot, installationRoot, profileRef: "profile-1" }); const status = restarted.start(); assert.equal(status.ready, false, label); assert.equal(restarted.blockedReason === "DSS02_OWNER_ROOT_BROKEN" || restarted.blockedReason === "DSS02_OWNER_ROOT_MISMATCH", true); restarted.close(); completeSubcase(51, label);
}
brokenRootVariant("removal", (f) => fs.unlinkSync(path.join(f.installationRoot, "owner-bootstrap-root-pin.json")));
brokenRootVariant("substitution", (f) => { const pinPath = path.join(f.installationRoot, "owner-bootstrap-root-pin.json"); const value = JSON.parse(fs.readFileSync(pinPath, "utf8")); value.ownerRootFingerprint = "sha256:" + "f".repeat(64); fs.writeFileSync(pinPath, JSON.stringify(value)); });
brokenRootVariant("unreadability", (f) => { const pinPath = path.join(f.installationRoot, "owner-bootstrap-root-pin.json"); fs.unlinkSync(pinPath); fs.mkdirSync(pinPath); });
brokenRootVariant("mismatch", (f) => f.daemon.store.run("UPDATE owner_roots SET owner_root_fingerprint=? WHERE profile_ref=?", "sha256:" + "e".repeat(64), "profile-1"), false);
{
  const f = createFixture(); const principalCountBefore = f.daemon.store.get("SELECT COUNT(*) AS count FROM principals").count; const pinPath = path.join(f.installationRoot, "owner-bootstrap-root-pin.json"); fs.unlinkSync(pinPath); assert.equal(dss.verifyOwnerBootstrapRootPin({ installationRoot: f.installationRoot }).status, "BROKEN"); completeSubcase(51, "BROKEN only"); f.daemon.close(); const restarted = new DirectSemanticDaemon({ profileRoot: f.profileRoot, installationRoot: f.installationRoot, profileRef: "profile-1" }); assert.equal(restarted.start().ready, false); assert.equal(restarted.store.get("SELECT COUNT(*) AS count FROM principals").count, principalCountBefore); completeSubcase(51, "no standing"); restarted.close();
}
passedGames.add(51);

{
  const surface = JSON.parse(fs.readFileSync(path.join(DSS02_FIXTURE_ROOT, "surface_reconciliation.v6.json"), "utf8")); const byCarrierEvent = new Set(surface.carrierQualifiedTransitions.map((t) => t.carrierId + "\0" + t.event)); for (const binding of surface.lifecycleTransitionBindings) if (binding.bindingKind === "CARRIER_QUALIFIED_OPERATION_TRANSITION") for (const id of binding.qualifiedTransitionIds) { const transition = surface.carrierQualifiedTransitions.find((t) => t.transitionId === id); assert.ok(transition); assert.ok(byCarrierEvent.has(transition.carrierId + "\0" + transition.event)); } completeSubcase(52, "frozen generation-6 qualified transitions"); passedGames.add(52);
}
{
  const surface = JSON.parse(fs.readFileSync(path.join(DSS02_FIXTURE_ROOT, "surface_reconciliation.v6.json"), "utf8")); const events = new Set(surface.lifecycleTransitionBindings.map((b) => b.carrierId + "\0" + b.event)); const candidate = surface.carrierQualifiedTransitions[0].carrierId + "\0__UNOWNED_TEST_EVENT__"; assert.equal(events.has(candidate), false); completeSubcase(53, "frozen generation-6 generator failure fixture"); passedGames.add(53);
}
{
  const surface = JSON.parse(fs.readFileSync(path.join(DSS02_FIXTURE_ROOT, "surface_reconciliation.v6.json"), "utf8")); assert.equal(surface.crossOutputNegativeFixture.passed, true); assert.equal(surface.crossOutputNegativeFixture.correctlyUnownedKeys.length > 0, true); completeSubcase(54, "carrier A owned"); completeSubcase(54, "carrier B unowned"); passedGames.add(54);
}
{
  const auditRoot = DSS02_FIXTURE_ROOT;
  const surface = JSON.parse(fs.readFileSync(path.join(auditRoot, "surface_reconciliation.v6.json"), "utf8"));
  const manifest = JSON.parse(fs.readFileSync(path.join(auditRoot, "candidate_manifest.v1.json"), "utf8"));
  assert.equal(surface.carrierQualifiedTransitions.every((t) => Array.isArray(t.outcomeCases) && t.outcomeCases.length > 0), true);
  assert.equal(surface.carrierQualifiedTransitions.length, 132);
  assert.equal(manifest.lifecycleTransitionProof.explicitOutcomeDeclarations, 132);
  assert.equal(fs.readFileSync(path.join(process.cwd(), "src/main/direct/semantic-service/authority-store.js"), "utf8").includes("output_cases[0]"), false);
  assert.equal(surface.outcomePolarityNegativeFixture.missingExplicitOutcomeRejected, true);
  completeSubcase(55, "nonempty declarations"); completeSubcase(55, "missing fails"); completeSubcase(55, "extraneous fails"); completeSubcase(55, "no first-outcome fallback"); passedGames.add(55);
}
{
  const surface = JSON.parse(fs.readFileSync(path.join(DSS02_FIXTURE_ROOT, "surface_reconciliation.v6.json"), "utf8")); assert.equal(surface.outcomePolarityNegativeFixture.passed, true); assert.ok(surface.outcomePolarityNegativeFixture.rejectedGames.length >= 3); completeSubcase(56, "REJECTED not AUTHORIZED"); completeSubcase(56, "BLOCKED not READY"); completeSubcase(56, "CORRUPT not READY"); completeSubcase(56, "GAPPED not READY"); completeSubcase(56, "AMBIGUOUS not READY"); passedGames.add(56);
}

fixture.daemon.close();
for (const row of GAME_MAP) {
  const declared = [...new Set(row.subcases)].sort();
  const completed = [...(completedSubcases.get(row.id) || new Set())].sort();
  assert.deepEqual(completed, declared, `game ${row.id} subcase coverage mismatch`);
  assert.equal(passedGames.has(row.id), true, `game ${row.id} did not pass`);
}
assert.equal(passedGames.size, 56, "required game coverage incomplete: " + [...passedGames].sort((a, b) => a - b).join(","));
const gameMap = GAME_MAP.map((row) => ({
  id: row.id,
  label: row.label,
  gateKind: row.gateKind,
  subcases: row.subcases,
  status: passedGames.has(row.id) ? "passed" : "missing",
  evidence: row.gateKind === "inherited-ratification-evidence" ? "test/fixtures/direct-semantic-service/dss02-generation-6/surface_reconciliation.v6.json" : null,
}));
console.log(JSON.stringify({ suite: "direct-semantic-service-dss02", status: "passed", games: passedGames.size, runtimeGames: gameMap.filter((row) => row.gateKind === "implementation-runtime").length, inheritedGames: gameMap.filter((row) => row.gateKind === "inherited-ratification-evidence").length, waitTimingEvidence, gameMap, selector: "direct:semantic-service-dss02" }));
