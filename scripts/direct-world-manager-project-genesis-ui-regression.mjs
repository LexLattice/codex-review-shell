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
  path.join(os.tmpdir(), "world-manager-genesis-ui-"),
);
const projectionPath = path.join(rootDir, "projection.json");
const candidateProjectionPath = path.join(
  rootDir,
  "candidate-projection.json",
);
const reviewedProjectionPath = path.join(
  rootDir,
  "reviewed-projection.json",
);
const provisionedProjectionPath = path.join(
  rootDir,
  "provisioned-projection.json",
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
        projectionPath,
      CODEX_WORLD_MANAGER_GENESIS_CANDIDATE_PROJECTION_PATH:
        candidateProjectionPath,
      CODEX_WORLD_MANAGER_GENESIS_REVIEWED_PROJECTION_PATH:
        reviewedProjectionPath,
      CODEX_WORLD_MANAGER_GENESIS_PROVISIONED_PROJECTION_PATH:
        provisionedProjectionPath,
    },
    encoding: "utf8",
  },
);
assert.equal(
  fixture.status,
  0,
  fixture.stderr ||
    fixture.stdout ||
    "Project-genesis projection fixture failed.",
);
const projection = JSON.parse(
  fs.readFileSync(projectionPath, "utf8"),
);
const candidateProjection = JSON.parse(
  fs.readFileSync(candidateProjectionPath, "utf8"),
);
const reviewedProjection = JSON.parse(
  fs.readFileSync(reviewedProjectionPath, "utf8"),
);
const provisionedProjection = JSON.parse(
  fs.readFileSync(provisionedProjectionPath, "utf8"),
);

const server = new LocalSurfaceServer(path.resolve("src/renderer"));
const baseUrl = await server.ensureStarted();
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 1480, height: 920 },
});
const consoleErrors = [];
page.on("console", (message) => {
  if (message.type() === "error") {
    consoleErrors.push(message.text());
  }
});
page.on("pageerror", (error) =>
  consoleErrors.push(error.message));
await page.exposeFunction("__wmGenesisSnapshot", () => projection);
await page.exposeFunction(
  "__wmGenesisCandidateSnapshot",
  () => candidateProjection,
);
await page.exposeFunction(
  "__wmGenesisReviewedSnapshot",
  () => reviewedProjection,
);
await page.exposeFunction(
  "__wmGenesisProvisionedSnapshot",
  () => provisionedProjection,
);
await page.addInitScript(() => {
  window.__wmGenesisUiCalls = {
    review: 0,
    admission: 0,
    provisioning: 0,
    focus: 0,
  };
  window.codexSurfaceBridge = {
    getWorldManagerSnapshot: () =>
      window.__wmGenesisCandidateSnapshot(),
    submitWorldManagerMessage: async () => ({
      projection: await window.__wmGenesisSnapshot(),
    }),
    focusWorldManagerProject: async () => {
      window.__wmGenesisUiCalls.focus += 1;
      return {
        projection:
          await window.__wmGenesisSnapshot(),
      };
    },
    inspectWorldManagerProjectGenesisCandidate: async () => {
      window.__wmGenesisUiCalls.review += 1;
      return {
        projection:
          await window.__wmGenesisReviewedSnapshot(),
      };
    },
    admitWorldManagerProjectGenesisCandidate: async () => {
      window.__wmGenesisUiCalls.admission += 1;
      return {
        projection: await window.__wmGenesisSnapshot(),
      };
    },
    provisionWorldManagerProjectSubstrate: async () => {
      window.__wmGenesisUiCalls.provisioning += 1;
      return {
        projection: await window.__wmGenesisProvisionedSnapshot(),
      };
    },
    onWorldManagerEvent: () => () => {},
    onWorldManagerSemanticEvent: () => () => {},
  };
});
const payload = Buffer.from(JSON.stringify({
  project: {
    id: "project_control_plane",
    name: "Control Plane",
  },
  worldManager: {
    mode: "production",
    pipelineStage: "wm_k6_genesis",
  },
}), "utf8").toString("base64url");
await page.goto(
  `${baseUrl}/world-manager-surface.html#${payload}`,
  { waitUntil: "networkidle" },
);
await page.waitForFunction(() =>
  document.querySelector("#worldRevision")?.textContent
    ?.includes("WM-K6-GENESIS"));

assert.equal(
  await page.locator("#projectGenesisPanel").isHidden(),
  false,
);
assert.match(
  await page.locator("#projectGenesisTitle").innerText(),
  /Windows Shell Integration/i,
);
assert.match(
  await page.locator("#projectGenesisState").innerText(),
  /^candidate$/i,
);
assert.match(
  await page.locator("#projectGenesisDefault").innerText(),
  /Windows.*native resident process/i,
);
assert.equal(
  await page.locator("#realizationOptionList .realization-option").count(),
  2,
);
assert.match(
  await page.locator("#realizationOptionList").innerText(),
  /Windows[\s\S]*ready.*eligible[\s\S]*WSL/i,
);
assert.equal(await page.locator("#admitProjectButton").isHidden(), false);
assert.equal(await page.locator("#admitProjectButton").isDisabled(), true);
assert.match(
  await page.locator("#projectAdmissionGate").innerText(),
  /inspect the recommendation, substrate evidence, and lineage/i,
);
assert.equal(await page.locator("#proposalPanel").isHidden(), true);
assert.equal(await page.locator("#contractPanel").isHidden(), true);
const candidateProjectCard = page.locator(
  '.project-card[data-project-id="project_windows_shell"]',
);
assert.equal(await candidateProjectCard.count(), 1);
assert.equal(
  await candidateProjectCard.getAttribute(
    "data-project-posture",
  ),
  "semantic_candidate",
);
assert.match(
  await candidateProjectCard.innerText(),
  /candidate[\s\S]*review required/i,
);
assert.match(
  await page.locator("#projectCount").innerText(),
  /1 project.*1 candidate/i,
);
assert.match(
  await page
    .locator('.metric[data-inspector="projects"]')
    .innerText(),
  /1.*1[\s\S]*projects.*candidates/i,
);
assert.equal(
  await candidateProjectCard.evaluate((element) =>
    getComputedStyle(element).borderStyle),
  "dashed",
);
await candidateProjectCard.click();
assert.equal(
  await page
    .locator("#projectEcologyInspector")
    .isVisible(),
  true,
);
assert.match(
  await page
    .locator("#projectEcologyFacts")
    .innerText(),
  /semantic candidate[\s\S]*not admitted[\s\S]*not reviewed[\s\S]*reconciled/i,
);
assert.equal(
  await page
    .locator("#activateInspectedProject")
    .isDisabled(),
  true,
);
assert.match(
  await page
    .locator("#activateInspectedProject")
    .innerText(),
  /inspection only.*admission pending/i,
);
const candidateScreenshotPath = path.join(
  os.tmpdir(),
  "world-manager-project-genesis-candidate-ui-regression.png",
);
await page.screenshot({
  path: candidateScreenshotPath,
  fullPage: false,
});
assert.ok(
  fs.statSync(candidateScreenshotPath).size > 20_000,
);

await page.locator("#inspectGenesisEvidenceButton").click();
assert.equal(await page.locator("#semanticZoom").isHidden(), false);
assert.match(
  await page.locator("#settlementEvidence").innerText(),
  /Substrate/i,
);
assert.match(
  await page.locator("#settlementEvidence").innerText(),
  /Project constitution[\s\S]*candidate/i,
);
assert.match(
  await page.locator("#settlementEvidence").innerText(),
  /Workspace provisioned[\s\S]*no[\s\S]*Worker execution[\s\S]*not available/i,
);
assert.equal(await page.locator("#markEvidenceReviewed").isHidden(), false);
await page.locator("#markEvidenceReviewed").click();
assert.equal(
  await page.locator("#admitProjectButton").isDisabled(),
  false,
);
assert.match(
  await page.locator("#projectGenesisState").innerText(),
  /candidate.*reviewed/i,
);
assert.equal(await candidateProjectCard.count(), 1);
assert.match(
  await candidateProjectCard.innerText(),
  /candidate[\s\S]*evidence reviewed/i,
);
assert.equal(
  await candidateProjectCard.getAttribute(
    "data-project-posture",
  ),
  "semantic_candidate",
);
await page.locator("#closeSemanticZoom").click();
await page.locator("#admitProjectButton").click();
assert.match(
  await page.locator("#projectGenesisState").innerText(),
  /canonical.*awaiting provisioning/i,
);
assert.equal(await page.locator("#admitProjectButton").isHidden(), true);
assert.match(
  await page.locator("#projectAdmissionGate").innerText(),
  /choose the native workspace to provision the runtime binding/i,
);
assert.equal(
  await page.locator("#projectSubstrateProvisioning").isVisible(),
  true,
);
assert.match(
  await page.locator("#projectWorkspacePathLabel").innerText(),
  /native windows workspace path/i,
);
assert.equal(
  await page.locator("#provisionProjectSubstrateButton").isDisabled(),
  true,
);
await page.locator("#projectWorkspacePath").fill(
  "C:\\Users\\Rose\\work\\windows-shell",
);
assert.equal(
  await page.locator("#provisionProjectSubstrateButton").isDisabled(),
  false,
);
const admittedProjectCard = page.locator(
  '.project-card[data-project-id="project_windows_shell"]',
);
await page.locator("#provisionProjectSubstrateButton").click();
assert.match(
  await page.locator("#projectGenesisState").innerText(),
  /canonical.*substrate provisioned/i,
);
assert.equal(
  await page.locator("#projectSubstrateProvisioning").isHidden(),
  true,
);
assert.match(
  await page.locator("#projectAdmissionGate").innerText(),
  /native workspace binding.*exact environment snapshot.*canonical/i,
);
assert.match(
  await admittedProjectCard.innerText(),
  /native substrate ready/i,
);
assert.equal(await admittedProjectCard.count(), 1);
assert.match(
  await admittedProjectCard.innerText(),
  /windows native[\s\S]*native substrate ready/i,
);
assert.equal(
  await admittedProjectCard.getAttribute(
    "data-project-posture",
  ),
  "provisioned_constitution",
);
assert.match(
  await page.locator("#projectCount").innerText(),
  /^2 projects$/i,
);
await admittedProjectCard.click();
assert.equal(
  await page
    .locator("#projectEcologyInspector")
    .isVisible(),
  true,
);
assert.match(
  await page
    .locator("#projectEcologyFacts")
    .innerText(),
  /provisioned constitution[\s\S]*workspace substrate[\s\S]*provisioned[\s\S]*primary environment[\s\S]*ready/i,
);
assert.equal(
  await page
    .locator("#activateInspectedProject")
    .isDisabled(),
  true,
);
assert.match(
  await page
    .locator("#activateInspectedProject")
    .innerText(),
  /inspection only.*worldmodel activation pending/i,
);
await page
  .locator('.metric[data-inspector="decisions"]')
  .click();
assert.match(
  await page
    .locator("#decisionOutcomeTitle")
    .innerText(),
  /1 open decision/i,
);
assert.match(
  await page
    .locator("#openDecisionList")
    .innerText(),
  /Choose the workspace path during provisioning/i,
);
assert.match(
  await page
    .locator("#openDecisionList")
    .innerText(),
  /semantic relay[\s\S]*project shelf bound[\s\S]*expected revision and idempotency enforced/i,
);
assert.deepEqual(
  await page.evaluate(() => window.__wmGenesisUiCalls),
  { review: 1, admission: 1, provisioning: 1, focus: 0 },
);
assert.deepEqual(consoleErrors, []);

const screenshotPath = path.join(
  os.tmpdir(),
  "world-manager-project-genesis-ui-regression.png",
);
await page.screenshot({
  path: screenshotPath,
  fullPage: false,
});
assert.ok(fs.statSync(screenshotPath).size > 20_000);

await browser.close();
await server.dispose();
fs.rmSync(rootDir, { recursive: true, force: true });

console.log(JSON.stringify({
  ok: true,
  regression: "direct-world-manager-project-genesis-ui",
  screenshotPath,
  candidateScreenshotPath,
  projectConstitutionVisible: true,
  substrateRankingVisible: true,
  reconciledCandidateVisibleInProjectEcology: true,
  candidateAndProjectCountsRemainDistinct: true,
  oneCardIdentityPersistsAcrossAdmission: true,
  canonicalAdmissionDistinguishedFromProvisioning: true,
  nativeWorkspaceProvisioningControlVisible: true,
  provisioningTransitionRendered: true,
  canonicalUnprovisionedProjectIsInspectableNotFocusable:
    true,
  openProjectDecisionsAreInspectable: true,
  sameContextAuthorityEvidenceVisible: true,
  proposalAndExecutionControlsRemainAbsent: true,
}, null, 2));
