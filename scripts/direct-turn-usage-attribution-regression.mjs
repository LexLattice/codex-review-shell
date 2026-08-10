#!/usr/bin/env node

import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const {
  DirectSessionStore,
} = require("../src/main/direct/session/session-store");
const {
  agentScopeForTurn,
  buildDirectTurnUsageAttribution,
} = require("../src/main/direct/usage/turn-attribution");

function assert(condition, message, details = {}) {
  if (condition) return;
  const error = new Error(message);
  error.details = details;
  throw error;
}

function makeRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "direct-turn-usage-attribution-"));
}

function usageEvents(responseId, sequenceBase, usage) {
  return [
    {
      type: "usage_delta",
      sequence: sequenceBase,
      usage,
    },
    {
      type: "response_completed",
      sequence: sequenceBase + 1,
      responseId,
      stopReason: "completed",
    },
  ];
}

function run() {
  const rootDir = makeRoot();
  const store = new DirectSessionStore({ rootDir });
  const mainSession = store.createSession({
    sessionId: "session_main",
    projectId: "project_usage_attr",
    model: "gpt-5.4",
    reasoningEffort: "high",
    agentKind: "main_agent",
  });
  const mainTurn = store.createTurn(mainSession.sessionId, {
    turnId: "turn_main",
    input: [{ role: "user", text: "main turn" }],
    model: "gpt-5.4",
    reasoningEffort: "high",
  });
  store.appendNormalizedEvents(mainSession.sessionId, mainTurn.turnId, usageEvents("resp_main_1", 1, {
    inputTokens: 10,
    cachedInputTokens: 3,
    outputTokens: 7,
    reasoningTokens: 2,
    totalTokens: 17,
  }));
  store.appendNormalizedEvents(mainSession.sessionId, mainTurn.turnId, usageEvents("resp_main_2", 3, {
    inputTokens: 4,
    cachedInputTokens: 1,
    outputTokens: 5,
    reasoningTokens: 1,
    totalTokens: 9,
  }));
  const persistedMainTurn = store.readTurn(mainSession.sessionId, mainTurn.turnId);
  assert(persistedMainTurn.usageAttribution?.status === "usage_observed", "Expected main turn usage to be observed.", persistedMainTurn.usageAttribution);
  assert(persistedMainTurn.usageAttribution.agentScope.agentKind === "main_agent", "Expected main turn to be attributed to main agent.", persistedMainTurn.usageAttribution.agentScope);
  assert(persistedMainTurn.usageAttribution.rows.length === 2, "Expected two response usage rows for main turn.", persistedMainTurn.usageAttribution.rows);
  assert(persistedMainTurn.usageAttribution.totals.totalTokensKnown === 26, "Expected main turn total tokens to sum continuations.", persistedMainTurn.usageAttribution.totals);
  assert(persistedMainTurn.usageAttribution.totals.nonCachedInputTokensKnown === 10, "Expected non-cached input tokens to be derived.", persistedMainTurn.usageAttribution.totals);

  const workerSession = store.createSession({
    sessionId: "agent_worker_1",
    projectId: "project_usage_attr",
    model: "gpt-5.4-mini",
    reasoningEffort: "medium",
    agentKind: "sub_worker",
    agentThreadId: "agent_worker_1",
    parentThreadId: "session_main",
    agentLabel: "Worker",
    agentRole: "reviewer",
  });
  assert(workerSession.primaryThreadId === "session_main", "Expected worker primary thread to default to parent thread.", workerSession);
  const workerTurn = store.createTurn(workerSession.sessionId, {
    turnId: "turn_worker",
    input: [{ role: "user", text: "worker turn" }],
  });
  store.appendNormalizedEvents(workerSession.sessionId, workerTurn.turnId, usageEvents("resp_worker_1", 1, {
    inputTokens: 8,
    cachedInputTokens: 0,
    outputTokens: 6,
    totalTokens: 14,
  }));
  const persistedWorkerTurn = store.readTurn(workerSession.sessionId, workerTurn.turnId);
  assert(persistedWorkerTurn.usageAttribution.agentScope.agentKind === "sub_worker", "Expected worker turn to be attributed to sub-worker.", persistedWorkerTurn.usageAttribution.agentScope);
  assert(persistedWorkerTurn.usageAttribution.agentScope.parentThreadId === "session_main", "Expected worker parent thread to be preserved.", persistedWorkerTurn.usageAttribution.agentScope);
  assert(persistedWorkerTurn.usageAttribution.agentScope.primaryThreadId === "session_main", "Expected worker primary thread to be preserved.", persistedWorkerTurn.usageAttribution.agentScope);
  assert(persistedWorkerTurn.usageAttribution.model === "gpt-5.4-mini", "Expected worker model to be preserved.", persistedWorkerTurn.usageAttribution);
  assert(persistedWorkerTurn.usageAttribution.reasoningEffort === "medium", "Expected worker effort to be preserved.", persistedWorkerTurn.usageAttribution);

  const missingTurn = store.createTurn(mainSession.sessionId, {
    turnId: "turn_missing",
    input: [{ role: "user", text: "missing usage turn" }],
  });
  store.appendNormalizedEvents(mainSession.sessionId, missingTurn.turnId, [
    { type: "message_delta", sequence: 1, text: "done" },
    { type: "response_completed", sequence: 2, responseId: "resp_missing", stopReason: "completed" },
  ]);
  const persistedMissingTurn = store.readTurn(mainSession.sessionId, missingTurn.turnId);
  assert(persistedMissingTurn.usageAttribution.status === "usage_missing", "Expected terminal turn without usage to be marked missing.", persistedMissingTurn.usageAttribution);
  assert(persistedMissingTurn.usageAttribution.totals.totalTokensKnown === 0, "Missing usage can have zero known total, but only with missing status.", persistedMissingTurn.usageAttribution.totals);
  assert(persistedMissingTurn.usageAttribution.totals.missingUsageRowCount === 1, "Expected one missing usage row.", persistedMissingTurn.usageAttribution.totals);

  const partialTurn = store.createTurn(mainSession.sessionId, {
    turnId: "turn_partial_missing",
    input: [{ role: "user", text: "partial missing usage turn" }],
  });
  store.appendNormalizedEvents(mainSession.sessionId, partialTurn.turnId, [
    ...usageEvents("resp_partial_observed", 1, { inputTokens: 5, outputTokens: 5, totalTokens: 10 }),
    { type: "message_delta", sequence: 3, text: "still working" },
    { type: "response_completed", sequence: 4, responseId: "resp_partial_missing", stopReason: "completed" },
  ]);
  const persistedPartialTurn = store.readTurn(mainSession.sessionId, partialTurn.turnId);
  assert(persistedPartialTurn.usageAttribution.status === "usage_observed", "Expected partial turn to keep observed status while recording missing row.", persistedPartialTurn.usageAttribution);
  assert(persistedPartialTurn.usageAttribution.rows.length === 2, "Expected one observed and one missing usage row.", persistedPartialTurn.usageAttribution.rows);
  assert(persistedPartialTurn.usageAttribution.totals.totalTokensKnown === 10, "Expected observed usage to remain counted.", persistedPartialTurn.usageAttribution.totals);
  assert(persistedPartialTurn.usageAttribution.totals.missingUsageRowCount === 1, "Expected missing terminal response to be counted.", persistedPartialTurn.usageAttribution.totals);

  const overwriteTurn = store.createTurn(mainSession.sessionId, {
    turnId: "turn_missing_then_observed",
    input: [{ role: "user", text: "late usage" }],
  });
  store.appendNormalizedEvents(mainSession.sessionId, overwriteTurn.turnId, [
    { type: "response_completed", sequence: 1, responseId: "resp_late_usage", stopReason: "completed" },
  ]);
  store.appendNormalizedEvents(mainSession.sessionId, overwriteTurn.turnId, usageEvents("resp_late_usage", 2, {
    inputTokens: 2,
    outputTokens: 3,
    totalTokens: 5,
  }));
  const persistedOverwriteTurn = store.readTurn(mainSession.sessionId, overwriteTurn.turnId);
  assert(persistedOverwriteTurn.usageAttribution.rows.length === 1, "Expected later observed usage to dedupe the earlier missing row.", persistedOverwriteTurn.usageAttribution.rows);
  assert(persistedOverwriteTurn.usageAttribution.rows[0].usageRecordKind === "terminal", "Expected terminal usage to win over missing row.", persistedOverwriteTurn.usageAttribution.rows);
  assert(persistedOverwriteTurn.usageAttribution.totals.missingUsageRowCount === 0, "Expected missing count to clear after observed usage arrives.", persistedOverwriteTurn.usageAttribution.totals);

  const graphAttribution = buildDirectTurnUsageAttribution({
    session: { sessionId: "agent_graph_worker", projectId: "project_usage_attr", model: "gpt-5.3" },
    turn: { turnId: "turn_graph_worker" },
    agentGraph: {
      primaryThreadId: "session_main",
      nodes: [
        {
          agentThreadId: "agent_graph_worker",
          parentThreadId: "session_main",
          depth: 1,
          displayLabel: "Graph Worker",
          role: "worker",
        },
      ],
    },
    events: usageEvents("resp_graph_worker", 1, { inputTokens: 1, outputTokens: 2, totalTokens: 3 }),
  });
  assert(agentScopeForTurn({
    session: { sessionId: "agent_graph_worker" },
    turn: { turnId: "turn_graph_worker" },
    agentGraph: graphAttribution.agentScope ? { primaryThreadId: "session_main", nodes: [{ agentThreadId: "agent_graph_worker", parentThreadId: "session_main", depth: 1 }] } : {},
  }).agentKind === "sub_worker", "Expected graph scope helper to classify sub-worker.");
  assert(graphAttribution.agentScope.agentKind === "sub_worker", "Expected graph-built attribution to classify sub-worker.", graphAttribution.agentScope);

  console.log(JSON.stringify({
    ok: true,
    schema: "direct_turn_usage_attribution_regression@1",
    cases: [
      "main_agent_usage_rows_sum",
      "sub_worker_metadata_attribution",
      "missing_usage_not_zeroed",
      "partial_missing_usage_recorded",
      "late_usage_overwrites_missing",
      "agent_graph_scope_attribution",
    ],
    rootDir,
  }, null, 2));
}

try {
  run();
} catch (error) {
  console.error(error?.stack || error?.message || String(error));
  if (error?.details) console.error(JSON.stringify(error.details, null, 2));
  process.exit(1);
}
