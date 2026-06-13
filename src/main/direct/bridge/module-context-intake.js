"use strict";

const crypto = require("node:crypto");

const DIRECT_MODULE_CONTEXT_INTAKE_SCHEMA = "direct_module_context_intake@1";
const DIRECT_MODULE_CONTEXT_INTAKE_ROW_SCHEMA = "direct_module_context_intake_row@1";

const MODULE_KINDS = new Set(["skill", "hook", "app", "connector", "tool_adapter", "unknown"]);
const ROW_KINDS = new Set(["context_contribution", "imported_evidence", "blocked_diagnostic"]);
const SOURCE_SCOPES = new Set(["work_thread", "project", "thread", "global", "unknown"]);
const INTAKE_STATES = new Set(["accepted", "rejected", "blocked", "pending_review"]);

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype;
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function boundedString(value, maxLength = 240) {
  const text = normalizeString(value, "");
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
}

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

function nowIso(nowMs) {
  const ms = typeof nowMs === "number" && !Number.isNaN(nowMs) ? nowMs : Date.now();
  return new Date(ms).toISOString();
}

function arrayOrEmpty(value) {
  return Array.isArray(value) ? value : [];
}

function objectOrEmpty(value) {
  return isPlainObject(value) ? value : {};
}

function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function normalizeModuleKind(value) {
  const kind = normalizeString(value, "unknown");
  return MODULE_KINDS.has(kind) ? kind : "unknown";
}

function normalizeRowKind(value) {
  const kind = normalizeString(value, "context_contribution");
  return ROW_KINDS.has(kind) ? kind : "context_contribution";
}

function normalizeSourceScope(value) {
  const scope = normalizeString(value, "unknown");
  return SOURCE_SCOPES.has(scope) ? scope : "unknown";
}

function normalizeEvidenceRefs(values, fallbackKind = "module_context_intake") {
  return arrayOrEmpty(values)
    .filter(isPlainObject)
    .map((ref) => {
      const digest = boundedString(ref.artifactDigest || ref.digest || ref.sourceDigest || ref.refDigest || "", 120);
      const label = boundedString(ref.rendererSafeLabel || ref.label || ref.name || fallbackKind, 160);
      return {
        kind: boundedString(ref.kind || ref.type || fallbackKind, 80),
        artifactId: boundedString(ref.artifactId || ref.id || "", 160),
        artifactDigest: digest,
        digest,
        rendererSafeLabel: label,
        label,
        rawTextIncluded: false,
      };
    });
}

function hasUnsafeRawExposure(value, visited = new Set()) {
  if (!value || typeof value !== "object") return false;
  if (visited.has(value)) return false;
  visited.add(value);
  if (Array.isArray(value)) return value.some((entry) => hasUnsafeRawExposure(entry, visited));
  for (const [key, nested] of Object.entries(value)) {
    if (/^raw[A-Z].*(Included|Exposed)$/.test(key) && nested === true) return true;
    if (nested && typeof nested === "object" && hasUnsafeRawExposure(nested, visited)) return true;
  }
  return false;
}

function authorityBlockers(item = {}) {
  const blockers = [];
  const checks = [
    ["connector_mutation_disabled", item.connectorMutationAllowed || item.connectorMutationUsed || item.connectorTransportUsed],
    ["hook_execution_disabled", item.hookExecutionAllowed || item.hookExecutionUsed || item.hookActionAllowed],
    ["auto_invocation_disabled", item.autoInvocationAllowed || item.autoInvocationUsed],
    ["workspace_mutation_disabled", item.workspaceMutationAllowed || item.workspaceMutationUsed || item.workspaceWriteUsed],
    ["provider_transport_disabled", item.providerTransportAllowed || item.providerTransportUsed || item.providerCallAllowed],
    ["module_execution_disabled", item.executionAllowed || item.executionUsed || item.moduleExecutionAllowed],
  ];
  for (const [code, active] of checks) {
    if (active === true) blockers.push(code);
  }
  return blockers;
}

function requirementBlockers(item = {}, rowKind, evidenceRefs = []) {
  const blockers = [];
  const moduleId = normalizeString(item.moduleId || item.module?.moduleId || item.moduleRef?.moduleId || item.id, "");
  const sourceScope = normalizeSourceScope(item.sourceScope || item.scope || item.bindingScope);
  const workThreadId = normalizeString(item.workThreadId || item.workThread?.workThreadId || "", "");
  if (!moduleId) blockers.push("module_source_missing");
  if (!workThreadId) blockers.push("work_thread_binding_missing");
  if (sourceScope === "unknown") blockers.push("scope_missing");
  if (hasUnsafeRawExposure(item)) blockers.push("raw_exposure_unsafe");
  if (rowKind === "imported_evidence" && !evidenceRefs.length) {
    blockers.push("import_source_missing");
  }
  return blockers;
}

function normalizeUpstreamIntakeState(item = {}) {
  const explicit = normalizeString(item.state || item.status || item.intakeState, "");
  if (INTAKE_STATES.has(explicit)) return explicit;
  const contributionState = normalizeString(item.contributionState, "");
  if (contributionState === "accepted_context_ref") return "accepted";
  if (contributionState.startsWith("blocked")) return "blocked";
  const importState = normalizeString(item.importState, "");
  if (importState === "accepted_evidence_row") return "accepted";
  if (importState.startsWith("blocked")) return "blocked";
  return "";
}

function normalizeIntakeState(value, blockers) {
  const explicit = normalizeString(value, "");
  if (blockers.length) return "blocked";
  if (INTAKE_STATES.has(explicit)) return explicit;
  return "accepted";
}

function rowIdFor(item, rowKind, moduleId, ordinal) {
  const explicit = normalizeString(item.rowId || item.intakeRowId || item.contributionId || item.evidenceImportRowId || item.id, "");
  if (explicit) return boundedString(explicit, 160);
  return `module_intake_${rowKind}_${digestFor("module-context-intake-row-id@1", { rowKind, moduleId, ordinal }).slice(0, 20)}`;
}

function buildModuleContextIntakeRow(input = {}, defaults = {}, ordinal = 0) {
  const item = objectOrEmpty(input);
  const rowKind = normalizeRowKind(item.rowKind || item.kind || defaults.rowKind);
  const moduleRef = objectOrEmpty(item.moduleRef || item.module);
  const moduleKind = normalizeModuleKind(item.moduleKind || moduleRef.moduleKind || moduleRef.kind || defaults.moduleKind);
  const moduleId = normalizeString(item.moduleId || moduleRef.moduleId || moduleRef.id || item.id, "");
  const sourceScope = normalizeSourceScope(item.sourceScope || item.scope || item.bindingScope || defaults.sourceScope);
  const hasOwn = (key) => Object.prototype.hasOwnProperty.call(item, key);
  const workThreadId = normalizeString(hasOwn("workThreadId") ? item.workThreadId : defaults.workThreadId, "");
  const projectId = normalizeString(hasOwn("projectId") ? item.projectId : defaults.projectId, "");
  const threadId = normalizeString(hasOwn("threadId") ? item.threadId : defaults.threadId, "");
  const evidenceRefs = normalizeEvidenceRefs(item.evidenceRefs || item.sourceRefs || item.refs, rowKind === "imported_evidence" ? "module_imported_evidence" : "module_context");
  const blockers = [
    ...requirementBlockers({ ...item, moduleId, sourceScope, workThreadId }, rowKind, evidenceRefs),
    ...authorityBlockers(item),
  ];
  const requestedState = normalizeUpstreamIntakeState(item) || (rowKind === "blocked_diagnostic" ? "blocked" : "");
  const state = normalizeIntakeState(requestedState, blockers);
  const accepted = state === "accepted";
  const blockReasons = state === "blocked" && blockers.length === 0
    ? ["upstream_state_blocked"]
    : blockers;
  const row = {
    schema: DIRECT_MODULE_CONTEXT_INTAKE_ROW_SCHEMA,
    rowId: rowIdFor(item, rowKind, moduleId, ordinal),
    rowKind,
    moduleId,
    moduleKind,
    sourceLabel: boundedString(item.sourceLabel || item.displayName || item.label || moduleRef.displayName || moduleId || moduleKind, 180),
    sourceScope,
    projectId,
    workThreadId,
    threadId,
    title: boundedString(item.title || item.label || item.rendererSafeSummary || item.summary || "", 180),
    rendererSafeSummary: boundedString(item.rendererSafeSummary || item.summary || "Module context intake row.", 360),
    state,
    contextEligible: accepted && blockers.length === 0,
    importedEvidence: rowKind === "imported_evidence",
    blockReasons,
    tokenEstimate: numberOrZero(item.tokenEstimate || item.estimatedTokens || item.tokens),
    sizeBytes: numberOrZero(item.sizeBytes || item.byteSize || item.bytes),
    evidenceRefs,
    sourceDigest: boundedString(item.sourceDigest || item.digest || item.contributionDigest || item.rowDigest || "", 120),
    connectorMutationAllowed: false,
    hookExecutionAllowed: false,
    autoInvocationAllowed: false,
    workspaceMutationAllowed: false,
    providerTransportAllowed: false,
    moduleExecutionAllowed: false,
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
    createdAt: normalizeString(item.createdAt, normalizeString(defaults.createdAt, nowIso(defaults.nowMs))),
  };
  row.rowDigest = digestFor("direct-module-context-intake-row@1", row);
  return row;
}

function rowsFromInput(input = {}) {
  const defaults = {
    projectId: normalizeString(input.projectId, ""),
    workThreadId: normalizeString(input.workThreadId, ""),
    threadId: normalizeString(input.threadId, ""),
    sourceScope: normalizeString(input.sourceScope, "work_thread"),
    createdAt: normalizeString(input.createdAt, ""),
    nowMs: input.nowMs,
  };
  const rows = [];
  const addRows = (items, rowKind, moduleKind) => {
    for (const item of arrayOrEmpty(items)) {
      rows.push(buildModuleContextIntakeRow(item, { ...defaults, rowKind, moduleKind }, rows.length));
    }
  };
  addRows(input.contextContributions || input.moduleContextContributions || input.moduleStatus?.contextContributions, "context_contribution", "skill");
  addRows(input.importedEvidenceRows || input.evidenceImportRows || input.moduleStatus?.evidenceImportRows, "imported_evidence", "connector");
  addRows(input.blockedRows || input.blockedDiagnostics, "blocked_diagnostic", "unknown");
  addRows(input.rows, "context_contribution", "unknown");
  return rows;
}

function buildAcceptedContextPreviewRow(row) {
  return {
    sourceClass: "module_context",
    sourceId: row.rowId,
    label: row.title || row.sourceLabel || row.rowId,
    includedInRequest: true,
    required: false,
    stale: false,
    missing: false,
    rawExposureUnsafe: false,
    tokenEstimate: row.tokenEstimate,
    sizeBytes: row.sizeBytes,
    sourceDigest: row.rowDigest,
    evidenceRefs: row.evidenceRefs,
    retentionLaw: "module_context_requires_work_thread_binding",
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
}

function summarizeCounts(rows) {
  return {
    rowCount: rows.length,
    acceptedRowCount: rows.filter((row) => row.state === "accepted").length,
    rejectedRowCount: rows.filter((row) => row.state === "rejected").length,
    blockedRowCount: rows.filter((row) => row.state === "blocked").length,
    pendingReviewRowCount: rows.filter((row) => row.state === "pending_review").length,
    contextEligibleRowCount: rows.filter((row) => row.contextEligible).length,
    importedEvidenceRowCount: rows.filter((row) => row.importedEvidence).length,
    rawExposureUnsafeCount: rows.filter((row) => row.blockReasons.includes("raw_exposure_unsafe")).length,
    acceptedContextPreviewRowCount: rows.filter((row) => row.contextEligible).length,
    tokenEstimateTotal: rows.reduce((sum, row) => sum + numberOrZero(row.tokenEstimate), 0),
    sizeBytesTotal: rows.reduce((sum, row) => sum + numberOrZero(row.sizeBytes), 0),
  };
}

function buildDirectModuleContextIntake(input = {}) {
  const source = objectOrEmpty(input);
  const rows = rowsFromInput(source).sort((a, b) => a.rowId.localeCompare(b.rowId));
  const acceptedContextPreviewRows = rows.filter((row) => row.contextEligible).map(buildAcceptedContextPreviewRow);
  const counts = summarizeCounts(rows);
  const sourceDigest = digestFor("direct-module-context-intake-source@1", {
    projectId: source.projectId,
    workThreadId: source.workThreadId,
    threadId: source.threadId,
    rowDigests: rows.map((row) => row.rowDigest),
  });
  const intakeState = counts.rowCount === 0
    ? "empty"
    : counts.blockedRowCount > 0
      ? "blocked"
      : counts.pendingReviewRowCount > 0
        ? "pending_review"
        : "ready";
  const intake = {
    schema: DIRECT_MODULE_CONTEXT_INTAKE_SCHEMA,
    intakeId: normalizeString(source.intakeId, `direct_module_context_intake_${sourceDigest.slice(0, 24)}`),
    projectId: normalizeString(source.projectId, ""),
    workThreadId: normalizeString(source.workThreadId, ""),
    threadId: normalizeString(source.threadId, ""),
    generatedAt: normalizeString(source.generatedAt, nowIso(source.nowMs)),
    intakeState,
    rows,
    acceptedContextPreviewRows,
    counts,
    authority: {
      displayOnly: true,
      rendererSafe: true,
      contextPreviewRowsAvailable: acceptedContextPreviewRows.length > 0,
      contextPacketMutationAllowed: false,
      connectorMutationAllowed: false,
      hookExecutionAllowed: false,
      autoInvocationAllowed: false,
      workspaceMutationAllowed: false,
      providerTransportAllowed: false,
      moduleExecutionAllowed: false,
      rawTextIncluded: false,
      rawPathIncluded: false,
      rawSecretIncluded: false,
    },
    rendererSafeSummary: {
      state: intakeState,
      acceptedRowCount: counts.acceptedRowCount,
      contextEligibleRowCount: counts.contextEligibleRowCount,
      blockedRowCount: counts.blockedRowCount,
      importedEvidenceRowCount: counts.importedEvidenceRowCount,
    },
    sourceDigest,
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  intake.intakeDigest = digestFor("direct-module-context-intake@1", intake);
  return intake;
}

function assertDirectModuleContextIntakeSafe(intake = {}) {
  if (!isPlainObject(intake) || intake.schema !== DIRECT_MODULE_CONTEXT_INTAKE_SCHEMA) {
    throw new Error("direct_module_context_intake_schema_mismatch");
  }
  const authority = objectOrEmpty(intake.authority);
  const forbiddenTrueFlags = [
    "contextPacketMutationAllowed",
    "connectorMutationAllowed",
    "hookExecutionAllowed",
    "autoInvocationAllowed",
    "workspaceMutationAllowed",
    "providerTransportAllowed",
    "moduleExecutionAllowed",
    "rawTextIncluded",
    "rawPathIncluded",
    "rawSecretIncluded",
  ];
  if (authority.displayOnly !== true || authority.rendererSafe !== true) {
    throw new Error("direct_module_context_intake_not_display_only");
  }
  for (const flag of forbiddenTrueFlags) {
    if (authority[flag] !== false) throw new Error(`direct_module_context_intake_authority_leak:${flag}`);
  }
  if (intake.rawTextIncluded !== false || intake.rawPathIncluded !== false || intake.rawSecretIncluded !== false) {
    throw new Error("direct_module_context_intake_raw_exposure");
  }
  for (const row of arrayOrEmpty(intake.rows)) {
    if (row.schema !== DIRECT_MODULE_CONTEXT_INTAKE_ROW_SCHEMA) throw new Error("direct_module_context_intake_row_schema_mismatch");
    if (
      row.connectorMutationAllowed !== false ||
      row.hookExecutionAllowed !== false ||
      row.autoInvocationAllowed !== false ||
      row.workspaceMutationAllowed !== false ||
      row.providerTransportAllowed !== false ||
      row.moduleExecutionAllowed !== false
    ) {
      throw new Error(`direct_module_context_intake_row_authority_leak:${row.rowId || ""}`);
    }
    if (row.rawTextIncluded !== false || row.rawPathIncluded !== false || row.rawSecretIncluded !== false) {
      throw new Error(`direct_module_context_intake_row_raw_exposure:${row.rowId || ""}`);
    }
    if (row.contextEligible && row.state !== "accepted") {
      throw new Error(`direct_module_context_intake_ineligible_state:${row.rowId || ""}`);
    }
    if (row.contextEligible && (!row.workThreadId || row.blockReasons.length)) {
      throw new Error(`direct_module_context_intake_missing_binding:${row.rowId || ""}`);
    }
  }
  for (const row of arrayOrEmpty(intake.acceptedContextPreviewRows)) {
    if (row.sourceClass !== "module_context") throw new Error("direct_module_context_preview_wrong_class");
    if (row.rawTextIncluded !== false || row.rawPathIncluded !== false || row.rawSecretIncluded !== false) {
      throw new Error(`direct_module_context_preview_raw_exposure:${row.sourceId || ""}`);
    }
  }
  return true;
}

module.exports = {
  DIRECT_MODULE_CONTEXT_INTAKE_ROW_SCHEMA,
  DIRECT_MODULE_CONTEXT_INTAKE_SCHEMA,
  buildDirectModuleContextIntake,
  assertDirectModuleContextIntakeSafe,
  stableStringify,
};
