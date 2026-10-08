"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { canonicalJson } = require("./dss02-common");

const SCHEMA = "direct_commissioning_process_observation@1";
const PAGE_SCHEMA = "direct_commissioning_chain_page@1";
const WORKER_PATH = path.join(__dirname, "resources", "commissioning-chain-worker.cjs");
const BWRAP = "/usr/bin/bwrap";
const NODE = "/usr/bin/node";
const MAX_TIMEOUT = 60_000;
const DEFAULT_MAX_OUTPUT = 65_536;
const MAX_INPUT_BYTES = 1024 * 1024;
const MAX_NODES = 4096;
const MAX_ALTERNATIVES = 256;
const MAX_OBLIGATIONS = 1024;

function sha256(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8");
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function pageBytes(page) { return Buffer.from(canonicalJson(page), "utf8"); }

function validString(value, max = 4096) { return typeof value === "string" && value.length > 0 && value.length <= max && value.trim() === value; }
function validDigest(value) { return typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value); }
function exactObject(value, fields) { return value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).sort().join("\0") === [...fields].sort().join("\0"); }
function validPage(page) {
  const top = ["schema", "pageRef", "compilationDigest", "obligationIds", "law", "evidence"];
  if (!exactObject(page, top) || page.schema !== PAGE_SCHEMA || !validString(page.pageRef) || !validDigest(page.compilationDigest) || !Array.isArray(page.obligationIds) || page.obligationIds.some((v) => !validString(v, 256)) || new Set(page.obligationIds).size !== page.obligationIds.length) return false;
  if (!exactObject(page.law, ["family", "revision", "predicate"]) || page.law.family !== "s14-m2-chain-contiguity" || page.law.revision !== "commissioning@1" || !validString(page.law.predicate, 4096)) return false;
  const e = page.evidence;
  if (!exactObject(e, ["entityRef", "genesisRef", "currentRevision", "snapshotRevision", "complete", "lineageAvailable", "nodes", "alternatives"]) || !validString(e.entityRef, 512) || !validString(e.genesisRef, 512) || !validString(e.currentRevision, 512) || !validString(e.snapshotRevision, 512) || typeof e.complete !== "boolean" || typeof e.lineageAvailable !== "boolean" || !Array.isArray(e.nodes) || !Array.isArray(e.alternatives) || e.alternatives.some((v) => !validString(v, 1024))) return false;
  const fields = ["bindingRef", "entityRef", "predecessorRef", "beforeRef", "afterRef", "ordinal"];
  return e.nodes.every((n) => exactObject(n, fields) && validString(n.bindingRef, 512) && validString(n.entityRef, 512) && (n.predecessorRef === null || validString(n.predecessorRef, 512)) && validString(n.beforeRef, 512) && validString(n.afterRef, 512) && Number.isSafeInteger(n.ordinal) && n.ordinal >= 0);
}

function resultBase(input, pageDigest, workerDigest, startedAt, completedAt, status, reasonCode, exitCode, signal, stdout, stderr, isolation) {
  return { schema: SCHEMA, attemptRef: input.attemptRef, pageDigest, workerDigest, status, reasonCode, exitCode, signal, stdoutBase64: stdout.toString("base64"), stderrBase64: stderr.toString("base64"), startedAt, completedAt, isolation };
}

function isolationNotObserved() {
  const fileDigest = (file) => { try { return sha256(fs.readFileSync(file)); } catch (_) { return null; } };
  return { network: "NOT_OBSERVED", credentials: "NOT_OBSERVED", repository: "NOT_OBSERVED", inheritedEnvironment: "NOT_OBSERVED", inheritedFileDescriptors: "NOT_OBSERVED", home: "NOT_OBSERVED", work: "NOT_OBSERVED", launcher: BWRAP, launcherDigest: fileDigest(BWRAP), worker: null, node: NODE, nodeDigest: fileDigest(NODE), sandboxArgv: null };
}

function killGroup(child) {
  if (!child || child.killed) return;
  try { process.kill(-child.pid, "SIGKILL"); } catch (_) { try { child.kill("SIGKILL"); } catch (_) {} }
}

async function runClosedPage({ attemptRef, page, timeoutMs = 5000, maximumOutputBytes = DEFAULT_MAX_OUTPUT, signal } = {}) {
  const startedAt = new Date().toISOString();
  const input = { attemptRef, page };
  const safeAttempt = validString(attemptRef, 512);
  let pageDigest = null;
  try { pageDigest = sha256(pageBytes(page)); } catch (_) {}
  let workerBytes;
  try { workerBytes = fs.readFileSync(WORKER_PATH); } catch (_) { return resultBase({ attemptRef }, pageDigest, null, startedAt, new Date().toISOString(), "UNAVAILABLE", "WORKER_UNAVAILABLE", null, null, Buffer.alloc(0), Buffer.alloc(0), isolationNotObserved()); }
  const workerDigest = sha256(workerBytes);
  const isolation = isolationNotObserved();
  let inputBytes;
  try { inputBytes = Buffer.from(JSON.stringify(input), "utf8"); } catch (_) { return resultBase({ attemptRef }, pageDigest, workerDigest, startedAt, new Date().toISOString(), "FAILED", "INPUT_MALFORMED", null, null, Buffer.alloc(0), Buffer.alloc(0), isolation); }
  if (!safeAttempt || !validPage(page)) return resultBase({ attemptRef }, pageDigest, workerDigest, startedAt, new Date().toISOString(), "FAILED", "INPUT_MALFORMED", null, null, Buffer.alloc(0), Buffer.alloc(0), isolation);
  if (inputBytes.length > MAX_INPUT_BYTES || page.evidence.nodes.length > MAX_NODES || page.evidence.alternatives.length > MAX_ALTERNATIVES || page.obligationIds.length > MAX_OBLIGATIONS) return resultBase({ attemptRef }, pageDigest, workerDigest, startedAt, new Date().toISOString(), "FAILED", "INPUT_LIMIT", null, null, Buffer.alloc(0), Buffer.alloc(0), isolation);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_TIMEOUT || !Number.isSafeInteger(maximumOutputBytes) || maximumOutputBytes < 1 || maximumOutputBytes > 16 * 1024 * 1024) return resultBase({ attemptRef }, pageDigest, workerDigest, startedAt, new Date().toISOString(), "FAILED", "BOUND_INVALID", null, null, Buffer.alloc(0), Buffer.alloc(0), isolation);
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "direct-commissioning-process-"));
  try {
    fs.writeFileSync(path.join(scratch, "commissioning-chain-worker.cjs"), workerBytes, { mode: 0o500 });
    const args = ["--unshare-all", "--die-with-parent", "--new-session", "--clearenv", "--ro-bind", "/usr", "/usr", "--ro-bind", "/lib", "/lib", "--ro-bind", "/lib64", "/lib64", "--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp", "--ro-bind", scratch, "/work", "--chdir", "/work", NODE, "/work/commissioning-chain-worker.cjs"];
    isolation.worker = "/work/commissioning-chain-worker.cjs"; isolation.node = NODE; isolation.sandboxArgv = ["/usr/bin/bwrap", ...args.map((arg) => arg === scratch ? "<private-work>" : arg)];
    const child = spawn(BWRAP, args, { detached: true, shell: false, env: {}, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = Buffer.alloc(0); let stderr = Buffer.alloc(0); let capturedBytes = 0; let bound = false; let timedOut = false; let aborted = false; let spawnError = null;
    const collect = (name) => (chunk) => { capturedBytes += chunk.length; if (capturedBytes > maximumOutputBytes) { bound = true; killGroup(child); return; } if (name === "stdout") stdout = Buffer.concat([stdout, chunk]); else stderr = Buffer.concat([stderr, chunk]); };
    child.stdout.on("data", collect("stdout")); child.stderr.on("data", collect("stderr"));
    const abort = () => { if (!aborted) { aborted = true; killGroup(child); } };
    if (signal) { if (signal.aborted) abort(); else signal.addEventListener("abort", abort, { once: true }); }
    const timer = setTimeout(() => { timedOut = true; killGroup(child); }, timeoutMs);
    child.stdin.on("error", (error) => { if (error.code === "EPIPE") { spawnError = error; killGroup(child); } });
    child.stdin.end(inputBytes);
    const outcome = await new Promise((resolve) => { child.once("error", (error) => { spawnError = error; }); child.once("close", (code, sig) => resolve({ code, sig })); });
    clearTimeout(timer); if (signal) signal.removeEventListener?.("abort", abort);
    let probe = null; for (const line of stderr.toString("utf8").split("\n")) if (line.startsWith("COMMISSIONING_PROBE:")) { try { probe = JSON.parse(line.slice("COMMISSIONING_PROBE:".length)); } catch (_) {} }
    const hostNamespace = (name) => { try { return fs.readlinkSync(`/proc/self/ns/${name}`); } catch (_) { return null; } };
    const probeValid = probe && Array.isArray(probe.environmentNames) && probe.environmentNames.every((name) => name === "PWD") && probe.homeAbsent === true && probe.runAbsent === true && probe.rootAbsent === true && probe.workWritable === false && typeof probe.netNamespace === "string" && probe.netNamespace !== hostNamespace("net") && typeof probe.pidNamespace === "string" && probe.pidNamespace !== hostNamespace("pid") && typeof probe.mountNamespace === "string" && probe.mountNamespace !== hostNamespace("mnt");
    if (probeValid) { isolation.network = "OBSERVED_UNSHARED"; isolation.credentials = "OBSERVED_ABSENT"; isolation.repository = "OBSERVED_ABSENT"; isolation.inheritedEnvironment = "OBSERVED_CLEARED"; isolation.inheritedFileDescriptors = "CONFIGURED_CLOSED"; isolation.home = "OBSERVED_ABSENT"; isolation.work = "OBSERVED_READ_ONLY"; isolation.probe = probe; }
    const reasonCode = bound ? "OUTPUT_LIMIT" : timedOut ? "TIMEOUT" : aborted ? "ABORTED" : spawnError ? "LAUNCH_FAILED" : outcome.code === 0 && probeValid ? "CAPTURED" : outcome.code === 0 ? "ISOLATION_PROBE_FAILED" : "WORKER_FAILED";
    const status = reasonCode === "CAPTURED" ? "CAPTURED" : reasonCode === "TIMEOUT" || reasonCode === "ABORTED" || reasonCode === "LAUNCH_FAILED" ? "UNAVAILABLE" : "FAILED";
    return resultBase({ attemptRef }, pageDigest, workerDigest, startedAt, new Date().toISOString(), status, reasonCode, outcome.code, outcome.sig, stdout, stderr, isolation);
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
}

module.exports = { runClosedPage, pageBytes, sha256 };
