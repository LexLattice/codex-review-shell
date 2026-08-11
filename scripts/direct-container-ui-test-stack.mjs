#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const {
  buildSemanticAcceptanceScenario,
  validateSemanticAcceptanceReport,
  validateSemanticAcceptanceScenario,
} = require(
  "../src/main/direct/headless/semantic-acceptance-contract.js",
);

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const composePath = path.join(repoRoot, "docker", "compose.ui-test.yaml");
const defaultScenarioPath = path.join(
  repoRoot,
  "scripts",
  "fixtures",
  "container-ui-test-world-manager-empty.json",
);

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      throw new Error(`Unknown argument: ${arg}`);
    }
    const raw = arg.slice(2);
    const equals = raw.indexOf("=");
    if (equals >= 0) {
      options[raw.slice(0, equals)] = raw.slice(equals + 1);
      continue;
    }
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      options[raw] = next;
      index += 1;
    } else {
      options[raw] = true;
    }
  }
  return options;
}

function optionString(options, key, fallback = "") {
  const value = options[key];
  return typeof value === "string" && value.trim()
    ? value.trim()
    : fallback;
}

function optionFlag(options, key, fallback = false) {
  if (options[key] === undefined) return fallback;
  if (typeof options[key] === "boolean") return options[key];
  return /^(1|true|yes)$/i.test(String(options[key] || "").trim());
}

function normalizeIdentifier(value, fallback) {
  return optionString({ value }, "value", fallback)
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || fallback;
}

function ensureDirectory(directory) {
  fs.mkdirSync(directory, {
    recursive: true,
    mode: 0o700,
  });
}

function pathInside(parent, child) {
  const relative = path.relative(parent, child);
  return (
    relative !== "" &&
    !relative.startsWith(`..${path.sep}`) &&
    relative !== ".." &&
    !path.isAbsolute(relative)
  );
}

function dockerPreflight() {
  const result = spawnSync(
    "docker",
    ["info", "--format", "{{.ServerVersion}} {{.Name}}"],
    {
      cwd: repoRoot,
      encoding: "utf8",
    },
  );
  if (result.status !== 0) {
    const error = new Error(
      result.stderr?.trim() ||
        result.stdout?.trim() ||
        "Docker daemon is unavailable.",
    );
    error.code = "container_ui_test_docker_unavailable";
    throw error;
  }
  return result.stdout.trim();
}

function compileScenario(scenarioPath) {
  const raw = JSON.parse(fs.readFileSync(scenarioPath, "utf8"));
  const scenario = buildSemanticAcceptanceScenario(raw);
  const errors = validateSemanticAcceptanceScenario(scenario);
  if (errors.length) {
    throw new Error(
      `container_ui_test_scenario_invalid:${errors.join(",")}`,
    );
  }
  if (scenario.executor.requested !== "docker_xvfb") {
    throw new Error(
      `container_ui_test_executor_mismatch:${scenario.executor.requested}`,
    );
  }
  if (
    scenario.runtime.network !== "none" ||
    scenario.runtime.providerTransport !== "forbidden" ||
    scenario.budget.maxProviderCalls !== 0 ||
    scenario.runtime.workspaceMutation !== "forbidden"
  ) {
    throw new Error("container_ui_test_v1_fixture_boundary_required");
  }
  return scenario;
}

async function runCommand(command, args, options = {}) {
  const logStream = options.logPath
    ? fs.createWriteStream(options.logPath, {
        flags: "a",
        mode: 0o600,
      })
    : null;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || repoRoot,
      env: options.env || process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (chunk) => {
      process.stdout.write(chunk);
      logStream?.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      process.stderr.write(chunk);
      logStream?.write(chunk);
    });
    child.on("error", (error) => {
      logStream?.end();
      reject(error);
    });
    child.on("exit", (code, signal) => {
      logStream?.end();
      if (signal) {
        reject(
          new Error(
            `container_ui_test_command_signaled:${command}:${signal}`,
          ),
        );
        return;
      }
      resolve(code ?? 1);
    });
  });
}

const options = parseArgs(process.argv.slice(2));
const runId = normalizeIdentifier(
  optionString(options, "run-id", ""),
  `ui-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`,
);
const projectName = `codex-ui-${runId.toLowerCase()}`.slice(0, 63);
const scenarioPath = path.resolve(
  optionString(options, "scenario-file", defaultScenarioPath),
);
if (!pathInside(repoRoot, scenarioPath)) {
  throw new Error("container_ui_test_scenario_must_be_inside_repo");
}
const scenario = compileScenario(scenarioPath);
const evidenceDir = path.resolve(
  optionString(
    options,
    "evidence-dir",
    path.join(repoRoot, ".cache", "direct-container-ui-tests", runId),
  ),
);
ensureDirectory(evidenceDir);
const reportPath = path.join(evidenceDir, "acceptance-report.json");
const logPath = path.join(evidenceDir, "stack.log");
const dockerStatus = dockerPreflight();
const containerScenarioPath = `/workspace/${path
  .relative(repoRoot, scenarioPath)
  .split(path.sep)
  .join("/")}`;
const environment = {
  ...process.env,
  CODEX_TEST_RUN_ID: runId,
  CODEX_TEST_EVIDENCE_DIR: evidenceDir,
  CODEX_TEST_SCENARIO_FILE: containerScenarioPath,
  CODEX_TEST_NETWORK_MODE: "none",
  CODEX_TEST_UID: String(
    typeof process.getuid === "function" ? process.getuid() : 1000,
  ),
  CODEX_TEST_GID: String(
    typeof process.getgid === "function" ? process.getgid() : 1000,
  ),
  CODEX_TEST_MEMORY_LIMIT: optionString(
    options,
    "memory-limit",
    `${scenario.budget.memoryMb}m`,
  ),
  CODEX_TEST_CPU_LIMIT: optionString(
    options,
    "cpu-limit",
    String(scenario.budget.cpuCount),
  ),
  CODEX_TEST_PIDS_LIMIT: optionString(options, "pids-limit", "512"),
  CODEX_TEST_SHM_SIZE: optionString(options, "shm-size", "1g"),
  CODEX_TEST_TMPFS_LIMIT: optionString(options, "tmpfs-limit", "1g"),
  CODEX_TEST_SCREEN: optionString(options, "screen", "1600x1050x24"),
  CODEX_TEST_IMAGE: optionString(
    options,
    "image",
    "codex-review-shell-ui-test:local",
  ),
};
const compose = [
  "compose",
  "-f",
  composePath,
  "-p",
  projectName,
];
const keep = optionFlag(options, "keep", false);
const buildOnly = optionFlag(options, "build-only", false);
const noBuild = optionFlag(options, "no-build", false);

let runStatus = 1;
try {
  if (!noBuild) {
    const buildStatus = await runCommand(
      "docker",
      [...compose, "build", "ui-test"],
      {
        env: environment,
        logPath,
      },
    );
    if (buildStatus !== 0) {
      throw new Error(`container_ui_test_build_failed:${buildStatus}`);
    }
  }
  if (buildOnly) {
    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        operation: "build-only",
        image: environment.CODEX_TEST_IMAGE,
        dockerStatus,
      }, null, 2)}\n`,
    );
    runStatus = 0;
  } else {
    runStatus = await runCommand(
      "docker",
      [
        ...compose,
        "up",
        "--abort-on-container-exit",
        "--exit-code-from",
        "ui-test",
        "--no-color",
      ],
      {
        env: environment,
        logPath,
      },
    );
    if (!fs.existsSync(reportPath)) {
      throw new Error(
        `container_ui_test_report_missing:status=${runStatus}`,
      );
    }
    const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
    const validationErrors = validateSemanticAcceptanceReport(report);
    if (validationErrors.length) {
      throw new Error(
        `container_ui_test_report_invalid:${validationErrors.join(",")}`,
      );
    }
    if (runStatus !== 0 || report.verdict !== "passed") {
      throw new Error(
        `container_ui_test_failed:status=${runStatus}:verdict=${report.verdict}`,
      );
    }
    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        operation: "run",
        runId,
        projectName,
        executor: "docker_xvfb",
        scenarioRef: report.scenarioRef,
        executorInstanceId: report.executorInstanceId,
        evidenceDir,
        reportPath,
        dockerStatus,
      }, null, 2)}\n`,
    );
  }
} finally {
  if (!keep) {
    await runCommand(
      "docker",
      [...compose, "down", "--volumes", "--remove-orphans"],
      {
        env: environment,
        logPath,
      },
    ).catch(() => {});
  }
}

process.exitCode = runStatus;
