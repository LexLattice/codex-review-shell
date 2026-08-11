import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { chromium } from "playwright";
import {
  createSemanticIngressFixture,
} from "./fixtures/world-manager-semantic-ingress-fixture.mjs";

const require = createRequire(import.meta.url);
const { LocalSurfaceServer } = require(
  "../src/main/local-surface-server",
);
const {
  DirectWorldManagerControlPlaneStore,
} = require("../src/main/direct/worldmanager/control-plane-store");
const {
  DirectWorldManagerService,
} = require("../src/main/direct/worldmanager/service");

const rootDir = fs.mkdtempSync(
  path.join(os.tmpdir(), "world-manager-k3-ui-"),
);
const service = new DirectWorldManagerService({
  store: new DirectWorldManagerControlPlaneStore({ rootDir }),
  userWorldId: "user_world_k3_ui_regression",
  projects: [
    {
      id: "direct_runtime",
      name: "Direct Runtime",
      summary: "Primary Direct control plane.",
    },
    {
      id: "voice_bridge",
      name: "Voice Bridge",
      summary: "Deferred voice transport.",
    },
  ],
  activeProjectId: "direct_runtime",
  semanticIngressRunner: createSemanticIngressFixture(),
});
service.bootstrap();

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

await page.exposeFunction("__wmK3Snapshot", () => service.snapshot());
await page.exposeFunction("__wmK3Submit", (request) =>
  service.submit(request));
await page.exposeFunction("__wmK3Focus", (projectId) =>
  service.focusProject({ projectId }));
await page.addInitScript(() => {
  window.codexSurfaceBridge = {
    getWorldManagerSnapshot: () => window.__wmK3Snapshot(),
    submitWorldManagerMessage: (payload) =>
      window.__wmK3Submit(payload),
    focusWorldManagerProject: (projectId) =>
      window.__wmK3Focus(projectId),
    onWorldManagerEvent: () => () => {},
    onWorldManagerSemanticEvent: () => () => {},
  };
});

const payload = Buffer.from(JSON.stringify({
  project: { id: "direct_runtime", name: "Direct Runtime" },
  worldManager: { mode: "production", pipelineStage: "wm_k3" },
}), "utf8").toString("base64url");
await page.goto(
  `${baseUrl}/world-manager-surface.html#${payload}`,
  { waitUntil: "networkidle" },
);
await page.waitForFunction(() =>
  document.querySelector("#worldRevision")?.textContent
    ?.includes("WM-K3"));

assert.equal(await page.locator(".mode-control").isHidden(), true);
assert.equal(await page.locator("#resetButton").isHidden(), true);
assert.equal(await page.locator("#proposalPanel").isHidden(), true);
assert.equal(await page.locator("#contractPanel").isHidden(), true);
assert.equal(await page.locator("#settlementPanel").isHidden(), true);
assert.match(
  await page.locator("#overviewSummary").innerText(),
  /constitution|agent world|policy closure/i,
);

const composer = page.locator("#composerInput");
await composer.fill(
  "Plan the next five features, without starting implementation.",
);
await composer.press("Enter");
await page.waitForFunction(() =>
  document.querySelector("#settlementState")?.textContent
    ?.includes("agent world ready"));

assert.equal(await page.locator(".message.agent").count(), 0);
assert.match(
  await page.locator(".message-state").first().innerText(),
  /agent_world_ready/i,
);
assert.match(
  await page.locator("#settlementTitle").innerText(),
  /project manager constitution/i,
);
const settlementFacts = await page
  .locator("#settlementFacts")
  .innerText();
assert.match(settlementFacts, /graph cut/i);
assert.match(
  settlementFacts,
  /3 harness baseline policies · resolved/i,
);
assert.match(
  settlementFacts,
  /project_manager\.planning@1/i,
);
assert.match(settlementFacts, /0 tools · mutation denied/i);
assert.match(
  settlementFacts,
  /ready for k4 runtime only/i,
);
assert.match(settlementFacts, /provider role[\s\S]*not started/i);
assert.equal(await page.locator("#proposalPanel").isHidden(), true);
assert.equal(await page.locator("#contractPanel").isHidden(), true);
assert.equal(await page.locator("#greenlightButton").isHidden(), true);

await page.locator("#inspectSettlementButton").click();
assert.equal(await page.locator("#semanticZoom").isHidden(), false);
assert.match(
  await page.locator("#settlementEvidence").innerText(),
  /Governance[\s\S]*Settlement[\s\S]*typed/i,
);
await page.locator('[data-semantic-depth="compiled_agent"]').click();
const constitutionEvidence = await page
  .locator("#settlementEvidence")
  .innerText();
assert.match(
  constitutionEvidence,
  /Compiled agent/i,
);
assert.match(
  constitutionEvidence,
  /Prohibited actions[\s\S]*mutate_workspace/i,
);
assert.match(constitutionEvidence, /resolved/i);
const manifestEvidence = await page
  .locator("#settlementEvidence")
  .innerText();
assert.match(
  manifestEvidence,
  /Role template/i,
);
assert.match(manifestEvidence, /tools[\s\S]*0/i);
assert.match(manifestEvidence, /Projection agreement[\s\S]*validated/i);
assert.match(
  manifestEvidence,
  /Launch boundary[\s\S]*ready_for_k4_runtime_only/i,
);
assert.match(
  await page.locator("#reconciliationEvidence").innerText(),
  /same-context authority gate[\s\S]*admission authority[\s\S]*not granted/i,
);
assert.match(
  await page.locator("#lineageList").innerText(),
  /agent world compiled/i,
);
assert.equal(
  await page.locator("#markEvidenceReviewed").isHidden(),
  true,
);
assert.match(
  await page.locator("#evidenceReviewStatus").innerText(),
  /grants no authority[\s\S]*changes no canonical state/i,
);
await page.locator("#closeSemanticZoom").click();

const screenshotPath = path.join(
  os.tmpdir(),
  "world-manager-k3-ui-regression.png",
);
await page.screenshot({ path: screenshotPath, fullPage: false });
assert.ok(fs.statSync(screenshotPath).size > 20_000);

await composer.fill("yes");
await composer.press("Enter");
await page.waitForFunction(() =>
  document.querySelector("#settlementState")?.textContent
    ?.includes("clarification required"));
assert.match(
  await page.locator("#clarificationPrompt").innerText(),
  /exact proposal or action/i,
);
assert.equal(await page.locator(".message.agent").count(), 0);
assert.equal(await page.locator("#proposalPanel").isHidden(), true);
assert.equal(await page.locator("#contractPanel").isHidden(), true);

assert.deepEqual(consoleErrors, []);

await browser.close();
await server.dispose();
service.close();
fs.rmSync(rootDir, { recursive: true, force: true });

console.log(JSON.stringify({
  ok: true,
  regression: "direct-world-manager-k3-ui",
  screenshotPath,
  constitutionVisible: true,
  manifestVisible: true,
  validationNotRenderedAsExecution: true,
  roleRuntimeStarted: false,
}, null, 2));
