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
    "world-manager-sc82-ui-",
  ),
);
const initialPath = path.join(
  fixtureRoot,
  "initial.json",
);
const completedPath = path.join(
  fixtureRoot,
  "completed.json",
);
const failedPath = path.join(
  fixtureRoot,
  "failed.json",
);
const fixture = spawnSync(
  process.execPath,
  [
    path.resolve(
      "scripts/direct-world-manager-aro-realization-mapping-regression.mjs",
    ),
  ],
  {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CODEX_WORLD_MANAGER_SC82_INITIAL_PROJECTION_PATH:
        initialPath,
      CODEX_WORLD_MANAGER_SC82_COMPLETED_PROJECTION_PATH:
        completedPath,
      CODEX_WORLD_MANAGER_SC82_FAILED_PROJECTION_PATH:
        failedPath,
    },
    encoding: "utf8",
  },
);
assert.equal(
  fixture.status,
  0,
  fixture.stderr ||
    fixture.stdout ||
    "SC8.2 UI fixture failed.",
);
const initialProjection = JSON.parse(
  fs.readFileSync(initialPath, "utf8"),
);
const completedProjection = JSON.parse(
  fs.readFileSync(
    completedPath,
    "utf8",
  ),
);
const failedProjection = JSON.parse(
  fs.readFileSync(failedPath, "utf8"),
);
const comparison =
  initialProjection.aroRegistry
    .currentTargetComparisons[0];
const contract =
  initialProjection.aroRegistry
    .mutationContracts[0];
assert.ok(comparison);
assert.ok(contract);

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
  "__wmSc82Initial",
  () => initialProjection,
);
await page.exposeFunction(
  "__wmSc82Completed",
  () => completedProjection,
);
await page.exposeFunction(
  "__wmSc82Failed",
  () => failedProjection,
);
await page.addInitScript(() => {
  window.__wmSc82Calls = [];
  window.__wmSc82Event = null;
  window.codexSurfaceBridge = {
    getWorldManagerSnapshot: () =>
      window.__wmSc82Initial(),
    submitWorldManagerMessage:
      async () => ({
        projection:
          await window
            .__wmSc82Initial(),
      }),
    focusWorldManagerProject:
      async () => ({
        projection:
          await window
            .__wmSc82Initial(),
      }),
    mapWorldManagerAroRealizationContext:
      async (
        projectId,
        contractId,
        contractDigest,
        semanticRegionBindingRef,
        retry,
        expectedRunDigest,
      ) => {
        window.__wmSc82Calls.push({
          projectId,
          contractId,
          contractDigest,
          semanticRegionBindingRef,
          retry,
          expectedRunDigest,
        });
        return {
          receipt: {
            state: "completed",
          },
          projection:
            await window
              .__wmSc82Completed(),
        };
      },
    onWorldManagerEvent: (callback) => {
      window.__wmSc82Event = callback;
      return () => {};
    },
    onWorldManagerSemanticEvent:
      () => () => {},
  };
});
const payload = Buffer.from(
  JSON.stringify({
    project: {
      id: "project_sc82",
      name:
        "SC8.2 Realization Studio",
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
const focusedComparison =
  page.locator(
    `#aroFocusedObject .aro-surface[data-subject-id="${comparison.comparisonId}"]`,
  );
assert.equal(
  await focusedComparison.count(),
  1,
);
let realizationLane = page.locator(
  "#aroFocusedObject .aro-realization-workbench",
);
assert.equal(
  await realizationLane.count(),
  1,
);
assert.equal(
  await realizationLane.getAttribute(
    "data-realization-state",
  ),
  "not_imported",
);
assert.equal(
  await realizationLane.getAttribute(
    "data-source-inspection",
  ),
  "false",
);
assert.equal(
  await realizationLane.getAttribute(
    "data-workspace-mutation",
  ),
  "false",
);
const importButton =
  realizationLane.locator(
    ".aro-realization-import",
  );
assert.equal(
  await importButton.isEnabled(),
  true,
);
assert.match(
  await realizationLane
    .locator(
      ".decision-transition-boundary",
    )
    .textContent(),
  /source excerpts stay in the backend/i,
);

await importButton.click();
await page.waitForFunction(() =>
  window.__wmSc82Calls.length ===
    1);
const importCall =
  await page.evaluate(() =>
    window.__wmSc82Calls[0]);
assert.equal(
  importCall.projectId,
  contract.projectId,
);
assert.equal(
  importCall.contractId,
  contract.contractRef.id,
);
assert.equal(
  importCall.contractDigest,
  contract.contractRef.digest,
);
assert.equal(importCall.retry, false);
assert.equal(
  importCall
    .semanticRegionBindingRef.kind,
  "semantic_region_binding",
);

realizationLane = page.locator(
  "#aroFocusedObject .aro-realization-workbench",
);
assert.equal(
  await realizationLane.getAttribute(
    "data-realization-state",
  ),
  "completed",
);
assert.equal(
  await realizationLane.getAttribute(
    "data-source-inspection",
  ),
  "true",
);
assert.equal(
  await realizationLane.locator(
    ".aro-realization-source",
  ).count(),
  1,
);
assert.equal(
  await realizationLane.locator(
    ".aro-realization-mapping",
  ).count(),
  1,
);
assert.match(
  await realizationLane.locator(
    ".aro-realization-source strong",
  ).textContent(),
  /src\/workbench\.js/,
);
assert.match(
  await realizationLane.locator(
    ".aro-realization-binding code",
  ).textContent(),
  /L1–L7/,
);
assert.equal(
  await realizationLane.locator(
    "text=export function",
  ).count(),
  0,
);
const workerReview =
  realizationLane.locator(
    ".aro-worker-review",
  );
assert.equal(
  await workerReview.isDisabled(),
  true,
);
assert.match(
  await workerReview.textContent(),
  /compile worker constitution/i,
);
assert.match(
  await realizationLane.locator(
    ".aro-worker-workbench .decision-transition-boundary",
  ).textContent(),
  /native Direct implementation-worker path is unavailable/i,
);
assert.match(
  await realizationLane.locator(
    ".decision-transition-boundary",
  ).last().textContent(),
  /workspace effect remains action-gated/i,
);
assert.equal(
  await page.locator(
    "#aroFocusedObject .aro-surface",
  ).count(),
  1,
);

await page.evaluate(async () => {
  window.__wmSc82Event({
    projection:
      await window.__wmSc82Failed(),
  });
});
realizationLane = page.locator(
  "#aroFocusedObject .aro-realization-workbench",
);
assert.equal(
  await realizationLane.getAttribute(
    "data-realization-state",
  ),
  "remanded",
);
const retry =
  realizationLane.locator(
    ".aro-realization-retry",
  );
assert.equal(
  await retry.isEnabled(),
  true,
);
await retry.click();
await page.waitForFunction(() =>
  window.__wmSc82Calls.length ===
    2);
const retryCall =
  await page.evaluate(() =>
    window.__wmSc82Calls[1]);
const failedRun =
  failedProjection.aroRegistry
    .realizationMappingRuns[0];
assert.equal(retryCall.retry, true);
assert.equal(
  retryCall.expectedRunDigest,
  failedRun.runRef.digest,
);
assert.equal(
  retryCall.contractDigest,
  failedRun.contractRef.digest,
);

await page.setViewportSize({
  width: 420,
  height: 860,
});
const layout =
  await page.locator(
    ".aro-focus-workbench",
  ).evaluate((element) => {
    const style =
      getComputedStyle(element);
    const navigator =
      element.querySelector(
        ".aro-object-navigator",
      ).getBoundingClientRect();
    const focused =
      element.querySelector(
        ".aro-focused-object",
      ).getBoundingClientRect();
    const realization =
      element.querySelector(
        ".aro-realization-workbench",
      ).getBoundingClientRect();
    return {
      columns:
        style.gridTemplateColumns,
      navigatorTop:
        navigator.top,
      focusedTop: focused.top,
      focusedHeight:
        focused.height,
      realizationWidth:
        realization.width,
      focusedWidth:
        focused.width,
    };
  });
assert.ok(
  layout.focusedTop >
    layout.navigatorTop,
);
assert.ok(
  layout.focusedHeight <= 660,
);
assert.ok(
  layout.realizationWidth <=
    layout.focusedWidth,
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
    regression:
      "direct-world-manager-aro-realization-mapping-ui",
    proofs: {
      exactContractFocused: true,
      importActionBoundToRegion:
        true,
      boundedSourceInventory: 1,
      obligationMappings: 1,
      sourceExcerptProjected: false,
      retryPreservesExactDigest:
        true,
      workerHandoffGateVisible:
        true,
      oneFocusedObject: true,
      compactResponsiveMorph: true,
      rendererErrors: 0,
    },
  }, null, 2),
);
