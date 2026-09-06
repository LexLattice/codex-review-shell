#!/usr/bin/env node
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { collectExecEvidence, evaluateAcceptanceEvidence, externalOutputRoot, fixtureManifest } from "./direct-everyday-live-acceptance.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sha = (value) => crypto.createHash("sha256").update(value).digest("hex");
const fixedSource = "function add(a, b) {\n  return a + b;\n}\n\nmodule.exports = { add };\n";
const expected = { taskId: "task", projectId: "project", grantId: "grant", grantRevision: 1 };
const output = { schema: "direct_stateful_exec_result@1", sessionId: "exec", ...expected, resultDigest: "digest", status: "completed", exitCode: 0, timedOut: false };
const result = { resultId: "result", resultKind: "stateful_exec", sideEffectExecuted: true, providerOutputText: JSON.stringify(output) };
const turn = {
  toolResults: [result],
  unresolvedObligations: [{
    obligationId: "obligation", name: "exec_command", result: { resultId: "result" },
    approvalPolicy: "never", sideEffectExecuted: true, approvalAvailable: false,
    executionAllowed: false, authorityState: "utility_result_recorded",
    harnessGrantId: "grant", harnessGrantRevision: 1, statefulExecSessionId: "exec",
  }],
};
const execEvidence = collectExecEvidence(turn, expected);
assert.equal(execEvidence[0].joined, true, "completed production result remains evidence when re-execution is disallowed");
const before = { "src/calc.js": sha(fixedSource.replace("a + b", "a - b")), "test.js": "test-digest", "package.json": "manifest-digest" };
const after = { ...before, "src/calc.js": sha(fixedSource) };
const base = {
  before, after, providerState: "completed", oracleStatus: 0, execEvidence,
  selectedRuntimePreserved: true, sourceCheckoutUnchanged: true, approvalRequestCount: 0,
  resumed: true, persistedTask: true, persistedGrant: true,
};
assert.equal(evaluateAcceptanceEvidence(base).ok, true);
const cases = [
  ["no mutation", (x) => { x.after = { ...before }; }],
  ["wrong mutation", (x) => { x.after["src/calc.js"] = sha("wrong"); }],
  ["changed test", (x) => { x.after["test.js"] = "changed"; }],
  ["deleted test", (x) => { delete x.after["test.js"]; }],
  ["changed manifest", (x) => { x.after["package.json"] = "changed"; }],
  ["deleted manifest", (x) => { delete x.after["package.json"]; }],
  ["unexpected file", (x) => { x.after["extra"] = "extra"; }],
  ["failed independent test", (x) => { x.oracleStatus = 1; }],
  ["missing tool evidence", (x) => { x.execEvidence = []; }],
  ["failed command", (x) => { x.execEvidence[0].exitCode = 1; }],
  ["incomplete provider", (x) => { x.providerState = "tool_waiting"; }],
  ["failed provider", (x) => { x.providerState = "failed"; }],
  ["wrong selected model", (x) => { x.selectedRuntimePreserved = false; }],
  ["changed checkout", (x) => { x.sourceCheckoutUnchanged = false; }],
  ["per-call approval", (x) => { x.approvalRequestCount = 1; }],
  ["missing task", (x) => { x.persistedTask = false; }],
  ["missing grant", (x) => { x.persistedGrant = false; }],
  ["failed resume", (x) => { x.resumed = false; }],
];
for (const [name, mutate] of cases) {
  const candidate = structuredClone(base);
  mutate(candidate);
  assert.equal(evaluateAcceptanceEvidence(candidate).ok, false, name);
}
const carrierCases = [
  ["missing recorded result", (t) => { t.toolResults = []; }],
  ["foreign grant", (t) => { t.unresolvedObligations[0].harnessGrantId = "foreign"; }],
  ["missing automatic approval", (t) => { t.unresolvedObligations[0].approvalPolicy = "per_session"; }],
  ["wrong result identity", (t) => { t.toolResults[0].resultId = "foreign"; }],
  ["malformed output", (t) => { t.toolResults[0].providerOutputText = "{"; }],
  ["foreign producer", (t) => { t.toolResults[0].providerOutputText = JSON.stringify({ ...output, taskId: "foreign" }); }],
  ["foreign exec session", (t) => { t.toolResults[0].providerOutputText = JSON.stringify({ ...output, sessionId: "foreign" }); }],
];
for (const [name, mutate] of carrierCases) {
  const candidate = structuredClone(turn);
  mutate(candidate);
  assert.equal(evaluateAcceptanceEvidence({ ...base, execEvidence: collectExecEvidence(candidate, expected) }).ok, false, name);
}
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "direct-everyday-oracle-"));
try {
  const workspace = path.join(temp, "fixture");
  fs.mkdirSync(path.join(workspace, "src"), { recursive: true });
  fs.writeFileSync(path.join(workspace, "src/calc.js"), fixedSource);
  fs.writeFileSync(path.join(workspace, "test.js"), "require('node:assert/strict').equal(require('./src/calc').add(2, 3), 5);\n");
  fs.writeFileSync(path.join(workspace, "package.json"), '{"private":true}\n');
  const actual = fixtureManifest(workspace);
  assert.equal(actual["src/calc.js"], after["src/calc.js"], "the oracle compares hashes with hashes");
  assert.equal(spawnSync(process.execPath, ["test.js"], { cwd: workspace, timeout: 5_000 }).status, 0);
  fs.symlinkSync(repoRoot, path.join(temp, "checkout-link"));
  assert.throws(() => externalOutputRoot(path.join(repoRoot, "new-output")), { code: "output_root_inside_checkout" });
  assert.throws(() => externalOutputRoot(path.join(temp, "checkout-link", "new-output")), { code: "output_root_inside_checkout" });
  assert.equal(externalOutputRoot(path.join(temp, "new-output")), path.join(temp, "new-output"));
  const refused = spawnSync(process.execPath, [path.join(repoRoot, "scripts/direct-everyday-live-acceptance.mjs"), "--output-root", path.join(temp, "no-opt-in")], { encoding: "utf8", timeout: 5_000 });
  assert.equal(refused.status, 1);
  assert.equal(JSON.parse(refused.stdout).failure.code, "live_opt_in_required");
  assert.equal(fs.existsSync(path.join(temp, "no-opt-in")), false);
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
console.log(JSON.stringify({ schema: "direct_everyday_live_acceptance_offline_regression@1", status: "passed", liveEvidence: false, executableNegativeCases: cases.length + carrierCases.length, exactCarrierJoin: true, realFixtureOracle: true, outputContainment: true, optInRequired: true }, null, 2));
