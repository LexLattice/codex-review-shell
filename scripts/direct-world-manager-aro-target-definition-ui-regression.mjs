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
    "world-manager-sc72-ui-",
  ),
);
const initialPath = path.join(
  fixtureRoot,
  "initial.json",
);
const candidatePath = path.join(
  fixtureRoot,
  "candidate.json",
);
const admittedPath = path.join(
  fixtureRoot,
  "admitted.json",
);
const fixture = spawnSync(
  process.execPath,
  [
    path.resolve(
      "scripts/direct-world-manager-aro-target-definition-regression.mjs",
    ),
  ],
  {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CODEX_WORLD_MANAGER_SC72_INITIAL_PROJECTION_PATH:
        initialPath,
      CODEX_WORLD_MANAGER_SC72_CANDIDATE_PROJECTION_PATH:
        candidatePath,
      CODEX_WORLD_MANAGER_SC72_ADMITTED_PROJECTION_PATH:
        admittedPath,
    },
    encoding: "utf8",
  },
);
assert.equal(
  fixture.status,
  0,
  fixture.stderr ||
    fixture.stdout ||
    "SC7.2 UI fixture failed.",
);
const initialProjection = JSON.parse(
  fs.readFileSync(initialPath, "utf8"),
);
const candidateProjection = JSON.parse(
  fs.readFileSync(candidatePath, "utf8"),
);
const admittedProjection = JSON.parse(
  fs.readFileSync(admittedPath, "utf8"),
);
const currentAro =
  initialProjection.aroRegistry
    .canonicalAros.find(
      (aro) =>
        aro.posture === "current",
    );
const targetCandidate =
  candidateProjection.aroRegistry
    .candidates.find(
      (candidate) =>
        candidate.reconstructionMethod ===
          "semantic_target_definition",
    );
const comparison =
  admittedProjection.aroRegistry
    .currentTargetComparisons[0];
assert.ok(currentAro);
assert.ok(targetCandidate);
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
  "__wmSc72Initial",
  () => initialProjection,
);
await page.exposeFunction(
  "__wmSc72Candidate",
  () => candidateProjection,
);
await page.exposeFunction(
  "__wmSc72Admitted",
  () => admittedProjection,
);
await page.addInitScript(() => {
  window.__wmSc72Calls = [];
  window.__wmSc72Event = null;
  window.codexSurfaceBridge = {
    getWorldManagerSnapshot: () =>
      window.__wmSc72Initial(),
    submitWorldManagerMessage:
      async () => ({
        projection:
          await window
            .__wmSc72Initial(),
      }),
    focusWorldManagerProject:
      async () => ({
        projection:
          await window
            .__wmSc72Initial(),
      }),
    defineWorldManagerAroTarget:
      async (
        projectId,
        currentAroId,
        currentAroDigest,
        targetIntent,
        semanticRegionBindingRef,
        retry,
      ) => {
        window.__wmSc72Calls.push({
          projectId,
          currentAroId,
          currentAroDigest,
          targetIntent,
          semanticRegionBindingRef,
          retry,
        });
        const projection =
          await window
            .__wmSc72Candidate();
        const candidate =
          projection.aroRegistry
            .candidates.find(
              (entry) =>
                entry
                  .reconstructionMethod ===
                "semantic_target_definition",
            );
        return {
          receipt: {
            state: "completed",
            candidateRef: {
              kind:
                "aro_reconstruction_candidate",
              id:
                candidate.candidateId,
              digest:
                candidate.digest,
              projectId:
                candidate.projectId,
            },
          },
          projection,
        };
      },
    reviewWorldManagerAroReconstruction:
      async () => ({
        projection:
          await window
            .__wmSc72Candidate(),
      }),
    admitWorldManagerAroReconstruction:
      async () => ({
        projection:
          await window
            .__wmSc72Admitted(),
      }),
    compileWorldManagerAroMutationContract:
      async () => ({
        projection:
          await window
            .__wmSc72Admitted(),
      }),
    onWorldManagerEvent: (callback) => {
      window.__wmSc72Event = callback;
      return () => {};
    },
    onWorldManagerSemanticEvent:
      () => () => {},
  };
});
const payload = Buffer.from(
  JSON.stringify({
    project: {
      id: "project_sc72",
      name: "SC7.2 Target Studio",
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
const comparisonSection =
  page.locator(
    "#aroCurrentTargetList",
  );
assert.equal(
  await comparisonSection.isVisible(),
  true,
);
assert.match(
  await comparisonSection.textContent(),
  /No canonical target exists yet/,
);
assert.equal(
  await page.locator(
    "#aroFocusedObject .aro-target-workbench",
  ).count(),
  1,
);
const intent =
  "Replace the static stack with focused semantic navigation while preserving exact object identity.";
await page.locator(
  "#aroFocusedObject .aro-target-intent",
).fill(intent);
const draftButton = page.locator(
  "#aroFocusedObject .aro-target-workbench .greenlight-button",
);
assert.equal(
  await draftButton.isEnabled(),
  true,
);
await draftButton.click();
await page.waitForFunction(() =>
  window.__wmSc72Calls.length === 1);
const call = await page.evaluate(() =>
  window.__wmSc72Calls[0]);
assert.equal(
  call.currentAroId,
  currentAro.aroId,
);
assert.equal(
  call.currentAroDigest,
  currentAro.digest,
);
assert.equal(
  call.targetIntent,
  intent,
);
assert.equal(call.retry, false);
assert.equal(
  call.semanticRegionBindingRef.kind,
  "semantic_region_binding",
);

await page.waitForSelector(
  `#aroFocusedObject .aro-surface[data-subject-id="${targetCandidate.candidateId}"]`,
);
assert.match(
  await page.locator(
    "#aroFocusedObject .aro-surface .inspector-object-kind",
  ).first().textContent(),
  /target definition/i,
);
assert.match(
  await page.locator(
    "#aroFocusedObject .aro-target-provenance",
  ).textContent(),
  /Turn the semantic anatomy workbench into a focused object navigator/,
);
assert.equal(
  await page.locator(
    "#aroCandidateList .aro-object-nav-entry",
  ).count(),
  1,
);
const canonicalNavigatorText =
  await page.locator(
    "#aroRegistryList",
  ).textContent();
assert.doesNotMatch(
  canonicalNavigatorText,
  new RegExp(
    targetCandidate.candidateAro
      .coverageWitness
      .coverageWitnessId,
  ),
);
assert.match(
  canonicalNavigatorText,
  /Semantic anatomy workbench/,
);

await page.evaluate(async () => {
  window.__wmSc72Event({
    projection:
      await window
        .__wmSc72Admitted(),
  });
});
await page.waitForFunction(
  (comparisonId) =>
    Boolean(
      document.querySelector(
        `#aroCurrentTargetList [data-subject-id="${comparisonId}"]`,
      ),
    ),
  comparison.comparisonId,
);
await page.locator(
  `#aroRegistryList [data-subject-id="${currentAro.aroId}"]`,
).click();
const reviseTarget = page.locator(
  "#aroFocusedObject .aro-target-workbench .evidence-button",
);
assert.match(
  await reviseTarget.textContent(),
  /Revise target posture/,
);
await reviseTarget.click();
assert.equal(
  await page.locator(
    "#aroFocusedObject .aro-target-intent",
  ).count(),
  1,
);
assert.match(
  await page.locator(
    "#aroFocusedObject .aro-target-workbench .greenlight-button",
  ).textContent(),
  /Draft target revision/,
);
const comparisonEntry =
  page.locator(
    `#aroCurrentTargetList [data-subject-id="${comparison.comparisonId}"]`,
  );
await comparisonEntry.click();
assert.equal(
  await page.locator(
    `#aroFocusedObject .aro-comparison-morph`,
  ).count(),
  1,
);
assert.equal(
  await page.locator(
    "#aroFocusedObject .aro-mutation-workbench",
  ).count(),
  1,
);
assert.doesNotMatch(
  await comparisonSection.textContent(),
  /No canonical target exists yet/,
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
    slice: "WM-SC7.2-ui",
    comparisonPrerequisiteVisible: true,
    targetComposerBound: true,
    candidateFocusedAfterDefinition:
      true,
    targetIntentSameContextReachable:
      true,
    candidateCoverageNotMislabelledCanonical:
      true,
    comparisonReachableAfterAdmission:
      true,
    targetRevisionComposerReachable:
      true,
  }),
);
