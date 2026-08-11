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
    "world-manager-sc71-ui-",
  ),
);
const completedPath = path.join(
  fixtureRoot,
  "completed.json",
);
const failedPath = path.join(
  fixtureRoot,
  "failed.json",
);
const retriedPath = path.join(
  fixtureRoot,
  "retried.json",
);
const fixture = spawnSync(
  process.execPath,
  [
    path.resolve(
      "scripts/direct-world-manager-aro-reconstruction-runtime-regression.mjs",
    ),
  ],
  {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CODEX_WORLD_MANAGER_SC71_COMPLETED_PROJECTION_PATH:
        completedPath,
      CODEX_WORLD_MANAGER_SC71_FAILED_PROJECTION_PATH:
        failedPath,
      CODEX_WORLD_MANAGER_SC71_RETRIED_PROJECTION_PATH:
        retriedPath,
    },
    encoding: "utf8",
  },
);
assert.equal(
  fixture.status,
  0,
  fixture.stderr ||
    fixture.stdout ||
    "SC7.1 UI fixture failed.",
);
const completedProjection =
  JSON.parse(
    fs.readFileSync(
      completedPath,
      "utf8",
    ),
  );
const failedProjection =
  JSON.parse(
    fs.readFileSync(
      failedPath,
      "utf8",
    ),
  );
const retriedProjection =
  JSON.parse(
    fs.readFileSync(
      retriedPath,
      "utf8",
    ),
  );

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
    width: 1360,
    height: 900,
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
  "__wmSc71Completed",
  () => completedProjection,
);
await page.exposeFunction(
  "__wmSc71Failed",
  () => failedProjection,
);
await page.exposeFunction(
  "__wmSc71Retried",
  () => retriedProjection,
);
await page.addInitScript(() => {
  window.__wmSc71Calls = {
    retries: [],
  };
  window.__wmSc71Event = null;
  window.codexSurfaceBridge = {
    getWorldManagerSnapshot: () =>
      window.__wmSc71Completed(),
    submitWorldManagerMessage:
      async () => ({
        projection:
          await window
            .__wmSc71Completed(),
      }),
    focusWorldManagerProject:
      async () => ({
        projection:
          await window
            .__wmSc71Completed(),
      }),
    retryWorldManagerAroReconstruction:
      async (
        projectId,
        expectedRunDigest,
      ) => {
        window.__wmSc71Calls.retries
          .push({
            projectId,
            expectedRunDigest,
          });
        return {
          receipt: {
            state: "completed",
          },
          projection:
            await window
              .__wmSc71Retried(),
        };
      },
    onWorldManagerEvent: (callback) => {
      window.__wmSc71Event = callback;
      return () => {};
    },
    onWorldManagerSemanticEvent:
      () => () => {},
  };
});
const payload = Buffer.from(
  JSON.stringify({
    project: {
      id: "project_sc71",
      name: "SC7.1 Fixture",
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
try {
  await page.waitForFunction(() =>
    document
      .querySelector("#worldRevision")
      ?.textContent?.includes(
        "keyboard pipeline",
      ));
} catch (error) {
  const diagnostic =
    await page.evaluate(() => ({
      revision:
        document.querySelector(
          "#worldRevision",
        )?.textContent || "",
      empty:
        document.querySelector(
          "#emptyConversation",
        )?.textContent || "",
    }));
  throw new Error(
    `${error.message}; diagnostic=${JSON.stringify(
      diagnostic,
    )}; rendererErrors=${JSON.stringify(
      errors,
    )}`,
  );
}

const aroMetric = page.locator(
  '.metric[data-inspector="aros"]',
);
await aroMetric.click();
assert.equal(
  await page.locator(
    "#aroInspector",
  ).isHidden(),
  false,
);
let runCard = page.locator(
  "#aroReconstructionStatus .aro-reconstruction-run",
);
assert.equal(
  await runCard.getAttribute(
    "data-run-state",
  ),
  "completed",
);
assert.ok(
  await runCard.locator(
    ".aro-reconstruction-facts span",
  ).count() >= 4,
);
assert.equal(
  await runCard.locator(
    ".aro-reconstruction-retry",
  ).count(),
  0,
);
const completedStatusText =
  await runCard.textContent();
assert.ok(
  !completedStatusText.includes(
    "/tmp/",
  ),
);
assert.ok(
  !completedStatusText.includes(
    "SECRET_SHOULD_NEVER_ENTER_EVIDENCE",
  ),
);
assert.match(
  await page.locator(
    "#aroInspector .decision-dock-boundary",
  ).textContent(),
  /never mutates code/i,
);

await page.evaluate(async () => {
  window.__wmSc71Event({
    projection:
      await window.__wmSc71Failed(),
  });
});
await aroMetric.click();
runCard = page.locator(
  "#aroReconstructionStatus .aro-reconstruction-run",
);
assert.equal(
  await runCard.getAttribute(
    "data-run-state",
  ),
  "failed",
);
const retryButton =
  runCard.locator(
    ".aro-reconstruction-retry",
  );
assert.equal(
  await retryButton.isEnabled(),
  true,
);
const failedRun =
  failedProjection.aroRegistry
    .reconstructionRuns[0];
await retryButton.click();
await page.waitForFunction(() =>
  window.__wmSc71Calls.retries
    .length === 1);
const retryCall =
  await page.evaluate(() =>
    window.__wmSc71Calls.retries[0]);
assert.deepEqual(retryCall, {
  projectId:
    failedRun.projectId,
  expectedRunDigest:
    failedRun.runRef.digest,
});
runCard = page.locator(
  "#aroReconstructionStatus .aro-reconstruction-run",
);
assert.equal(
  await runCard.getAttribute(
    "data-run-state",
  ),
  "completed",
);
assert.ok(
  await page.locator(
    "#aroCandidateList .aro-object-nav-entry",
  ).count() >= 1,
);
assert.equal(
  await page.locator(
    "#aroFocusedObject .aro-surface",
  ).count(),
  1,
);
assert.deepEqual(errors, []);

await browser.close();
await server.dispose();
fs.rmSync(fixtureRoot, {
  recursive: true,
  force: true,
});

console.log(JSON.stringify({
  ok: true,
  regression:
    "direct-world-manager-aro-reconstruction-runtime-ui",
  proofs: {
    completedProducerStateVisible: true,
    evidenceSummarySameContext: true,
    rawRepositoryContentHidden: true,
    failurePostureVisible: true,
    exactRunDigestRetry: true,
    retryDoesNotAdmit: true,
    rendererErrors: 0,
  },
}, null, 2));
