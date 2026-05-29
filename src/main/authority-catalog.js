"use strict";

const SURFACE_ROLES = Object.freeze({
  SHELL_RENDERER: "shell_renderer",
  TRUSTED_CODEX_SURFACE: "trusted_codex_surface",
  EXTERNAL_CODEX_URL: "external_codex_url",
  MIDDLE_WEB: "middle_web",
  CHATGPT_WEB: "chatgpt_web",
  UNKNOWN: "unknown",
});

const CODEX_SURFACE_TRUST_PROFILES = Object.freeze({
  MANAGED_LOCAL_SURFACE: "managed_local_surface",
  EXTERNAL_HTTPS_URL: "external_https_codex_url",
  LOOPBACK_HTTP_URL: "loopback_http_url",
  FILE_URL: "file_url",
  FALLBACK_LOCAL_SURFACE: "fallback_local_surface",
  UNKNOWN: "unknown",
});

const CODEX_SURFACE_BRIDGE_PROFILES = Object.freeze({
  FULL: "full_codex_surface_bridge_with_main_authorized_rpc",
  READ_ONLY_DIAGNOSTIC: "read_only_diagnostic_bridge",
  RESTRICTED_LOCAL_DEVELOPMENT: "restricted_local_development_bridge",
  NONE: "none",
});

const CODEX_CLIENT_REQUEST_METHODS = Object.freeze([
  "initialize",
  "account/read",
  "account/rateLimits/read",
  "configRequirements/read",
  "model/list",
  "account/login/start",
  "thread/start",
  "thread/resume",
  "thread/read",
  "thread/rollback",
  "turn/start",
  "turn/steer",
  "turn/interrupt",
]);

const CODEX_CLIENT_NOTIFICATION_METHODS = Object.freeze([
  "initialized",
]);

const IPC_CHANNEL_CONTRACTS = Object.freeze([
  {
    channel: "codex-surface:connect",
    allowedSenderRoles: [SURFACE_ROLES.TRUSTED_CODEX_SURFACE],
    requiredBridgeProfile: CODEX_SURFACE_BRIDGE_PROFILES.FULL,
    authorityEvidence: "CodexAppServerConnectionAuthority",
  },
  {
    channel: "codex-surface:request",
    allowedSenderRoles: [SURFACE_ROLES.TRUSTED_CODEX_SURFACE],
    requiredBridgeProfile: CODEX_SURFACE_BRIDGE_PROFILES.FULL,
    authorityEvidence: "DirectionalRpcContract",
  },
  {
    channel: "codex-surface:notify",
    allowedSenderRoles: [SURFACE_ROLES.TRUSTED_CODEX_SURFACE],
    requiredBridgeProfile: CODEX_SURFACE_BRIDGE_PROFILES.FULL,
    authorityEvidence: "DirectionalRpcContract",
  },
  {
    channel: "codex-surface:respond",
    allowedSenderRoles: [SURFACE_ROLES.TRUSTED_CODEX_SURFACE],
    requiredBridgeProfile: CODEX_SURFACE_BRIDGE_PROFILES.FULL,
    authorityEvidence: "PendingServerRequest",
  },
  {
    channel: "attachments:*",
    allowedSenderRoles: [SURFACE_ROLES.SHELL_RENDERER, SURFACE_ROLES.TRUSTED_CODEX_SURFACE],
    requiredBridgeProfile: "shell_or_full_codex_surface_bridge",
    authorityEvidence: "AttachmentIngressSession",
  },
  {
    channel: "context-menu:open",
    allowedSenderRoles: [SURFACE_ROLES.SHELL_RENDERER, SURFACE_ROLES.TRUSTED_CODEX_SURFACE],
    requiredBridgeProfile: "shell_or_full_codex_surface_bridge",
    authorityEvidence: "ContextMenuRequest",
  },
  {
    channel: "workspace:run-command",
    allowedSenderRoles: [SURFACE_ROLES.SHELL_RENDERER],
    requiredBridgeProfile: "shell_workspace_bridge",
    authorityEvidence: "WorkspaceCommandRequest",
  },
]);

const REQUEST_METHOD_SET = new Set(CODEX_CLIENT_REQUEST_METHODS);
const NOTIFICATION_METHOD_SET = new Set(CODEX_CLIENT_NOTIFICATION_METHODS);

function normalizeSurfaceRole(value) {
  return Object.values(SURFACE_ROLES).includes(value) ? value : SURFACE_ROLES.UNKNOWN;
}

function normalizeCodexTrustProfile(value) {
  return Object.values(CODEX_SURFACE_TRUST_PROFILES).includes(value)
    ? value
    : CODEX_SURFACE_TRUST_PROFILES.UNKNOWN;
}

function normalizeCodexBridgeProfile(value) {
  return Object.values(CODEX_SURFACE_BRIDGE_PROFILES).includes(value)
    ? value
    : CODEX_SURFACE_BRIDGE_PROFILES.NONE;
}

function isLoopbackHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  return host === "localhost" || host === "::1" || host === "[::1]" || /^127(?:\.\d{1,3}){3}$/.test(host);
}

function trustProfileForCodexTarget(url) {
  try {
    const parsed = new URL(String(url || ""));
    if (parsed.protocol === "https:") return CODEX_SURFACE_TRUST_PROFILES.EXTERNAL_HTTPS_URL;
    if (parsed.protocol === "http:" && isLoopbackHost(parsed.hostname)) {
      return CODEX_SURFACE_TRUST_PROFILES.LOOPBACK_HTTP_URL;
    }
    if (parsed.protocol === "file:") return CODEX_SURFACE_TRUST_PROFILES.FILE_URL;
  } catch {}
  return CODEX_SURFACE_TRUST_PROFILES.UNKNOWN;
}

function bridgeProfileForTrustProfile(trustProfile) {
  const normalized = normalizeCodexTrustProfile(trustProfile);
  if (
    normalized === CODEX_SURFACE_TRUST_PROFILES.MANAGED_LOCAL_SURFACE ||
    normalized === CODEX_SURFACE_TRUST_PROFILES.FALLBACK_LOCAL_SURFACE
  ) {
    return CODEX_SURFACE_BRIDGE_PROFILES.FULL;
  }
  if (normalized === CODEX_SURFACE_TRUST_PROFILES.LOOPBACK_HTTP_URL) {
    return CODEX_SURFACE_BRIDGE_PROFILES.RESTRICTED_LOCAL_DEVELOPMENT;
  }
  if (normalized === CODEX_SURFACE_TRUST_PROFILES.EXTERNAL_HTTPS_URL) {
    return CODEX_SURFACE_BRIDGE_PROFILES.READ_ONLY_DIAGNOSTIC;
  }
  return CODEX_SURFACE_BRIDGE_PROFILES.NONE;
}

function codexSurfaceAuthorityForTarget(url, options = {}) {
  const trustProfile = options.trustProfile ||
    (options.managedLocal
      ? CODEX_SURFACE_TRUST_PROFILES.MANAGED_LOCAL_SURFACE
      : trustProfileForCodexTarget(url));
  const bridgeProfile = options.bridgeProfile || bridgeProfileForTrustProfile(trustProfile);
  const role = bridgeProfile === CODEX_SURFACE_BRIDGE_PROFILES.FULL
    ? SURFACE_ROLES.TRUSTED_CODEX_SURFACE
    : SURFACE_ROLES.EXTERNAL_CODEX_URL;
  return {
    surfaceRole: role,
    codexTrustProfile: normalizeCodexTrustProfile(trustProfile),
    codexBridgeProfile: normalizeCodexBridgeProfile(bridgeProfile),
  };
}

function hasFullCodexBridge(authority) {
  return authority?.surfaceRole === SURFACE_ROLES.TRUSTED_CODEX_SURFACE &&
    authority?.codexBridgeProfile === CODEX_SURFACE_BRIDGE_PROFILES.FULL;
}

function isAllowedCodexClientRequestMethod(method) {
  return REQUEST_METHOD_SET.has(String(method || ""));
}

function isAllowedCodexClientNotificationMethod(method) {
  return NOTIFICATION_METHOD_SET.has(String(method || ""));
}

function publicAuthorityCatalog() {
  return {
    schemaVersion: 1,
    surfaceRoles: SURFACE_ROLES,
    codexSurfaceTrustProfiles: CODEX_SURFACE_TRUST_PROFILES,
    codexSurfaceBridgeProfiles: CODEX_SURFACE_BRIDGE_PROFILES,
    codexClientRequestMethods: CODEX_CLIENT_REQUEST_METHODS,
    codexClientNotificationMethods: CODEX_CLIENT_NOTIFICATION_METHODS,
    ipcChannelContracts: IPC_CHANNEL_CONTRACTS,
  };
}

module.exports = {
  SURFACE_ROLES,
  CODEX_SURFACE_TRUST_PROFILES,
  CODEX_SURFACE_BRIDGE_PROFILES,
  CODEX_CLIENT_REQUEST_METHODS,
  CODEX_CLIENT_NOTIFICATION_METHODS,
  IPC_CHANNEL_CONTRACTS,
  normalizeSurfaceRole,
  normalizeCodexTrustProfile,
  normalizeCodexBridgeProfile,
  trustProfileForCodexTarget,
  bridgeProfileForTrustProfile,
  codexSurfaceAuthorityForTarget,
  hasFullCodexBridge,
  isAllowedCodexClientRequestMethod,
  isAllowedCodexClientNotificationMethod,
  publicAuthorityCatalog,
};
