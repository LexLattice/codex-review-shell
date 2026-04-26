"use strict";

const DIRECT_RUNTIME_STATUS_SCHEMA = "direct_codex_runtime_status@1";
const CODEX_RUNTIME_MODES = new Set(["legacy-app-server", "direct-experimental", "direct"]);
const CODEX_BINDING_PROVIDERS = new Set(["codex-compatible", "custom-codex-fork", "direct-chatgpt-codex"]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizeCodexRuntimeMode(value, fallback = "legacy-app-server") {
  const candidate = normalizeString(value, fallback).toLowerCase();
  if (candidate === "app-server" || candidate === "managed" || candidate === "legacy") return "legacy-app-server";
  if (candidate === "experimental-direct") return "direct-experimental";
  return CODEX_RUNTIME_MODES.has(candidate) ? candidate : fallback;
}

function normalizeCodexBindingProvider(value, fallback = "codex-compatible") {
  const candidate = normalizeString(value, fallback).toLowerCase();
  return CODEX_BINDING_PROVIDERS.has(candidate) ? candidate : fallback;
}

function normalizeCodexBinding(raw = {}) {
  const binding = isPlainObject(raw) ? raw : {};
  const runtimeMode = normalizeCodexRuntimeMode(binding.runtimeMode);
  const defaultProvider = runtimeMode === "legacy-app-server" ? "codex-compatible" : "direct-chatgpt-codex";
  return {
    provider: normalizeCodexBindingProvider(binding.provider, defaultProvider),
    runtimeMode,
    target: normalizeString(binding.target, ""),
    profileId: normalizeString(binding.profileId, ""),
  };
}

function directRuntimeModeLabel(runtimeMode) {
  if (runtimeMode === "direct") return "direct";
  if (runtimeMode === "direct-experimental") return "direct experimental";
  return "legacy app-server";
}

function directRuntimeLaneLabel(codex = {}) {
  const binding = normalizeCodexBinding(codex);
  if (binding.runtimeMode === "direct") return "direct runtime";
  if (binding.runtimeMode === "direct-experimental") return "direct experimental scaffold";
  return codex.mode === "managed" ? "legacy app-server bridge" : codex.mode || "legacy app-server";
}

function authAcceptanceStatus(authStatus = {}) {
  if (authStatus.status === "authenticated") return "accepted";
  if (authStatus.status === "expired" && authStatus.hasRefreshToken) return "unstable";
  if (authStatus.status === "refresh_failed") return "unstable";
  return "observed";
}

function authRefreshStatus(authStatus = {}) {
  if (authStatus.status === "authenticated") return "accepted";
  if (authStatus.hasRefreshToken) return "unstable";
  return "unavailable";
}

function authStorageKind(authStatus = {}, authSettings = {}) {
  const mode = normalizeString(authSettings.storageMode || authStatus.storageMode, "file");
  if (mode === "memory") return "ephemeral-memory";
  return "plain-file-dev-only";
}

function modelEntriesFromProfile(profileDoc = {}) {
  const models = profileDoc.profile?.ontology?.models;
  if (!Array.isArray(models)) return [];
  return models
    .filter((model) => isPlainObject(model) && model.id && model.status !== "rejected")
    .map((model) => ({
      id: String(model.id),
      displayName: normalizeString(model.displayName || model.name, String(model.id)),
      status: normalizeString(model.status, "unknown"),
      supportsReasoning: model.supportsReasoning === null ? null : Boolean(model.supportsReasoning),
      supportsTools: model.supportsTools === null ? null : Boolean(model.supportsTools),
    }));
}

function buildDirectRuntimeStatus(options = {}) {
  const generatedAt = normalizeString(options.generatedAt, "") || new Date().toISOString();
  const project = isPlainObject(options.project) ? options.project : {};
  const codex = isPlainObject(project.surfaceBinding?.codex) ? project.surfaceBinding.codex : {};
  const binding = normalizeCodexBinding(codex);
  const authStatus = isPlainObject(options.authStatus) ? options.authStatus : {};
  const authSettings = isPlainObject(options.authSettings) ? options.authSettings : {};
  const profileDoc = isPlainObject(options.profileDoc) ? options.profileDoc : {};
  const legacySession = isPlainObject(options.legacySession) ? options.legacySession : null;
  const sessionStore = isPlainObject(options.sessionStore) ? options.sessionStore : null;
  const modelEntries = modelEntriesFromProfile(profileDoc);
  const directModeSelected = binding.runtimeMode !== "legacy-app-server";
  const directTurnBlockedReason =
    binding.runtimeMode === "direct"
      ? "direct_runtime_validation_gates_not_passed"
      : "direct_session_engine_not_implemented";

  return {
    schema: DIRECT_RUNTIME_STATUS_SCHEMA,
    version: 1,
    runtime: "direct-chatgpt-codex",
    runtimeMode: binding.runtimeMode,
    runtimeModeLabel: directRuntimeModeLabel(binding.runtimeMode),
    provider: binding.provider,
    currentCodexLane: directRuntimeLaneLabel(codex),
    status: directModeSelected ? "degraded" : "legacy-app-server",
    generatedAt,
    auth: {
      source: "direct-auth-store",
      operationalStatus: normalizeString(authStatus.status, "unauthenticated"),
      rawTokensExposed: false,
      capability: {
        status: authAcceptanceStatus(authStatus),
        acquisition: "browser-callback",
        refresh: authRefreshStatus(authStatus),
        accountIdSource: authStatus.accountId ? "token-claim" : "unknown",
        storage: authStorageKind(authStatus, authSettings),
      },
    },
    directRuntime: {
      selected: directModeSelected,
      status: directModeSelected ? "not_runnable" : "not_selected",
      ready: false,
      panelAttachStatus: directModeSelected ? "fixture_status_only" : "legacy_app_server_bridge",
      turnRunnable: false,
      reason: directModeSelected ? directTurnBlockedReason : "legacy_app_server_mode_active",
    },
    transport: {
      kind: "sse",
      endpoint: "chatgpt-codex-responses",
      liveProbed: false,
      runnable: false,
    },
    threads: {
      canStart: false,
      canRead: false,
      canResume: false,
      canPersist: Boolean(sessionStore?.available),
      canImportCodexAppServer: true,
    },
    turns: {
      canStart: false,
      canInterrupt: false,
      canUseTools: false,
      canContinueAfterTools: false,
      canCompact: false,
    },
    models: {
      source: "static-baseline",
      selectorEnabled: false,
      sourceVisible: true,
      ids: modelEntries.map((model) => model.id),
      entries: modelEntries,
    },
    authority: {
      workspaceTools: false,
      commandApproval: false,
      fileChangeApproval: false,
      networkApproval: false,
    },
    sessionStore: {
      available: Boolean(sessionStore?.available),
      rootExposed: false,
      schema: normalizeString(sessionStore?.schema, ""),
      sessionCount: Number(sessionStore?.sessionCount || 0),
      turnCount: Number(sessionStore?.turnCount || 0),
      eventCount: Number(sessionStore?.eventCount || 0),
      lastSessionUpdatedAt: normalizeString(sessionStore?.lastSessionUpdatedAt, ""),
      recovery: isPlainObject(sessionStore?.recovery) ? sessionStore.recovery : {},
    },
    diagnostics: {
      profileId: normalizeString(binding.profileId || profileDoc.profile?.profileId || profileDoc.summary?.profileId, ""),
      profileSource: normalizeString(profileDoc.profile?.source || profileDoc.summary?.source, ""),
      profileStatus: "observed",
      legacyAppServerAvailable: Boolean(legacySession),
      legacyAppServerStatus: normalizeString(legacySession?.status, ""),
      rawAuthHeadersExposed: false,
      rawBackendRequestsExposed: false,
      rawBackendFramesExposed: false,
    },
  };
}

module.exports = {
  CODEX_BINDING_PROVIDERS,
  CODEX_RUNTIME_MODES,
  DIRECT_RUNTIME_STATUS_SCHEMA,
  buildDirectRuntimeStatus,
  directRuntimeLaneLabel,
  directRuntimeModeLabel,
  normalizeCodexBinding,
  normalizeCodexBindingProvider,
  normalizeCodexRuntimeMode,
};
