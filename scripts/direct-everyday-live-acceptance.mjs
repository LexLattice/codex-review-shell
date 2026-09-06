#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const { DirectSessionStore } = require("../src/main/direct/session/session-store.js");
const { DirectThreadStore } = require("../src/main/direct/thread/thread-store.js");
const { DirectThreadHarnessGrantStore } = require("../src/main/direct/authority/direct-thread-harness-grant.js");
const { DirectStatefulExecSessionManager } = require("../src/main/direct/tools/stateful-exec-session.js");
const { DirectFullAccessLocalEnvironmentExecutor } = require("../src/main/direct/tools/full-access-local-environment.js");
const { DirectLiveTextController, DirectLiveTextSurfaceSession } = require("../src/main/direct/controller/live-text-controller.js");
const { createDirectAuthStore } = require("../src/main/direct/auth/auth-store.js");
const { createCodexCliAuthStore, createDirectAuthCompositeStore } = require("../src/main/direct/auth/codex-cli-auth.js");
const { loadDirectCodexProfile } = require("../src/main/direct/odeu-profile/profile-loader.js");
const { DirectLiveProbeEvidenceStore, MANUAL_LIVE_PROBE_SOURCE, FIXED_LIVE_TEXT_PROBE_PROMPT_CLASS } = require("../src/main/direct/probes/live-probe-evidence-store.js");
const { DEFAULT_CODEX_RESPONSES_ENDPOINT, DEFAULT_TEXT_PROBE_PROMPT, runPersistedTextOnlyDirectProbe } = require("../src/main/direct/transport/codex-responses-transport.js");

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAX_RUN_MS = 180_000;
const MAX_HTTP_REQUESTS = 12;
const EXPECTED_SOURCE = "function add(a, b) {\n  return a + b;\n}\n\nmodule.exports = { add };\n";
const TEST_SOURCE = "const assert = require('node:assert/strict');\nconst { add } = require('./src/calc');\nassert.equal(add(2, 3), 5);\nassert.equal(add(-2, 7), 5);\nassert.equal(add(0, 0), 0);\nconsole.log('fixture tests passed');\n";
const sha = (value) => crypto.createHash("sha256").update(value).digest("hex");
const fail = (code) => Object.assign(new Error(code), { code });
const within = (root, target) => target === root || target.startsWith(`${root}${path.sep}`);

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--allow-live-provider-call") { options.allowLive = true; continue; }
    const name = argv[i].slice(2);
    if (!argv[i].startsWith("--") || !["model", "reasoning-effort", "auth-root", "output-root"].includes(name)) throw fail("unknown_option");
    if (!argv[i + 1] || argv[i + 1].startsWith("--")) throw fail("option_value_missing");
    options[name] = argv[++i];
  }
  return options;
}

export function externalOutputRoot(candidate, repoRoot = REPO_ROOT) {
  const absolute = path.resolve(candidate);
  let existing = absolute;
  while (!fs.existsSync(existing)) existing = path.dirname(existing);
  const resolved = path.resolve(fs.realpathSync(existing), path.relative(existing, absolute));
  if (within(fs.realpathSync(repoRoot), resolved)) throw fail("output_root_inside_checkout");
  return resolved;
}

export function fixtureManifest(root) {
  const entries = {};
  let count = 0;
  function visit(directory, depth = 0) {
    if (depth > 8) throw fail("fixture_scan_bound_exceeded");
    for (const name of fs.readdirSync(directory).sort()) {
      if (++count > 128) throw fail("fixture_scan_bound_exceeded");
      const absolute = path.join(directory, name);
      const stat = fs.lstatSync(absolute);
      if (stat.isDirectory()) visit(absolute, depth + 1);
      else if (stat.isFile() && stat.size <= 64 * 1024) entries[path.relative(root, absolute).split(path.sep).join("/")] = sha(fs.readFileSync(absolute));
      else throw fail("fixture_file_type_or_size_invalid");
    }
  }
  visit(root);
  return entries;
}

function sourceIdentity() {
  const git = (args) => {
    const result = spawnSync("git", args, { cwd: REPO_ROOT, encoding: "utf8", timeout: 10_000, maxBuffer: 4 * 1024 * 1024 });
    if (result.status !== 0) throw fail("source_identity_unavailable");
    return result.stdout;
  };
  const head = git(["rev-parse", "HEAD"]).trim();
  const paths = new Set(git(["ls-files", "-z", "--", "src", "package.json", "package-lock.json"]).split("\0").filter(Boolean));
  paths.add("scripts/direct-everyday-live-acceptance.mjs");
  paths.add("scripts/direct-everyday-live-acceptance-regression.mjs");
  const manifest = {};
  for (const relative of [...paths].sort()) manifest[relative] = sha(fs.readFileSync(path.join(REPO_ROOT, relative)));
  return { head, digest: sha(JSON.stringify(manifest)), fileCount: paths.size, manifest };
}

// Final executionAllowed is false after recording a result. Join the durable
// result and its producer obligation to observe past effects and their grant.
export function collectExecEvidence(turn = {}, expected = {}) {
  return (turn.unresolvedObligations || []).filter((o) => ["exec_command", "write_stdin"].includes(o.name)).map((o) => {
    const result = (turn.toolResults || []).find((r) => r.resultId && r.resultId === o.result?.resultId);
    let output = null;
    try { output = JSON.parse(result?.providerOutputText || "null"); } catch { /* Invalid evidence remains invalid. */ }
    const joined = Boolean(expected.taskId && expected.projectId && expected.grantId && Number.isInteger(expected.grantRevision) &&
      o.statefulExecSessionId && result?.resultKind === "stateful_exec" && result.sideEffectExecuted === true &&
      output?.schema === "direct_stateful_exec_result@1" && output.resultDigest &&
      output.sessionId === o.statefulExecSessionId && output.taskId === expected.taskId &&
      output.projectId === expected.projectId && output.grantId === expected.grantId &&
      output.grantRevision === expected.grantRevision &&
      o.harnessGrantId === expected.grantId && o.harnessGrantRevision === expected.grantRevision &&
      o.sideEffectExecuted === true && o.approvalPolicy === "never" && o.approvalAvailable === false);
    return {
      name: o.name, obligationId: o.obligationId, resultId: result?.resultId || "",
      execSessionId: output?.sessionId || "", grantId: o.harnessGrantId || "",
      resultDigest: output?.resultDigest || "", approvalPolicy: o.approvalPolicy || "",
      joined, exitCode: output?.exitCode ?? null, status: output?.status || "", timedOut: output?.timedOut === true,
    };
  });
}

export function evaluateAcceptanceEvidence(input = {}) {
  const before = input.before || {};
  const after = input.after || {};
  const changedPaths = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort().filter((p) => before[p] !== after[p]);
  const assertions = {
    providerCompleted: input.providerState === "completed",
    selectedRuntimePreserved: input.selectedRuntimePreserved === true,
    sourceCheckoutUnchanged: input.sourceCheckoutUnchanged === true,
    exactMutation: changedPaths.length === 1 && changedPaths[0] === "src/calc.js" && after["src/calc.js"] === sha(EXPECTED_SOURCE),
    immutableTest: Boolean(before["test.js"]) && before["test.js"] === after["test.js"],
    immutableManifest: Boolean(before["package.json"]) && before["package.json"] === after["package.json"],
    independentTestPassed: input.oracleStatus === 0,
    recordedExecEffect: Array.isArray(input.execEvidence) && input.execEvidence.some((r) => r.name === "exec_command" && r.joined),
    recordedExecCompletion: Array.isArray(input.execEvidence) && input.execEvidence.some((r) => r.joined && r.exitCode === 0 && r.status !== "running"),
    allExecEvidenceBound: Array.isArray(input.execEvidence) && input.execEvidence.length > 0 && input.execEvidence.every((r) => r.joined && !r.timedOut),
    zeroPerCallApprovals: input.approvalRequestCount === 0,
    restartReadback: input.resumed === true && input.persistedTask === true && input.persistedGrant === true,
  };
  return { ok: Object.values(assertions).every(Boolean), assertions, changedPaths };
}

function writeJson(target, value) {
  const temporary = `${target}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, target);
}

async function runLive(options) {
  if (!options.allowLive) throw fail("live_opt_in_required");
  const model = options.model;
  const reasoningEffort = options["reasoning-effort"];
  if (!model || !reasoningEffort) throw fail("model_options_required");
  const outputRoot = externalOutputRoot(options["output-root"] || path.join(os.tmpdir(), "direct-everyday-acceptance"));
  fs.mkdirSync(outputRoot, { recursive: true, mode: 0o700 });
  const root = fs.mkdtempSync(path.join(outputRoot, "run-"));
  const reportPath = path.join(root, "report.json");
  const report = {
    schema: "direct_everyday_live_acceptance_report@1", runId: path.basename(root), status: "running", stage: "setup", liveEvidence: false,
    startedAt: new Date().toISOString(), model, reasoningEffort, providerClass: "chatgpt-codex-responses",
    environment: { node: process.version, platform: process.platform, arch: process.arch },
    bounds: { totalMs: MAX_RUN_MS, maxHttpRequests: MAX_HTTP_REQUESTS }, requests: [], approvalRequestCount: 0, rawSecretsIncluded: false,
    nonClaims: ["GUI acceptance", "delegated child acceptance", "interrupt acceptance", "full parity", "semantic proof"],
  };
  const save = () => writeJson(reportPath, report);
  save();
  const abort = new AbortController();
  const controllers = [], stores = [], managers = [];
  let rejectDeadline;
  const deadline = new Promise((_, reject) => { rejectDeadline = reject; });
  const timer = setTimeout(() => {
    abort.abort(fail("acceptance_deadline_exceeded"));
    for (const controller of controllers) controller.close("acceptance deadline");
    rejectDeadline(fail("acceptance_deadline_exceeded"));
  }, MAX_RUN_MS);
  const active = () => { if (abort.signal.aborted) throw abort.signal.reason; };
  const stage = (value) => { active(); report.stage = value; save(); };
  try {
    await Promise.race([deadline, (async () => {
      const source = sourceIdentity();
      writeJson(path.join(root, "source-manifest.json"), source);
      report.source = { head: source.head, digest: source.digest, fileCount: source.fileCount };
      const workspace = path.join(root, "workspace");
      fs.mkdirSync(path.join(workspace, "src"), { recursive: true, mode: 0o700 });
      fs.writeFileSync(path.join(workspace, "src/calc.js"), EXPECTED_SOURCE.replace("a + b", "a - b"));
      fs.writeFileSync(path.join(workspace, "test.js"), TEST_SOURCE);
      fs.writeFileSync(path.join(workspace, "package.json"), '{"private":true,"scripts":{"test":"node test.js"}}\n');
      const before = fixtureManifest(workspace);
      const project = {
        id: `everyday_${crypto.randomUUID()}`, name: "Everyday acceptance fixture", workspace: { kind: "local", localPath: workspace },
        surfaceBinding: { codex: { runtimeMode: "direct", directTransport: "live-text", directTier: "implementation-lane", model } },
      };
      const authRoot = options["auth-root"] || path.join(os.homedir(), ".config", "codex-review-shell-direct", "direct-auth");
      const authStore = createDirectAuthCompositeStore({ primaryStore: createDirectAuthStore({ mode: "file", rootDir: authRoot }), fallbackStore: createCodexCliAuthStore({}) });
      const credentials = authStore.readCredentials();
      const authStatus = authStore.readStatus();
      report.auth = { status: authStatus.status, source: authStatus.source || authStatus.storageMode };
      if (authStatus.status !== "authenticated" || !credentials?.accessToken) throw fail("auth_required");
      const profileDoc = loadDirectCodexProfile();
      report.profileDigest = sha(JSON.stringify(profileDoc));
      const endpoint = DEFAULT_CODEX_RESPONSES_ENDPOINT;
      const boundedFetch = async (url, init = {}) => {
        active();
        if (String(url) !== endpoint) throw fail("endpoint_not_allowed");
        if (report.requests.length >= MAX_HTTP_REQUESTS) throw fail("provider_request_bound_exceeded");
        const body = JSON.parse(init.body);
        if (body.model !== model) throw fail("provider_request_model_changed");
        const request = { stage: report.stage, model: body.model, reasoningEffort: body.reasoning?.effort || "" };
        report.requests.push(request); save();
        const response = await fetch(url, { ...init, redirect: "error", signal: AbortSignal.any([abort.signal, init.signal].filter(Boolean)) });
        request.status = response.status; save();
        return response;
      };
      stage("readiness_probe");
      const probeStore = new DirectSessionStore({ rootDir: path.join(root, "probe-sessions") });
      const evidenceStore = new DirectLiveProbeEvidenceStore({ rootDir: path.join(root, "probe-evidence") });
      const probe = await runPersistedTextOnlyDirectProbe({ sessionStore: probeStore, project, credentials, profileDoc, model, endpoint, prompt: DEFAULT_TEXT_PROBE_PROMPT, fetchImpl: boundedFetch, signal: abort.signal });
      active();
      const evidence = evidenceStore.recordProbeResult(probe, {
        source: MANUAL_LIVE_PROBE_SOURCE, profileDoc, authStatus, credentials, endpoint, model, project,
        prompt: DEFAULT_TEXT_PROBE_PROMPT, promptClass: FIXED_LIVE_TEXT_PROBE_PROMPT_CLASS,
      });
      report.probe = { ok: probe.ok, status: evidence.view.status, evidenceId: evidence.evidence.evidenceId, model: evidence.evidence.model, responseStatus: probe.response?.status, failureKind: evidence.evidence.result.failureKind || "" };
      save();
      if (!evidence.view.usable) throw fail("model_evidence_unavailable");
      report.liveEvidence = true;
      const makeController = () => {
        const sessionStore = new DirectSessionStore({ rootDir: path.join(root, "sessions") });
        const threadStore = new DirectThreadStore({ rootDir: path.join(root, "threads"), mode: "index_only" });
        stores.push(threadStore);
        const grants = new DirectThreadHarnessGrantStore({ rootDir: path.join(root, "grants") });
        const manager = new DirectStatefulExecSessionManager({ grantStore: grants, workspaceRootResolver: () => workspace, idleTimeoutMs: 10_000, hardTimeoutMs: 30_000 });
        managers.push(manager);
        const controller = new DirectLiveTextController({
          sessionStore, directThreadStore: threadStore, harnessGrantStore: grants, statefulExecSessionManager: manager,
          fullAccessLocalEnvironmentExecutor: new DirectFullAccessLocalEnvironmentExecutor({ grantStore: grants, workspaceRootResolver: () => workspace }),
          profileDoc, authStore, endpoint, fetchImpl: boundedFetch, modelEvidenceResolver: (scope) => evidenceStore.resolveModelEvidence(scope),
          maxTransportBytes: 512 * 1024, maxTransportOutputChars: 128 * 1024,
        });
        controllers.push(controller);
        return { controller, sessionStore, grants };
      };
      const initial = makeController();
      const surfaceSession = new DirectLiveTextSurfaceSession(null, { controller: initial.controller, project });
      surfaceSession.on("event", (event) => { if (event.type === "rpc-request") { report.approvalRequestCount += 1; save(); } });
      const context = { project, ownerControlled: true, surfaceSession };
      stage("mutation_turn");
      const started = await initial.controller.handleRequest("thread/start", { title: "Everyday mutation acceptance", model, reasoningEffort, accessProfile: "full_access" }, context);
      const taskId = started.thread.id;
      report.taskId = taskId;
      const prompt = "Fix add(a,b) in src/calc.js so it returns a+b. Use exec_command in the default task workspace to read the file, replace only a - b with a + b, and run node test.js. Keep formatting and all other files unchanged. Work only inside this disposable fixture; no network or other paths. Finish after the test succeeds.";
      const turnStart = await initial.controller.handleRequest("turn/start", { threadId: taskId, clientTurnRequestId: crypto.randomUUID(), promptText: prompt }, context);
      report.turnId = turnStart.turn.id; save();
      await initial.controller.waitForTurnCompletion({ sessionId: taskId, turnId: report.turnId });
      active();
      const session = initial.sessionStore.readSession(taskId);
      const turn = initial.sessionStore.readTurn(taskId, report.turnId);
      report.mutation = { state: turn.state, errorCode: turn.error?.code || "" };
      // The session stores the grant ID; the revision belongs to the durable grant.
      const taskGrant = initial.grants.read(session.harnessGrantId);
      const expected = { taskId, projectId: project.id, grantId: taskGrant?.grantId, grantRevision: taskGrant?.grantRevision };
      report.execEvidence = collectExecEvidence(turn, expected);
      const after = fixtureManifest(workspace);
      report.fixture = { before, after };
      stage("independent_test");
      const exactFixture = Object.keys(after).length === 3 && after["test.js"] === before["test.js"] && after["package.json"] === before["package.json"] && after["src/calc.js"] === sha(EXPECTED_SOURCE);
      const oracle = exactFixture ? spawnSync(process.execPath, ["test.js"], { cwd: workspace, encoding: "utf8", timeout: 10_000, maxBuffer: 16 * 1024 }) : { status: null };
      report.oracle = { exitCode: oracle.status, executed: exactFixture };
      initial.controller.close("acceptance restart");
      await initial.controller.disposeStatefulExec("acceptance restart");
      stage("restart_readback");
      const reopened = makeController();
      const resumed = await reopened.controller.handleRequest("thread/resume", { threadId: taskId }, { project, ownerControlled: true });
      const persistedSession = reopened.sessionStore.readSession(taskId);
      const persistedTurn = reopened.sessionStore.readTurn(taskId, report.turnId);
      const grant = reopened.grants.currentForScope({ taskId, threadId: taskId, projectId: project.id, executionEnvironmentDigest: session.executionEnvironmentDigest });
      report.restart = {
        resumed: resumed.resumed === true,
        persistedTask: persistedSession?.sessionId === taskId && persistedTurn?.turnId === report.turnId && persistedTurn.state === turn.state,
        persistedGrant: Boolean(grant && grant.grantId === expected.grantId && grant.grantRevision === expected.grantRevision && resumed.capabilities.authority.fullAccessTaskProfile === true),
      };
      const selectedRuntimePreserved = session.model === model && session.reasoningEffort === reasoningEffort && turn.model === model && turn.reasoningEffort === reasoningEffort && report.requests.filter((r) => r.stage === "mutation_turn").every((r) => r.model === model && r.reasoningEffort === reasoningEffort);
      report.evaluation = evaluateAcceptanceEvidence({ before, after, providerState: turn.state, oracleStatus: oracle.status,
        execEvidence: report.execEvidence, approvalRequestCount: report.approvalRequestCount, ...report.restart,
        selectedRuntimePreserved, sourceCheckoutUnchanged: sourceIdentity().digest === source.digest });
      report.status = report.evaluation.ok ? "passed" : "failed";
      if (!report.evaluation.ok) report.failure = { code: "acceptance_evidence_incomplete" };
    })()]);
  } catch (error) {
    report.status = "failed";
    report.failure = { code: /^[a-zA-Z0-9_]+$/.test(error?.code || "") ? error.code : "acceptance_failed" };
  } finally {
    clearTimeout(timer);
    abort.abort(fail("acceptance_closed"));
    for (const controller of controllers) controller.close("acceptance cleanup");
    const cleanup = await Promise.all(managers.map((manager) => manager.dispose("acceptance cleanup")));
    report.cleanup = cleanup.map((r) => ({ status: r.status, activeSessionCount: r.activeSessionCount }));
    if (cleanup.some((r) => r.status !== "completed")) { report.status = "failed"; report.failure = { code: "cleanup_incomplete" }; }
    for (const store of stores) store.close?.();
    report.finishedAt = new Date().toISOString();
    save();
  }
  return { status: report.status, reportPath, stage: report.stage, failure: report.failure, requests: report.requests.length, evaluation: report.evaluation };
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  try {
    const result = await runLive(parseArgs(process.argv.slice(2)));
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.status === "passed" ? 0 : 1;
  } catch (error) {
    console.log(JSON.stringify({ status: "blocked", failure: { code: error?.code || "report_unavailable" } }));
    process.exitCode = 1;
  }
}
