#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  spawnSync,
} from "node:child_process";
import {
  createRequire,
} from "node:module";
import {
  chromium,
} from "playwright";

const require =
  createRequire(import.meta.url);
const {
  LocalSurfaceServer,
} = require(
  "../src/main/local-surface-server",
);

const rootDir = fs.mkdtempSync(
  path.join(
    os.tmpdir(),
    "world-manager-sc10-ui-",
  ),
);
const projectionPath =
  path.join(
    rootDir,
    "projection.json",
  );
const fixture = spawnSync(
  process.execPath,
  [
    path.resolve(
      "scripts/direct-world-manager-unified-projection-regression.mjs",
    ),
  ],
  {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CODEX_WORLD_MANAGER_SC10_PROJECTION_PATH:
        projectionPath,
    },
    encoding: "utf8",
    timeout: 60_000,
  },
);
assert.equal(
  fixture.status,
  0,
  fixture.stderr ||
    fixture.stdout ||
    "SC10 projection fixture failed.",
);
const projection = JSON.parse(
  fs.readFileSync(
    projectionPath,
    "utf8",
  ),
);

const server =
  new LocalSurfaceServer(
    path.resolve("src/renderer"),
  );
const baseUrl =
  await server.ensureStarted();
const browser =
  await chromium.launch({
    headless: true,
  });
const page =
  await browser.newPage({
    viewport: {
      width: 1480,
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
  "__wmSc10Snapshot",
  () => projection,
);
await page.addInitScript(() => {
  window.codexSurfaceBridge = {
    getWorldManagerSnapshot:
      () =>
        window.__wmSc10Snapshot(),
    submitWorldManagerMessage:
      async () => ({
        projection:
          await window
            .__wmSc10Snapshot(),
      }),
    focusWorldManagerProject:
      async () => ({
        projection:
          await window
            .__wmSc10Snapshot(),
      }),
    onWorldManagerEvent:
      () => () => {},
    onWorldManagerSemanticEvent:
      () => () => {},
    onEvent: () => () => {},
  };
});
const payload = Buffer.from(
  JSON.stringify({
    project: {
      id: "project_alpha",
      name: "Project Alpha",
    },
    worldManager: {
      mode: "production",
      pipelineStage: "wm_k4",
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
    ?.textContent?.includes("WM-K4"));

assert.equal(
  await page
    .locator("#operationalContextRibbon")
    .isHidden(),
  false,
);
assert.equal(
  await page
    .locator(
      "#operationalContextChips .context-ribbon-chip",
    )
    .count(),
  5,
);
const ribbonText =
  await page
    .locator(
      "#operationalContextChips",
    )
    .textContent();
assert.match(
  ribbonText,
  /scope[\s\S]*project_alpha/i,
);
assert.match(
  ribbonText,
  /lane[\s\S]*project deliberation/i,
);
assert.match(
  ribbonText,
  /altitude[\s\S]*architecture/i,
);
assert.match(
  ribbonText,
  /context[\s\S]*shelves/i,
);
assert.match(
  ribbonText,
  /brush[\s\S]*none/i,
);

const trigger = page.locator(
  ".semantic-anatomy-trigger",
).first();
assert.equal(
  await trigger.count(),
  1,
);
await trigger.focus();
await page.keyboard.press("Enter");
assert.equal(
  await page
    .locator("#semanticZoom")
    .isHidden(),
  false,
);
const selectedEventId =
  await page
    .locator("#semanticZoom")
    .getAttribute(
      "data-semantic-event-id",
    );
assert.ok(selectedEventId);
assert.equal(
  await page
    .locator(
      "#semanticDepthNavigator .semantic-depth-button",
    )
    .count(),
  6,
);
assert.equal(
  await page
    .locator(
      "#semanticDepthNavigator .semantic-depth-button.selected",
    )
    .getAttribute(
      "data-semantic-depth",
    ),
  "unified_outcome",
);

const governance =
  page.locator(
    '[data-semantic-depth="governance"]',
  );
await governance.focus();
await page.keyboard.press("Enter");
assert.equal(
  await page
    .locator("#semanticZoom")
    .getAttribute(
      "data-semantic-event-id",
    ),
  selectedEventId,
);
assert.equal(
  await page
    .locator("#semanticZoom")
    .getAttribute(
      "data-semantic-depth",
    ),
  "governance",
);
assert.match(
  await page
    .locator("#settlementEvidence")
    .innerText(),
  /governance[\s\S]*settlement[\s\S]*semantic shelves[\s\S]*imported context/i,
);
assert.match(
  await page
    .locator("#resultEvidence")
    .innerText(),
  /task settlement[\s\S]*semantic shelf[\s\S]*operational meta context/i,
);
assert.match(
  await page
    .locator(
      "#reconciliationEvidence",
    )
    .innerText(),
  /same-context authority gate[\s\S]*admission authority[\s\S]*not granted[\s\S]*inspection effect[\s\S]*read only/i,
);
assert.match(
  await page
    .locator("#lineageList")
    .innerText(),
  /agent result completed[\s\S]*reconciliation completed/i,
);
assert.equal(
  await page
    .locator(
      "#markEvidenceReviewed",
    )
    .isHidden(),
  true,
);

const parity =
  projection.unifiedProjection
    .interactionParity;
assert.equal(
  parity.keyboardPointerParity,
  true,
);
assert.equal(
  parity.voiceContractParity,
  true,
);
assert.equal(
  parity.voiceTransportState,
  "deferred",
);
assert.equal(
  parity.tools.every((tool) =>
    new Set(
      tool.invocationContracts.map(
        (entry) =>
          entry.requestSchema,
      ),
    ).size === 1),
  true,
);

await page.setViewportSize({
  width: 760,
  height: 920,
});
const narrowColumns =
  await page
    .locator(
      "#semanticDepthNavigator",
    )
    .evaluate(
      (element) =>
        getComputedStyle(
          element,
        ).gridTemplateColumns
          .split(" ")
          .filter(Boolean).length,
    );
assert.equal(
  narrowColumns,
  2,
);
assert.equal(
  await page
    .locator("#semanticZoomIdentity")
    .isVisible(),
  true,
);
await page.keyboard.press("Escape");
assert.equal(
  await page
    .locator("#semanticZoom")
    .isHidden(),
  true,
);
assert.deepEqual(errors, []);

await browser.close();
await server.dispose();
fs.rmSync(rootDir, {
  recursive: true,
  force: true,
});

console.log(JSON.stringify({
  ok: true,
  slice: "WM-SC10",
  renderer: "headless_chromium",
  borrowedBase:
    "artifact_inspector_reference",
  derivative:
    "unified_semantic_anatomy_workbench",
  operationalRibbonDimensions: 5,
  anatomyDepthCount: 6,
  keyboardObjectFocusVerified: true,
  eventIdentityPreservedDuringZoom:
    true,
  evidenceBeforeAdmissionVisible:
    true,
  voiceTypedContractParity:
    true,
  voiceTransportState: "deferred",
  responsiveSameContextVerified:
    true,
  consoleErrors: 0,
}));
