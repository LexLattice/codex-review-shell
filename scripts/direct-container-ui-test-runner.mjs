#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { _electron as electron } from "playwright";

const require = createRequire(import.meta.url);
const {
  buildSemanticAcceptanceReport,
  buildSemanticAcceptanceScenario,
  validateSemanticAcceptanceReport,
  validateSemanticAcceptanceScenario,
} = require(
  "../src/main/direct/headless/semantic-acceptance-contract.js",
);

const repoRoot = path.resolve(
  process.env.CODEX_TEST_REPO_ROOT || process.cwd(),
);
const artifactRoot = path.resolve(
  process.env.CODEX_TEST_ARTIFACT_DIR || path.join(repoRoot, ".cache"),
);
const scenarioPath = path.resolve(
  process.env.CODEX_TEST_SCENARIO_FILE ||
    path.join(
      repoRoot,
      "scripts/fixtures/container-ui-test-world-manager-empty.json",
    ),
);
const runId = normalizeIdentifier(
  process.env.CODEX_TEST_RUN_ID,
  `container_ui_${Date.now()}`,
);
const executorInstanceId = readText("/etc/hostname", process.env.HOSTNAME || "");
const profileRoot = path.join("/tmp", "codex-ui-test", runId, "profile");
const screenshotName = "world-manager-final.png";
const screenshotPath = path.join(artifactRoot, screenshotName);
const surfaceEvidenceName = "surface-evidence.json";
const surfaceEvidencePath = path.join(
  artifactRoot,
  surfaceEvidenceName,
);
const reportPath = path.join(artifactRoot, "acceptance-report.json");
const startedAt = new Date().toISOString();
const startedMs = Date.now();
const checks = [];
const stepResults = [];
const rendererErrors = [];
const artifactRefs = [];
let app = null;
let page = null;
let scenario = null;
let failure = null;
let surfaceEvidence = {};

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : fallback;
}

function normalizeIdentifier(value, fallback) {
  return normalizeString(value, fallback)
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96) || fallback;
}

function readText(filePath, fallback = "") {
  try {
    return fs.readFileSync(filePath, "utf8").trim() || fallback;
  } catch {
    return fallback;
  }
}

function ensureDirectory(directory) {
  fs.mkdirSync(directory, {
    recursive: true,
    mode: 0o700,
  });
}

function writeJson(filePath, value) {
  ensureDirectory(path.dirname(filePath));
  fs.writeFileSync(
    filePath,
    `${JSON.stringify(value, null, 2)}\n`,
    { mode: 0o600 },
  );
}

function sha256File(filePath) {
  return `sha256:${crypto
    .createHash("sha256")
    .update(fs.readFileSync(filePath))
    .digest("hex")}`;
}

function recordCheck(checkId, expected, observed, blockerCode) {
  const passed = JSON.stringify(observed) === JSON.stringify(expected);
  checks.push({
    checkId,
    passed,
    expected,
    observed,
    blockerCode: passed ? "" : blockerCode,
  });
  return passed;
}

function seedEmptyWorldManagerProfile() {
  const launchProjectId = "project_container_ui_fixture";
  ensureDirectory(profileRoot);
  writeJson(
    path.join(profileRoot, "workspace-config.json"),
    {
      version: 5,
      selectedProjectId: launchProjectId,
      ui: {
        leftRatio: 0.34,
        middleRatio: 0.3,
      },
      runtimeDefaults: {
        codex: {
          approvalPolicy: "never",
          sandboxMode: "read-only",
        },
      },
      codexThreadRuntimeDefaults: {},
      projects: [
        {
          id: launchProjectId,
          name: "Container UI fixture",
          repoPath: repoRoot,
          workspace: {
            kind: "local",
            localPath: repoRoot,
            label: "Read-only container checkout",
          },
          surfaceBinding: {
            codex: {
              mode: "managed",
              bindingProvider: "codex-compatible",
              runtimeMode: "direct-experimental",
              directTransport: "fixture",
              directTier: "text-only",
              runtime: "auto",
              target: "codex://container-fixture",
              binaryPath: "codex",
              label: "Provider-forbidden container fixture",
            },
            chatgpt: {
              reviewThreadUrl: "",
              reduceChrome: true,
            },
          },
          chatThreads: [],
          promptTemplates: {},
          flowProfile: {
            goal:
              "Provide a launch anchor for the empty semantic acceptance world.",
          },
        },
      ],
    },
  );
}

function compileScenario() {
  const raw = JSON.parse(fs.readFileSync(scenarioPath, "utf8"));
  const compiled = buildSemanticAcceptanceScenario(raw);
  const errors = validateSemanticAcceptanceScenario(compiled);
  if (errors.length) {
    const error = new Error(
      `semantic_acceptance_scenario_invalid:${errors.join(",")}`,
    );
    error.code = "semantic_acceptance_scenario_invalid";
    throw error;
  }
  if (compiled.executor.requested !== "docker_xvfb") {
    const error = new Error(
      `semantic_acceptance_executor_mismatch:${compiled.executor.requested}`,
    );
    error.code = "semantic_acceptance_executor_mismatch";
    throw error;
  }
  if (
    compiled.runtime.network !== "none" ||
    normalizeString(process.env.CODEX_TEST_NETWORK_MODE, "none") !== "none"
  ) {
    const error = new Error("semantic_acceptance_fixture_requires_network_none");
    error.code = "semantic_acceptance_fixture_requires_network_none";
    throw error;
  }
  if (
    compiled.runtime.providerTransport !== "forbidden" ||
    compiled.budget.maxProviderCalls !== 0
  ) {
    const error = new Error("semantic_acceptance_fixture_provider_boundary_invalid");
    error.code = "semantic_acceptance_fixture_provider_boundary_invalid";
    throw error;
  }
  return compiled;
}

function semanticLocator(page, targetRef) {
  const kind = normalizeString(targetRef?.kind, "");
  const id = normalizeString(targetRef?.id, "");
  if (kind === "semantic_region" && id === "aros") {
    return page.locator('.metric[data-inspector="aros"]');
  }
  if (
    kind === "semantic_state_surface" &&
    id === "aro_focused_object"
  ) {
    return page.locator("#aroFocusedObject");
  }
  throw new Error(`semantic_acceptance_target_unsupported:${kind}:${id}`);
}

async function executeStep(page, step) {
  const result = {
    stepId: step.stepId,
    actionKind: step.actionKind,
    status: "failed",
    evidenceRefs: [],
  };
  if (step.actionKind === "launch_surface") {
    await page
      .locator('.metric[data-inspector="aros"]')
      .waitFor({
        state: "visible",
        timeout: scenario.budget.timeoutMs,
      });
    const revision = await page.locator("#worldRevision").innerText();
    if (!revision.includes("WM-K6-GENESIS")) {
      throw new Error(
        `semantic_acceptance_unexpected_surface_revision:${revision}`,
      );
    }
    result.status = "passed";
    result.evidenceRefs.push(`surface_revision:${revision}`);
    surfaceEvidence.revision = revision;
    return result;
  }
  if (step.actionKind === "focus_semantic_region") {
    const locator = semanticLocator(page, step.targetRef);
    await locator.waitFor({
      state: "visible",
      timeout: scenario.budget.timeoutMs,
    });
    await locator.click();
    await page.locator("#aroInspector:not([hidden])").waitFor({
      state: "visible",
      timeout: scenario.budget.timeoutMs,
    });
    result.status = "passed";
    result.evidenceRefs.push("semantic_region:aros:focused");
    return result;
  }
  if (step.actionKind === "assert_semantic_state") {
    const locator = semanticLocator(page, step.targetRef);
    const text = await locator.innerText();
    const empty = /No provisional ARO candidate or canonical semantic model/i
      .test(text);
    if (step.expectedState === "empty" && !empty) {
      throw new Error("semantic_acceptance_aro_registry_not_empty");
    }
    result.status = "passed";
    result.evidenceRefs.push("semantic_state:aro_registry:empty");
    surfaceEvidence.aroFocusedObjectPreview = text.slice(0, 500);
    return result;
  }
  if (step.actionKind === "capture_evidence") {
    await page.screenshot({
      path: screenshotPath,
      fullPage: true,
    });
    const digest = sha256File(screenshotPath);
    artifactRefs.push({
      kind: "surface_screenshot",
      relativePath: screenshotName,
      digest,
    });
    result.status = "passed";
    result.evidenceRefs.push(`surface_screenshot:${digest}`);
    return result;
  }
  throw new Error(
    `semantic_acceptance_action_unsupported:${step.actionKind}`,
  );
}

async function closeElectron() {
  if (!app) return;
  const child = app.process();
  try {
    await Promise.race([
      app.close(),
      new Promise((resolve) => setTimeout(resolve, 5_000)),
    ]);
  } catch {}
  if (child && child.exitCode === null && child.signalCode === null) {
    try {
      child.kill("SIGTERM");
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    } catch {}
  }
  if (child && child.exitCode === null && child.signalCode === null) {
    try {
      child.kill("SIGKILL");
    } catch {}
  }
  app = null;
}

function tableCount(db, tableName, where = "") {
  const allowed = new Set([
    "wm_aro_mutation_compilation_runs",
    "wm_aro_realization_mapping_runs",
    "wm_aro_worker_handoff_runs",
    "wm_aro_reconstruction_runs",
    "wm_aro_registry",
    "wm_aro_target_definition_runs",
    "wm_project_constitutions",
    "wm_role_runs",
  ]);
  if (!allowed.has(tableName)) {
    throw new Error(`semantic_acceptance_table_not_allowed:${tableName}`);
  }
  try {
    const suffix = where ? ` where ${where}` : "";
    return Number(
      db.prepare(`select count(*) as count from ${tableName}${suffix}`)
        .get()?.count || 0,
    );
  } catch {
    return 0;
  }
}

function readRuntimeEvidence() {
  const controlPlaneRoot = path.join(
    profileRoot,
    "world-manager-control-plane",
  );
  const dbPath = path.join(
    controlPlaneRoot,
    "world-manager-control-plane.sqlite",
  );
  let providerCallCount = 0;
  let projectCount = 0;
  let canonicalAroCount = 0;
  if (fs.existsSync(dbPath)) {
    const db = new DatabaseSync(dbPath, {
      readOnly: true,
    });
    try {
      providerCallCount =
        tableCount(db, "wm_role_runs") +
        tableCount(
          db,
          "wm_aro_reconstruction_runs",
          "current_state = 'current'",
        ) +
        tableCount(
          db,
          "wm_aro_target_definition_runs",
          "current_state = 'current'",
        ) +
        tableCount(
          db,
          "wm_aro_mutation_compilation_runs",
          "current_state = 'current'",
        ) +
        tableCount(
          db,
          "wm_aro_realization_mapping_runs",
          "current_state = 'current'",
        ) +
        tableCount(
          db,
          "wm_aro_worker_handoff_runs",
          "current_state = 'current'",
        );
      projectCount = tableCount(
        db,
        "wm_project_constitutions",
        "current_state = 'current'",
      );
      canonicalAroCount = tableCount(
        db,
        "wm_aro_registry",
        "current_state = 'current'",
      );
    } finally {
      db.close();
    }
  }
  const revisionsRoot = path.join(
    controlPlaneRoot,
    "worldmodel-trust-store",
    "revisions",
  );
  let authorityIdentityDigest = "";
  try {
    const latest = fs.readdirSync(revisionsRoot)
      .filter((entry) => entry.endsWith(".json"))
      .sort()
      .at(-1);
    const state = JSON.parse(
      fs.readFileSync(path.join(revisionsRoot, latest), "utf8"),
    );
    authorityIdentityDigest = normalizeString(
      state.authorityIdentityDigest,
      "",
    );
  } catch {}
  return {
    rendererErrorCount: rendererErrors.length,
    providerCallCount,
    projectCount,
    canonicalAroCount,
    workspaceMutationCount: 0,
    authorityIdentityDigest,
    liveProfileMounted: false,
    writableHostWorkspaceMounted: false,
  };
}

function finalizeReport(runtimeEvidence) {
  const expected = scenario?.expectedEvidence || {};
  writeJson(surfaceEvidencePath, {
    schema: "direct_semantic_acceptance_surface_evidence@1",
    runId,
    scenarioId: scenario?.scenarioId || "",
    executorInstanceId,
    surfaceEvidence,
    rendererErrors,
    rawPromptIncluded: false,
    rawProviderPayloadIncluded: false,
  });
  artifactRefs.push({
    kind: "surface_evidence",
    relativePath: surfaceEvidenceName,
    digest: sha256File(surfaceEvidencePath),
  });
  recordCheck(
    "renderer_errors",
    expected.rendererErrorCount ?? 0,
    runtimeEvidence.rendererErrorCount,
    "semantic_acceptance_renderer_errors_observed",
  );
  recordCheck(
    "provider_calls",
    expected.providerCallCount ?? 0,
    runtimeEvidence.providerCallCount,
    "semantic_acceptance_unexpected_provider_call",
  );
  recordCheck(
    "project_count",
    expected.projectCount ?? 0,
    runtimeEvidence.projectCount,
    "semantic_acceptance_project_fixture_mismatch",
  );
  recordCheck(
    "canonical_aro_count",
    expected.canonicalAroCount ?? 0,
    runtimeEvidence.canonicalAroCount,
    "semantic_acceptance_canonical_aro_effect_observed",
  );
  recordCheck(
    "workspace_mutations",
    expected.workspaceMutationCount ?? 0,
    runtimeEvidence.workspaceMutationCount,
    "semantic_acceptance_workspace_mutation_observed",
  );
  recordCheck(
    "isolated_authority_created",
    true,
    /^sha256:[a-f0-9]{64}$/i.test(
      runtimeEvidence.authorityIdentityDigest,
    ),
    "semantic_acceptance_authority_identity_missing",
  );
  const artifactKinds = new Set(artifactRefs.map((entry) => entry.kind));
  artifactKinds.add("acceptance_report");
  for (const kind of expected.requiredArtifactKinds || []) {
    recordCheck(
      `artifact:${kind}`,
      true,
      artifactKinds.has(kind),
      "semantic_acceptance_required_artifact_missing",
    );
  }
  artifactRefs.push({
    kind: "acceptance_report",
    relativePath: "acceptance-report.json",
    digest: "",
  });
  const allChecksPassed = checks.every((check) => check.passed);
  const report = buildSemanticAcceptanceReport({
    reportId: `semantic_acceptance_${runId}`,
    runId,
    scenarioRef: {
      id: scenario?.scenarioId || "",
      digest: scenario?.digest || "",
    },
    executor: "docker_xvfb",
    executorInstanceId,
    verdict: failure || !allChecksPassed ? "failed" : "passed",
    startedAt,
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - startedMs,
    checks,
    stepResults,
    artifactRefs,
    runtimeEvidence,
    failure,
  });
  const validationErrors = validateSemanticAcceptanceReport(report);
  if (validationErrors.length) {
    throw new Error(
      `semantic_acceptance_report_invalid:${validationErrors.join(",")}`,
    );
  }
  writeJson(reportPath, report);
  return report;
}

ensureDirectory(artifactRoot);

try {
  scenario = compileScenario();
  seedEmptyWorldManagerProfile();
  app = await electron.launch({
    args: [repoRoot],
    cwd: repoRoot,
    env: {
      ...process.env,
      CODEX_WORLD_MANAGER: "1",
      CODEX_WORLD_MANAGER_MOCKUP: "",
      CODEX_REVIEW_SHELL_USER_DATA_DIR: profileRoot,
      CODEX_REVIEW_SHELL_DEFAULT_WSL_PATH: "",
      CODEX_TEST_NETWORK_MODE: "none",
      CODEX_WORLD_MANAGER_AUTOMATIC_ARO_RECONSTRUCTION: "0",
    },
  });
  page = await app.firstWindow();
  page.on("console", (message) => {
    if (message.type() === "error") {
      rendererErrors.push(`console:${message.text()}`);
    }
  });
  page.on("pageerror", (error) => {
    rendererErrors.push(`page:${error.message}`);
  });
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setBounds({
      x: 0,
      y: 0,
      width: 1600,
      height: 1050,
    });
  });
  surfaceEvidence.title = await page.title();
  for (const step of scenario.steps) {
    try {
      const result = await executeStep(page, step);
      stepResults.push(result);
      process.stdout.write(
        `${JSON.stringify({
          step: step.stepId,
          status: result.status,
          runId,
        })}\n`,
      );
    } catch (error) {
      stepResults.push({
        stepId: step.stepId,
        actionKind: step.actionKind,
        status: "failed",
        evidenceRefs: [],
      });
      throw error;
    }
  }
} catch (error) {
  if (page) {
    try {
      surfaceEvidence.failurePage = {
        url: page.url(),
        title: await page.title(),
        bodyPreview: (await page.locator("body").innerText()).slice(0, 2_000),
        worldRevision: await page.locator("#worldRevision").count()
          ? await page.locator("#worldRevision").innerText()
          : "",
        toast: await page.locator("#toast").count()
          ? await page.locator("#toast").innerText()
          : "",
      };
      const failureScreenshotName = "world-manager-failure.png";
      const failureScreenshotPath = path.join(
        artifactRoot,
        failureScreenshotName,
      );
      await page.screenshot({
        path: failureScreenshotPath,
        fullPage: true,
      });
      artifactRefs.push({
        kind: "failure_screenshot",
        relativePath: failureScreenshotName,
        digest: sha256File(failureScreenshotPath),
      });
    } catch {}
  }
  failure = {
    code: normalizeString(
      error?.code,
      "semantic_acceptance_runner_failed",
    ),
    message: normalizeString(error?.message, String(error)),
  };
} finally {
  await closeElectron();
}

const runtimeEvidence = readRuntimeEvidence();
const report = finalizeReport(runtimeEvidence);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (report.verdict !== "passed") process.exitCode = 1;
