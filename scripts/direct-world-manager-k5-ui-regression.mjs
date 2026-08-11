import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { chromium } from "playwright";

const require = createRequire(import.meta.url);
const { LocalSurfaceServer } = require("../src/main/local-surface-server");
const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "world-manager-k5-ui-"));
const candidatePath = path.join(rootDir, "candidate.json");
const admittedPath = path.join(rootDir, "admitted.json");
const fixture = spawnSync(process.execPath, [
  path.resolve("scripts/direct-world-manager-k5-regression.mjs"),
], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    CODEX_WORLD_MANAGER_K5_CANDIDATE_PROJECTION_PATH: candidatePath,
    CODEX_WORLD_MANAGER_K5_ADMITTED_PROJECTION_PATH: admittedPath,
  },
  encoding: "utf8",
});
assert.equal(fixture.status, 0, fixture.stderr || fixture.stdout);
const candidate = JSON.parse(fs.readFileSync(candidatePath, "utf8"));
const admitted = JSON.parse(fs.readFileSync(admittedPath, "utf8"));

const server = new LocalSurfaceServer(path.resolve("src/renderer"));
const baseUrl = await server.ensureStarted();
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1480, height: 920 } });
const errors = [];
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});
page.on("pageerror", (error) => errors.push(error.message));
await page.exposeFunction("__wmK5Candidate", () => candidate);
await page.exposeFunction("__wmK5Admitted", () => admitted);
await page.addInitScript(() => {
  window.codexSurfaceBridge = {
    getWorldManagerSnapshot: () => window.__wmK5Candidate(),
    inspectWorldManagerPlanProposal: async () => ({
      projection: await window.__wmK5Candidate(),
    }),
    admitWorldManagerPlanProposal: async () => ({
      projection: await window.__wmK5Admitted(),
    }),
    submitWorldManagerMessage: async (request) => {
      window.__wmK5LastSemanticSubmit = request;
      return {
        receipt: {
          settlementState: "contract_received",
          semanticDisposition: "authorize_exact_target",
          implementationStarted: false,
          grantsWorkerStartAuthority: false,
        },
        projection: await window.__wmK5Admitted(),
      };
    },
    focusWorldManagerProject: async () => ({
      projection: await window.__wmK5Candidate(),
    }),
    onWorldManagerEvent: () => () => {},
    onWorldManagerSemanticEvent: () => () => {},
  };
});
const payload = Buffer.from(JSON.stringify({
  project: { id: "project_k5_planning", name: "K5 Planning" },
  worldManager: { mode: "production", pipelineStage: "wm_k5_planning" },
}), "utf8").toString("base64url");
await page.goto(`${baseUrl}/world-manager-surface.html#${payload}`, {
  waitUntil: "networkidle",
});
await page.waitForFunction(() =>
  document.querySelector("#worldRevision")?.textContent?.includes("WM-K5"));
assert.equal(await page.locator("#proposalPanel").isHidden(), false);
assert.match(await page.locator("#proposalState").innerText(), /candidate/i);
assert.equal(await page.locator("#greenlightButton").isDisabled(), false);
assert.equal(await page.locator("#contractPanel").isHidden(), true);
await page.locator("#composerInput").fill(
  "Greenlight the exact reviewed plan revision.",
);
await page.locator("#composerForm").evaluate((form) =>
  form.requestSubmit());
await page.waitForFunction(() =>
  document.querySelector("#proposalState")?.textContent?.includes("canonical"));
assert.equal(await page.locator("#contractPanel").isHidden(), false);
assert.match(
  await page.locator("#toast").innerText(),
  /exact semantic decision/i,
);
assert.deepEqual(
  await page.evaluate(() => ({
    text: window.__wmK5LastSemanticSubmit?.text,
    proposalId:
      window.__wmK5LastSemanticSubmit?.scopeHint?.proposalId || "",
    bindingPosture:
      window.__wmK5LastSemanticSubmit?.scopeHint?.bindingPosture,
  })),
  {
    text: "Greenlight the exact reviewed plan revision.",
    proposalId: "",
    bindingPosture: "ambient_focus",
  },
);

await page.reload({ waitUntil: "networkidle" });
await page.waitForFunction(() =>
  document.querySelector("#proposalState")?.textContent?.includes("candidate"));
await page.locator("#greenlightButton").click();
await page.waitForFunction(() =>
  document.querySelector("#proposalState")?.textContent?.includes("canonical"));
assert.equal(await page.locator("#contractPanel").isHidden(), false);
assert.match(
  await page.locator("#workThreadLabel").innerText(),
  /contract received/i,
);
assert.match(
  await page.locator("#toast").innerText(),
  /waiting for worker-start authority/i,
);
const screenshotPath = path.join(os.tmpdir(), "world-manager-k5-ui-regression.png");
await page.screenshot({ path: screenshotPath, fullPage: false });
assert.ok(fs.statSync(screenshotPath).size > 20_000);
assert.deepEqual(errors, []);
await browser.close();
await server.dispose();
fs.rmSync(rootDir, { recursive: true, force: true });

console.log(JSON.stringify({
  ok: true,
  regression: "direct-world-manager-k5-ui",
  screenshotPath,
  proposalReviewGateVisible: true,
  productionGreenlightUsesCanonicalServiceProjection: true,
  typedSemanticGreenlightRendersCanonicalServiceProjection: true,
  contractReceivedTruthRendered: true,
  implementationStartNotClaimed: true,
}, null, 2));
