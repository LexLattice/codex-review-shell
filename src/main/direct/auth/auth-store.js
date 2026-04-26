"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { projectCredentialStatus, projectRefreshFailureState } = require("./oauth-shapes");

const DIRECT_AUTH_STORE_SCHEMA = "direct_codex_auth_store@1";
const DIRECT_AUTH_STATUS_SCHEMA = "direct_codex_auth_status@1";
const DEFAULT_DIRECT_AUTH_DIR = path.join(os.homedir(), ".codex-review-shell", "direct-auth");
const DEFAULT_DIRECT_AUTH_FILE_NAME = "auth.json";
const AUTH_STORE_MODES = new Set(["file", "memory"]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function nowIso(nowMs = Date.now()) {
  return new Date(Number(nowMs) || Date.now()).toISOString();
}

function normalizeStoreMode(mode = "file") {
  const candidate = String(mode || "file").trim().toLowerCase();
  if (!AUTH_STORE_MODES.has(candidate)) {
    throw new Error(`Unsupported direct auth store mode: ${mode}`);
  }
  return candidate;
}

function resolveAuthFilePath(options = {}) {
  if (options.filePath) return path.resolve(String(options.filePath));
  return path.join(
    path.resolve(String(options.rootDir || DEFAULT_DIRECT_AUTH_DIR)),
    options.fileName || DEFAULT_DIRECT_AUTH_FILE_NAME,
  );
}

function normalizeTokenValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function readFirstTokenValue(record, keys) {
  if (!isPlainObject(record)) return undefined;
  for (const key of keys) {
    if (hasOwn(record, key)) return normalizeTokenValue(record[key]);
  }
  return undefined;
}

function readFirstNumberValue(record, keys) {
  if (!isPlainObject(record)) return undefined;
  for (const key of keys) {
    if (hasOwn(record, key)) return Number(record[key]) || 0;
  }
  return undefined;
}

function normalizeStoredCredentials(credentials = {}, options = {}) {
  if (!isPlainObject(credentials)) throw new Error("Direct auth credentials must be a JSON object.");
  const previousRecord = isPlainObject(options.previousRecord) ? options.previousRecord : {};
  const nowMs = Number(options.nowMs ?? credentials.updatedAtMs ?? Date.now()) || Date.now();
  const tokenType = readFirstTokenValue(credentials, ["tokenType", "token_type"]);
  const accessToken = readFirstTokenValue(credentials, ["accessToken", "access", "access_token"]);
  const refreshToken = readFirstTokenValue(credentials, ["refreshToken", "refresh", "refresh_token"]);
  const idToken = readFirstTokenValue(credentials, ["idToken", "id_token"]);
  const accountId = readFirstTokenValue(credentials, ["accountId", "chatgptAccountId"]);
  const scope = readFirstTokenValue(credentials, ["scope"]);
  const expiresAt = readFirstNumberValue(credentials, ["expiresAt", "expires"]);
  const expiresInSeconds = readFirstNumberValue(credentials, ["expiresIn", "expires_in"]);
  return {
    schema: DIRECT_AUTH_STORE_SCHEMA,
    authMode: "chatgpt",
    tokenType: tokenType ?? (normalizeTokenValue(previousRecord.tokenType) || "Bearer"),
    accessToken: accessToken ?? "",
    refreshToken: refreshToken ?? normalizeTokenValue(previousRecord.refreshToken),
    idToken: idToken ?? "",
    accountId: accountId ?? normalizeTokenValue(previousRecord.accountId),
    scope: scope ?? normalizeTokenValue(previousRecord.scope),
    expiresAt: expiresAt ?? (expiresInSeconds ? nowMs + (expiresInSeconds * 1000) : 0),
    updatedAt: normalizeTokenValue(credentials.updatedAt) || nowIso(nowMs),
  };
}

function credentialStatusFromRecord(record, options = {}) {
  const nowMs = Number(options.nowMs ?? Date.now()) || Date.now();
  if (!record) {
    return {
      schema: DIRECT_AUTH_STATUS_SCHEMA,
      status: "unauthenticated",
      accountId: "",
      expiresAt: 0,
      expiresInMs: 0,
      hasAccessToken: false,
      hasRefreshToken: false,
      hasIdToken: false,
      tokenType: "",
      scope: "",
      storageMode: options.storageMode || "",
      refreshLockActive: Boolean(options.refreshLockActive),
      rawTokensExposed: false,
    };
  }

  const base = record.lastRefreshError
    ? projectRefreshFailureState({
      previous: record,
      error: record.lastRefreshError,
      nowMs,
    })
    : projectCredentialStatus(record, { nowMs });

  return {
    schema: DIRECT_AUTH_STATUS_SCHEMA,
    status: base.status,
    accountId: base.accountId || "",
    expiresAt: base.expiresAt,
    expiresInMs: base.expiresInMs,
    hasAccessToken: base.hasAccessToken,
    hasRefreshToken: base.hasRefreshToken,
    hasIdToken: Boolean(record.idToken),
    tokenType: record.tokenType || "",
    scope: record.scope || "",
    storageMode: options.storageMode || "",
    refreshLockActive: Boolean(options.refreshLockActive),
    rawTokensExposed: false,
    ...(record.lastRefreshError ? {
      error: base.error,
      errorDescription: base.errorDescription,
      retryable: base.retryable,
      preservesRefreshToken: base.preservesRefreshToken,
    } : {}),
  };
}

function ensurePrivateDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") {
    fs.chmodSync(directory, 0o700);
  }
}

function writePrivateJsonFile(filePath, value) {
  const directory = path.dirname(filePath);
  ensurePrivateDirectory(directory);
  const tempPath = path.join(directory, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  try {
    fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    if (process.platform !== "win32") fs.chmodSync(tempPath, 0o600);
    fs.renameSync(tempPath, filePath);
    if (process.platform !== "win32") fs.chmodSync(filePath, 0o600);
  } catch (error) {
    try {
      fs.unlinkSync(tempPath);
    } catch {
      // Best effort cleanup for failed atomic writes.
    }
    throw error;
  }
}

class FileAuthBackend {
  constructor(options = {}) {
    this.filePath = resolveAuthFilePath(options);
  }

  load() {
    try {
      return JSON.parse(fs.readFileSync(this.filePath, "utf8"));
    } catch (error) {
      if (error && error.code === "ENOENT") return null;
      if (error instanceof SyntaxError) return null;
      throw error;
    }
  }

  save(record) {
    writePrivateJsonFile(this.filePath, record);
    return record;
  }

  delete() {
    try {
      fs.unlinkSync(this.filePath);
      return true;
    } catch (error) {
      if (error && error.code === "ENOENT") return false;
      throw error;
    }
  }
}

class MemoryAuthBackend {
  constructor() {
    this.record = null;
  }

  load() {
    return this.record ? structuredClone(this.record) : null;
  }

  save(record) {
    this.record = structuredClone(record);
    return this.load();
  }

  delete() {
    const hadRecord = Boolean(this.record);
    this.record = null;
    return hadRecord;
  }
}

class DirectAuthStore {
  constructor(options = {}) {
    this.mode = normalizeStoreMode(options.mode);
    this.backend = options.backend || (this.mode === "memory"
      ? new MemoryAuthBackend()
      : new FileAuthBackend(options));
    this.filePath = this.backend.filePath || "";
    this.refreshPromise = null;
  }

  readCredentials() {
    const record = this.backend.load();
    if (!record) return null;
    if (record.schema !== DIRECT_AUTH_STORE_SCHEMA) {
      return null;
    }
    return record;
  }

  writeCredentials(credentials, options = {}) {
    const record = normalizeStoredCredentials(credentials, {
      ...options,
      previousRecord: this.readCredentials(),
    });
    this.backend.save(record);
    return this.readStatus(options);
  }

  markRefreshFailed(error = {}, options = {}) {
    const record = this.readCredentials();
    if (!record) return this.readStatus(options);
    const nextRecord = {
      ...record,
      lastRefreshError: {
        error: String(error.error || error.code || "refresh_failed"),
        errorDescription: String(error.errorDescription || error.error_description || ""),
        retryable: Boolean(error.retryable),
        failedAt: normalizeTokenValue(error.failedAt) || nowIso(options.nowMs),
      },
    };
    this.backend.save(nextRecord);
    return this.readStatus(options);
  }

  readStatus(options = {}) {
    return credentialStatusFromRecord(this.readCredentials(), {
      ...options,
      storageMode: this.mode,
      refreshLockActive: this.isRefreshLocked(),
    });
  }

  logout(options = {}) {
    const removed = this.backend.delete();
    return {
      removed,
      status: this.readStatus(options),
    };
  }

  isRefreshLocked() {
    return Boolean(this.refreshPromise);
  }

  runWithRefreshLock(callback) {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = Promise.resolve()
      .then(callback)
      .finally(() => {
        this.refreshPromise = null;
      });
    return this.refreshPromise;
  }
}

function createDirectAuthStore(options = {}) {
  return new DirectAuthStore({ mode: "file", ...options });
}

module.exports = {
  DEFAULT_DIRECT_AUTH_DIR,
  DEFAULT_DIRECT_AUTH_FILE_NAME,
  DIRECT_AUTH_STATUS_SCHEMA,
  DIRECT_AUTH_STORE_SCHEMA,
  DirectAuthStore,
  FileAuthBackend,
  MemoryAuthBackend,
  createDirectAuthStore,
  credentialStatusFromRecord,
  normalizeStoredCredentials,
  normalizeStoreMode,
  resolveAuthFilePath,
};
