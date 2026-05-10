"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { projectCredentialStatus } = require("./oauth-shapes");

const DIRECT_AUTH_STORE_SCHEMA = "direct_codex_auth_store@1";
const DIRECT_AUTH_STATUS_SCHEMA = "direct_codex_auth_status@1";

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function nowIso(nowMs = Date.now()) {
  return new Date(Number(nowMs) || Date.now()).toISOString();
}

function decodeJwtPayload(token = "") {
  const parts = normalizeString(token, "").split(".");
  if (parts.length < 2 || !parts[1]) return {};
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return {};
  }
}

function expiresAtFromAccessToken(accessToken = "") {
  const payload = decodeJwtPayload(accessToken);
  const exp = Number(payload.exp || 0) || 0;
  return exp > 0 ? exp * 1000 : 0;
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    if (error && error.code === "ENOENT") return null;
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

function existingFileMtimeMs(filePath) {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return 0;
  }
}

function uniquePaths(values = []) {
  const seen = new Set();
  const output = [];
  for (const value of values) {
    const text = normalizeString(value, "");
    if (!text) continue;
    const normalized = path.resolve(text);
    const key = process.platform === "win32" ? normalized.toLowerCase() : normalized;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(normalized);
  }
  return output;
}

function windowsHomeCandidates() {
  const candidates = [];
  const userProfile = normalizeString(process.env.USERPROFILE, "");
  if (userProfile) candidates.push(userProfile);
  const homeDrive = normalizeString(process.env.HOMEDRIVE, "");
  const homePath = normalizeString(process.env.HOMEPATH, "");
  if (homeDrive && homePath) candidates.push(`${homeDrive}${homePath}`);
  const username = normalizeString(process.env.USERNAME || os.userInfo().username, "");
  if (username) {
    candidates.push(path.join("C:\\Users", username));
    candidates.push(path.join("/mnt/c/Users", username));
    candidates.push(path.join("/mnt/c/Users", username.charAt(0).toUpperCase() + username.slice(1)));
  }
  return uniquePaths(candidates);
}

function explicitCodexAuthFileCandidates(options = {}) {
  return uniquePaths([
    options.filePath,
    process.env.CODEX_DIRECT_CODEX_AUTH_FILE,
    process.env.CODEX_AUTH_FILE,
  ]);
}

function defaultCodexAuthFileCandidates(options = {}) {
  const explicit = explicitCodexAuthFileCandidates(options);
  if (explicit.length) return explicit;
  const homes = [
    process.env.CODEX_HOME,
    path.join(os.homedir(), ".codex"),
    ...windowsHomeCandidates().map((home) => path.join(home, ".codex")),
  ];
  return uniquePaths(homes.map((home) => path.join(home, "auth.json")));
}

function normalizeCodexCliCredentials(raw = {}, options = {}) {
  if (!isPlainObject(raw)) return null;
  const tokens = isPlainObject(raw.tokens) ? raw.tokens : {};
  const accessToken = normalizeString(tokens.access_token || raw.access_token || raw.accessToken, "");
  if (!accessToken) return null;
  const refreshToken = normalizeString(tokens.refresh_token || raw.refresh_token || raw.refreshToken, "");
  const idToken = normalizeString(tokens.id_token || raw.id_token || raw.idToken, "");
  const accountId = normalizeString(tokens.account_id || raw.account_id || raw.accountId, "");
  const updatedAt = normalizeString(raw.last_refresh || raw.updatedAt, "") || nowIso(options.nowMs);
  return {
    schema: DIRECT_AUTH_STORE_SCHEMA,
    authMode: "chatgpt",
    tokenType: "Bearer",
    accessToken,
    refreshToken,
    idToken,
    accountId,
    scope: normalizeString(raw.scope, ""),
    expiresAt: expiresAtFromAccessToken(accessToken),
    updatedAt,
    source: "codex-cli-auth",
  };
}

function statusFromCredentials(credentials, options = {}) {
  const base = credentials ? projectCredentialStatus(credentials, options) : {
    status: "unauthenticated",
    accountId: "",
    expiresAt: 0,
    expiresInMs: 0,
    hasAccessToken: false,
    hasRefreshToken: false,
  };
  return {
    schema: DIRECT_AUTH_STATUS_SCHEMA,
    status: base.status,
    accountId: base.accountId || "",
    expiresAt: base.expiresAt || 0,
    expiresInMs: base.expiresInMs || 0,
    hasAccessToken: Boolean(base.hasAccessToken),
    hasRefreshToken: Boolean(base.hasRefreshToken),
    hasIdToken: Boolean(credentials?.idToken),
    tokenType: credentials?.tokenType || "",
    scope: credentials?.scope || "",
    storageMode: "codex-cli-auth-fallback",
    refreshLockActive: false,
    source: "codex-cli-auth",
    rawTokensExposed: false,
  };
}

class CodexCliAuthStore {
  constructor(options = {}) {
    const explicit = options.filePaths ? uniquePaths(options.filePaths) : explicitCodexAuthFileCandidates(options);
    this.explicitFilePaths = explicit;
    this.filePaths = explicit.length ? explicit : defaultCodexAuthFileCandidates(options);
  }

  readSourceFilePath() {
    if (this.explicitFilePaths.length) {
      return this.explicitFilePaths.find((filePath) => existingFileMtimeMs(filePath) > 0) || this.explicitFilePaths[0];
    }
    let best = "";
    let bestMtime = 0;
    for (const filePath of this.filePaths) {
      const mtime = existingFileMtimeMs(filePath);
      if (mtime > bestMtime) {
        best = filePath;
        bestMtime = mtime;
      }
    }
    return best;
  }

  readCredentials() {
    const filePath = this.readSourceFilePath();
    if (!filePath) return null;
    return normalizeCodexCliCredentials(readJsonFile(filePath), { filePath });
  }

  readStatus(options = {}) {
    return statusFromCredentials(this.readCredentials(), options);
  }

  isRefreshLocked() {
    return false;
  }
}

function storeCredentials(store) {
  if (!store || typeof store.readCredentials !== "function") return null;
  try {
    return store.readCredentials();
  } catch {
    return null;
  }
}

function storeStatus(store, options = {}) {
  if (!store || typeof store.readStatus !== "function") return null;
  try {
    return store.readStatus(options);
  } catch {
    return null;
  }
}

function resolveStore(storeOrFactory) {
  return typeof storeOrFactory === "function" ? storeOrFactory() : storeOrFactory;
}

class CompositeDirectAuthStore {
  constructor(options = {}) {
    this.primaryStore = options.primaryStore || options.primary || null;
    this.fallbackStore = options.fallbackStore || options.fallback || null;
  }

  primary() {
    return resolveStore(this.primaryStore);
  }

  fallback() {
    return resolveStore(this.fallbackStore);
  }

  selectedEntry() {
    const primary = this.primary();
    const primaryCredentials = storeCredentials(primary);
    if (primaryCredentials?.accessToken) return { kind: "primary", store: primary, credentials: primaryCredentials };
    const fallback = this.fallback();
    const fallbackCredentials = storeCredentials(fallback);
    if (fallbackCredentials?.accessToken) return { kind: "fallback", store: fallback, credentials: fallbackCredentials };
    return { kind: primary ? "primary" : "fallback", store: primary || fallback || null, credentials: null };
  }

  readCredentials() {
    return this.selectedEntry().credentials;
  }

  readStatus(options = {}) {
    const entry = this.selectedEntry();
    if (!entry.credentials) return statusFromCredentials(null, options);
    if (entry.kind === "fallback") return statusFromCredentials(entry.credentials, options);
    return storeStatus(entry.store, options) || statusFromCredentials(entry.credentials, options);
  }

  writeCredentials(credentials, options = {}) {
    const primary = this.primary();
    if (!primary || typeof primary.writeCredentials !== "function") throw new Error("Primary direct auth store is not writable.");
    return primary.writeCredentials(credentials, options);
  }

  markRefreshFailed(error = {}, options = {}) {
    const primary = this.primary();
    return primary && typeof primary.markRefreshFailed === "function"
      ? primary.markRefreshFailed(error, options)
      : this.readStatus(options);
  }

  logout(options = {}) {
    const primary = this.primary();
    return primary && typeof primary.logout === "function"
      ? primary.logout(options)
      : { removed: false, status: this.readStatus(options) };
  }

  isRefreshLocked() {
    const primary = this.primary();
    return primary && typeof primary.isRefreshLocked === "function" ? primary.isRefreshLocked() : false;
  }

  runWithRefreshLock(callback) {
    const primary = this.primary();
    return primary && typeof primary.runWithRefreshLock === "function" ? primary.runWithRefreshLock(callback) : callback();
  }
}

function createCodexCliAuthStore(options = {}) {
  return new CodexCliAuthStore(options);
}

function createDirectAuthCompositeStore(options = {}) {
  return new CompositeDirectAuthStore(options);
}

module.exports = {
  CodexCliAuthStore,
  CompositeDirectAuthStore,
  createCodexCliAuthStore,
  createDirectAuthCompositeStore,
  defaultCodexAuthFileCandidates,
  explicitCodexAuthFileCandidates,
  normalizeCodexCliCredentials,
};
