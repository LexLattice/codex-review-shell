"use strict";

const crypto = require("node:crypto");
const { normalizeString, nowIso } = require("../meta-session/ids");

const SUB_AGENT_TRANSCRIPT_PROJECTION_V2_SCHEMA = "sub_agent_transcript_projection_v2@1";
const SUB_AGENT_TRANSCRIPT_AUTHOR_PROJECTION_SCHEMA = "sub_agent_transcript_author_projection@1";
const SUB_AGENT_TRANSCRIPT_VISIBILITY_SCHEMA = "sub_agent_transcript_visibility@1";

const TRANSCRIPT_PROJECTION_MODES = Object.freeze([
  "turn_activity",
  "full_child_history",
  "result_summary",
]);

const AUTHOR_KINDS = Object.freeze([
  "operator",
  "primary_agent",
  "parent_agent",
  "child_agent",
  "harness_controller",
  "tool",
  "system",
  "unknown_agent",
]);

const AUTHOR_CONFIDENCE = Object.freeze([
  "thread_metadata",
  "collab_tool_call",
  "harness_record",
  "session_source",
  "human_authored",
  "unknown",
]);

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

function stableStringify(value) {
  if (value && typeof value.toJSON === "function") return stableStringify(value.toJSON());
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => (entry === undefined ? "null" : stableStringify(entry))).join(",")}]`;
  return `{${Object.keys(value)
    .filter((key) => value[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(",")}}`;
}

function digestFor(domain, value) {
  return crypto.createHash("sha256").update(`${domain}:${stableStringify(value)}`).digest("hex");
}

function normalizeEnum(value, allowed, fallback) {
  const normalized = normalizeString(value, fallback);
  return allowed.includes(normalized) ? normalized : fallback;
}

function sourceRef(kind, id, label) {
  const ref = {
    kind: normalizeString(kind, "unknown_source"),
  };
  if (normalizeString(id, "")) ref.id = normalizeString(id, "");
  if (normalizeString(label, "")) ref.label = normalizeString(label, "");
  return ref;
}

function boundedText(value, maxLength = 1200) {
  const text = normalizeString(value, "");
  if (!text) return { displayText: "", textTruncated: false };
  if (text.length <= maxLength) return { displayText: text, textTruncated: false };
  return {
    displayText: `${text.slice(0, Math.max(0, maxLength - 1))}…`,
    textTruncated: true,
  };
}

function parseCursor(cursor) {
  const normalized = normalizeString(cursor, "");
  if (!normalized) return 0;
  const match = /^offset:(\d+)$/.exec(normalized);
  if (!match) return 0;
  return Number.parseInt(match[1], 10) || 0;
}

function normalizeLimit(limit) {
  const parsed = Number.parseInt(limit, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

function isChildUserMessage(item = {}) {
  if (!item || typeof item !== "object") return false;
  return ["user", "user_message", "child_user_message", "parent_prompt"].includes(normalizeString(item.messageRole || item.role || item.itemKind || item.kind || item.type, ""));
}

function isChildAgentMessage(item = {}) {
  if (!item || typeof item !== "object") return false;
  return ["assistant", "agent", "agent_message", "child_agent_message", "child_answer"].includes(normalizeString(item.messageRole || item.role || item.itemKind || item.kind || item.type, ""));
}

function isToolEvidenceItem(item = {}) {
  if (!item || typeof item !== "object") return false;
  return ["tool", "tool_call", "tool_result", "command", "patch", "harness"].includes(normalizeString(item.rowKind || item.itemKind || item.kind || item.type || item.role, ""));
}

function normalizeAuthorProjection(item = {}, context = {}) {
  const safeItem = item && typeof item === "object" ? item : {};
  const safeContext = context && typeof context === "object" ? context : {};
  const humanAuthored = safeItem.humanAuthored === true;
  let kind = normalizeEnum(safeItem.authorKind, AUTHOR_KINDS, "");
  if (!kind) {
    if (humanAuthored) kind = "operator";
    else if (isChildAgentMessage(safeItem)) kind = "child_agent";
    else if (isChildUserMessage(safeItem)) kind = normalizeString(safeContext.parentAgentId || safeItem.parentAgentId, "") ? "parent_agent" : "harness_controller";
    else if (isToolEvidenceItem(safeItem)) kind = "tool";
    else if (normalizeString(safeItem.role || safeItem.kind || safeItem.type, "") === "system") kind = "system";
    else kind = "unknown_agent";
  }
  const fallbackLabel = (() => {
    if (kind === "operator") return "Operator";
    if (kind === "parent_agent") return normalizeString(safeContext.parentAgentLabel || safeItem.parentAgentLabel, "Parent agent");
    if (kind === "child_agent") return normalizeString(safeContext.childAgentLabel || safeItem.childAgentLabel, "Child agent");
    if (kind === "harness_controller") return "Harness controller";
    if (kind === "tool") return normalizeString(safeItem.toolName || safeItem.label || safeItem.itemKind, "Tool");
    if (kind === "system") return "System";
    return "Unknown agent";
  })();
  return {
    schema: SUB_AGENT_TRANSCRIPT_AUTHOR_PROJECTION_SCHEMA,
    kind,
    displayLabel: normalizeString(safeItem.authorLabel || safeItem.displayLabel, fallbackLabel),
    childAgentId: normalizeString(safeItem.childAgentId || safeContext.childAgentId, ""),
    childThreadId: normalizeString(safeItem.childThreadId || safeContext.childThreadId, ""),
    parentThreadId: normalizeString(safeItem.parentThreadId || safeContext.parentThreadId, ""),
    parentAgentId: normalizeString(safeItem.parentAgentId || safeContext.parentAgentId, ""),
    confidence: normalizeEnum(safeItem.authorConfidence || safeItem.confidence, AUTHOR_CONFIDENCE, humanAuthored ? "human_authored" : "harness_record"),
    humanAuthored,
    evidenceRefs: Array.isArray(safeItem.authorEvidenceRefs) && safeItem.authorEvidenceRefs.length
      ? safeItem.authorEvidenceRefs
      : [sourceRef("author_projection", safeItem.itemId || safeItem.eventId, "author projection source")],
  };
}

function normalizeTranscriptRow(item = {}, context = {}, options = {}) {
  const safeItem = item && typeof item === "object" ? item : {};
  const safeContext = context && typeof context === "object" ? context : {};
  const safeOptions = options && typeof options === "object" ? options : {};
  const rowKind = isToolEvidenceItem(safeItem) ? "tool" : normalizeEnum(safeItem.rowKind || safeItem.kind || safeItem.type, [
    "message",
    "tool",
    "system",
    "result_summary",
    "diagnostic",
    "activity",
  ], isChildAgentMessage(safeItem) || isChildUserMessage(safeItem) ? "message" : "activity");
  const { displayText, textTruncated } = boundedText(safeItem.displayText || safeItem.text || safeItem.summary || safeItem.outputPreview, safeOptions.maxDisplayText);
  const row = {
    rowId: normalizeString(safeItem.rowId || safeItem.itemId || safeItem.eventId, `child_transcript_row_${digestFor("child-transcript-row-id@1", safeItem).slice(0, 16)}`),
    rowKind,
    itemKind: normalizeString(safeItem.itemKind || safeItem.kind || safeItem.type, rowKind),
    messageRole: normalizeString(safeItem.messageRole || safeItem.role, rowKind === "message" && isChildAgentMessage(safeItem) ? "assistant" : rowKind === "message" ? "user" : ""),
    parentTurnId: normalizeString(safeItem.parentTurnId || safeContext.parentTurnId, ""),
    childTurnId: normalizeString(safeItem.childTurnId || safeItem.turnId, ""),
    childThreadId: normalizeString(safeItem.childThreadId || safeContext.childThreadId, ""),
    childAgentId: normalizeString(safeItem.childAgentId || safeContext.childAgentId, ""),
    author: normalizeAuthorProjection(safeItem, safeContext),
    displayText,
    textTruncated,
    sourceRefs: Array.isArray(safeItem.sourceRefs) && safeItem.sourceRefs.length
      ? safeItem.sourceRefs
      : [sourceRef("child_transcript_item", safeItem.itemId || safeItem.eventId || safeItem.rowId, "child transcript item")],
    rawProviderPayloadIncluded: false,
    rawHiddenPromptIncluded: false,
    rawPromptPayloadIncluded: false,
    rawResultPayloadIncluded: false,
    rawChildTranscriptIncludedInPrimary: false,
  };
  row.rowDigest = digestFor("sub-agent-transcript-row@1", row);
  return row;
}

function visibilityForMode(mode) {
  if (mode === "full_child_history") {
    return {
      schema: SUB_AGENT_TRANSCRIPT_VISIBILITY_SCHEMA,
      rendererVisible: true,
      residentContextVisible: "none",
      providerVisible: "not_seen",
      primaryTranscriptVisible: "none",
    };
  }
  if (mode === "result_summary") {
    return {
      schema: SUB_AGENT_TRANSCRIPT_VISIBILITY_SCHEMA,
      rendererVisible: true,
      residentContextVisible: "summary_only",
      providerVisible: "summary_only",
      primaryTranscriptVisible: "activity_summary_only",
    };
  }
  return {
    schema: SUB_AGENT_TRANSCRIPT_VISIBILITY_SCHEMA,
    rendererVisible: true,
    residentContextVisible: "summary_only",
    providerVisible: "not_applicable",
    primaryTranscriptVisible: "activity_summary_only",
  };
}

function selectItemsForMode(items, mode, context = {}) {
  const safeContext = context && typeof context === "object" ? context : {};
  const rows = Array.isArray(items) ? items.filter((item) => item && typeof item === "object") : [];
  if (mode === "turn_activity") {
    const parentTurnId = normalizeString(safeContext.parentTurnId, "");
    return parentTurnId ? rows.filter((item) => normalizeString(item.parentTurnId, "") === parentTurnId) : rows;
  }
  if (mode === "result_summary") {
    return rows.filter((item) => normalizeString(item.rowKind || item.kind || item.itemKind || item.type, "") === "result_summary" || item.resultSummary === true);
  }
  return rows;
}

function paginateItems(items, mode, cursor, limit) {
  if (mode !== "full_child_history") {
    return {
      selected: items,
      cursor: undefined,
      limit: items.length || limit,
      hasMore: false,
      nextCursor: undefined,
    };
  }
  const offset = parseCursor(cursor);
  const selected = items.slice(offset, offset + limit);
  const nextOffset = offset + selected.length;
  const hasMore = nextOffset < items.length;
  return {
    selected,
    cursor: offset > 0 ? `offset:${offset}` : undefined,
    limit,
    hasMore,
    nextCursor: hasMore ? `offset:${nextOffset}` : undefined,
  };
}

function buildPrimaryTranscriptSummary(projection, context = {}) {
  if (projection.visibility.primaryTranscriptVisible === "none") return undefined;
  return {
    kind: "sub_agent_activity_summary_link",
    label: normalizeString(context.childAgentLabel, "Sub-agent activity"),
    childAgentId: projection.childAgentId,
    childThreadId: projection.childThreadId,
    targetProjectionId: projection.projectionId,
    mode: projection.mode,
    rowCount: projection.rows.length,
    rawChildTranscriptIncluded: false,
  };
}

function buildSubAgentTranscriptProjectionV2(input = {}, options = {}) {
  const safeInput = input && typeof input === "object" ? input : {};
  const safeOptions = options && typeof options === "object" ? options : {};
  const mode = normalizeEnum(safeInput.mode, TRANSCRIPT_PROJECTION_MODES, "turn_activity");
  const childAgentId = normalizeString(safeInput.childAgentId || safeInput.agentId, "agent_unknown");
  const childThreadId = normalizeString(safeInput.childThreadId || safeInput.threadId, childAgentId);
  const context = {
    childAgentId,
    childThreadId,
    parentThreadId: normalizeString(safeInput.parentThreadId, "thread_parent_unknown"),
    parentAgentId: normalizeString(safeInput.parentAgentId, ""),
    parentAgentLabel: normalizeString(safeInput.parentAgentLabel, "Parent agent"),
    parentTurnId: normalizeString(safeInput.parentTurnId, ""),
    childAgentLabel: normalizeString(safeInput.childAgentLabel || safeInput.agentLabel, "Child agent"),
  };
  const limit = normalizeLimit(safeInput.limit || safeOptions.limit);
  const selectedForMode = selectItemsForMode(safeInput.items, mode, context);
  const page = paginateItems(selectedForMode, mode, safeInput.cursor, limit);
  const rows = page.selected.map((item) => normalizeTranscriptRow(item, context, safeOptions));
  const projection = {
    schema: SUB_AGENT_TRANSCRIPT_PROJECTION_V2_SCHEMA,
    projectionId: normalizeString(safeInput.projectionId, `sub_agent_transcript_projection_${digestFor("sub-agent-transcript-projection-id@1", {
      mode,
      childAgentId,
      childThreadId,
      parentThreadId: context.parentThreadId,
      parentTurnId: context.parentTurnId,
      cursor: page.cursor,
    }).slice(0, 16)}`),
    mode,
    childAgentId,
    childThreadId,
    parentThreadId: context.parentThreadId,
    parentTurnId: context.parentTurnId,
    workThreadId: normalizeString(safeInput.workThreadId, "work_thread_unknown"),
    generatedAt: nowIso(safeOptions.now || Date.now),
    visibility: visibilityForMode(mode),
    childTranscriptFlattened: false,
    rawProviderPayloadIncluded: false,
    rawHiddenPromptIncluded: false,
    rawPromptPayloadIncluded: false,
    rawResultPayloadIncluded: false,
    rawChildTranscriptIncludedInPrimary: false,
    contextAdmissionWritten: false,
    providerTransportStarted: false,
    primaryTranscriptMutationStarted: false,
    cursor: page.cursor,
    limit: page.limit,
    hasMore: page.hasMore,
    nextCursor: page.nextCursor,
    rows,
    sourceRefs: Array.isArray(safeInput.sourceRefs) && safeInput.sourceRefs.length
      ? safeInput.sourceRefs
      : [sourceRef("sub_agent_transcript_source", childThreadId, "child transcript projection source")],
    operatorProjectionCompatibility: {
      compatibleWith: "resident_sub_agent_operator_projection@1",
      primaryTranscriptReceives: "summary_link_only",
      childMessagesRemainChildScoped: true,
    },
  };
  projection.primaryTranscriptSummary = buildPrimaryTranscriptSummary(projection, context);
  projection.projectionDigest = digestFor("sub-agent-transcript-projection-v2@1", projection);
  validateSubAgentTranscriptProjectionV2(projection);
  return projection;
}

function validateSubAgentTranscriptProjectionV2(projection = {}) {
  const errors = [];
  if (!projection || typeof projection !== "object" || Array.isArray(projection)) {
    throw new Error("sub_agent_transcript_projection_v2_invalid_object");
  }
  if (projection.schema !== SUB_AGENT_TRANSCRIPT_PROJECTION_V2_SCHEMA) throw new Error("sub_agent_transcript_projection_v2_schema_mismatch");
  for (const field of ["projectionId", "mode", "childAgentId", "childThreadId", "parentThreadId", "workThreadId", "projectionDigest"]) {
    if (!normalizeString(projection[field], "")) errors.push(`missing_required_string:${field}`);
  }
  if (!TRANSCRIPT_PROJECTION_MODES.includes(projection.mode)) errors.push(`invalid_mode:${projection.mode}`);
  if (projection.visibility?.schema !== SUB_AGENT_TRANSCRIPT_VISIBILITY_SCHEMA) errors.push("visibility_schema_mismatch");
  if (projection.mode === "full_child_history") {
    if (projection.visibility?.residentContextVisible !== "none") errors.push("full_history_context_admission_leak");
    if (projection.visibility?.primaryTranscriptVisible !== "none") errors.push("full_history_primary_transcript_leak");
    if (projection.contextAdmissionWritten !== false) errors.push("full_history_context_written");
    if (projection.primaryTranscriptSummary !== undefined) errors.push("full_history_primary_summary_leak");
  }
  if (projection.mode === "turn_activity" && projection.visibility?.primaryTranscriptVisible !== "activity_summary_only") {
    errors.push("turn_activity_primary_visibility_invalid");
  }
  if (!Array.isArray(projection.rows)) errors.push("rows_missing");
  if (!Array.isArray(projection.sourceRefs) || !projection.sourceRefs.length) errors.push("source_refs_missing");
  if (!Number.isInteger(projection.limit) || projection.limit <= 0 || projection.limit > MAX_LIMIT) errors.push("invalid_limit");
  if (projection.hasMore === true && !normalizeString(projection.nextCursor, "")) errors.push("pagination_missing_next_cursor");
  if (projection.hasMore !== true && normalizeString(projection.nextCursor, "")) errors.push("pagination_unexpected_next_cursor");
  for (const flag of [
    "childTranscriptFlattened",
    "rawProviderPayloadIncluded",
    "rawHiddenPromptIncluded",
    "rawPromptPayloadIncluded",
    "rawResultPayloadIncluded",
    "rawChildTranscriptIncludedInPrimary",
    "providerTransportStarted",
    "primaryTranscriptMutationStarted",
  ]) {
    if (projection[flag] !== false) errors.push(`projection_boundary_leak:${flag}`);
  }
  const rows = Array.isArray(projection.rows) ? projection.rows : [];
  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      errors.push("row_invalid_object");
      continue;
    }
    if (!normalizeString(row.rowId, "")) errors.push("row_missing_id");
    if (row.author?.schema !== SUB_AGENT_TRANSCRIPT_AUTHOR_PROJECTION_SCHEMA) errors.push(`row_author_schema_mismatch:${row.rowId}`);
    if (isChildUserMessage(row) && row.author?.kind === "operator" && row.author?.humanAuthored !== true) {
      errors.push(`child_user_rendered_as_operator:${row.rowId}`);
    }
    if (isChildAgentMessage(row) && row.author?.kind === "primary_agent") {
      errors.push(`child_agent_rendered_as_primary:${row.rowId}`);
    }
    for (const flag of [
      "rawProviderPayloadIncluded",
      "rawHiddenPromptIncluded",
      "rawPromptPayloadIncluded",
      "rawResultPayloadIncluded",
      "rawChildTranscriptIncludedInPrimary",
    ]) {
      if (row[flag] !== false) errors.push(`row_boundary_leak:${flag}:${row.rowId}`);
    }
  }
  if (!errors.length) return true;
  throw new Error(`sub_agent_transcript_projection_v2_validation_failed:${errors.join(",")}`);
}

module.exports = {
  AUTHOR_CONFIDENCE,
  AUTHOR_KINDS,
  SUB_AGENT_TRANSCRIPT_AUTHOR_PROJECTION_SCHEMA,
  SUB_AGENT_TRANSCRIPT_PROJECTION_V2_SCHEMA,
  SUB_AGENT_TRANSCRIPT_VISIBILITY_SCHEMA,
  TRANSCRIPT_PROJECTION_MODES,
  buildSubAgentTranscriptProjectionV2,
  validateSubAgentTranscriptProjectionV2,
};
