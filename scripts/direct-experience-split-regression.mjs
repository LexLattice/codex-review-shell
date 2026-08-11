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

const worldManager = resolveAppExperience({ CODEX_EXPERIENCE: "world-manager-studio" });
assert.equal(worldManager.id, APP_EXPERIENCES.WORLD_MANAGER_STUDIO);
assert.equal(worldManager.controlPlane, "worldmanager-semantic");
assert.equal(worldManager.variant, "production");

const worldManagerMock = resolveAppExperience({
  CODEX_EXPERIENCE: "world-manager-studio",
  CODEX_WORLD_MANAGER_MOCKUP: "1",
});
assert.equal(worldManagerMock.variant, "mockup");

assert.equal(
  resolveAppExperience({ CODEX_DIRECT_T3_GUI: "1" }).id,
  APP_EXPERIENCES.DIRECT_WORKBENCH,
);
assert.equal(
  resolveAppExperience({ CODEX_WORLD_MANAGER: "1", CODEX_DIRECT_T3_GUI: "1" }).id,
  APP_EXPERIENCES.WORLD_MANAGER_STUDIO,
);
const legacy = resolveAppExperience({});
assert.equal(legacy.id, APP_EXPERIENCES.LEGACY_SHELL);
assert.equal(legacy.rendererDocument, "codex-surface.html");
assert.throws(
  () => resolveAppExperience({ CODEX_EXPERIENCE: "ambiguous-surface" }),
  (error) => error?.code === "app_experience_unknown",
);

assert.deepEqual(publicAppExperience(direct), {
  id: "direct-workbench",
  label: "Direct Workbench",
  controlPlane: "direct-thread",
  interactionLaw: "direct-thread-conversation",
  rendererDocument: "t3-direct-surface.html",
  variant: "standard",
});

const mainSource = read("src/main.js");
const directHtml = read("src/renderer/t3-direct-surface.html");
const directRenderer = read("src/renderer/t3-direct-surface.js");
const directProjectDirectoryRenderer = read("src/renderer/direct-project-directory-surface.js");
const codexPreload = read("src/preload-codex-surface.js");
const worldManagerHtml = read("src/renderer/world-manager-surface.html");
const worldManagerRenderer = read("src/renderer/world-manager-surface.js");
const packageJson = JSON.parse(read("package.json"));

assert.match(mainSource, /const APP_EXPERIENCE = resolveAppExperience\(process\.env\)/);
assert.match(mainSource, /appExperience: publicAppExperience\(APP_EXPERIENCE\)/);
assert.match(mainSource, /function requireWorldManagerStudioExperience/);
assert.match(mainSource, /function requireDirectWorkbenchExperience/);
assert.match(mainSource, /direct-workbench:activate-project/);
assert.match(mainSource, /async function createDirectWorkbenchWindow/);
assert.match(mainSource, /if \(DIRECT_WORKBENCH_MODE\)/);
assert.match(
  mainSource,
  /const activation = applyProjectActivationBinding\(selectedProject\);[\s\S]*\.\.\.codexSurfaceOptionsForBinding\(activationBinding\)/,
);
assert.match(directHtml, /data-app-experience="direct-workbench"/);
assert.match(directHtml, /Direct thread control plane/);
assert.match(directRenderer, /experience\.controlPlane === "direct-thread"/);
assert.match(directProjectDirectoryRenderer, /activateDirectWorkbenchProject/);
assert.match(codexPreload, /if \(directWorkbenchPreload\) \{[\s\S]*activateDirectWorkbenchProject/);
assert.match(worldManagerHtml, /data-app-experience="world-manager-studio"/);
assert.match(worldManagerHtml, /WorldManager semantic control plane/);
assert.match(worldManagerRenderer, /payload\.appExperience\?\.controlPlane === "worldmanager-semantic"/);
assert.equal(
  packageJson.scripts["dev:t3"],
  "npm run dev:direct-workbench",
);
assert.equal(
  packageJson.scripts["dev:worldmanager"],
  "npm run dev:world-manager-studio",
);

for (const launcher of [
  "start-direct-workbench.cmd",
  "start-world-manager-studio.cmd",
  "start-world-manager-studio-mock.cmd",
]) {
  assert.match(read(launcher), /CODEX_EXPERIENCE=/);
}

console.log("Direct Workbench / WorldManager Studio experience split regression passed.");
