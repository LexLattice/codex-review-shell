"use strict";

/* Offline owner-root installation and the one-use profile genesis ceremony. */

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const {
  DSS02_SCHEMA,
  Dss02Error,
  dss02Fail,
  ensureObject,
  exactObject,
  isoNow,
  isExpired,
  randomNonce,
  randomSecret,
  randomRef,
  canonicalJson,
  digestObject,
  digestBytes,
  atomicWrite,
  ensureDirectory,
  fsyncDirectory,
  createKeyPair,
  exportPublicKey,
  importPublicKey,
  publicKeyFingerprint,
  signEd25519,
  verifyEd25519,
  parseJsonStrict,
} = require("./dss02-common");

const ROOT_PIN_FILE = "owner-bootstrap-root-pin.json";
const ROOT_PRIVATE_FILE = "owner-bootstrap-root.private.der";
const PENDING_FILE = "pending-commitment.json";
const ATTEMPT_FILE = "attempt-receipt.json";
const ROOT_PIN_SCHEMA = "direct_semantic_owner_bootstrap_root_pin@1";
const COMMITMENT_SCHEMA = "direct_semantic_owner_bootstrap_commitment@1";
const ATTEMPT_SCHEMA = "direct_semantic_bootstrap_attempt_receipt@1";
const AUTHORIZATION_SCHEMA = "direct_semantic_bootstrap_authorization_receipt@1";
const ROOT_DOMAIN = "DirectSemanticService.OwnerBootstrapRootPin.v1";
const COMMITMENT_DOMAIN = "DirectSemanticService.OwnerBootstrapCommitment.v1";

function installationPaths(installationRoot) {
  if (typeof installationRoot !== "string" || !path.isAbsolute(installationRoot)) dss02Fail("DSS02_INSTALLATION_ROOT_INVALID");
  const root = path.resolve(installationRoot);
  return Object.freeze({
    root,
    pin: path.join(root, ROOT_PIN_FILE),
    privateKey: path.join(root, ROOT_PRIVATE_FILE),
  });
}

function readJson(filePath, code) {
  try { return parseJsonStrict(fs.readFileSync(filePath, "utf8")); }
  catch (error) { dss02Fail(code, filePath); }
}

function pinDigest(pin) { return digestObject(ROOT_DOMAIN, pin); }

function readOwnerRootPin(installationRoot) {
  const paths = installationPaths(installationRoot);
  let pin;
  try { pin = readJson(paths.pin, "DSS02_OWNER_ROOT_UNREADABLE"); }
  catch (error) { return { status: "BROKEN", reason: "UNREADABLE", paths }; }
  try {
    exactObject(pin, ["schema", "installationRef", "ownerRootAlgorithm", "ownerRootPublicKey", "ownerRootFingerprint", "configurationRevision", "pinDigest", "installedAt", "installationEventDigest", "signature"] , "DSS02_OWNER_ROOT_PIN_CLOSED");
    if (pin.schema !== ROOT_PIN_SCHEMA || pin.ownerRootAlgorithm !== "ed25519") throw new Error("schema");
    const expectedFingerprint = publicKeyFingerprint(pin.ownerRootPublicKey);
    const unsigned = { ...pin };
    delete unsigned.pinDigest;
    delete unsigned.signature;
    if (expectedFingerprint !== pin.ownerRootFingerprint || pinDigest(unsigned) !== pin.pinDigest) throw new Error("fingerprint");
    const publicKey = importPublicKey(pin.ownerRootPublicKey);
    const signed = { ...unsigned, pinDigest: pin.pinDigest };
    const bytes = Buffer.from(`${ROOT_DOMAIN}\n${canonicalJson(signed)}`, "utf8");
    if (!verifyEd25519(publicKey, bytes, pin.signature)) throw new Error("signature");
    return { status: "PINNED", pin, publicKey, paths };
  } catch (error) {
    return { status: "BROKEN", reason: "INVALID", paths };
  }
}

function installOwnerBootstrapTrustRoot({ installationRoot, configurationRevision = "direct-installation@1" } = {}) {
  const paths = installationPaths(installationRoot);
  ensureDirectory(paths.root, 0o700);
  if (fs.existsSync(paths.pin) || fs.existsSync(paths.privateKey)) dss02Fail("DSS02_OWNER_ROOT_ALREADY_INSTALLED");
  const { publicKey, privateKey } = createKeyPair();
  const publicEncoded = exportPublicKey(publicKey);
  const fingerprint = publicKeyFingerprint(publicEncoded);
  const unsigned = {
    schema: ROOT_PIN_SCHEMA,
    installationRef: randomRef("installation"),
    ownerRootAlgorithm: "ed25519",
    ownerRootPublicKey: publicEncoded,
    ownerRootFingerprint: fingerprint,
    configurationRevision,
    installedAt: isoNow(),
    installationEventDigest: digestObject("DirectSemanticService.Installation.v1", { fingerprint, configurationRevision }),
  };
  const pin = {
    ...unsigned,
    pinDigest: pinDigest(unsigned),
    signature: signEd25519(privateKey, Buffer.from(`${ROOT_DOMAIN}\n${canonicalJson({ ...unsigned, pinDigest: pinDigest(unsigned) })}`, "utf8")),
  };
  // The private root is deliberately outside every profile and is only read by
  // this offline provisioning function.
  atomicWrite(paths.privateKey, privateKey.export({ type: "pkcs8", format: "der" }), 0o600);
  atomicWrite(paths.pin, Buffer.from(canonicalJson(pin), "utf8"), 0o600);
  return Object.freeze({ status: "PINNED", pin: Object.freeze(pin), paths });
}

function verifyOwnerBootstrapRootPin({ installationRoot } = {}) {
  return readOwnerRootPin(installationRoot);
}

function loadOwnerPrivateKey(paths) {
  try {
    return crypto.createPrivateKey({ key: fs.readFileSync(paths.privateKey), type: "pkcs8", format: "der" });
  } catch (error) {
    dss02Fail("DSS02_OWNER_ROOT_PRIVATE_KEY_UNAVAILABLE");
  }
}

function profileGenesisPaths(profileRoot) {
  if (typeof profileRoot !== "string" || !path.isAbsolute(profileRoot)) dss02Fail("DSS02_PROFILE_ROOT_INVALID");
  const root = path.resolve(profileRoot);
  return Object.freeze({
    root,
    bootstrap: path.join(root, "bootstrap"),
    pending: path.join(root, "bootstrap", PENDING_FILE),
    attempt: path.join(root, "bootstrap", ATTEMPT_FILE),
  });
}

function provisionBootstrapCommitment({
  installationRoot,
  profileRoot,
  profileRef,
  expectedDaemonRevision = "direct-semanticd@0.2",
  protocolRevision = "direct-semantic-protocol@1",
  descriptorPolicy = { kind: "owner_inherited_fd", revision: "descriptor-policy@1" },
  expiresAt,
} = {}) {
  if (typeof profileRef !== "string" || profileRef.length === 0) dss02Fail("DSS02_PROFILE_REF_INVALID");
  const root = verifyOwnerBootstrapRootPin({ installationRoot });
  if (root.status !== "PINNED") dss02Fail("DSS02_OWNER_ROOT_BROKEN");
  const profile = profileGenesisPaths(profileRoot);
  if (fs.existsSync(profile.root)) {
    let entries;
    try { entries = fs.readdirSync(profile.root); } catch (_) { dss02Fail("DSS02_PROFILE_EXISTS"); }
    if (entries.length > 0) dss02Fail("DSS02_PROFILE_EXISTS");
  }
  ensureDirectory(profile.root, 0o700);
  ensureDirectory(profile.bootstrap, 0o700);
  const secret = randomSecret(32);
  const salt = randomSecret(32);
  const nonce = randomNonce(32);
  const createdAt = isoNow();
  const expiry = expiresAt || new Date(Date.now() + 15 * 60 * 1000).toISOString();
  if (isExpired(expiry, new Date(createdAt))) dss02Fail("DSS02_COMMITMENT_EXPIRED");
  const secretCommitment = digestBytes("DirectSemanticService.BootstrapSecret.v1", Buffer.concat([salt, Buffer.from(nonce, "utf8"), secret]));
  const descriptorPolicyDigest = digestObject("DirectSemanticService.DescriptorPolicy.v1", descriptorPolicy);
  const unsigned = {
    schema: COMMITMENT_SCHEMA,
    commitmentRef: randomRef("bootstrap-commitment"),
    profileRef,
    ownerRootFingerprint: root.pin.ownerRootFingerprint,
    installationConfigurationRevision: root.pin.configurationRevision,
    expectedDaemonRevision,
    protocolRevision,
    secretCommitment,
    salt: salt.toString("base64url"),
    bootstrapNonce: nonce,
    descriptorPolicyDigest,
    descriptorPolicy,
    createdAt,
    expiresAt: expiry,
    maximumAttempts: 1,
  };
  const commitmentDigest = digestObject(COMMITMENT_DOMAIN, unsigned);
  const privateKey = loadOwnerPrivateKey(root.paths);
  const signedPayload = { ...unsigned, commitmentDigest };
  const commitment = {
    ...signedPayload,
    commitmentDigest,
    ownerSignature: signEd25519(privateKey, Buffer.from(`${COMMITMENT_DOMAIN}\n${canonicalJson(signedPayload)}`, "utf8")),
  };
  atomicWrite(profile.pending, Buffer.from(canonicalJson(commitment), "utf8"), 0o600);
  fsyncDirectory(profile.bootstrap);
  return Object.freeze({
    status: "PROVISIONED",
    commitment: Object.freeze(commitment),
    secret: secret.toString("base64url"),
    secretBytes: Buffer.from(secret),
    profilePaths: profile,
  });
}

function loadPendingCommitment(profileRoot) {
  const paths = profileGenesisPaths(profileRoot);
  if (!fs.existsSync(paths.pending)) return null;
  const commitment = readJson(paths.pending, "DSS02_COMMITMENT_UNREADABLE");
  return { commitment, paths };
}

function verifyCommitmentAgainstRoot(commitment, root) {
  exactObject(commitment, ["schema", "commitmentRef", "profileRef", "ownerRootFingerprint", "installationConfigurationRevision", "expectedDaemonRevision", "protocolRevision", "secretCommitment", "salt", "bootstrapNonce", "descriptorPolicyDigest", "descriptorPolicy", "createdAt", "expiresAt", "maximumAttempts", "commitmentDigest", "ownerSignature"], "DSS02_COMMITMENT_CLOSED");
  if (commitment.schema !== COMMITMENT_SCHEMA || commitment.ownerRootFingerprint !== root.pin.ownerRootFingerprint || commitment.maximumAttempts !== 1) dss02Fail("DSS02_COMMITMENT_INVALID");
  const unsigned = { ...commitment };
  delete unsigned.commitmentDigest;
  delete unsigned.ownerSignature;
  if (digestObject(COMMITMENT_DOMAIN, unsigned) !== commitment.commitmentDigest) dss02Fail("DSS02_COMMITMENT_DIGEST_MISMATCH");
  const signed = { ...unsigned, commitmentDigest: commitment.commitmentDigest };
  if (!verifyEd25519(root.publicKey, Buffer.from(`${COMMITMENT_DOMAIN}\n${canonicalJson(signed)}`, "utf8"), commitment.ownerSignature)) dss02Fail("DSS02_COMMITMENT_SIGNATURE_INVALID");
  return commitment;
}

function verifyAttemptReceipt(attempt, commitment) {
  exactObject(attempt, ["schema", "attemptRef", "commitmentRef", "profileRef", "commitmentDigest", "claimedAt", "attemptNumber", "state", "attemptDigest", "outcomeCode"], "DSS02_ATTEMPT_CLOSED");
  if (attempt.schema !== ATTEMPT_SCHEMA || attempt.commitmentRef !== commitment.commitmentRef || attempt.profileRef !== commitment.profileRef || attempt.commitmentDigest !== commitment.commitmentDigest || attempt.attemptNumber !== 1) dss02Fail("DSS02_ATTEMPT_INVALID");
  const unsigned = { schema: attempt.schema, attemptRef: attempt.attemptRef, commitmentRef: attempt.commitmentRef, profileRef: attempt.profileRef, commitmentDigest: attempt.commitmentDigest, claimedAt: attempt.claimedAt, attemptNumber: attempt.attemptNumber, state: "ATTEMPT_CLAIMED" };
  if (digestObject("DirectSemanticService.BootstrapAttempt.v1", unsigned) !== attempt.attemptDigest) dss02Fail("DSS02_ATTEMPT_DIGEST_MISMATCH");
  return attempt;
}

function verifyAuthorizationReceipt(receipt, commitment, attempt) {
  exactObject(receipt, ["schema", "authorizationRef", "profileRef", "commitmentRef", "attemptRef", "attemptDigest", "commitmentDigest", "daemonRevision", "protocolRevision", "descriptorPolicyDigest", "decision", "reasonCode", "authorizedAt", "authorizationDigest"], "DSS02_BOOTSTRAP_AUTHORIZATION_CLOSED");
  if (receipt.schema !== AUTHORIZATION_SCHEMA || receipt.profileRef !== commitment.profileRef || receipt.commitmentRef !== commitment.commitmentRef || receipt.attemptRef !== attempt.attemptRef || receipt.attemptDigest !== attempt.attemptDigest || receipt.commitmentDigest !== commitment.commitmentDigest) dss02Fail("DSS02_BOOTSTRAP_AUTHORIZATION_INVALID");
  const unsigned = { ...receipt };
  delete unsigned.authorizationDigest;
  if (digestObject("DirectSemanticService.BootstrapAuthorization.v1", unsigned) !== receipt.authorizationDigest) dss02Fail("DSS02_BOOTSTRAP_AUTHORIZATION_DIGEST_MISMATCH");
  return receipt;
}

function verifyBootstrapArtifacts({ installationRoot, profileRoot, commitmentRow = undefined, attemptRow = undefined, authorizationRow = undefined } = {}) {
  const root = verifyOwnerBootstrapRootPin({ installationRoot });
  if (root.status !== "PINNED") dss02Fail("DSS02_OWNER_ROOT_BROKEN");
  const paths = profileGenesisPaths(profileRoot);
  if (fs.existsSync(paths.pending)) dss02Fail("DSS02_BOOTSTRAP_PENDING_UNCONSUMED");
  if (!fs.existsSync(paths.attempt)) dss02Fail("DSS02_BOOTSTRAP_ATTEMPT_MISSING");
  const attempt = readJson(paths.attempt, "DSS02_ATTEMPT_UNREADABLE");
  const commitment = commitmentRow ? (typeof commitmentRow.payload_json === "string" ? parseJsonStrict(commitmentRow.payload_json) : commitmentRow) : null;
  if (!commitment) dss02Fail("DSS02_COMMITMENT_MISSING");
  verifyCommitmentAgainstRoot(commitment, root);
  verifyAttemptReceipt(attempt, commitment);
  if (attemptRow && (attemptRow.attempt_ref !== attempt.attemptRef || attemptRow.attempt_digest !== attempt.attemptDigest)) dss02Fail("DSS02_ATTEMPT_DIGEST_MISMATCH");
  if (authorizationRow) {
    const authorization = typeof authorizationRow.payload_json === "string" ? parseJsonStrict(authorizationRow.payload_json) : authorizationRow;
    verifyAuthorizationReceipt(authorization, commitment, attempt);
    if (authorizationRow.authorization_digest !== authorization.authorizationDigest) dss02Fail("DSS02_BOOTSTRAP_AUTHORIZATION_DIGEST_MISMATCH");
  }
  return { root, paths, commitment, attempt };
}

function claimBootstrapAttempt(profileRoot, now = undefined) {
  const pending = loadPendingCommitment(profileRoot);
  if (!pending) {
    if (fs.existsSync(profileGenesisPaths(profileRoot).attempt)) dss02Fail("DSS02_BOOTSTRAP_ALREADY_ATTEMPTED");
    dss02Fail("DSS02_COMMITMENT_MISSING");
  }
  const { commitment, paths } = pending;
  if (!commitment || commitment.maximumAttempts !== 1) dss02Fail("DSS02_COMMITMENT_INVALID");
  const attempt = {
    schema: ATTEMPT_SCHEMA,
    attemptRef: randomRef("bootstrap-attempt"),
    commitmentRef: commitment.commitmentRef,
    profileRef: commitment.profileRef,
    commitmentDigest: commitment.commitmentDigest,
    claimedAt: isoNow(now),
    attemptNumber: 1,
    state: "ATTEMPT_CLAIMED",
  };
  attempt.attemptDigest = digestObject("DirectSemanticService.BootstrapAttempt.v1", attempt);
  // The rename is the one-attempt linearization point.  If the process dies
  // before the receipt rewrite, recovery sees the claimed commitment at the
  // attempt path and blocks rather than guessing that bootstrap succeeded.
  try {
    fs.renameSync(paths.pending, paths.attempt);
    fsyncDirectory(paths.bootstrap);
    atomicWrite(paths.attempt, Buffer.from(canonicalJson(attempt), "utf8"), 0o600);
  } catch (error) {
    dss02Fail("DSS02_BOOTSTRAP_CLAIM_FAILED");
  }
  return Object.freeze({ attempt, commitment, paths });
}

function authorizeBootstrap({ profileRoot, installationRoot, profileRef = undefined, secret, descriptorProvenance, daemonRevision, protocolRevision, now = undefined } = {}) {
  const claimed = claimBootstrapAttempt(profileRoot, now);
  const root = verifyOwnerBootstrapRootPin({ installationRoot });
  const commitment = claimed.commitment;
  const attemptedAt = isoNow(now);
  let authorized = false;
  let reason = "DSS02_BOOTSTRAP_DENIED";
  try {
    if (root.status !== "PINNED") reason = "DSS02_OWNER_ROOT_BROKEN";
    else {
      try { verifyCommitmentAgainstRoot(commitment, root); }
      catch (error) { reason = error.code || "DSS02_COMMITMENT_INVALID"; }
      if (reason === "DSS02_BOOTSTRAP_DENIED" && profileRef !== undefined && commitment.profileRef !== profileRef) reason = "DSS02_BOOTSTRAP_PROFILE_MISMATCH";
      else if (reason === "DSS02_BOOTSTRAP_DENIED" && root.pin.ownerRootFingerprint !== commitment.ownerRootFingerprint) reason = "DSS02_OWNER_ROOT_MISMATCH";
      else if (reason === "DSS02_BOOTSTRAP_DENIED" && (commitment.expectedDaemonRevision !== daemonRevision || commitment.protocolRevision !== protocolRevision)) reason = "DSS02_BOOTSTRAP_REVISION_MISMATCH";
      else if (reason === "DSS02_BOOTSTRAP_DENIED" && isExpired(commitment.expiresAt, new Date(attemptedAt))) reason = "DSS02_COMMITMENT_EXPIRED";
      else if (reason === "DSS02_BOOTSTRAP_DENIED" && (descriptorProvenance === undefined || digestObject("DirectSemanticService.DescriptorPolicy.v1", descriptorProvenance) !== commitment.descriptorPolicyDigest)) reason = "DSS02_DESCRIPTOR_MISMATCH";
      else if (reason === "DSS02_BOOTSTRAP_DENIED") {
        const provided = typeof secret === "string" ? Buffer.from(secret, "base64url") : Buffer.from(secret || []);
        const salt = Buffer.from(commitment.salt, "base64url");
        const expected = Buffer.from(commitment.secretCommitment.slice(7), "hex");
        const actual = Buffer.from(digestBytes("DirectSemanticService.BootstrapSecret.v1", Buffer.concat([salt, Buffer.from(commitment.bootstrapNonce, "utf8"), provided])).slice(7), "hex");
        authorized = provided.length === 32 && crypto.timingSafeEqual(expected, actual);
        if (!authorized) reason = "DSS02_BOOTSTRAP_SECRET_MISMATCH";
      }
    }
  } catch (error) {
    authorized = false;
    reason = error.code || reason;
  }
  const receiptPayload = {
    schema: AUTHORIZATION_SCHEMA,
    authorizationRef: randomRef("bootstrap-authorization"),
    profileRef: commitment.profileRef,
    commitmentRef: commitment.commitmentRef,
    attemptRef: claimed.attempt.attemptRef,
    attemptDigest: claimed.attempt.attemptDigest,
    commitmentDigest: commitment.commitmentDigest,
    daemonRevision,
    protocolRevision,
    descriptorPolicyDigest: commitment.descriptorPolicyDigest,
    decision: authorized ? "AUTHORIZED_ONCE" : "DENIED_AND_BLOCKED",
    reasonCode: authorized ? null : reason,
    authorizedAt: attemptedAt,
  };
  receiptPayload.authorizationDigest = digestObject("DirectSemanticService.BootstrapAuthorization.v1", receiptPayload);
  const state = authorized ? "AUTHORIZED_ONCE" : "DENIED_AND_BLOCKED";
  const finalizedAttempt = { ...claimed.attempt, state: authorized ? "ATTEMPT_CLAIMED" : "BLOCKED", outcomeCode: authorized ? "AUTHORIZED_ONCE" : reason };
  atomicWrite(claimed.paths.attempt, Buffer.from(canonicalJson(finalizedAttempt), "utf8"), 0o600);
  return Object.freeze({ authorized, reason, commitment, attempt: finalizedAttempt, authorization: Object.freeze(receiptPayload) });
}

module.exports = {
  ROOT_PIN_SCHEMA,
  COMMITMENT_SCHEMA,
  ATTEMPT_SCHEMA,
  AUTHORIZATION_SCHEMA,
  ROOT_PIN_FILE,
  PENDING_FILE,
  ATTEMPT_FILE,
  installationPaths,
  profileGenesisPaths,
  installOwnerBootstrapTrustRoot,
  verifyOwnerBootstrapRootPin,
  readOwnerBootstrapRootPin: verifyOwnerBootstrapRootPin,
  provisionBootstrapCommitment,
  loadPendingCommitment,
  verifyCommitmentAgainstRoot,
  verifyAttemptReceipt,
  verifyAuthorizationReceipt,
  verifyBootstrapArtifacts,
  claimBootstrapAttempt,
  authorizeBootstrap,
};
