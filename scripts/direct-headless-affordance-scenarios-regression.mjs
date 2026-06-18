#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { DirectHeadlessBridgeDaemon } = require("../src/main/direct/headless/bridge-daemon.js");
const { DirectHeadlessTextRuntime } = require("../src/main/direct/headless/text-runtime.js");
const {
  buildDefaultHeadlessAffordanceScenarioSuite,
  runHeadlessAffordanceScenarioSuite,
  validateHeadlessAffordanceScenarioSuiteReport,
} = require("../src/main/direct/headless/affordance-scenarios.js");

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
      clientId: "affordance_scenario_client",
      status: "active",
      authMode: "capability_token",
      capabilityToken: TOKEN,
      allowedIngressContracts: ["headless_text_event@1"],
      allowedRoutes: ["route_text"],
    }],
    workThreads: [{
      workThreadId: "wt_affordance_scenario",
      status: "active",
      projectId: "project_affordance_scenario",
    }],
    routes: [{
      routeId: "route_text",
      routeVersion: "v1",
      status: "active",
      ingressContractRef: "headless_text_event@1",
      workThreadId: "wt_affordance_scenario",
      targetThreadRef: {
        runtimePath: "direct-text",
        threadId: "direct_session_headless_affordance_scenario",
      },
      contextPolicyRef: "direct_text_turn_empty_context@1",
      modelPolicyRef: "fixture-model-policy",
      outputReducerRef: "terminal-result-only",
      authorityBoundaryRef: "headless-affordance-scenario-no-tools",
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
  constructor(delayMs = 150) {
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
        title: params.title || "fixture headless affordance scenario",
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
      promptDigest: params.promptText ? "fixture-prompt-digest" : "",
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

const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "direct-headless-affordance-scenarios-"));
let daemon;
try {
  const controller = new FixtureDirectTextController(150);
  daemon = new DirectHeadlessBridgeDaemon(fixtureConfig(rootDir));
  daemon.textRuntime = new DirectHeadlessTextRuntime({
    store: daemon.store,
    controller,
    project: {
      id: "project_affordance_scenario",
      name: "Affordance scenario fixture",
    },
  });

  await daemon.listen();
  const suite = buildDefaultHeadlessAffordanceScenarioSuite();
  assert.equal(suite.schema, "headless_affordance_scenario_suite@1");
  assert.equal(suite.scenarioCount, 7);
  assert.deepEqual(suite.scenarioClasses, [
    "direct_session_creation_resume",
    "active_turn_queue_steer_stop",
    "runtime_metadata_context_projection",
    "tool_availability_self_report_parity",
    "sub_agent_observable_state_governance",
    "context_memory_baton_compaction_witness",
    "analytics_fact_persistence_turn_attribution",
  ]);

  const report = await runHeadlessAffordanceScenarioSuite({ daemon, suite });
  const validationErrors = validateHeadlessAffordanceScenarioSuiteReport(report);
  assert.deepEqual(validationErrors, []);
  assert.equal(report.schema, "headless_affordance_scenario_suite_report@1");
  assert.equal(report.summary.total, 7);
  assert.equal(report.summary.fail, 0);
  assert.equal(report.summary.pass, 2);
  assert.equal(report.summary.degraded, 2);
  assert.equal(report.summary.skip, 3);
  assert.equal(report.summary.valid, true);
  assert.equal(report.rawPayloadIncluded, false);
  assert.equal(report.workspaceMutationStarted, false);

  const byClass = new Map(report.reports.map((scenarioReport) => [scenarioReport.scenarioClass, scenarioReport]));
  assert.equal(byClass.get("direct_session_creation_resume").status, "pass");
  assert.equal(byClass.get("active_turn_queue_steer_stop").status, "degraded");
  assert.equal(byClass.get("runtime_metadata_context_projection").status, "pass");
  assert.equal(byClass.get("tool_availability_self_report_parity").status, "skip");
  assert.equal(byClass.get("sub_agent_observable_state_governance").reason, "sub_agent_fixture_graph_provider_not_wired");
  assert.equal(byClass.get("context_memory_baton_compaction_witness").status, "degraded");
  assert.equal(byClass.get("analytics_fact_persistence_turn_attribution").reason, "headless_turn_attribution_probe_not_wired");

  const activeAssertions = byClass.get("active_turn_queue_steer_stop").assertions;
  assert.equal(
    activeAssertions.some((row) => row.assertionId === "steer_blocker" && row.observed === "steer_not_supported_by_headless_runtime" && row.passed === true),
    true,
  );
  assert.equal(
    activeAssertions.some((row) => row.assertionId === "stop_blocker" && row.observed === "stop_not_supported_by_headless_runtime" && row.passed === true),
    true,
  );

  console.log(JSON.stringify({
    ok: true,
    regression: "direct-headless-affordance-scenarios",
    summary: report.summary,
    suiteDigest: report.suiteDigest,
  }, null, 2));
} finally {
  if (daemon) {
    try {
      await daemon.close();
    } catch (error) {
      console.error("Failed to close daemon:", error);
    }
  }
  await fs.rm(rootDir, { recursive: true, force: true });
}
