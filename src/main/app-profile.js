"use strict";

// Which profile (userData folder) this run uses. It must be set before the
// app is ready, and the entry point (src/boot.js) may open the Workbench
// window before main.js loads, so it lives here and runs once.
const fs = require("node:fs");
const path = require("node:path");

const APP_TITLE = "Codex Review Shell";
const CONFIG_FILE_NAME = "workspace-config.json";
const PROFILE_ENV_VAR = "CODEX_REVIEW_SHELL_PROFILE";
const USER_DATA_DIR_ENV_VAR = "CODEX_REVIEW_SHELL_USER_DATA_DIR";
const USER_DATA_ROOT_ENV_VAR = "CODEX_REVIEW_SHELL_USER_DATA_ROOT";

function earlyNormalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function existingFileMtimeMs(targetPath) {
  try {
    return fs.statSync(targetPath).mtimeMs;
  } catch {
    return 0;
  }
}

function uniquePaths(values) {
  const seen = new Set();
  return values.filter((value) => {
    const normalized = path.resolve(value);
    const key = process.platform === "win32" ? normalized.toLowerCase() : normalized;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeProfileName(value) {
  const text = earlyNormalizeString(value, "");
  if (!text || text === "default") return "";
  return text.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

// The userData folder of an isolated profile (one named by the environment),
// or null for the default profile. Also used outside Electron
// (scripts/app-control.mjs), so it takes the appData folder as an argument.
function isolatedProfileFromEnv(env, appDataPath) {
  const explicitUserDataDir = earlyNormalizeString(env[USER_DATA_DIR_ENV_VAR], "");
  if (explicitUserDataDir) return { profileName: "explicit", userData: path.resolve(explicitUserDataDir) };
  const profileName = normalizeProfileName(env[PROFILE_ENV_VAR]);
  if (!profileName) return null;
  const configuredRoot = earlyNormalizeString(env[USER_DATA_ROOT_ENV_VAR], "");
  const profileRoot = configuredRoot || path.join(appDataPath, APP_TITLE);
  return { profileName, userData: path.join(profileRoot, profileName) };
}

function selectAppProfile(app, env) {
  app.setName(APP_TITLE);
  const isolated = isolatedProfileFromEnv(env, app.getPath("appData"));
  if (isolated) {
    app.setPath("userData", isolated.userData);
    return { ...isolated, isolated: true };
  }
  const appDataPath = app.getPath("appData");
  const canonicalUserDataPath = path.join(appDataPath, APP_TITLE);
  const legacyUserDataPath = path.join(appDataPath, "codex-review-shell");
  const formerDirectUserDataPath = path.join(appDataPath, "codex-review-shell-direct");
  // A promoted installation may have been active on either former lineage.
  // Keep using the profile with the newest persisted workspace configuration.
  const candidates = uniquePaths([
    canonicalUserDataPath,
    legacyUserDataPath,
    formerDirectUserDataPath,
    app.getPath("userData"),
  ]);
  let selectedPath = canonicalUserDataPath;
  let selectedMtime = 0;
  for (const candidate of candidates) {
    const mtime = existingFileMtimeMs(path.join(candidate, CONFIG_FILE_NAME));
    if (mtime > selectedMtime) {
      selectedPath = candidate;
      selectedMtime = mtime;
    }
  }
  app.setPath("userData", selectedPath);
  return {
    profileName: "default",
    isolated: false,
    userData: selectedPath,
  };
}

let selected = null;

function configureAppProfile(app, env = process.env) {
  selected ||= selectAppProfile(app, env);
  return selected;
}

module.exports = {
  APP_TITLE,
  CONFIG_FILE_NAME,
  configureAppProfile,
  isolatedProfileFromEnv,
};
