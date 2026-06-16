#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { DirectHeadlessBridgeDaemon } = require("../src/main/direct/headless/bridge-daemon.js");
const {
  assertDirectSettingsSurfaceRendererSafe,
  buildDirectSettingsSurfaceProjection,
} = require("../src/main/direct/ui/settings-surface.js");

const TOKEN = "fixture-token";

function fixtureConfig(rootDir) {
  return {
    rootDir,
    host: "127.0.0.1",
    port: 0,
    clients: [{
      clientId: "control_client",
      displayLabel: "Control fixture client",
      clientKind: "fixture",
      status: "active",
      authMode: "capability_token",
      capabilityToken: TOKEN,
      allowedIngressContracts: ["diagnostic_event@1"],
      allowedRoutes: ["route_diag"],
    }],
    workThreads: [{
      workThreadId: "wt_control",
      status: "active",
      projectId: "project_control",
    }],
    routes: [{
      routeId: "route_diag",
      routeVersion: "v1",
      status: "active",
      ingressContractRef: "diagnostic_event@1",
      workThreadId: "wt_control",
      targetThreadRef: {
        runtimePath: "direct-text",
        threadId: "direct_session_control",
      },
      contextPolicyRef: "fixture_context",
      modelPolicyRef: "fixture_model",
      outputReducerRef: "fixture_reducer",
      authorityBoundaryRef: "fixture_authority",
      toolAuthorityMode: "disabled",
    }],
  };
}

function event(idempotencyKey) {
  return {
    clientId: "control_client",
    idempotencyKey,
    eventSchema: "diagnostic_event@1",
    eventClass: "diagnostic",
    eventKind: "ping",
    sourceSystem: "fixture",
    requestedRouteId: "route_diag",
    facts: {
      message: "control surface regression",
    },
  };
}

async function requestJson(baseUrl, pathName, options = {}) {
  const response = await fetch(`${baseUrl}${pathName}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {}),
    },
  });
  return { response, body: await response.json() };
}

async function control(baseUrl, action, extra = {}) {
  return requestJson(baseUrl, "/v1/bridge/control", {
    method: "POST",
    body: JSON.stringify({
      clientId: "control_client",
      action,
      ...extra,
    }),
    headers: {
      authorization: `Bearer ${TOKEN}`,
    },
  });
}

async function submitEvent(baseUrl, body) {
  return requestJson(baseUrl, "/v1/bridge/events", {
    method: "POST",
    body: JSON.stringify(body),
    headers: {
      authorization: `Bearer ${TOKEN}`,
    },
  });
}

const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "direct-headless-control-"));
const daemon = new DirectHeadlessBridgeDaemon(fixtureConfig(rootDir));

try {
  const address = await daemon.listen();
  const baseUrl = `http://${address.host}:${address.port}`;

  const initial = await requestJson(baseUrl, "/v1/bridge/status");
  assert.equal(initial.response.status, 200);
  assert.equal(initial.body.schema, "bridge_daemon_status_projection@1");
  assert.equal(initial.body.control.intakeState, "accepting");
  assert.equal(initial.body.control.drainState, "idle");
  assert.equal(initial.body.control.providerTransportAllowed, false);
  assert.deepEqual(initial.body.control.safeControls, ["pause_intake", "resume_intake", "drain", "shutdown"]);

  const settingsProjection = buildDirectSettingsSurfaceProjection({
    projectId: "project_control",
    headlessDaemonStatus: initial.body,
  });
  assertDirectSettingsSurfaceRendererSafe(settingsProjection);
  assert.equal(settingsProjection.sections.headlessDaemon.available, true);
  assert.equal(settingsProjection.sections.headlessDaemon.intakeState, "accepting");
  assert.equal(settingsProjection.rows.headlessDaemon.at(-1).value, "daemon-local only");

  const unauthenticated = await requestJson(baseUrl, "/v1/bridge/control", {
    method: "POST",
    body: JSON.stringify({ clientId: "unknown_client", action: "pause_intake" }),
  });
  assert.equal(unauthenticated.response.status, 401);
  assert.equal(unauthenticated.body.status, "control_blocked");
  assert.equal(unauthenticated.body.error, "unknown_client");

  const paused = await control(baseUrl, "pause_intake");
  assert.equal(paused.response.status, 202);
  assert.equal(paused.body.ok, true);
  assert.equal(paused.body.control.intakeState, "paused");
  assert.equal(paused.body.routeAuthorityMutable, false);
  assert.equal(paused.body.providerRequestStarted, false);

  const blockedWhilePaused = await submitEvent(baseUrl, event("paused-event"));
  assert.equal(blockedWhilePaused.response.status, 400);
  assert.equal(blockedWhilePaused.body.status, "blocked_ingress");
  assert.equal(blockedWhilePaused.body.error, "intake_paused");

  const resumed = await control(baseUrl, "resume_intake");
  assert.equal(resumed.response.status, 202);
  assert.equal(resumed.body.control.intakeState, "accepting");

  const accepted = await submitEvent(baseUrl, event("accepted-after-resume"));
  assert.equal(accepted.response.status, 202);
  assert.equal(accepted.body.status, "route_resolved");

  const draining = await control(baseUrl, "drain");
  assert.equal(draining.response.status, 202);
  assert.equal(draining.body.control.intakeState, "paused");
  assert.equal(draining.body.control.drainState, "draining");

  const blockedWhileDraining = await submitEvent(baseUrl, event("draining-event"));
  assert.equal(blockedWhileDraining.response.status, 400);
  assert.equal(blockedWhileDraining.body.error, "daemon_draining");

  const shutdown = await control(baseUrl, "shutdown");
  assert.equal(shutdown.response.status, 202);
  assert.equal(shutdown.body.status, "shutdown_requested");
  assert.equal(shutdown.body.control.shutdownState, "requested");

  const finalStatus = await requestJson(baseUrl, "/v1/bridge/status");
  assert.equal(finalStatus.body.control.recentEvents.length >= 4, true);
  assert.equal(finalStatus.body.providerRequestsStarted, 0);
  assert.equal(finalStatus.body.rawPayloadsExposed, false);

  console.log(JSON.stringify({
    ok: true,
    regression: "direct-headless-control-surface",
    controls: finalStatus.body.control.safeControls,
    recentControlEvents: finalStatus.body.control.recentEvents.length,
  }, null, 2));
} finally {
  await daemon.close().catch(() => {});
  await fs.rm(rootDir, { recursive: true, force: true });
}
