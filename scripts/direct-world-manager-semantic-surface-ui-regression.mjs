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
    "world-manager-sc6-ui-",
  ),
);
const admittedProjectionPath = path.join(
  rootDir,
  "admitted-projection.json",
);
const candidateProjectionPath = path.join(
  rootDir,
  "candidate-projection.json",
);
const reviewedProjectionPath = path.join(
  rootDir,
  "reviewed-projection.json",
);
const fixture = spawnSync(
  process.execPath,
  [
    path.resolve(
      "scripts/direct-world-manager-project-genesis-regression.mjs",
    ),
  ],
  {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CODEX_WORLD_MANAGER_GENESIS_PROJECTION_PATH:
        admittedProjectionPath,
      CODEX_WORLD_MANAGER_GENESIS_CANDIDATE_PROJECTION_PATH:
        candidateProjectionPath,
      CODEX_WORLD_MANAGER_GENESIS_REVIEWED_PROJECTION_PATH:
        reviewedProjectionPath,
    },
    encoding: "utf8",
  },
);
assert.equal(
  fixture.status,
  0,
  fixture.stderr ||
    fixture.stdout ||
    "SC6 UI projection fixture failed.",
);
const candidateProjection = JSON.parse(
  fs.readFileSync(
    candidateProjectionPath,
    "utf8",
  ),
);
const reviewedProjection = JSON.parse(
  fs.readFileSync(
    reviewedProjectionPath,
    "utf8",
  ),
);

const semanticProjection =
  candidateProjection.semanticSurface;
const candidateSurface =
  semanticProjection.objectSurfaces.find(
    (surface) =>
      surface.objectClass ===
        "project_constitution_candidate",
  );
const relaySurface =
  semanticProjection.objectSurfaces.find(
    (surface) =>
      surface.objectClass ===
        "open_decision" &&
      surface.interaction
        .resolutionMode ===
        "semantic_relay",
  );
assert.ok(candidateSurface);
assert.ok(relaySurface);

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
    height: 920,
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
  "__wmSc6CandidateProjection",
  () => candidateProjection,
);
await page.exposeFunction(
  "__wmSc6ReviewedProjection",
  () => reviewedProjection,
);
await page.addInitScript(() => {
  window.__wmSc6Calls = {
    transitions: [],
    reviews: [],
    admissions: [],
  };
  window.codexSurfaceBridge = {
    getWorldManagerSnapshot: () =>
      window.__wmSc6CandidateProjection(),
    submitWorldManagerMessage:
      async () => ({
        projection:
          await window
            .__wmSc6CandidateProjection(),
      }),
    transitionWorldManagerDecision:
      async (payload) => {
        window.__wmSc6Calls
          .transitions.push(payload);
        return {
          receipt: {
            state: "relayed",
            summary:
              "SC6 exact-region relay accepted.",
          },
          projection:
            await window
              .__wmSc6CandidateProjection(),
        };
      },
    inspectWorldManagerProjectGenesisCandidate:
      async (
        candidateId,
        semanticRegionBindingRef,
      ) => {
        window.__wmSc6Calls.reviews.push({
          candidateId,
          semanticRegionBindingRef,
        });
        return {
          projection:
            await window
              .__wmSc6ReviewedProjection(),
        };
      },
    admitWorldManagerProjectGenesisCandidate:
      async (
        candidateId,
        actorId,
        semanticRegionBindingRef,
      ) => {
        window.__wmSc6Calls
          .admissions.push({
            candidateId,
            actorId,
            semanticRegionBindingRef,
          });
        return {
          projection:
            await window
              .__wmSc6ReviewedProjection(),
        };
      },
    focusWorldManagerProject:
      async () => ({
        projection:
          await window
            .__wmSc6CandidateProjection(),
      }),
    onWorldManagerEvent: () => () => {},
    onWorldManagerSemanticEvent:
      () => () => {},
  };
});
const payload = Buffer.from(
  JSON.stringify({
    project: {
      id: "project_control_plane",
      name: "Control Plane",
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

assert.equal(
  await page
    .locator(".inline-semantic-artifact")
    .count(),
  semanticProjection.inlineArtifacts
    .length,
);
for (
  const artifact of
    semanticProjection.inlineArtifacts
) {
  const message = page.locator(
    `.message[data-lineage-root-id="${artifact.anchorSemanticEventId}"]`,
  );
  assert.equal(
    await message
      .locator(
        `.inline-semantic-artifact[data-semantic-surface-id="${artifact.surfaceRef.id}"]`,
      )
      .count(),
    1,
  );
}

assert.equal(
  await page
    .locator("#decisionDock")
    .isHidden(),
  false,
);
assert.equal(
  await page
    .locator(
      "#decisionDockEntries .decision-dock-entry",
    )
    .count(),
  Math.min(
    semanticProjection.decisionDock
      .entries.length,
    4,
  ),
);
const dockRelay = page.locator(
  `.decision-dock-entry[data-semantic-surface-id="${relaySurface.semanticObjectSurfaceId}"]`,
);
assert.equal(
  await dockRelay.count(),
  1,
);
assert.equal(
  await dockRelay.getAttribute(
    "data-subject-id",
  ),
  relaySurface.subjectRef.id,
);
await dockRelay.click();

const relayCardSelector =
  `.compiled-semantic-surface[data-semantic-surface-id="${relaySurface.semanticObjectSurfaceId}"]`;
let relayCard = page.locator(
  relayCardSelector,
);
assert.equal(await relayCard.count(), 1);
assert.equal(
  await relayCard.getAttribute(
    "data-decision-id",
  ),
  relaySurface.subjectRef.id,
);
assert.equal(
  await relayCard
    .locator(
      ".semantic-lens-button",
    )
    .count(),
  4,
);
assert.equal(
  await relayCard.getAttribute(
    "data-semantic-lens",
  ),
  relaySurface.defaultLens,
);
const initialRelayBindingId =
  await relayCard
    .locator(".semantic-landscape")
    .getAttribute(
      "data-region-binding-id",
    );
await relayCard
  .locator(
    '.semantic-lens-button[data-lens="E"]',
  )
  .click();
relayCard = page.locator(
  relayCardSelector,
);
assert.equal(
  await relayCard.getAttribute(
    "data-semantic-lens",
  ),
  "E",
);
assert.equal(
  await relayCard.getAttribute(
    "data-decision-id",
  ),
  relaySurface.subjectRef.id,
);
const evidenceRelayBindingId =
  await relayCard
    .locator(".semantic-landscape")
    .getAttribute(
      "data-region-binding-id",
    );
assert.notEqual(
  evidenceRelayBindingId,
  initialRelayBindingId,
);
const exactEvidenceBinding =
  semanticProjection.regionBindings.find(
    (binding) =>
      binding
        .semanticRegionBindingId ===
        evidenceRelayBindingId,
  );
assert.ok(exactEvidenceBinding);
assert.deepEqual(
  exactEvidenceBinding.subjectRef,
  relaySurface.subjectRef,
);

await relayCard
  .locator(".decision-relay-input")
  .fill(
    "Reframe this around the evidence already attached here.",
  );
await relayCard
  .locator(".decision-relay-submit")
  .click();
await page.waitForFunction(
  () =>
    window.__wmSc6Calls.transitions
      .length === 1,
);
const transitionCall =
  await page.evaluate(
    () =>
      window.__wmSc6Calls
        .transitions[0],
  );
assert.equal(
  transitionCall.decisionId,
  relaySurface.subjectRef.id,
);
assert.deepEqual(
  transitionCall
    .semanticRegionBindingRef,
  {
    kind: "semantic_region_binding",
    id:
      exactEvidenceBinding
        .semanticRegionBindingId,
    digest:
      exactEvidenceBinding.digest,
  },
);

const genesisPanel = page.locator(
  "#projectGenesisPanel",
);
assert.equal(
  await genesisPanel.getAttribute(
    "data-semantic-surface-id",
  ),
  candidateSurface
    .semanticObjectSurfaceId,
);
assert.equal(
  await page
    .locator(
      "#projectGenesisLens .semantic-lens-button",
    )
    .count(),
  4,
);
assert.equal(
  await page
    .locator(
      "#projectGenesisLandscape .semantic-landscape",
    )
    .getAttribute("data-lens"),
  "U",
);
const genesisUtilityBinding =
  await genesisPanel.getAttribute(
    "data-semantic-region-binding-id",
  );
await page
  .locator(
    '#projectGenesisLens .semantic-lens-button[data-lens="D"]',
  )
  .click();
assert.equal(
  await genesisPanel.getAttribute(
    "data-semantic-surface-id",
  ),
  candidateSurface
    .semanticObjectSurfaceId,
);
assert.equal(
  await page
    .locator(
      "#projectGenesisLandscape .semantic-landscape",
    )
    .getAttribute("data-lens"),
  "D",
);
const genesisAuthorityBinding =
  await genesisPanel.getAttribute(
    "data-semantic-region-binding-id",
  );
assert.notEqual(
  genesisAuthorityBinding,
  genesisUtilityBinding,
);

await page.setViewportSize({
  width: 860,
  height: 920,
});
assert.equal(
  await genesisPanel.getAttribute(
    "data-semantic-surface-id",
  ),
  candidateSurface
    .semanticObjectSurfaceId,
);
assert.equal(
  await page
    .locator(
      "#projectGenesisLandscape .semantic-landscape",
    )
    .getAttribute("data-lens"),
  "D",
);

await page
  .locator(
    "#inspectGenesisEvidenceButton",
  )
  .click();
await page
  .locator("#markEvidenceReviewed")
  .click();
await page.waitForFunction(
  () =>
    window.__wmSc6Calls.reviews
      .length === 1,
);
const reviewCall =
  await page.evaluate(
    () => window.__wmSc6Calls.reviews[0],
  );
assert.equal(
  reviewCall.candidateId,
  candidateSurface.subjectRef.id,
);
const authorityBinding =
  semanticProjection.regionBindings.find(
    (binding) =>
      binding
        .semanticRegionBindingId ===
        genesisAuthorityBinding,
  );
assert.ok(authorityBinding);
assert.deepEqual(
  reviewCall.semanticRegionBindingRef,
  {
    kind: "semantic_region_binding",
    id:
      authorityBinding
        .semanticRegionBindingId,
    digest: authorityBinding.digest,
  },
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
        "direct-world-manager-semantic-surface-ui",
      proofs: {
        inlineArtifactAtExactEvent: true,
        globalDecisionDock: true,
        dockPreservesExactIdentity: true,
        fourLensRhombNavigator: true,
        lensSwitchChangesForeground: true,
        lensSwitchPreservesIdentity: true,
        regionBindingChangesWithLens: true,
        scopedComposerCarriesExactRegion: true,
        genesisComparisonUsesCompiler: true,
        responsiveLayoutPreservesIdentity: true,
        genesisReviewCarriesExactRegion: true,
        rendererErrors: 0,
      },
    },
    null,
    2,
  ),
);
