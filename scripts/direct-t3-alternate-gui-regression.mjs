import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const mainSource = read("src/main.js");
const baseHtml = read("src/renderer/codex-surface.html");
const alternateHtml = read("src/renderer/t3-direct-surface.html");
const alternateCss = read("src/renderer/t3-direct-surface.css");
const alternateJs = read("src/renderer/t3-direct-surface.js");
const intakeJs = read("src/renderer/direct-thread-intake-surface.js");
const packageJson = JSON.parse(read("package.json"));

function htmlIds(source) {
  return new Set(Array.from(source.matchAll(/\bid="([^"]+)"/g), (match) => match[1]));
}

const baseIds = htmlIds(baseHtml);
const alternateIds = htmlIds(alternateHtml);
const missingRendererContractIds = Array.from(baseIds).filter((id) => !alternateIds.has(id));

assert.deepEqual(
  missingRendererContractIds,
  [],
  `Alternate GUI lost required Codex surface DOM ids: ${missingRendererContractIds.join(", ")}`,
);
assert.match(mainSource, /APP_EXPERIENCE\.id === APP_EXPERIENCES\.DIRECT_WORKBENCH/);
assert.match(mainSource, /APP_EXPERIENCE\.rendererDocument/);
assert.match(mainSource, /pathname\.endsWith\("\/t3-direct-surface\.html"\)/);
assert.match(mainSource, /createDirectWorkbenchWindow/);
assert.match(mainSource, /await loadCodexSurface\(currentProject/);
assert.match(alternateHtml, /src="\.\/codex-surface\.js"/);
assert.match(alternateHtml, /src="\.\/t3-direct-surface\.js"/);
assert.doesNotMatch(alternateHtml, /world-manager-surface\.js/);
assert.match(alternateHtml, /data-t3-action="analytics"/);
assert.match(alternateHtml, /data-t3-action="intake"/);
assert.match(alternateHtml, /data-morphic-region="direct-thread-intake-evidence"/);
assert.match(alternateHtml, /src="\.\/direct-thread-intake-surface\.js"/);
assert.match(alternateHtml, /data-runtime-tab="runtime"/);
assert.match(alternateHtml, /data-app-experience="direct-workbench"/);
assert.match(alternateHtml, /Direct thread control plane/);
assert.match(alternateHtml, /Files are not connected in this experiment/);
assert.match(alternateHtml, /Terminal is not connected in this experiment/);
assert.match(alternateJs, /runtimeDrawerClose\?\.click\(\)/);
assert.match(alternateJs, /analyticsClose\?\.click\(\)/);
assert.match(intakeJs, /resume_original_thread/);
assert.match(intakeJs, /transplant_into_fresh_direct_thread/);
assert.match(intakeJs, /requireProviderResume:\s*true/);
assert.match(intakeJs, /Raw paths, raw records, source hashes/);
assert.match(intakeJs, /project-level substrate/);
assert.match(alternateCss, /grid-template-areas:[\s\S]*"sidebar thread-bar utility"/);
assert.match(alternateCss, /@media \(max-width: 720px\)/);
assert.match(alternateCss, /\.direct-thread-intake-panel/);
assert.match(alternateCss, /\.t3-project-sidebar:has\(\.morphic-thread-rail:not\(\[hidden\]\)\)/);
assert.equal(
  packageJson.scripts["dev:t3"],
  "npm run dev:direct-workbench",
);

console.log("Direct T3 alternate GUI regression passed.");
