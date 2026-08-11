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
  path.join(os.tmpdir(), "world-manager-k4-ui-"),
);
const projectionPath = path.join(rootDir, "projection.json");
const greetingProjectionPath = path.join(
  rootDir,
  "greeting-projection.json",
);
const fixture = spawnSync(
  process.execPath,
  [path.resolve("scripts/direct-world-manager-k4-regression.mjs")],
  {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CODEX_WORLD_MANAGER_K4_PROJECTION_PATH: projectionPath,
      CODEX_WORLD_MANAGER_K4_GREETING_PROJECTION_PATH:
        greetingProjectionPath,
    },
    encoding: "utf8",
  },
);
assert.equal(
  fixture.status,
  0,
  fixture.stderr || fixture.stdout || "K4 projection fixture failed.",
);
const projection = JSON.parse(fs.readFileSync(projectionPath, "utf8"));
const greetingProjection = JSON.parse(
  fs.readFileSync(greetingProjectionPath, "utf8"),
);

const server = new LocalSurfaceServer(path.resolve("src/renderer"));
const baseUrl = await server.ensureStarted();
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 1480, height: 920 },
});
const consoleErrors = [];
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});
page.on("pageerror", (error) => consoleErrors.push(error.message));
await page.exposeFunction("__wmK4Snapshot", () => projection);
await page.addInitScript(() => {
  window.codexSurfaceBridge = {
    getWorldManagerSnapshot: () => window.__wmK4Snapshot(),
    submitWorldManagerMessage: async () => ({
      projection: await window.__wmK4Snapshot(),
    }),
    focusWorldManagerProject: async () => ({
      projection: await window.__wmK4Snapshot(),
    }),
    onWorldManagerEvent: () => () => {},
    onWorldManagerSemanticEvent: () => () => {},
  };
});
const payload = Buffer.from(JSON.stringify({
  project: { id: "project_alpha", name: "Project Alpha" },
  worldManager: { mode: "production", pipelineStage: "wm_k4" },
}), "utf8").toString("base64url");
await page.goto(
  `${baseUrl}/world-manager-surface.html#${payload}`,
  { waitUntil: "networkidle" },
);
await page.waitForFunction(() =>
  document.querySelector("#worldRevision")?.textContent
    ?.includes("WM-K4"));

assert.equal(await page.locator(".message.user").count(), 1);
assert.equal(await page.locator(".message.agent").count(), 1);
assert.match(
  await page.locator(".message.agent .message-role").innerText(),
  /project manager replied/i,
);
assert.match(
  await page.locator(".message.agent .message-state").innerText(),
  /reconciled/i,
);
assert.match(
  await page.locator("#settlementTitle").innerText(),
  /project manager result/i,
);
assert.match(
  await page.locator("#settlementFacts").innerText(),
  /provider role[\s\S]*persisted direct/i,
);
assert.equal(
  await page.locator("#operationalContextRibbon").isHidden(),
  false,
);
assert.match(
  await page.locator("#operationalContextState").innerText(),
  /fresh/i,
);
assert.match(
  await page.locator("#operationalContextSummary").innerText(),
  /project_alpha[\s\S]*project deliberation[\s\S]*architecture/i,
);
await page.locator("#operationalContextRibbon summary").click();
const operationalContextFacts = await page
  .locator("#operationalContextFacts")
  .innerText();
assert.match(
  operationalContextFacts,
  /scope[\s\S]*shelves[\s\S]*selection/i,
);
assert.match(
  operationalContextFacts,
  /request lineage[\s\S]*linked/i,
);
assert.match(
  operationalContextFacts,
  /authority[\s\S]*read only[\s\S]*no world effect/i,
);
assert.equal(
  await page.locator("#reconciliationPanel").isHidden(),
  false,
);
assert.match(
  await page.locator("#reconciliationTitle").innerText(),
  /world posture reconciled/i,
);
assert.match(
  await page.locator("#reconciliationSummary").innerText(),
  /coherent direction/i,
);
assert.equal(await page.locator("#proposalPanel").isHidden(), true);
assert.equal(await page.locator("#contractPanel").isHidden(), true);
assert.equal(await page.locator("#greenlightButton").isHidden(), true);

const operationalContextScreenshotPath = path.join(
  os.tmpdir(),
  "world-manager-operational-context-ui-regression.png",
);
await page.screenshot({
  path: operationalContextScreenshotPath,
  fullPage: false,
});
assert.ok(
  fs.statSync(operationalContextScreenshotPath).size >
    20_000,
);

await page.locator("#inspectSettlementButton").click();
assert.equal(await page.locator("#semanticZoom").isHidden(), false);
assert.match(
  await page.locator("#settlementEvidence").innerText(),
  /Governance[\s\S]*Semantic shelves[\s\S]*Imported context[\s\S]*Selected context/i,
);
assert.match(
  await page.locator("#resultEvidence").innerText(),
  /task settlement[\s\S]*routing decision[\s\S]*context requirement set[\s\S]*semantic context bundle/i,
);
await page.locator('[data-semantic-depth="execution"]').click();
const resultEvidence = await page.locator("#resultEvidence").innerText();
const executionEvidence = await page
  .locator("#settlementEvidence")
  .innerText();
assert.match(
  executionEvidence,
  /Execution[\s\S]*Role result[\s\S]*reconciled[\s\S]*Output contract[\s\S]*validated/i,
);
assert.match(
  executionEvidence,
  /Runtime \/ model[\s\S]*direct \/ gpt-5\.4/i,
);
assert.match(resultEvidence, /agent result/i);
const reconciliationEvidence = await page
  .locator("#reconciliationEvidence")
  .innerText();
assert.match(
  reconciliationEvidence,
  /same-context authority gate/i,
);
assert.match(
  reconciliationEvidence,
  /admission authority[\s\S]*not granted[\s\S]*inspection effect[\s\S]*read only/i,
);
assert.match(
  await page.locator("#lineageList").innerText(),
  /agent result completed[\s\S]*reconciliation completed/i,
);
assert.match(
  await page.locator("#evidenceReviewStatus").innerText(),
  /grants no authority[\s\S]*changes no canonical state/i,
);
assert.equal(
  await page.locator("#markEvidenceReviewed").isHidden(),
  true,
);
await page.waitForTimeout(250);

const screenshotPath = path.join(
  os.tmpdir(),
  "world-manager-k4-ui-regression.png",
);
await page.screenshot({ path: screenshotPath, fullPage: false });
assert.ok(fs.statSync(screenshotPath).size > 20_000);
assert.deepEqual(consoleErrors, []);

const greetingPage = await browser.newPage({
  viewport: { width: 1100, height: 760 },
});
const greetingErrors = [];
greetingPage.on("console", (message) => {
  if (message.type() === "error") {
    greetingErrors.push(message.text());
  }
});
greetingPage.on("pageerror", (error) =>
  greetingErrors.push(error.message));
await greetingPage.exposeFunction(
  "__wmK4GreetingSnapshot",
  () => greetingProjection,
);
await greetingPage.addInitScript(() => {
  window.codexSurfaceBridge = {
    getWorldManagerSnapshot: () =>
      window.__wmK4GreetingSnapshot(),
    submitWorldManagerMessage: async () => ({
      projection: await window.__wmK4GreetingSnapshot(),
    }),
    focusWorldManagerProject: async () => ({
      projection: await window.__wmK4GreetingSnapshot(),
    }),
    onWorldManagerEvent: () => () => {},
    onWorldManagerSemanticEvent: () => () => {},
  };
});
await greetingPage.goto(
  `${baseUrl}/world-manager-surface.html#${payload}`,
  { waitUntil: "networkidle" },
);
await greetingPage.waitForFunction(() =>
  document.querySelectorAll(".message.agent").length === 2);
const greetingMessage = greetingPage.locator(".message.agent").last();
assert.match(
  await greetingMessage.locator(".message-role").innerText(),
  /WorldManager replied/i,
);
assert.equal(
  await greetingMessage.locator(".message-body").innerText(),
  "Hi! What would you like to work on?",
);
assert.match(
  await greetingMessage.locator(".message-state").innerText(),
  /completed/i,
);
assert.equal(
  await greetingPage.locator("#reconciliationPanel").isHidden(),
  true,
);
assert.deepEqual(greetingErrors, []);
await greetingPage.close();

const invalidPage = await browser.newPage({
  viewport: { width: 1100, height: 760 },
});
await invalidPage.addInitScript(() => {
  window.__worldManagerInvalidRouteCalls = {
    semanticSnapshot: 0,
    semanticSubmit: 0,
    productionSnapshot: 0,
    productionSubmit: 0,
  };
  window.codexSurfaceBridge = {
    getWorldManagerSemanticSnapshot: () => {
      window.__worldManagerInvalidRouteCalls.semanticSnapshot += 1;
    },
    submitWorldManagerSemanticMessage: () => {
      window.__worldManagerInvalidRouteCalls.semanticSubmit += 1;
    },
    getWorldManagerSnapshot: () => {
      window.__worldManagerInvalidRouteCalls.productionSnapshot += 1;
    },
    submitWorldManagerMessage: () => {
      window.__worldManagerInvalidRouteCalls.productionSubmit += 1;
    },
    onWorldManagerEvent: () => () => {},
    onWorldManagerSemanticEvent: () => () => {},
  };
});
const invalidPayload = Buffer.from(JSON.stringify({
  project: { id: "project_alpha", name: "Project Alpha" },
}), "utf8").toString("base64url");
await invalidPage.goto(
  `${baseUrl}/world-manager-surface.html#${invalidPayload}`,
  { waitUntil: "networkidle" },
);
assert.match(
  await invalidPage.locator("#emptyConversation").innerText(),
  /launch mode is unavailable/i,
);
assert.equal(await invalidPage.locator("#composerInput").isDisabled(), true);
assert.equal(await invalidPage.locator("#sendButton").isDisabled(), true);
assert.deepEqual(
  await invalidPage.evaluate(() => window.__worldManagerInvalidRouteCalls),
  {
    semanticSnapshot: 0,
    semanticSubmit: 0,
    productionSnapshot: 0,
    productionSubmit: 0,
  },
);
await invalidPage.close();

await browser.close();
await server.dispose();
fs.rmSync(rootDir, { recursive: true, force: true });

console.log(JSON.stringify({
  ok: true,
  regression: "direct-world-manager-k4-ui",
  screenshotPath,
  operationalContextScreenshotPath,
  unifiedAgentResponseVisible: true,
  semanticInboxVisibleAtDepth: true,
  operationalMetaContextRibbonVisible: true,
  selectionWitnessVisibleAtDepth: true,
  directRequestManifestLinkVisible: true,
  reconciliationVisibleWithoutProposal: true,
  casualGreetingRenderedNaturally: true,
  canonicalControlsUnavailable: true,
  missingLaunchModeFailsClosed: true,
}, null, 2));
