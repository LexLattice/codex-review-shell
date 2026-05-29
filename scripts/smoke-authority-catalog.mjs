import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  CODEX_SURFACE_BRIDGE_PROFILES,
  CODEX_SURFACE_TRUST_PROFILES,
  SURFACE_ROLES,
  bridgeProfileForTrustProfile,
  codexClientNotificationDecision,
  codexClientRequestDecision,
  codexSurfaceAuthorityForTarget,
  hasFullCodexBridge,
  isAllowedCodexClientNotificationMethod,
  isAllowedCodexClientRequestMethod,
  publicAuthorityCatalog,
  trustProfileForCodexTarget,
} = require("../src/main/authority-catalog.js");
const {
  createCodexSurfaceConnectionAuthority,
  validateCodexSurfaceConnectionRequest,
} = require("../src/main/codex-surface-connection-authority.js");

const catalog = publicAuthorityCatalog();

assert.equal(catalog.schemaVersion, 1);
assert.ok(catalog.ipcChannelContracts.some((row) => row.channel === "codex-surface:connect"));
assert.equal(catalog.ipcChannelContracts.some((row) => row.channel === "workspace:run-command"), false);

assert.equal(
  trustProfileForCodexTarget("https://example.com/codex"),
  CODEX_SURFACE_TRUST_PROFILES.EXTERNAL_HTTPS_URL,
);
assert.equal(
  trustProfileForCodexTarget("http://127.0.0.1:8989/codex"),
  CODEX_SURFACE_TRUST_PROFILES.LOOPBACK_HTTP_URL,
);
assert.equal(
  trustProfileForCodexTarget("file:///tmp/codex.html"),
  CODEX_SURFACE_TRUST_PROFILES.FILE_URL,
);

assert.equal(
  bridgeProfileForTrustProfile(CODEX_SURFACE_TRUST_PROFILES.MANAGED_LOCAL_SURFACE),
  CODEX_SURFACE_BRIDGE_PROFILES.FULL,
);
assert.equal(
  bridgeProfileForTrustProfile(CODEX_SURFACE_TRUST_PROFILES.EXTERNAL_HTTPS_URL),
  CODEX_SURFACE_BRIDGE_PROFILES.READ_ONLY_DIAGNOSTIC,
);
assert.equal(
  bridgeProfileForTrustProfile(CODEX_SURFACE_TRUST_PROFILES.FILE_URL),
  CODEX_SURFACE_BRIDGE_PROFILES.NONE,
);

const managed = codexSurfaceAuthorityForTarget("http://127.0.0.1:9999/codex", { managedLocal: true });
assert.equal(managed.surfaceRole, SURFACE_ROLES.TRUSTED_CODEX_SURFACE);
assert.equal(managed.codexBridgeProfile, CODEX_SURFACE_BRIDGE_PROFILES.FULL);
assert.equal(hasFullCodexBridge(managed), true);

const external = codexSurfaceAuthorityForTarget("https://example.com/codex");
assert.equal(external.surfaceRole, SURFACE_ROLES.EXTERNAL_CODEX_URL);
assert.equal(hasFullCodexBridge(external), false);

assert.equal(isAllowedCodexClientRequestMethod("turn/start"), true);
assert.equal(isAllowedCodexClientRequestMethod("account/login/start"), true);
assert.equal(isAllowedCodexClientRequestMethod("thread/rollback"), true);
assert.equal(isAllowedCodexClientRequestMethod("thread/delete"), false);
assert.equal(isAllowedCodexClientNotificationMethod("initialized"), true);
assert.equal(isAllowedCodexClientNotificationMethod("turn/completed"), false);

const readyCapabilities = {
  coreRuntime: { canInitialize: true },
  account: { canRead: true, canStartLogin: true },
  configRequirements: { canRead: true },
  usage: { canReadRateLimits: true },
  model: { canList: true },
  threads: { canStart: true, canResume: true, canRead: true, canRollback: true },
  turns: { canStart: true, canSteer: true, canInterrupt: true },
};
assert.equal(codexClientRequestDecision("turn/start", readyCapabilities).ok, true);
assert.equal(codexClientRequestDecision("account/rateLimits/read", readyCapabilities).ok, true);
assert.equal(codexClientRequestDecision("turn/start", { coreRuntime: { canInitialize: true } }).ok, false);
assert.equal(codexClientRequestDecision("thread/delete", readyCapabilities).reason, "method_not_allowlisted");
assert.equal(codexClientNotificationDecision("initialized", readyCapabilities).ok, true);
assert.equal(codexClientNotificationDecision("initialized", {}).reason, "capability_not_declared");

const connectionAuthority = createCodexSurfaceConnectionAuthority(
  { id: "project_1", surfaceBinding: { codex: { remoteAuth: { mode: "bearer-token-file", tokenFilePath: "/tmp/token" } } } },
  {
    wsUrl: "ws://127.0.0.1:1234",
    readyUrl: "http://127.0.0.1:1234/readyz",
    runtime: "wsl",
    workspaceRoot: "/home/rose/work/private/repo",
    binaryPath: "/home/rose/bin/codex",
    capabilities: {
      diagnostics: {
        runtime: "wsl",
        binaryPath: "/home/rose/bin/codex",
        codexHome: "/home/rose/.codex",
        readyUrl: "http://127.0.0.1:1234/readyz",
      },
    },
  },
  { activationEpoch: 7, connectionRef: "conn_1" },
);
assert.equal(connectionAuthority.publicConnection.connectionRef, "conn_1");
assert.equal(connectionAuthority.publicConnection.wsUrl, undefined);
assert.equal(connectionAuthority.publicConnection.readyUrl, undefined);
assert.equal(connectionAuthority.publicConnection.remoteAuth, undefined);
assert.equal(connectionAuthority.publicConnection.capabilities.diagnostics.binaryPath, undefined);
assert.equal(
  validateCodexSurfaceConnectionRequest(connectionAuthority.privateConnection, {
    connectionRef: "conn_1",
    activationEpoch: 7,
  }).wsUrl,
  "ws://127.0.0.1:1234",
);
assert.throws(
  () => validateCodexSurfaceConnectionRequest(connectionAuthority.privateConnection, {
    connectionRef: "conn_1",
    wsUrl: "ws://127.0.0.1:9999",
    activationEpoch: 7,
  }),
  /authority-bearing/,
);

console.log("authority-catalog:smoke passed");
