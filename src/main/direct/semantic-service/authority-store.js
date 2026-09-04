"use strict";

/* Durable DSS-0.2 authority: public verifier records and challenge proofs. */

const crypto = require("node:crypto");
const {
  DSS02_PROTOCOL,
  Dss02Error,
  dss02Fail,
  ensureObject,
  exactObject,
  immutableId,
  immutableDigest,
  isoNow,
  isExpired,
  randomNonce,
  randomRef,
  canonicalJson,
  digestObject,
  transcriptBytes,
  createKeyPair,
  exportPublicKey,
  importPublicKey,
  publicKeyFingerprint,
  signEd25519,
  verifyEd25519,
  cloneJson,
  parseStoredJson,
  checkedInteger,
} = require("./dss02-common");

const CHALLENGE_SCHEMA = "direct_semantic_authorization_challenge@1";
const PROOF_SCHEMA = "direct_semantic_authorization_proof@1";
const RECEIPT_SCHEMA = "direct_semantic_request_authorization_receipt@1";
const PRINCIPAL_SCHEMA = "direct_semantic_principal_lineage@1";
const VERIFIER_SCHEMA = "direct_semantic_capability_verifier_record@1";
const SERVICE_ADMIN_OPERATION = "service-administration";
const ALL_OPERATIONS = Object.freeze([
  "submit", "inspect", "results", "subscribe", "acknowledge", "cancel",
  "service-administration", "publish-cas", "quarantine", "dispose-quarantine",
  "rotate-custody-key", "acquire-lease", "release-lease", "handoff",
]);

function sorted(values, label, { allowWildcard = false } = {}) {
  if (!Array.isArray(values)) dss02Fail("DSS02_SCOPE_INVALID", label);
  const output = [...new Set(values.map((value) => (allowWildcard && value === "*" ? value : immutableId(value, label))))].sort();
  if (output.length !== values.length) dss02Fail("DSS02_SCOPE_DUPLICATE", label);
  return output;
}

function publicKeyFromValue(value) {
  try { return typeof value === "string" ? importPublicKey(value) : (value && value.type === "public" ? value : crypto.createPublicKey(value)); }
  catch (error) { dss02Fail("DSS02_PUBLIC_KEY_INVALID"); }
}

function challengeCanonical(challenge) {
  return canonicalJson({
    schema: CHALLENGE_SCHEMA,
    profileRef: challenge.profileRef,
    protocolRevision: challenge.protocolRevision,
    connectionRef: challenge.connectionRef,
    daemonGeneration: challenge.daemonGeneration,
    challengeRef: challenge.challengeRef,
    nonce: challenge.nonce,
    issuedAt: challenge.issuedAt,
    expiresAt: challenge.expiresAt,
    stateRevision: challenge.stateRevision,
  });
}

function authorityCanonical(authority) {
  return canonicalJson({
    schema: "direct_semantic_request_authority@1",
    requestDigest: authority.requestDigest,
    operation: authority.operation,
    purposeScopes: sorted(authority.purposeScopes || [], "purposeScopes"),
    objectScopeDigest: authority.objectScopeDigest,
    verifierRevision: authority.verifierRevision,
    principalLineageRevision: authority.principalLineageRevision,
    issuerRevision: authority.issuerRevision,
    registryRevisionSet: sorted(authority.registryRevisionSet || [], "registryRevisionSet"),
    revocationEpoch: authority.revocationEpoch,
  });
}

function proofUnsigned(proof) {
  return {
    schema: PROOF_SCHEMA,
    challengeRef: proof.challengeRef,
    verifierRef: proof.verifierRef,
    requestDigest: proof.requestDigest,
    operation: proof.operation,
    purposeScopes: sorted(proof.purposeScopes || [], "purposeScopes"),
    objectScopeDigest: proof.objectScopeDigest,
    verifierRevision: proof.verifierRevision,
    principalLineageRevision: proof.principalLineageRevision,
    issuerRevision: proof.issuerRevision,
    registryRevisionSet: sorted(proof.registryRevisionSet || [], "registryRevisionSet"),
    revocationEpoch: proof.revocationEpoch,
    signatureAlgorithm: proof.signatureAlgorithm,
    signature: proof.signature,
  };
}

function createAuthorizationProof({ challenge, requestDigest, operation, purposeScopes = [], objectScopeDigest, verifier, privateKey, registryRevisionSet = [], now = undefined } = {}) {
  ensureObject(challenge, "DSS02_CHALLENGE_INVALID");
  ensureObject(verifier, "DSS02_VERIFIER_INVALID");
  immutableDigest(requestDigest, "requestDigest");
  immutableId(operation, "operation");
  immutableDigest(objectScopeDigest, "objectScopeDigest");
  if (!privateKey) dss02Fail("DSS02_PRIVATE_KEY_REQUIRED");
  const authority = {
    schema: "direct_semantic_request_authority@1",
    requestDigest,
    operation,
    purposeScopes: sorted(purposeScopes, "purposeScopes"),
    objectScopeDigest,
    verifierRevision: verifier.verifierRevision,
    principalLineageRevision: verifier.principalLineageRevision,
    issuerRevision: verifier.issuerRevision,
    registryRevisionSet: sorted(registryRevisionSet, "registryRevisionSet"),
    revocationEpoch: verifier.revocationEpoch,
  };
  const transcript = transcriptBytes(challengeCanonical(challenge), authorityCanonical(authority));
  const signature = signEd25519(privateKey, transcript);
  const proof = {
    schema: PROOF_SCHEMA,
    challengeRef: challenge.challengeRef,
    verifierRef: verifier.verifierRef,
    requestDigest,
    operation,
    purposeScopes: authority.purposeScopes,
    objectScopeDigest,
    verifierRevision: verifier.verifierRevision,
    principalLineageRevision: verifier.principalLineageRevision,
    issuerRevision: verifier.issuerRevision,
    registryRevisionSet: authority.registryRevisionSet,
    revocationEpoch: verifier.revocationEpoch,
    signatureAlgorithm: "ed25519",
    signature,
  };
  return Object.freeze(proof);
}

class Dss02Authority {
  constructor({ store, profileRef = store?.profileRef, protocolRevision = DSS02_PROTOCOL, now = undefined } = {}) {
    if (!store) dss02Fail("DSS02_AUTHORITY_STORE_REQUIRED");
    this.store = store;
    this.profileRef = profileRef;
    this.protocolRevision = protocolRevision;
    this.ledger = undefined;
    this.now = now;
  }

  clock() { return isoNow(typeof this.now === "function" ? this.now() : this.now); }

  currentGeneration() {
    const generation = this.store.currentGeneration();
    if (!generation) dss02Fail("DSS02_GENERATION_UNOPENED");
    return generation;
  }

  bootstrapDaemonAuthority({ bootstrapAuthorization, bootstrapCommitment, bootstrapAttempt, administratorPublicKey, attemptReceiptDigest = null, keyring = undefined } = {}) {
    ensureObject(bootstrapAuthorization, "DSS02_BOOTSTRAP_AUTHORIZATION_INVALID");
    if (bootstrapAuthorization.decision !== "AUTHORIZED_ONCE") dss02Fail("DSS02_BOOTSTRAP_NOT_AUTHORIZED");
    const generation = this.currentGeneration();
    const publicKey = publicKeyFromValue(administratorPublicKey);
    const encoded = exportPublicKey(publicKey);
    const fingerprint = publicKeyFingerprint(encoded);
    const now = this.clock();
    const principalRef = randomRef("principal");
    const verifierRef = randomRef("verifier");
    const principalRevision = randomRef("principal-lineage");
    const verifierRevision = randomRef("verifier-revision");
    const principal = {
      schema: PRINCIPAL_SCHEMA,
      principalRef,
      principalId: `service-admin-${crypto.randomBytes(8).toString("hex")}`,
      lineageRevision: principalRevision,
      issuerRevision: "owner-bootstrap-issuer@1",
      principalClass: "direct_service",
      subjectRef: this.profileRef,
      projectScopes: ["*"],
      purposeScopes: ["service-administration", "semantic-request", "read", "delivery"],
      state: "CURRENT",
      createdAt: now,
    };
    const verifier = {
      schema: VERIFIER_SCHEMA,
      verifierRef,
      verifierRevision,
      principalRef,
      principalLineageRevision: principalRevision,
      issuerRevision: principal.issuerRevision,
      publicKey: encoded,
      publicKeyFingerprint: fingerprint,
      operations: [...ALL_OPERATIONS],
      purposeScopes: [...principal.purposeScopes],
      objectScopes: ["*"],
      registryRevisions: [],
      issuedAt: now,
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      revocationEpoch: 0,
      state: "CURRENT",
      supersededBy: null,
    };
    const eventPayload = {
      event: "bootstrap_daemon_authority",
      authorizationDigest: bootstrapAuthorization.authorizationDigest,
      attemptReceiptDigest: attemptReceiptDigest || bootstrapAuthorization.attemptDigest,
      principalRef,
      verifierRef,
      daemonGeneration: generation.generation_ref,
      recordedAt: now,
    };
    const eventDigest = digestObject("DirectSemanticService.AuthorityBootstrap.v1", eventPayload);
    const preparedKey = keyring ? keyring.prepareInitial({ admittedByCapabilityRef: "grant.daemon-credential-bootstrap", effectiveAfterGlobalSequence: 0 }) : null;
    try {
      this.store.transaction((tx) => {
        if (tx.get("SELECT principal_ref FROM principals LIMIT 1") || tx.get("SELECT custody_key_revision_ref FROM custody_keys LIMIT 1")) dss02Fail("DSS02_ALREADY_INITIALIZED");
        if (!bootstrapCommitment || !bootstrapAttempt) dss02Fail("DSS02_BOOTSTRAP_CHAIN_BROKEN");
        tx.run("INSERT INTO bootstrap_commitments(commitment_ref,profile_ref,payload_json,commitment_digest,state,created_at,expires_at,maximum_attempts,attempt_count) VALUES(?,?,?,?,?,?,?,?,?)", bootstrapCommitment.commitmentRef, bootstrapCommitment.profileRef, canonicalJson(bootstrapCommitment), bootstrapCommitment.commitmentDigest, "CONSUMED", bootstrapCommitment.createdAt, bootstrapCommitment.expiresAt, bootstrapCommitment.maximumAttempts, 1);
        tx.run("INSERT INTO bootstrap_attempts(attempt_ref,commitment_ref,payload_json,attempt_digest,state,claimed_at,outcome_code) VALUES(?,?,?,?,?,?,?)", bootstrapAttempt.attemptRef, bootstrapAttempt.commitmentRef, canonicalJson(bootstrapAttempt), bootstrapAttempt.attemptDigest, bootstrapAttempt.state, bootstrapAttempt.claimedAt, bootstrapAttempt.outcomeCode || null);
        tx.run("INSERT INTO bootstrap_authorizations(authorization_ref,commitment_ref,attempt_ref,payload_json,authorization_digest,state,authorized_at) VALUES(?,?,?,?,?,?,?)", bootstrapAuthorization.authorizationRef, bootstrapAuthorization.commitmentRef, bootstrapAuthorization.attemptRef, canonicalJson(bootstrapAuthorization), bootstrapAuthorization.authorizationDigest, bootstrapAuthorization.decision, bootstrapAuthorization.authorizedAt);
        if (preparedKey) keyring.initializeInTransaction(tx, preparedKey);
        tx.run("INSERT INTO principals(principal_ref,principal_id,lineage_revision,issuer_revision,principal_class,subject_ref,project_scopes_json,purpose_scopes_json,state,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)", principalRef, principal.principalId, principalRevision, principal.issuerRevision, principal.principalClass, principal.subjectRef, canonicalJson(principal.projectScopes), canonicalJson(principal.purposeScopes), principal.state, now);
        tx.run("INSERT INTO verifiers(verifier_ref,verifier_revision,principal_ref,principal_lineage_revision,issuer_revision,public_key,public_key_fingerprint,operations_json,purpose_scopes_json,object_scopes_json,registry_revisions_json,issued_at,expires_at,revocation_epoch,state) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", verifierRef, verifierRevision, principalRef, principalRevision, verifier.issuerRevision, encoded, fingerprint, canonicalJson(verifier.operations), canonicalJson(verifier.purposeScopes), canonicalJson(verifier.objectScopes), canonicalJson(verifier.registryRevisions), verifier.issuedAt, verifier.expiresAt, verifier.revocationEpoch, verifier.state);
        tx.run("INSERT INTO dss_meta(key,value) VALUES('bootstrap_authorization_digest',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", bootstrapAuthorization.authorizationDigest);
        tx.run("INSERT INTO dss_meta(key,value) VALUES('bootstrap_event_digest',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", eventDigest);
        if (this.ledger) this.ledger.appendInTransaction(tx, { eventType: "bootstrap_daemon_authority", payload: eventPayload, recordedAt: now });
      });
    } catch (error) {
      if (preparedKey && keyring) { try { require("node:fs").unlinkSync(keyring.pathFor(preparedKey.custodyKeyRevisionRef)); } catch (_) {} }
      throw error;
    }
    return Object.freeze({ principal, verifier, eventDigest, generation: generation.generation_ref, custodyKey: preparedKey });
  }

  issueCredential({ actorVerifierRef, principalId, principalClass = "local_user_experimental", subjectRef, projectScopes = [], purposeScopes = ["semantic-request"], publicKey, operations = ["submit"], objectScopes = [], registryRevisions = [], expiresAt = undefined } = {}) {
    this.assertServiceAdmin(actorVerifierRef);
    const actor = this.getVerifier(actorVerifierRef);
    const now = this.clock();
    const principalRef = randomRef("principal");
    const principalRevision = randomRef("principal-lineage");
    const verifierRef = randomRef("verifier");
    const verifierRevision = randomRef("verifier-revision");
    const encoded = exportPublicKey(publicKeyFromValue(publicKey));
    const principal = { schema: PRINCIPAL_SCHEMA, principalRef, principalId: immutableId(principalId, "principalId"), lineageRevision: principalRevision, issuerRevision: actor.verifierRevision, principalClass, subjectRef: immutableId(subjectRef, "subjectRef"), projectScopes: sorted(projectScopes, "projectScopes"), purposeScopes: sorted(purposeScopes, "purposeScopes"), state: "CURRENT", createdAt: now };
    const verifier = { schema: VERIFIER_SCHEMA, verifierRef, verifierRevision, principalRef, principalLineageRevision: principalRevision, issuerRevision: actor.verifierRevision, publicKey: encoded, publicKeyFingerprint: publicKeyFingerprint(encoded), operations: sorted(operations, "operations"), purposeScopes: principal.purposeScopes, objectScopes: sorted(objectScopes, "objectScopes", { allowWildcard: true }), registryRevisions: sorted(registryRevisions, "registryRevisions"), issuedAt: now, expiresAt: expiresAt || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), revocationEpoch: 0, state: "CURRENT", supersededBy: null };
    if (!verifier.operations.every((operation) => ALL_OPERATIONS.includes(operation))) dss02Fail("DSS02_OPERATION_INVALID");
    this.store.transaction((tx) => {
      tx.run("INSERT INTO principals(principal_ref,principal_id,lineage_revision,issuer_revision,principal_class,subject_ref,project_scopes_json,purpose_scopes_json,state,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)", principalRef, principal.principalId, principalRevision, principal.issuerRevision, principal.principalClass, principal.subjectRef, canonicalJson(principal.projectScopes), canonicalJson(principal.purposeScopes), principal.state, now);
      tx.run("INSERT INTO verifiers(verifier_ref,verifier_revision,principal_ref,principal_lineage_revision,issuer_revision,public_key,public_key_fingerprint,operations_json,purpose_scopes_json,object_scopes_json,registry_revisions_json,issued_at,expires_at,revocation_epoch,state) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", verifierRef, verifierRevision, principalRef, principalRevision, verifier.issuerRevision, encoded, verifier.publicKeyFingerprint, canonicalJson(verifier.operations), canonicalJson(verifier.purposeScopes), canonicalJson(verifier.objectScopes), canonicalJson(verifier.registryRevisions), verifier.issuedAt, verifier.expiresAt, verifier.revocationEpoch, verifier.state);
      for (const revisionRef of verifier.registryRevisions) tx.run("INSERT INTO registry_revisions(revision_ref,registry_digest,state,created_at) VALUES(?,?,?,?) ON CONFLICT(revision_ref) DO NOTHING", revisionRef, digestObject("DirectSemanticService.RegistryRevision.v1", { revisionRef }), "CURRENT", now);
      if (this.ledger) this.ledger.appendInTransaction(tx, { eventType: "authority_credential_issued", payload: { principalRef, verifierRef, principalDigest: digestObject("DirectSemanticService.PrincipalLineage.v1", { ...principal, supersededBy: null }), verifierDigest: digestObject("DirectSemanticService.VerifierRecord.v1", verifier), issuerRevision: verifier.issuerRevision, principalLineageRevision: verifier.principalLineageRevision, verifierRevision: verifier.verifierRevision, recordedAt: now }, recordedAt: now });
    });
    return Object.freeze({ principal, verifier });
  }

  getVerifier(verifierRef) {
    const row = this.store.get("SELECT * FROM verifiers WHERE verifier_ref=?", verifierRef);
    if (!row) return null;
    return this.rowVerifier(row);
  }

  rowVerifier(row) {
    return {
      schema: VERIFIER_SCHEMA,
      verifierRef: row.verifier_ref,
      verifierRevision: row.verifier_revision,
      principalRef: row.principal_ref,
      principalLineageRevision: row.principal_lineage_revision,
      issuerRevision: row.issuer_revision,
      publicKey: row.public_key,
      publicKeyFingerprint: row.public_key_fingerprint,
      operations: parseStoredJson(row.operations_json, "verifier.operations"),
      purposeScopes: parseStoredJson(row.purpose_scopes_json, "verifier.purposeScopes"),
      objectScopes: parseStoredJson(row.object_scopes_json, "verifier.objectScopes"),
      registryRevisions: parseStoredJson(row.registry_revisions_json, "verifier.registryRevisions"),
      issuedAt: row.issued_at,
      expiresAt: row.expires_at,
      revocationEpoch: row.revocation_epoch,
      state: row.state,
      supersededBy: row.superseded_by || null,
    };
  }

  getPrincipal(principalRef) {
    const row = this.store.get("SELECT * FROM principals WHERE principal_ref=?", principalRef);
    if (!row) return null;
    return { schema: PRINCIPAL_SCHEMA, principalRef: row.principal_ref, principalId: row.principal_id, lineageRevision: row.lineage_revision, issuerRevision: row.issuer_revision, principalClass: row.principal_class, subjectRef: row.subject_ref, projectScopes: parseStoredJson(row.project_scopes_json, "principal.projectScopes"), purposeScopes: parseStoredJson(row.purpose_scopes_json, "principal.purposeScopes"), state: row.state, createdAt: row.created_at, supersededBy: row.superseded_by || null };
  }

  assertCurrentVerifier(verifierRef, { operation = undefined, purposeScopes = [], objectScopeDigest = undefined, registryRevisionSet = [], now = undefined } = {}) {
    const verifier = this.getVerifier(verifierRef);
    if (!verifier) dss02Fail("DSS02_VERIFIER_UNKNOWN");
    if (verifier.state !== "CURRENT") dss02Fail("DSS02_VERIFIER_INACTIVE");
    if (isExpired(verifier.expiresAt, now ? new Date(now) : new Date())) dss02Fail("DSS02_VERIFIER_EXPIRED");
    const principal = this.getPrincipal(verifier.principalRef);
    if (!principal || principal.state !== "CURRENT" || principal.lineageRevision !== verifier.principalLineageRevision) dss02Fail("DSS02_PRINCIPAL_STALE");
    if (verifier.issuerRevision !== "owner-bootstrap-issuer@1") {
      const issuer = this.store.get("SELECT * FROM verifiers WHERE verifier_revision=?", verifier.issuerRevision);
      const issuerPrincipal = issuer && this.store.get("SELECT * FROM principals WHERE principal_ref=?", issuer.principal_ref);
      if (!issuer || issuer.state !== "CURRENT" || !issuerPrincipal || issuerPrincipal.state !== "CURRENT" || issuerPrincipal.lineage_revision !== issuer.principal_lineage_revision) dss02Fail("DSS02_ISSUER_STALE");
    }
    if (operation && !verifier.operations.includes(operation)) dss02Fail("DSS02_OPERATION_UNAUTHORIZED");
    for (const purpose of purposeScopes) if (!verifier.purposeScopes.includes(purpose)) dss02Fail("DSS02_PURPOSE_UNAUTHORIZED");
    if (objectScopeDigest && !verifier.objectScopes.includes("*") && !verifier.objectScopes.includes(objectScopeDigest)) dss02Fail("DSS02_OBJECT_SCOPE_UNAUTHORIZED");
    const actualRegistry = sorted(registryRevisionSet, "registryRevisionSet");
    if (verifier.registryRevisions.length && canonicalJson(verifier.registryRevisions) !== canonicalJson(actualRegistry)) dss02Fail("DSS02_REGISTRY_STALE");
    return { verifier, principal };
  }

  assertServiceAdmin(verifierRef) {
    this.assertCurrentVerifier(verifierRef, { operation: SERVICE_ADMIN_OPERATION });
    return this.getVerifier(verifierRef);
  }

  issueAuthorizationChallenge({ connectionRef, transportObservation, ttlMs = 30_000 } = {}) {
    if (!transportObservation || transportObservation.status !== "OBSERVED") dss02Fail("DSS02_TRANSPORT_UNOBSERVED");
    const generation = this.currentGeneration();
    if (!Number.isSafeInteger(ttlMs) || ttlMs < 100 || ttlMs > 300_000) dss02Fail("DSS02_CHALLENGE_TTL_INVALID");
    const issuedAt = this.clock();
    const challenge = {
      schema: CHALLENGE_SCHEMA,
      profileRef: this.profileRef,
      protocolRevision: this.protocolRevision,
      connectionRef: immutableId(connectionRef, "connectionRef"),
      daemonGeneration: generation.generation_ref,
      challengeRef: randomRef("challenge"),
      nonce: randomNonce(32),
      issuedAt,
      expiresAt: new Date(new Date(issuedAt).getTime() + ttlMs).toISOString(),
      stateRevision: 1,
      state: "ISSUED",
    };
    // Keep mutable state out of the canonical challenge digest; the durable
    // state revision is carried in the challenge transcript itself.
    const digestInput = { ...challenge };
    delete digestInput.state;
    challenge.challengeDigest = digestObject("DirectSemanticService.AuthorizationChallenge.v1", digestInput);
    this.store.run("INSERT INTO authorization_challenges(challenge_ref,profile_ref,protocol_revision,connection_ref,daemon_generation,nonce,challenge_digest,issued_at,expires_at,state,state_revision) VALUES(?,?,?,?,?,?,?,?,?,?,?)", challenge.challengeRef, this.profileRef, challenge.protocolRevision, challenge.connectionRef, challenge.daemonGeneration, challenge.nonce, challenge.challengeDigest, challenge.issuedAt, challenge.expiresAt, challenge.state, challenge.stateRevision);
    return Object.freeze(challenge);
  }

  getChallenge(challengeRef) {
    const row = this.store.get("SELECT * FROM authorization_challenges WHERE challenge_ref=?", challengeRef);
    if (!row) return null;
    return { schema: CHALLENGE_SCHEMA, profileRef: row.profile_ref, protocolRevision: row.protocol_revision, connectionRef: row.connection_ref, daemonGeneration: row.daemon_generation, challengeRef: row.challenge_ref, nonce: row.nonce, challengeDigest: row.challenge_digest, issuedAt: row.issued_at, expiresAt: row.expires_at, state: row.state, stateRevision: row.state_revision, consumedAt: row.consumed_at || null };
  }

  resolveDaemonCredential({ connectionRef, transportObservation, challengeRef, proof, requestDigest, operation, purposeScopes = [], objectScopeDigest, registryRevisionSet = [], now = undefined } = {}) {
    const challenge = this.getChallenge(challengeRef);
    const validationTime = isoNow(now);
    let result;
    this.store.transaction((tx) => {
      const row = tx.get("SELECT * FROM authorization_challenges WHERE challenge_ref=?", challengeRef);
      if (!row) dss02Fail("DSS02_CHALLENGE_UNKNOWN");
      if (row.state !== "ISSUED" || row.state_revision !== 1) {
        result = { decision: "REPLAYED_OR_CONCURRENT_CHALLENGE", reasonCode: "DSS02_CHALLENGE_CONSUMED" };
        return;
      }
      const setState = (state) => tx.run("UPDATE authorization_challenges SET state=?, state_revision=state_revision+1, consumed_at=? WHERE challenge_ref=? AND state='ISSUED' AND state_revision=1", state, validationTime, challengeRef);
      const expired = isExpired(row.expires_at, new Date(validationTime));
      if (expired) {
        setState("EXPIRED");
        result = { decision: "EXPIRED", reasonCode: "DSS02_CHALLENGE_EXPIRED" };
        return;
      }
      const generation = this.currentGeneration();
      const baseChecks = row.profile_ref === this.profileRef && row.protocol_revision === this.protocolRevision && row.connection_ref === connectionRef && row.daemon_generation === generation.generation_ref;
      if (!baseChecks) {
        setState("CONSUMED");
        result = { decision: "DENIED_AND_CONSUMED", reasonCode: "DSS02_CHALLENGE_BINDING_MISMATCH" };
        return;
      }
      let verifier;
      try {
        exactObject(proof, ["schema", "challengeRef", "verifierRef", "requestDigest", "operation", "purposeScopes", "objectScopeDigest", "verifierRevision", "principalLineageRevision", "issuerRevision", "registryRevisionSet", "revocationEpoch", "signatureAlgorithm", "signature"], "DSS02_PROOF_CLOSED");
        if (proof.schema !== PROOF_SCHEMA || proof.challengeRef !== challengeRef || proof.requestDigest !== requestDigest || proof.operation !== operation || proof.signatureAlgorithm !== "ed25519") throw new Error("proof fields");
        verifier = this.getVerifier(proof.verifierRef);
        if (!verifier || verifier.verifierRevision !== proof.verifierRevision || verifier.principalLineageRevision !== proof.principalLineageRevision || verifier.issuerRevision !== proof.issuerRevision || verifier.revocationEpoch !== proof.revocationEpoch) throw new Error("verifier lineage");
        this.assertCurrentVerifier(proof.verifierRef, { operation, purposeScopes, objectScopeDigest, registryRevisionSet, now: validationTime });
        const proofPurposeScopes = sorted(proof.purposeScopes, "proof purpose scopes");
        const expectedPurposeScopes = sorted(purposeScopes, "purpose scopes");
        const proofRegistry = sorted(proof.registryRevisionSet, "proof registry");
        const expectedRegistry = sorted(registryRevisionSet, "registry");
        // Canonical transcripts use sorted sets, but the proof envelope is
        // closed and must carry that canonical order too.  Otherwise two
        // distinct byte representations could authorize the same authority
        // tuple and replay/registry comparisons would become ambiguous.
        if (canonicalJson(proof.purposeScopes) !== canonicalJson(proofPurposeScopes) || canonicalJson(proofPurposeScopes) !== canonicalJson(expectedPurposeScopes)) throw new Error("purpose scope");
        if (proof.objectScopeDigest !== objectScopeDigest || canonicalJson(proof.registryRevisionSet) !== canonicalJson(proofRegistry) || canonicalJson(proofRegistry) !== canonicalJson(expectedRegistry)) throw new Error("authority tuple");
        const authority = { requestDigest, operation, purposeScopes: sorted(purposeScopes, "purposeScopes"), objectScopeDigest, verifierRevision: verifier.verifierRevision, principalLineageRevision: verifier.principalLineageRevision, issuerRevision: verifier.issuerRevision, registryRevisionSet: sorted(registryRevisionSet, "registryRevisionSet"), revocationEpoch: verifier.revocationEpoch };
        const transcript = transcriptBytes(challengeCanonical({ ...challenge, stateRevision: row.state_revision }), authorityCanonical(authority));
        if (typeof proof.signature !== "string" || !/^[A-Za-z0-9_-]+$/.test(proof.signature) || Buffer.from(proof.signature, "base64url").toString("base64url") !== proof.signature) throw new Error("signature encoding");
        if (!verifyEd25519(importPublicKey(verifier.publicKey), transcript, proof.signature)) throw new Error("signature");
        setState("CONSUMED");
        result = { decision: "AUTHORIZED", reasonCode: null, verifier, principal: this.getPrincipal(verifier.principalRef) };
      } catch (error) {
        setState("CONSUMED");
        result = { decision: "DENIED_AND_CONSUMED", reasonCode: error.code || "DSS02_PROOF_REJECTED" };
      }
      const proofDigest = digestObject("DirectSemanticService.AuthorizationProof.v1", proof);
      const receipt = { schema: RECEIPT_SCHEMA, receiptRef: randomRef("authorization-receipt"), challengeRef, proofDigest, requestDigest, operation, principalRef: result.principal?.principalRef || null, verifierRef: result.verifier?.verifierRef || proof.verifierRef || null, decision: result.decision, reasonCode: result.reasonCode, authorizedAt: validationTime, challengeStateRevision: row.state_revision + 1 };
      receipt.authorizationDigest = digestObject("DirectSemanticService.RequestAuthorizationReceipt.v1", receipt);
      if (result.decision !== "REPLAYED_OR_CONCURRENT_CHALLENGE") tx.run("INSERT INTO authorization_receipts(receipt_ref,challenge_ref,proof_digest,request_digest,operation,principal_ref,verifier_ref,decision,reason_code,authorized_at,challenge_state_revision) VALUES(?,?,?,?,?,?,?,?,?,?,?)", receipt.receiptRef, challengeRef, receipt.proofDigest, requestDigest, operation, receipt.principalRef, receipt.verifierRef, receipt.decision, receipt.reasonCode, validationTime, receipt.challengeStateRevision);
      result = { ...result, receipt: Object.freeze(receipt), challenge: this.getChallenge(challengeRef) };
    });
    return Object.freeze(result);
  }

  revokeCredential({ actorVerifierRef, verifierRef, reasonCode = "REVOKED" } = {}) {
    this.assertServiceAdmin(actorVerifierRef);
    const target = this.getVerifier(verifierRef);
    if (!target) dss02Fail("DSS02_VERIFIER_UNKNOWN");
    const now = this.clock();
    this.store.transaction((tx) => {
      tx.run("UPDATE verifiers SET state='REVOKED', revocation_epoch=revocation_epoch+1 WHERE verifier_ref=? AND state='CURRENT'", verifierRef);
      tx.run("UPDATE principals SET state='SUPERSEDED' WHERE principal_ref=? AND state='CURRENT'", target.principalRef);
      if (this.ledger) this.ledger.appendInTransaction(tx, { eventType: "authority_credential_revoked", payload: { verifierRef, principalRef: target.principalRef, priorVerifierRevision: target.verifierRevision, revocationEpoch: target.revocationEpoch + 1, reasonCode, recordedAt: now }, recordedAt: now });
    });
    return Object.freeze({ verifierRef, state: "REVOKED", reasonCode, revokedAt: now });
  }

  reconcileEvents() {
    const events = this.store.all("SELECT * FROM service_events WHERE event_type IN ('bootstrap_daemon_authority','authority_credential_issued','authority_credential_revoked') ORDER BY global_sequence");
    const bootstrapEvent = events.find((event) => event.event_type === "bootstrap_daemon_authority");
    const principals = this.store.all("SELECT * FROM principals");
    const verifiers = this.store.all("SELECT * FROM verifiers");
    if (principals.length && !bootstrapEvent) dss02Fail("DSS02_AUTHORITY_EVENT_MISSING");
    const bootstrapPayload = bootstrapEvent ? JSON.parse(bootstrapEvent.payload_json) : null;
    const payloads = events.map((event) => ({ event, payload: JSON.parse(event.payload_json) }));
    const issuedByVerifier = new Map();
    const revokedByVerifier = new Map();
    for (const { event, payload } of payloads) {
      if (event.event_type === "authority_credential_issued") {
        if (issuedByVerifier.has(payload.verifierRef)) dss02Fail("DSS02_AUTHORITY_EVENT_DRIFT");
        issuedByVerifier.set(payload.verifierRef, payload);
      }
      if (event.event_type === "authority_credential_revoked") {
        if (revokedByVerifier.has(payload.verifierRef)) dss02Fail("DSS02_AUTHORITY_EVENT_DRIFT");
        revokedByVerifier.set(payload.verifierRef, payload);
      }
    }
    for (const row of verifiers) {
      const payload = issuedByVerifier.get(row.verifier_ref);
      const isBootstrapVerifier = Boolean(bootstrapPayload && bootstrapPayload.verifierRef === row.verifier_ref);
      if (!payload && !isBootstrapVerifier) dss02Fail("DSS02_AUTHORITY_EVENT_MISSING");
      if (payload) {
        const principal = this.getPrincipal(row.principal_ref);
        // Issuance events commit the immutable verifier record.  Revocation
        // increments the mutable epoch, so replay the issuance at epoch zero
        // before applying authenticated revocation events below.
        const immutableVerifier = { ...this.rowVerifier(row), state: "CURRENT", supersededBy: null, revocationEpoch: 0 };
        const immutablePrincipal = { ...principal, state: "CURRENT", supersededBy: null };
        if (payload.verifierDigest !== digestObject("DirectSemanticService.VerifierRecord.v1", immutableVerifier) || payload.principalDigest !== digestObject("DirectSemanticService.PrincipalLineage.v1", immutablePrincipal)) dss02Fail("DSS02_AUTHORITY_EVENT_DRIFT");
      }
      const revoked = revokedByVerifier.get(row.verifier_ref);
      const expectedState = revoked ? "REVOKED" : "CURRENT";
      const expectedEpoch = revoked ? revoked.revocationEpoch : 0;
      if (row.state !== expectedState || row.revocation_epoch !== expectedEpoch || row.superseded_by !== null) dss02Fail("DSS02_AUTHORITY_STATE_DRIFT");
      if (revoked && (revoked.principalRef !== row.principal_ref || revoked.priorVerifierRevision !== row.verifier_revision || revoked.revocationEpoch !== 1)) dss02Fail("DSS02_AUTHORITY_EVENT_DRIFT");
      const principal = this.store.get("SELECT * FROM principals WHERE principal_ref=?", row.principal_ref);
      if (!principal) dss02Fail("DSS02_AUTHORITY_PRINCIPAL_ORPHAN");
      const expectedPrincipalState = revoked ? "SUPERSEDED" : "CURRENT";
      if (principal.state !== expectedPrincipalState || principal.superseded_by !== null) dss02Fail("DSS02_AUTHORITY_STATE_DRIFT");
      if (isBootstrapVerifier && row.issuer_revision !== "owner-bootstrap-issuer@1") dss02Fail("DSS02_AUTHORITY_EVENT_DRIFT");
      if (revoked && !payload) {
        // A revocation may never stand without the immutable issuance (or the
        // one bootstrap genesis event) that established the verifier.
        dss02Fail("DSS02_AUTHORITY_EVENT_MISSING");
      }
    }
    for (const { event, payload } of payloads) {
      if (["authority_credential_issued", "authority_credential_revoked"].includes(event.event_type) && !verifiers.some((row) => row.verifier_ref === payload.verifierRef)) dss02Fail("DSS02_AUTHORITY_EVENT_ORPHAN");
    }
    return true;
  }

  expireChallengesForGeneration(generationRef) {
    const now = this.clock();
    const result = this.store.run("UPDATE authorization_challenges SET state='INVALIDATED_BY_RESTART', state_revision=state_revision+1, consumed_at=? WHERE daemon_generation=? AND state='ISSUED'", now, generationRef);
    return result.changes || 0;
  }

  credentialForProof(verifierRef) {
    const verifier = this.getVerifier(verifierRef);
    if (!verifier) dss02Fail("DSS02_VERIFIER_UNKNOWN");
    return verifier;
  }
}

function createDss02Authority(options) { return new Dss02Authority(options); }

module.exports = {
  CHALLENGE_SCHEMA,
  PROOF_SCHEMA,
  RECEIPT_SCHEMA,
  PRINCIPAL_SCHEMA,
  VERIFIER_SCHEMA,
  ALL_OPERATIONS,
  Dss02Authority,
  DirectSemanticServiceAuthority: Dss02Authority,
  createDss02Authority,
  createAuthorizationProof,
  challengeCanonical,
  authorityCanonical,
};
