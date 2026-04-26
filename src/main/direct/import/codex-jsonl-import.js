"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { parseJsonl } = require("../fixtures/fixture-loader");

function normalizeTimestamp(value) {
  if (typeof value !== "string" || !value.trim()) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function roleFromRecord(record) {
  return firstString(
    record.message?.role,
    record.item?.role,
    record.role,
    record.params?.role,
  );
}

function textFromRecord(record) {
  const content = record.message?.content ?? record.item?.content ?? record.content ?? record.text ?? "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === "string" ? part : part?.text || part?.content || ""))
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function timestampFromRecord(record) {
  return normalizeTimestamp(
    firstString(record.timestamp, record.created_at, record.createdAt, record.at, record.time),
  );
}

function threadIdFromRecord(record) {
  return firstString(
    record.thread_id,
    record.threadId,
    record.session_id,
    record.sessionId,
    record.params?.threadId,
    record.params?.thread_id,
  );
}

function classifyRecord(record) {
  const type = firstString(record.type, record.event, record.method, record.item?.type, "unknown");
  const role = roleFromRecord(record);
  if (role) return { factKind: "message", subtype: role };
  if (/tool|function_call|mcp/i.test(type)) return { factKind: "tool", subtype: type };
  if (/approval|requestApproval|permissions/i.test(type)) return { factKind: "approval", subtype: type };
  if (/diff|patch|fileChange|file_change/i.test(type)) return { factKind: "file_change", subtype: type };
  if (/error|failed/i.test(type)) return { factKind: "error", subtype: type };
  if (/compact|summary/i.test(type)) return { factKind: "compaction", subtype: type };
  return { factKind: "event", subtype: type };
}

function buildImportCandidate(records, options = {}) {
  if (!Array.isArray(records)) throw new Error("Codex JSONL import records must be an array.");
  const sourcePath = options.sourcePath ? path.resolve(options.sourcePath) : "";
  const nodes = [];
  const timestamps = [];
  const threadIds = new Set();
  const unresolvedObligations = [];

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index] || {};
    const timestamp = timestampFromRecord(record);
    if (timestamp) timestamps.push(timestamp);
    const threadId = threadIdFromRecord(record);
    if (threadId) threadIds.add(threadId);

    const classification = classifyRecord(record);
    const node = {
      seq: index,
      timestamp,
      factKind: classification.factKind,
      subtype: classification.subtype,
      role: roleFromRecord(record),
      text: textFromRecord(record),
      sourceType: firstString(record.type, record.event, record.method, record.item?.type, "unknown"),
      rawRecord: record,
    };
    nodes.push(node);

    if (classification.factKind === "tool" && /request|call|started/i.test(classification.subtype)) {
      unresolvedObligations.push({
        seq: index,
        kind: "tool_call_pairing_unverified",
        reason: "Codex JSONL import skeleton does not yet pair tool calls with results.",
      });
    }
  }

  return {
    schema: "direct_codex_import_candidate@1",
    source: {
      harness: "codex-cli-or-app-server-jsonl",
      filePath: sourcePath,
      threadId: [...threadIds][0] || options.threadId || "",
      timestampStart: timestamps.sort()[0] || "",
      timestampEnd: timestamps.sort()[timestamps.length - 1] || "",
      recordCount: records.length,
    },
    target: {
      harness: "direct-chatgpt-codex",
      state: "read-only-imported-evidence",
      runnable: false,
      requiresDirectHarnessCheckpoint: true,
    },
    nodes,
    unresolvedObligations,
    validation: {
      roleBoundariesPreserved: nodes.some((node) => Boolean(node.role)),
      userVisibleTextPreserved: nodes.some((node) => Boolean(node.text)),
      sourceTimestampsRetained: timestamps.length > 0,
      toolCallsAutoReplayable: false,
      notes: [
        "Imported JSONL is evidence only.",
        "No tool call may be replayed until a direct-harness checkpoint validates unresolved obligations.",
      ],
    },
  };
}

function loadCodexJsonlImportCandidate(filePath, options = {}) {
  const resolvedPath = path.resolve(filePath);
  const text = fs.readFileSync(resolvedPath, "utf8");
  return buildImportCandidate(parseJsonl(text, resolvedPath), { ...options, sourcePath: resolvedPath });
}

module.exports = {
  buildImportCandidate,
  loadCodexJsonlImportCandidate,
};
