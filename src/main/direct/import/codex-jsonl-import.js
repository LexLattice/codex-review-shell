"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
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

function nowIso(nowMs = Date.now()) {
  return new Date(Number(nowMs) || Date.now()).toISOString();
}

function stableDigest(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, 20);
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

  timestamps.sort();
  return {
    schema: "direct_codex_import_candidate@1",
    source: {
      harness: "codex-cli-or-app-server-jsonl",
      filePath: sourcePath,
      codexHome: options.codexHome ? path.resolve(options.codexHome) : "",
      threadId: [...threadIds][0] || options.threadId || "",
      timestampStart: timestamps[0] || "",
      timestampEnd: timestamps[timestamps.length - 1] || "",
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

function checkpointMessagesFromCandidate(candidate = {}) {
  return (Array.isArray(candidate.nodes) ? candidate.nodes : [])
    .filter((node) => node?.factKind === "message" && node.role)
    .map((node) => ({
      seq: node.seq,
      role: node.role,
      text: node.text,
      timestamp: node.timestamp || "",
      sourceType: node.sourceType || "unknown",
    }));
}

function buildDirectCheckpointCandidate(importCandidate, options = {}) {
  if (!importCandidate || importCandidate.schema !== "direct_codex_import_candidate@1") {
    throw new Error("Direct import checkpoint requires a direct_codex_import_candidate@1 candidate.");
  }
  const source = importCandidate.source || {};
  const messages = checkpointMessagesFromCandidate(importCandidate);
  const unresolvedObligations = Array.isArray(importCandidate.unresolvedObligations)
    ? importCandidate.unresolvedObligations.map((obligation) => ({
        ...obligation,
        autoReplayable: false,
        requiresFreshAuthority: true,
      }))
    : [];
  const checkpointSeed = JSON.stringify({
    source,
    messages,
    unresolvedObligations,
  });
  const createdAt = nowIso(options.nowMs);
  return {
    schema: "direct_codex_import_checkpoint_candidate@1",
    checkpointId: `import_checkpoint_${stableDigest(checkpointSeed)}`,
    createdAt,
    state: "checkpoint-candidate",
    runnable: false,
    checkpointedRunnable: false,
    source: {
      harness: source.harness || "codex-cli-or-app-server-jsonl",
      filePath: source.filePath || "",
      codexHome: source.codexHome || "",
      threadId: source.threadId || "",
      timestampStart: source.timestampStart || "",
      timestampEnd: source.timestampEnd || "",
      recordCount: Number(source.recordCount || 0),
    },
    target: {
      harness: "direct-chatgpt-codex",
      state: "checkpoint-candidate",
      runnable: false,
      requiresValidationBeforeRun: true,
      eligibleForContinuation: false,
    },
    checkpoint: {
      title: options.title || `Imported Codex session ${source.threadId || source.filePath || "unknown"}`,
      messages,
      unresolvedObligations,
      evidenceNodeCount: Array.isArray(importCandidate.nodes) ? importCandidate.nodes.length : 0,
      sourceTimestampRange: {
        start: source.timestampStart || "",
        end: source.timestampEnd || "",
      },
    },
    validation: {
      state: messages.length && importCandidate.validation?.sourceTimestampsRetained ? "checkpoint-candidate" : "imported-validation-failed",
      roleBoundariesPreserved: Boolean(importCandidate.validation?.roleBoundariesPreserved),
      userVisibleTextPreserved: Boolean(importCandidate.validation?.userVisibleTextPreserved),
      sourceTimestampsRetained: Boolean(importCandidate.validation?.sourceTimestampsRetained),
      importedToolCallsAutoReplayable: false,
      importedApprovalsCarryAuthority: false,
      unresolvedObligationCount: unresolvedObligations.length,
      notes: [
        "Checkpoint candidate is derived from imported evidence only.",
        "It is not runnable until direct checkpoint validation creates checkpointed-runnable state.",
        "Imported tool calls and approvals do not carry execution authority.",
      ],
    },
  };
}

function validateDirectCheckpointCandidate(checkpointCandidate, options = {}) {
  if (!checkpointCandidate || checkpointCandidate.schema !== "direct_codex_import_checkpoint_candidate@1") {
    throw new Error("Direct import checkpoint validation requires a direct_codex_import_checkpoint_candidate@1 candidate.");
  }
  const source = checkpointCandidate.source || {};
  const checkpoint = checkpointCandidate.checkpoint || {};
  const messages = Array.isArray(checkpoint.messages) ? checkpoint.messages : [];
  const unresolvedObligations = Array.isArray(checkpoint.unresolvedObligations) ? checkpoint.unresolvedObligations : [];
  const gates = {
    sourceFilePathPreserved: Boolean(source.filePath),
    sourceCodexHomePreserved: Boolean(source.codexHome),
    sourceThreadIdPreserved: Boolean(source.threadId),
    sourceTimestampsRetained: Boolean(source.timestampStart && source.timestampEnd),
    roleBoundariesPreserved: messages.length > 0 && messages.every((message) => Boolean(message.role)),
    userVisibleTextPreserved: messages.some((message) => Boolean(message.text)),
    unresolvedImportedToolCallsClear: unresolvedObligations.length === 0,
    importedToolCallsAutoReplayable: false,
    importedApprovalsCarryAuthority: false,
  };
  const sourceValid = gates.sourceFilePathPreserved &&
    gates.sourceCodexHomePreserved &&
    gates.sourceThreadIdPreserved &&
    gates.sourceTimestampsRetained;
  const evidenceValid = gates.roleBoundariesPreserved && gates.userVisibleTextPreserved;
  const runnable = sourceValid && evidenceValid && gates.unresolvedImportedToolCallsClear;
  const validationState = runnable
    ? "checkpointed-runnable"
    : (sourceValid && gates.roleBoundariesPreserved ? "checkpoint-candidate" : "imported-validation-failed");
  const validatedAt = nowIso(options.nowMs);
  return {
    ...checkpointCandidate,
    state: validationState,
    runnable,
    checkpointedRunnable: runnable,
    validatedAt,
    target: {
      ...(checkpointCandidate.target || {}),
      state: validationState,
      runnable,
      requiresValidationBeforeRun: !runnable,
      eligibleForContinuation: runnable,
    },
    validation: {
      ...(checkpointCandidate.validation || {}),
      state: validationState,
      validatedAt,
      gates,
      roleBoundariesPreserved: gates.roleBoundariesPreserved,
      userVisibleTextPreserved: gates.userVisibleTextPreserved,
      sourceTimestampsRetained: gates.sourceTimestampsRetained,
      importedToolCallsAutoReplayable: false,
      importedApprovalsCarryAuthority: false,
      unresolvedObligationCount: unresolvedObligations.length,
      notes: [
        ...(Array.isArray(checkpointCandidate.validation?.notes) ? checkpointCandidate.validation.notes : []),
        runnable
          ? "Checkpoint passed direct validation and is eligible for continuation."
          : "Checkpoint remains non-runnable until all validation gates pass.",
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
  buildDirectCheckpointCandidate,
  buildImportCandidate,
  loadCodexJsonlImportCandidate,
  validateDirectCheckpointCandidate,
};
