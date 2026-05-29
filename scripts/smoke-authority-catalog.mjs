import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  CODEX_SURFACE_BRIDGE_PROFILES,
  CODEX_SURFACE_TRUST_PROFILES,
  SURFACE_ROLES,
  bridgeProfileForTrustProfile,
  codexSurfaceAuthorityForTarget,
  hasFullCodexBridge,
  isAllowedCodexClientNotificationMethod,
  isAllowedCodexClientRequestMethod,
  publicAuthorityCatalog,
  trustProfileForCodexTarget,
} = require("../src/main/authority-catalog.js");

const catalog = publicAuthorityCatalog();

assert.equal(catalog.schemaVersion, 1);
assert.ok(catalog.ipcChannelContracts.some((row) => row.channel === "codex-surface:connect"));
assert.ok(catalog.ipcChannelContracts.some((row) => row.channel === "workspace:run-command"));

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

console.log("authority-catalog:smoke passed");
