import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { DirectThreadStore } = require("../src/main/direct/thread/thread-store");
const { buildDirectRuntimeAnalyticsFacts } = require("../src/main/direct/analytics/runtime-facts");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "direct-runtime-analytics-facts-"));
const projectId = "project_runtime_analytics";
const session = {
  sessionId: "direct_session_analytics",
  projectId,
  model: "gpt-5.5",
  reasoningEffort: "xhigh",
  agentKind: "main_agent",
  agentThreadId: "direct_session_analytics",
  primaryThreadId: "direct_session_analytics",
  workThreadId: "work_thread_analytics",
};
const turn = {
  schema: "direct_codex_turn@1",
  sessionId: session.sessionId,
  threadId: session.sessionId,
  turnId: "direct_turn_analytics",
  state: "completed",
  createdAt: "2026-06-15T08:00:00.000Z",
  requestBuiltAt: "2026-06-15T08:00:00.100Z",
  streamStartedAt: "2026-06-15T08:00:00.900Z",
  completedAt: "2026-06-15T08:00:05.000Z",
  updatedAt: "2026-06-15T08:00:05.000Z",
  model: "gpt-5.5",
  reasoningEffort: "xhigh",
  contextBuildId: "context_analytics",
  requestManifestId: "request_analytics",
  requestShape: {
    modelContextWindow: 272000,
  },
  toolResults: [
    {
      resultId: "command_result_1",
      obligationId: "obligation_command_1",
      name: "run_command",
      status: "completed",
      startedAt: "2026-06-15T08:00:02.000Z",
      completedAt: "2026-06-15T08:00:02.250Z",
      durationMs: 250,
      workspaceEffects: { changedPathCount: 0 },
    },
  ],
  unresolvedObligations: [
    {
      obligationId: "obligation_read_pending",
      name: "read_file",
      status: "waiting",
      createdAt: "2026-06-15T08:00:01.500Z",
    },
  ],
  usageAttribution: {
    schema: "direct_turn_usage_attribution@1",
    status: "usage_observed",
    agentScope: {
      agentKind: "main_agent",
      agentThreadId: session.sessionId,
      primaryThreadId: session.sessionId,
    },
    rows: [
      {
        rowId: "turn_usage_analytics",
        usageSource: "response_completed_usage",
        usageRecordKind: "terminal",
        responseId: "resp_analytics",
        inputTokens: 1000,
        cachedInputTokens: 250,
        nonCachedInputTokens: 750,
        outputTokens: 120,
        reasoningTokens: 40,
        totalTokens: 1120,
        tokenFieldConfidence: {
          inputTokens: "exact",
          cachedInputTokens: "exact",
          nonCachedInputTokens: "derived",
          outputTokens: "exact",
          reasoningTokens: "exact",
          totalTokens: "exact",
        },
        rowDigest: "sha256:usage_analytics",
      },
    ],
  },
};

const providerMetadataProfile = {
  schema: "direct_provider_metadata_profile@1",
  provider: "openai",
  generatedAt: "2026-06-15T08:00:06.000Z",
  account: {
    planType: "plus",
    accountEvidenceKey: "account:evidence",
  },
  usage: {
    quota: {
      source: "server_rate_limits",
      windows: [
        { windowId: "codex:primary", windowKind: "five_hour", usedPercent: 25, resetsAt: "2026-06-15T09:00:00.000Z", windowDurationMins: 300 },
        { windowId: "codex:secondary", windowKind: "weekly", usedPercent: 60, resetsAt: "2026-06-21T18:00:00.000Z", windowDurationMins: 10080 },
      ],
    },
  },
};

const facts = buildDirectRuntimeAnalyticsFacts({
  projectId,
  sessionTurns: [{ session, turns: [turn] }],
  providerMetadataProfile,
});

assert.equal(facts.schema, "direct_runtime_analytics_facts@1");
assert(facts.counts.timingMarks >= 4, "Expected runtime timing marks.");
assert.equal(facts.counts.usageFacts, 1);
assert.equal(facts.counts.contextFacts, 1);
assert.equal(facts.counts.toolFacts, 2);
assert.equal(facts.counts.quotaFacts, 2);
assert.equal(facts.privacy.rawPromptIncluded, false);
assert.equal(facts.privacy.rawResponseIncluded, false);

const store = new DirectThreadStore({ rootDir: tempRoot, mode: "index_only" });
const first = store.recordDirectRuntimeAnalyticsFacts({
  projectId,
  sessionTurns: [{ session, turns: [turn] }],
  providerMetadataProfile,
});
const second = store.recordDirectRuntimeAnalyticsFacts({
  projectId,
  sessionTurns: [{ session, turns: [turn] }],
  providerMetadataProfile,
});
assert.deepEqual(first.counts, second.counts, "Repeated persistence should be idempotent at the fact level.");

const summary = store.getDirectRuntimeAnalyticsFactSummary(projectId);
assert.equal(summary.schema, "direct_runtime_analytics_fact_summary@1");
assert.equal(summary.counts.usageFacts, 1);
assert.equal(summary.counts.contextFacts, 1);
assert.equal(summary.counts.toolFacts, 2);
assert.equal(summary.counts.quotaFacts, 2);
assert(summary.counts.timingMarks >= 4);
assert.equal(summary.tokenTotals.inputTokens, 1000);
assert.equal(summary.tokenTotals.cachedInputTokens, 250);
assert.equal(summary.tokenTotals.nonCachedInputTokens, 750);
assert.equal(summary.tokenTotals.outputTokens, 120);
assert.equal(summary.tokenTotals.reasoningTokens, 40);
assert.equal(summary.tokenTotals.totalTokens, 1120);

const status = store.status();
assert.equal(status.analyticsFactCounts.usageFacts, 1);
assert.equal(status.analyticsFactCounts.quotaFacts, 2);
store.close();

console.log(JSON.stringify({
  ok: true,
  counts: summary.counts,
  tokenTotals: summary.tokenTotals,
}));
