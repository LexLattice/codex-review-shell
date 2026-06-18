#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { DirectHeadlessBridgeDaemon } = require("../src/main/direct/headless/bridge-daemon.js");
const { DirectHeadlessTextRuntime } = require("../src/main/direct/headless/text-runtime.js");

const TOKEN = "fixture-token";

function nowIso() {
  return new Date().toISOString();
}

function fixtureConfig(rootDir) {
  return {
    rootDir,
    host: "127.0.0.1",
    port: 0,
    clients: [{
      clientId: "affordance_client",
      status: "active",
      authMode: "capability_token",
      capabilityToken: TOKEN,
      allowedIngressContracts: ["headless_text_event@1"],
      allowedRoutes: ["route_text"],
    }],
    workThreads: [{
      workThreadId: "wt_affordance",
      status: "active",
      projectId: "project_affordance",
    }],
    routes: [{
      routeId: "route_text",
      routeVersion: "v1",
      status: "active",
      ingressContractRef: "headless_text_event@1",
      workThreadId: "wt_affordance",
      targetThreadRef: {
        runtimePath: "direct-text",
        threadId: "direct_session_headless_affordance",
      },
      contextPolicyRef: "direct_text_turn_empty_context@1",
      modelPolicyRef: "fixture-model-policy",
      outputReducerRef: "terminal-result-only",
      authorityBoundaryRef: "headless-affordance-no-tools",
      toolAuthorityMode: "disabled",
    }],
  };
}

class FixtureSessionStore {
  constructor() {
    this.sessions = new Map();
    this.turns = new Map();
  }

  readTurn(sessionId, turnId) {
    return this.turns.get(`${sessionId}:${turnId}`) || null;
  }
}

class FixtureDirectTextController {
  constructor(delayMs = 100) {
    this.delayMs = delayMs;
    this.activeRuns = new Map();
    this.sessionStore = new FixtureSessionStore();
    this.turnOrdinal = 0;
  }

  startThread(params = {}) {
    const id = params.sessionId || params.threadId;
    if (!this.sessionStore.sessions.has(id)) {
      this.sessionStore.sessions.set(id, {
        id,
        sessionId: id,
        title: params.title || "fixture headless affordance",
      });
    }
    return { thread: { id }, model: params.model || "gpt-5.5" };
  }

  async startTurn(params = {}) {
    const sessionId = params.sessionId || params.threadId;
    const turnId = `turn_${String(++this.turnOrdinal).padStart(3, "0")}`;
    const turn = {
      turnId,
      id: turnId,
      state: "streaming",
      status: "inProgress",
      promptText: params.promptText,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    this.sessionStore.turns.set(`${sessionId}:${turnId}`, turn);
    const promise = new Promise((resolve) => {
      setTimeout(() => {
        const completed = {
          ...turn,
          state: "completed",
          status: "completed",
          updatedAt: nowIso(),
        };
        this.sessionStore.turns.set(`${sessionId}:${turnId}`, completed);
        this.activeRuns.delete(turnId);
        resolve({ turn: completed });
      }, this.delayMs);
    });
    this.activeRuns.set(turnId, { promise });
    return { turn, reused: false };
  }
}

async function requestJson(baseUrl, pathName, options = {}) {
  const response = await fetch(`${baseUrl}${pathName}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${TOKEN}`,
      ...(options.headers || {}),
    },
  });
  return { response, body: await response.json() };
}

async function command(baseUrl, body = {}, options = {}) {
  return requestJson(baseUrl, "/v1/bridge/affordance-commands", {
    method: "POST",
    body: JSON.stringify({
      clientId: "affordance_client",
      requestedRouteId: "route_text",
      routeVersion: "v1",
      workThreadId: "wt_affordance",
      ...body,
    }),
    ...options,
  });
}

async function waitForPacket(baseUrl, packetId, predicate, label) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const result = await requestJson(baseUrl, `/v1/bridge/turn-packets/${encodeURIComponent(packetId)}`);
    assert.equal(result.response.status, 200);
    if (predicate(result.body.packet)) return result.body.packet;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "direct-headless-affordance-"));
const controller = new FixtureDirectTextController(150);
const daemon = new DirectHeadlessBridgeDaemon(fixtureConfig(rootDir));
const textRuntime = new DirectHeadlessTextRuntime({
  store: daemon.store,
  controller,
  project: {
    id: "project_affordance",
    name: "Affordance fixture",
  },
});
daemon.textRuntime = textRuntime;

try {
  const address = await daemon.listen();
  const baseUrl = `http://${address.host}:${address.port}`;

  const status = await command(baseUrl, {
    commandKind: "read_bridge_status",
    commandId: "cmd_status",
  });
  assert.equal(status.response.status, 202);
  assert.equal(status.body.ok, true);
  assert.equal(status.body.schema, "headless_affordance_command_result@1");
  assert.equal(status.body.result.schema, "bridge_daemon_status_projection@1");
  assert.equal(status.body.rawPayloadIncluded, false);
  assert.equal(status.body.authorityDecision.status, "allowed");

  const first = await command(baseUrl, {
    commandKind: "submit_text_turn",
    commandId: "cmd_submit_1",
    idempotencyKey: "affordance-turn-1",
    text: "first affordance turn",
    model: "gpt-5.5",
    reasoningEffort: "medium",
  });
  assert.equal(first.response.status, 202);
  assert.equal(first.body.ok, true);
  assert.equal(first.body.status, "accepted");
  assert.equal(first.body.result.turnPacket.schema, "headless_turn_packet@1");
  assert.equal(first.body.result.turnPacket.promptText, undefined);
  assert.equal(first.body.result.turnPacket.promptChars, "first affordance turn".length);
  assert.equal(first.body.result.turnPacket.rawPromptIncluded, false);
  assert.equal(first.body.result.turnPacket.rawProviderPayloadIncluded, false);

  const second = await command(baseUrl, {
    commandKind: "queue_text_turn",
    commandId: "cmd_queue_2",
    idempotencyKey: "affordance-turn-2",
    text: "second affordance turn",
  });
  assert.equal(second.response.status, 202);
  assert.equal(second.body.ok, true);
  assert.equal(second.body.result.queued, true);
  assert.equal(second.body.result.turnPacket.state, "queued");
  assert.equal(second.body.result.turnPacket.promptText, undefined);

  const readPacket = await command(baseUrl, {
    commandKind: "read_turn_packet",
    commandId: "cmd_read_packet",
    target: {
      packetId: first.body.result.turnPacket.packetId,
    },
  });
  assert.equal(readPacket.response.status, 202);
  assert.equal(readPacket.body.result.promptText, undefined);
  assert.equal(readPacket.body.result.promptDigest.startsWith("sha256:"), true);

  const steer = await command(baseUrl, {
    commandKind: "steer_text_turn",
    commandId: "cmd_steer",
    text: "steer the active turn",
  });
  assert.equal(steer.response.status, 400);
  assert.equal(steer.body.ok, false);
  assert.equal(steer.body.blockerCode, "steer_not_supported_by_headless_runtime");
  assert.equal(steer.body.authorityDecision.status, "blocked");
  assert.equal(steer.body.providerRequestStarted, false);

  const stop = await command(baseUrl, {
    commandKind: "stop_active_turn",
    commandId: "cmd_stop",
    target: {
      threadId: "direct_session_headless_affordance",
    },
  });
  assert.equal(stop.response.status, 400);
  assert.equal(stop.body.blockerCode, "stop_not_supported_by_headless_runtime");
  assert.equal(stop.body.providerRequestStarted, false);

  const firstTerminal = await waitForPacket(
    baseUrl,
    first.body.result.turnPacket.packetId,
    (packet) => packet.state === "provider_completed",
    "first affordance turn completion",
  );
  assert.equal(firstTerminal.providerCompleted, true);

  const secondTerminal = await waitForPacket(
    baseUrl,
    second.body.result.turnPacket.packetId,
    (packet) => packet.state === "provider_completed",
    "second affordance turn completion",
  );
  assert.equal(secondTerminal.providerCompleted, true);

  const pause = await command(baseUrl, {
    commandKind: "pause_intake",
    commandId: "cmd_pause",
  });
  assert.equal(pause.response.status, 202);
  assert.equal(pause.body.result.control.intakeState, "paused");
  assert.equal(pause.body.result.routeAuthorityMutable, false);
  assert.equal(pause.body.result.providerRequestStarted, false);

  const blockedSubmit = await command(baseUrl, {
    commandKind: "submit_text_turn",
    commandId: "cmd_submit_paused",
    idempotencyKey: "affordance-turn-paused",
    text: "blocked while paused",
  });
  assert.equal(blockedSubmit.response.status, 400);
  assert.equal(blockedSubmit.body.blockerCode, "intake_paused");

  const resume = await command(baseUrl, {
    commandKind: "resume_intake",
    commandId: "cmd_resume",
  });
  assert.equal(resume.response.status, 202);
  assert.equal(resume.body.result.control.intakeState, "accepting");

  const unauthenticated = await requestJson(baseUrl, "/v1/bridge/affordance-commands", {
    method: "POST",
    body: JSON.stringify({
      clientId: "affordance_client",
      commandKind: "read_bridge_status",
    }),
    headers: {
      authorization: "Bearer wrong-token",
    },
  });
  assert.equal(unauthenticated.response.status, 401);
  assert.equal(unauthenticated.body.status, "affordance_blocked");
  assert.equal(unauthenticated.body.error, "client_auth_failed");

  console.log(JSON.stringify({
    ok: true,
    regression: "direct-headless-affordance-command-surface",
    firstPacket: first.body.result.turnPacket.packetId,
    secondPacket: second.body.result.turnPacket.packetId,
    unsupported: [steer.body.blockerCode, stop.body.blockerCode],
  }, null, 2));
} finally {
  await daemon.close();
  await fs.rm(rootDir, { recursive: true, force: true });
}
