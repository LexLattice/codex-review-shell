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
  buildDefaultHeadlessResidentSmokeSuite,
  buildDefaultResidentSmokeBundle,
  buildResidentSmokePrompt,
  runHeadlessResidentSmokeSuite,
  validateHeadlessResidentSmokeSuiteReport,
} = require("../src/main/direct/headless/resident-smoke-runner.js");

const TOKEN = "resident-smoke-token";

function nowIso() {
  return new Date().toISOString();
}

function fixtureConfig(rootDir) {
  return {
    rootDir,
    host: "127.0.0.1",
    port: 0,
    clients: [{
      clientId: "resident_smoke_client",
      status: "active",
      authMode: "capability_token",
      capabilityToken: TOKEN,
      allowedIngressContracts: ["headless_text_event@1"],
      allowedRoutes: ["route_text"],
    }],
    workThreads: [{
      workThreadId: "wt_resident_smoke",
      status: "active",
      projectId: "project_resident_smoke",
    }],
    routes: [{
      routeId: "route_text",
      routeVersion: "v1",
      status: "active",
      ingressContractRef: "headless_text_event@1",
      workThreadId: "wt_resident_smoke",
      targetThreadRef: {
        runtimePath: "direct-text",
        threadId: "direct_session_headless_resident_smoke",
      },
      contextPolicyRef: "resident_smoke_context_policy@1",
      modelPolicyRef: "resident-smoke-fixture-model-policy",
      outputReducerRef: "terminal-result-only",
      authorityBoundaryRef: "headless-resident-smoke-no-workspace-mutation",
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
  constructor(delayMs = 40) {
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
        title: params.title || "fixture headless resident smoke",
      });
    }
    return { thread: { id }, model: params.model || "gpt-5.5" };
  }

  async startTurn(params = {}) {
    const sessionId = params.sessionId || params.threadId;
    const turnId = `resident_smoke_turn_${String(++this.turnOrdinal).padStart(3, "0")}`;
    const turn = {
      turnId,
      id: turnId,
      state: "streaming",
      status: "inProgress",
      promptDigest: params.promptText ? "resident-smoke-prompt-digest" : "",
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

const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "direct-headless-resident-smoke-"));
let daemon;
try {
  const controller = new FixtureDirectTextController(40);
  daemon = new DirectHeadlessBridgeDaemon(fixtureConfig(rootDir));
  daemon.textRuntime = new DirectHeadlessTextRuntime({
    store: daemon.store,
    controller,
    project: {
      id: "project_resident_smoke",
      name: "Resident smoke fixture",
    },
  });

  await daemon.listen();
  const bundle = buildDefaultResidentSmokeBundle();
  const suite = buildDefaultHeadlessResidentSmokeSuite();
  assert.equal(suite.schema, "headless_resident_smoke_suite@1");
  assert.equal(suite.caseCount, 4);
  assert.deepEqual(suite.caseClasses, [
    "tool_visibility_self_report",
    "runtime_metadata_visibility",
    "sub_agent_observation_boundary",
    "overclaim_detection_guard",
  ]);
  const prompt = buildResidentSmokePrompt({ bundle, smokeCase: suite.cases[0] });
  assert.ok(prompt.includes("Harness epistemic witness:"), "prompt must include resident witness text");
  assert.ok(prompt.length <= suite.cases[0].maxPromptChars, "prompt must stay bounded");

  const report = await runHeadlessResidentSmokeSuite({ daemon, suite, bundle });
  const validationErrors = validateHeadlessResidentSmokeSuiteReport(report);
  assert.deepEqual(validationErrors, []);
  assert.equal(report.schema, "headless_resident_smoke_suite_report@1");
  assert.equal(report.summary.total, 4);
  assert.equal(report.summary.pass, 4);
  assert.equal(report.summary.fail, 0);
  assert.equal(report.summary.valid, true);
  assert.equal(report.rawPromptIncluded, false);
  assert.equal(report.rawPayloadIncluded, false);
  assert.equal(report.workspaceMutationStarted, false);
  assert.equal(report.grantsAuthority, false);
  assert.equal(report.reports.every((entry) => entry.providerTransportStarted === true), true);

  const byClass = new Map(report.reports.map((entry) => [entry.caseClass, entry]));
  assert.equal(byClass.get("tool_visibility_self_report").diagnostic.mismatchCount, 0);
  assert.equal(byClass.get("runtime_metadata_visibility").diagnostic.mismatchCount, 0);
  assert.equal(byClass.get("sub_agent_observation_boundary").diagnostic.mismatchCount, 0);
  assert.equal(byClass.get("sub_agent_observation_boundary").diagnostic.findings.some((finding) => (
    finding.claim.subjectKind === "sub_agent" &&
    finding.claim.field === "controlState" &&
    finding.expectedValue === "blocked_by_policy"
  )), true);
  assert.equal(byClass.get("overclaim_detection_guard").diagnostic.mismatchCount, 1);
  assert.equal(byClass.get("overclaim_detection_guard").diagnostic.unknownSubjectCount, 1);
  assert.equal(byClass.get("overclaim_detection_guard").assertions.every((entry) => entry.passed === true), true);

  console.log(JSON.stringify({
    ok: true,
    regression: "direct-headless-resident-smoke-runner",
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
