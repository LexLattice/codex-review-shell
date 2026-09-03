"use strict";

const DIRECT_RUNTIME_PATHS = Object.freeze(["app-server", "direct-text", "direct-implementation"]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizeDirectRuntimePath(value, fallback = "app-server") {
  const candidate = normalizeString(value, fallback).toLowerCase();
  if (candidate === "legacy-app-server" || candidate === "legacy_app_server") return "app-server";
  if (candidate === "appserver" || candidate === "app_server" || candidate === "managed") return "app-server";
  if (candidate === "direct" || candidate === "direct_oai" || candidate === "direct-oai") return "direct-implementation";
  if (candidate === "text-only" || candidate === "text_only") return "direct-text";
  if (candidate === "direct-live-text" || candidate === "direct_text" || candidate === "direct-text-only") return "direct-text";
  if (candidate === "implementation" || candidate === "implementation-lane") return "direct-implementation";
  if (candidate === "implementation_lane" || candidate === "direct-tools" || candidate === "tools") return "direct-implementation";
  return DIRECT_RUNTIME_PATHS.includes(candidate) ? candidate : normalizeDirectRuntimePath(fallback, "app-server");
}

function directRuntimePathFromBinding(binding) {
  const raw = isPlainObject(binding) ? binding : {};
  const runtimeMode = normalizeString(raw.runtimeMode, "legacy-app-server").toLowerCase();
  const directTransport = normalizeString(raw.directTransport, "fixture").toLowerCase();
  const directTier = normalizeString(raw.directTier || raw.activationTier || raw.runtimeTier, "none").toLowerCase();
  if (runtimeMode === "direct" && directTransport === "live-text") return "direct-implementation";
  if (runtimeMode !== "direct-experimental") return "app-server";
  if (directTransport === "live-text" && (directTier === "text-only" || directTier === "text_only")) return "direct-text";
  if (directTransport === "live-text" && (directTier === "implementation-lane" || directTier === "implementation_lane")) {
    return "direct-implementation";
  }
  return "app-server";
}

function bindingForDirectRuntimePath(binding, runtimePath, options = {}) {
  const raw = isPlainObject(binding) ? binding : {};
  const path = normalizeDirectRuntimePath(runtimePath);
  if (path === "direct-text") {
    return {
      ...raw,
      bindingProvider: "direct-chatgpt-codex",
      runtimeMode: "direct-experimental",
      directTransport: "live-text",
      directTier: "text-only",
    };
  }
  if (path === "direct-implementation") {
    return {
      ...raw,
      bindingProvider: "direct-chatgpt-codex",
      runtimeMode: options.ordinary === true ? "direct" : "direct-experimental",
      directTransport: "live-text",
      directTier: "implementation-lane",
    };
  }
  return {
    ...raw,
    bindingProvider: "codex-compatible",
    runtimeMode: "legacy-app-server",
    directTransport: "fixture",
    directTier: "none",
  };
}

function directRuntimePathLabel(runtimePath) {
  const path = normalizeDirectRuntimePath(runtimePath);
  if (path === "direct-text" || path === "direct-implementation") return "Direct";
  return "App Server";
}

function defaultCodexHostRuntimeForWorkspace(workspace = {}, platform = process.platform) {
  return workspace?.kind === "wsl" && platform === "win32" ? "wsl" : "auto";
}

function alignCodexHostRuntimeWithWorkspace(binding = {}, options = {}) {
  const raw = isPlainObject(binding) ? binding : {};
  const currentWorkspaceKind = normalizeString(options.currentWorkspace?.kind, "").toLowerCase();
  const nextWorkspace = isPlainObject(options.nextWorkspace) ? options.nextWorkspace : {};
  const nextWorkspaceKind = normalizeString(nextWorkspace.kind, "").toLowerCase();
  const substrateChanged = options.mode === "create" || currentWorkspaceKind !== nextWorkspaceKind;
  if (!substrateChanged) return { ...raw };
  return {
    ...raw,
    runtime: defaultCodexHostRuntimeForWorkspace(nextWorkspace, options.platform || process.platform),
  };
}

function normalizeCodexThreadNativeRuntime(value) {
  const candidate = normalizeString(value, "").toLowerCase();
  if (["app-server", "app_server", "appserver", "codex", "vanilla-codex"].includes(candidate)) {
    return "app-server";
  }
  if (["direct", "direct-native", "direct_native"].includes(candidate)) return "direct";
  return "unknown";
}

function codexThreadNativeRuntime(threadRef = {}) {
  const explicit = normalizeCodexThreadNativeRuntime(
    threadRef.nativeRuntime || threadRef.native_runtime || threadRef.runtime,
  );
  if (explicit !== "unknown") return explicit;
  if (normalizeString(threadRef.sessionFilePath, "") || normalizeString(threadRef.sourceHome, "")) {
    return "app-server";
  }
  if (threadRef.nativeDirectSession === true || normalizeString(threadRef.sourceClass, "").startsWith("direct-")) {
    return "direct";
  }
  return "unknown";
}

function resolveCodexThreadOpenRuntime(binding, threadRef = {}) {
  const currentRuntimePath = directRuntimePathFromBinding(binding);
  const nativeRuntime = codexThreadNativeRuntime(threadRef);
  const selectedRuntimePath = nativeRuntime === "app-server" ? "app-server" : currentRuntimePath;
  return {
    schema: "codex_thread_runtime_route@1",
    nativeRuntime,
    currentRuntimePath,
    selectedRuntimePath,
    autoSwitch: selectedRuntimePath !== currentRuntimePath,
    continuityMode: nativeRuntime === "app-server"
      ? "native_app_server_resume"
      : nativeRuntime === "direct"
        ? "native_direct_session"
        : "current_runtime",
    directContinuationPosture: nativeRuntime === "app-server"
      ? "secondary_checkpoint_continuation"
      : "not_applicable",
  };
}

module.exports = {
  DIRECT_RUNTIME_PATHS,
  alignCodexHostRuntimeWithWorkspace,
  bindingForDirectRuntimePath,
  codexThreadNativeRuntime,
  directRuntimePathFromBinding,
  directRuntimePathLabel,
  defaultCodexHostRuntimeForWorkspace,
  normalizeDirectRuntimePath,
  resolveCodexThreadOpenRuntime,
};
