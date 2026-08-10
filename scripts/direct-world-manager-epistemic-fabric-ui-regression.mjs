#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { chromium } from "playwright";

const require = createRequire(import.meta.url);
const {
  LocalSurfaceServer,
} = require("../src/main/local-surface-server");

const rootDir = fs.mkdtempSync(
  path.join(os.tmpdir(), "world-manager-sc11-ui-"),
);
const gatePath = path.join(rootDir, "gate.json");
const admittedPath = path.join(rootDir, "admitted.json");

const fabricFixture = spawnSync(
  process.execPath,
  [path.resolve("scripts/direct-world-manager-runtime-evidence-bridge-regression.mjs")],
  {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CODEX_WORLD_MANAGER_SC11_FULL_GATE_PROJECTION_PATH: gatePath,
      CODEX_WORLD_MANAGER_SC11_FULL_ADMITTED_PROJECTION_PATH: admittedPath,
    },
    encoding: "utf8",
    timeout: 120_000,
  },
);
assert.equal(
  fabricFixture.status,
  0,
  fabricFixture.stderr || fabricFixture.stdout,
);

const gateProjection = JSON.parse(fs.readFileSync(gatePath, "utf8"));
const admittedProjection = JSON.parse(fs.readFileSync(admittedPath, "utf8"));

const server = new LocalSurfaceServer(path.resolve("src/renderer"));
const baseUrl = await server.ensureStarted();
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 1480, height: 940 },
});
const errors = [];
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});
page.on("pageerror", (error) => errors.push(error.message));
await page.exposeFunction("__wmSc11Gate", () => gateProjection);
await page.exposeFunction("__wmSc11Admitted", () => admittedProjection);
await page.addInitScript(() => {
  window.__wmSc11Acknowledgements = [];
  window.__wmSc11AdmissionRequests = [];
  window.codexSurfaceBridge = {
    getWorldManagerSnapshot: () => window.__wmSc11Gate(),
    submitWorldManagerMessage: async () => ({
      projection: await window.__wmSc11Gate(),
    }),
    focusWorldManagerProject: async () => ({
      projection: await window.__wmSc11Gate(),
    }),
    acknowledgeWorldManagerLedgerDelivery: async (payload) => {
      window.__wmSc11Acknowledgements.push(payload);
      return { projection: await window.__wmSc11Gate() };
    },
    requestWorldManagerArtifactAdmission: async (payload) => {
      window.__wmSc11AdmissionRequests.push(payload);
      return { projection: await window.__wmSc11Admitted() };
    },
    onWorldManagerEvent: () => () => {},
    onWorldManagerSemanticEvent: () => () => {},
    onEvent: () => () => {},
  };
});
const payload = Buffer.from(JSON.stringify({
  project: {
    id: "project_runtime_evidence_fixture",
    name: "Runtime evidence bridge fixture",
  },
  worldManager: {
    mode: "production",
    pipelineStage: "wm_k4",
  },
}), "utf8").toString("base64url");
await page.goto(
  `${baseUrl}/world-manager-surface.html#${payload}`,
  { waitUntil: "networkidle" },
);

const metric = page.locator('.metric[data-inspector="epistemic"]');
assert.equal(await metric.count(), 1);
await metric.focus();
await page.keyboard.press("Enter");
assert.equal(
  await page.locator("#epistemicFabricInspector").isHidden(),
  false,
);
assert.match(
  await page.locator("#epistemicFabricSummary").innerText(),
  /immutable epistemic acts[\s\S]*artifact lifecycles[\s\S]*queued deliveries/i,
);
assert.equal(
  await page.locator("#epistemicLifecycleList .aro-object-nav-entry").count(),
  1,
);
const gateText = await page
  .locator("#epistemicFocusedLifecycle")
  .innerText();
assert.match(gateText, /gate ready/i);
assert.match(gateText, /canonical admission has not occurred/i);
assert.doesNotMatch(gateText, /canonical styling is backed/i);
assert.match(gateText, /production[\s\S]*candidate[\s\S]*audit[\s\S]*gate[\s\S]*admission/i);
assert.match(gateText, /semantic contract conformance[\s\S]*supported/i);
assert.match(gateText, /regression preservation[\s\S]*supported/i);
assert.match(gateText, /declared target scope[\s\S]*workthread_runtime_evidence/i);
assert.match(gateText, /gate & canonical cas refs/i);
assert.equal(
  await page.locator(".epistemic-review-admission").isEnabled(),
  true,
);
assert.ok(
  await page.locator("#epistemicActivityList .inspector-object").count() >= 1,
);

const deliveryDetails = page
  .locator(".epistemic-fabric-details")
  .filter({ hasText: "Delivery & wake posture" });
await deliveryDetails.locator("summary").click();
const deliveryText = await page
  .locator("#epistemicDeliveryList")
  .innerText();
assert.match(deliveryText, /recipient/i);
assert.match(deliveryText, /without asserting that a model was awakened|wake-eligible/i);
const ack = page
  .locator("#epistemicDeliveryList .inspector-object-action")
  .first();
assert.equal(await ack.count(), 1);
await ack.click();
assert.equal(
  await page.evaluate(() => window.__wmSc11Acknowledgements.length),
  1,
);
assert.match(
  await page.locator("#epistemicFocusedLifecycle").innerText(),
  /gate ready[\s\S]*canonical admission has not occurred/i,
  "delivery acknowledgement must not act as canonical admission",
);

await page.locator(".epistemic-review-admission").click();
assert.equal(
  await page.locator(".epistemic-confirm-admission").count(),
  1,
);
assert.match(
  await page.locator("#epistemicFocusedLifecycle").innerText(),
  /exact evidence refs[\s\S]*confirm admission of the exact displayed revision/i,
  "required evidence must remain same-context reachable at confirmation",
);
await page.locator(".epistemic-confirm-admission").click();
await page.waitForFunction(() =>
  document.querySelector("#epistemicFocusedLifecycle")
    ?.textContent?.toLowerCase()
    .includes("canonical styling is backed"));
const admissionRequests = await page.evaluate(() =>
  window.__wmSc11AdmissionRequests);
assert.equal(admissionRequests.length, 1);
assert.equal(
  admissionRequests[0].schema,
  "direct_world_manager_artifact_admission_request@1",
);
assert.equal(admissionRequests[0].operatorReviewAcknowledged, true);
assert.equal(admissionRequests[0].targetAdmissionScope.kind, "workthread");
assert.equal(admissionRequests[0].expectedCanonicalRevisionRefs.length, 1);
assert.ok(admissionRequests[0].reviewedEvidenceRefs.length >= 4);
assert.equal(admissionRequests[0].actorRef, undefined);
assert.match(
  await page.locator("#epistemicFocusedLifecycle").innerText(),
  /admitted[\s\S]*canonical styling is backed/i,
);
const admittedLayout = await page.evaluate(() => {
  const inspector = document.querySelector("#epistemicFabricInspector");
  const focused = document.querySelector("#epistemicFocusedLifecycle");
  return {
    inspectorOverflow: inspector.scrollWidth - inspector.clientWidth,
    focusedOverflow: focused.scrollWidth - focused.clientWidth,
    offenders: [...focused.querySelectorAll("*")]
      .filter((element) => element.scrollWidth - element.clientWidth > 2)
      .slice(0, 12)
      .map((element) => ({
        tag: element.tagName,
        className: element.className,
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
      })),
  };
});
assert.ok(
  admittedLayout.inspectorOverflow <= 2,
  JSON.stringify(admittedLayout),
);
assert.ok(
  admittedLayout.focusedOverflow <= 2,
  JSON.stringify(admittedLayout),
);
assert.equal(errors.length, 0, errors.join("\n"));

await browser.close();
await server.dispose();
fs.rmSync(rootDir, { recursive: true, force: true });

console.log(JSON.stringify({
  schema: "direct_world_manager_epistemic_fabric_ui_regression@1",
  status: "passed",
  keyboardFocusPath: true,
  materialActivityCalmByDefault: true,
  gateReadyAndAdmittedDistinct: true,
  evidenceAndAuthoritySameContext: true,
  lifecycleAndAuditProvenanceVisible: true,
  deliveryAndWakeDistinct: true,
  acknowledgementUsesTypedBridge: true,
  deliveryAcknowledgementNeverAdmissions: true,
  exactScopedAdmissionUsesTypedBridge: true,
  responsiveInspectorHasNoHorizontalOverflow: true,
  rendererCannotSelectAuthorityActor: true,
  rendererMintsAuthority: false,
}, null, 2));
