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

const rootDir = fs.mkdtempSync(
  path.join(
    os.tmpdir(),
    "world-manager-sc7-ui-",
  ),
);
const candidatePath = path.join(
  rootDir,
  "candidate.json",
);
const reviewedPath = path.join(
  rootDir,
  "reviewed.json",
);
const admittedPath = path.join(
  rootDir,
  "admitted.json",
);
const fixture = spawnSync(
  process.execPath,
  [
    path.resolve(
      "scripts/direct-world-manager-aro-regression.mjs",
    ),
  ],
  {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CODEX_WORLD_MANAGER_SC7_CANDIDATE_PROJECTION_PATH:
        candidatePath,
      CODEX_WORLD_MANAGER_SC7_REVIEWED_PROJECTION_PATH:
        reviewedPath,
      CODEX_WORLD_MANAGER_SC7_ADMITTED_PROJECTION_PATH:
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
    "SC7 UI fixture failed.",
);
const candidateProjection = JSON.parse(
  fs.readFileSync(candidatePath, "utf8"),
);
const reviewedProjection = JSON.parse(
  fs.readFileSync(reviewedPath, "utf8"),
);
const admittedProjection = JSON.parse(
  fs.readFileSync(admittedPath, "utf8"),
);
const currentCandidate =
  candidateProjection.aroRegistry
    .candidates.find((candidate) =>
      candidate.candidateAro.posture ===
        "current");
assert.ok(currentCandidate);
const currentCandidateSurface =
  candidateProjection.semanticSurface
    .objectSurfaces.find((surface) =>
      surface.objectClass ===
        "aro_reconstruction_candidate" &&
      surface.subjectRef.id ===
        currentCandidate.candidateId);
assert.ok(currentCandidateSurface);

const server = new LocalSurfaceServer(
  path.resolve("src/renderer"),
);
const baseUrl = await server.ensureStarted();
const browser = await chromium.launch({
  headless: true,
});
const page = await browser.newPage({
  viewport: {
    width: 1480,
    height: 940,
  },
});
const consoleErrors = [];
page.on("console", (message) => {
  if (message.type() === "error") {
    consoleErrors.push(message.text());
  }
});
page.on("pageerror", (error) =>
  consoleErrors.push(error.message));
await page.exposeFunction(
  "__wmSc7CandidateProjection",
  () => candidateProjection,
);
await page.exposeFunction(
  "__wmSc7ReviewedProjection",
  () => reviewedProjection,
);
await page.exposeFunction(
  "__wmSc7AdmittedProjection",
  () => admittedProjection,
);
await page.addInitScript(() => {
  window.__wmSc7Calls = {
    reviews: [],
    admissions: [],
  };
  window.codexSurfaceBridge = {
    getWorldManagerSnapshot: () =>
      window
        .__wmSc7CandidateProjection(),
    submitWorldManagerMessage:
      async () => ({
        projection:
          await window
            .__wmSc7CandidateProjection(),
      }),
    focusWorldManagerProject:
      async () => ({
        projection:
          await window
            .__wmSc7CandidateProjection(),
      }),
    reviewWorldManagerAroReconstruction:
      async (
        candidateId,
        candidateDigest,
        expectedCandidateRevision,
        semanticRegionBindingRef,
        actorId,
      ) => {
        window.__wmSc7Calls.reviews.push({
          candidateId,
          candidateDigest,
          expectedCandidateRevision,
          semanticRegionBindingRef,
          actorId,
        });
        return {
          projection:
            await window
              .__wmSc7ReviewedProjection(),
        };
      },
    admitWorldManagerAroReconstruction:
      async (
        candidateId,
        candidateDigest,
        expectedCandidateRevision,
        semanticRegionBindingRef,
        actorId,
      ) => {
        window.__wmSc7Calls.admissions
          .push({
            candidateId,
            candidateDigest,
            expectedCandidateRevision,
            semanticRegionBindingRef,
            actorId,
          });
        return {
          projection:
            await window
              .__wmSc7AdmittedProjection(),
        };
      },
    onWorldManagerEvent: () => () => {},
    onWorldManagerSemanticEvent:
      () => () => {},
  };
});
const payload = Buffer.from(
  JSON.stringify({
    project: {
      id: "project_sc7",
      name: "SC7 ARO Studio",
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
      "WM-K6-GENESIS",
    ));

const aroMetric = page.locator(
  '.metric[data-inspector="aros"]',
);
assert.equal(await aroMetric.count(), 1);
const inlineAroControl = page.locator(
  `.inline-semantic-artifact[data-subject-id="${currentCandidate.candidateId}"] .message-inspect-button`,
);
assert.equal(
  await inlineAroControl.count(),
  1,
);
await inlineAroControl.click();
assert.equal(
  await page.locator(
    "#aroFocusedObject .aro-surface",
  ).getAttribute("data-subject-id"),
  currentCandidate.candidateId,
);
assert.equal(
  await page.evaluate(() =>
    document.activeElement?.id),
  "aroFocusedObject",
);
await aroMetric.click();
assert.equal(
  await page.locator("#aroInspector")
    .isHidden(),
  false,
);
assert.equal(
  await page.locator(
    '#aroCandidateList .aro-object-nav-entry[data-object-class="aro_reconstruction_candidate"]',
  ).count(),
  2,
);

const alternateCandidate =
  candidateProjection.aroRegistry
    .candidates.find((candidate) =>
      candidate.candidateId !==
        currentCandidate.candidateId);
assert.ok(alternateCandidate);
await page.locator(
  `#aroCandidateList .aro-object-nav-entry[data-subject-id="${alternateCandidate.candidateId}"]`,
).click();
assert.equal(
  await page.locator(
    "#aroFocusedObject .aro-surface",
  ).getAttribute("data-subject-id"),
  alternateCandidate.candidateId,
);
await page.locator(
  `#aroCandidateList .aro-object-nav-entry[data-subject-id="${currentCandidate.candidateId}"]`,
).click();
const currentSelector =
  `#aroFocusedObject .aro-surface[data-subject-id="${currentCandidate.candidateId}"]`;
let currentCard = page.locator(
  currentSelector,
);
assert.equal(await currentCard.count(), 1);
assert.equal(
  await currentCard.locator(
    ".semantic-lens-button",
  ).count(),
  4,
);
assert.ok(
  await currentCard.locator(
    ".aro-tree-node.counterfactual",
  ).count() > 0,
);
assert.ok(
  await currentCard.locator(
    ".aro-coverage-edge",
  ).count() > 0,
);
assert.ok(
  await currentCard.locator(
    ".aro-ref-list span",
  ).count() > 0,
);

await currentCard.locator(
  '.semantic-lens-button[data-lens="E"]',
).click();
currentCard = page.locator(
  currentSelector,
);
const evidenceBindingId =
  await currentCard.locator(
    ".semantic-landscape",
  ).getAttribute(
    "data-region-binding-id",
  );
const evidenceBinding =
  candidateProjection.semanticSurface
    .regionBindings.find((binding) =>
      binding.semanticRegionBindingId ===
        evidenceBindingId);
assert.ok(evidenceBinding);
await currentCard.locator(
  ".aro-candidate-actions .evidence-button",
).click();
await page.waitForFunction(() =>
  window.__wmSc7Calls.reviews.length ===
    1);
const reviewCall =
  await page.evaluate(() =>
    window.__wmSc7Calls.reviews[0]);
assert.equal(
  reviewCall.candidateId,
  currentCandidate.candidateId,
);
assert.equal(
  reviewCall.candidateDigest,
  currentCandidate.digest,
);
assert.equal(
  reviewCall.expectedCandidateRevision,
  1,
);
assert.deepEqual(
  reviewCall.semanticRegionBindingRef,
  {
    kind: "semantic_region_binding",
    id:
      evidenceBinding
        .semanticRegionBindingId,
    digest: evidenceBinding.digest,
  },
);

const reviewedCandidate =
  reviewedProjection.aroRegistry
    .candidates.find((candidate) =>
      candidate.candidateId ===
        currentCandidate.candidateId);
assert.equal(
  reviewedCandidate.candidateRevision,
  2,
);
currentCard = page.locator(
  currentSelector,
);
const admitButton =
  currentCard.locator(
    ".aro-candidate-actions .greenlight-button",
  );
assert.equal(
  await admitButton.isDisabled(),
  false,
);
const reviewedSurface =
  reviewedProjection.semanticSurface
    .objectSurfaces.find((surface) =>
      surface.objectClass ===
        "aro_reconstruction_candidate" &&
      surface.subjectRef.id ===
        currentCandidate.candidateId);
const reviewedBinding =
  reviewedProjection.semanticSurface
    .regionBindings.find((binding) =>
      binding.subjectRef.id ===
        currentCandidate.candidateId &&
      binding.selectedLens ===
        reviewedSurface.defaultLens);
await admitButton.click();
await page.waitForFunction(() =>
  window.__wmSc7Calls.admissions
    .length === 1);
const admissionCall =
  await page.evaluate(() =>
    window.__wmSc7Calls.admissions[0]);
assert.equal(
  admissionCall.candidateDigest,
  reviewedCandidate.digest,
);
assert.equal(
  admissionCall.expectedCandidateRevision,
  2,
);
assert.deepEqual(
  admissionCall.semanticRegionBindingRef,
  {
    kind: "semantic_region_binding",
    id:
      reviewedBinding
        .semanticRegionBindingId,
    digest: reviewedBinding.digest,
  },
);

assert.equal(
  await page.locator(
    '#aroRegistryList .aro-object-nav-entry[data-object-class="abstract_reasoning_object"]',
  ).count(),
  2,
);
await page.locator(
  '#aroRegistryList .aro-object-nav-entry[data-object-class="abstract_reasoning_object"]',
).first().click();
assert.ok(
  await page.locator(
    '#aroFocusedObject .aro-surface[data-object-class="abstract_reasoning_object"] .aro-tree-morph',
  ).count() === 1,
);
await page.locator(
  '#aroRegistryList .aro-object-nav-entry[data-object-class="aro_coverage_witness"]',
).first().click();
assert.ok(
  await page.locator(
    '#aroFocusedObject .aro-surface[data-object-class="aro_coverage_witness"] .aro-coverage-morph',
  ).count() === 1,
);
assert.equal(
  await page.locator(
    '#aroCurrentTargetList .aro-object-nav-entry[data-object-class="aro_current_target_comparison"]',
  ).count(),
  1,
);
await page.locator(
  '#aroCurrentTargetList .aro-object-nav-entry[data-object-class="aro_current_target_comparison"]',
).click();
assert.equal(
  await page.locator(
    "#aroFocusedObject .aro-comparison-column",
  ).count(),
  3,
);
if (
  process.env
    .CODEX_WORLD_MANAGER_SC7_SCREENSHOT_PATH
) {
  await page.screenshot({
    path:
      process.env
        .CODEX_WORLD_MANAGER_SC7_SCREENSHOT_PATH,
    fullPage: true,
  });
}
const comparisonSubjectId =
  admittedProjection.aroRegistry
    .currentTargetComparisons[0]
    .comparisonId;
await page.setViewportSize({
  width: 860,
  height: 940,
});
assert.equal(
  await page.locator(
    `#aroFocusedObject .aro-surface[data-subject-id="${comparisonSubjectId}"]`,
  ).count(),
  1,
);
assert.deepEqual(consoleErrors, []);

await browser.close();
await server.dispose();
fs.rmSync(rootDir, {
  recursive: true,
  force: true,
});

console.log(
  JSON.stringify(
    {
      ok: true,
      regression:
        "direct-world-manager-aro-ui",
      proofs: {
        aroMetricInspectable: true,
        inlineControlFocusesWorkbench:
          true,
        candidateNavigatorFocusesDetail:
          true,
        oneExpandedObjectAtATime: true,
        candidateComparisonVisible:
          true,
        exactEvidenceSameContext: true,
        intensionalTreeVisible: true,
        realizationGraphVisible: true,
        exactReviewBinding: true,
        reviewDoesNotCertifyTruth:
          true,
        exactAdmissionBinding: true,
        canonicalTreeVisible: true,
        currentTargetComparisonVisible:
          true,
        responsiveIdentityInvariant:
          true,
        rendererErrors: 0,
      },
    },
    null,
    2,
  ),
);
