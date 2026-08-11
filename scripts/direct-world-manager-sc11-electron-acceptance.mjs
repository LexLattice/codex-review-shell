#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const projectId = "project_runtime_evidence_fixture";
const configuredRoot = String(
  process.env.CODEX_WORLD_MANAGER_SC11_ELECTRON_ROOT || "",
).trim();
const testRoot = configuredRoot
  ? path.resolve(configuredRoot)
  : fs.mkdtempSync(path.join(os.tmpdir(), "world-manager-sc11-electron-"));
const userDataRoot = path.join(testRoot, "profile");
const artifactRoot = path.resolve(
  process.env.CODEX_TEST_ARTIFACT_DIR || path.join(testRoot, "artifacts"),
);
const reportPath = path.join(
  artifactRoot,
  "sc11-electron-acceptance-report.json",
);
const screenshotPath = path.join(
  artifactRoot,
  "sc11-electron-admitted.png",
);
const gateProjectionPath = path.join(testRoot, "gate-projection.json");
const rendererErrors = [];

fs.mkdirSync(userDataRoot, { recursive: true });
fs.mkdirSync(artifactRoot, { recursive: true });

fs.writeFileSync(
  path.join(userDataRoot, "workspace-config.json"),
  `${JSON.stringify({
    version: 5,
    selectedProjectId: projectId,
    runtimeDefaults: {
      codex: {
        approvalPolicy: "never",
        sandboxMode: "read-only",
      },
    },
    projects: [{
      id: projectId,
      name: "Runtime evidence bridge fixture",
      repoPath: repoRoot,
      workspace: {
        kind: "local",
        localPath: repoRoot,
        label: "SC11 isolated acceptance checkout",
      },
      surfaceBinding: {
        codex: {
          mode: "managed",
          bindingProvider: "codex-compatible",
          runtimeMode: "direct-experimental",
          directTransport: "fixture",
          directTier: "implementation-lane",
          runtime: "auto",
          target: "codex://sc11-acceptance",
          binaryPath: "codex",
          label: "Provider-forbidden SC11 fixture",
        },
        chatgpt: {
          reviewThreadUrl: "",
          reduceChrome: true,
        },
      },
      chatThreads: [],
      promptTemplates: {},
      flowProfile: {
        goal: "Prove the production SC11.8 semantic-CI admission surface.",
      },
    }],
  }, null, 2)}\n`,
  { mode: 0o600 },
);

const fixture = spawnSync(
  process.execPath,
  [path.join(scriptDir, "direct-world-manager-runtime-evidence-bridge-regression.mjs")],
  {
    cwd: repoRoot,
    env: {
      ...process.env,
      CODEX_WORLD_MANAGER_SC11_RUNTIME_ROOT: path.join(
        userDataRoot,
        "world-manager-control-plane",
      ),
      CODEX_WORLD_MANAGER_SC11_FULL_GATE_PROJECTION_PATH: gateProjectionPath,
      CODEX_WORLD_MANAGER_SC11_STOP_AT_GATE: "1",
    },
    encoding: "utf8",
    timeout: 120_000,
  },
);
assert.equal(fixture.status, 0, fixture.stderr || fixture.stdout);
const gateProjection = JSON.parse(fs.readFileSync(gateProjectionPath, "utf8"));
const gateCard = gateProjection.epistemicFabric.lifecycleCards.find(
  (card) => card.authorityState === "gate_ready",
);
assert(gateCard, "SC11 Electron fixture did not reach gate_ready");

function launchEnvironment() {
  const environment = {
    ...process.env,
    CODEX_WORLD_MANAGER: "1",
    CODEX_REVIEW_SHELL_USER_DATA_DIR: userDataRoot,
    CODEX_REVIEW_SHELL_DEFAULT_WSL_PATH: "",
    CODEX_WORLD_MANAGER_AUTOMATIC_ARO_RECONSTRUCTION: "0",
    LIBGL_ALWAYS_SOFTWARE: "1",
  };
  delete environment.CODEX_WORLD_MANAGER_MOCKUP;
  return environment;
}

async function launchSurface() {
  const app = await electron.launch({
    args: [repoRoot, "--disable-gpu"],
    cwd: repoRoot,
    env: launchEnvironment(),
  });
  const page = await app.firstWindow();
  page.on("console", (message) => {
    if (message.type() === "error") {
      rendererErrors.push(`console:${message.text()}`);
    }
  });
  page.on("pageerror", (error) => {
    rendererErrors.push(`page:${error.message}`);
  });
  await page.waitForSelector("#worldRevision", { timeout: 30_000 });
  try {
    await page.waitForFunction(
      () => document.querySelector("#worldRevision")?.textContent
        ?.includes("WM-K6-GENESIS"),
      null,
      { timeout: 30_000 },
    );
  } catch (error) {
    console.error(JSON.stringify({
      phase: "launch_surface",
      url: page.url(),
      revision: await page.locator("#worldRevision").innerText().catch(() => ""),
      toast: await page.locator("#toast").innerText().catch(() => ""),
      body: await page.locator("body").innerText().catch(() => ""),
      rendererErrors,
    }, null, 2));
    throw error;
  }
  await page.locator('.metric[data-inspector="epistemic"]').click();
  await page.locator("#epistemicFabricInspector:not([hidden])").waitFor({
    state: "visible",
    timeout: 30_000,
  });
  return { app, page };
}

async function closeSurface(app) {
  try {
    await app.close();
  } catch {}
}

let firstApp = null;
let restartedApp = null;
try {
  const first = await launchSurface();
  firstApp = first.app;
  assert.match(
    await first.page.locator("#epistemicFocusedLifecycle").innerText(),
    /gate ready[\s\S]*canonical admission has not occurred/i,
  );

  const staleSurfaceAttempt = await first.page.evaluate(async () => {
    const projection = await window.codexSurfaceBridge
      .getWorldManagerSnapshot();
    const card = projection.epistemicFabric.lifecycleCards.find(
      (entry) => entry.authorityState === "gate_ready",
    );
    try {
      await window.codexSurfaceBridge.requestWorldManagerArtifactAdmission({
        schema: "direct_world_manager_artifact_admission_request@1",
        lifecycleId: card.lifecycleRef.id,
        lifecycleRef: card.lifecycleRef,
        artifactRevisionRef: card.currentArtifactRevisionRef,
        gateDecisionRef: card.gateDecisionRef,
        admissionAuthorityRef: card.admissionAuthorityRef,
        targetAdmissionScope: card.targetAdmissionScope,
        expectedCanonicalRevisionRefs: card.expectedCanonicalRevisionRefs,
        reviewedEvidenceRefs: card.evidenceRefs.slice(1),
        operatorReviewAcknowledged: true,
      });
      return { rejected: false, message: "" };
    } catch (error) {
      return {
        rejected: true,
        message: String(error?.message || error),
      };
    }
  });
  assert.equal(staleSurfaceAttempt.rejected, true);
  assert.match(
    staleSurfaceAttempt.message,
    /world_manager_artifact_admission_surface_binding_stale/,
  );
  assert.match(
    await first.page.locator("#epistemicFocusedLifecycle").innerText(),
    /gate ready[\s\S]*canonical admission has not occurred/i,
  );

  await first.page.locator(".epistemic-review-admission").click();
  assert.equal(
    await first.page.locator(".epistemic-confirm-admission").count(),
    1,
  );
  assert.match(
    await first.page.locator("#epistemicFocusedLifecycle").innerText(),
    /exact evidence refs[\s\S]*confirm admission of the exact displayed revision/i,
  );
  await first.page.locator(".epistemic-confirm-admission").click();
  try {
    await first.page.waitForFunction(
      () => document.querySelector("#epistemicFocusedLifecycle")?.textContent
        ?.toLowerCase()
        .includes("canonical styling is backed"),
      null,
      { timeout: 30_000 },
    );
  } catch (error) {
    console.error(JSON.stringify({
      phase: "confirm_scoped_admission",
      toast: await first.page.locator("#toast").innerText().catch(() => ""),
      lifecycle: await first.page
        .locator("#epistemicFocusedLifecycle")
        .innerText()
        .catch(() => ""),
      rendererErrors,
    }, null, 2));
    throw error;
  }
  const admittedText = await first.page
    .locator("#epistemicFocusedLifecycle")
    .innerText();
  assert.match(admittedText, /admitted/i);
  assert.match(
    admittedText,
    /worldmodel_graph_transition|canonical admission recorded/i,
  );
  const admittedLayout = await first.page.evaluate(() => {
    const inspector = document.querySelector("#epistemicFabricInspector");
    const focused = document.querySelector("#epistemicFocusedLifecycle");
    return {
      inspectorOverflow: inspector.scrollWidth - inspector.clientWidth,
      focusedOverflow: focused.scrollWidth - focused.clientWidth,
    };
  });
  assert.ok(
    admittedLayout.inspectorOverflow <= 2,
    JSON.stringify(admittedLayout),
  );
  assert.ok(
    admittedLayout.focusedOverflow <= 2,
    JSON.stringify(admittedLayout),
  );
  await first.page.screenshot({ path: screenshotPath, fullPage: true });
  await closeSurface(firstApp);
  firstApp = null;

  const restarted = await launchSurface();
  restartedApp = restarted.app;
  const restartedText = await restarted.page
    .locator("#epistemicFocusedLifecycle")
    .innerText();
  assert.match(restartedText, /admitted/i);
  assert.match(restartedText, /canonical styling is backed/i);
  assert.equal(
    await restarted.page.locator(".epistemic-review-admission").isEnabled(),
    false,
  );
  const restartedProjection = await restarted.page.evaluate(() =>
    window.codexSurfaceBridge.getWorldManagerSnapshot());
  const restartedCard = restartedProjection.epistemicFabric.lifecycleCards.find(
    (card) => card.lifecycleRef.id === gateCard.lifecycleRef.id,
  );
  assert.equal(restartedCard.authorityState, "admitted");
  assert.equal(restartedCard.receiptBackedCanonical, true);
  assert.ok(restartedCard.trustStoreReceiptRef);
  assert.equal(rendererErrors.length, 0, rendererErrors.join("\n"));

  const report = {
    schema: "direct_world_manager_sc11_electron_acceptance_report@1",
    status: "passed",
    executor: process.env.CODEX_TEST_EXECUTOR || "local_electron",
    productionElectronSurface: true,
    realPreloadBridge: true,
    realIpcAdmissionHandler: true,
    exactEvidenceVectorNegativeGame: true,
    failedAttemptPreservedGateReady: true,
    operatorReviewTwoStep: true,
    rendererSelectedAuthorityActor: false,
    canonicalReceiptProjected: true,
    responsiveInspectorHasNoHorizontalOverflow: true,
    restartPreservedCanonicalAdmission: true,
    downstreamEffectsExecuted: false,
    rendererErrorCount: rendererErrors.length,
    screenshot: path.basename(screenshotPath),
  };
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, {
    mode: 0o600,
  });
  console.log(JSON.stringify(report, null, 2));
} finally {
  if (firstApp) await closeSurface(firstApp);
  if (restartedApp) await closeSurface(restartedApp);
  if (!configuredRoot) {
    fs.rmSync(testRoot, { recursive: true, force: true });
  }
}
