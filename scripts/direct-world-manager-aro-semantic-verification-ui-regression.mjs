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
    "world-manager-sc85-ui-",
  ),
);
const evidencePath = path.join(
  fixtureRoot,
  "evidence.json",
);
const verificationPath = path.join(
  fixtureRoot,
  "verification.json",
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
      CODEX_WORLD_MANAGER_SC85_ASSERT:
        "1",
      CODEX_WORLD_MANAGER_SC84_EVIDENCE_PROJECTION_PATH:
        evidencePath,
      CODEX_WORLD_MANAGER_SC85_VERIFICATION_PROJECTION_PATH:
        verificationPath,
    },
    encoding: "utf8",
  },
);
assert.equal(
  fixture.status,
  0,
  fixture.stderr ||
    fixture.stdout ||
    "SC8.5 UI fixture failed.",
);
const evidenceProjection = JSON.parse(
  fs.readFileSync(
    evidencePath,
    "utf8",
  ),
);
const verificationProjection =
  JSON.parse(
    fs.readFileSync(
      verificationPath,
      "utf8",
    ),
  );
assert.equal(
  evidenceProjection.aroRegistry
    .semanticVerificationAssessments
    .length,
  0,
);
assert.equal(
  verificationProjection.aroRegistry
    .semanticVerificationAssessments
    .length,
  1,
);

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
  "__wmSc85Evidence",
  () => evidenceProjection,
);
await page.exposeFunction(
  "__wmSc85Verification",
  () => verificationProjection,
);
await page.addInitScript(() => {
  window.__wmSc85Calls = [];
  window.codexSurfaceBridge = {
    getWorldManagerSnapshot: () =>
      window.__wmSc85Evidence(),
    submitWorldManagerMessage:
      async () => ({
        projection:
          await window
            .__wmSc85Evidence(),
      }),
    focusWorldManagerProject:
      async () => ({
        projection:
          await window
            .__wmSc85Evidence(),
      }),
    verifyWorldManagerAroRealization:
      async (payload) => {
        window.__wmSc85Calls
          .push(payload);
        return {
          receipt: {
            state: "completed",
            canonicalAdmissionEffect:
              false,
            canonicalAdmissionAvailable:
              false,
            closureCertified: false,
          },
          projection:
            await window
              .__wmSc85Verification(),
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
        "SC8.5 Verification Studio",
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
  "#aroFocusedObject .aro-semantic-verification-workbench",
);
assert.equal(
  await workbench.count(),
  1,
);
assert.equal(
  await workbench.getAttribute(
    "data-verification-state",
  ),
  "not_verified",
);
assert.equal(
  await workbench.getAttribute(
    "data-canonical-admission",
  ),
  "unavailable",
);
const runButton =
  workbench.getByRole("button", {
    name: "Run semantic verification",
  });
assert.equal(
  await runButton.isEnabled(),
  true,
);
assert.match(
  await workbench.textContent(),
  /cannot execute tools/i,
);
await runButton.click();
await page.waitForFunction(() =>
  window.__wmSc85Calls.length === 1);
const call = await page.evaluate(() =>
  window.__wmSc85Calls[0]);
assert.equal(
  call.semanticRegionBindingRef.kind,
  "semantic_region_binding",
);
assert.equal(
  call.evidenceBundleId,
  evidenceProjection.aroRegistry
    .executionEvidenceBundles[0]
    .evidenceBundleRef.id,
);

workbench = page.locator(
  "#aroFocusedObject .aro-semantic-verification-workbench",
);
assert.equal(
  await workbench.getAttribute(
    "data-verification-state",
  ),
  "completed",
);
assert.match(
  await workbench.textContent(),
  /admission unavailable/i,
);
const admission =
  workbench.getByRole("button", {
    name:
      "Canonical admission unavailable",
  });
assert.equal(
  await admission.isDisabled(),
  true,
);

await workbench.getByRole(
  "button",
  { name: "Obligations" },
).click();
assert.match(
  await workbench.textContent(),
  /implement_worker_handoff/,
);
assert.match(
  await workbench.textContent(),
  /preserve_effect_gates/,
);

await workbench.getByRole(
  "button",
  { name: "Coverage" },
).click();
assert.match(
  await workbench.textContent(),
  /verify_handoff_lineage/,
);
assert.match(
  await workbench.textContent(),
  /authorize_one_worker/,
);

await workbench.getByRole(
  "button",
  { name: "Drift & next" },
).click();
assert.match(
  await workbench.textContent(),
  /product_presentation/,
);
assert.match(
  await workbench.textContent(),
  /Review current realization/,
);
const decisionButton =
  workbench.locator(
    ".aro-semantic-decision-focus",
  );
assert.equal(
  await decisionButton.count(),
  1,
);
await decisionButton.click();
assert.equal(
  await page.locator(
    "#decisionOutcomeInspector",
  ).isVisible(),
  true,
);
assert.match(
  await page.locator(
    "#decisionOutcomeInspector",
  ).textContent(),
  /preserved gate evidence/i,
);

await page.setViewportSize({
  width: 430,
  height: 880,
});
await page.locator(
  '.metric[data-inspector="aros"]',
).click();
workbench = page.locator(
  "#aroFocusedObject .aro-semantic-verification-workbench",
);
assert.equal(
  await workbench.count(),
  1,
);
const lensColumns =
  await workbench.locator(
    ".aro-semantic-verification-lenses",
  ).evaluate((element) =>
    getComputedStyle(element)
      .gridTemplateColumns
      .split(" ")
      .filter(Boolean).length);
assert.equal(lensColumns, 2);
assert.deepEqual(errors, []);

await browser.close();
await server.dispose();
fs.rmSync(fixtureRoot, {
  recursive: true,
  force: true,
});

console.log(JSON.stringify({
  ok: true,
  slice: "WM-SC8.5",
  semanticRoleInvoked: true,
  lensesVerified: [
    "summary",
    "obligations",
    "coverage",
    "drift_and_next",
  ],
  decisionFocusVerified: true,
  canonicalAdmissionUnavailable:
    true,
  responsiveMorphologyVerified:
    true,
}));
