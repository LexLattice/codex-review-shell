#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { createRequire } from "node:module";

import { initializeCommissioning } from "./direct-semantic-service-commission.mjs";
import { loadHostConfig } from "./direct-semantic-service-host.mjs";

const require = createRequire(import.meta.url);
const { DirectSemanticDaemon } = require("../src/main/direct/semantic-service/daemon");
const { CommissioningDaemon } = require("../src/main/direct/semantic-service/commissioning-daemon");
const { CommissioningCoordinator } = require("../src/main/direct/semantic-service/commissioning-coordinator");
const { requestFor, runCompiler, materializePage, objectDigest } = require("../src/main/direct/semantic-service/commissioning-compiler");
const { runClosedPage } = require("../src/main/direct/semantic-service/commissioning-process");
const { digestObject } = require("../src/main/direct/semantic-service/dss02-common");
const { createAuthorizationProof } = require("../src/main/direct/semantic-service/authority-store");

const compilerFlag = process.argv.indexOf("--compiler-root");
const compilerRoot = (compilerFlag >= 0 ? process.argv[compilerFlag + 1] : undefined) || process.argv[2] || process.env.DIRECT_SEMANTIC_COMPILER_ROOT;
if (!compilerRoot) throw new Error("Provide the installed compiler root as argv[2] or DIRECT_SEMANTIC_COMPILER_ROOT");
const casesFile = path.resolve(new URL("../src/main/direct/semantic-service/resources/commissioning-s14-chain-cases.json", import.meta.url).pathname);

function readCredential(config) {
  const value = JSON.parse(fs.readFileSync(config.taskCredentialPath, "utf8"));
  return { verifier: value.verifier, privateKey: crypto.createPrivateKey({ key: Buffer.from(value.privateKeyDerBase64, "base64"), type: "pkcs8", format: "der" }) };
}
function authorize(daemon, credential, operation, request, objectScopeDigest) {
  const connectionRef = `recovery-${operation}-${crypto.randomBytes(8).toString("hex")}`;
  const transport = daemon.observeTransportPeer({ connectionRef });
  const challenge = daemon.authority.issueAuthorizationChallenge({ connectionRef, transportObservation: transport });
  const requestDigest = operation === "submit" ? digestObject("DirectSemanticService.SemanticJobRequest.v1", request) : digestObject("DirectSemanticService.SemanticRequestBoundary.v1", request);
  const proof = createAuthorizationProof({ challenge, requestDigest, operation, purposeScopes: operation === "submit" ? ["semantic-request"] : ["read", "delivery"], objectScopeDigest, verifier: credential.verifier, privateKey: credential.privateKey, registryRevisionSet: [] });
  const resolved = daemon.authority.resolveDaemonCredential({ connectionRef, transportObservation: transport, challengeRef: challenge.challengeRef, proof, requestDigest, operation, purposeScopes: operation === "submit" ? ["semantic-request"] : ["read", "delivery"], objectScopeDigest, registryRevisionSet: [] });
  return { ...resolved.receipt, principalRef: resolved.principal.principalRef, verifierRef: resolved.verifier.verifierRef, operation, decision: resolved.receipt.decision };
}
async function closeDaemon(daemon) { await daemon?.close(); }
async function waitForTerminal(coordinator, jobRef) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) { const state = coordinator.state(jobRef); if (state?.status === "TERMINAL") return state; await new Promise((resolve) => setTimeout(resolve, 25)); }
  throw new Error(`terminal recovery deadline: ${jobRef}`);
}
async function install(root, ref) {
  return initializeCommissioning({ installationRoot: path.join(root, "installation"), profileRoot: path.join(root, "profile"), profileRef: ref, compilerRoot, casesFile });
}

let activeDaemon = null;

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "direct-commissioning-recovery-"));
  const initialized = await install(root, "recovery-regression");
  const config = loadHostConfig(initialized.configPath);
  const pack = JSON.parse(fs.readFileSync(path.join(config.profileRoot, "host", "commissioning-pack.json"), "utf8"));
  const credential = readCredential(config);
  const request = requestFor(pack, { snapshotRef: pack.snapshots[0].snapshotRef, requestId: "recovery-outbox", idempotencyKey: "recovery-outbox" });

  // Submit through the ordinary durable DSS02 daemon with no coordinator open.
  // A later coordinator open must reconstruct this admission from jobs and its
  // authenticated authorization receipt.
  let daemon = new DirectSemanticDaemon({ profileRoot: config.profileRoot, installationRoot: config.installationRoot, profileRef: config.profileRef });
  activeDaemon = daemon;
  assert.equal(daemon.start().ready, true);
  const submitReceipt = daemon.submit({ request, authorizationReceipt: authorize(daemon, credential, "submit", request, digestObject("DirectSemanticService.ObjectScope.v1", { projectRef: request.projectRef })) });
  const outboxJobRef = submitReceipt.jobRef;
  await closeDaemon(daemon); daemon = null; activeDaemon = null;
  daemon = new CommissioningDaemon({ profileRoot: config.profileRoot, installationRoot: config.installationRoot, profileRef: config.profileRef, pack });
  activeDaemon = daemon;
  assert.equal((await daemon.start({ listen: false })).ready, true);
  const reconstructed = daemon.coordinator.state(outboxJobRef);
  assert.equal(reconstructed.status, "QUEUED");
  daemon.coordinator.schedule();
  const completedOutbox = await waitForTerminal(daemon.coordinator, outboxJobRef);
  assert.equal(completedOutbox.attemptOrdinal, 1);
  await closeDaemon(daemon); daemon = null; activeDaemon = null;

  // Build a genuine RAW_CAPTURED state with the installed compiler and real
  // closed-page worker, then stop before canonical admission. Reopen must
  // finish from RAW_CAPTURED without launching another worker.
  daemon = new DirectSemanticDaemon({ profileRoot: config.profileRoot, installationRoot: config.installationRoot, profileRef: config.profileRef });
  activeDaemon = daemon;
  assert.equal(daemon.start().ready, true);
  const rawRequest = requestFor(pack, { snapshotRef: pack.snapshots[0].snapshotRef, requestId: "recovery-raw", idempotencyKey: "recovery-raw" });
  const rawReceipt = daemon.submit({ request: rawRequest, authorizationReceipt: authorize(daemon, credential, "submit", rawRequest, digestObject("DirectSemanticService.ObjectScope.v1", { projectRef: rawRequest.projectRef })) });
  const coordinator = new CommissioningCoordinator({ daemon, pack }).open();
  let state = coordinator.state(rawReceipt.jobRef);
  const handoffDigest = coordinator.handoff(state);
  state = coordinator.transition(state, "COMPILER_STARTED", { handoffDigest, attemptOrdinal: 1, startedGeneration: daemon.generation.generationRef });
  const compilerObservation = await runCompiler(pack);
  state = coordinator.transition(coordinator.state(state.jobRef), "COMPILER_CAPTURED", {}, { compilerObservationRef: compilerObservation });
  const materialized = materializePage(pack, pack.snapshots.find((snapshot) => snapshot.snapshotRef === state.snapshotRef), compilerObservation);
  state = coordinator.transition(coordinator.state(state.jobRef), "PAGE_MATERIALIZED", { pageDigest: materialized.pageDigest, compilationDigest: materialized.compilationDigest, fullObligationCount: materialized.fullObligationCount, selectedObligationCount: materialized.selectedObligationCount }, { pageRef: materialized.page });
  state = coordinator.transition(coordinator.state(state.jobRef), "WORKER_STARTED");
  const workerObservation = await runClosedPage({ attemptRef: state.attemptRef, page: coordinator.object(state.pageRef), timeoutMs: pack.attemptPolicy.workerTimeoutMs, maximumOutputBytes: pack.attemptPolicy.maximumRawBytes });
  state = coordinator.transition(coordinator.state(state.jobRef), "RAW_CAPTURED", {}, { workerObservationRef: workerObservation });
  assert.equal(state.status, "RAW_CAPTURED");
  await closeDaemon(daemon);

  daemon = new CommissioningDaemon({ profileRoot: config.profileRoot, installationRoot: config.installationRoot, profileRef: config.profileRef, pack });
  activeDaemon = daemon;
  assert.equal((await daemon.start({ listen: false })).ready, true);
  daemon.coordinator.schedule();
  const recoveredRaw = await waitForTerminal(daemon.coordinator, rawReceipt.jobRef);
  assert.equal(recoveredRaw.disposition.admission, "ADMITTED_ADVISORY");
  assert.equal(daemon.coordinator.state(rawReceipt.jobRef).attemptOrdinal, 1);
  assert.equal(daemon.coordinator.store.all("SELECT * FROM commissioning_records WHERE job_ref=? AND kind='JOB'", rawReceipt.jobRef).filter((row) => JSON.parse(row.envelope_json).body.status === "WORKER_STARTED").length, 1);

  // The ordinary daemon waiter owns a transport connection. Disconnecting it
  // must reject the waiter and release both the map entry and capacity token.
  const waitReceipt = authorize(daemon, credential, "subscribe", { jobRef: rawReceipt.jobRef }, digestObject("DirectSemanticService.ObjectScope.v1", { jobRef: rawReceipt.jobRef }));
  const subscription = daemon.subscribe({ jobRef: rawReceipt.jobRef, authorizationReceipt: waitReceipt, returnProjectionRef: "projection-safe@1" });
  const connectionRef = "recovery-disconnect-waiter";
  const waiting = daemon.wait({ jobRef: rawReceipt.jobRef, subscriptionRef: subscription.subscriptionRef, authorizationReceipt: waitReceipt, afterSequence: 999999, timeoutMs: 5000, connectionRef });
  daemon.disconnectTransport(connectionRef);
  await assert.rejects(waiting, (error) => error?.code === "DSS02_CONNECTION_CLOSED");
  assert.equal(daemon.waiters.size, 0);
  assert.equal(daemon.waiterGate.active.size, 0);
  const commissioningSubscription = daemon.subscribe({ jobRef: rawReceipt.jobRef, authorizationReceipt: waitReceipt, returnProjectionRef: "commissioning-projection-v1" });
  const commissioningWaiting = daemon.wait({ jobRef: rawReceipt.jobRef, subscriptionRef: commissioningSubscription.subscriptionRef, authorizationReceipt: waitReceipt, afterSequence: commissioningSubscription.currentCursor, timeoutMs: 5000, connectionRef: "commissioning-disconnect" });
  assert.equal(daemon.commissioningWaiters.size, 1);
  daemon.disconnectTransport("commissioning-disconnect");
  await assert.rejects(commissioningWaiting, (error) => error?.code === "COMMISSIONING_HOST_CLOSED");
  const commissioningWaitersAfterClose = daemon.commissioningWaiters.size; await daemon.close(); daemon = null; activeDaemon = null;
  assert.equal(commissioningWaitersAfterClose, 0);
  process.stdout.write(JSON.stringify({ suite: "direct-semantic-service-commissioning-recovery", status: "passed", compilerRoot, outbox: { jobRef: outboxJobRef, reconstructed: reconstructed.status, terminal: completedOutbox.status }, rawCaptured: { jobRef: rawReceipt.jobRef, recovered: recoveredRaw.status, attemptOrdinal: recoveredRaw.attemptOrdinal }, waiterDisconnect: "PASS", commissioningWaiterLifecycle: { status: "PASS", before: 1, after: commissioningWaitersAfterClose, reason: "COMMISSIONING_HOST_CLOSED" }, custody: "DSS02_DURABLE_COMMISSIONING_ONLY", authorityEffect: "none" }) + "\n");
}
main().catch(async (error) => { try { await activeDaemon?.close(); } catch (_) {} process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1; });
