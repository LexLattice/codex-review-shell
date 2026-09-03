#!/usr/bin/env node

/* Process/protocol boundary acceptance.  The regression script exercises the
 * in-process kernel; this gate proves the real Unix socket challenge/proof
 * exchange, request handling, closed responses, and one protected CLI path. */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import net from "node:net";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  installOwnerBootstrapTrustRoot,
  provisionBootstrapCommitment,
  DirectSemanticDaemon,
  Dss02Client,
  digestObject,
} = require("../src/main/direct/semantic-service");
const { runCli, waitTimeoutMilliseconds } = require("../src/main/direct/semantic-service/cli");

function request(id, idempotencyKey) {
  return {
    schema: "direct_semantic_job_request@1", requestId: id, projectRef: "acceptance-project",
    projectRegistryRevisionRef: "registry-1", targetORevision: "o-revision-1",
    targetSnapshotReceiptRef: "snapshot-1", compilerPinRef: "compiler-pin-1",
    requestedCompilationRef: "compilation-1", selectionMode: "partial_selection",
    edgeOccurrenceRefs: ["edge-1"], attemptPolicyRef: "attempt-policy-1",
    executionProfileRevisionRef: "execution-profile-1", deliveryProjectionRef: "projection-1",
    idempotencyKey,
  };
}

// The protocol endpoint is a Unix socket; keep the profile on a native Linux
// filesystem even when the workspace's OS temp directory is a mounted path.
const root = fs.mkdtempSync("/tmp/dss02-acceptance-");
const installationRoot = path.join(root, "installation");
const profileRoot = path.join(root, "profile");
installOwnerBootstrapTrustRoot({ installationRoot });
const genesis = provisionBootstrapCommitment({ installationRoot, profileRoot, profileRef: "acceptance-profile" });
const administrator = crypto.generateKeyPairSync("ed25519");
const daemon = new DirectSemanticDaemon({
  profileRoot,
  installationRoot,
  profileRef: "acceptance-profile",
  bootstrap: {
    secret: genesis.secret,
    descriptorProvenance: { kind: "owner_inherited_fd", revision: "descriptor-policy@1" },
    administratorPublicKey: administrator.publicKey,
  },
  listen: true,
});

let started;
let cliWaitElapsedMs = null;
try {
  started = await daemon.start({ listen: true });
  assert.equal(started.ready, true, `daemon must become ready: ${JSON.stringify(started)}`);
  assert.equal(fs.statSync(profileRoot).isDirectory(), true);
  assert.equal(started.schema, "direct_semantic_service_status@1");

  const adminVerifierRef = daemon.store.get("SELECT verifier_ref FROM verifiers ORDER BY issued_at LIMIT 1").verifier_ref;
  const userKeys = crypto.generateKeyPairSync("ed25519");
  const user = daemon.authority.issueCredential({
    actorVerifierRef: adminVerifierRef,
    principalId: "acceptance-user",
    subjectRef: "acceptance-user",
    publicKey: userKeys.publicKey,
    operations: ["submit", "inspect", "results", "subscribe", "acknowledge", "cancel"],
    purposeScopes: ["semantic-request", "read", "delivery"],
    objectScopes: ["*"],
  });
  const credential = { verifier: user.verifier, privateKey: userKeys.privateKey };
  const client = new Dss02Client({ profileRoot });
  const jobRequest = request("socket-request", "socket-idempotency");

  const submitted = await client.requestAuthorized({
    method: "submit",
    operation: "submit",
    params: { request: jobRequest },
    request: jobRequest,
    purposeScopes: ["semantic-request"],
    objectScopeDigest: digestObject("DirectSemanticService.ObjectScope.v1", { projectRef: jobRequest.projectRef }),
    credential,
  });
  assert.equal(submitted.schema, "direct_semantic_job_receipt@1");
  assert.equal(typeof submitted.jobRef, "string");
  assert.equal(Object.prototype.hasOwnProperty.call(submitted, "privateKey"), false);

  const inspected = await client.requestAuthorized({
    method: "inspect",
    operation: "inspect",
    params: { jobRef: submitted.jobRef, projectionRef: "projection-safe@1" },
    request: { jobRef: submitted.jobRef },
    purposeScopes: ["read"],
    objectScopeDigest: digestObject("DirectSemanticService.ObjectScope.v1", { jobRef: submitted.jobRef }),
    credential,
  });
  assert.equal(inspected.schema, "direct_semantic_authorized_safe_projection@1");
  assert.equal(inspected.jobRef, submitted.jobRef);
  assert.equal(inspected.operation, "durable-custody-only");
  assert.equal(Object.prototype.hasOwnProperty.call(inspected, "profileRoot"), false);

  const results = await client.requestAuthorized({
    method: "results",
    operation: "results",
    params: { jobRef: submitted.jobRef, projectionRef: "projection-safe@1" },
    request: { jobRef: submitted.jobRef },
    purposeScopes: ["read"],
    objectScopeDigest: digestObject("DirectSemanticService.ObjectScope.v1", { jobRef: submitted.jobRef }),
    credential,
  });
  assert.equal(results.schema, "direct_semantic_authorized_safe_projection@1");
  assert.equal(results.jobRef, submitted.jobRef);

  const status = await client.serviceStatus();
  assert.equal(status.schema, "direct_semantic_service_status@1");
  assert.equal(status.ready, true);
  assert.equal(status.recoveryState, "READY");
  await assert.rejects(client.request("unknown-method", {}), (error) => error?.code === "DSS02_PROTOCOL_UNKNOWN_METHOD");

  const requestPath = path.join(root, "cli-request.json");
  const credentialPath = path.join(root, "cli-credential.json");
  const cliRequest = request("cli-request", "cli-idempotency");
  fs.writeFileSync(requestPath, JSON.stringify(cliRequest));
  fs.writeFileSync(credentialPath, JSON.stringify({
    verifier: user.verifier,
    privateKeyDerBase64: userKeys.privateKey.export({ type: "pkcs8", format: "der" }).toString("base64"),
  }), { mode: 0o600 });
  fs.chmodSync(credentialPath, 0o600);
  const credentialStat = fs.lstatSync(credentialPath);
  assert.equal(credentialStat.isFile(), true);
  assert.equal(credentialStat.isSymbolicLink(), false);
  assert.equal(credentialStat.mode & 0o077, 0);
  assert.ok(credentialStat.size > 0 && credentialStat.size <= 64 * 1024);
  try {
    let cliOutput = "";
    let cliError = "";
    const cliExit = await runCli(["submit", requestPath, "--credential", credentialPath], {
      env: { ...process.env, DIRECT_SEMANTIC_PROFILE_ROOT: profileRoot },
      stdout: { write: (text) => { cliOutput += text; } },
      stderr: { write: (text) => { cliError += text; } },
    });
    assert.equal(cliExit, 0, cliError);
    const cliReceipt = JSON.parse(cliOutput);
    assert.equal(cliReceipt.schema, "direct_semantic_job_receipt@1");
    assert.equal(typeof cliReceipt.jobRef, "string");

    const runCliJson = async (args) => {
      let cliOutput = "";
      let cliError = "";
      const cliExit = await runCli([...args, "--credential", credentialPath], {
        env: { ...process.env, DIRECT_SEMANTIC_PROFILE_ROOT: profileRoot },
        stdout: { write: (text) => { cliOutput += text; } },
        stderr: { write: (text) => { cliError += text; } },
      });
      assert.equal(cliExit, 0, cliError);
      return JSON.parse(cliOutput);
    };
    const runCliUsage = async (args) => {
      let cliError = "";
      const cliExit = await runCli([...args, "--credential", credentialPath], {
        env: { ...process.env, DIRECT_SEMANTIC_PROFILE_ROOT: profileRoot },
        stdout: { write: () => {} },
        stderr: { write: (text) => { cliError += text; } },
      });
      assert.equal(cliExit, 2, cliError);
      assert.match(cliError, /DSS02_CLI_USAGE/);
    };
    const cliInspectDefault = await runCliJson(["inspect", submitted.jobRef]);
    const cliResultsDefault = await runCliJson(["results", submitted.jobRef]);
    const cliSubscribeDefault = await runCliJson(["subscribe", submitted.jobRef]);
    assert.equal(cliInspectDefault.projectionRef, "projection-safe@1");
    assert.equal(cliResultsDefault.projectionRef, "projection-safe@1");
    assert.equal(cliSubscribeDefault.returnProjectionRef, "projection-safe@1");
    const cliExplicitProjection = await runCliJson(["inspect", submitted.jobRef, "--projection", "projection-explicit@1"]);
    assert.equal(cliExplicitProjection.projectionRef, "projection-explicit@1");

    assert.equal(waitTimeoutMilliseconds("1"), 1_000);
    assert.equal(waitTimeoutMilliseconds("0"), 0);
    assert.equal(waitTimeoutMilliseconds(undefined), 30_000);
    await runCliUsage(["wait", submitted.jobRef, "--timeout", "-1"]);
    await runCliUsage(["wait", submitted.jobRef, "--timeout"]);
    const waitBaseline = await client.requestAuthorized({
      method: "inspect",
      operation: "inspect",
      params: { jobRef: submitted.jobRef, projectionRef: "projection-safe@1" },
      request: { jobRef: submitted.jobRef },
      purposeScopes: ["read"],
      objectScopeDigest: digestObject("DirectSemanticService.ObjectScope.v1", { jobRef: submitted.jobRef }),
      credential,
    });
    const waitAfterSequence = waitBaseline.currentCursor;
    const cancelRequest = {
      schema: "direct_semantic_cancel_request@1",
      requestId: "cli-wait-cancel",
      jobRef: submitted.jobRef,
      requestedCellRefs: [],
      boundedReason: "cli-wait-timing",
    };
    const cancelPromise = new Promise((resolve, reject) => setTimeout(() => client.requestAuthorized({
      method: "cancel",
      operation: "cancel",
      params: { request: cancelRequest },
      request: cancelRequest,
      purposeScopes: ["semantic-request"],
      objectScopeDigest: digestObject("DirectSemanticService.ObjectScope.v1", { jobRef: submitted.jobRef }),
      credential,
    }).then(resolve, reject), 50));
    const waitStartedAt = Date.now();
    const cliWaitTimed = await runCliJson(["wait", submitted.jobRef, "--after", String(waitAfterSequence), "--timeout", "1"]);
    const waitElapsedMs = Date.now() - waitStartedAt;
    cliWaitElapsedMs = waitElapsedMs;
    assert.ok(waitElapsedMs >= 30 && waitElapsedMs < 500, `CLI timeout=1 must be seconds, not milliseconds: ${waitElapsedMs}ms`);
    assert.equal(cliWaitTimed.schema, "direct_semantic_delivery_attempt@1");
    assert.equal(typeof cliWaitTimed.deliveryAttemptRef, "string");
    assert.equal(typeof cliWaitTimed.projectionDigest, "string");
    assert.ok(cliWaitTimed.lastEventSequence > waitAfterSequence, "CLI wait should wake on the cancellation event");
    await cancelPromise;
    const ack = await client.requestAuthorized({
      method: "ack",
      operation: "acknowledge",
      params: { deliveryAttemptRef: cliWaitTimed.deliveryAttemptRef, digest: cliWaitTimed.projectionDigest },
      request: { deliveryAttemptRef: cliWaitTimed.deliveryAttemptRef },
      purposeScopes: ["delivery"],
      objectScopeDigest: digestObject("DirectSemanticService.ObjectScope.v1", { deliveryAttemptRef: cliWaitTimed.deliveryAttemptRef }),
      credential,
    });
    assert.equal(ack.acknowledgedSequence, cliWaitTimed.lastEventSequence);
    const cliWaitZero = await runCliJson(["wait", submitted.jobRef, "--after", String(cliWaitTimed.lastEventSequence), "--timeout", "0"]);
    assert.equal(cliWaitZero.status, "NO_NEW_EVENTS");
    assert.equal(Object.prototype.hasOwnProperty.call(cliWaitZero, "deliveryAttemptRef"), false);
    assert.equal(cliWaitZero.cursor, cliWaitTimed.lastEventSequence);
  } finally {
    fs.unlinkSync(credentialPath);
  }
  assert.equal(fs.existsSync(credentialPath), false);
} finally {
  await daemon.close();
}

assert.equal(fs.existsSync(path.join(profileRoot, "direct-semanticd.generation.lock")), false);

async function withFakeSocketServer(socketPath, connectionHandler, action) {
  try { fs.unlinkSync(socketPath); } catch (_) {}
  const server = net.createServer(connectionHandler);
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(socketPath, resolve); });
  try { return await action(); }
  finally {
    await new Promise((resolve) => server.close(() => resolve()));
    try { fs.unlinkSync(socketPath); } catch (_) {}
  }
}

const protocolKeys = crypto.generateKeyPairSync("ed25519");
const protocolCredential = { verifier: { verifierRef: "fake-verifier" }, privateKey: protocolKeys.privateKey };
const protocolSocketPath = path.join(profileRoot, "direct-semanticd.sock");
const timeoutStartedAt = Date.now();
await withFakeSocketServer(protocolSocketPath, (socket) => socket.on("data", () => {}), async () => {
  const client = new Dss02Client({ profileRoot, timeoutMs: 80 });
  await assert.rejects(client.requestAuthorized({
    method: "inspect",
    operation: "inspect",
    params: { jobRef: "fake-job" },
    request: { jobRef: "fake-job" },
    purposeScopes: ["read"],
    objectScopeDigest: digestObject("DirectSemanticService.ObjectScope.v1", { jobRef: "fake-job" }),
    credential: protocolCredential,
  }), (error) => error?.code === "DSS02_PROTOCOL_TIMEOUT");
});
const timeoutElapsedMs = Date.now() - timeoutStartedAt;
assert.ok(timeoutElapsedMs >= 60 && timeoutElapsedMs < 1000, `authorized timeout must be prompt: ${timeoutElapsedMs}ms`);

const closeStartedAt = Date.now();
await withFakeSocketServer(protocolSocketPath, (socket) => socket.on("data", () => socket.end()), async () => {
  const client = new Dss02Client({ profileRoot, timeoutMs: 500 });
  await assert.rejects(client.requestAuthorized({
    method: "inspect",
    operation: "inspect",
    params: { jobRef: "fake-job" },
    request: { jobRef: "fake-job" },
    purposeScopes: ["read"],
    objectScopeDigest: digestObject("DirectSemanticService.ObjectScope.v1", { jobRef: "fake-job" }),
    credential: protocolCredential,
  }), (error) => error?.code === "DSS02_PROTOCOL_CONNECTION_CLOSED" && !error.message.includes("fake-verifier"));
});
const closeElapsedMs = Date.now() - closeStartedAt;
assert.ok(closeElapsedMs < 500, `authorized close rejection must be prompt: ${closeElapsedMs}ms`);

console.log(JSON.stringify({
  suite: "direct-semantic-service-dss02-acceptance",
  status: "passed",
  processBoundary: "unix-socket",
  protocol: "challenge-submit-inspect-results-status-closed-error-timeout-close-cleanup",
  protocolTiming: { timeoutElapsedMs, closeElapsedMs },
  cliTiming: { waitElapsedMs: cliWaitElapsedMs, timeoutOneMilliseconds: waitTimeoutMilliseconds("1") },
  cli: "credential-file-authorized-submit-inspect-results-subscribe-defaults-wait-seconds",
}));
