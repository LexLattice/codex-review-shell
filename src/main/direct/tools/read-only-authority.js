"use strict";

const crypto = require("node:crypto");

const DIRECT_READONLY_TOOL_RESULT_SCHEMA = "direct_codex_readonly_tool_result@1";
const READ_FILE_TOOL_NAMES = new Set(["read_file", "readFile"]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function nowIso(nowMs = Date.now()) {
  return new Date(Number(nowMs) || Date.now()).toISOString();
}

function resultIdForObligation(obligationId) {
  const digest = crypto.createHash("sha256").update(normalizeString(obligationId, "")).digest("hex").slice(0, 20);
  return `tool_result_${digest}`;
}

function parseArgumentsJson(obligation = {}) {
  const text = normalizeString(obligation.argumentsText, "");
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    return isPlainObject(parsed) ? parsed : {};
  } catch (error) {
    const parseError = new Error(`Tool obligation arguments are not valid JSON: ${error.message}`);
    parseError.code = "invalid_tool_arguments";
    throw parseError;
  }
}

function normalizeRelativePath(value) {
  const text = normalizeString(value, "").replace(/\\/g, "/");
  if (!text || text.startsWith("/") || /^[A-Za-z]:\//.test(text) || text.split("/").includes("..")) {
    const error = new Error("read_file tool requires a relative workspace path.");
    error.code = "invalid_read_file_path";
    throw error;
  }
  return text.replace(/^\.\/+/, "");
}

function assertReadFileObligation(obligation = {}) {
  if (!READ_FILE_TOOL_NAMES.has(normalizeString(obligation.name, ""))) {
    const error = new Error(`Unsupported direct read-only tool: ${obligation.name || "unknown"}`);
    error.code = "unsupported_readonly_tool";
    throw error;
  }
  const args = parseArgumentsJson(obligation);
  return {
    relPath: normalizeRelativePath(args.path || args.relPath || args.relativePath),
  };
}

function projectReadResult(raw = {}, obligation = {}, approvedAt = "") {
  const result = isPlainObject(raw) ? raw : {};
  const text = normalizeString(result.text, "");
  const textPreview = text.length > 8000 ? `${text.slice(0, 8000)}...` : text;
  return {
    schema: DIRECT_READONLY_TOOL_RESULT_SCHEMA,
    resultId: resultIdForObligation(obligation.obligationId),
    obligationId: obligation.obligationId,
    tool: normalizeString(obligation.name, "read_file"),
    status: "completed",
    relPath: normalizeString(result.relPath, ""),
    size: Number(result.size || 0),
    truncated: Boolean(result.truncated),
    binary: Boolean(result.binary),
    textPreview,
    summary: `${normalizeString(result.relPath, "file")} · ${Number(result.size || 0)} bytes${result.truncated ? " · truncated" : ""}`,
    source: normalizeString(result.source, ""),
    approvedAt,
    recordedAt: nowIso(),
    sideEffectExecuted: false,
    rawWorkspacePathExposed: false,
  };
}

function approveReadOnlyToolObligation(options = {}) {
  const sessionStore = options.sessionStore;
  if (!sessionStore) throw new Error("Read-only tool approval requires a direct session store.");
  const { obligation } = sessionStore.findToolObligation(options.sessionId, options.turnId, options.obligationId);
  const parsed = assertReadFileObligation(obligation);
  const approvedAt = nowIso(options.nowMs);
  return sessionStore.updateToolObligation(options.sessionId, options.turnId, obligation.obligationId, {
    status: "approved",
    authorityState: "approved_readonly",
    executionAllowed: true,
    continuationAllowed: false,
    approvedAt,
    approvedBy: normalizeString(options.approvedBy, "local-user"),
    approvedRead: {
      tool: normalizeString(obligation.name, "read_file"),
      relPath: parsed.relPath,
    },
  }, {
    ...options,
    nextTurnState: "authority_waiting",
  });
}

async function executeApprovedReadOnlyToolObligation(options = {}) {
  const sessionStore = options.sessionStore;
  if (!sessionStore) throw new Error("Read-only tool execution requires a direct session store.");
  if (typeof options.workspaceRequest !== "function") throw new Error("Read-only tool execution requires workspaceRequest.");
  const { obligation } = sessionStore.findToolObligation(options.sessionId, options.turnId, options.obligationId);
  if (isPlainObject(obligation.result)) {
    return {
      reused: true,
      obligation,
      result: obligation.result,
    };
  }
  if (obligation.status !== "approved" || obligation.authorityState !== "approved_readonly") {
    const error = new Error("Read-only tool obligation must be approved before execution.");
    error.code = "tool_obligation_not_approved";
    throw error;
  }
  const parsed = assertReadFileObligation(obligation);
  const workspaceResult = await options.workspaceRequest("readFile", { relPath: parsed.relPath });
  const result = projectReadResult(workspaceResult, obligation, obligation.approvedAt || "");
  const updated = sessionStore.updateToolObligation(options.sessionId, options.turnId, obligation.obligationId, {
    status: "result_recorded",
    authorityState: "result_recorded",
    executionAllowed: false,
    continuationAllowed: false,
    sideEffectExecuted: false,
    result,
    resultRecordedAt: result.recordedAt,
  }, {
    ...options,
    nextTurnState: "continuation_ready",
  });
  return {
    reused: false,
    obligation: updated.obligation,
    result,
  };
}

module.exports = {
  DIRECT_READONLY_TOOL_RESULT_SCHEMA,
  approveReadOnlyToolObligation,
  executeApprovedReadOnlyToolObligation,
  projectReadResult,
};
