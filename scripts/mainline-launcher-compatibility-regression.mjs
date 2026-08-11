#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), "utf8");

const launcher = read("start-codex-review-shell.cmd");
const syncLauncher = read("sync-from-wsl.cmd");
const mainSource = read("src/main.js");
const readme = read("README.md");
const gitignore = read(".gitignore");

const canonicalWslPath = "/home/rose/work/LexLattice/codex-review-shell";

assert.match(
  launcher,
  new RegExp(`CODEX_REVIEW_SHELL_DEFAULT_WSL_PATH=${canonicalWslPath.replaceAll("/", "\\/")}`),
  "the Windows launcher must default to the promoted main checkout",
);
assert.doesNotMatch(
  launcher,
  /set "CODEX_REVIEW_SHELL_USER_DATA_DIR=/,
  "the launcher must not bypass automatic legacy-profile discovery",
);
assert.match(
  launcher,
  /CommandLine -like '\*codex-review-shell\*'/,
  "process cleanup must recognize the canonical checkout name",
);
assert.match(
  syncLauncher,
  new RegExp(`WSL_PATH=${canonicalWslPath.replaceAll("/", "\\/")}`),
  "standalone sync must default to the promoted main checkout",
);
assert.match(
  readme,
  /cd C:\\LexLattice\\codex-review-shell(?:\r?\n)/,
  "the Windows launcher instructions must use the canonical checkout",
);
assert.match(
  readme,
  /Default source path is `\/home\/rose\/work\/LexLattice\/codex-review-shell`/,
  "the documented WSL source must match both launcher defaults",
);
assert.match(
  gitignore,
  /^launcher-latest\.txt$/m,
  "the generated latest-launch pointer must not dirty the checkout",
);
assert.match(
  syncLauncher,
  /\/XF[^\r\n]*"launcher-latest\.txt"/,
  "the WSL mirror must preserve the Windows-local launch pointer",
);
assert.match(
  mainSource,
  /formerDirectUserDataPath = path\.join\(appDataPath, "codex-review-shell-direct"\)/,
  "automatic profile discovery must retain the former Direct profile",
);
assert.match(
  mainSource,
  /canonicalUserDataPath,[\s\S]*legacyUserDataPath,[\s\S]*formerDirectUserDataPath,[\s\S]*app\.getPath\("userData"\)/,
  "profile selection must consider canonical, former main, and former Direct locations",
);
const aroWorkerAuthorizationHandler = mainSource.match(
  /ipcMain\.handle\("world-manager:authorize-aro-worker"[\s\S]*?ipcMain\.handle\("world-manager:respond-aro-worker-request"/,
)?.[0] || "";
assert.ok(
  aroWorkerAuthorizationHandler,
  "the WorldManager ARO worker authorization handler must remain present",
);
assert.match(
  aroWorkerAuthorizationHandler,
  /await resolveWorldManagerRuntimeProject\(\{\s*id: projectId,?\s*\}\)/,
  "ARO worker authorization must resolve canonical genesis workspace bindings",
);
assert.doesNotMatch(
  aroWorkerAuthorizationHandler,
  /getProjectById/,
  "ARO worker authorization must not fall back to an unrelated configured project",
);

console.log("mainline launcher compatibility regression passed");
