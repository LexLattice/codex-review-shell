import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { DirectThreadStore } = require("../src/main/direct/thread/thread-store");
const {
  RUNTIME_ANALYTICS_PROJECTION_SCHEMA,
  buildRuntimeAnalyticsProjection,
} = require("../src/main/direct/analytics/runtime-analytics-adapter");

const appserverUsageLedger = {
  schemaVersion: 1,
  status: "available",
  source: "codex_usage_ledger@1",
  lastObservedAt: "2026-06-15T09:00:01.000Z",
  confidence: "provider_exact",
  tokens: {
    status: "snapshot_available",
    tokenRows: 1,
    latestSnapshotAt: "2026-06-15T09:00:00.000Z",
    usageScope: "thread_total",
    inputTokens: 2000,
    cachedInputTokens: 500,
    nonCachedInputTokens: 1500,
    outputTokens: 300,
    reasoningOutputTokens: 80,
    totalTokens: 2300,
    modelContextWindow: 272000,
    confidence: "provider_exact",
  },
  turns: {
    started: 2,
    completed: 1,
    active: 1,
    durationMs: 4200,
    timeToFirstTokenMs: 900,
  },
  tools: {
    total: 3,
    completed: 2,
    failed: 1,
    commands: 1,
    patches: 1,
    subagents: 1,
    byKind: [{ xValue: "command_exec", yValue: 1 }],
  },
  requests: {
    total: 1,
    pending: 0,
    resolved: 1,
    failed: 0,
    byKind: [{ xValue: "approval", yValue: 1 }],
  },
  rateLimits: {
    status: "available",
    observedAt: "2026-06-15T09:00:00.000Z",
    planType: "plus",
    rateLimitsByLimitId: {
      codex: {
        limitId: "codex",
        primary: {
          name: "5h",
          usedPercent: 70,
          windowDurationMins: 300,
          resetsAt: "2026-06-15T10:00:00.000Z",
        },
        secondary: {
          name: "weekly",
          usedPercent: 91,
          windowDurationMins: 10080,
          resetsAt: "2026-06-21T18:00:00.000Z",
        },
      },
      codex_other: {
        limitId: "codex_other",
        primary: {
          name: "other",
          usedPercent: 12,
          windowDurationMins: 300,
          resetsAt: "2026-06-15T11:00:00.000Z",
        },
      },
    },
    primary: {
      name: "5h",
      usedPercent: 70,
      windowDurationMins: 300,
      resetsAt: "2026-06-15T10:00:00.000Z",
    },
    secondary: {
      name: "weekly",
      usedPercent: 91,
      windowDurationMins: 10080,
      resetsAt: "2026-06-21T18:00:00.000Z",
    },
  },
  series: {
    token_mix: [{ xValue: "input", yValue: 1500 }],
    tool_kind_mix: [{ xValue: "command_exec", yValue: 1 }],
    request_kind_mix: [{ xValue: "approval", yValue: 1 }],
    turn_status_mix: [{ xValue: "active", yValue: 1 }],
  },
};

const appserverProjection = buildRuntimeAnalyticsProjection({
  projectId: "project_runtime_adapter",
  threadId: "thread_appserver",
  runtimePath: "app-server",
  usageLedgerAnalytics: appserverUsageLedger,
  generatedAt: "2026-06-15T09:00:02.000Z",
});

assert.equal(appserverProjection.schema, RUNTIME_ANALYTICS_PROJECTION_SCHEMA);
assert.equal(appserverProjection.status, "available");
assert.equal(appserverProjection.sourcePosture.adapterKind, "appserver");
assert.equal(appserverProjection.tokens.source, "appserver_native");
assert.equal(appserverProjection.tokens.confidence, "provider_exact");
assert.equal(appserverProjection.tokens.reasoningTokens, 80);
assert.equal(appserverProjection.context.source, "derived_from_appserver");
assert(appserverProjection.context.usedPercent > 0);
assert.equal(appserverProjection.quota.source, "appserver_native");
assert.equal(appserverProjection.quota.windows.length, 3);
assert(appserverProjection.quota.windows.some((window) => window.windowId === "codex:secondary" && window.windowKind === "weekly"));
assert(appserverProjection.quota.windows.some((window) => window.windowId === "codex_other:primary" && window.windowKind === "five_hour"));
assert.equal(appserverProjection.requests.resolved, 1);
assert.equal(appserverProjection.privacy.rawPromptIncluded, false);
assert.equal(appserverProjection.privacy.costComputed, false);

const requestOnlyProjection = buildRuntimeAnalyticsProjection({
  projectId: "project_request_only",
  threadId: "thread_request_only",
  runtimePath: "app-server",
  usageLedgerAnalytics: {
    schemaVersion: 1,
    status: "available",
    source: "codex_usage_ledger@1",
    lastObservedAt: "2026-06-15T09:05:00.000Z",
    requests: {
      total: 1,
      pending: 1,
      resolved: 0,
      failed: 0,
      byKind: [{ xValue: "approval", yValue: 1 }],
    },
  },
  generatedAt: "2026-06-15T09:05:01.000Z",
});
assert.equal(requestOnlyProjection.status, "partial");
assert.equal(requestOnlyProjection.requests.status, "available");
assert.equal(requestOnlyProjection.sourcePosture.primarySource, "derived_from_appserver");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "direct-runtime-analytics-adapter-"));
let store;
function cleanup() {
  try {
    store?.close();
  } catch {}
  try {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  } catch {}
}
process.once("exit", cleanup);
const projectId = "project_direct_runtime_adapter";
const session = {
  sessionId: "direct_session_adapter",
  projectId,
  model: "gpt-5.5",
  reasoningEffort: "high",
  agentKind: "main_agent",
  agentThreadId: "direct_session_adapter",
};
const childSession = {
  sessionId: "direct_child_adapter",
  projectId,
  model: "gpt-5.4-mini",
  reasoningEffort: "medium",
  agentKind: "sub_worker",
  agentThreadId: "direct_child_adapter",
  parentThreadId: session.sessionId,
};
const turn = {
  schema: "direct_codex_turn@1",
  sessionId: session.sessionId,
  threadId: session.sessionId,
  turnId: "direct_turn_adapter",
  state: "completed",
  submittedAt: "2026-06-15T10:00:00.000Z",
  createdAt: "2026-06-15T10:00:00.000Z",
  requestBuiltAt: "2026-06-15T10:00:00.250Z",
  firstVisibleDeltaAt: "2026-06-15T10:00:01.200Z",
  completedAt: "2026-06-15T10:00:05.000Z",
  updatedAt: "2026-06-15T10:00:05.000Z",
  model: "gpt-5.5",
  reasoningEffort: "high",
  contextBuildId: "context_adapter",
  requestManifestId: "request_adapter",
  requestShape: {
    modelContextWindow: 272000,
  },
  toolResults: [
    {
      resultId: "tool_adapter_1",
      obligationId: "tool_adapter_1",
      name: "run_command",
      status: "completed",
      startedAt: "2026-06-15T10:00:02.000Z",
      completedAt: "2026-06-15T10:00:02.200Z",
      durationMs: 200,
    },
  ],
  usageAttribution: {
    rows: [
      {
        rowId: "usage_adapter_terminal",
        usageSource: "response_completed_usage",
        usageRecordKind: "terminal",
        responseId: "resp_adapter",
        inputTokens: 3000,
        cachedInputTokens: 1000,
        nonCachedInputTokens: 2000,
        outputTokens: 350,
        reasoningTokens: 120,
        totalTokens: 3350,
        rowDigest: "sha256:usage_adapter",
      },
    ],
  },
};
const childTurn = {
  schema: "direct_codex_turn@1",
  sessionId: childSession.sessionId,
  threadId: childSession.sessionId,
  turnId: "direct_child_turn_adapter",
  state: "completed",
  submittedAt: "2026-06-15T10:00:02.500Z",
  createdAt: "2026-06-15T10:00:02.500Z",
  requestBuiltAt: "2026-06-15T10:00:02.650Z",
  firstVisibleDeltaAt: "2026-06-15T10:00:03.100Z",
  completedAt: "2026-06-15T10:00:04.500Z",
  updatedAt: "2026-06-15T10:00:04.500Z",
  model: "gpt-5.4-mini",
  reasoningEffort: "medium",
  contextBuildId: "context_child_adapter",
  requestManifestId: "request_child_adapter",
  requestShape: {
    modelContextWindow: 128000,
  },
  agentKind: "sub_worker",
  agentThreadId: childSession.sessionId,
  parentThreadId: session.sessionId,
  usageAttribution: {
    rows: [
      {
        rowId: "usage_child_adapter_terminal",
        usageSource: "response_completed_usage",
        usageRecordKind: "terminal",
        responseId: "resp_child_adapter",
        inputTokens: 1200,
        cachedInputTokens: 200,
        nonCachedInputTokens: 1000,
        outputTokens: 180,
        reasoningTokens: 40,
        totalTokens: 1380,
        rowDigest: "sha256:usage_child_adapter",
      },
    ],
  },
};
const failedTurn = {
  ...turn,
  turnId: "direct_turn_adapter_failed",
  state: "failed",
  submittedAt: "2026-06-15T10:01:00.000Z",
  createdAt: "2026-06-15T10:01:00.000Z",
  firstVisibleDeltaAt: "",
  completedAt: "",
  failedAt: "2026-06-15T10:01:04.000Z",
  updatedAt: "2026-06-15T10:01:04.000Z",
  toolResults: [],
  usageAttribution: {
    rows: [],
  },
};
const metadataWindowTurn = {
  ...turn,
  turnId: "direct_turn_adapter_metadata_window",
  submittedAt: "2026-06-15T10:02:00.000Z",
  createdAt: "2026-06-15T10:02:00.000Z",
  requestBuiltAt: "2026-06-15T10:02:00.200Z",
  firstVisibleDeltaAt: "2026-06-15T10:02:01.000Z",
  completedAt: "2026-06-15T10:02:03.000Z",
  updatedAt: "2026-06-15T10:02:03.000Z",
  contextBuildId: "context_adapter_metadata_window",
  requestManifestId: "request_adapter_metadata_window",
  requestShape: {},
  toolResults: [],
  usageAttribution: {
    rows: [
      {
        rowId: "usage_adapter_metadata_window",
        usageSource: "response_completed_usage",
        usageRecordKind: "terminal",
        responseId: "resp_adapter_metadata_window",
        inputTokens: 5440,
        cachedInputTokens: 0,
        nonCachedInputTokens: 5440,
        outputTokens: 25,
        reasoningTokens: 0,
        totalTokens: 5465,
        rowDigest: "sha256:usage_adapter_metadata_window",
      },
    ],
  },
};
const providerMetadataProfile = {
  schema: "direct_provider_metadata_profile@1",
  provider: "openai",
  generatedAt: "2026-06-15T10:00:06.000Z",
  account: {
    planType: "plus",
  },
  usage: {
    quota: {
      windows: [
        {
          windowId: "codex:5h",
          windowKind: "five_hour",
          usedPercent: 77,
          resetsAt: "2026-06-15T11:00:00.000Z",
          windowDurationMins: 300,
        },
        {
          windowId: "codex:weekly",
          windowKind: "weekly",
          usedPercent: 93,
          resetsAt: "2026-06-21T18:00:00.000Z",
          windowDurationMins: 10080,
        },
      ],
    },
  },
  modelCatalog: {
    defaultModel: "gpt-5.5",
    items: [
      {
        id: "gpt-5.5",
        model: "gpt-5.5",
        isDefault: true,
        contextWindow: 272000,
        maxContextWindow: 272000,
      },
    ],
  },
};

store = new DirectThreadStore({ rootDir: tempRoot, mode: "index_only" });
store.recordDirectRuntimeAnalyticsFacts({
  projectId,
  sessionTurns: [
    { session, turns: [turn, failedTurn, metadataWindowTurn] },
    { session: childSession, turns: [childTurn] },
  ],
  providerMetadataProfile,
});
const directSnapshot = store.getDirectRuntimeAnalyticsFactSnapshot(projectId);
assert.equal(directSnapshot.summary.counts.nonMissingUsageFacts, 3);
assert.equal(directSnapshot.timing.completed, 3);
assert.equal(directSnapshot.timing.failed, 1);
assert.equal(directSnapshot.timing.active, 0);
assert.equal(directSnapshot.timing.durationMs, 10000);
const directProjection = buildRuntimeAnalyticsProjection({
  projectId,
  threadId: session.sessionId,
  runtimePath: "direct-implementation",
  directFactSnapshot: directSnapshot,
  directProviderMetadataProfile: providerMetadataProfile,
  generatedAt: "2026-06-15T10:00:07.000Z",
});

assert.equal(directProjection.schema, RUNTIME_ANALYTICS_PROJECTION_SCHEMA);
assert.equal(directProjection.sourcePosture.adapterKind, "direct");
assert.equal(directProjection.tokens.source, "direct_native");
assert.equal(directProjection.tokens.confidence, "runtime_exact");
assert.equal(directProjection.tokens.reasoningTokens, 160);
assert.equal(directProjection.context.source, "derived_from_direct");
assert.equal(directProjection.context.modelContextWindow, 272000);
assert.equal(directProjection.context.usedPercent, 2);
assert.equal(directProjection.tools.commands, 1);
assert(directProjection.turnUsageRows.some((row) => row.turnId === "direct_turn_adapter" && row.model === "gpt-5.5" && row.reasoningEffort === "high"));
assert(directProjection.turnUsageRows.some((row) => row.turnId === "direct_child_turn_adapter" && row.agentKind === "sub_worker" && row.model === "gpt-5.4-mini" && row.reasoningEffort === "medium"));
assert(directProjection.agentUsageRows.some((row) => row.agentThreadId === "direct_session_adapter" && row.agentKind === "primary_agent" && row.totalTokens === 8815));
assert(directProjection.agentUsageRows.some((row) => row.agentThreadId === "direct_child_adapter" && row.agentKind === "sub_worker" && row.totalTokens === 1380));
assert(directProjection.parentTurnAgentEdges.some((edge) => edge.parentThreadId === "direct_session_adapter" && edge.childThreadId === "direct_child_adapter" && edge.parentTurnResolved === false));
assert.equal(directProjection.quota.source, "direct_native");
assert.equal(directProjection.quota.windows.length, 2);
assert.equal(directProjection.quota.windows[1].windowKind, "weekly");
assert.equal(directProjection.privacy.rawProviderFrameIncluded, false);
assert.equal(directProjection.privacy.billingGrade, false);

const metadataWindowSnapshot = store.getDirectRuntimeAnalyticsFactSnapshot(projectId, {
  threadId: session.sessionId,
});
assert.equal(metadataWindowSnapshot.latestContext.turnId, "direct_turn_adapter_metadata_window");
assert.equal(metadataWindowSnapshot.latestContext.modelContextWindow, 0);
assert.equal(metadataWindowSnapshot.latestContext.usedPercent, null);
const metadataWindowProjection = buildRuntimeAnalyticsProjection({
  projectId,
  threadId: session.sessionId,
  runtimePath: "direct-implementation",
  directFactSnapshot: metadataWindowSnapshot,
  directProviderMetadataProfile: providerMetadataProfile,
  generatedAt: "2026-06-15T10:02:04.000Z",
});
assert.equal(metadataWindowProjection.context.modelContextWindow, 272000);
assert.equal(metadataWindowProjection.context.usedPercent, 2);
assert(metadataWindowProjection.context.blockers.includes("context_window_filled_from_provider_metadata"));

const unavailableProjection = buildRuntimeAnalyticsProjection({
  projectId: "project_empty",
  runtimePath: "direct-implementation",
  directFactSnapshot: {
    summary: { counts: {}, tokenTotals: {} },
  },
});
assert.equal(unavailableProjection.status, "unavailable");
assert.equal(unavailableProjection.tokens.inputTokens, null);
assert(unavailableProjection.blockers.includes("direct_token_usage_unavailable"));

const missingUsageProjection = buildRuntimeAnalyticsProjection({
  projectId: "project_missing_usage",
  runtimePath: "direct-implementation",
  directFactSnapshot: {
    summary: {
      counts: { usageFacts: 1, nonMissingUsageFacts: 0 },
      tokenTotals: {
        inputTokens: 0,
        cachedInputTokens: 0,
        nonCachedInputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        totalTokens: 0,
      },
    },
  },
});
assert.equal(missingUsageProjection.tokens.status, "unavailable");
assert.equal(missingUsageProjection.tokens.inputTokens, null);

cleanup();

console.log(JSON.stringify({
  ok: true,
  appserver: {
    status: appserverProjection.status,
    tokenSource: appserverProjection.tokens.source,
  },
  direct: {
    status: directProjection.status,
    tokenSource: directProjection.tokens.source,
    quotaWindows: directProjection.quota.windows.length,
  },
}));
