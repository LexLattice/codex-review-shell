#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { chromium } from "playwright";

const require = createRequire(import.meta.url);
const { LocalSurfaceServer } = require(
  "../src/main/local-surface-server",
);

const fixtureRoot = fs.mkdtempSync(
  path.join(
    os.tmpdir(),
    "world-manager-sc84-ui-",
  ),
);
const handedOffPath = path.join(
  fixtureRoot,
  "handed-off.json",
);
const evidencePath = path.join(
  fixtureRoot,
  "evidence.json",
);
const fixture = spawnSync(
  process.execPath,
  [
    path.resolve(
      "scripts/direct-world-manager-aro-worker-handoff-regression.mjs",
    ),
  ],
  {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CODEX_WORLD_MANAGER_SC84_ASSERT:
        "1",
      CODEX_WORLD_MANAGER_SC83_HANDED_OFF_PROJECTION_PATH:
        handedOffPath,
      CODEX_WORLD_MANAGER_SC84_EVIDENCE_PROJECTION_PATH:
        evidencePath,
    },
    encoding: "utf8",
  },
);
assert.equal(
  fixture.status,
  0,
  fixture.stderr ||
    fixture.stdout ||
    "SC8.4 UI fixture failed.",
);
const handedOffProjection = JSON.parse(
  fs.readFileSync(
    handedOffPath,
    "utf8",
  ),
);
const evidenceProjection = JSON.parse(
  fs.readFileSync(
    evidencePath,
    "utf8",
  ),
);
const evidenceBundle =
  evidenceProjection.aroRegistry
    .executionEvidenceBundles[0];
assert.ok(evidenceBundle);

const server = new LocalSurfaceServer(
  path.resolve("src/renderer"),
);
const baseUrl =
  await server.ensureStarted();
const browser =
  await chromium.launch({
    headless: true,
  });
const page = await browser.newPage({
  viewport: {
    width: 1420,
    height: 940,
  },
});
const errors = [];
page.on("console", (message) => {
  if (message.type() === "error") {
    errors.push(message.text());
  }
});
page.on("pageerror", (error) =>
  errors.push(error.message));

await page.exposeFunction(
  "__wmSc84HandedOff",
  () => handedOffProjection,
);
await page.exposeFunction(
  "__wmSc84Evidence",
  () => evidenceProjection,
);
await page.addInitScript(() => {
  window.__wmSc84CaptureCalls = [];
  window.codexSurfaceBridge = {
    getWorldManagerSnapshot: () =>
      window.__wmSc84HandedOff(),
    submitWorldManagerMessage:
      async () => ({
        projection:
          await window
            .__wmSc84HandedOff(),
      }),
    focusWorldManagerProject:
      async () => ({
        projection:
          await window
            .__wmSc84HandedOff(),
      }),
    captureWorldManagerAroExecutionEvidence:
      async (payload) => {
        window.__wmSc84CaptureCalls
          .push(payload);
        return {
          receipt: {
            state: "acquired",
            workspaceMutationObserved:
              true,
            workspaceMutationEffect:
              false,
          },
          projection:
            await window
              .__wmSc84Evidence(),
        };
      },
    onWorldManagerEvent:
      () => () => {},
    onWorldManagerSemanticEvent:
      () => () => {},
    onEvent: () => () => {},
  };
});
const payload = Buffer.from(
  JSON.stringify({
    project: {
      id: "project_sc83",
      name:
        "SC8.4 Evidence Studio",
    },
    worldManager: {
      mode: "production",
      pipelineStage:
        "wm_k6_genesis",
    },
  }),
  "utf8",
).toString("base64url");
await page.goto(
  `${baseUrl}/world-manager-surface.html#${payload}`,
  {
    waitUntil: "networkidle",
  },
);
await page.waitForFunction(() =>
  document
    .querySelector("#worldRevision")
    ?.textContent?.includes(
      "keyboard pipeline",
    ));
await page.locator(
  '.metric[data-inspector="aros"]',
).click();

let workbench = page.locator(
  "#aroFocusedObject .aro-execution-evidence-workbench",
);
assert.equal(
  await workbench.count(),
  1,
);
assert.equal(
  await workbench.getAttribute(
    "data-evidence-state",
  ),
  "not_observed",
);
assert.equal(
  await workbench.getAttribute(
    "data-workspace-mutation",
  ),
  "false",
);
const acquire = workbench.getByRole(
  "button",
  {
    name:
      "Acquire realization evidence",
  },
);
assert.equal(
  await acquire.isEnabled(),
  true,
);
assert.match(
  await workbench.textContent(),
  /reads existing runtime evidence only/i,
);
await acquire.click();
await page.waitForFunction(() =>
  window.__wmSc84CaptureCalls
    .length === 1);
const captureCall =
  await page.evaluate(() =>
    window.__wmSc84CaptureCalls[0]);
assert.match(
  captureCall.observationRequestId,
  /.+/,
);
assert.equal(
  captureCall
    .semanticRegionBindingRef.kind,
  "semantic_region_binding",
);

workbench = page.locator(
  "#aroFocusedObject .aro-execution-evidence-workbench",
);
assert.equal(
  await workbench.getAttribute(
    "data-evidence-state",
  ),
  "acquired",
);
assert.equal(
  await workbench.getAttribute(
    "data-workspace-mutation",
  ),
  "true",
);
assert.equal(
  await workbench.locator(
    ".aro-execution-evidence-lenses button",
  ).count(),
  4,
);
assert.match(
  await workbench.locator(
    ".aro-execution-evidence-panel",
  ).textContent(),
  /terminal capture|final output/i,
);

await workbench.getByRole(
  "button",
  {
    name: "Tools & effects",
  },
).click();
assert.equal(
  await workbench.locator(
    ".aro-execution-tool-result",
  ).count(),
  evidenceBundle.toolResults.length,
);
assert.match(
  await workbench.locator(
    ".aro-execution-evidence-panel",
  ).textContent(),
  /apply_patch|run_command/,
);

await workbench.getByRole(
  "button",
  {
    name: "Repository",
  },
).click();
assert.equal(
  await workbench.locator(
    ".aro-execution-path-comparisons > div.changed",
  ).count(),
  1,
);
assert.match(
  await workbench.locator(
    ".aro-execution-evidence-panel",
  ).textContent(),
  /before.*after|changed.*unchanged/is,
);

await workbench.getByRole(
  "button",
  {
    name: "Coverage",
  },
).click();
assert.equal(
  await workbench.locator(
    ".aro-execution-coverage",
  ).count(),
  evidenceBundle
    .verificationCoverage.length,
);
assert.match(
  await workbench.locator(
    ".decision-transition-boundary",
  ).allTextContents()
    .then((items) =>
      items.join(" ")),
  /SC8\.5 evaluates claims|does not authorize/i,
);
assert.equal(
  await page.locator(
    "text=rawProviderPayload",
  ).count(),
  0,
);
assert.deepEqual(errors, []);

await browser.close();
await server.dispose();
fs.rmSync(fixtureRoot, {
  recursive: true,
  force: true,
});

console.log(
  JSON.stringify({
    ok: true,
    slice: "WM-SC8.4-UI",
    evidenceAcquisitionAction:
      true,
    semanticEvidenceLenses: 4,
    workspaceMutationObserved:
      true,
    semanticClosureControls:
      false,
  }),
);
