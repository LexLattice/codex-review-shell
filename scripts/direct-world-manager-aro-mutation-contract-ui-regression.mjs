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
    "world-manager-sc81-ui-",
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
      "scripts/direct-world-manager-aro-mutation-contract-regression.mjs",
    ),
  ],
  {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CODEX_WORLD_MANAGER_SC81_INITIAL_PROJECTION_PATH:
        initialPath,
      CODEX_WORLD_MANAGER_SC81_COMPLETED_PROJECTION_PATH:
        completedPath,
      CODEX_WORLD_MANAGER_SC81_FAILED_PROJECTION_PATH:
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
    "SC8.1 UI fixture failed.",
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
assert.ok(comparison);

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
  "__wmSc81Initial",
  () => initialProjection,
);
await page.exposeFunction(
  "__wmSc81Completed",
  () => completedProjection,
);
await page.exposeFunction(
  "__wmSc81Failed",
  () => failedProjection,
);
await page.addInitScript(() => {
  window.__wmSc81Calls = [];
  window.__wmSc81Event = null;
  window.codexSurfaceBridge = {
    getWorldManagerSnapshot: () =>
      window.__wmSc81Initial(),
    submitWorldManagerMessage:
      async () => ({
        projection:
          await window
            .__wmSc81Initial(),
      }),
    focusWorldManagerProject:
      async () => ({
        projection:
          await window
            .__wmSc81Initial(),
      }),
    compileWorldManagerAroMutationContract:
      async (
        projectId,
        comparisonId,
        comparisonDigest,
        semanticRegionBindingRef,
        retry,
        expectedRunDigest,
      ) => {
        window.__wmSc81Calls.push({
          projectId,
          comparisonId,
          comparisonDigest,
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
              .__wmSc81Completed(),
        };
      },
    onWorldManagerEvent: (callback) => {
      window.__wmSc81Event = callback;
      return () => {};
    },
    onWorldManagerSemanticEvent:
      () => () => {},
  };
});
const payload = Buffer.from(
  JSON.stringify({
    project: {
      id: "project_sc81",
      name: "SC8.1 Mutation Studio",
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
let mutationLane = page.locator(
  "#aroFocusedObject .aro-mutation-workbench",
);
assert.equal(
  await mutationLane.count(),
  1,
);
assert.equal(
  await mutationLane.getAttribute(
    "data-compilation-state",
  ),
  "not_compiled",
);
assert.equal(
  await mutationLane.getAttribute(
    "data-workspace-mutation",
  ),
  "false",
);
const compileButton =
  mutationLane.locator(
    ".aro-mutation-compile",
  );
assert.equal(
  await compileButton.isEnabled(),
  true,
);
assert.equal(
  await mutationLane.locator(
    ".aro-mutation-ref-strip > span",
  ).count(),
  3,
);

await compileButton.click();
await page.waitForFunction(() =>
  window.__wmSc81Calls.length === 1);
const compileCall =
  await page.evaluate(() =>
    window.__wmSc81Calls[0]);
assert.equal(
  compileCall.projectId,
  comparison.projectId,
);
assert.equal(
  compileCall.comparisonId,
  comparison.comparisonId,
);
assert.equal(
  compileCall.comparisonDigest,
  comparison.digest,
);
assert.equal(compileCall.retry, false);
assert.equal(
  compileCall
    .semanticRegionBindingRef.kind,
  "semantic_region_binding",
);

mutationLane = page.locator(
  "#aroFocusedObject .aro-mutation-workbench",
);
assert.equal(
  await mutationLane.getAttribute(
    "data-compilation-state",
  ),
  "completed",
);
assert.equal(
  await mutationLane.locator(
    ".aro-mutation-obligation",
  ).count(),
  2,
);
assert.equal(
  await mutationLane.locator(
    ".aro-mutation-verification-item",
  ).count(),
  2,
);
const realizationLane =
  mutationLane.locator(
    ".aro-realization-workbench",
  );
assert.equal(
  await realizationLane.count(),
  1,
);
assert.match(
  await realizationLane.getAttribute(
    "data-realization-state",
  ),
  /not_imported/i,
);
assert.match(
  await realizationLane.locator(
    ".decision-transition-boundary",
  ).textContent(),
  /mapper is unavailable/i,
);
assert.equal(
  await page.locator(
    "#aroFocusedObject .aro-surface",
  ).count(),
  1,
);

await page.evaluate(async () => {
  window.__wmSc81Event({
    projection:
      await window.__wmSc81Failed(),
  });
});
mutationLane = page.locator(
  "#aroFocusedObject .aro-mutation-workbench",
);
assert.equal(
  await mutationLane.getAttribute(
    "data-compilation-state",
  ),
  "remanded",
);
const retry =
  mutationLane.locator(
    ".aro-mutation-retry",
  );
assert.equal(await retry.isEnabled(), true);
await retry.click();
await page.waitForFunction(() =>
  window.__wmSc81Calls.length === 2);
const retryCall =
  await page.evaluate(() =>
    window.__wmSc81Calls[1]);
const failedRun =
  failedProjection.aroRegistry
    .mutationCompilationRuns[0];
assert.equal(retryCall.retry, true);
assert.equal(
  retryCall.expectedRunDigest,
  failedRun.runRef.digest,
);
assert.equal(
  retryCall.comparisonDigest,
  failedRun.comparisonRef.digest,
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
    return {
      columns:
        style.gridTemplateColumns,
      navigatorTop:
        navigator.top,
      focusedTop: focused.top,
      focusedHeight:
        focused.height,
    };
  });
assert.ok(
  layout.focusedTop >
    layout.navigatorTop,
);
assert.ok(
  layout.focusedHeight <= 660,
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
      "direct-world-manager-aro-mutation-contract-ui",
    proofs: {
      exactComparisonFocused: true,
      compileActionBoundToRegion:
        true,
      obligationsInspectable: 2,
      verificationInspectable: 2,
      retryPreservesExactDigest:
        true,
      realizationImportIsNextBoundedLane:
        true,
      oneFocusedObject: true,
      compactResponsiveMorph: true,
      rendererErrors: 0,
    },
  }, null, 2),
);
