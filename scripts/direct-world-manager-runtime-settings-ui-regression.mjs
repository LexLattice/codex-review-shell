#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { chromium } from "playwright";

const require = createRequire(import.meta.url);
const { LocalSurfaceServer } = require(
  "../src/main/local-surface-server",
);
const projection = {
  schema: "direct_world_manager_workbench_projection@1",
  pipelineStage: "wm_k5_planning",
  projectionRevision: 1,
  revision: 1,
  lifecycleState: "idle",
  lifecycleLabel: "World is calm",
  busy: false,
  activeProjectId: "project_runtime_settings",
  projects: [{
    projectId: "project_runtime_settings",
    name: "Runtime Settings",
    activityState: "active",
    statusLabel: "ready",
    summary: "Manager runtime settings acceptance fixture.",
    openDecisionCount: 0,
    activeWorkThreadCount: 0,
    candidateCount: 0,
  }],
  messages: [],
  worldPosture: {
    title: "Runtime preference ready",
    summary:
      "Configured preference and observed runtime remain distinct.",
  },
  store: { counts: {} },
  projectEcology: {
    establishedProjectCount: 1,
    candidateProjectCount: 0,
  },
  decisionSummary: { actionRequiredCount: 0 },
  aroRegistry: { candidateCount: 0, canonicalAroCount: 0 },
  epistemicFabric: null,
  contextCanvas: null,
  latestProposal: null,
  latestContract: null,
  latestProjectGenesis: null,
  settlement: null,
  reconciliation: null,
  semanticSurface: null,
  unifiedProjection: null,
};

function runtimeSettings(configured = {}) {
  const model = configured.model || "";
  const reasoningEffort = configured.reasoningEffort || "";
  return {
    schema: "direct_world_manager_runtime_settings@1",
    configured: { model, reasoningEffort },
    effective: {
      model: model || "gpt-5.5",
      reasoningEffort: reasoningEffort || "medium",
      modelSource: model
        ? "world_manager_preference"
        : "provider_default",
      reasoningEffortSource: reasoningEffort
        ? "world_manager_preference"
        : "role_contract",
    },
    lastObserved: {
      model: "gpt-5.5",
      reasoningEffort: "medium",
      observedAt: "2026-08-05T09:00:00.000Z",
      evidenceState: "persisted_provider_telemetry",
    },
    catalog: {
      source: "server_model_list",
      evidenceState: "provider_observed",
      cacheState: "fresh",
      refreshed: true,
      models: [
        {
          id: "gpt-5.5",
          displayName: "GPT-5.5",
          supportedReasoningEfforts: [
            "low",
            "medium",
            "high",
            "xhigh",
          ],
          evidenceState: "provider_observed",
        },
        {
          id: "gpt-5.6-sol",
          displayName: "GPT-5.6 Sol",
          supportedReasoningEfforts: [
            "medium",
            "high",
            "xhigh",
          ],
          evidenceState: "provider_observed",
        },
      ],
    },
    scope: {
      appliesTo: ["world_manager", "project_manager"],
      excludes: ["implementation_worker", "auditor"],
      effectiveFrom: "next_manager_provider_call",
    },
    mutationAuthorityGranted: false,
    providerCallStarted: false,
    generatedAt: "2026-08-05T10:00:00.000Z",
  };
}

const server = new LocalSurfaceServer(
  path.resolve("src/renderer"),
);
const baseUrl = await server.ensureStarted();
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 1480, height: 920 },
});
const errors = [];
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});
page.on("pageerror", (error) => errors.push(error.message));
await page.exposeFunction("__wmRuntimeProjection", () => projection);
await page.exposeFunction(
  "__wmRuntimeInitialSettings",
  () => runtimeSettings(),
);
await page.exposeFunction(
  "__wmRuntimeUpdatedSettings",
  (payload) => runtimeSettings(payload),
);
await page.addInitScript(() => {
  window.codexSurfaceBridge = {
    getWorldManagerSnapshot: () =>
      window.__wmRuntimeProjection(),
    getWorldManagerRuntimeSettings: () =>
      window.__wmRuntimeInitialSettings(),
    updateWorldManagerRuntimeSettings: async (payload) => {
      window.__wmRuntimeUpdatePayload = payload;
      return {
        ok: true,
        settings:
          await window.__wmRuntimeUpdatedSettings(payload),
      };
    },
    onWorldManagerEvent: () => () => {},
    onWorldManagerSemanticEvent: () => () => {},
  };
});
const payload = Buffer.from(JSON.stringify({
  project: {
    id: "project_runtime_settings",
    name: "Runtime Settings",
  },
  worldManager: {
    mode: "production",
    pipelineStage: "wm_k5_planning",
  },
}), "utf8").toString("base64url");
await page.goto(
  `${baseUrl}/world-manager-surface.html#${payload}`,
  { waitUntil: "networkidle" },
);
await page.waitForFunction(() =>
  document.querySelector("#managerRuntimeSummary")
    ?.textContent?.includes("gpt-5.5"));
await page.locator("#managerRuntimeSettingsToggle").click();
assert.match(
  await page.locator("#managerRuntimeObserved").innerText(),
  /gpt-5\.5.*medium/i,
);
assert.match(
  await page.locator("#managerRuntimeCatalog").innerText(),
  /provider observed.*2 models/i,
);
await page.locator("#managerModelSelect").selectOption(
  "gpt-5.6-sol",
);
await page.locator("#managerEffortSelect").selectOption("xhigh");
assert.equal(
  (await page.locator("#managerRuntimeState").innerText()).toLowerCase(),
  "draft",
);
assert.equal(
  await page.locator("#applyManagerRuntime").isDisabled(),
  false,
);
await page.locator("#applyManagerRuntime").click();
await page.waitForFunction(() =>
  document.querySelector("#managerRuntimeSummary")
    ?.textContent?.includes("gpt-5.6-sol · xhigh"));
assert.deepEqual(
  await page.evaluate(() => window.__wmRuntimeUpdatePayload),
  {
    model: "gpt-5.6-sol",
    reasoningEffort: "xhigh",
  },
);
assert.equal(
  (await page.locator("#managerRuntimeState").innerText()).toLowerCase(),
  "configured",
);
assert.match(
  await page.locator("#managerRuntimeBoundary").innerText(),
  /next manager provider call.*no worker authority/i,
);
const screenshotPath = path.join(
  os.tmpdir(),
  "world-manager-runtime-settings-ui-regression.png",
);
await page.screenshot({ path: screenshotPath, fullPage: false });
assert.ok(fs.statSync(screenshotPath).size > 20_000);
assert.deepEqual(errors, []);
await browser.close();
await server.dispose();

console.log(JSON.stringify({
  ok: true,
  regression: "direct-world-manager-runtime-settings-ui",
  screenshotPath,
  configuredAndObservedRenderedSeparately: true,
  explicitApplyBoundaryVerified: true,
  modelSpecificEffortSelectionVerified: true,
}, null, 2));
