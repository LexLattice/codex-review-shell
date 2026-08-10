#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";

const root = process.cwd();
const require = createRequire(import.meta.url);
const {
  APP_EXPERIENCES,
  publicAppExperience,
  resolveAppExperience,
} = require("../src/main/app-experience.js");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const direct = resolveAppExperience({ CODEX_EXPERIENCE: "direct-workbench" });
assert.equal(direct.id, APP_EXPERIENCES.DIRECT_WORKBENCH);
assert.equal(direct.controlPlane, "direct-thread");
assert.equal(direct.rendererDocument, "t3-direct-surface.html");
assert.equal(direct.source, "explicit");
assert.equal(resolveAppExperience({ CODEX_DIRECT_T3_GUI: "1" }).id, APP_EXPERIENCES.DIRECT_WORKBENCH);
assert.equal(resolveAppExperience({}).id, APP_EXPERIENCES.LEGACY_SHELL);
assert.throws(
  () => resolveAppExperience({ CODEX_EXPERIENCE: "ambiguous-surface" }),
  (error) => error?.code === "app_experience_unknown",
);
assert.throws(
  () => resolveAppExperience({ CODEX_EXPERIENCE: "world-manager-studio" }),
  (error) => error?.code === "app_experience_unavailable",
);
assert.deepEqual(publicAppExperience(direct), {
  id: "direct-workbench",
  label: "Direct Workbench",
  controlPlane: "direct-thread",
  interactionLaw: "direct-thread-conversation",
  rendererDocument: "t3-direct-surface.html",
});

const mainSource = read("src/main.js");
const directHtml = read("src/renderer/t3-direct-surface.html");
const directRenderer = read("src/renderer/t3-direct-surface.js");
const packageJson = JSON.parse(read("package.json"));

assert.match(mainSource, /const APP_EXPERIENCE = resolveAppExperience\(process\.env\)/);
assert.match(mainSource, /appExperience: publicAppExperience\(APP_EXPERIENCE\)/);
assert.match(mainSource, /async function createDirectWorkbenchWindow/);
assert.match(mainSource, /if \(DIRECT_WORKBENCH_MODE\)/);
assert.match(directHtml, /data-app-experience="direct-workbench"/);
assert.match(directHtml, /Direct thread control plane/);
assert.match(directRenderer, /experience\.controlPlane === "direct-thread"/);
assert.equal(packageJson.scripts["dev:t3"], "npm run dev:direct-workbench");
assert.match(read("start-direct-workbench.cmd"), /CODEX_EXPERIENCE=direct-workbench/);

console.log("Direct Workbench experience split regression passed.");
