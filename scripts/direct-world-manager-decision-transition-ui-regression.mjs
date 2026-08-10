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
    "world-manager-sc5-ui-",
  ),
);
const initialProjectionPath = path.join(
  rootDir,
  "initial-projection.json",
);
const projectionPath = path.join(
  rootDir,
  "projection.json",
);
const fixture = spawnSync(
  process.execPath,
  [
    path.resolve(
      "scripts/direct-world-manager-decision-transition-regression.mjs",
    ),
  ],
  {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CODEX_WORLD_MANAGER_SC5_INITIAL_PROJECTION_PATH:
        initialProjectionPath,
      CODEX_WORLD_MANAGER_SC5_PROJECTION_PATH:
        projectionPath,
    },
    encoding: "utf8",
  },
);
assert.equal(
  fixture.status,
  0,
  fixture.stderr ||
    fixture.stdout ||
    "SC5 projection fixture failed.",
);
const initialProjection = JSON.parse(
  fs.readFileSync(
    initialProjectionPath,
    "utf8",
  ),
);
const projection = JSON.parse(
  fs.readFileSync(
    projectionPath,
    "utf8",
  ),
);

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
  "__wmSc5InitialProjection",
  () => initialProjection,
);
await page.exposeFunction(
  "__wmSc5Projection",
  () => projection,
);
await page.addInitScript(() => {
  window.__wmSc5TransitionCalls = [];
  window.codexSurfaceBridge = {
    getWorldManagerSnapshot: () =>
      window.__wmSc5InitialProjection(),
    submitWorldManagerMessage: async () => ({
      projection:
        await window.__wmSc5InitialProjection(),
    }),
    transitionWorldManagerDecision:
      async (payload) => {
        window.__wmSc5TransitionCalls.push(
          payload,
        );
        return {
          receipt: {
            state:
              payload.transitionKind ===
                "resolve_option"
                ? "resolved"
                : "relayed",
            summary:
              "Governed transition fixture completed.",
          },
          projection:
            await window.__wmSc5Projection(),
        };
      },
    focusWorldManagerProject: async () => ({
      projection:
        await window.__wmSc5InitialProjection(),
    }),
    onWorldManagerEvent: () => () => {},
    onWorldManagerSemanticEvent:
      () => () => {},
  };
});
const payload = Buffer.from(
  JSON.stringify({
    project: {
      id: "project_sc5",
      name: "SC5 Project",
    },
    worldManager: {
      mode: "production",
      pipelineStage: "wm_k6_genesis",
    },
  }),
  "utf8",
).toString("base64url");
await page.goto(
  `${baseUrl}/world-manager-surface.html#${payload}`,
  { waitUntil: "networkidle" },
);
await page.waitForFunction(() =>
  document
    .querySelector("#worldRevision")
    ?.textContent?.includes(
      "WM-K6-GENESIS",
    ));
await page
  .locator(
    '#worldMetrics [data-inspector="decisions"]',
  )
  .click();

assert.equal(
  await page
    .locator("#decisionOutcomeInspector")
    .isHidden(),
  false,
);
assert.match(
  await page
    .locator("#decisionOutcomeSummary")
    .innerText(),
  /governed SC5 transitions/i,
);
assert.equal(
  await page
    .locator(
      '#openDecisionList > [data-decision-id]',
    )
    .count(),
  5,
);
assert.equal(
  await page
    .locator(
      "#openDecisionList .decision-relay-input",
    )
    .count(),
  3,
);
assert.match(
  await page
    .locator("#openDecisionList")
    .innerText(),
  /request evidence[\s\S]*request authority/i,
);
assert.match(
  await page
    .locator(
      '[data-posture="authority_request"]',
    )
    .innerText(),
  /does not grant it/i,
);

const readyCard = page
  .locator(
    '#openDecisionList > [data-decision-id]',
  )
  .filter({
    hasText: "Which ready option applies?",
  });
assert.equal(await readyCard.count(), 1);
assert.equal(
  await readyCard
    .locator(
      ".decision-transition-confirm",
    )
    .count(),
  0,
);
await readyCard
  .locator(".decision-option-select")
  .click();
assert.equal(
  await page.evaluate(
    () =>
      window.__wmSc5TransitionCalls
        .length,
  ),
  0,
);
const confirm = readyCard.locator(
  ".decision-transition-confirm",
);
assert.equal(await confirm.count(), 1);
assert.match(
  await readyCard.innerText(),
  /no downstream effect will run/i,
);
await confirm.click();
await page.waitForFunction(
  () =>
    window.__wmSc5TransitionCalls
      .length === 1,
);
const mechanicalCall =
  await page.evaluate(
    () =>
      window.__wmSc5TransitionCalls[0],
  );
assert.equal(
  mechanicalCall.transitionKind,
  "resolve_option",
);
assert.ok(mechanicalCall.decisionDigest);
assert.ok(mechanicalCall.optionDigest);
assert.ok(
  Number.isInteger(
    mechanicalCall
      .expectedDecisionRevision,
  ),
);
assert.ok(mechanicalCall.clientRequestId);
assert.equal(
  mechanicalCall
    .semanticRegionBindingRef?.kind,
  "semantic_region_binding",
);
assert.ok(
  mechanicalCall
    .semanticRegionBindingRef?.id,
);
assert.ok(
  mechanicalCall
    .semanticRegionBindingRef?.digest,
);
assert.equal(
  mechanicalCall.actorRole,
  "operator",
);
assert.match(
  await page
    .locator("#openDecisionList")
    .innerText(),
  /Recent governed transitions[\s\S]*downstream effects not executed/i,
);
assert.equal(
  await page
    .locator(
      "#openDecisionList .decision-transition-receipt.compiled-semantic-surface",
    )
    .count(),
  projection.decisionSummary
    .recentTransitions.length,
);
assert.equal(
  await page
    .locator(
      "#openDecisionList .decision-transition-receipt.compiled-semantic-surface",
    )
    .first()
    .locator(
      ".semantic-lens-button",
    )
    .count(),
  4,
);

const relayCard = page
  .locator(
    '#openDecisionList > [data-resolution-mode="semantic_relay"]',
  );
assert.equal(await relayCard.count(), 1);
await relayCard
  .locator(".decision-relay-input")
  .fill(
    "Revise this at the project-policy level.",
  );
await relayCard
  .locator(".decision-relay-submit")
  .click();
await page.waitForFunction(
  () =>
    window.__wmSc5TransitionCalls
      .length === 2,
);
const relayCall = await page.evaluate(
  () =>
    window.__wmSc5TransitionCalls[1],
);
assert.equal(
  relayCall.transitionKind,
  "semantic_relay",
);
assert.equal(
  relayCall.semanticInput,
  "Revise this at the project-policy level.",
);
assert.equal(
  relayCall
    .semanticRegionBindingRef?.kind,
  "semantic_region_binding",
);
assert.ok(
  relayCall
    .semanticRegionBindingRef?.id,
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
        "direct-world-manager-decision-transition-ui",
      proofs: {
        canonicalChoiceRequiresTwoGestures: true,
        optionSelectionDoesNotSubmit: true,
        exactMechanicalRequestSubmitted: true,
        freeFormModesHaveScopedComposers: true,
        authorityBoundaryVisible: true,
        resolutionReceiptRemainsVisible: true,
        semanticRelayPreservesExactInput: true,
        rendererErrors: 0,
      },
    },
    null,
    2,
  ),
);
