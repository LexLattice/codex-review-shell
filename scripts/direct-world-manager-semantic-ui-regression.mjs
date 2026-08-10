import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { chromium } from "playwright";

const require = createRequire(import.meta.url);
const { LocalSurfaceServer } = require("../src/main/local-surface-server");
const {
  DirectWorldManagerSemanticCoordinator,
  deterministicSemanticRoleRunner,
} = require("../src/main/direct/worldmanager/semantic-mockup");

const coordinator = new DirectWorldManagerSemanticCoordinator({
  projects: [
    { id: "direct_runtime", name: "Direct Runtime", summary: "Semantic control for the Direct path." },
    { id: "voice_bridge", name: "Voice Bridge", summary: "Background voice capability work." },
    { id: "archive", name: "Archive", summary: "Inactive historical work." },
  ],
  activeProjectId: "direct_runtime",
  roleRunner: deterministicSemanticRoleRunner,
});

const rendererRoot = path.resolve("src/renderer");
const server = new LocalSurfaceServer(rendererRoot);
const baseUrl = await server.ensureStarted();
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1480, height: 920 }, deviceScaleFactor: 1 });
const consoleErrors = [];
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});
page.on("pageerror", (error) => consoleErrors.push(error.message));

await page.exposeFunction("__wmSnapshot", () => coordinator.snapshot());
await page.exposeFunction("__wmSubmit", (payload) => coordinator.submitPlanningMessage(payload));
await page.exposeFunction("__wmInspect", (proposalId) => coordinator.inspectProposal({ proposalId }));
await page.exposeFunction("__wmAdmit", (proposalId, actorId) => coordinator.admitProposal({ proposalId, actorId }));
await page.exposeFunction("__wmReset", (mode) => coordinator.reset({ mode }));
await page.addInitScript(() => {
  window.codexSurfaceBridge = {
    getWorldManagerSemanticSnapshot: () => window.__wmSnapshot(),
    submitWorldManagerSemanticMessage: (payload) => window.__wmSubmit(payload),
    inspectWorldManagerProposal: (proposalId) => window.__wmInspect(proposalId),
    admitWorldManagerProposal: (proposalId, actorId) => window.__wmAdmit(proposalId, actorId),
    resetWorldManagerSemanticMockup: (mode) => window.__wmReset(mode),
    onWorldManagerSemanticEvent: () => () => {},
  };
});

const payload = Buffer.from(JSON.stringify({
  project: { id: "direct_runtime", name: "Direct Runtime" },
  semanticMockup: { mode: "fixture", liveDirectAvailable: true },
}), "utf8").toString("base64url");
await page.goto(`${baseUrl}/world-manager-surface.html#${payload}`, { waitUntil: "networkidle" });
await page.waitForSelector("#emptyConversation:not([hidden])");
assert.match(await page.locator("#overviewTitle").innerText(), /quiet world/i);
assert.equal(await page.locator(".project-card").count(), 3);

await page.locator("#starterPrompt").click();
assert.match(await page.locator("#composerInput").inputValue(), /next five features/i);
await page.locator("#composerForm").evaluate((form) => form.requestSubmit());
await page.waitForSelector("#proposalPanel:not([hidden])");
await page.waitForFunction(() => document.querySelector("#proposalState")?.textContent === "candidate");
assert.equal(await page.locator("#greenlightButton").isDisabled(), true);
assert.match(await page.locator(".message.agent .message-role").innerText(), /project manager/i);
assert.match(await page.locator("#reconciliationSummary").innerText(), /proposal|architecture|interaction/i);

await page.locator("#inspectEvidenceButton").click();
await page.waitForSelector("#semanticZoom:not([hidden])");
assert.match(await page.locator("#settlementEvidence").innerText(), /TaskSettlement/);
assert.match(await page.locator("#instantiationEvidence").innerText(), /AgentInstantiation/);
assert.match(await page.locator("#resultEvidence").innerText(), /AgentResult/);
assert.match(await page.locator("#reconciliationEvidence").innerText(), /private reasoning\s+not exposed/i);
assert.ok(await page.locator(".lineage-event").count() >= 5);
assert.equal(await page.locator("#greenlightButton").isDisabled(), true);

await page.locator("#markEvidenceReviewed").click();
await page.waitForFunction(() => document.querySelector("#greenlightButton")?.disabled === false);
assert.match(await page.locator("#evidenceReviewStatus").innerText(), /does not itself admit/i);
await page.locator("#closeSemanticZoom").click();
assert.equal((await page.locator("#proposalState").textContent())?.trim(), "candidate");

await page.locator("#greenlightButton").click();
await page.waitForSelector("#contractPanel:not([hidden])");
await page.waitForFunction(() => document.querySelector("#proposalState")?.textContent === "canonical");
assert.match(await page.locator("#workThreadLabel").innerText(), /contract received/i);
assert.match(await page.locator("#contractPanel").innerText(), /completion has not been claimed/i);

const desktopScreenshotPath = path.join(os.tmpdir(), "world-manager-semantic-ui-desktop.png");
await page.screenshot({ path: desktopScreenshotPath, fullPage: false });
assert.ok(fs.statSync(desktopScreenshotPath).size > 20_000);

await page.setViewportSize({ width: 820, height: 900 });
await page.locator("#inspectEvidenceButton").click();
await page.waitForSelector("#semanticZoom:not([hidden])");
assert.equal(await page.locator("#settlementEvidence").isVisible(), true);
assert.equal(await page.locator("#lineageList").isVisible(), true);

const screenshotPath = path.join(os.tmpdir(), "world-manager-semantic-ui-regression.png");
await page.waitForTimeout(240);
await page.screenshot({ path: screenshotPath, fullPage: false });
assert.ok(fs.statSync(screenshotPath).size > 20_000);
const semanticZoomLayout = await page.locator("#semanticZoom").evaluate((element) => ({
  hidden: element.hidden,
  display: getComputedStyle(element).display,
  position: getComputedStyle(element).position,
  zIndex: getComputedStyle(element).zIndex,
  rect: element.getBoundingClientRect().toJSON(),
}));
assert.equal(semanticZoomLayout.hidden, false);
assert.equal(semanticZoomLayout.display, "grid");
assert.equal(semanticZoomLayout.position, "fixed");
assert.equal(semanticZoomLayout.zIndex, "50");
assert.ok(semanticZoomLayout.rect.top >= 0 && semanticZoomLayout.rect.top <= 1);
assert.deepEqual(consoleErrors, []);

await browser.close();
await server.dispose();
console.log(JSON.stringify({
  ok: true,
  regression: "direct-world-manager-semantic-ui",
  desktopScreenshotPath,
  screenshotPath,
  finalProposalState: coordinator.snapshot().latestProposal.state,
  responsiveEvidenceVisible: true,
  semanticZoomLayout,
}, null, 2));
