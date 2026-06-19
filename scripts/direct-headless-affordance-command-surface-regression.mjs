#!/usr/bin/env node

import assert from "node:assert/strict";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { DirectHeadlessBridgeDaemon } = require("../src/main/direct/headless/bridge-daemon.js");
const { DirectHeadlessTextRuntime } = require("../src/main/direct/headless/text-runtime.js");
const {
  normalizeCommand,
  sanitizeBridgeResult,
  sanitizeTurnPacket,
} = require("../src/main/direct/headless/affordance-command-surface.js");

const TOKEN = "fixture-token";

function writableTmpDir() {
  for (const candidate of [process.env.CODEX_DIRECT_TEST_TMPDIR, process.env.TMPDIR, os.tmpdir(), "/tmp"].filter(Boolean)) {
    try {
      fsSync.mkdirSync(candidate, { recursive: true });
      fsSync.accessSync(candidate, fsSync.constants.W_OK);
      return candidate;
    } catch {
      // Try the next candidate.
    }
  }
  return os.tmpdir();
}

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
      allowedRoutes: ["route_text", "route_impl", "route_impl_unsafe_auto", "route_bad_runtime"],
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
    }, {
      routeId: "route_impl",
      routeVersion: "v1",
      status: "active",
      ingressContractRef: "headless_text_event@1",
      workThreadId: "wt_affordance",
      targetThreadRef: {
        runtimePath: "direct-implementation",
        threadId: "direct_session_headless_impl_affordance",
      },
      contextPolicyRef: "direct_implementation_turn_empty_context@1",
      modelPolicyRef: "fixture-model-policy",
      outputReducerRef: "terminal-result-only",
      authorityBoundaryRef: "headless-affordance-implementation-disabled-tools",
      toolAuthorityMode: "disabled",
      headlessImplementationPolicy: {
        autoDecisionMode: "disabled",
        disposableWorkspace: false,
        allowedMethods: [],
        maxAutoDecisions: 0,
      },
    }, {
      routeId: "route_impl_unsafe_auto",
      routeVersion: "v1",
      status: "active",
      ingressContractRef: "headless_text_event@1",
      workThreadId: "wt_affordance",
      targetThreadRef: {
        runtimePath: "direct-implementation",
        threadId: "direct_session_headless_impl_unsafe",
      },
      contextPolicyRef: "direct_implementation_turn_empty_context@1",
      modelPolicyRef: "fixture-model-policy",
      outputReducerRef: "terminal-result-only",
      authorityBoundaryRef: "headless-affordance-implementation-unsafe-auto",
      toolAuthorityMode: "limited",
      headlessImplementationPolicy: {
        autoDecisionMode: "approve",
        disposableWorkspace: false,
        allowedMethods: ["direct/tool/readOnly/requestApproval"],
        maxAutoDecisions: 1,
      },
    }, {
      routeId: "route_impl_restricted",
      routeVersion: "v1",
      status: "active",
      ingressContractRef: "headless_text_event@1",
      workThreadId: "wt_affordance",
      targetThreadRef: {
        runtimePath: "direct-implementation",
        threadId: "direct_session_headless_impl_restricted",
      },
      contextPolicyRef: "direct_implementation_turn_empty_context@1",
      modelPolicyRef: "fixture-model-policy",
      outputReducerRef: "terminal-result-only",
      authorityBoundaryRef: "headless-affordance-implementation-restricted",
      toolAuthorityMode: "disabled",
      headlessImplementationPolicy: {
        autoDecisionMode: "disabled",
        disposableWorkspace: false,
        allowedMethods: [],
        maxAutoDecisions: 0,
      },
    }, {
      routeId: "route_bad_runtime",
      routeVersion: "v1",
      status: "active",
      ingressContractRef: "headless_text_event@1",
      workThreadId: "wt_affordance",
      targetThreadRef: {
        runtimePath: "unsupported-runtime",
        threadId: "direct_session_headless_affordance_bad_runtime",
      },
      contextPolicyRef: "direct_text_turn_empty_context@1",
      modelPolicyRef: "fixture-model-policy",
      outputReducerRef: "terminal-result-only",
      authorityBoundaryRef: "headless-affordance-bad-runtime",
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

  statusForProject() {
    return {
      status: "available",
      directAvailable: true,
      implementationLaneAvailable: true,
    };
  }

  async handleRequest(method, params = {}) {
    if (method === "thread/start") return this.startThread(params);
    if (method === "turn/start") return this.startTurn(params);
    const error = new Error(`Unsupported fixture request: ${method}`);
    error.code = "unsupported_fixture_request";
    throw error;
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

const rootDir = await fs.mkdtemp(path.join(writableTmpDir(), "direct-headless-affordance-"));
const controller = new FixtureDirectTextController(150);
const providerBackedSubAgentCalls = [];
const daemon = new DirectHeadlessBridgeDaemon(fixtureConfig(rootDir));
daemon.providerBackedSubAgentRunner = async (request) => {
  providerBackedSubAgentCalls.push(request);
  return {
    ok: true,
    responseId: "resp_headless_child_fixture",
    upstreamRequestId: "upstream_headless_child_fixture",
    outputText: "Headless child completed.",
    tokenUsage: {
      input_tokens: 31,
      cached_input_tokens: 11,
      output_tokens: 7,
      reasoning_output_tokens: 2,
      total_tokens: 38,
    },
  };
};
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
  const epochCommand = normalizeCommand({
    clientId: "affordance_client",
    commandKind: "read_bridge_status",
  }, { nowMs: 0 });
  assert.equal(epochCommand.createdAt, "1970-01-01T00:00:00.000Z");

  const sanitizedPacket = sanitizeTurnPacket({
    packetId: "packet_raw",
    promptText: "secret prompt",
    rawPrompt: "secret raw prompt",
    rawPromptText: "secret raw prompt text",
    rawPayload: "secret payload",
    rawEventPayload: "secret event payload",
    rawProviderPayload: "secret provider payload",
    rawProviderFrame: "secret provider frame",
    rawToolOutput: "secret tool output",
  });
  assert.equal(sanitizedPacket.promptText, undefined);
  assert.equal(sanitizedPacket.rawPrompt, undefined);
  assert.equal(sanitizedPacket.rawEventPayload, undefined);
  assert.equal(sanitizedPacket.rawProviderPayload, undefined);

  const sanitizedResult = sanitizeBridgeResult({
    ok: true,
    rawPayload: "secret payload",
    rawPrompt: "secret prompt",
    rawProviderPayload: "secret provider",
    rawProviderFrame: "secret frame",
    turnPacket: {
      packetId: "packet_nested_raw",
      promptText: "nested secret",
      rawProviderPayload: "nested provider secret",
    },
  });
  assert.equal(sanitizedResult.rawPayload, undefined);
  assert.equal(sanitizedResult.rawPrompt, undefined);
  assert.equal(sanitizedResult.turnPacket.promptText, undefined);
  assert.equal(sanitizedResult.turnPacket.rawProviderPayload, undefined);

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

  const childPrompt = "UNIQUE_HEADLESS_PROVIDER_CHILD_PROMPT_3341";
  const providerChild = await command(baseUrl, {
    commandKind: "spawn_provider_backed_sub_agent",
    commandId: "cmd_provider_child",
    idempotencyKey: "affordance-provider-child-1",
    childAgentId: "headless_provider_child",
    displayLabel: "Headless provider child",
    role: "worker",
    noInterferencePolicy: "sealed_audit",
    text: childPrompt,
    model: "gpt-5.4-mini",
    reasoningEffort: "high",
  });
  assert.equal(providerChild.response.status, 202);
  assert.equal(providerChild.body.ok, true);
  assert.equal(providerChild.body.status, "completed");
  assert.equal(providerChild.body.providerRequestStarted, true);
  assert.equal(providerChild.body.result.agentThreadId, "headless_provider_child");
  assert.equal(providerChild.body.result.requestShape.model, "gpt-5.4-mini");
  assert.equal(providerChild.body.result.requestShape.reasoningEffort, "high");
  assert.equal(providerChild.body.result.requestShape.toolCount, 0);
  assert.equal(providerChild.body.result.tokenUsage.inputTokens, 31);
  assert.equal(providerChild.body.result.tokenUsage.cachedInputTokens, 11);
  assert.equal(providerChild.body.result.usageAttribution, "agent_thread");
  assert(providerChild.body.result.liveToolCatalog.blockedToolIds.includes("vanilla.agent.send_message"));
  assert.equal(providerBackedSubAgentCalls.length, 1);
  assert.equal(providerBackedSubAgentCalls[0].requestBody.model, "gpt-5.4-mini");
  assert.equal(providerBackedSubAgentCalls[0].requestBody.reasoning.effort, "high");
  assert.equal(providerBackedSubAgentCalls[0].requestShape.toolCount, 0);
  assert.equal(JSON.stringify(providerChild.body).includes(childPrompt), false);
  assert.equal(providerChild.body.rawPromptIncluded, false);
  assert.equal(providerChild.body.rawProviderPayloadIncluded, false);

  const duplicateProviderChild = await command(baseUrl, {
    commandKind: "spawn_provider_backed_sub_agent",
    commandId: "cmd_provider_child_duplicate",
    idempotencyKey: "affordance-provider-child-duplicate",
    childAgentId: "headless_provider_child",
    text: "UNIQUE_DUPLICATE_HEADLESS_PROVIDER_CHILD_PROMPT",
  });
  assert.equal(duplicateProviderChild.response.status, 400);
  assert.equal(duplicateProviderChild.body.status, "blocked");
  assert.equal(duplicateProviderChild.body.blockerCode, "duplicate_child_agent_id");
  assert.equal(providerBackedSubAgentCalls.length, 1);
  assert.equal(JSON.stringify(duplicateProviderChild.body).includes("UNIQUE_DUPLICATE_HEADLESS_PROVIDER_CHILD_PROMPT"), false);

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

  const noIdFirst = await command(baseUrl, {
    commandKind: "submit_text_turn",
    text: "first no-id affordance turn",
  });
  const noIdSecond = await command(baseUrl, {
    commandKind: "submit_text_turn",
    text: "second no-id affordance turn",
  });
  assert.equal(noIdFirst.response.status, 202);
  assert.equal(noIdSecond.response.status, 202);
  assert.notEqual(noIdFirst.body.commandId, noIdSecond.body.commandId);
  assert.notEqual(noIdFirst.body.result.turnPacket.packetId, noIdSecond.body.result.turnPacket.packetId);
  await waitForPacket(
    baseUrl,
    noIdFirst.body.result.turnPacket.packetId,
    (packet) => packet.state === "provider_completed",
    "first no-id affordance turn completion",
  );
  await waitForPacket(
    baseUrl,
    noIdSecond.body.result.turnPacket.packetId,
    (packet) => packet.state === "provider_completed",
    "second no-id affordance turn completion",
  );

  const implWrongRoute = await command(baseUrl, {
    commandKind: "submit_implementation_turn",
    commandId: "cmd_impl_wrong_route",
    requestedRouteId: "route_text",
    text: "implementation command on text route",
  });
  assert.equal(implWrongRoute.response.status, 400);
  assert.equal(implWrongRoute.body.status, "blocked");
  assert.equal(implWrongRoute.body.blockerCode, "implementation_command_requires_direct_implementation_route");
  assert.equal(implWrongRoute.body.result.runtimePath, "direct-text");
  assert.equal(implWrongRoute.body.providerRequestStarted, false);

  const impl = await command(baseUrl, {
    commandKind: "submit_implementation_turn",
    commandId: "cmd_impl_submit",
    idempotencyKey: "affordance-implementation-turn-1",
    requestedRouteId: "route_impl",
    text: "implementation affordance turn",
    model: "gpt-5.5",
    reasoningEffort: "low",
  });
  assert.equal(impl.response.status, 202);
  assert.equal(impl.body.ok, true);
  assert.equal(impl.body.status, "accepted");
  assert.equal(impl.body.result.turnPacket.runtimePath, "direct-implementation");
  assert.equal(impl.body.result.turnPacket.headlessImplementationPolicy.toolAuthorityMode, "disabled");
  assert.equal(impl.body.result.turnPacket.headlessImplementationPolicy.autoDecisionMode, "disabled");
  assert.equal(impl.body.result.turnPacket.promptText, undefined);
  const implTerminal = await waitForPacket(
    baseUrl,
    impl.body.result.turnPacket.packetId,
    (packet) => packet.state === "provider_completed",
    "implementation affordance turn completion",
  );
  assert.equal(implTerminal.providerCompleted, true);
  assert.equal(implTerminal.runtimePath, "direct-implementation");

  const implUnsafe = await command(baseUrl, {
    commandKind: "submit_implementation_turn",
    commandId: "cmd_impl_unsafe_auto",
    idempotencyKey: "affordance-implementation-unsafe-auto",
    requestedRouteId: "route_impl_unsafe_auto",
    text: "implementation unsafe auto approval",
  });
  assert.equal(implUnsafe.response.status, 400);
  assert.equal(implUnsafe.body.status, "blocked");
  assert.equal(implUnsafe.body.blockerCode, "headless_implementation_auto_approval_requires_disposable_workspace");
  assert.equal(implUnsafe.body.result.turnPacket.runtimePath, "direct-implementation");
  assert.equal(implUnsafe.body.result.turnPacket.headlessImplementationPolicy.autoDecisionMode, "approve");
  assert.equal(implUnsafe.body.result.turnPacket.headlessImplementationPolicy.disposableWorkspace, false);
  assert.equal(implUnsafe.body.providerRequestStarted, false);

  const implRestricted = await command(baseUrl, {
    commandKind: "submit_implementation_turn",
    commandId: "cmd_impl_restricted",
    idempotencyKey: "affordance-implementation-restricted",
    requestedRouteId: "route_impl_restricted",
    text: "implementation restricted route",
  });
  assert.equal(implRestricted.response.status, 400);
  assert.equal(implRestricted.body.status, "blocked");
  assert.equal(implRestricted.body.blockerCode, "route_not_allowed_for_client");
  assert.equal(implRestricted.body.providerRequestStarted, false);
  assert.equal(implRestricted.body.result.status, "route_blocked");
  assert.equal(implRestricted.body.result.route, undefined);
  assert.equal(JSON.stringify(implRestricted.body).includes("direct_session_headless_impl_restricted"), false);
  assert.equal(JSON.stringify(implRestricted.body).includes("direct-implementation"), false);

  const badRuntime = await command(baseUrl, {
    commandKind: "submit_text_turn",
    commandId: "cmd_bad_runtime",
    idempotencyKey: "affordance-bad-runtime",
    requestedRouteId: "route_bad_runtime",
    text: "blocked unsupported runtime",
  });
  assert.equal(badRuntime.response.status, 400);
  assert.equal(badRuntime.body.ok, false);
  assert.equal(badRuntime.body.status, "blocked");
  assert.equal(badRuntime.body.blockerCode, "unsupported_runtime_path");
  assert.equal(badRuntime.body.authorityDecision.status, "blocked");
  assert.equal(badRuntime.body.result.turnPacket.state, "failed");
  assert.equal(badRuntime.body.result.turnPacket.promptText, undefined);

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
  try {
    await daemon.close();
  } catch (error) {
    if (error?.code !== "ERR_SERVER_NOT_RUNNING") throw error;
  }
  await fs.rm(rootDir, { recursive: true, force: true });
}
