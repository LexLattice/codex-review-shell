#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { loadHostConfig } from "./direct-semantic-service-host.mjs";

const require = createRequire(import.meta.url);
const { DirectSemanticDaemon } = require("../src/main/direct/semantic-service/daemon");
const { deriveProfilePaths } = require("../src/main/direct/semantic-service/dss02-common");
const { objectDigest, sha256, requestFor } = require("../src/main/direct/semantic-service/commissioning-compiler");
const { admitWorkerResponse } = require("../src/main/direct/semantic-service/commissioning-coordinator");
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entry = path.join(repo, "scripts/direct-semantic-service-commission.mjs");
const resource = path.join(repo, "src/main/direct/semantic-service/resources");
const argument = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const compilerRoot = argument("--compiler-root") || process.env.DIRECT_SEMANTIC_COMPILER_ROOT;
if (!compilerRoot) throw new Error("Provide --compiler-root or DIRECT_SEMANTIC_COMPILER_ROOT for the actual installed compiler.");
const providerAuthRoot = argument("--provider-auth-root");
const providerAuthFile = argument("--provider-auth-file");
const liveProvider = Boolean(providerAuthRoot || providerAuthFile);
if (liveProvider && !process.argv.includes("--allow-live")) throw new Error("Live provider acceptance requires --allow-live.");
const root = fs.mkdtempSync("/tmp/direct-commissioning-acceptance-");
const installationRoot = path.join(root, "installation");
const profileRoot = path.join(root, "profile");
const configPath = path.join(profileRoot, "host", "host-config.json");
const outcomePath = argument("--output") || path.join(root, "acceptance.json");
const oracleBytes = fs.readFileSync(path.join(resource, "commissioning-s14-chain-oracle.json"));
const oracle = JSON.parse(oracleBytes);
// Seal the external expected outcomes before installation or any worker run.
const report = { schema: "direct_commissioning_acceptance@1", oracleDigest: sha256(oracleBytes), oracleSealedAt: new Date().toISOString(), backend: liveProvider ? "codex-responses-sol-max" : "deterministic", profileRoot, cases: [], boundaries: {}, authorityEffect: "none" };
fs.writeFileSync(path.join(root, "preadjudication.json"), JSON.stringify({ ...report, oracle }), { mode: 0o600 });
let host = null;

async function command(args, { allowFailure = false, maximumMs = 30_000 } = {}) {
  const child = spawn(process.execPath, [entry, ...args], { cwd: repo, env: { PATH: "/usr/bin:/bin", LC_ALL: "C.UTF-8", NODE_NO_WARNINGS: "1" }, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = ""; let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; }); child.stderr.on("data", (chunk) => { stderr += chunk; });
  const timer = setTimeout(() => child.kill("SIGKILL"), maximumMs);
  const result = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", (code, signal) => resolve({ code, signal, stdout, stderr, pid: child.pid })); });
  clearTimeout(timer);
  if (!allowFailure) assert.equal(result.code, 0, `${args[0]} failed: ${stderr}`);
  const lines = stdout.trim().split("\n").filter(Boolean);
  if (lines.length === 1) { try { result.value = JSON.parse(lines[0]); } catch (_) {} }
  return result;
}

async function start({ onPhase = undefined, expectedFailure = undefined } = {}) {
  const child = spawn(process.execPath, [entry, "start", "--config", configPath, "--progress", "true"], { cwd: repo, env: { PATH: "/usr/bin:/bin", NODE_NO_WARNINGS: "1" }, stdio: ["ignore", "pipe", "pipe"] });
  let buffer = ""; let stderr = ""; let settled = false;
  const closed = new Promise((resolve) => child.once("close", (code, signal) => resolve({ code, signal })));
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("Host readiness deadline")); }, 10_000);
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      let index;
      while ((index = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
        let event; try { event = JSON.parse(line); } catch (_) { continue; }
        if (event.event === "READY") { settled = true; clearTimeout(timer); resolve(event); }
        if (event.event === "PHASE") onPhase?.(event, child);
      }
    });
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("close", () => { clearTimeout(timer); if (!settled) { if (expectedFailure && stderr.includes(expectedFailure)) resolve({ failedAsExpected: true, stderr }); else reject(new Error(`Host exited before readiness: ${stderr}`)); } });
  });
  const event = await ready;
  return { child, closed, event };
}

async function stop(signal = "SIGTERM") {
  if (!host) return;
  const current = host; host = null;
  current.child.kill(signal);
  const deadline = setTimeout(() => current.child.kill("SIGKILL"), 5000);
  const result = await current.closed;
  clearTimeout(deadline);
  if (signal === "SIGTERM") assert.equal(result.code, 0, "Host closes normally");
}

const client = (args, settings) => command(["client", "--config", configPath, ...args], settings);
async function terminal(jobRef) {
  const subscription = (await client(["subscribe", jobRef])).value;
  let cursor = subscription.currentCursor;
  const deadline = Date.now() + (liveProvider ? 700_000 : 30_000);
  while (Date.now() < deadline) {
    const result = (await client(["results", jobRef])).value;
    if (result.status === "TERMINAL") return result;
    const waited = (await client(["wait", jobRef, "--after", String(cursor), "--timeout", "2"])).value;
    cursor = waited.currentCursor;
  }
  throw new Error(`No terminal result for ${jobRef}`);
}

function readStored(jobRef) {
  const databasePath = deriveProfilePaths(profileRoot).database;
  // The harness inspects custody only while the daemon is stopped.
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const row = db.prepare("SELECT r.envelope_json FROM commissioning_heads h JOIN commissioning_records r ON r.record_ref=h.record_ref WHERE h.job_ref=?").get(jobRef);
    const state = JSON.parse(row.envelope_json).body;
    const object = (ref) => JSON.parse(Buffer.from(db.prepare("SELECT bytes_base64 FROM commissioning_objects WHERE object_ref=?").get(ref).bytes_base64, "base64"));
    const history = db.prepare("SELECT envelope_json FROM commissioning_records WHERE kind='JOB' AND job_ref=? ORDER BY sequence").all(jobRef).map((row) => JSON.parse(row.envelope_json).body);
    return { state, history, page: state.pageRef ? object(state.pageRef) : null, observation: state.workerObservationRef ? object(state.workerObservationRef) : null, compilerObservation: state.compilerObservationRef ? object(state.compilerObservationRef) : null, databasePath };
  } finally { db.close(); }
}

try {
  const initialized = (await command(["init", "--installation-root", installationRoot, "--profile-root", profileRoot, "--profile-ref", "commissioning-acceptance", "--compiler-root", compilerRoot, ...(providerAuthRoot ? ["--provider-auth-root", providerAuthRoot] : []), ...(providerAuthFile ? ["--provider-auth-file", providerAuthFile] : [])])).value;
  const pack = JSON.parse(fs.readFileSync(path.join(profileRoot, "host", "commissioning-pack.json")));
  report.packDigest = pack.packDigest;
  // A second current, correctly signed principal is a stronger scope witness
  // than an unknown credential or an invalid signature.
  const config = loadHostConfig(configPath);
  const base = new DirectSemanticDaemon({ profileRoot, installationRoot, profileRef: config.profileRef });
  const foreignPath = path.join(root, "foreign-credential.json");
  try {
    assert.equal(base.start().ready, true);
    const administrator = JSON.parse(fs.readFileSync(config.administratorCredentialPath));
    const keys = crypto.generateKeyPairSync("ed25519");
    const foreign = base.authority.issueCredential({ actorVerifierRef: administrator.verifier.verifierRef, principalId: "foreign-commissioning-principal", subjectRef: "foreign-task", publicKey: keys.publicKey, operations: ["submit", "inspect", "results", "subscribe", "acknowledge"], purposeScopes: ["semantic-request", "read", "delivery"], objectScopes: ["*"] });
    fs.writeFileSync(foreignPath, JSON.stringify({ verifier: foreign.verifier, privateKeyDerBase64: keys.privateKey.export({ type: "pkcs8", format: "der" }).toString("base64") }), { mode: 0o600 });
  } finally { await base.close(); }

  host = await start();
  const firstHostPid = host.child.pid;
  const receipts = [];
  for (const row of initialized.requests) {
    const submitted = await client(["submit", row.requestFile]);
    receipts.push({ ...row, jobRef: submitted.value.jobRef, submittingProcessPid: submitted.pid, submittingProcessExited: submitted.code === 0 });
  }
  for (const row of receipts) {
    const result = await terminal(row.jobRef);
    const expected = oracle.cases.find((expected) => expected.snapshotRef === row.snapshotRef);
    assert.ok(expected, "Every worker case has a sealed independent expected outcome");
    assert.equal(result.projection.disposition.disposition, expected.disposition, `${row.snapshotRef}: ${JSON.stringify(result.projection.disposition)}`);
    assert.equal(result.projection.disposition.reasonCode, expected.reasonCode, row.snapshotRef);
    assert.equal(result.projection.disposition.admission, "ADMITTED_ADVISORY");
    assert.equal(result.projection.disposition.proofStatus, "UNPROVEN");
    assert.equal(result.projection.authorityEffect, "none");
    assert.equal(objectDigest(result.projection), result.delivery.projectionDigest);
    report.cases.push({ ...row, expected: expected.disposition, actual: result.projection.disposition.disposition, reasonCode: expected.reasonCode, projectionDigest: result.delivery.projectionDigest });
    row.result = result;
  }
  const first = receipts[0];
  const replay = (await client(["submit", first.requestFile])).value;
  assert.equal(replay.jobRef, first.jobRef);
  assert.equal(replay.replay, true);
  const originalRequest = JSON.parse(fs.readFileSync(first.requestFile));
  const conflictPath = path.join(root, "conflict-request.json");
  fs.writeFileSync(conflictPath, JSON.stringify({ ...originalRequest, requestId: "different-request-same-idempotency" }));
  const conflict = await client(["submit", conflictPath], { allowFailure: true });
  assert.match(conflict.stderr, /DSS02_IDEMPOTENCY_CONFLICT/);
  const driftPath = path.join(root, "drift-request.json");
  fs.writeFileSync(driftPath, JSON.stringify({ ...originalRequest, compilerPinRef: "compiler:uninstalled" }));
  assert.match((await client(["submit", driftPath], { allowFailure: true })).stderr, /COMMISSIONING_REQUEST_PIN_MISMATCH/);
  const foreignRead = await command(["client", "--config", configPath, "--credential", foreignPath, "results", first.jobRef], { allowFailure: true });
  assert.match(foreignRead.stderr, /COMMISSIONING_READ_SCOPE/);
  const foreignAck = await command(["client", "--config", configPath, "--credential", foreignPath, "ack", first.result.delivery.deliveryAttemptRef, "--digest", first.result.delivery.projectionDigest], { allowFailure: true });
  assert.match(foreignAck.stderr, /COMMISSIONING_ACK_SCOPE/);
  report.boundaries.authenticatedIsolation = "PASS";
  report.boundaries.replayConflictAndPins = "PASS";

  await stop();
  const stored = readStored(first.jobRef);
  assert.equal(stored.compilerObservation.status, "CAPTURED");
  assert.equal(stored.compilerObservation.isolation.status, "OBSERVED");
  assert.equal(stored.observation.status, "CAPTURED");
  if (liveProvider) {
    assert.equal(stored.observation.isolation.kind, "remote_closed_request");
    assert.equal(stored.observation.isolation.exactRequestBound, true);
    assert.equal(stored.observation.requestCount, 1);
  } else assert.equal(stored.observation.isolation.network, "OBSERVED_UNSHARED");
  const persistedRawIndex = stored.history.findIndex((state) => state.status === "RAW_CAPTURED");
  const terminalIndex = stored.history.findIndex((state) => state.status === "TERMINAL");
  assert.ok(persistedRawIndex >= 0 && persistedRawIndex < terminalIndex, "Raw custody precedes canonical admission");
  assert.equal(stored.history.filter((state, index, history) => state.status === "WORKER_STARTED" && history[index - 1]?.status !== "WORKER_STARTED").length, 1);
  assert.equal(Object.hasOwn(stored.page, "expected"), false);
  assert.equal(JSON.stringify(stored.page).includes(first.snapshotRef), false, "Case labels do not reach the worker");
  const malformed = admitWorkerResponse({ pack, page: stored.page, attemptRef: stored.state.attemptRef, observation: { ...stored.observation, stdoutBase64: Buffer.from("{malformed").toString("base64") } });
  assert.equal(malformed.admission, "REJECTED");
  assert.equal(malformed.reasonCode, "WORKER_MALFORMED_RESPONSE");
  const foreign = JSON.parse(Buffer.from(stored.observation.stdoutBase64, "base64")); foreign.attemptRef = "foreign-attempt";
  const wrongBinding = admitWorkerResponse({ pack, page: stored.page, attemptRef: stored.state.attemptRef, observation: { ...stored.observation, stdoutBase64: Buffer.from(JSON.stringify(foreign)).toString("base64") } });
  assert.equal(wrongBinding.admission, "REJECTED");
  assert.equal(wrongBinding.reasonCode, "WORKER_RESPONSE_BINDING_REJECTED");
  report.boundaries.quarantineAndAdmission = { status: "PASS", malformed: malformed.reasonCode, foreignAttempt: wrongBinding.reasonCode };

  host = await start();
  assert.notEqual(host.child.pid, firstHostPid);
  const afterRestart = (await client(["results", first.jobRef])).value;
  assert.deepEqual(afterRestart.projection, first.result.projection);
  assert.deepEqual(afterRestart.delivery, first.result.delivery);
  const wrongDigest = await client(["ack", afterRestart.delivery.deliveryAttemptRef, "--digest", "sha256:" + "0".repeat(64)], { allowFailure: true });
  assert.match(wrongDigest.stderr, /COMMISSIONING_ACK_DIGEST_MISMATCH/);
  const ack = (await client(["ack", afterRestart.delivery.deliveryAttemptRef, "--digest", afterRestart.delivery.projectionDigest])).value;
  const ackReplay = (await client(["ack", afterRestart.delivery.deliveryAttemptRef, "--digest", afterRestart.delivery.projectionDigest])).value;
  assert.equal(ack.state, "ACKNOWLEDGED"); assert.deepEqual(ackReplay, ack);
  report.boundaries.restartDelivery = { status: "PASS", firstHostPid, secondHostPid: host.child.pid, exactProjectionDigest: afterRestart.delivery.projectionDigest, acknowledgment: ack };
  await stop();

  // Kill the actual daemon after its committed STARTED telemetry. This does
  // not inject a fake process outcome or a test-only service execution path.
  let crashEvent;
  host = await start({ onPhase: (event, child) => { if (!crashEvent && event.phase === "COMPILER_STARTED") { crashEvent = event; child.kill("SIGKILL"); } } });
  const crashPid = host.child.pid;
  const crashRequest = requestFor(pack, { snapshotRef: pack.snapshots[0].snapshotRef, requestId: "crash-request", idempotencyKey: "crash-idempotency" });
  const crashFile = path.join(root, "crash-request.json"); fs.writeFileSync(crashFile, JSON.stringify(crashRequest));
  const crashSubmit = await client(["submit", crashFile], { allowFailure: true });
  const crashDeadline = setTimeout(() => host?.child.kill("SIGTERM"), 10_000);
  const crashClosed = await host.closed; host = null;
  clearTimeout(crashDeadline);
  assert.ok(crashEvent, "A real committed compiler-start boundary was observed before killing the daemon");
  assert.equal(crashClosed.signal, "SIGKILL");
  host = await start();
  const recovered = await terminal(crashEvent.jobRef);
  assert.equal(recovered.projection.disposition.disposition, "REMANDS");
  assert.equal(recovered.projection.disposition.reasonCode, "PROCESS_INTERRUPTED_WITHOUT_DURABLE_OUTPUT");
  assert.equal(recovered.projection.attemptOrdinal, 1);
  report.boundaries.interruptedAttempt = { status: "PASS", crashPid, restartPid: host.child.pid, phase: crashEvent.phase, jobRef: crashEvent.jobRef, submitProcessExit: crashSubmit.code, disposition: recovered.projection.disposition };
  await stop();
  const crashStored = readStored(crashEvent.jobRef);
  assert.equal(crashStored.history.filter((state, index, history) => state.status === "COMPILER_STARTED" && history[index - 1]?.status !== "COMPILER_STARTED").length, 1, "Restart must not silently retry the dispatched attempt");
  assert.equal(crashStored.history.some((state) => state.status === "WORKER_STARTED"), false);
  assert.equal(readStored(first.jobRef).state.delivery.state, "ACKNOWLEDGED");

  // Retained bad bytes must block reopening. This mutation is solely to the
  // disposable test profile after all healthy restart witnesses have closed.
  const corrupt = new DatabaseSync(stored.databasePath);
  corrupt.prepare("UPDATE commissioning_objects SET bytes_base64=? WHERE object_ref=?").run(Buffer.from("{}").toString("base64"), stored.state.workerObservationRef);
  corrupt.close();
  host = await start({ expectedFailure: "COMMISSIONING_OBJECT_CORRUPT" });
  assert.equal(host.event.failedAsExpected, true);
  await host.closed; host = null;
  report.boundaries.corruptionBlocksRecovery = "PASS";
  report.status = "PASS";
  report.completedAt = new Date().toISOString();
  fs.writeFileSync(outcomePath, JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
  console.log(JSON.stringify({ suite: "direct-semantic-service-commissioning", status: "PASS", finiteCases: report.cases.length, admissionNegativeCases: 2, artifact: outcomePath, profileRoot, advisoryOnly: true }));
} catch (error) {
  report.status = "FAIL"; report.error = String(error.stack || error);
  fs.writeFileSync(outcomePath, JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
  throw error;
} finally { await stop(); }
