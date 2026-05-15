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
  if (runtimeMode !== "direct-experimental") return "app-server";
  if (directTransport === "live-text" && (directTier === "text-only" || directTier === "text_only")) return "direct-text";
  if (directTransport === "live-text" && (directTier === "implementation-lane" || directTier === "implementation_lane")) {
    return "direct-implementation";
  }
  return "app-server";
}

function bindingForDirectRuntimePath(binding, runtimePath) {
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
      runtimeMode: "direct-experimental",
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
  if (path === "direct-text") return "Direct Text";
  if (path === "direct-implementation") return "Direct Tools";
  return "App Server";
}

module.exports = {
  DIRECT_RUNTIME_PATHS,
  bindingForDirectRuntimePath,
  directRuntimePathFromBinding,
  directRuntimePathLabel,
  normalizeDirectRuntimePath,
};
