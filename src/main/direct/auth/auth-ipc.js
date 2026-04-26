"use strict";

const path = require("node:path");
const {
  DEFAULT_DIRECT_AUTH_DIR,
  createDirectAuthStore,
  normalizeStoreMode,
} = require("./auth-store");

const DIRECT_AUTH_SETTINGS_SCHEMA = "direct_codex_auth_settings@1";
const DIRECT_AUTH_LOGIN_RESULT_SCHEMA = "direct_codex_auth_login_result@1";
const AVAILABLE_STORAGE_MODES = ["file", "memory"];

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nowIso() {
  return new Date().toISOString();
}

function safePayload(value) {
  return isPlainObject(value) ? value : {};
}

class DirectAuthIpcController {
  constructor(options = {}) {
    this.storeMode = normalizeStoreMode(options.storeMode || options.mode || "file");
    this.rootDir = path.resolve(String(options.rootDir || DEFAULT_DIRECT_AUTH_DIR));
    this.filePath = options.filePath ? path.resolve(String(options.filePath)) : "";
    this.loginStarter = typeof options.loginStarter === "function" ? options.loginStarter : null;
    this.stores = new Map();
  }

  storeOptionsForMode(mode) {
    if (mode === "memory") return { mode };
    return this.filePath ? { mode, filePath: this.filePath } : { mode, rootDir: this.rootDir };
  }

  storeForMode(mode = this.storeMode) {
    const normalizedMode = normalizeStoreMode(mode);
    if (!this.stores.has(normalizedMode)) {
      this.stores.set(normalizedMode, createDirectAuthStore(this.storeOptionsForMode(normalizedMode)));
    }
    return this.stores.get(normalizedMode);
  }

  activeStore() {
    return this.storeForMode(this.storeMode);
  }

  readStatus(options = {}) {
    return this.activeStore().readStatus(options);
  }

  readSettings(options = {}) {
    return {
      schema: DIRECT_AUTH_SETTINGS_SCHEMA,
      storageMode: this.storeMode,
      availableStorageModes: AVAILABLE_STORAGE_MODES.slice(),
      defaultStorageMode: "file",
      persistentStorageActive: this.storeMode === "file",
      memoryStorageActive: this.storeMode === "memory",
      storagePathExposed: false,
      rawTokensExposed: false,
      liveOAuthAvailable: Boolean(this.loginStarter),
      capabilities: {
        persistentFileStore: true,
        memoryStore: true,
        logout: true,
        liveOAuth: Boolean(this.loginStarter),
      },
      authStatus: this.readStatus(options),
    };
  }

  setStorageMode(mode, options = {}) {
    this.storeMode = normalizeStoreMode(mode);
    return {
      ok: true,
      status: this.readStatus(options),
      settings: this.readSettings(options),
    };
  }

  writeCredentials(credentials, options = {}) {
    return this.activeStore().writeCredentials(credentials, options);
  }

  async beginLogin(options = {}) {
    if (!this.loginStarter) {
      return {
        schema: DIRECT_AUTH_LOGIN_RESULT_SCHEMA,
        ok: false,
        status: "not_implemented",
        reason: "live_oauth_not_implemented",
        rawTokensExposed: false,
        authStatus: this.readStatus(options),
      };
    }
    const result = await this.loginStarter(safePayload(options), this);
    return {
      schema: DIRECT_AUTH_LOGIN_RESULT_SCHEMA,
      ok: Boolean(result?.ok),
      status: String(result?.status || (result?.ok ? "started" : "failed")),
      reason: String(result?.reason || ""),
      rawTokensExposed: false,
      authStatus: this.readStatus(options),
    };
  }

  logout(options = {}) {
    const allStores = options.allStores !== false;
    const modes = allStores ? AVAILABLE_STORAGE_MODES : [this.storeMode];
    const removedStorageModes = {};
    for (const mode of modes) {
      removedStorageModes[mode] = this.storeForMode(mode).logout(options).removed;
    }
    return {
      ok: true,
      removedStorageModes,
      status: this.readStatus(options),
      settings: this.readSettings(options),
      rawTokensExposed: false,
    };
  }
}

function createDirectAuthIpcController(options = {}) {
  return new DirectAuthIpcController(options);
}

function resolveController(controllerRef) {
  const controller = typeof controllerRef === "function" ? controllerRef() : controllerRef;
  if (!controller) throw new Error("Direct auth IPC controller is not configured.");
  return controller;
}

function emitStatusChange(onStatusChange, action, result) {
  if (typeof onStatusChange !== "function") return;
  const authStatus = isPlainObject(result?.authStatus)
    ? result.authStatus
    : isPlainObject(result?.status)
      ? result.status
      : isPlainObject(result?.settings?.authStatus)
        ? result.settings.authStatus
        : null;
  onStatusChange({
    type: "direct-auth-status",
    action,
    operationStatus: typeof result?.status === "string" ? result.status : "",
    status: authStatus,
    settings: result?.settings || null,
    at: nowIso(),
  });
}

function registerDirectAuthIpcHandlers(ipcMain, controllerRef, options = {}) {
  if (!ipcMain || typeof ipcMain.handle !== "function") {
    throw new Error("ipcMain.handle is required to register direct auth IPC handlers.");
  }
  const onStatusChange = options.onStatusChange;

  ipcMain.handle("direct-auth:settings", async (_event, payload) => {
    return resolveController(controllerRef).readSettings(safePayload(payload));
  });
  ipcMain.handle("direct-auth:status", async (_event, payload) => {
    return resolveController(controllerRef).readStatus(safePayload(payload));
  });
  ipcMain.handle("direct-auth:set-storage-mode", async (_event, payload) => {
    const result = resolveController(controllerRef).setStorageMode(safePayload(payload).mode, safePayload(payload));
    emitStatusChange(onStatusChange, "set-storage-mode", result);
    return result;
  });
  ipcMain.handle("direct-auth:login", async (_event, payload) => {
    const result = await resolveController(controllerRef).beginLogin(safePayload(payload));
    emitStatusChange(onStatusChange, "login", result);
    return result;
  });
  ipcMain.handle("direct-auth:logout", async (_event, payload) => {
    const result = resolveController(controllerRef).logout(safePayload(payload));
    emitStatusChange(onStatusChange, "logout", result);
    return result;
  });
}

module.exports = {
  AVAILABLE_STORAGE_MODES,
  DIRECT_AUTH_LOGIN_RESULT_SCHEMA,
  DIRECT_AUTH_SETTINGS_SCHEMA,
  DirectAuthIpcController,
  createDirectAuthIpcController,
  registerDirectAuthIpcHandlers,
};
