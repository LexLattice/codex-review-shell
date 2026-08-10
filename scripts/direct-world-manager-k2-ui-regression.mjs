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
const { LocalSurfaceServer } = require("../src/main/local-surface-server");
const {
  DirectWorldManagerControlPlaneStore,
} = require("../src/main/direct/worldmanager/control-plane-store");
const {
  DirectWorldManagerService,
} = require("../src/main/direct/worldmanager/service");

const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "world-manager-k2-ui-"));
const projects = [
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
];
const service = new DirectWorldManagerService({
  store: new DirectWorldManagerControlPlaneStore({ rootDir }),
  userWorldId: "user_world_k2_ui_regression",
  projects,
  activeProjectId: "direct_runtime",
  semanticIngressRunner: createSemanticIngressFixture(),
});
service.bootstrap();

const server = new LocalSurfaceServer(path.resolve("src/renderer"));
const baseUrl = await server.ensureStarted();
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1480, height: 920 } });
const consoleErrors = [];
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});
page.on("pageerror", (error) => consoleErrors.push(error.message));

await page.exposeFunction("__wmK2Snapshot", () => service.snapshot());
await page.exposeFunction("__wmK2Submit", (request) => service.submit(request));
await page.exposeFunction("__wmK2Focus", (projectId) =>
  service.focusProject({ projectId }));
await page.addInitScript(() => {
  window.codexSurfaceBridge = {
    getWorldManagerSnapshot: () => window.__wmK2Snapshot(),
    submitWorldManagerMessage: (payload) => window.__wmK2Submit(payload),
    focusWorldManagerProject: (projectId) => window.__wmK2Focus(projectId),
    onWorldManagerEvent: () => () => {},
    onWorldManagerSemanticEvent: () => () => {},
  };
});

const payload = Buffer.from(
  JSON.stringify({
    project: { id: "direct_runtime", name: "Direct Runtime" },
    worldManager: { mode: "production", pipelineStage: "wm_k3" },
  }),
  "utf8",
).toString("base64url");
await page.goto(`${baseUrl}/world-manager-surface.html#${payload}`, {
  waitUntil: "networkidle",
});
await page.waitForFunction(() =>
  document.querySelector("#worldRevision")?.textContent?.includes("WM-K3"));

assert.equal(await page.locator(".mode-control").isHidden(), true);
assert.equal(await page.locator("#resetButton").isHidden(), true);
assert.equal(await page.locator("#proposalPanel").isHidden(), true);
assert.equal(await page.locator("#contractPanel").isHidden(), true);
assert.equal(await page.locator("#settlementPanel").isHidden(), true);
assert.match(await page.locator("#overviewSummary").innerText(), /settle|graph/i);

const composer = page.locator("#composerInput");
await composer.fill("Line one");
await composer.press("Shift+Enter");
await composer.type("Line two");
assert.equal(await composer.inputValue(), "Line one\nLine two");
await composer.press("Escape");
assert.equal(await composer.inputValue(), "");

await composer.fill("Plan the next five features, without starting implementation.");
await composer.press("Enter");
await page.waitForFunction(() =>
  document.querySelector("#settlementState")?.textContent?.includes("agent world ready"));
assert.equal(await page.locator(".message.agent").count(), 0);
assert.match(await page.locator(".message-state").first().innerText(), /agent_world_ready/i);
assert.match(await page.locator("#settlementTitle").innerText(), /project manager/i);
assert.match(await page.locator("#settlementFacts").innerText(), /graph cut/i);
assert.match(
  await page.locator("#settlementFacts").innerText(),
  /semantic lane[\s\S]*project deliberation/i,
);
assert.match(await page.locator("#settlementFacts").innerText(), /provider role[\s\S]*not started/i);
assert.equal(await page.locator("#proposalPanel").isHidden(), true);
assert.equal(await page.locator("#contractPanel").isHidden(), true);
assert.equal(await page.locator("#greenlightButton").isHidden(), true);

await page.locator("#inspectSettlementButton").click();
assert.equal(await page.locator("#semanticZoom").isHidden(), false);
assert.match(
  await page.locator("#settlementEvidence").innerText(),
  /Governance[\s\S]*Settlement[\s\S]*typed[\s\S]*Semantic shelves[\s\S]*Imported context[\s\S]*fresh/i,
);
assert.match(
  await page.locator("#resultEvidence").innerText(),
  /task settlement[\s\S]*routing decision[\s\S]*operational meta context/i,
);
await page.locator('[data-semantic-depth="compiled_agent"]').click();
assert.match(
  await page.locator("#settlementEvidence").innerText(),
  /Compiled agent[\s\S]*Role template[\s\S]*Policy closure[\s\S]*Canonical write[\s\S]*not granted/i,
);
assert.match(
  await page.locator("#reconciliationEvidence").innerText(),
  /same-context authority gate[\s\S]*admission authority[\s\S]*not granted/i,
);
assert.match(await page.locator("#lineageList").innerText(), /manager context prepared/i);
assert.equal(await page.locator("#markEvidenceReviewed").isHidden(), true);
await page.locator("#closeSemanticZoom").click();

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

const beta = page.locator('.project-card[data-project-id="voice_bridge"]');
await beta.focus();
await beta.press("Enter");
assert.equal(
  await page.locator("#projectEcologyInspector").isVisible(),
  true,
);
assert.match(
  await page.locator("#activeProjectPill").innerText(),
  /Direct Runtime/,
);
await page.locator("#activateInspectedProject").click();
await page.waitForFunction(() =>
  document.querySelector("#activeProjectPill")?.textContent?.includes("Voice Bridge"));

const screenshotPath = path.join(
  os.tmpdir(),
  "world-manager-k2-ui-regression.png",
);
await page.screenshot({ path: screenshotPath, fullPage: false });
assert.ok(fs.statSync(screenshotPath).size > 20_000);
assert.deepEqual(consoleErrors, []);

await browser.close();
await server.dispose();
service.close();
fs.rmSync(rootDir, { recursive: true, force: true });

console.log(
  JSON.stringify(
    {
      ok: true,
      regression: "direct-world-manager-k2-ui",
      screenshotPath,
      keyboardSettlement: true,
      semanticZoom: true,
      clarificationPath: true,
      roleRuntimeStarted: false,
    },
    null,
    2,
  ),
);
