#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const {
  validateSemanticAcceptanceReport,
} = require(
  "../src/main/direct/headless/semantic-acceptance-contract.js",
);

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const launcherPath = path.join(
  scriptDir,
  "direct-container-ui-test-stack.mjs",
);
const suiteRunId = `parallel-${Date.now()}-${Math.random()
  .toString(16)
  .slice(2, 10)}`;
const suiteRoot = path.join(
  repoRoot,
  ".cache",
  "direct-container-ui-tests",
  suiteRunId,
);

function ensureDirectory(directory) {
  fs.mkdirSync(directory, {
    recursive: true,
    mode: 0o700,
  });
}

function runLauncher(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [launcherPath, ...args],
      {
        cwd: repoRoot,
        env: process.env,
        stdio: "inherit",
      },
    );
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) {
        reject(
          new Error(`container_ui_parallel_child_signaled:${signal}`),
        );
        return;
      }
      resolve(code ?? 1);
    });
  });
}

function readReport(runRoot) {
  const reportPath = path.join(runRoot, "acceptance-report.json");
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  assert.deepEqual(
    validateSemanticAcceptanceReport(report),
    [],
    `Invalid report: ${reportPath}`,
  );
  return { report, reportPath };
}

ensureDirectory(suiteRoot);
const buildRoot = path.join(suiteRoot, "build");
ensureDirectory(buildRoot);
const buildStatus = await runLauncher([
  "--build-only",
  `--run-id=${suiteRunId}-build`,
  `--evidence-dir=${buildRoot}`,
]);
assert.equal(buildStatus, 0, "container_ui_parallel_image_build_failed");

const instances = ["a", "b"].map((suffix) => {
  const evidenceDir = path.join(suiteRoot, suffix);
  ensureDirectory(evidenceDir);
  return {
    suffix,
    evidenceDir,
    promise: runLauncher([
      "--no-build",
      `--run-id=${suiteRunId}-${suffix}`,
      `--evidence-dir=${evidenceDir}`,
      "--memory-limit=2g",
      "--cpu-limit=2",
    ]),
  };
});

const statuses = await Promise.all(
  instances.map((instance) => instance.promise),
);
assert.deepEqual(statuses, [0, 0]);

const reports = instances.map((instance) => ({
  ...instance,
  ...readReport(instance.evidenceDir),
}));
for (const entry of reports) {
  assert.equal(entry.report.verdict, "passed");
  assert.equal(entry.report.executor, "docker_xvfb");
  assert.equal(entry.report.runtimeEvidence.providerCallCount, 0);
  assert.equal(entry.report.runtimeEvidence.workspaceMutationCount, 0);
  assert.equal(entry.report.runtimeEvidence.liveProfileMounted, false);
  assert.equal(
    entry.report.runtimeEvidence.writableHostWorkspaceMounted,
    false,
  );
  assert.equal(
    fs.existsSync(
      path.join(entry.evidenceDir, "world-manager-final.png"),
    ),
    true,
  );
}
assert.notEqual(
  reports[0].report.executorInstanceId,
  reports[1].report.executorInstanceId,
  "parallel stacks must have distinct container identities",
);
assert.notEqual(
  reports[0].report.runtimeEvidence.authorityIdentityDigest,
  reports[1].report.runtimeEvidence.authorityIdentityDigest,
  "parallel stacks must have distinct test-world authorities",
);

const suiteReport = {
  schema: "direct_container_ui_parallel_isolation_report@1",
  suiteRunId,
  status: "passed",
  stackCount: reports.length,
  concurrent: true,
  executor: "docker_xvfb",
  distinctExecutorInstances: true,
  distinctAuthorityIdentities: true,
  providerCallCount: reports.reduce(
    (total, entry) =>
      total + entry.report.runtimeEvidence.providerCallCount,
    0,
  ),
  workspaceMutationCount: reports.reduce(
    (total, entry) =>
      total + entry.report.runtimeEvidence.workspaceMutationCount,
    0,
  ),
  liveProfileMounted: false,
  writableHostWorkspaceMounted: false,
  reports: reports.map((entry) => ({
    runId: entry.report.runId,
    executorInstanceId: entry.report.executorInstanceId,
    authorityIdentityDigest:
      entry.report.runtimeEvidence.authorityIdentityDigest,
    reportPath: path.relative(repoRoot, entry.reportPath),
  })),
};
const suiteReportPath = path.join(
  suiteRoot,
  "parallel-isolation-report.json",
);
fs.writeFileSync(
  suiteReportPath,
  `${JSON.stringify(suiteReport, null, 2)}\n`,
  { mode: 0o600 },
);

console.log(
  JSON.stringify(
    {
      ok: true,
      regression: "direct-container-ui-test-stack",
      suiteReportPath,
      ...suiteReport,
    },
    null,
    2,
  ),
);
