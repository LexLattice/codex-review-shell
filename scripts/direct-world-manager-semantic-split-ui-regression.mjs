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
    "world-manager-semantic-split-ui-",
  ),
);
const splitProjectionPath = path.join(
  rootDir,
  "split-projection.json",
);
const remandProjectionPath = path.join(
  rootDir,
  "remand-projection.json",
);
const partialProjectionPath = path.join(
  rootDir,
  "partial-projection.json",
);
const fixture = spawnSync(
  process.execPath,
  [
    path.resolve(
      "scripts/direct-world-manager-semantic-split-regression.mjs",
    ),
  ],
  {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CODEX_WORLD_MANAGER_SEMANTIC_SPLIT_PROJECTION_PATH:
        splitProjectionPath,
      CODEX_WORLD_MANAGER_SEMANTIC_SPLIT_REMAND_PROJECTION_PATH:
        remandProjectionPath,
      CODEX_WORLD_MANAGER_SEMANTIC_SPLIT_PARTIAL_PROJECTION_PATH:
        partialProjectionPath,
    },
    encoding: "utf8",
  },
);
assert.equal(
  fixture.status,
  0,
  fixture.stderr ||
    fixture.stdout ||
    "Semantic split projection fixture failed.",
);
const splitProjection = JSON.parse(
  fs.readFileSync(splitProjectionPath, "utf8"),
);
const remandProjection = JSON.parse(
  fs.readFileSync(remandProjectionPath, "utf8"),
);
const partialProjection = JSON.parse(
  fs.readFileSync(partialProjectionPath, "utf8"),
);

const server = new LocalSurfaceServer(
  path.resolve("src/renderer"),
);
const baseUrl = await server.ensureStarted();
const browser = await chromium.launch({
  headless: true,
});
const payload = Buffer.from(
  JSON.stringify({
    project: {
      id: "project_control_plane",
      name: "Control Plane",
    },
    worldManager: {
      mode: "production",
      pipelineStage: "wm_k6_genesis",
    },
  }),
  "utf8",
).toString("base64url");

async function openProjection(projection) {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 820 },
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
    "__wmSemanticSplitSnapshot",
    () => projection,
  );
  await page.addInitScript(() => {
    window.__focusCallCount = 0;
    window.codexSurfaceBridge = {
      getWorldManagerSnapshot: () =>
        window.__wmSemanticSplitSnapshot(),
      submitWorldManagerMessage: async () => ({
        projection:
          await window.__wmSemanticSplitSnapshot(),
      }),
      focusWorldManagerProject: async () => {
        window.__focusCallCount += 1;
        return {
          projection:
            await window.__wmSemanticSplitSnapshot(),
        };
      },
      onWorldManagerEvent: () => () => {},
      onWorldManagerSemanticEvent: () => () => {},
    };
  });
  await page.goto(
    `${baseUrl}/world-manager-surface.html#${payload}`,
    { waitUntil: "networkidle" },
  );
  await page.waitForFunction(() =>
    document.querySelector("#worldRevision")
      ?.textContent?.includes("WM-K6"));
  return { page, consoleErrors };
}

const success = await openProjection(splitProjection);
assert.equal(
  await success.page.locator(".message.user").count(),
  1,
);
assert.equal(
  await success.page.locator(".message.agent").count(),
  1,
);
assert.equal(
  await success.page.locator(".message.harness").count(),
  0,
);
assert.match(
  await success.page
    .locator(".message.agent .message-role")
    .innerText(),
  /WorldManager replied/i,
);
assert.match(
  await success.page
    .locator(".message.agent .message-body")
    .innerText(),
  /non-canonical project candidate/i,
);
assert.deepEqual(success.consoleErrors, []);
await success.page.close();

const partial = await openProjection(partialProjection);
assert.match(
  await partial.page
    .locator("#worldLifecycleLabel")
    .innerText(),
  /child limitations|needs attention/i,
);
assert.equal(
  await partial.page.locator(".message.harness").count(),
  1,
);
assert.match(
  await partial.page
    .locator(".message.harness .message-state")
    .innerText(),
  /partially[_ ]remanded/i,
);
await partial.page.locator(".project-card").first().click();
assert.equal(
  await partial.page.evaluate(() =>
    window.__focusCallCount),
  0,
);
assert.equal(
  await partial.page
    .locator("#projectEcologyInspector")
    .isVisible(),
  true,
);
assert.match(
  await partial.page
    .locator("#projectSeedList")
    .innerText(),
  /Partial Clipboard Seed/i,
);
await partial.page
  .getByRole("button", { name: "Prepare retry" })
  .click();
assert.match(
  await partial.page.locator("#composerInput")
    .inputValue(),
  /Reconsider this preserved semantic project seed/i,
);
assert.equal(
  await partial.page.evaluate(() =>
    window.__focusCallCount),
  0,
);
await partial.page
  .locator('.metric[data-inspector="decisions"]')
  .click();
assert.equal(
  await partial.page
    .locator("#decisionOutcomeInspector")
    .isVisible(),
  true,
);
assert.equal(
  await partial.page
    .locator("#splitOutcomeList .inspector-object")
    .count(),
  2,
);
assert.match(
  await partial.page
    .locator("#decisionOutcomeTitle")
    .innerText(),
  /2 open decisions/i,
);
assert.match(
  await partial.page
    .locator("#openDecisionList")
    .innerText(),
  /(?=[\s\S]*authority request)(?=[\s\S]*semantic relay)(?=[\s\S]*expected revision and idempotency enforced)/i,
);
assert.deepEqual(partial.consoleErrors, []);
await partial.page.close();

const remand = await openProjection(remandProjection);
assert.equal(
  await remand.page.locator(".message.harness").count(),
  2,
);
const harnessNotice =
  remand.page.locator(".message.harness").last();
assert.equal(
  await harnessNotice.getAttribute(
    "data-state-surface",
  ),
  "diagnostic-status-surface",
);
assert.match(
  await harnessNotice
    .locator(".message-role")
    .innerText(),
  /WorldManager routing/i,
);
assert.match(
  await harnessNotice
    .locator(".message-body")
    .innerText(),
  /Which project should receive this idea\?/,
);
const agentBackground = await remand.page
  .locator(".message.agent .message-body")
  .first()
  .evaluate((element) =>
    getComputedStyle(element).backgroundColor);
const harnessBackground = await harnessNotice
  .locator(".message-body")
  .evaluate((element) =>
    getComputedStyle(element).backgroundColor);
assert.notEqual(harnessBackground, agentBackground);
assert.deepEqual(remand.consoleErrors, []);
await remand.page.close();

await browser.close();
await server.dispose();
fs.rmSync(rootDir, {
  recursive: true,
  force: true,
});

console.log(JSON.stringify({
  ok: true,
  regression:
    "direct-world-manager-semantic-split-ui",
  proofs: {
    joinedChildrenRenderAsOneAgentReply: true,
    harnessTerminalNoticeIsVisuallyDistinct: true,
    diagnosticNoticeDoesNotImpersonateAgent: true,
    partialSplitRendersTruthfully: true,
    projectInspectionDoesNotActivateRuntime: true,
    preservedProjectSeedRetryIsSafeBuffered: true,
    currentDecisionsAndSplitOutcomesAreInspectable: true,
  },
}, null, 2));
