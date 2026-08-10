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

const fixtureRoot = fs.mkdtempSync(
  path.join(
    os.tmpdir(),
    "world-manager-sc83-ui-",
  ),
);
const readyPath = path.join(
  fixtureRoot,
  "ready.json",
);
const handedOffPath = path.join(
  fixtureRoot,
  "handed-off.json",
);
const fixture = spawnSync(
  process.execPath,
  [
    path.resolve(
      "scripts/direct-world-manager-aro-worker-handoff-regression.mjs",
    ),
  ],
  {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CODEX_WORLD_MANAGER_SC83_READY_PROJECTION_PATH:
        readyPath,
      CODEX_WORLD_MANAGER_SC83_HANDED_OFF_PROJECTION_PATH:
        handedOffPath,
    },
    encoding: "utf8",
  },
);
assert.equal(
  fixture.status,
  0,
  fixture.stderr ||
    fixture.stdout ||
    "SC8.3 UI fixture failed.",
);
const readyProjection = JSON.parse(
  fs.readFileSync(
    readyPath,
    "utf8",
  ),
);
const handedOffProjection = JSON.parse(
  fs.readFileSync(
    handedOffPath,
    "utf8",
  ),
);
const uncompiledProjection =
  structuredClone(readyProjection);
uncompiledProjection.aroRegistry
  .workerSourceFreshness = [];
uncompiledProjection.aroRegistry
  .workerCapabilityObservations = [];
uncompiledProjection.aroRegistry
  .workerReviewReceipts = [];
uncompiledProjection.aroRegistry
  .workerConstitutions = [];
uncompiledProjection.aroRegistry
  .workerAuthorizations = [];
uncompiledProjection.aroRegistry
  .workerHandoffRuns = [];
uncompiledProjection.aroRegistry
  .runningWorkerHandoffCount = 0;
uncompiledProjection.aroRegistry
  .failedWorkerHandoffCount = 0;
uncompiledProjection.aroRegistry
  .handedOffWorkerCount = 0;

const comparison =
  readyProjection.aroRegistry
    .currentTargetComparisons[0];
const contract =
  readyProjection.aroRegistry
    .mutationContracts[0];
const constitution =
  readyProjection.aroRegistry
    .workerConstitutions[0];
assert.ok(comparison);
assert.ok(contract);
assert.ok(constitution);

const server = new LocalSurfaceServer(
  path.resolve("src/renderer"),
);
const baseUrl =
  await server.ensureStarted();
const browser =
  await chromium.launch({
    headless: true,
  });
const page = await browser.newPage({
  viewport: {
    width: 1420,
    height: 940,
  },
});
const errors = [];
page.on("console", (message) => {
  if (message.type() === "error") {
    errors.push(message.text());
  }
});
page.on("pageerror", (error) =>
  errors.push(error.message));

await page.exposeFunction(
  "__wmSc83Uncompiled",
  () => uncompiledProjection,
);
await page.exposeFunction(
  "__wmSc83Ready",
  () => readyProjection,
);
await page.exposeFunction(
  "__wmSc83HandedOff",
  () => handedOffProjection,
);
await page.addInitScript(() => {
  window.__wmSc83PrepareCalls = [];
  window.__wmSc83AuthorizeCalls = [];
  window.__wmSc83Responses = [];
  window.__wmSc83WorldEvent = null;
  window.__wmSc83CodexEvent = null;
  window.codexSurfaceBridge = {
    getWorldManagerSnapshot: () =>
      window.__wmSc83Uncompiled(),
    submitWorldManagerMessage:
      async () => ({
        projection:
          await window
            .__wmSc83Uncompiled(),
      }),
    focusWorldManagerProject:
      async () => ({
        projection:
          await window
            .__wmSc83Uncompiled(),
      }),
    prepareWorldManagerAroWorker:
      async (payload) => {
        window.__wmSc83PrepareCalls
          .push(payload);
        return {
          receipt: {
            state:
              "ready_for_authorization",
          },
          projection:
            await window
              .__wmSc83Ready(),
        };
      },
    authorizeWorldManagerAroWorker:
      async (payload) => {
        window.__wmSc83AuthorizeCalls
          .push(payload);
        return {
          receipt: {
            state: "handed_off",
          },
          projection:
            await window
              .__wmSc83HandedOff(),
        };
      },
    respondWorldManagerAroWorkerRequest:
      async (key, result) => {
        window.__wmSc83Responses
          .push({ key, result });
        return {
          request: {
            ...window.__wmSc83LastRequest,
            status: "completed",
            responseSummary:
              result.decision,
          },
        };
      },
    onWorldManagerEvent: (callback) => {
      window.__wmSc83WorldEvent =
        callback;
      return () => {};
    },
    onWorldManagerSemanticEvent:
      () => () => {},
    onEvent: (callback) => {
      window.__wmSc83CodexEvent =
        callback;
      return () => {};
    },
  };
});
const payload = Buffer.from(
  JSON.stringify({
    project: {
      id: "project_sc83",
      name:
        "SC8.3 Worker Studio",
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
      "keyboard pipeline",
    ));
await page.locator(
  '.metric[data-inspector="aros"]',
).click();

let workerLane = page.locator(
  "#aroFocusedObject .aro-worker-workbench",
);
assert.equal(
  await workerLane.count(),
  1,
);
assert.equal(
  await workerLane.getAttribute(
    "data-handoff-state",
  ),
  "not_started",
);
assert.equal(
  await workerLane.getAttribute(
    "data-workspace-mutation",
  ),
  "false",
);
const review = workerLane.locator(
  ".aro-worker-review",
);
assert.equal(
  await review.isEnabled(),
  true,
);
assert.match(
  await workerLane
    .locator(
      ".decision-transition-boundary",
    ).textContent(),
  /starts no provider turn|provider start/i,
);
await review.click();
await page.waitForFunction(() =>
  window.__wmSc83PrepareCalls
    .length === 1);
const prepareCall =
  await page.evaluate(() =>
    window.__wmSc83PrepareCalls[0]);
assert.equal(
  prepareCall.contractId,
  contract.contractRef.id,
);
assert.equal(
  prepareCall.contractDigest,
  contract.contractRef.digest,
);
assert.equal(
  prepareCall
    .semanticRegionBindingRef.kind,
  "semantic_region_binding",
);

workerLane = page.locator(
  "#aroFocusedObject .aro-worker-workbench",
);
assert.equal(
  await workerLane.getAttribute(
    "data-worker-constitution",
  ),
  constitution.constitutionRef.id,
);
assert.equal(
  await workerLane.locator(
    ".aro-worker-ref-strip > span",
  ).count(),
  4,
);
assert.match(
  await workerLane
    .locator(
      ".aro-worker-constitution-details",
    ).textContent(),
  /per-call effect approval|every read, patch, and command/i,
);
assert.equal(
  await workerLane.locator(
    "text=HARNESS-COMPILED DATA",
  ).count(),
  0,
);
const authorize = workerLane.locator(
  ".aro-worker-authorize",
);
assert.equal(
  await authorize.isEnabled(),
  true,
);
assert.match(
  await workerLane.locator(
    ".authority-bearing",
  ).textContent(),
  /one worker session and one provider turn/i,
);
await authorize.click();
await page.waitForFunction(() =>
  window.__wmSc83AuthorizeCalls
    .length === 1);
const authorizeCall =
  await page.evaluate(() =>
    window.__wmSc83AuthorizeCalls[0]);
assert.equal(
  authorizeCall.constitutionId,
  constitution.constitutionRef.id,
);
assert.match(
  authorizeCall.operatorActionId,
  /.+/,
);

workerLane = page.locator(
  "#aroFocusedObject .aro-worker-workbench",
);
assert.equal(
  await workerLane.getAttribute(
    "data-handoff-state",
  ),
  "handed_off",
);
assert.equal(
  await workerLane.locator(
    ".aro-worker-lineage span",
  ).count(),
  4,
);

await page.evaluate(() => {
  const request = {
    key:
      "direct:sc83-read-request",
    id:
      "sc83-read-request",
    method:
      "direct/tool/readOnly/requestApproval",
    title:
      "Approve read-only file access",
    summary:
      "src/evidence-lane.js",
    riskCategory: "readOnly",
    status: "pending",
    params: {
      tool: "read_file",
      relPath:
        "src/evidence-lane.js",
      maxReadFileBytes: 12000,
      actionTokens: {
        approve:
          "token-sc83-approve",
        decline:
          "token-sc83-decline",
        cancel:
          "token-sc83-cancel",
      },
    },
  };
  window.__wmSc83LastRequest =
    request;
  window.__wmSc83CodexEvent({
    type: "rpc-request",
    request,
  });
});
const requestCard =
  page.locator(
    '.aro-worker-request[data-request-key="direct:sc83-read-request"]',
  );
assert.equal(
  await requestCard.count(),
  1,
);
assert.match(
  await requestCard.textContent(),
  /src\/evidence-lane\.js/,
);
await requestCard.getByRole(
  "button",
  {
    name: "Approve read",
  },
).click();
await page.waitForFunction(() =>
  window.__wmSc83Responses
    .length === 1);
const response =
  await page.evaluate(() =>
    window.__wmSc83Responses[0]);
assert.equal(
  response.result.decision,
  "approve",
);
assert.equal(
  response.result.actionTokenId,
  "token-sc83-approve",
);
assert.match(
  response.result
    .clientToolDecisionId,
  /sc83-read-request:approve/,
);

await page.setViewportSize({
  width: 420,
  height: 860,
});
const geometry =
  await workerLane.evaluate(
    (element) => {
      const focused =
        element.closest(
          ".aro-focused-object",
        ).getBoundingClientRect();
      const lane =
        element.getBoundingClientRect();
      const line =
        element.querySelector(
          ".aro-worker-request-line",
        );
      return {
        laneWidth: lane.width,
        focusedWidth:
          focused.width,
        requestColumns:
          line
            ? getComputedStyle(line)
                .gridTemplateColumns
            : "",
      };
    },
  );
assert.ok(
  geometry.laneWidth <=
    geometry.focusedWidth,
);
assert.ok(
  !geometry.requestColumns.includes(
    "58px",
  ),
);
assert.deepEqual(errors, []);

await browser.close();
await server.dispose();
fs.rmSync(fixtureRoot, {
  recursive: true,
  force: true,
});

console.log(
  JSON.stringify({
    ok: true,
    regression:
      "direct-world-manager-aro-worker-handoff-ui",
    proofs: {
      evidenceBeforeAuthorization:
        true,
      exactSemanticBinding: true,
      constitutionLineageVisible:
        true,
      compiledInstructionsProjected:
        false,
      authorityBoundaryDistinct:
        true,
      workerLineageVisible: true,
      perCallReadApproval:
        true,
      compactResponsiveMorph:
        true,
      rendererErrors: 0,
    },
  }, null, 2),
);
