"use strict";

const fsSync = require("node:fs");
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const readline = require("node:readline");
const { defaultUsageLedgerConfig, normalizeUsageLedgerConfig } = require("./usage-ledger-config");

const USAGE_LEDGER_ANALYTICS_FILE_LIMIT = 80;
const USAGE_LEDGER_ANALYTICS_ROW_LIMIT = 60_000;

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value, fallback = "") {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed ? trimmed : fallback;
}

function safeUsageNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function usageEvidenceKey(prefix, value) {
  const text = normalizeString(value, "");
  if (!text) return "";
  return `${prefix}:${crypto.createHash("sha256").update(text).digest("hex").slice(0, 16)}`;
}

function usageLedgerWorkspaceRoot(project) {
  const workspace = isPlainObject(project?.workspace) ? project.workspace : {};
  const repoPath = normalizeString(project?.repoPath, "");
  if (workspace.kind === "local") {
    return normalizeString(workspace.localPath, repoPath);
  }
  if (workspace.kind === "wsl") {
    const linuxPath = normalizeString(workspace.linuxPath, repoPath);
    if (!linuxPath) return "";
    if (process.platform === "win32") {
      const distro = normalizeString(workspace.distro, "Ubuntu");
      return `\\\\wsl.localhost\\${distro}${linuxPath.replace(/\//g, "\\")}`;
    }
    return linuxPath;
  }
  return repoPath;
}

function usageLedgerOutputLocation(project) {
  const codex = isPlainObject(project?.surfaceBinding?.codex)
    ? project.surfaceBinding.codex
    : isPlainObject(project?.codex)
      ? project.codex
      : {};
  const config = normalizeUsageLedgerConfig(codex.usageLedger || codex.usage_ledger || defaultUsageLedgerConfig());
  if (!config.enabled) {
    return {
      status: "not_configured",
      reason: "Usage ledger capture is disabled for this project.",
      config,
    };
  }
  const root = usageLedgerWorkspaceRoot(project);
  if (!root) {
    return {
      status: "unavailable",
      reason: "Project workspace root is unavailable.",
      config,
    };
  }
  const outputDir = path.isAbsolute(config.outputDir)
    ? config.outputDir
    : path.join(root, config.outputDir || ".codex/usage-ledgers");
  return {
    status: "configured",
    outputDir,
    outputDirEvidenceKey: usageEvidenceKey("usage-ledger-dir", outputDir),
    config,
  };
}

function emptyUsageLedgerAnalytics(status, reason, extras = {}) {
  return {
    schemaVersion: 1,
    status,
    reason: normalizeString(reason, ""),
    source: "codex_usage_ledger@1",
    fileCount: 0,
    skippedFileCount: 0,
    rowCount: 0,
    matchedRowCount: 0,
    lastObservedAt: "",
    confidence: "unknown",
    tokens: {
      status: "unavailable",
      tokenRows: 0,
      latestSnapshotAt: "",
      inputTokens: 0,
      cachedInputTokens: 0,
      nonCachedInputTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: 0,
      totalTokens: 0,
      modelContextWindow: 0,
      confidence: "unknown",
    },
    turns: {
      started: 0,
      completed: 0,
      active: 0,
      durationMs: 0,
      timeToFirstTokenMs: 0,
    },
    tools: {
      total: 0,
      completed: 0,
      failed: 0,
      commands: 0,
      patches: 0,
      subagents: 0,
      byKind: [],
    },
    requests: {
      total: 0,
      pending: 0,
      resolved: 0,
      failed: 0,
      byKind: [],
    },
    rateLimits: {
      status: "unavailable",
      observedAt: "",
      planType: "",
      primary: null,
      secondary: null,
    },
    series: {
      token_mix: [],
      tool_kind_mix: [],
      request_kind_mix: [],
      turn_status_mix: [],
    },
    ...extras,
  };
}

async function usageLedgerJsonlFiles(outputDir) {
  let entries;
  try {
    entries = await fs.readdir(outputDir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const files = [];
  const candidates = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
    .sort((a, b) => b.name.localeCompare(a.name))
    .slice(0, USAGE_LEDGER_ANALYTICS_FILE_LIMIT * 2);
  for (const entry of candidates) {
    const filePath = path.join(outputDir, entry.name);
    try {
      const stat = await fs.stat(filePath);
      files.push({ filePath, mtimeMs: stat.mtimeMs });
    } catch {}
  }
  return files
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, USAGE_LEDGER_ANALYTICS_FILE_LIMIT);
}

async function readUsageLedgerRows(filePath, onRow, budget) {
  if (!budget || budget.remaining <= 0) return;
  const stream = fsSync.createReadStream(filePath, { encoding: "utf8" });
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (budget.remaining <= 0) break;
      const trimmed = String(line || "").trim();
      if (!trimmed) continue;
      budget.remaining -= 1;
      try {
        const row = JSON.parse(trimmed);
        if (isPlainObject(row)) onRow(row);
      } catch {}
    }
  } finally {
    lines.close();
    stream.destroy();
  }
}

function usageRowObservedAt(row) {
  const value = normalizeString(row?.observedAt || row?.completedAt || row?.startedAt || row?.createdAt, "");
  const millis = Date.parse(value);
  return { value, millis: Number.isFinite(millis) ? millis : 0 };
}

function rowMatchesUsageThread(row, projectId, threadId) {
  const rowProjectId = normalizeString(row?.projectId, "");
  if (rowProjectId && rowProjectId !== projectId) return false;
  const kind = normalizeString(row?.rowKind, "");
  if (kind === "rate_limit_snapshot") return true;
  const rowThreadId = normalizeString(row?.threadId, "");
  return Boolean(threadId && rowThreadId && rowThreadId === threadId);
}

function rateLimitWindowSummary(value) {
  if (!isPlainObject(value)) return null;
  const usedPercent = safeUsageNumber(value.usedPercent, NaN);
  const numericResetsAt = Number(value.resetsAt);
  const resetsAtIso = normalizeString(
    value.resetsAtIso,
    Number.isFinite(numericResetsAt) ? new Date(numericResetsAt * 1000).toISOString() : "",
  );
  return {
    name: normalizeString(value.name || value.windowName || value.rateLimitReachedType, ""),
    usedPercent: Number.isFinite(usedPercent) ? usedPercent : null,
    windowDurationMins: safeUsageNumber(value.windowDurationMins, 0),
    resetsAt: resetsAtIso || normalizeString(value.resetsAt, ""),
    resetSeconds: safeUsageNumber(value.resetSeconds, 0),
  };
}

async function readUsageLedgerAnalytics(project, threadId) {
  const thread = normalizeString(threadId, "");
  const location = usageLedgerOutputLocation(project);
  if (location.status !== "configured") {
    return emptyUsageLedgerAnalytics(location.status, location.reason, {
      outputDirEvidenceKey: location.outputDirEvidenceKey || "",
    });
  }

  let files = [];
  try {
    files = await usageLedgerJsonlFiles(location.outputDir);
  } catch {
    return emptyUsageLedgerAnalytics("failed", "Unable to list usage ledger files.", {
      outputDirEvidenceKey: location.outputDirEvidenceKey,
    });
  }

  if (!files.length) {
    return emptyUsageLedgerAnalytics("empty", "No usage ledger files have been written for this project yet.", {
      outputDirEvidenceKey: location.outputDirEvidenceKey,
    });
  }

  const turnMap = new Map();
  const toolMap = new Map();
  const requestMap = new Map();
  const toolKinds = new Map();
  const requestKinds = new Map();
  let rowCount = 0;
  let matchedRowCount = 0;
  let skippedFileCount = 0;
  let latestObservedAt = "";
  let latestObservedMs = 0;
  let latestTokenRow = null;
  let latestTokenMs = 0;
  let tokenRows = 0;
  let latestRateLimitRow = null;
  let latestRateLimitMs = 0;
  let sawProviderExact = false;
  let sawRuntimeExact = false;
  const budget = { remaining: USAGE_LEDGER_ANALYTICS_ROW_LIMIT };

  const observeTimestamp = (row) => {
    const observed = usageRowObservedAt(row);
    if (observed.millis >= latestObservedMs) {
      latestObservedMs = observed.millis;
      latestObservedAt = observed.value || latestObservedAt;
    }
    return observed;
  };

  const countMapValue = (map, key, delta = 1) => {
    const normalizedKey = normalizeString(key, "unknown") || "unknown";
    map.set(normalizedKey, (map.get(normalizedKey) || 0) + delta);
  };

  const handleRow = (row) => {
    rowCount += 1;
    if (!rowMatchesUsageThread(row, project.id, thread)) return;
    matchedRowCount += 1;
    const observed = observeTimestamp(row);
    const confidence = normalizeString(row.confidence, "");
    if (confidence === "provider_exact") sawProviderExact = true;
    if (confidence === "runtime_exact") sawRuntimeExact = true;

    const kind = normalizeString(row.rowKind, "");
    if (kind === "turn_started") {
      const turnId = normalizeString(row.turnId, row.rowId || `turn_${matchedRowCount}`);
      const current = turnMap.get(turnId) || {};
      turnMap.set(turnId, {
        ...current,
        turnId,
        startedAt: normalizeString(row.startedAt || row.observedAt, current.startedAt || ""),
        status: current.status === "completed" ? "completed" : "started",
      });
      return;
    }
    if (kind === "turn_completed") {
      const turnId = normalizeString(row.turnId, row.rowId || `turn_${matchedRowCount}`);
      const current = turnMap.get(turnId) || {};
      turnMap.set(turnId, {
        ...current,
        turnId,
        completedAt: normalizeString(row.completedAt || row.observedAt, ""),
        status: "completed",
        durationMs: safeUsageNumber(row.durationMs, current.durationMs || 0),
        timeToFirstTokenMs: safeUsageNumber(row.timeToFirstTokenMs, current.timeToFirstTokenMs || 0),
      });
      return;
    }
    if (kind === "token_usage") {
      tokenRows += 1;
      const tokenMs = observed.millis || safeUsageNumber(row.seq, 0);
      if (!latestTokenRow || tokenMs >= latestTokenMs) {
        latestTokenRow = row;
        latestTokenMs = tokenMs;
      }
      return;
    }
    if (kind.startsWith("tool_call_")) {
      const toolId = normalizeString(row.toolCallId || row.itemId || row.rowId, `tool_${matchedRowCount}`);
      const current = toolMap.get(toolId) || {};
      const toolKind = normalizeString(row.toolKind || row.itemKind || row.threadItemType || current.toolKind, "unknown");
      const status =
        kind === "tool_call_failed"
          ? "failed"
          : kind === "tool_call_completed"
            ? "completed"
            : current.status || "started";
      toolMap.set(toolId, {
        ...current,
        toolId,
        toolKind,
        status,
        durationMs: safeUsageNumber(row.durationMs, current.durationMs || 0),
      });
      return;
    }
    if (kind.startsWith("server_request_")) {
      const requestId = normalizeString(row.requestKey || row.requestId || row.rowId, `request_${matchedRowCount}`);
      const current = requestMap.get(requestId) || {};
      const requestKind = normalizeString(row.serverRequestKind || row.method || current.requestKind, "unknown");
      const status =
        kind === "server_request_resolved"
          ? "resolved"
          : kind === "server_request_failed"
            ? "failed"
            : current.status || "pending";
      requestMap.set(requestId, { ...current, requestId, requestKind, status });
      return;
    }
    if (kind === "rate_limit_snapshot") {
      const rateMs = observed.millis || safeUsageNumber(row.seq, 0);
      if (!latestRateLimitRow || rateMs >= latestRateLimitMs) {
        latestRateLimitRow = row;
        latestRateLimitMs = rateMs;
      }
    }
  };

  for (const file of files) {
    if (budget.remaining <= 0) {
      skippedFileCount += 1;
      continue;
    }
    try {
      await readUsageLedgerRows(file.filePath, handleRow, budget);
    } catch {
      skippedFileCount += 1;
    }
  }

  for (const tool of toolMap.values()) countMapValue(toolKinds, tool.toolKind);
  for (const request of requestMap.values()) countMapValue(requestKinds, request.requestKind);

  const turns = Array.from(turnMap.values());
  const tools = Array.from(toolMap.values());
  const requests = Array.from(requestMap.values());
  const completedTurns = turns.filter((turn) => turn.status === "completed");
  const activeTurns = turns.filter((turn) => turn.status !== "completed");
  const turnDurationMs = completedTurns.reduce((sum, turn) => sum + safeUsageNumber(turn.durationMs, 0), 0);
  const firstTokenSamples = completedTurns.map((turn) => safeUsageNumber(turn.timeToFirstTokenMs, 0)).filter((value) => value > 0);
  const tokenConfidence = latestTokenRow
    ? normalizeString(latestTokenRow.confidence, sawProviderExact ? "provider_exact" : "runtime_exact")
    : "unknown";
  const inputTokens = safeUsageNumber(latestTokenRow?.inputTokens, 0);
  const cachedInputTokens = safeUsageNumber(latestTokenRow?.cachedInputTokens, 0);
  const nonCachedInputTokens = safeUsageNumber(
    latestTokenRow?.nonCachedInputTokens,
    Math.max(0, inputTokens - cachedInputTokens),
  );
  const outputTokens = safeUsageNumber(latestTokenRow?.outputTokens, 0);
  const reasoningOutputTokens = safeUsageNumber(latestTokenRow?.reasoningOutputTokens, 0);
  const totalTokens = safeUsageNumber(
    latestTokenRow?.totalTokens,
    inputTokens + outputTokens,
  );
  const byKind = Array.from(toolKinds.entries())
    .map(([xValue, yValue]) => ({ xValue, yValue }))
    .sort((a, b) => Number(b.yValue || 0) - Number(a.yValue || 0));
  const byRequestKind = Array.from(requestKinds.entries())
    .map(([xValue, yValue]) => ({ xValue, yValue }))
    .sort((a, b) => Number(b.yValue || 0) - Number(a.yValue || 0));

  return {
    schemaVersion: 1,
    status: matchedRowCount ? (skippedFileCount ? "partial" : "available") : "empty",
    reason: matchedRowCount
      ? ""
      : "Usage ledger files exist, but no rows were matched for this thread yet.",
    source: "codex_usage_ledger@1",
    outputDirEvidenceKey: location.outputDirEvidenceKey,
    fileCount: files.length,
    skippedFileCount,
    rowCount,
    matchedRowCount,
    rowLimitReached: budget.remaining <= 0,
    lastObservedAt: latestObservedAt,
    confidence: sawProviderExact ? "provider_exact" : sawRuntimeExact ? "runtime_exact" : "unknown",
    tokens: {
      status: latestTokenRow ? "snapshot_available" : "unavailable",
      tokenRows,
      latestSnapshotAt: latestTokenRow ? usageRowObservedAt(latestTokenRow).value : "",
      usageScope: normalizeString(latestTokenRow?.usageScope, ""),
      inputTokens,
      cachedInputTokens,
      nonCachedInputTokens,
      outputTokens,
      reasoningOutputTokens,
      totalTokens,
      modelContextWindow: safeUsageNumber(latestTokenRow?.modelContextWindow, 0),
      confidence: tokenConfidence,
    },
    turns: {
      started: turns.length,
      completed: completedTurns.length,
      active: activeTurns.length,
      durationMs: turnDurationMs,
      timeToFirstTokenMs: firstTokenSamples.length
        ? firstTokenSamples.reduce((sum, value) => sum + value, 0) / firstTokenSamples.length
        : 0,
    },
    tools: {
      total: tools.length,
      completed: tools.filter((tool) => tool.status === "completed").length,
      failed: tools.filter((tool) => tool.status === "failed").length,
      commands: tools.filter((tool) => tool.toolKind === "command_exec").length,
      patches: tools.filter((tool) => tool.toolKind === "file_change").length,
      subagents: tools.filter((tool) => tool.toolKind === "subagent" || tool.toolKind === "collab_agent").length,
      byKind,
    },
    requests: {
      total: requests.length,
      pending: requests.filter((request) => request.status === "pending").length,
      resolved: requests.filter((request) => request.status === "resolved").length,
      failed: requests.filter((request) => request.status === "failed").length,
      byKind: byRequestKind,
    },
    rateLimits: latestRateLimitRow
      ? {
          status: "available",
          observedAt: usageRowObservedAt(latestRateLimitRow).value,
          planType: normalizeString(latestRateLimitRow.planType, ""),
          primary: rateLimitWindowSummary(latestRateLimitRow.primary),
          secondary: rateLimitWindowSummary(latestRateLimitRow.secondary),
        }
      : {
          status: "unavailable",
          observedAt: "",
          planType: "",
          primary: null,
          secondary: null,
        },
    series: {
      token_mix: latestTokenRow
        ? [
            { xValue: "input", yValue: nonCachedInputTokens },
            { xValue: "cached", yValue: cachedInputTokens },
            { xValue: "output", yValue: outputTokens },
            { xValue: "reasoning", yValue: reasoningOutputTokens },
          ].filter((point) => Number(point.yValue) > 0)
        : [],
      tool_kind_mix: byKind,
      request_kind_mix: byRequestKind,
      turn_status_mix: [
        { xValue: "completed", yValue: completedTurns.length },
        { xValue: "active", yValue: activeTurns.length },
      ].filter((point) => Number(point.yValue) > 0),
    },
  };
}

module.exports = {
  readUsageLedgerAnalytics,
};
