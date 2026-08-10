#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { WebSocketServer } = require("ws");
const { buildRuntimeCapabilityProfile } = require("../src/main/codex-app-server");
const { CodexSurfaceSession } = require("../src/main/codex-surface-session");
const { codexClientRequestDecision } = require("../src/main/authority-catalog");
const {
  environmentStateFromNotification,
  environmentStateFromStatus,
  normalizeAppEvidence,
  normalizeNotificationEnvelope,
  normalizeThreadDirectInput,
} = require("../src/renderer/codex-app-server-evidence");

const emittedAtMs = 1_795_000_000_123;
const receivedAtMs = emittedAtMs + 37;
const normalizedEnvelope = normalizeNotificationEnvelope({
  method: "thread/environment/connected",
  params: { threadId: "thread_145", environmentId: "environment_wsl" },
  emittedAtMs,
}, receivedAtMs);
assert.equal(normalizedEnvelope.emittedAtMs, emittedAtMs);
assert.equal(normalizedEnvelope.receivedAtMs, receivedAtMs);
assert.equal(normalizedEnvelope.observedAt, new Date(emittedAtMs).toISOString());
const receiptOnlyEnvelope = normalizeNotificationEnvelope({ method: "warning", params: {} }, receivedAtMs);
assert.equal(receiptOnlyEnvelope.emittedAtMs, null);
assert.equal(receiptOnlyEnvelope.emittedAt, "");
assert.equal(receiptOnlyEnvelope.observedAt, new Date(receivedAtMs).toISOString());

assert.deepEqual(normalizeThreadDirectInput({}), {
  status: "legacy_unreported",
  canAcceptDirectInput: null,
  capabilityReported: false,
  allowsMutation: true,
  evidenceSource: "legacy_compatibility_fallback",
});
assert.equal(normalizeThreadDirectInput({ canAcceptDirectInput: true }).allowsMutation, true);
assert.equal(normalizeThreadDirectInput({ canAcceptDirectInput: false }).status, "rejected");
assert.equal(normalizeThreadDirectInput({ canAcceptDirectInput: false }).allowsMutation, false);
assert.equal(normalizeThreadDirectInput({ canAcceptDirectInput: null }).status, "unknown");
assert.equal(normalizeThreadDirectInput({ canAcceptDirectInput: null }).allowsMutation, false);

const connected = environmentStateFromNotification(
  normalizedEnvelope.method,
  normalizedEnvelope.params,
  normalizedEnvelope,
);
assert.equal(connected.status, "ready");
assert.equal(connected.environmentId, "environment_wsl");
assert.equal(connected.observedAt, new Date(emittedAtMs).toISOString());
const disconnected = environmentStateFromStatus("environment_wsl", {
  status: "disconnected",
  error: "exec-server unavailable",
}, { threadId: "thread_145", receivedAtMs });
assert.equal(disconnected.status, "disconnected");
assert.equal(disconnected.error, "exec-server unavailable");
assert.equal(codexClientRequestDecision("environment/status", {
  environment: { canReadStatus: true },
}).ok, true);
assert.equal(codexClientRequestDecision("environment/status", {
  environment: { canReadStatus: false },
}).reason, "capability_not_declared");
assert.equal(buildRuntimeCapabilityProfile({ status: "ready" }).environment.canReadStatus, true);
assert.equal(buildRuntimeCapabilityProfile({ status: "starting" }).environment.canReadStatus, false);

const appEvidence = normalizeAppEvidence({
  apps: [
    { id: "app_enabled", runtimeName: "enabled_runtime", enabled: true, callable: true },
    { id: "app_disabled", runtimeName: "disabled_runtime", enabled: true, callable: false },
    { id: "app_enabled", runtimeName: "duplicate", enabled: false, callable: false },
  ],
}, {
  apps: [
    {
      id: "app_enabled",
      name: "Enabled App",
      description: "x".repeat(500),
      pluginDisplayNames: ["Plugin", "Plugin"],
      toolSummaries: [{ name: "search", title: "Search", description: "Display metadata only" }],
    },
    {
      id: "metadata_only",
      name: "Metadata Only",
      toolSummaries: [{ name: "read", title: "Read", description: "Still not authority" }],
    },
  ],
  missingAppIds: ["app_disabled", "app_disabled"],
}, { threadId: "thread_145", observedAtMs: receivedAtMs });
assert.equal(appEvidence.schema, "codex_app_evidence_snapshot@1");
assert.equal(appEvidence.installedCount, 2);
assert.equal(appEvidence.enabledCount, 2);
assert.equal(appEvidence.callableCount, 1);
assert.equal(appEvidence.metadataCount, 2);
assert.equal(appEvidence.toolSummaryCount, 2);
assert.deepEqual(appEvidence.missingAppIds, ["app_disabled"]);
assert.equal(appEvidence.actionAuthorityGranted, false);
assert.equal(appEvidence.providerToolDeclarationGranted, false);
assert.equal(appEvidence.apps[0].installedEvidence, true);
assert.equal(appEvidence.apps[0].description.length, 320);
assert.deepEqual(appEvidence.apps[0].pluginDisplayNames, ["Plugin"]);
assert.equal(appEvidence.apps[0].toolSummaries[0].displayOnly, true);
assert.equal(appEvidence.apps[0].toolSummaries[0].actionAuthorityGranted, false);
assert.equal(appEvidence.apps.at(-1).installedEvidence, false);
assert.equal(codexClientRequestDecision("app/installed", {
  apps: { canReadInstalled: true },
}).ok, true);
assert.equal(codexClientRequestDecision("app/read", {
  apps: { canReadMetadata: false },
}).reason, "capability_not_declared");
const appCapabilities = buildRuntimeCapabilityProfile({ status: "ready" }).apps;
assert.equal(appCapabilities.canReadInstalled, true);
assert.equal(appCapabilities.canReadMetadata, true);
assert.equal(appCapabilities.metadataToolSummariesDisplayOnly, true);
assert.equal(appCapabilities.actionAuthorityGranted, false);

const server = new WebSocketServer({ port: 0 });
await new Promise((resolve) => server.once("listening", resolve));
const port = server.address().port;
server.on("connection", (socket) => {
  socket.send(JSON.stringify({
    jsonrpc: "2.0",
    method: "thread/environment/connected",
    params: { threadId: "thread_145", environmentId: "environment_wsl" },
    emittedAtMs,
  }));
});

const capturedLedgerNotifications = [];
const usageLedger = {
  start: async () => {},
  close: async () => {},
  captureConnectionClosed: async () => {},
  captureNotification: async (...args) => capturedLedgerNotifications.push(args),
};
const session = new CodexSurfaceSession({ isDestroyed: () => true }, { usageLedger });
const notificationPromise = new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("Timed out waiting for release-145 notification evidence.")), 2_000);
  session.on("event", (event) => {
    if (event.type !== "rpc-notification") return;
    clearTimeout(timer);
    resolve(event);
  });
});
await session.connect({ wsUrl: `ws://127.0.0.1:${port}`, projectId: "release_145_evidence" });
const notification = await notificationPromise;
assert.equal(notification.method, "thread/environment/connected");
assert.equal(notification.emittedAtMs, emittedAtMs);
assert.equal(notification.emittedAt, new Date(emittedAtMs).toISOString());
assert(Number.isFinite(notification.receivedAtMs));
assert(notification.receivedAt);
assert.equal(capturedLedgerNotifications.length, 1);
assert.equal(capturedLedgerNotifications[0][2].emittedAtMs, emittedAtMs);

const rendererSource = fs.readFileSync(new URL("../src/renderer/codex-surface.js", import.meta.url), "utf8");
const rendererHtml = fs.readFileSync(new URL("../src/renderer/codex-surface.html", import.meta.url), "utf8");
assert(rendererSource.includes("assertThreadAcceptsDirectInput();"), "renderer mutation paths must enforce direct-input eligibility");
assert(rendererSource.includes('rpc("environment/status", { environmentId })'), "renderer must probe explicit environment status");
assert(rendererSource.includes("environmentStateFromNotification"), "renderer must consume environment lifecycle notifications");
assert(rendererSource.includes('rpc("app/installed"'), "renderer must read effective installed app state");
assert(rendererSource.includes('rpc("app/read"'), "renderer must read bounded app metadata");
assert(
  rendererSource.includes("forceRefetch: options.forceRefresh === true"),
  "explicit app evidence refreshes must send the protocol forceRefetch field",
);
assert(
  !rendererSource.includes("forceRefresh: options.forceRefresh === true"),
  "renderer must not send its internal forceRefresh option as a protocol field",
);
assert(rendererSource.includes("includeTools: options.includeTools === true"), "tool summaries must remain opt-in");
assert(rendererSource.includes("requestId !== state.appEvidenceRequestId"), "stale app reads must not overwrite newer thread evidence");
assert(
  rendererSource.includes("state.appEvidence?.threadId !== threadId"),
  "thread changes must invalidate evidence from the prior thread before refresh",
);
assert(
  rendererSource.includes("if (requestId !== state.appEvidenceRequestId) return null;\n    state.appEvidence = null;\n    state.appEvidenceStatus = \"failed\";"),
  "failed app evidence refreshes must clear any retained snapshot",
);
assert(rendererSource.includes('drawerSection("Installed Application Evidence"'), "capability drawer must render app evidence");
assert(rendererSource.includes('["action authority", appSnapshot.actionAuthorityGranted ? "granted" : "not granted"]'), "app evidence must visibly deny action authority by default");
assert(
  rendererHtml.indexOf("codex-app-server-evidence.js") < rendererHtml.indexOf("codex-surface.js"),
  "evidence normalizer must load before the Codex renderer",
);

await session.dispose({ silent: true });
await new Promise((resolve) => server.close(resolve));
console.log("codex-app-server-release-145-evidence-regression: ok");
