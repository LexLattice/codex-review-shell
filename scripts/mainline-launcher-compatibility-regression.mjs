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
const profileSource = read("src/main/app-profile.js");
const bootSource = read("src/boot.js");
const readme = read("README.md");
const gitignore = read(".gitignore");

const canonicalWslPath = "/home/rose/work/LexLattice/codex-review-shell-direct";

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
  launcher,
  /call "%ROOT_DIR%\\sync-from-wsl\.cmd" \/check[\s\S]*app-control\.mjs" reuse !REUSE_FLAGS![\s\S]*if not "!REUSE_RC!"=="10" call :force_stop_instances[\s\S]*call "%ROOT_DIR%\\sync-from-wsl\.cmd"\r?\n/,
  "the launcher keeps an unchanged running app, and only force-stops what the control channel can't reach",
);
assert.doesNotMatch(
  launcher,
  /powershell\.exe -NoProfile -Command "Get-Date/,
  "the launch id comes from %DATE% and %TIME%, not a PowerShell start",
);
assert.match(
  syncLauncher,
  /\/XF[^\r\n]*"\.sync-generation\.txt"/,
  "the mirror keeps its own code generation stamp",
);
assert.match(
  syncLauncher,
  /if "%MIRROR_CHANGED%"=="1" call :new_generation/,
  "a sync that changes files starts a new code generation",
);
assert.match(
  syncLauncher,
  new RegExp(`WSL_PATH=${canonicalWslPath.replaceAll("/", "\\/")}`),
  "standalone sync must default to the promoted main checkout",
);
assert.match(
  readme,
  /cd C:\\LexLattice\\codex-review-shell-direct(?:\r?\n)/,
  "the Windows launcher instructions must use the canonical checkout",
);
assert.match(
  readme,
  /Default source path is `\/home\/rose\/work\/LexLattice\/codex-review-shell-direct`/,
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
  profileSource,
  /formerDirectUserDataPath = path\.join\(appDataPath, "codex-review-shell-direct"\)/,
  "automatic profile discovery must retain the former Direct profile",
);
assert.match(
  profileSource,
  /canonicalUserDataPath,[\s\S]*legacyUserDataPath,[\s\S]*formerDirectUserDataPath,[\s\S]*app\.getPath\("userData"\)/,
  "profile selection must consider canonical, former main, and former Direct locations",
);
assert.match(
  mainSource,
  /configureAppProfile\(app\)/,
  "the main process must use the shared profile selection",
);
assert.match(
  bootSource,
  /configureAppProfile\(app\)[\s\S]*require\("\.\/main\.js"\)/,
  "the boot entry must pick the profile before the main process loads",
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
