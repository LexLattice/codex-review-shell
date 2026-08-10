#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { chromium } from "playwright";

const require = createRequire(
  import.meta.url,
);
const {
  LocalSurfaceServer,
} = require(
  "../src/main/local-surface-server",
);

const fixtureRoot = fs.mkdtempSync(
  path.join(
    os.tmpdir(),
    "world-manager-sc9-ui-",
  ),
);
const basePath = path.join(
  fixtureRoot,
  "base.json",
);
const appliedPath = path.join(
  fixtureRoot,
  "applied.json",
);
const extractedPath = path.join(
  fixtureRoot,
  "extracted.json",
);
const fixture = spawnSync(
  process.execPath,
  [
    path.resolve(
      "scripts/direct-world-manager-thought-brush-regression.mjs",
    ),
  ],
  {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CODEX_WORLD_MANAGER_SC9_BASE_PROJECTION_PATH:
        basePath,
      CODEX_WORLD_MANAGER_SC9_APPLIED_PROJECTION_PATH:
        appliedPath,
      CODEX_WORLD_MANAGER_SC9_EXTRACTED_PROJECTION_PATH:
        extractedPath,
    },
    encoding: "utf8",
  },
);
assert.equal(
  fixture.status,
  0,
  fixture.stderr ||
    fixture.stdout ||
    "SC9 UI fixture failed.",
);
const baseProjection = JSON.parse(
  fs.readFileSync(
    basePath,
    "utf8",
  ),
);
const appliedProjection =
  JSON.parse(
    fs.readFileSync(
      appliedPath,
      "utf8",
    ),
  );
const extractedProjection =
  JSON.parse(
    fs.readFileSync(
      extractedPath,
      "utf8",
    ),
  );
const candidate =
  extractedProjection
    .aroRegistry.candidates
    .find((entry) =>
      entry.reconstructionMethod ===
        "thought_brush_candidate_insight");
assert.ok(candidate);

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
    width: 1480,
    height: 980,
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
  "__wmSc9Applied",
  () => appliedProjection,
);
await page.exposeFunction(
  "__wmSc9Extracted",
  () => extractedProjection,
);
await page.exposeFunction(
  "__wmSc9Base",
  () => baseProjection,
);
await page.addInitScript(
  ({
    candidateId,
    candidateDigest,
    candidateProjectId,
  }) => {
    window.__wmSc9Calls = {
      apply: [],
      undo: [],
      extract: [],
    };
    window.codexSurfaceBridge = {
      getWorldManagerSnapshot:
        () =>
          window.__wmSc9Applied(),
      submitWorldManagerMessage:
        async () => ({
          projection:
            await window
              .__wmSc9Applied(),
        }),
      focusWorldManagerProject:
        async () => ({
          projection:
            await window
              .__wmSc9Applied(),
        }),
      applyWorldManagerThoughtBrush:
        async (payload) => {
          window.__wmSc9Calls
            .apply.push(payload);
          return {
            receipt: {
              state: "completed",
              candidateInsightCount: 1,
              worldEffect: "none",
              canonicalAdmissionEffect:
                false,
            },
            projection:
              await window
                .__wmSc9Applied(),
          };
        },
      undoWorldManagerContextCanvas:
        async (payload) => {
          window.__wmSc9Calls
            .undo.push(payload);
          return {
            receipt: {
              state: "restored",
              worldEffect: "none",
            },
            projection:
              await window
                .__wmSc9Base(),
          };
        },
      extractWorldManagerContextCanvasInsight:
        async (payload) => {
          window.__wmSc9Calls
            .extract.push(payload);
          return {
            receipt: {
              state:
                "candidate_registered",
              aroCandidateRef: {
                kind:
                  "aro_reconstruction_candidate",
                id: candidateId,
                digest:
                  candidateDigest,
                projectId:
                  candidateProjectId,
              },
              canonicalAdmissionEffect:
                false,
            },
            projection:
              await window
                .__wmSc9Extracted(),
          };
        },
      onWorldManagerEvent:
        () => () => {},
      onWorldManagerSemanticEvent:
        () => () => {},
      onEvent: () => () => {},
    };
  },
  {
    candidateId:
      candidate.candidateId,
    candidateDigest:
      candidate.digest,
    candidateProjectId:
      candidate.projectId,
  },
);
const payload = Buffer.from(
  JSON.stringify({
    project: {
      id:
        "project_context_canvas",
      name:
        "ContextCanvas Studio",
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
  '.metric[data-inspector="canvas"]',
).click();
const inspector = page.locator(
  "#contextCanvasInspector",
);
assert.equal(
  await inspector.isVisible(),
  true,
);
assert.match(
  await inspector.textContent(),
  /temporary semantic workbench/i,
);
assert.match(
  await inspector.textContent(),
  /world effect\s*none/i,
);
assert.equal(
  await page
    .locator(
      "#thoughtBrushSelect option",
    )
    .count(),
  11,
);
assert.equal(
  await page
    .locator(
      "#contextCanvasLenses button",
    )
    .count(),
  3,
);
assert.match(
  await page
    .locator(
      "#thoughtBrushPreview",
    )
    .textContent(),
  /no canonical or external effect/i,
);

await page
  .locator("#thoughtBrushSelect")
  .selectOption(
    "horizontal_analogy",
  );
await page
  .locator("#thoughtBrushTarget")
  .selectOption(
    "project_windows_shell",
  );
await page
  .locator(
    "#thoughtBrushInstruction",
  )
  .fill(
    "Compare the two projects at the same semantic altitude.",
  );
await page
  .getByRole("button", {
    name: "Apply temporary brush",
  })
  .click();
await page.waitForFunction(() =>
  window.__wmSc9Calls.apply
    .length === 1);
const applyCall =
  await page.evaluate(
    () =>
      window.__wmSc9Calls
        .apply[0],
  );
assert.equal(
  applyCall.brush,
  "horizontal_analogy",
);
assert.equal(
  applyCall.targetProjectId,
  "project_windows_shell",
);
assert.ok(
  applyCall.contextCanvasId,
);
assert.ok(
  applyCall.contextCanvasDigest,
);

await page
  .getByRole("button", {
    name: /Insights · 1/,
  })
  .click();
const extractButton =
  page.getByRole("button", {
    name:
      "Extract ARO candidate",
  });
assert.equal(
  await extractButton.isEnabled(),
  true,
);
await extractButton.click();
await page.waitForFunction(() =>
  window.__wmSc9Calls.extract
    .length === 1);
assert.equal(
  await page
    .locator("#aroInspector")
    .isVisible(),
  true,
);
assert.match(
  await page
    .locator("#aroFocusedObject")
    .textContent(),
  /Reversible semantic attention/i,
);
assert.match(
  await page
    .locator("#aroFocusedObject")
    .textContent(),
  /Review reconstruction/i,
);

await page.locator(
  '.metric[data-inspector="canvas"]',
).click();
assert.equal(
  await page
    .getByRole("button", {
      name:
        "Undo last canvas move",
    })
    .isEnabled(),
  true,
);
await page
  .getByRole("button", {
    name:
      "Undo last canvas move",
  })
  .click();
await page.waitForFunction(() =>
  window.__wmSc9Calls.undo
    .length === 1);
const undoCall =
  await page.evaluate(
    () =>
      window.__wmSc9Calls
        .undo[0],
  );
assert.ok(
  undoCall.contextCanvasId,
);
assert.ok(
  undoCall.contextCanvasDigest,
);
assert.match(
  await inspector.textContent(),
  /Applying the first brush will initialize/i,
);

await page.setViewportSize({
  width: 430,
  height: 880,
});
const controlColumns =
  await page
    .locator(
      ".thought-brush-controls",
    )
    .evaluate((element) =>
      getComputedStyle(element)
        .gridTemplateColumns
        .split(" ")
        .filter(Boolean).length);
assert.equal(
  controlColumns,
  1,
);

assert.deepEqual(errors, []);

const screenshotPath =
  process.env
    .CODEX_WORLD_MANAGER_SC9_SCREENSHOT_PATH;
if (screenshotPath) {
  await page.screenshot({
    path: screenshotPath,
    fullPage: true,
  });
}
await browser.close();
await server.dispose();
fs.rmSync(
  fixtureRoot,
  {
    recursive: true,
    force: true,
  },
);

console.log(
  JSON.stringify({
    ok: true,
    slice: "WM-SC9",
    renderer:
      "headless_chromium",
    borrowedBase:
      "artifact_inspector_reference",
    derivative:
      "direct_context_canvas_workbench",
    paletteBrushCount: 11,
    focusedLensCount: 3,
    exactCanvasBoundActions:
      true,
    insightFocusedNormalAroPath:
      true,
    reversibleUndoVisible:
      true,
    responsiveMorphologyVerified:
      true,
    consoleErrors:
      errors.length,
  }),
);
