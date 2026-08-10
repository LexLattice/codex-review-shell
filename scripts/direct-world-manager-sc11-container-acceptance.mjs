#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const composePath = path.join(repoRoot, "docker", "compose.ui-test.yaml");
const runId = `sc11-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
const projectName = `codex-ui-${runId}`.slice(0, 63);
const evidenceDir = path.resolve(
  process.env.CODEX_TEST_EVIDENCE_DIR ||
    path.join(repoRoot, ".cache", "direct-container-ui-tests", runId),
);
const reportPath = path.join(
  evidenceDir,
  "sc11-electron-acceptance-report.json",
);
fs.mkdirSync(evidenceDir, { recursive: true, mode: 0o700 });

function run(args, options = {}) {
  const result = spawnSync("docker", args, {
    cwd: repoRoot,
    env: options.env || process.env,
    encoding: "utf8",
    timeout: options.timeout || 300_000,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return result;
}

const preflight = run(["info", "--format", "{{.ServerVersion}} {{.Name}}"], {
  timeout: 30_000,
});
assert.equal(
  preflight.status,
  0,
  preflight.stderr || "Docker daemon is unavailable.",
);

const environment = {
  ...process.env,
  CODEX_TEST_RUN_ID: runId,
  CODEX_TEST_EVIDENCE_DIR: evidenceDir,
  CODEX_TEST_NETWORK_MODE: "none",
  CODEX_TEST_UID: String(
    typeof process.getuid === "function" ? process.getuid() : 1000,
  ),
  CODEX_TEST_GID: String(
    typeof process.getgid === "function" ? process.getgid() : 1000,
  ),
  CODEX_TEST_MEMORY_LIMIT: "2g",
  CODEX_TEST_CPU_LIMIT: "2",
  CODEX_TEST_PIDS_LIMIT: "512",
  CODEX_TEST_SHM_SIZE: "1g",
  CODEX_TEST_TMPFS_LIMIT: "1g",
  CODEX_TEST_SCREEN: "1600x1050x24",
  CODEX_TEST_IMAGE: "codex-review-shell-ui-test:local",
  CODEX_TEST_RUNNER_SCRIPT:
    "/workspace/scripts/direct-world-manager-sc11-electron-acceptance.mjs",
  CODEX_TEST_EXECUTOR: "docker_xvfb",
};
const compose = ["compose", "-f", composePath, "-p", projectName];

let completed = false;
try {
  const build = run([...compose, "build", "ui-test"], {
    env: environment,
  });
  assert.equal(build.status, 0, build.stderr || "SC11 UI image build failed.");
  const execution = run([
    ...compose,
    "up",
    "--abort-on-container-exit",
    "--exit-code-from",
    "ui-test",
    "--no-color",
  ], { env: environment });
  assert.equal(
    execution.status,
    0,
    execution.stderr || execution.stdout || "SC11 container acceptance failed.",
  );
  assert.equal(fs.existsSync(reportPath), true, "SC11 report was not exported");
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  assert.equal(
    report.schema,
    "direct_world_manager_sc11_electron_acceptance_report@1",
  );
  assert.equal(report.status, "passed");
  assert.equal(report.executor, "docker_xvfb");
  assert.equal(report.realPreloadBridge, true);
  assert.equal(report.realIpcAdmissionHandler, true);
  assert.equal(report.restartPreservedCanonicalAdmission, true);
  completed = true;
  console.log(JSON.stringify({
    schema: "direct_world_manager_sc11_container_acceptance_report@1",
    status: "passed",
    executor: "docker_xvfb",
    isolatedNetwork: "none",
    readOnlyContainerRoot: true,
    realElectronAcceptance: true,
    reportPath: path.relative(repoRoot, reportPath),
  }, null, 2));
} finally {
  const down = run([...compose, "down", "--volumes", "--remove-orphans"], {
    env: environment,
    timeout: 60_000,
  });
  if (completed && down.status !== 0) {
    process.stderr.write("SC11 test passed but container cleanup failed.\n");
  }
}
