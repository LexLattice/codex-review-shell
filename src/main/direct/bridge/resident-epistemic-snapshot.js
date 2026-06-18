"use strict";

const crypto = require("node:crypto");
const { scanSensitiveText } = require("../fixtures/redaction");

const RESIDENT_EPISTEMIC_SNAPSHOT_SCHEMA = "resident_epistemic_snapshot@1";
const RESIDENT_EPISTEMIC_ROW_SCHEMA = "resident_epistemic_row@1";
const RESIDENT_EPISTEMIC_CONTEXT_ITEM_SCHEMA = "resident_epistemic_context_item@1";

const SUBJECT_KINDS = new Set([
  "tool",
  "sub_agent",
  "runtime",
  "provider",
  "quota",
  "context",
  "memory",
  "baton",
  "workspace",
  "thread",
  "work_thread",
  "skill",
  "hook",
  "app",
  "browser",
  "headless_route",
  "approval",
  "account_action",
  "analytics",
  "unknown",
]);

const RUNTIME_FAMILIES = new Set(["direct", "appserver"]);
const STATUSES = new Set([
  "callable_now",
  "known_available",
  "known_disabled",
  "shadow_only",
  "not_implemented",
  "blocked_by_policy",
  "blocked_by_missing_evidence",
  "blocked_by_auth",
  "blocked_by_runtime",
  "blocked_by_workthread",
  "temporarily_unavailable",
  "stale",
  "unknown",
]);
const KNOWLEDGE_CLASSES = new Set([
  "exact_runtime",
  "harness_observed",
  "registry_declared",
  "derived_projection",
  "fixture_only",
  "unknown",
]);
const VISIBILITIES = new Set(["full_status", "summary_only", "count_only", "blocked", "unknown"]);
const TRANSCRIPT_VISIBILITIES = new Set(["full", "summary_only", "metadata_only", "blocked", "not_applicable"]);
const CONTROL_STATES = new Set([
  "not_applicable",
  "known_available",
  "callable_now",
  "blocked_by_policy",
  "blocked_by_missing_authority",
  "blocked_by_runtime",
  "shadow_only",
  "unknown",
]);
const EPISTEMIC_USES = new Set([
  "self_status",
  "planning_context",
  "avoidance_context",
  "diagnostic_only",
  "operator_explanation",
]);
const AUTHORITY_USES = new Set(["none", "may_prepare_call", "may_request_authority", "may_not_act"]);
const PRIORITIES = new Set(["critical", "high", "normal", "low", "diagnostic"]);
const CONFLICT_STATES = new Set([
  "none",
  "source_mismatch",
  "policy_overrides_activation",
  "stale_activation",
  "runtime_contradiction",
  "unknown",
]);
const CONFLICT_RESOLUTIONS = new Set([
  "strictest_blocker_wins",
  "freshest_exact_evidence_wins",
  "operator_review_required",
  "diagnostic_only",
]);
const FRESHNESS_VALUES = new Set(["fresh", "expiring", "stale", "unknown"]);
const STALE_BEHAVIORS = new Set(["include_with_warning", "omit_row", "summarize_as_stale", "block_context_injection"]);
const SCOPES = new Set(["global", "project", "work_thread", "thread", "turn", "request"]);
const ENABLEMENT_KINDS = new Set([
  "operator_enablement",
  "auth_login",
  "capability_promotion",
  "runtime_switch",
  "policy_change",
  "live_probe",
  "implementation_required",
  "not_supported",
]);
const ENABLEMENT_USES = new Set([
  "operator_explanation_only",
  "agent_may_request_operator",
  "agent_must_not_request",
]);
const EVIDENCE_SOURCES = new Set([
  "activation_registry",
  "promotion_decision",
  "tool_declaration",
  "agent_graph",
  "sub_agent_e_channel",
  "runtime_status",
  "provider_metadata",
  "quota_snapshot",
  "context_pack",
  "memory_frontier",
  "workspace_policy",
  "headless_daemon",
  "audit_row",
]);
const SNAPSHOT_COMPLETENESS = new Set([
  "complete",
  "budgeted_with_omissions",
  "summary_only",
  "class_filtered",
  "stale_or_partial",
]);

const PRIORITY_ORDER = new Map([
  ["critical", 0],
  ["high", 1],
  ["normal", 2],
  ["low", 3],
  ["diagnostic", 4],
]);

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype;
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function boundedString(value, maxLength = 420) {
  const text = normalizeString(value, "");
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}

function normalizeEnum(value, allowed, fallback) {
  const text = normalizeString(value, fallback);
  return allowed.has(text) ? text : fallback;
}

function normalizeBoolean(value, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeStringList(values) {
  const source = Array.isArray(values) ? values : [];
  return [...new Set(source.map((value) => normalizeString(value, "")).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined && key !== "snapshotDigest" && key !== "compactTextDigest")
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function digestFor(domain, value) {
  return `sha256:${crypto.createHash("sha256").update(`${domain}\0${stableStringify(value)}`).digest("hex")}`;
}

function nowIso(nowMs) {
  const ms = typeof nowMs === "number" && Number.isFinite(nowMs) ? nowMs : Date.now();
  return new Date(ms).toISOString();
}

function normalizeEvidenceRefs(values) {
  const source = Array.isArray(values) ? values : [];
  return source
    .map((entry) => {
      if (!isPlainObject(entry)) return null;
      const refId = normalizeString(entry.refId, "");
      if (!refId) return null;
      return {
        refId: boundedString(refId, 180),
        source: normalizeEnum(entry.source, EVIDENCE_SOURCES, "audit_row"),
        digest: normalizeString(entry.digest, "") || undefined,
      };
    })
    .filter(Boolean)
    .sort((a, b) => `${a.source}:${a.refId}`.localeCompare(`${b.source}:${b.refId}`));
}

function defaultChannels(input = {}) {
  const transcriptVisible = normalizeEnum(input.transcriptVisible, TRANSCRIPT_VISIBILITIES, "not_applicable");
  return {
    epistemic: {
      visibleToResident: normalizeBoolean(input.residentVisible ?? input.visibleToResident, true),
      visibility: normalizeEnum(input.epistemicVisibility, VISIBILITIES, "summary_only"),
    },
    control: {
      controlAvailable: normalizeBoolean(input.controlAvailable, false),
      availableActions: normalizeStringList(input.availableActions),
      blockedActions: normalizeStringList(input.blockedActions),
      authorityRequired: normalizeBoolean(input.controlAuthorityRequired ?? input.perCallAuthorityRequired, false),
    },
    transcript: {
      transcriptVisible,
      transcriptSourceRefs: normalizeEvidenceRefs(input.transcriptSourceRefs),
    },
  };
}

function normalizeChannels(input = {}) {
  if (!isPlainObject(input.channels)) return defaultChannels(input);
  const defaults = defaultChannels(input);
  return {
    epistemic: {
      visibleToResident: normalizeBoolean(input.channels.epistemic?.visibleToResident, defaults.epistemic.visibleToResident),
      visibility: normalizeEnum(input.channels.epistemic?.visibility, VISIBILITIES, defaults.epistemic.visibility),
    },
    control: {
      controlAvailable: normalizeBoolean(input.channels.control?.controlAvailable, defaults.control.controlAvailable),
      availableActions: normalizeStringList(input.channels.control?.availableActions),
      blockedActions: normalizeStringList(input.channels.control?.blockedActions),
      authorityRequired: normalizeBoolean(input.channels.control?.authorityRequired, defaults.control.authorityRequired),
    },
    transcript: {
      transcriptVisible: normalizeEnum(input.channels.transcript?.transcriptVisible, TRANSCRIPT_VISIBILITIES, defaults.transcript.transcriptVisible),
      transcriptSourceRefs: normalizeEvidenceRefs(input.channels.transcript?.transcriptSourceRefs),
    },
  };
}

function normalizeEnablementPath(values, defaultUse = "operator_explanation_only") {
  const source = Array.isArray(values) ? values : [];
  return source
    .map((entry) => {
      if (!isPlainObject(entry)) return null;
      const label = boundedString(entry.label, 220);
      if (!label) return null;
      return {
        kind: normalizeEnum(entry.kind, ENABLEMENT_KINDS, "operator_enablement"),
        label,
        authorityRequired: normalizeBoolean(entry.authorityRequired, false),
        enablementPathUse: normalizeEnum(entry.enablementPathUse, ENABLEMENT_USES, defaultUse),
      };
    })
    .filter(Boolean);
}

function degradeStaleCallable(row) {
  if (row.freshness !== "stale" && row.freshness !== "unknown") return row;
  if (row.status !== "callable_now") return row;
  return {
    ...row,
    status: "stale",
    callableInCurrentRequest: false,
    channels: {
      ...row.channels,
      control: {
        ...row.channels.control,
        controlAvailable: false,
        availableActions: [],
        blockedActions: [...new Set([...row.channels.control.blockedActions, "stale_epistemic_row"])].sort(),
      },
    },
    blockerCodes: [...new Set([...row.blockerCodes, "stale_epistemic_row"])].sort(),
  };
}

function strictestBlockerWins(row) {
  if (row.conflictState === "none" || row.conflictResolution !== "strictest_blocker_wins") return row;
  if (row.status.startsWith("blocked_") || row.status === "stale") return row;
  return {
    ...row,
    status: "blocked_by_policy",
    callableInCurrentRequest: false,
    channels: {
      ...row.channels,
      control: {
        ...row.channels.control,
        controlAvailable: false,
        availableActions: [],
        blockedActions: [...new Set([...row.channels.control.blockedActions, row.conflictState])].sort(),
      },
    },
    blockerCodes: [...new Set([...row.blockerCodes, row.conflictState])].sort(),
  };
}

function buildResidentEpistemicRow(input = {}) {
  const subjectKind = normalizeEnum(input.subjectKind, SUBJECT_KINDS, "unknown");
  const subjectId = normalizeString(input.subjectId || input.id, "");
  const priority = normalizeEnum(input.priority, PRIORITIES, "normal");
  const evidenceRefs = normalizeEvidenceRefs(input.evidenceRefs);
  const channels = normalizeChannels(input);
  let row = {
    schema: RESIDENT_EPISTEMIC_ROW_SCHEMA,
    rowId: normalizeString(input.rowId, "") || digestFor("resident-epistemic-row-id", {
      subjectKind,
      subjectId,
      displayLabel: input.displayLabel || input.label || subjectId,
      evidenceRefs,
    }).slice(0, 28),
    subjectKind,
    subjectId: boundedString(subjectId, 180),
    displayLabel: boundedString(input.displayLabel || input.label || subjectId || subjectKind, 180),
    family: boundedString(input.family, 120) || undefined,
    status: normalizeEnum(input.status, STATUSES, "unknown"),
    knowledgeClass: normalizeEnum(input.knowledgeClass, KNOWLEDGE_CLASSES, "unknown"),
    residentVisible: normalizeBoolean(input.residentVisible, channels.epistemic.visibleToResident),
    callableInCurrentRequest: normalizeBoolean(input.callableInCurrentRequest, false),
    declaredAsProviderTool: normalizeBoolean(input.declaredAsProviderTool, false),
    controlState: normalizeEnum(input.controlState, CONTROL_STATES, channels.control.controlAvailable ? "known_available" : "not_applicable"),
    perCallAuthorityRequired: normalizeBoolean(input.perCallAuthorityRequired, channels.control.authorityRequired),
    channels,
    epistemicUse: normalizeEnum(input.epistemicUse, EPISTEMIC_USES, "self_status"),
    authorityUse: normalizeEnum(input.authorityUse, AUTHORITY_USES, "none"),
    priority,
    omitWhenBudgeted: normalizeBoolean(input.omitWhenBudgeted, priority === "low" || priority === "diagnostic"),
    conflictState: normalizeEnum(input.conflictState, CONFLICT_STATES, "none"),
    conflictResolution: normalizeEnum(input.conflictResolution, CONFLICT_RESOLUTIONS, "strictest_blocker_wins"),
    freshness: normalizeEnum(input.freshness, FRESHNESS_VALUES, "fresh"),
    staleBehavior: normalizeEnum(input.staleBehavior, STALE_BEHAVIORS, "include_with_warning"),
    scope: normalizeEnum(input.scope, SCOPES, "work_thread"),
    blockerCodes: normalizeStringList(input.blockerCodes),
    enablementPath: normalizeEnablementPath(input.enablementPath, input.enablementPathUse),
    evidenceRefs,
    lastObservedAt: normalizeString(input.lastObservedAt, "") || undefined,
    expiresAt: normalizeString(input.expiresAt, "") || undefined,
    compactText: boundedString(input.compactText || input.summary || input.displayLabel || subjectId || subjectKind, 500),
    rawPayloadExposed: false,
    extensions: isPlainObject(input.extensions) ? input.extensions : undefined,
  };
  row = degradeStaleCallable(row);
  row = strictestBlockerWins(row);
  return row;
}

function buildUnknownOmittedClassRow({ subjectKind = "unknown", family = "", omittedCount = 0, reason = "not represented in this snapshot" } = {}) {
  const label = family || subjectKind;
  return buildResidentEpistemicRow({
    subjectKind,
    subjectId: `omitted:${subjectKind}:${family || "all"}`,
    displayLabel: `${label} availability unknown`,
    family,
    status: "unknown",
    knowledgeClass: "derived_projection",
    residentVisible: true,
    channels: {
      epistemic: { visibleToResident: true, visibility: "count_only" },
      control: { controlAvailable: false, availableActions: [], blockedActions: ["omitted_from_snapshot"], authorityRequired: false },
      transcript: { transcriptVisible: "not_applicable", transcriptSourceRefs: [] },
    },
    epistemicUse: "avoidance_context",
    authorityUse: "may_not_act",
    priority: "low",
    omitWhenBudgeted: false,
    freshness: "unknown",
    blockerCodes: ["omitted_class"],
    compactText: `${label}: ${omittedCount || "some"} row(s) omitted; treat availability as unknown, not absent. ${reason}.`,
  });
}

function sortRows(rows) {
  return [...rows].sort((a, b) => {
    const byPriority = (PRIORITY_ORDER.get(a.priority) ?? 9) - (PRIORITY_ORDER.get(b.priority) ?? 9);
    if (byPriority) return byPriority;
    return `${a.subjectKind}:${a.family || ""}:${a.displayLabel}:${a.rowId}`.localeCompare(`${b.subjectKind}:${b.family || ""}:${b.displayLabel}:${b.rowId}`);
  });
}

function summarizeOmissions(rows, hiddenRows = []) {
  const counts = {};
  for (const row of hiddenRows) {
    const key = row.subjectKind || "unknown";
    counts[key] = (counts[key] || 0) + 1;
  }
  for (const row of rows) {
    if (row.status === "unknown" && row.blockerCodes.includes("omitted_class")) {
      const key = row.subjectKind || "unknown";
      counts[key] = Math.max(counts[key] || 0, 1);
    }
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function renderCompactResidentText(rows, options = {}) {
  const maxRows = Math.max(1, Number(options.maxRows || 12));
  const maxChars = Math.max(200, Number(options.maxChars || 2400));
  const selected = [];
  let currentLength = "Harness epistemic witness:".length;
  for (const row of sortRows(rows)) {
    if (!row.residentVisible) continue;
    if (selected.length >= maxRows && row.omitWhenBudgeted) continue;
    const line = `- ${row.displayLabel}: ${row.status}; ${row.compactText}`;
    if (selected.length >= maxRows || currentLength + line.length + 1 > maxChars) {
      if (!row.omitWhenBudgeted && selected.length < maxRows) {
        selected.push(row);
        currentLength += line.length + 1;
      }
      continue;
    }
    selected.push(row);
    currentLength += line.length + 1;
  }
  const lines = ["Harness epistemic witness:"];
  for (const row of selected) {
    const stale = row.freshness === "stale" ? " stale" : "";
    const conflict = row.conflictState !== "none" ? ` conflict=${row.conflictState}` : "";
    lines.push(`- ${row.displayLabel}: ${row.status}${stale}${conflict}; ${row.compactText}`);
  }
  return {
    text: boundedString(lines.join("\n"), maxChars),
    sourceRowIds: selected.map((row) => row.rowId),
  };
}

function buildResidentEpistemicSnapshot(input = {}) {
  const rawRows = Array.isArray(input.rows) ? input.rows : [];
  const normalizedRows = rawRows.map(buildResidentEpistemicRow);
  const projectionBudget = {
    maxRows: Math.max(1, Number(input.projectionBudget?.maxRows || input.maxRows || 12)),
    maxChars: Math.max(200, Number(input.projectionBudget?.maxChars || input.maxChars || 2400)),
    truncationPolicy: normalizeEnum(input.projectionBudget?.truncationPolicy || input.truncationPolicy, new Set(["priority_then_summary", "summary_only"]), "priority_then_summary"),
  };
  const compact = renderCompactResidentText(normalizedRows, projectionBudget);
  const omittedClassCounts = input.omittedClassCounts && isPlainObject(input.omittedClassCounts)
    ? Object.fromEntries(Object.entries(input.omittedClassCounts).map(([key, value]) => [key, Math.max(0, Number(value) || 0)]).sort(([a], [b]) => a.localeCompare(b)))
    : summarizeOmissions(normalizedRows, normalizedRows.filter((row) => row.omitWhenBudgeted && !compact.sourceRowIds.includes(row.rowId)));
  const snapshot = {
    schema: RESIDENT_EPISTEMIC_SNAPSHOT_SCHEMA,
    snapshotId: normalizeString(input.snapshotId, "") || digestFor("resident-epistemic-snapshot-id", {
      workThreadId: input.workThreadId,
      rows: normalizedRows.map((row) => row.rowId),
      sourceDigests: input.sourceDigests,
    }).slice(0, 32),
    workThreadId: normalizeString(input.workThreadId, "work_thread_unknown"),
    codexThreadId: normalizeString(input.codexThreadId, "") || undefined,
    runtimeFamily: normalizeEnum(input.runtimeFamily, RUNTIME_FAMILIES, "direct"),
    generatedAt: normalizeString(input.generatedAt, "") || nowIso(input.nowMs),
    freshnessMs: Math.max(0, Number(input.freshnessMs || 0)),
    projectionBudget,
    snapshotCompleteness: normalizeEnum(input.snapshotCompleteness, SNAPSHOT_COMPLETENESS, Object.keys(omittedClassCounts).length ? "budgeted_with_omissions" : "complete"),
    omittedClassCounts,
    declarationDigest: normalizeString(input.declarationDigest, "") || undefined,
    sourceDigests: normalizeStringList(input.sourceDigests),
    rows: sortRows(normalizedRows),
    compactResidentText: compact.text,
    compactTextDigest: digestFor("resident-epistemic-compact-text", compact.text),
    compactTextRendererVersion: "resident_epistemic_compact_renderer@1",
    compactTextSourceRowIds: compact.sourceRowIds,
  };
  return {
    ...snapshot,
    snapshotDigest: digestFor("resident-epistemic-snapshot", snapshot),
  };
}

function buildResidentEpistemicContextItem(snapshot, options = {}) {
  const includedRowIds = normalizeStringList(options.includedRowIds || snapshot.compactTextSourceRowIds);
  const item = {
    schema: RESIDENT_EPISTEMIC_CONTEXT_ITEM_SCHEMA,
    snapshotId: snapshot.snapshotId,
    snapshotDigest: snapshot.snapshotDigest,
    compactTextDigest: snapshot.compactTextDigest,
    includedRowIds,
    omittedClassCounts: snapshot.omittedClassCounts || {},
    authority: "harness_epistemic_witness",
    grantsAuthority: false,
  };
  return item;
}

function assertRendererSafe(value, label = "resident epistemic artifact") {
  const findings = scanSensitiveText(JSON.stringify(value));
  if (findings.length) {
    throw new Error(`${label} contains sensitive material: ${findings.join(", ")}`);
  }
  return true;
}

function validateResidentEpistemicSnapshot(snapshot) {
  if (!snapshot || snapshot.schema !== RESIDENT_EPISTEMIC_SNAPSHOT_SCHEMA) {
    throw new Error("resident_epistemic_snapshot_schema_mismatch");
  }
  if (!snapshot.snapshotId || !snapshot.workThreadId) throw new Error("resident_epistemic_snapshot_missing_identity");
  if (!Array.isArray(snapshot.rows)) throw new Error("resident_epistemic_snapshot_rows_missing");
  if (!snapshot.compactTextDigest || !snapshot.snapshotDigest) throw new Error("resident_epistemic_snapshot_missing_digest");
  const rowIds = new Set();
  for (const row of snapshot.rows) {
    if (row.schema !== RESIDENT_EPISTEMIC_ROW_SCHEMA) throw new Error("resident_epistemic_row_schema_mismatch");
    if (!row.rowId || rowIds.has(row.rowId)) throw new Error("resident_epistemic_row_id_invalid");
    rowIds.add(row.rowId);
    if (row.rawPayloadExposed !== false) throw new Error("resident_epistemic_raw_payload_exposed");
    if (row.status === "callable_now" && row.freshness === "stale") throw new Error("resident_epistemic_stale_callable");
    if (row.status === "callable_now" && !row.callableInCurrentRequest) throw new Error("resident_epistemic_callable_status_without_callable_flag");
    if (row.callableInCurrentRequest && row.status !== "callable_now") throw new Error("resident_epistemic_callable_flag_without_callable_status");
    if (row.declaredAsProviderTool && !row.callableInCurrentRequest && row.status === "callable_now") throw new Error("resident_epistemic_provider_declaration_mismatch");
    if (!row.channels || !row.channels.epistemic || !row.channels.control || !row.channels.transcript) {
      throw new Error("resident_epistemic_missing_channels");
    }
    if (row.channels.transcript.transcriptVisible === "full" && row.channels.transcript.transcriptSourceRefs.length === 0) {
      throw new Error("resident_epistemic_full_transcript_without_source_ref");
    }
  }
  for (const rowId of snapshot.compactTextSourceRowIds || []) {
    if (!rowIds.has(rowId)) throw new Error("resident_epistemic_compact_source_row_missing");
  }
  assertRendererSafe(snapshot);
  return true;
}

module.exports = {
  RESIDENT_EPISTEMIC_CONTEXT_ITEM_SCHEMA,
  RESIDENT_EPISTEMIC_ROW_SCHEMA,
  RESIDENT_EPISTEMIC_SNAPSHOT_SCHEMA,
  buildResidentEpistemicContextItem,
  buildResidentEpistemicRow,
  buildResidentEpistemicSnapshot,
  buildUnknownOmittedClassRow,
  digestFor,
  renderCompactResidentText,
  validateResidentEpistemicSnapshot,
};
