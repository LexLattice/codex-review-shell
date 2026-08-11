#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { chromium } from "playwright";

const require = createRequire(import.meta.url);
const { LocalSurfaceServer } = require("../src/main/local-surface-server");
const rootDir = fs.mkdtempSync(
  path.join(os.tmpdir(), "world-manager-k6-execution-ui-"),
);
const projectionPaths = Object.fromEntries(
  ["contract", "prepared", "active", "admitted"].map((state) => [
    state,
    path.join(rootDir, `${state}.json`),
  ]),
);
const fixture = spawnSync(process.execPath, [
  path.resolve("scripts/direct-world-manager-k6-execution-regression.mjs"),
], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    CODEX_WORLD_MANAGER_K6_CONTRACT_PROJECTION_PATH:
      projectionPaths.contract,
    CODEX_WORLD_MANAGER_K6_PREPARED_PROJECTION_PATH:
      projectionPaths.prepared,
    CODEX_WORLD_MANAGER_K6_ACTIVE_PROJECTION_PATH:
      projectionPaths.active,
    CODEX_WORLD_MANAGER_K6_ADMITTED_PROJECTION_PATH:
      projectionPaths.admitted,
  },
  encoding: "utf8",
});
assert.equal(fixture.status, 0, fixture.stderr || fixture.stdout);
const projections = Object.fromEntries(
  Object.entries(projectionPaths).map(([state, filePath]) => [
    state,
    JSON.parse(fs.readFileSync(filePath, "utf8")),
  ]),
);

const server = new LocalSurfaceServer(path.resolve("src/renderer"));
const baseUrl = await server.ensureStarted();
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1480, height: 920 } });
const errors = [];
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});
page.on("pageerror", (error) => errors.push(error.message));
await page.exposeFunction("__wmK6Projection", (state) => projections[state]);
await page.addInitScript(() => {
  window.codexSurfaceBridge = {
    getWorldManagerSnapshot: () => window.__wmK6Projection("contract"),
    prepareWorldManagerPlanExecution: async (request) => {
      window.__wmK6PrepareRequest = request;
      return { projection: await window.__wmK6Projection("prepared") };
    },
    authorizeWorldManagerPlanExecution: async (request) => {
      window.__wmK6AuthorizeRequest = request;
      return { projection: await window.__wmK6Projection("active") };
    },
    completeWorldManagerPlanExecution: async (request) => {
      window.__wmK6CompleteRequest = request;
      return {
        record: { state: "admitted" },
        projection: await window.__wmK6Projection("admitted"),
      };
    },
    focusWorldManagerProject: async () => ({
      projection: await window.__wmK6Projection("contract"),
    }),
    onWorldManagerEvent: () => () => {},
    onWorldManagerSemanticEvent: () => () => {},
  };
});
const payload = Buffer.from(JSON.stringify({
  project: { id: "project_k6_execution", name: "K6 Execution" },
  worldManager: { mode: "production", pipelineStage: "wm_k6_execution" },
}), "utf8").toString("base64url");
await page.goto(`${baseUrl}/world-manager-surface.html#${payload}`, {
  waitUntil: "networkidle",
});
await page.waitForFunction(() =>
  document.querySelector("#contractPanel")?.hidden === false);
assert.equal(
  await page.locator("#preparePlanExecutionButton").isHidden(),
  false,
);
assert.match(
  await page.locator("#planExecutionGate").innerText(),
  /starts no provider turn/i,
);

await page.locator("#preparePlanExecutionButton").click();
await page.waitForFunction(() =>
  document.querySelector("#authorizePlanExecutionButton")?.hidden === false);
assert.match(
  await page.locator("#contractExecutionSummary").innerText(),
  /worker start still requires explicit authority/i,
);
await page.locator("#authorizePlanExecutionButton").click();
await page.waitForFunction(() =>
  document.querySelector("#completePlanExecutionButton")?.hidden === false);
assert.match(
  await page.locator("#contractExecutionSummary").innerText(),
  /every local effect is separately gated/i,
);
await page.locator("#completePlanExecutionButton").click();
await page.waitForFunction(() =>
  document.querySelector("#contractExecutionSummary")?.textContent
    ?.includes("project-memory candidate was separately admitted"));
assert.equal(
  await page.locator("#completePlanExecutionButton").isHidden(),
  true,
);
assert.match(
  await page.locator("#planExecutionGate").innerText(),
  /canonical admission.*upward status/i,
);
const requests = await page.evaluate(() => ({
  prepare: window.__wmK6PrepareRequest,
  authorize: window.__wmK6AuthorizeRequest,
  complete: window.__wmK6CompleteRequest,
}));
assert.equal(
  requests.prepare.implementationContractId,
  projections.contract.latestContract.implementationContractId,
);
assert.equal(
  requests.authorize.executionId,
  projections.prepared.latestPlanExecution.executionId,
);
assert.ok(requests.authorize.operatorActionId);
assert.equal(
  requests.complete.executionDigest,
  projections.active.latestPlanExecution.digest,
);
const screenshotPath = path.join(
  os.tmpdir(),
  "world-manager-k6-execution-ui-regression.png",
);
await page.screenshot({ path: screenshotPath, fullPage: false });
assert.ok(fs.statSync(screenshotPath).size > 20_000);
assert.deepEqual(errors, []);
await browser.close();
await server.dispose();
fs.rmSync(rootDir, { recursive: true, force: true });

console.log(JSON.stringify({
  ok: true,
  regression: "direct-world-manager-k6-execution-ui",
  screenshotPath,
  proofs: {
    compilationBoundaryVisible: true,
    workerStartAuthorityExplicit: true,
    perCallEffectGateVisible: true,
    semanticClosureEvaluationReachable: true,
    projectMemoryAdmissionVisible: true,
  },
}, null, 2));
