#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

// The host's custody checks are POSIX owner-only modes and uids, which
// Windows doesn't have; there the host refuses to provision (fails closed).
// Windows ACL custody would be a separate design.
if (process.platform === "win32") {
  console.log("SKIPPED: the semantic service host's custody model is POSIX-only (it refuses to start on Windows).");
  process.exit(77);
}
const hostScript = fileURLToPath(new URL("./direct-semantic-service-host.mjs", import.meta.url));
const root = fs.mkdtempSync(path.join(os.tmpdir(), "direct-host-regression-"));
const installationRoot = path.join(root, "installation");
const profileRoot = path.join(root, "profile");
const profileRef = "host-regression";
const configArgs = ["--installation-root", installationRoot, "--profile-root", profileRoot, "--profile-ref", profileRef];

function run(args, { timeout = 10_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [hostScript, ...args], { cwd: path.dirname(hostScript), stdio: ["ignore", "pipe", "pipe"] });
    let stdout = ""; let stderr = ""; const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error(`timeout: ${args.join(" ")}`)); }, timeout);
    child.stdout.on("data", (chunk) => { stdout += chunk; }); child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr }); });
  });
}
function startHost(configPath) {
  const child = spawn(process.execPath, [hostScript, "start", "--config", configPath], { cwd: path.dirname(hostScript), stdio: ["ignore", "pipe", "pipe"] });
  let stdout = ""; let stderr = "";
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`ready timeout ${stderr}`)), 10_000);
    child.stdout.on("data", (chunk) => { stdout += chunk; for (const line of stdout.split("\n").slice(-2)) { if (!line) continue; try { const value = JSON.parse(line); if (value.event === "READY") { clearTimeout(timer); resolve(value.status); } } catch (_) {} } });
    child.stderr.on("data", (chunk) => { stderr += chunk; }); child.once("error", reject);
  });
  return { child, ready, getOutput: () => ({ stdout, stderr }) };
}
function request(idempotencyKey) { return { schema: "direct_semantic_job_request@1", requestId: `host-${idempotencyKey}`, projectRef: "host-project", projectRegistryRevisionRef: "registry-1", targetORevision: "o-revision-1", targetSnapshotReceiptRef: "snapshot-1", compilerPinRef: "compiler-pin-1", requestedCompilationRef: "compilation-1", selectionMode: "partial_selection", edgeOccurrenceRefs: ["edge-1"], attemptPolicyRef: "attempt-policy-1", executionProfileRevisionRef: "execution-profile-1", deliveryProjectionRef: "projection-1", idempotencyKey }; }
async function main() {
  const init = await run(["init", ...configArgs]); assert.equal(init.code, 0, init.stderr); const provisioned = JSON.parse(init.stdout);
  const configStat = fs.statSync(provisioned.configPath); const taskStat = fs.statSync(provisioned.taskCredentialPath); assert.equal(configStat.mode & 0o077, 0); assert.equal(taskStat.mode & 0o077, 0);
  const duplicate = await run(["init", ...configArgs]); assert.notEqual(duplicate.code, 0); assert.equal(fs.existsSync(provisioned.configPath), true);
  const emptyRoot = path.join(root, "empty"); fs.mkdirSync(path.join(emptyRoot, "installation"), { recursive: true, mode: 0o755 }); fs.mkdirSync(path.join(emptyRoot, "profile"), { recursive: true, mode: 0o755 }); const emptyRetry = await run(["init", "--installation-root", path.join(emptyRoot, "installation"), "--profile-root", path.join(emptyRoot, "profile"), "--profile-ref", "empty"]) ; assert.notEqual(emptyRetry.code, 0); assert.equal(fs.statSync(path.join(emptyRoot, "installation")).mode & 0o077, 0o055); assert.equal(fs.statSync(path.join(emptyRoot, "profile")).mode & 0o077, 0o055);
  const symlinkRoot = path.join(root, "symlink"); fs.mkdirSync(symlinkRoot, { mode: 0o700 }); fs.symlinkSync(path.join(symlinkRoot, "missing-installation"), path.join(symlinkRoot, "installation")); const symlinkRetry = await run(["init", "--installation-root", path.join(symlinkRoot, "installation"), "--profile-root", path.join(symlinkRoot, "profile"), "--profile-ref", "symlink"]); assert.notEqual(symlinkRetry.code, 0);
  const first = startHost(provisioned.configPath); const firstStatus = await first.ready; assert.equal(firstStatus.ready, true);
  const duplicateHost = await run(["start", "--config", provisioned.configPath]); assert.notEqual(duplicateHost.code, 0); assert.match(duplicateHost.stderr, /DSS02_SECOND_WRITER/);
  const foreignRoot = path.join(root, "foreign"); fs.mkdirSync(foreignRoot, { mode: 0o700 }); const foreignInit = await run(["init", "--installation-root", path.join(foreignRoot, "installation"), "--profile-root", path.join(foreignRoot, "profile"), "--profile-ref", "foreign-host"]); assert.equal(foreignInit.code, 0, foreignInit.stderr); const foreign = JSON.parse(foreignInit.stdout);
  const requestPath = path.join(root, "request.json"); fs.writeFileSync(requestPath, JSON.stringify(request("restart-idempotency")), { mode: 0o600 });
  const submitted = await run(["client", "--config", provisioned.configPath, "submit", requestPath]); assert.equal(submitted.code, 0, submitted.stderr); const receipt = JSON.parse(submitted.stdout); assert.equal(receipt.schema, "direct_semantic_job_receipt@1");
  first.child.kill("SIGTERM"); const firstExit = await new Promise((resolve) => first.child.once("close", resolve)); assert.equal(firstExit, 0);
  const second = startHost(provisioned.configPath); const secondStatus = await second.ready; assert.equal(secondStatus.ready, true); const inspected = await run(["client", "--config", provisioned.configPath, "results", receipt.jobRef]); assert.equal(inspected.code, 0, inspected.stderr); const projection = JSON.parse(inspected.stdout); assert.equal(projection.jobRef, receipt.jobRef);
  const foreignCredential = await run(["client", "--config", provisioned.configPath, "--credential", foreign.taskCredentialPath, "results", receipt.jobRef]); assert.notEqual(foreignCredential.code, 0); assert.match(foreignCredential.stderr, /AUTH|UNAUTHORIZED|VERIFIER/);
  second.child.kill("SIGTERM"); await new Promise((resolve) => second.child.once("close", resolve));
  process.stdout.write(JSON.stringify({ suite: "direct-semantic-service-host", status: "passed", jobRef: receipt.jobRef, firstGeneration: firstStatus.daemonGeneration, secondGeneration: secondStatus.daemonGeneration, custody: "DSS02_ONLY" }) + "\n");
}
main().catch((error) => { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1; });
