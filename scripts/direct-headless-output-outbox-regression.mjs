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
      clientId: "output_client",
      status: "active",
      authMode: "capability_token",
      capabilityToken: TOKEN,
      allowedIngressContracts: ["headless_text_event@1"],
      allowedRoutes: ["route_markdown", "route_human", "route_json"],
    }],
    workThreads: [{
      workThreadId: "wt_output",
      status: "active",
      projectId: "project_output",
    }],
    routes: [
      {
        routeId: "route_markdown",
        routeVersion: "v1",
        status: "active",
        ingressContractRef: "headless_text_event@1",
        workThreadId: "wt_output",
        targetThreadRef: {
          runtimePath: "direct-text",
          threadId: "direct_session_headless_output_markdown",
        },
        contextPolicyRef: "direct_text_turn_empty_context@1",
        modelPolicyRef: "fixture-model-policy",
        outputReducerRef: "markdown_summary_only",
        authorityBoundaryRef: "headless-output-no-tools",
        toolAuthorityMode: "disabled",
      },
      {
        routeId: "route_human",
        routeVersion: "v1",
        status: "active",
        ingressContractRef: "headless_text_event@1",
        workThreadId: "wt_output",
        targetThreadRef: {
          runtimePath: "direct-text",
          threadId: "direct_session_headless_output_human",
        },
        contextPolicyRef: "direct_text_turn_empty_context@1",
        modelPolicyRef: "fixture-model-policy",
        outputReducerRef: "human_review_required",
        outputReducer: {
          reducerMode: "human_review_required",
          reducerId: "human_review_required",
          reducerVersion: "v1",
          promptSummary: "Review the headless assistant result.",
          choices: [
            { choiceId: "accept", label: "Accept", consequenceClass: "informational" },
            { choiceId: "reject", label: "Reject", consequenceClass: "informational" },
          ],
        },
        authorityBoundaryRef: "headless-output-human-review",
        toolAuthorityMode: "disabled",
      },
      {
        routeId: "route_json",
        routeVersion: "v1",
        status: "active",
        ingressContractRef: "headless_text_event@1",
        workThreadId: "wt_output",
        targetThreadRef: {
          runtimePath: "direct-text",
          threadId: "direct_session_headless_output_json",
        },
        contextPolicyRef: "direct_text_turn_empty_context@1",
        modelPolicyRef: "fixture-model-policy",
        outputReducerRef: "json_contract_required",
        authorityBoundaryRef: "headless-output-json-contract",
        toolAuthorityMode: "disabled",
      },
    ],
  };
}

class FixtureSessionStore {
  constructor() {
    this.sessions = new Map();
    this.turns = new Map();
  }

  readSession(sessionId) {
    return this.sessions.get(sessionId) || null;
  }

  writeSession(session) {
    this.sessions.set(session.sessionId || session.id, session);
    return session;
  }

  readTurn(sessionId, turnId) {
    return this.turns.get(`${sessionId}:${turnId}`) || null;
  }
}

class FixtureDirectTextController {
  constructor() {
    this.activeRuns = new Map();
    this.sessionStore = new FixtureSessionStore();
    this.turnOrdinal = 0;
  }

  startThread(params = {}) {
    const id = params.sessionId || params.threadId;
    if (!this.sessionStore.sessions.has(id)) {
      this.sessionStore.writeSession({
        id,
        sessionId: id,
        title: params.title || "fixture output thread",
        model: "gpt-5.5",
        messages: [],
      });
    }
    return { thread: { id }, model: "gpt-5.5" };
  }

  async startTurn(params = {}) {
    const sessionId = params.sessionId || params.threadId;
    const turnId = `turn_${String(++this.turnOrdinal).padStart(3, "0")}`;
    const assistantText = params.promptText.includes("json")
      ? "```json\n{\"status\":\"ok\",\"next\":\"none\"}\n```"
      : params.promptText.includes("human")
        ? "Human review required for this output."
        : "Markdown summary for artifact output.";
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
    const promise = Promise.resolve().then(() => {
      const completed = {
        ...turn,
        state: "completed",
        status: "completed",
        updatedAt: nowIso(),
      };
      const session = this.sessionStore.readSession(sessionId);
      this.sessionStore.writeSession({
        ...session,
        updatedAt: nowIso(),
        status: "completed",
        messages: [
          ...(Array.isArray(session?.messages) ? session.messages.filter((message) => message.id !== turnId) : []),
          {
            id: turnId,
            status: "completed",
            items: [
              { id: `${turnId}_user`, type: "userMessage", turnId, text: params.promptText },
              { id: `${turnId}_assistant`, type: "agentMessage", turnId, text: assistantText },
            ],
          },
        ],
      });
      this.sessionStore.turns.set(`${sessionId}:${turnId}`, completed);
      this.activeRuns.delete(turnId);
      return { turn: completed };
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

function event(idempotencyKey, routeId, text) {
  return {
    clientId: "output_client",
    idempotencyKey,
    eventSchema: "headless_text_event@1",
    eventClass: "operator_message",
    eventKind: "direct_text",
    sourceSystem: "fixture",
    requestedRouteId: routeId,
    text,
  };
}

const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "direct-headless-output-outbox-"));
const artifactRoot = path.join(rootDir, "artifacts");
const controller = new FixtureDirectTextController();
const daemon = new DirectHeadlessBridgeDaemon(fixtureConfig(rootDir));
const runtime = new DirectHeadlessTextRuntime({
  store: daemon.store,
  controller,
  project: {
    id: "project_output",
    name: "Output fixture",
  },
  artifactRoot,
});
daemon.turnRuntime = runtime;

try {
  const address = await daemon.listen();
  const baseUrl = `http://${address.host}:${address.port}`;

  const markdown = await requestJson(baseUrl, "/v1/bridge/events", {
    method: "POST",
    body: JSON.stringify(event("markdown-1", "route_markdown", "make markdown artifact")),
  });
  assert.equal(markdown.response.status, 202);
  const markdownTerminal = await waitForPacket(
    baseUrl,
    markdown.body.turnPacket.packetId,
    (packet) => packet.outputReduction?.reducedResultId,
    "markdown output reduction",
  );
  assert.equal(markdownTerminal.outputReduction.reducerMode, "markdown_summary_only");
  assert.equal(markdownTerminal.outputReduction.reductionStatus, "valid");
  assert(markdownTerminal.outputReduction.writeArtifactActionId);

  const reducedResult = await requestJson(
    baseUrl,
    `/v1/bridge/reduced-results/${encodeURIComponent(markdownTerminal.outputReduction.reducedResultId)}`,
  );
  assert.equal(reducedResult.response.status, 200);
  assert.equal(reducedResult.body.result.rawOutputIncluded, false);
  assert.equal(reducedResult.body.result.sourceOutputDigest.startsWith("sha256:"), true);

  const action = await requestJson(
    baseUrl,
    `/v1/bridge/outbox-actions/${encodeURIComponent(markdownTerminal.outputReduction.writeArtifactActionId)}`,
  );
  assert.equal(action.response.status, 200);
  assert.equal(action.body.action.status, "delivered");
  assert.equal(action.body.action.actionKind, "write_artifact");
  assert.equal(action.body.action.rawPathIncluded, false);
  const artifactText = await fs.readFile(path.join(artifactRoot, action.body.action.artifactRelPath), "utf8");
  assert(artifactText.includes("Markdown summary for artifact output."));

  const human = await requestJson(baseUrl, "/v1/bridge/events", {
    method: "POST",
    body: JSON.stringify(event("human-1", "route_human", "make human decision")),
  });
  assert.equal(human.response.status, 202);
  const humanTerminal = await waitForPacket(
    baseUrl,
    human.body.turnPacket.packetId,
    (packet) => packet.outputReduction?.humanDecisionId,
    "human decision output reduction",
  );
  assert.equal(humanTerminal.outputReduction.reducerMode, "human_review_required");
  assert.equal(humanTerminal.outputReduction.reductionStatus, "needs_human_review");

  const decision = await requestJson(
    baseUrl,
    `/v1/bridge/human-decisions/${encodeURIComponent(humanTerminal.outputReduction.humanDecisionId)}`,
  );
  assert.equal(decision.response.status, 200);
  assert.equal(decision.body.decision.status, "pending");
  assert.equal(decision.body.decision.choices.length, 2);

  const unauthReply = await requestJson(
    baseUrl,
    `/v1/bridge/human-decisions/${encodeURIComponent(humanTerminal.outputReduction.humanDecisionId)}/replies`,
    {
      method: "POST",
      body: JSON.stringify({
        choiceId: "accept",
      }),
    },
  );
  assert.equal(unauthReply.response.status, 401);
  assert.equal(unauthReply.body.error, "unknown_client");

  const reply = await requestJson(
    baseUrl,
    `/v1/bridge/human-decisions/${encodeURIComponent(humanTerminal.outputReduction.humanDecisionId)}/replies`,
    {
      method: "POST",
      body: JSON.stringify({
        clientId: "output_client",
        choiceId: "accept",
        operatorEvidenceKey: "operator:fixture",
        freeTextNote: "This note is context only.",
      }),
    },
  );
  assert.equal(reply.response.status, 202);
  assert.equal(reply.body.status, "replied");
  assert.equal(reply.body.reply.freeTextAuthority, false);

  const invalidReply = await requestJson(
    baseUrl,
    `/v1/bridge/human-decisions/${encodeURIComponent(humanTerminal.outputReduction.humanDecisionId)}/replies`,
    {
      method: "POST",
      body: JSON.stringify({
        clientId: "output_client",
        choiceId: "reject",
      }),
    },
  );
  assert.equal(invalidReply.response.status, 400);
  assert.equal(invalidReply.body.error, "human_decision_closed");

  const json = await requestJson(baseUrl, "/v1/bridge/events", {
    method: "POST",
    body: JSON.stringify(event("json-1", "route_json", "make json contract")),
  });
  assert.equal(json.response.status, 202);
  const jsonTerminal = await waitForPacket(
    baseUrl,
    json.body.turnPacket.packetId,
    (packet) => packet.outputReduction?.reducedResultId,
    "json output reduction",
  );
  assert.equal(jsonTerminal.outputReduction.reducerMode, "json_contract_required");
  assert.equal(jsonTerminal.outputReduction.reductionStatus, "valid");
  const jsonReduced = await requestJson(
    baseUrl,
    `/v1/bridge/reduced-results/${encodeURIComponent(jsonTerminal.outputReduction.reducedResultId)}`,
  );
  assert.equal(jsonReduced.response.status, 200);
  assert.equal(jsonReduced.body.result.jsonContractDigest.startsWith("sha256:"), true);
  assert.equal(jsonReduced.body.result.failureCode || "", "");

  const status = await requestJson(baseUrl, "/v1/bridge/status");
  assert.equal(status.response.status, 200);
  assert.equal(status.body.reducedResults.total, 3, JSON.stringify(status.body.reducedResults));
  assert.equal(status.body.reducedResults.byStatus.valid, 2, JSON.stringify(status.body.reducedResults));
  assert.equal(status.body.reducedResults.byStatus.needs_human_review, 1, JSON.stringify(status.body.reducedResults));
  assert.equal(status.body.rawPayloadsExposed, false);
} finally {
  await daemon.close();
  await fs.rm(rootDir, { recursive: true, force: true });
}

console.log("direct-headless-output-outbox regression passed");
