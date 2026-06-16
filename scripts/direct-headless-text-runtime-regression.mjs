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
      clientId: "runtime_client",
      status: "active",
      authMode: "capability_token",
      capabilityToken: TOKEN,
      allowedIngressContracts: ["headless_text_event@1"],
      allowedRoutes: ["route_text"],
    }],
    workThreads: [{
      workThreadId: "wt_runtime",
      status: "active",
      projectId: "project_runtime",
    }],
    routes: [{
      routeId: "route_text",
      routeVersion: "v1",
      status: "active",
      ingressContractRef: "headless_text_event@1",
      workThreadId: "wt_runtime",
      targetThreadRef: {
        runtimePath: "direct-text",
        threadId: "direct_session_headless_text",
      },
      contextPolicyRef: "direct_text_turn_empty_context@1",
      modelPolicyRef: "fixture-model-policy",
      outputReducerRef: "terminal-result-only",
      authorityBoundaryRef: "headless-text-no-tools",
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
  constructor(delayMs = 50) {
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
        title: params.title || "fixture headless direct text",
      });
    }
    return { thread: { id }, model: "gpt-5.5" };
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

function event(idempotencyKey, text) {
  return {
    clientId: "runtime_client",
    idempotencyKey,
    eventSchema: "headless_text_event@1",
    eventClass: "operator_message",
    eventKind: "direct_text",
    sourceSystem: "fixture",
    requestedRouteId: "route_text",
    text,
  };
}

const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "direct-headless-text-runtime-"));
const controller = new FixtureDirectTextController(120);
const daemon = new DirectHeadlessBridgeDaemon({
  ...fixtureConfig(rootDir),
});
const textRuntime = new DirectHeadlessTextRuntime({
  store: daemon.store,
  controller,
  project: {
    id: "project_runtime",
    name: "Runtime fixture",
  },
});
daemon.textRuntime = textRuntime;

try {
  const address = await daemon.listen();
  const baseUrl = `http://${address.host}:${address.port}`;

  const first = await requestJson(baseUrl, "/v1/bridge/events", {
    method: "POST",
    body: JSON.stringify(event("turn-1", "first headless text turn")),
  });
  assert.equal(first.response.status, 202);
  assert.equal(first.body.ok, true);
  assert.equal(first.body.turnPacket.schema, "headless_turn_packet@1");
  assert.equal(first.body.turnPacket.runtimePath, "direct-text");
  assert.equal(first.body.turnPacket.rawEventPayloadIncluded, false);

  const second = await requestJson(baseUrl, "/v1/bridge/events", {
    method: "POST",
    body: JSON.stringify(event("turn-2", "second headless text turn")),
  });
  assert.equal(second.response.status, 202);
  assert.equal(second.body.ok, true);
  assert.equal(second.body.queued, true);
  assert.equal(second.body.turnPacket.state, "queued");

  const firstTerminal = await waitForPacket(
    baseUrl,
    first.body.turnPacket.packetId,
    (packet) => packet.state === "provider_completed",
    "first provider completion",
  );
  assert.equal(firstTerminal.providerCompleted, true);
  assert.equal(firstTerminal.replayState, "replay_unsafe");
  assert.equal(firstTerminal.terminalTurnState, "completed");

  const secondTerminal = await waitForPacket(
    baseUrl,
    second.body.turnPacket.packetId,
    (packet) => packet.state === "provider_completed",
    "second provider completion",
  );
  assert.equal(secondTerminal.providerCompleted, true);
  assert.equal(secondTerminal.terminalTurnState, "completed");

  const duplicate = await requestJson(baseUrl, "/v1/bridge/events", {
    method: "POST",
    body: JSON.stringify(event("turn-1", "first headless text turn")),
  });
  assert.equal(duplicate.response.status, 202);
  assert.equal(duplicate.body.duplicate, true);

  const status = await requestJson(baseUrl, "/v1/bridge/status");
  assert.equal(status.response.status, 200);
  assert.equal(status.body.textRuntime.activeTurns, 0);
  assert.equal(status.body.textRuntime.queuedTurns, 0);
  assert.equal(status.body.turnPackets.total, 2);
  assert.equal(status.body.turnPackets.byState.provider_completed, 2);
  assert.equal(status.body.providerRequestsStarted, 0);
  assert.equal(status.body.rawPayloadsExposed, false);
} finally {
  await daemon.close();
  await fs.rm(rootDir, { recursive: true, force: true });
}

console.log("direct-headless-text-runtime regression passed");
