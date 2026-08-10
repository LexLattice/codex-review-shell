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

const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "world-manager-k1-ui-"));
const projects = [
  { id: "direct_runtime", name: "Direct Runtime", summary: "Primary Direct control plane." },
  { id: "voice_bridge", name: "Voice Bridge", summary: "Deferred voice transport." },
];
const service = new DirectWorldManagerService({
  store: new DirectWorldManagerControlPlaneStore({ rootDir }),
  userWorldId: "user_world_ui_regression",
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

await page.exposeFunction("__wmK1Snapshot", () => service.snapshot());
await page.exposeFunction("__wmK1Submit", (request) => service.submit(request));
await page.exposeFunction("__wmK1Focus", (projectId) => service.focusProject({ projectId }));
await page.addInitScript(() => {
  window.codexSurfaceBridge = {
    getWorldManagerSnapshot: () => window.__wmK1Snapshot(),
    submitWorldManagerMessage: (payload) => window.__wmK1Submit(payload),
    focusWorldManagerProject: (projectId) => window.__wmK1Focus(projectId),
    onWorldManagerEvent: () => () => {},
    onWorldManagerSemanticEvent: () => () => {},
  };
});

const payload = Buffer.from(JSON.stringify({
  project: { id: "direct_runtime", name: "Direct Runtime" },
  worldManager: { mode: "production", pipelineStage: "wm_k3" },
}), "utf8").toString("base64url");
await page.goto(`${baseUrl}/world-manager-surface.html#${payload}`, { waitUntil: "networkidle" });
await page.waitForFunction(() => document.querySelector("#worldRevision")?.textContent?.includes("WM-K3"));

assert.equal(await page.locator(".mode-control").isHidden(), true);
assert.equal(await page.locator("#resetButton").isHidden(), true);
assert.equal(await page.locator("#proposalPanel").isHidden(), true);
assert.equal(await page.locator("#contractPanel").isHidden(), true);
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
await page.waitForFunction(() => document.querySelectorAll(".message.user").length === 1);
assert.equal(await page.locator(".message.agent").count(), 0);
assert.match(await page.locator(".message-state").innerText(), /agent_world_ready/i);
assert.match(await page.locator("#worldLifecycleLabel").innerText(), /agent world.*validated/i);
assert.match(await page.locator("#overviewSummary").innerText(), /policy closure|agent world|constitution/i);
assert.equal(await page.locator("#proposalPanel").isHidden(), true);
assert.equal(await page.locator("#contractPanel").isHidden(), true);
assert.equal(await page.locator("#semanticZoom").isHidden(), true);
assert.equal(await page.locator("#greenlightButton").isHidden(), true);

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

const screenshotPath = path.join(os.tmpdir(), "world-manager-k1-ui-regression.png");
await page.screenshot({ path: screenshotPath, fullPage: false });
assert.ok(fs.statSync(screenshotPath).size > 20_000);
assert.deepEqual(consoleErrors, []);

await browser.close();
await server.dispose();
service.close();
fs.rmSync(rootDir, { recursive: true, force: true });

console.log(JSON.stringify({
  ok: true,
  regression: "direct-world-manager-k1-ui",
  screenshotPath,
  keyboardIngress: true,
  truthBoundary: "settled_agent_world_ready_role_not_started",
}, null, 2));
