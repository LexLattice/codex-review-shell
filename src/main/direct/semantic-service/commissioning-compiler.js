"use strict";

// This is the commissioning compiler adapter, not a new identity for DSS04.
// Only owner installation reads the compiler checkout. Jobs use copied,
// digest-bound source bytes and a closed installed module in a real sandbox.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn, execFileSync } = require("node:child_process");
const { canonicalJson, parseJsonStrict } = require("./dss02-common");

const PACK_SCHEMA = "direct_commissioning_pack@1";
const MODULE_ID = "arcagi.s14-m2-identity-continuity.bc1ed3e.v0";
const SUBJECT = "e.m2-current-occurrence-chain";
const TEMPLATES = Object.freeze(["alternative-closure", "population-closure", "current-at-boundary", "projection-completeness"]);
const SOURCE_PATHS = Object.freeze([
  "scripts/dev/compile_semantic_contract_learning_v1.py",
  "src/semantic_compiler/__init__.py",
  "src/semantic_compiler/compiler.py",
  "src/semantic_compiler/learning_v1.py",
  "src/semantic_compiler/model.py",
  "meta/semantic_compiler/pattern_library.v0.json",
  "meta/semantic_compiler/audit_learning_patterns.v1.json",
]);
const BWRAP = "/usr/bin/bwrap";
const WORKER = path.join(__dirname, "resources", "commissioning-chain-worker.cjs");
const MAX_BYTES = 2 * 1024 * 1024;
const sha256 = (bytes) => `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
const objectDigest = (value) => sha256(Buffer.from(canonicalJson(value), "utf8"));
const same = (a, b) => canonicalJson(a) === canonicalJson(b);
function fail(code) { const error = new Error(code); error.code = code; throw error; }
function exact(value, keys, code = "COMMISSIONING_SHAPE_INVALID") {
  if (!value || typeof value !== "object" || Array.isArray(value) || !same(Object.keys(value).sort(), [...keys].sort())) fail(code);
}
function id(value) { if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value)) fail("COMMISSIONING_REFERENCE_INVALID"); return value; }
function readBounded(file, maximum = MAX_BYTES) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maximum) fail("COMMISSIONING_FILE_INVALID");
  return fs.readFileSync(file);
}

function serviceImplementationDigest() {
  const repository = path.resolve(__dirname, "../../../..");
  const files = fs.readdirSync(__dirname).filter((name) => name.endsWith(".js")).map((name) => `src/main/direct/semantic-service/${name}`);
  files.push("src/main/direct/semantic-service/resources/commissioning-chain-worker.cjs", "scripts/direct-semantic-service-host.mjs", "scripts/direct-semantic-service-commission.mjs", "docs/DIRECT_SEMANTIC_SERVICE_COMMISSIONING_V1.md");
  return objectDigest(files.sort().map((relative) => ({ relative, digest: sha256(readBounded(path.join(repository, relative))) })));
}

// The mounted interpreter tree is installation-owned runtime, not project
// evidence. Include bytecode and internal links because Python may read them.
function runtimeDigest(root) {
  root = fs.realpathSync(root);
  let total = 0;
  const entries = [];
  function visit(relative) {
    const absolute = path.join(root, relative);
    const stat = fs.lstatSync(absolute);
    if (entries.length > 20_000) fail("COMMISSIONING_RUNTIME_BOUNDS");
    if (stat.isSymbolicLink()) {
      const resolved = fs.realpathSync(absolute);
      if (resolved !== root && !resolved.startsWith(root + path.sep)) fail("COMMISSIONING_RUNTIME_EXTERNAL_LINK");
      entries.push({ relative, kind: "link", target: fs.readlinkSync(absolute) });
    } else if (stat.isDirectory()) {
      for (const name of fs.readdirSync(absolute).sort()) visit(path.join(relative, name));
    } else if (stat.isFile()) {
      total += stat.size;
      if (total > 256 * 1024 * 1024) fail("COMMISSIONING_RUNTIME_BOUNDS");
      entries.push({ relative, kind: "file", mode: stat.mode & 0o777, digest: sha256(fs.readFileSync(absolute)) });
    } else fail("COMMISSIONING_RUNTIME_SPECIAL_FILE");
  }
  visit("");
  return objectDigest(entries);
}

function packBody(pack) { const { packDigest: _, ...body } = pack; return body; }

function createPack({ compilerRoot, moduleFile, snapshots, projectRef, provider = null }) {
  compilerRoot = fs.realpathSync(compilerRoot);
  id(projectRef);
  const module = parseJsonStrict(readBounded(moduleFile).toString("utf8"));
  if (module.module_id !== MODULE_ID || !module.carriers?.some((row) => row.id === SUBJECT)) fail("COMMISSIONING_MODULE_UNSUPPORTED");
  if (!Array.isArray(snapshots) || !snapshots.length || snapshots.length > 64) fail("COMMISSIONING_SNAPSHOTS_INVALID");
  const installedSnapshots = snapshots.map((snapshot) => {
    exact(snapshot, ["snapshotRef", "evidence"]);
    id(snapshot.snapshotRef);
    if (Buffer.byteLength(canonicalJson(snapshot.evidence)) > 64 * 1024) fail("COMMISSIONING_EVIDENCE_BOUNDS");
    return { ...snapshot, evidenceDigest: objectDigest(snapshot.evidence) };
  });
  if (new Set(installedSnapshots.map((row) => row.snapshotRef)).size !== installedSnapshots.length || new Set(installedSnapshots.map((row) => row.evidenceDigest)).size !== installedSnapshots.length) fail("COMMISSIONING_SNAPSHOT_COLLISION");
  const gitOptions = { cwd: compilerRoot, env: { PATH: "/usr/bin:/bin", LC_ALL: "C" }, encoding: "utf8", timeout: 5000, maxBuffer: MAX_BYTES };
  const sourceCommit = execFileSync("/usr/bin/git", ["rev-parse", "HEAD"], gitOptions).trim();
  const status = execFileSync("/usr/bin/git", ["status", "--porcelain", "--", ...SOURCE_PATHS], gitOptions);
  if (status.trim()) fail("COMMISSIONING_COMPILER_SOURCE_DIRTY");
  const sources = SOURCE_PATHS.map((relative) => {
    const bytes = readBounded(path.join(compilerRoot, relative));
    return { relative, bytesBase64: bytes.toString("base64"), digest: sha256(bytes) };
  });
  const python = path.join(compilerRoot, ".venv", "bin", "python");
  const runtime = JSON.parse(execFileSync(python, ["-I", "-S", "-c", "import json,sys,os; print(json.dumps({'root':os.path.realpath(sys.base_prefix),'executable':os.path.realpath(sys._base_executable),'version':sys.version}))"], { env: {}, encoding: "utf8", timeout: 5000 }));
  const executableRelative = path.relative(runtime.root, runtime.executable);
  if (executableRelative.startsWith("..") || path.isAbsolute(executableRelative)) fail("COMMISSIONING_INTERPRETER_INVALID");
  const body = {
    schema: PACK_SCHEMA, revision: "commissioning-v1", projectRef, implementationDigest: serviceImplementationDigest(),
    module, moduleDigest: objectDigest(module), provider,
    compiler: { sourceCommit, sources, sourceDigest: objectDigest(sources), runtimeRoot: runtime.root, executableRelative, executableDigest: sha256(fs.readFileSync(runtime.executable)), runtimeDigest: runtimeDigest(runtime.root), version: runtime.version, launcherDigest: sha256(fs.readFileSync(BWRAP)) },
    worker: { revision: "finite-chain-v1", workerDigest: sha256(readBounded(WORKER)), nodeDigest: sha256(fs.readFileSync("/usr/bin/node")), launcherDigest: sha256(fs.readFileSync(BWRAP)) },
    selector: { subject: SUBJECT, templates: [...TEMPLATES] },
    attemptPolicy: { maximumAttempts: 1, compilerTimeoutMs: 15_000, workerTimeoutMs: 5000, maximumRawBytes: 65_536, interrupted: "REMAND_WITHOUT_RETRY" },
    snapshots: installedSnapshots,
    authorityEffect: "none",
  };
  return Object.freeze({ ...body, packDigest: objectDigest(body) });
}

function validatePack(pack, { checkRuntime = false } = {}) {
  exact(pack, ["schema", "revision", "projectRef", "implementationDigest", "module", "moduleDigest", "compiler", "worker", "provider", "selector", "attemptPolicy", "snapshots", "authorityEffect", "packDigest"]);
  if (pack.schema !== PACK_SCHEMA || pack.revision !== "commissioning-v1" || pack.authorityEffect !== "none" || objectDigest(packBody(pack)) !== pack.packDigest || objectDigest(pack.module) !== pack.moduleDigest || pack.module.module_id !== MODULE_ID) fail("COMMISSIONING_PACK_IDENTITY_INVALID");
  id(pack.projectRef);
  if (pack.provider !== null && !same(pack.provider, require("./commissioning-provider").providerDescriptor({ authRoot: pack.provider.authRoot, authFile: pack.provider.authFile }))) fail("COMMISSIONING_PROVIDER_PIN_DRIFT");
  if (pack.implementationDigest !== serviceImplementationDigest()) fail("COMMISSIONING_SERVICE_IMPLEMENTATION_DRIFT");
  if (!same(pack.selector, { subject: SUBJECT, templates: [...TEMPLATES] })) fail("COMMISSIONING_SELECTOR_INVALID");
  if (!same(pack.attemptPolicy, { maximumAttempts: 1, compilerTimeoutMs: 15_000, workerTimeoutMs: 5000, maximumRawBytes: 65_536, interrupted: "REMAND_WITHOUT_RETRY" })) fail("COMMISSIONING_ATTEMPT_POLICY_INVALID");
  const compiler = pack.compiler;
  exact(compiler, ["sourceCommit", "sources", "sourceDigest", "runtimeRoot", "executableRelative", "executableDigest", "runtimeDigest", "version", "launcherDigest"]);
  if (!/^[0-9a-f]{40}$/.test(compiler.sourceCommit) || !same(compiler.sources.map((row) => row.relative), SOURCE_PATHS) || objectDigest(compiler.sources) !== compiler.sourceDigest) fail("COMMISSIONING_COMPILER_PIN_INVALID");
  for (const source of compiler.sources) {
    exact(source, ["relative", "bytesBase64", "digest"]);
    const bytes = Buffer.from(source.bytesBase64, "base64");
    if (bytes.length > MAX_BYTES || bytes.toString("base64") !== source.bytesBase64 || sha256(bytes) !== source.digest) fail("COMMISSIONING_COMPILER_SOURCE_CORRUPT");
  }
  if (!path.isAbsolute(compiler.runtimeRoot) || path.isAbsolute(compiler.executableRelative) || compiler.executableRelative.split(path.sep).includes("..")) fail("COMMISSIONING_INTERPRETER_INVALID");
  exact(pack.worker, ["revision", "workerDigest", "nodeDigest", "launcherDigest"]);
  if (pack.worker.revision !== "finite-chain-v1" || sha256(readBounded(WORKER)) !== pack.worker.workerDigest || sha256(fs.readFileSync("/usr/bin/node")) !== pack.worker.nodeDigest || sha256(fs.readFileSync(BWRAP)) !== pack.worker.launcherDigest || pack.worker.launcherDigest !== compiler.launcherDigest) fail("COMMISSIONING_WORKER_PIN_DRIFT");
  if (!Array.isArray(pack.snapshots) || !pack.snapshots.length || pack.snapshots.length > 64) fail("COMMISSIONING_SNAPSHOTS_INVALID");
  const seen = new Set();
  const evidenceDigests = new Set();
  for (const snapshot of pack.snapshots) {
    exact(snapshot, ["snapshotRef", "evidence", "evidenceDigest"]);
    id(snapshot.snapshotRef);
    if (seen.has(snapshot.snapshotRef) || evidenceDigests.has(snapshot.evidenceDigest) || objectDigest(snapshot.evidence) !== snapshot.evidenceDigest || Buffer.byteLength(canonicalJson(snapshot.evidence)) > 64 * 1024) fail("COMMISSIONING_SNAPSHOT_IDENTITY_INVALID");
    seen.add(snapshot.snapshotRef);
    evidenceDigests.add(snapshot.evidenceDigest);
  }
  if (checkRuntime && (sha256(fs.readFileSync(path.join(compiler.runtimeRoot, compiler.executableRelative))) !== compiler.executableDigest || runtimeDigest(compiler.runtimeRoot) !== compiler.runtimeDigest)) fail("COMMISSIONING_INTERPRETER_DRIFT");
  return pack;
}

function requestFor(pack, { snapshotRef, requestId, idempotencyKey }) {
  const snapshot = pack.snapshots.find((row) => row.snapshotRef === snapshotRef);
  if (!snapshot) fail("COMMISSIONING_SNAPSHOT_UNKNOWN");
  const suffix = pack.packDigest.slice(7);
  return {
    schema: "direct_semantic_job_request@1", requestId: id(requestId), projectRef: pack.projectRef,
    projectRegistryRevisionRef: `commissioning-registry:${suffix}`,
    targetORevision: `module:${pack.moduleDigest.slice(7)}`,
    targetSnapshotReceiptRef: `snapshot:${snapshot.evidenceDigest.slice(7)}`,
    compilerPinRef: `compiler:${pack.compiler.sourceDigest.slice(7)}`,
    requestedCompilationRef: `compilation:${suffix}`,
    selectionMode: "partial_selection", edgeOccurrenceRefs: TEMPLATES.map((template) => `chain:${template}`).sort(),
    attemptPolicyRef: `attempt-policy:${suffix}`, executionProfileRevisionRef: `profile:${suffix}`,
    deliveryProjectionRef: "commissioning-projection-v1", idempotencyKey: id(idempotencyKey),
  };
}

function snapshotForRequest(pack, request) {
  const candidates = pack.snapshots.filter((row) => request.targetSnapshotReceiptRef === `snapshot:${row.evidenceDigest.slice(7)}`);
  if (candidates.length !== 1) fail("COMMISSIONING_SNAPSHOT_UNKNOWN_OR_AMBIGUOUS");
  const expected = requestFor(pack, { snapshotRef: candidates[0].snapshotRef, requestId: request.requestId, idempotencyKey: request.idempotencyKey });
  if (!same(request, expected)) fail("COMMISSIONING_REQUEST_PIN_MISMATCH");
  return candidates[0];
}

const PROBE_PREFIX = "COMMISSIONING_COMPILER_PROBE:";
const BOOTSTRAP = "import json,os,runpy,sys; print('" + PROBE_PREFIX + "'+json.dumps({'net':os.readlink('/proc/self/ns/net'),'pid':os.readlink('/proc/self/ns/pid'),'homeVisible':os.path.exists('/home'),'rootVisible':os.path.exists('/root'),'environmentNames':sorted(os.environ)}),file=sys.stderr,flush=True); sys.argv=sys.argv[1:]; runpy.run_path(sys.argv[0],run_name='__main__')";

async function runCompiler(pack, { signal } = {}) {
  validatePack(pack, { checkRuntime: true });
  const scratch = fs.mkdtempSync("/tmp/direct-commissioning-compiler-");
  const startedAt = new Date().toISOString();
  let child;
  try {
    const compilerRoot = path.join(scratch, "compiler");
    for (const source of pack.compiler.sources) {
      const target = path.join(compilerRoot, source.relative);
      fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
      fs.writeFileSync(target, Buffer.from(source.bytesBase64, "base64"), { mode: 0o400, flag: "wx" });
    }
    const input = path.join(scratch, "module.json");
    fs.writeFileSync(input, canonicalJson(pack.module), { mode: 0o400, flag: "wx" });
    const args = ["--unshare-all", "--die-with-parent", "--new-session", "--clearenv", "--setenv", "LC_ALL", "C.UTF-8", "--ro-bind", "/usr", "/usr", "--ro-bind", "/lib", "/lib", "--ro-bind", "/lib64", "/lib64", "--ro-bind", pack.compiler.runtimeRoot, "/runtime", "--ro-bind", compilerRoot, "/compiler", "--ro-bind", input, "/module.json", "--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp", "--chdir", "/tmp", `/runtime/${pack.compiler.executableRelative}`, "-I", "-S", "-B", "-c", BOOTSTRAP, "/compiler/scripts/dev/compile_semantic_contract_learning_v1.py", "/module.json"];
    const hostNetwork = fs.readlinkSync("/proc/self/ns/net");
    const hostPid = fs.readlinkSync("/proc/self/ns/pid");
    child = spawn(BWRAP, args, { env: {}, cwd: scratch, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = Buffer.alloc(0); let stderr = Buffer.alloc(0); let failure = null; let launchError = null;
    const kill = (reason) => { failure ||= reason; try { process.kill(-child.pid, "SIGKILL"); } catch (_) { child.kill("SIGKILL"); } };
    const collect = (stream) => (chunk) => {
      if (stdout.length + stderr.length + chunk.length > MAX_BYTES) { kill("COMPILER_OUTPUT_BOUNDS"); return; }
      if (stream === "stdout") stdout = Buffer.concat([stdout, chunk]); else stderr = Buffer.concat([stderr, chunk]);
    };
    child.stdout.on("data", collect("stdout")); child.stderr.on("data", collect("stderr"));
    const abort = () => kill("COMPILER_ABORTED");
    const timer = setTimeout(() => kill("COMPILER_TIMEOUT"), pack.attemptPolicy.compilerTimeoutMs);
    if (signal?.aborted) abort(); else signal?.addEventListener("abort", abort, { once: true });
    child.once("error", (error) => { launchError = error.code || "COMPILER_LAUNCH_FAILED"; });
    const outcome = await new Promise((resolve) => child.once("close", (exitCode, signalName) => resolve({ exitCode, signal: signalName })));
    clearTimeout(timer); signal?.removeEventListener("abort", abort);
    let probe = null;
    try { const line = stderr.toString("utf8").split("\n").find((line) => line.startsWith(PROBE_PREFIX)); if (line) probe = JSON.parse(line.slice(PROBE_PREFIX.length)); } catch (_) {}
    const isolationObserved = Boolean(probe && probe.net !== hostNetwork && probe.pid !== hostPid && !probe.homeVisible && !probe.rootVisible && Array.isArray(probe.environmentNames) && probe.environmentNames.every((name) => ["PWD", "LC_ALL"].includes(name)));
    validatePack(pack, { checkRuntime: true });
    const reasonCode = failure || launchError || (outcome.exitCode !== 0 ? "COMPILER_EXIT_FAILED" : !isolationObserved ? "COMPILER_ISOLATION_UNAVAILABLE" : "CAPTURED");
    return { schema: "direct_commissioning_compiler_observation@1", packDigest: pack.packDigest, compilerSourceDigest: pack.compiler.sourceDigest, interpreterDigest: pack.compiler.executableDigest, runtimeDigest: pack.compiler.runtimeDigest, launcherDigest: pack.compiler.launcherDigest, status: reasonCode === "CAPTURED" ? "CAPTURED" : "UNAVAILABLE", reasonCode, ...outcome, startedAt, completedAt: new Date().toISOString(), isolation: { status: isolationObserved ? "OBSERVED" : "NOT_OBSERVED", probe }, stdoutBase64: stdout.toString("base64"), stderrBase64: stderr.toString("base64"), rawDigest: sha256(stdout) };
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
}

function materializePage(pack, snapshot, observation) {
  if (observation.status !== "CAPTURED" || observation.packDigest !== pack.packDigest || observation.compilerSourceDigest !== pack.compiler.sourceDigest) fail("COMMISSIONING_COMPILER_OBSERVATION_REJECTED");
  const raw = Buffer.from(observation.stdoutBase64, "base64");
  if (sha256(raw) !== observation.rawDigest) fail("COMMISSIONING_COMPILER_RAW_CORRUPT");
  const receipt = parseJsonStrict(raw.toString("utf8"));
  exact(receipt, ["compiler", "module_digest", "module_id", "obligation_count", "obligations", "pattern_library_digest", "reconciliation", "schema", "static_remands", "verdict"]);
  if (receipt.schema !== "semantic-compilation-receipt.v0" || !same(receipt.compiler, { id: "openai.semantic-obligation-compiler", version: "0.1.0" }) || !/^[0-9a-f]{64}$/.test(receipt.pattern_library_digest) || receipt.verdict !== "OBLIGATIONS_EMITTED" || receipt.module_id !== MODULE_ID || receipt.module_digest !== pack.moduleDigest.slice(7) || !Array.isArray(receipt.obligations) || !receipt.obligations.length || receipt.obligation_count !== receipt.obligations.length || !Array.isArray(receipt.static_remands) || receipt.static_remands.length !== 0) fail("COMMISSIONING_COMPILATION_REJECTED");
  if (new Set(receipt.obligations.map((row) => row.id)).size !== receipt.obligations.length || receipt.obligations.some((row) => row.status !== "UNPROVEN")) fail("COMMISSIONING_COMPILATION_POPULATION_INVALID");
  const selected = receipt.obligations.filter((row) => row.subject?.id === SUBJECT && TEMPLATES.includes(row.origin?.template_id));
  if (selected.length !== TEMPLATES.length || !same(selected.map((row) => row.origin.template_id).sort(), [...TEMPLATES].sort())) fail("COMMISSIONING_ROUTE_POPULATION_INVALID");
  const compilationDigest = objectDigest(receipt);
  const sourceClaim = pack.module.carriers.find((row) => row.id === SUBJECT)?.claim?.predicate;
  const predicate = "Advisory finite-chain commissioning only. All production obligations remain UNPROVEN; installed fixture flags do not establish native M0/M1/M2 authority or complete production evidence. Review one entity's finite ordered chain from genesis: unique bindings, consecutive ordinals, exact predecessor and adjacent occurrence joins, no cycles or repeated occurrences except adjacent joins. Revision identities are separate from occurrence identities. Missing/incomplete/stale evidence remands; unresolved alternatives are inconclusive. Source declaration: " + sourceClaim + " Relevant compiler demands: " + selected.map((row) => row.summary).join(" ");
  if (predicate.length > 4096) fail("COMMISSIONING_LAW_PAGE_BUDGET");
  const page = { schema: "direct_commissioning_chain_page@1", pageRef: `chain-page:${objectDigest({ compilationDigest, evidenceDigest: snapshot.evidenceDigest, selector: pack.selector }).slice(7)}`, compilationDigest, obligationIds: selected.map((row) => row.id), law: { family: "s14-m2-chain-contiguity", revision: "commissioning@1", predicate }, evidence: snapshot.evidence };
  if (Buffer.byteLength(canonicalJson(page)) > 96 * 1024) fail("COMMISSIONING_PAGE_BUDGET");
  return { page, pageDigest: objectDigest(page), compilationDigest, fullObligationCount: receipt.obligation_count, selectedObligationCount: selected.length, proofStatus: "UNPROVEN", authorityEffect: "none" };
}

module.exports = { PACK_SCHEMA, MODULE_ID, SOURCE_PATHS, createPack, validatePack, requestFor, snapshotForRequest, runCompiler, materializePage, runtimeDigest, sha256, objectDigest, exact, fail };
