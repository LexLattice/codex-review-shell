#!/usr/bin/env node

import { strict as assert } from "node:assert";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const {
  assertDirectAgentUsageLedgerSafe,
  assertDirectAgentUsageProjectionSafe,
  buildDirectAgentUsageLedger,
  buildDirectAgentUsageSummaryProjection,
  buildUsageRowsForTurn,
} = require("../src/main/direct/usage/agent-ledger");
const {
  buildDirectSettingsSurfaceProjection,
  assertDirectSettingsSurfaceRendererSafe,
} = require("../src/main/direct/ui/settings-surface");

const projectId = "project_direct_agent_usage";

const primarySession = {
  schema: "direct_codex_session@1",
  sessionId: "session_primary",
  projectId,
  model: "gpt-5.5",
  reasoningEffort: "xhigh",
  agentKind: "main_agent",
  agentThreadId: "session_primary",
  primaryThreadId: "session_primary",
  workThreadId: "work_thread_usage",
};

const workerSession = {
  schema: "direct_codex_session@1",
  sessionId: "session_worker",
  projectId,
  model: "gpt-5.4-mini",
  reasoningEffort: "medium",
  agentKind: "sub_worker",
  agentThreadId: "agent_worker_1",
  parentThreadId: "session_primary",
  primaryThreadId: "session_primary",
  agentLabel: "Worker One",
  agentRole: "implementation_worker",
  workThreadId: "work_thread_usage",
};

const primaryTurn = {
  schema: "direct_codex_turn@1",
  sessionId: primarySession.sessionId,
  turnId: "turn_primary",
  model: "gpt-5.5",
  reasoningEffort: "xhigh",
  createdAt: "2026-06-13T10:00:00.000Z",
  streamStartedAt: "2026-06-13T10:00:01.000Z",
  completedAt: "2026-06-13T10:00:05.500Z",
  contextBuildId: "context_primary",
  requestManifestId: "request_primary",
  controlledRoutingSliceId: "controlled_route_primary",
  controlledRoutingSliceDigest: "sha256:controlled_route_primary",
  controlledRoutingGateState: "ready_for_direct_text_turn",
  controlledRoutingProviderScope: "existing_direct_text_turn_start_only",
  usageAttribution: {
    schema: "direct_turn_usage_attribution@1",
    agentScope: {
      agentKind: "main_agent",
      agentThreadId: "session_primary",
      primaryThreadId: "session_primary",
      attributionSource: "session_default",
    },
    rows: [
      {
        rowId: "turn_usage_primary",
        usageSource: "response_completed_usage",
        usageRecordKind: "terminal",
        responseId: "resp_primary",
        sourceEventSequence: 4,
        inputTokens: 11,
        cachedInputTokens: 3,
        nonCachedInputTokens: 8,
        outputTokens: 7,
        reasoningTokens: 2,
        totalTokens: 18,
        rowDigest: "sha256:turn_usage_primary",
        tokenFieldConfidence: {
          inputTokens: "exact",
          cachedInputTokens: "exact",
          nonCachedInputTokens: "derived",
          outputTokens: "exact",
          reasoningTokens: "exact",
          totalTokens: "exact",
        },
      },
      {
        rowId: "turn_usage_primary_delta",
        usageRecordKind: "delta",
        usageSource: "provider_usage_delta",
        responseId: "resp_primary",
        totalTokens: 999,
      },
    ],
  },
};

const workerTurn = {
  schema: "direct_codex_turn@1",
  sessionId: workerSession.sessionId,
  turnId: "turn_worker",
  model: "gpt-5.4-mini",
  reasoningEffort: "medium",
  agentKind: "sub_worker",
  agentThreadId: "agent_worker_1",
  parentThreadId: "session_primary",
  agentLabel: "Worker One",
  agentRole: "implementation_worker",
  createdAt: "2026-06-13T10:01:00.000Z",
  failedAt: "2026-06-13T10:01:04.000Z",
  contextBuildId: "context_worker",
  requestManifestId: "request_worker",
  usageAttribution: {
    schema: "direct_turn_usage_attribution@1",
    agentScope: {
      agentKind: "sub_worker",
      agentThreadId: "agent_worker_1",
      parentThreadId: "session_primary",
      primaryThreadId: "session_primary",
      agentLabel: "Worker One",
      agentRole: "implementation_worker",
      attributionSource: "agent_graph",
    },
    rows: [
      {
        rowId: "turn_usage_worker_missing",
        usageSource: "missing",
        usageRecordKind: "missing",
        usageMissingReason: "provider_did_not_emit_usage",
      },
    ],
  },
};

const activeTurnWithoutUsage = {
  schema: "direct_codex_turn@1",
  sessionId: primarySession.sessionId,
  turnId: "turn_active_without_usage",
  model: "gpt-5.5",
  reasoningEffort: "xhigh",
  createdAt: "2026-06-13T10:03:00.000Z",
  streamStartedAt: "2026-06-13T10:03:01.000Z",
  status: "streaming",
};

assert.equal(
  buildUsageRowsForTurn({ projectId, session: primarySession, turn: activeTurnWithoutUsage }).length,
  0,
  "active turns without usage attribution must not be counted as missing usage",
);

const ledger = buildDirectAgentUsageLedger({
  projectId,
  sessionTurns: [
    { session: primarySession, turns: [primaryTurn, activeTurnWithoutUsage] },
    { session: workerSession, turns: [workerTurn] },
  ],
  generatedAt: "2026-06-13T10:02:00.000Z",
});

assertDirectAgentUsageLedgerSafe(ledger);
assert.equal(ledger.schema, "direct_agent_usage_ledger@1");
assert.equal(ledger.rowCount, 2, "terminal duplicate should dedupe provider response id");
assert.equal(ledger.totals.totalTokensKnown, 18, "missing usage must not count as zeroed known usage");
assert.equal(ledger.totals.inputTokensKnown, 11);
assert.equal(ledger.totals.cachedInputTokensKnown, 3);
assert.equal(ledger.totals.reasoningTokensKnown, 2);
assert.equal(ledger.totals.missingUsageRowCount, 1);
assert.equal(ledger.totals.turnCount, 2);
assert.equal(ledger.privacy.costComputed, false);
assert.equal(ledger.privacy.billingGrade, false);
assert(ledger.byAgent.some((row) => row.key === "session_primary" && row.totals.totalTokensKnown === 18));
assert(ledger.byAgent.some((row) => row.key === "agent_worker_1" && row.totals.missingUsageRowCount === 1));
assert(ledger.byWorkThread.some((row) => row.key === "work_thread_usage" && row.totals.rowCount === 2));
assert(ledger.byRoute.some((row) => row.key === "controlled_route_primary"));
assert(ledger.byRoute.some((row) => row.key === "unrouted"));

const projection = buildDirectAgentUsageSummaryProjection(ledger);
assertDirectAgentUsageProjectionSafe(projection);
assert.equal(projection.schema, "direct_agent_usage_summary_projection@1");
assert.equal(projection.totals.totalTokensKnown, 18);
assert.equal(projection.evidencePosture.costComputed, false);
assert.equal(projection.evidencePosture.billingGrade, false);

const settings = buildDirectSettingsSurfaceProjection({
  projectId,
  agentUsageStatus: projection,
});
assertDirectSettingsSurfaceRendererSafe(settings);
assert.equal(settings.sections.agentUsage.available, true);
assert.equal(settings.sections.agentUsage.totalTokensKnown, 18);
assert.equal(settings.sections.agentUsage.missingUsageRowCount, 1);
assert(settings.rows.agentUsage.some((row) => row.label === "Cost" && row.value === "not computed"));

console.log(JSON.stringify({
  ok: true,
  rowCount: ledger.rowCount,
  totalTokensKnown: ledger.totals.totalTokensKnown,
  missingUsageRowCount: ledger.totals.missingUsageRowCount,
  agentGroups: ledger.byAgent.length,
  workThreadGroups: ledger.byWorkThread.length,
  routeGroups: ledger.byRoute.length,
}, null, 2));
