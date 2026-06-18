"use strict";

const crypto = require("node:crypto");
const {
  buildResidentEpistemicSnapshot,
  validateResidentEpistemicSnapshot,
} = require("./resident-epistemic-snapshot");

const BRIDGE_SYSTEM_EPISTEMIC_SNAPSHOT_SCHEMA = "bridge_system_epistemic_snapshot@1";
const BRIDGE_SYSTEM_EPISTEMIC_PREVIEW_SCHEMA = "bridge_system_epistemic_preview@1";

const SUBJECT_KINDS = new Set([
  "runtime",
  "provider",
  "model",
  "quota",
  "account_action",
  "context",
  "memory",
  "baton",
  "workspace",
  "artifact",
  "stash",
  "skill",
  "hook",
  "app",
  "mcp",
  "external_capability",
  "browser",
  "headless_route",
  "thread",
  "work_thread",
  "goal",
  "orchestration",
]);

const STATUSES = new Set([
  "known_available",
  "known_disabled",
  "blocked_by_policy",
  "blocked_by_missing_evidence",
  "blocked_by_auth",
  "blocked_by_runtime",
  "blocked_by_workthread",
  "temporarily_unavailable",
  "stale",
  "unknown",
]);

const KNOWLEDGE_CLASSES = new Set(["exact_runtime", "harness_observed", "registry_declared", "derived_projection", "fixture_only", "unknown"]);
const VISIBILITIES = new Set(["full_status", "summary_only", "count_only", "blocked", "unknown"]);
const FRESHNESS_VALUES = new Set(["fresh", "expiring", "stale", "unknown"]);
const PRIORITIES = new Set(["critical", "high", "normal", "low", "diagnostic"]);
const EPISTEMIC_USES = new Set(["self_status", "planning_context", "avoidance_context", "diagnostic_only", "operator_explanation"]);
const SOURCE_BY_KIND = new Map([
  ["runtime", "runtime_status"],
  ["provider", "provider_metadata"],
  ["model", "provider_metadata"],
  ["quota", "quota_snapshot"],
  ["account_action", "quota_snapshot"],
  ["context", "context_pack"],
  ["memory", "memory_frontier"],
  ["baton", "memory_frontier"],
  ["workspace", "workspace_policy"],
  ["artifact", "workspace_artifact"],
  ["stash", "workspace_artifact"],
  ["skill", "module_capability"],
  ["hook", "module_capability"],
  ["app", "module_capability"],
  ["mcp", "module_capability"],
  ["external_capability", "module_capability"],
  ["browser", "route_status"],
  ["headless_route", "headless_daemon"],
  ["thread", "orchestration_state"],
  ["work_thread", "orchestration_state"],
  ["goal", "orchestration_state"],
  ["orchestration", "orchestration_state"],
]);

const CLASS_DEFAULTS = Object.freeze([
  {
    subjectKind: "runtime",
    subjectId: "runtime-route",
    displayLabel: "Runtime route",
    family: "runtime/provider/model",
    status: "unknown",
    compactText: "Runtime route is not represented in this snapshot.",
  },
  {
    subjectKind: "provider",
    subjectId: "provider-profile",
    displayLabel: "Provider profile",
    family: "runtime/provider/model",
    status: "unknown",
    compactText: "Provider profile is not represented in this snapshot.",
  },
  {
    subjectKind: "model",
    subjectId: "active-model",
    displayLabel: "Active model and effort",
    family: "runtime/provider/model",
    status: "unknown",
    compactText: "Active model and effort are not represented in this snapshot.",
  },
  {
    subjectKind: "quota",
    subjectId: "quota-windows",
    displayLabel: "Quota and rate limits",
    family: "quota/account",
    status: "unknown",
    compactText: "Quota windows are not represented in this snapshot.",
  },
  {
    subjectKind: "account_action",
    subjectId: "reset-credit",
    displayLabel: "Account reset-credit action",
    family: "quota/account",
    status: "blocked_by_policy",
    compactText: "Account mutation is blocked unless an explicit operator-confirmed authority transition exists.",
  },
  {
    subjectKind: "context",
    subjectId: "context-pack",
    displayLabel: "Context pack",
    family: "context/memory",
    status: "unknown",
    compactText: "Context pack freshness is not represented in this snapshot.",
  },
  {
    subjectKind: "memory",
    subjectId: "durable-memory",
    displayLabel: "Durable memory",
    family: "context/memory",
    status: "known_disabled",
    compactText: "Memory mutation is not available through this witness.",
  },
  {
    subjectKind: "baton",
    subjectId: "frontier-baton",
    displayLabel: "Frontier baton",
    family: "context/memory",
    status: "unknown",
    compactText: "Frontier baton freshness is not represented in this snapshot.",
  },
  {
    subjectKind: "context",
    subjectId: "compaction",
    displayLabel: "Compaction posture",
    family: "context/memory",
    status: "blocked_by_missing_evidence",
    compactText: "Compaction requires a separate evidence-backed gate.",
  },
  {
    subjectKind: "workspace",
    subjectId: "workspace-policy",
    displayLabel: "Workspace policy",
    family: "workspace/artifact",
    status: "unknown",
    compactText: "Workspace policy is not represented in this snapshot.",
  },
  {
    subjectKind: "artifact",
    subjectId: "artifact-surface",
    displayLabel: "Artifact surface",
    family: "workspace/artifact",
    status: "unknown",
    compactText: "Artifact surface state is not represented in this snapshot.",
  },
  {
    subjectKind: "stash",
    subjectId: "project-stash",
    displayLabel: "Project stash",
    family: "workspace/artifact",
    status: "unknown",
    compactText: "Project stash state is not represented in this snapshot.",
  },
  {
    subjectKind: "skill",
    subjectId: "skills",
    displayLabel: "Skills",
    family: "modules/external",
    status: "unknown",
    compactText: "Skill availability is not represented in this snapshot.",
  },
  {
    subjectKind: "hook",
    subjectId: "hooks",
    displayLabel: "Hooks",
    family: "modules/external",
    status: "unknown",
    compactText: "Hook availability is not represented in this snapshot.",
  },
  {
    subjectKind: "app",
    subjectId: "apps",
    displayLabel: "Apps/connectors",
    family: "modules/external",
    status: "unknown",
    compactText: "App connector availability is not represented in this snapshot.",
  },
  {
    subjectKind: "mcp",
    subjectId: "mcp-resources",
    displayLabel: "MCP resources/tools",
    family: "modules/external",
    status: "unknown",
    compactText: "MCP availability is not represented in this snapshot.",
  },
  {
    subjectKind: "external_capability",
    subjectId: "external-capabilities",
    displayLabel: "External capabilities",
    family: "modules/external",
    status: "unknown",
    compactText: "External capability state is not represented in this snapshot.",
  },
  {
    subjectKind: "browser",
    subjectId: "middle-web",
    displayLabel: "Middle web/file viewer routes",
    family: "routes",
    status: "unknown",
    compactText: "Browser and file-viewer routes are not represented in this snapshot.",
  },
  {
    subjectKind: "headless_route",
    subjectId: "headless-daemon",
    displayLabel: "Headless bridge routes",
    family: "routes",
    status: "unknown",
    compactText: "Headless ingress/egress routes are not represented in this snapshot.",
  },
  {
    subjectKind: "thread",
    subjectId: "active-thread",
    displayLabel: "Active direct thread",
    family: "thread/workthread/orchestration",
    status: "unknown",
    compactText: "Active thread identity is not represented in this snapshot.",
  },
  {
    subjectKind: "work_thread",
    subjectId: "active-work-thread",
    displayLabel: "Active WorkThread",
    family: "thread/workthread/orchestration",
    status: "unknown",
    compactText: "WorkThread identity is not represented in this snapshot.",
  },
  {
    subjectKind: "goal",
    subjectId: "goal-state",
    displayLabel: "Goal state",
    family: "thread/workthread/orchestration",
    status: "unknown",
    compactText: "Goal or arc state is not represented in this snapshot.",
  },
  {
    subjectKind: "orchestration",
    subjectId: "orchestration-state",
    displayLabel: "Orchestration state",
    family: "thread/workthread/orchestration",
    status: "unknown",
    compactText: "Orchestration state is not represented in this snapshot.",
  },
]);

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype;
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizeEnum(value, allowed, fallback) {
  const text = normalizeString(value, fallback);
  return allowed.has(text) ? text : fallback;
}

function boundedString(value, maxLength = 420) {
  const text = normalizeString(value, "");
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trim()}…` : text;
}

function normalizeStringList(values, fallback = []) {
  const source = Array.isArray(values) ? values : fallback;
  return [...new Set(source.map((value) => normalizeString(value, "")).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function stableStringify(value) {
  if (value && typeof value.toJSON === "function") return stableStringify(value.toJSON());
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => (entry === undefined ? "null" : stableStringify(entry))).join(",")}]`;
  return `{${Object.keys(value)
    .filter((key) => value[key] !== undefined && key !== "snapshotDigest" && key !== "previewDigest")
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(",")}}`;
}

function digestFor(domain, value) {
  return `sha256:${crypto.createHash("sha256").update(`${domain}\0${stableStringify(value)}`).digest("hex")}`;
}

function nowIso(nowMs) {
  const ms = typeof nowMs === "number" && Number.isFinite(nowMs) ? nowMs : Date.now();
  return new Date(ms).toISOString();
}

function normalizeEvidenceRef(input = {}, fallbackSource = "audit_row") {
  const source = isPlainObject(input) ? input : {};
  const ref = {
    refId: boundedString(source.refId || source.id || source.artifactId || fallbackSource, 180),
    source: normalizeString(source.source || fallbackSource, fallbackSource),
    digest: normalizeString(source.digest || source.refDigest || source.artifactDigest, ""),
  };
  ref.refDigest = digestFor("bridge-system-epistemic-evidence-ref@1", ref);
  return ref;
}

function normalizeEvidenceRefs(values, fallbackSource) {
  const refs = (Array.isArray(values) ? values : [])
    .filter(isPlainObject)
    .map((value) => normalizeEvidenceRef(value, fallbackSource));
  return refs.length ? refs : [{ refId: `${fallbackSource}:unavailable`, source: fallbackSource, digest: "" }];
}

function inputFactsFor(input = {}) {
  const groups = [
    input.facts,
    input.runtimeFacts,
    input.providerFacts,
    input.contextFacts,
    input.workspaceFacts,
    input.moduleFacts,
    input.routeFacts,
    input.orchestrationFacts,
  ];
  return groups.flatMap((group) => (Array.isArray(group) ? group : [])).filter(isPlainObject);
}

function factKey(fact = {}) {
  return `${normalizeString(fact.subjectKind, "unknown")}:${normalizeString(fact.subjectId || fact.id, "")}`;
}

function mergeDefaultFacts(input = {}) {
  const defaultsEnabled = input.includeDefaultRows !== false;
  const defaults = defaultsEnabled ? CLASS_DEFAULTS.map((entry) => ({ ...entry })) : [];
  const supplied = inputFactsFor(input).map((entry) => ({ ...entry }));
  const byKey = new Map(defaults.map((entry) => [factKey(entry), entry]));
  for (const fact of supplied) {
    const key = factKey(fact);
    if (!key.endsWith(":")) byKey.set(key, { ...(byKey.get(key) || {}), ...fact });
    else byKey.set(`unknown:${byKey.size + 1}`, fact);
  }
  return [...byKey.values()];
}

function sourceForKind(subjectKind) {
  return SOURCE_BY_KIND.get(subjectKind) || "audit_row";
}

function defaultBlockersFor(subjectKind, status, explicitBlockers = []) {
  const blockers = [...explicitBlockers];
  if (status === "unknown") blockers.push("status_unknown");
  if (status === "stale") blockers.push("stale_epistemic_row");
  if (subjectKind === "account_action") blockers.push("account_mutation_requires_operator");
  if (subjectKind === "memory") blockers.push("memory_mutation_blocked");
  if (subjectKind === "context") blockers.push("context_mutation_or_compaction_requires_gate");
  if (["workspace", "artifact", "stash"].includes(subjectKind)) blockers.push("workspace_mutation_requires_authority");
  if (["skill", "hook", "app", "mcp", "external_capability"].includes(subjectKind)) blockers.push("execution_requires_promotion");
  if (["browser", "headless_route"].includes(subjectKind)) blockers.push("route_execution_requires_authority");
  if (["thread", "work_thread", "goal", "orchestration"].includes(subjectKind)) blockers.push("orchestration_transition_requires_authority");
  return normalizeStringList(blockers);
}

function visibilityForStatus(status, requestedVisibility) {
  if (requestedVisibility) return normalizeEnum(requestedVisibility, VISIBILITIES, "summary_only");
  if (status === "unknown") return "count_only";
  if (status.startsWith("blocked_")) return "blocked";
  return "summary_only";
}

function priorityFor(subjectKind, status) {
  if (["runtime", "provider", "model", "context", "work_thread"].includes(subjectKind)) return "high";
  if (status === "stale" || status.startsWith("blocked_")) return "normal";
  if (status === "unknown") return "low";
  return "normal";
}

function buildBridgeSystemEpistemicRows(input = {}) {
  const generatedAt = normalizeString(input.generatedAt, nowIso(input.nowMs));
  return mergeDefaultFacts(input).map((fact, index) => {
    const subjectKind = normalizeEnum(fact.subjectKind, SUBJECT_KINDS, "external_capability");
    const subjectId = normalizeString(fact.subjectId || fact.id, `${subjectKind}_${index + 1}`);
    const status = normalizeEnum(fact.status, STATUSES, "unknown");
    const source = normalizeString(fact.evidenceSource, sourceForKind(subjectKind));
    const blockerCodes = defaultBlockersFor(subjectKind, status, fact.blockerCodes);
    const visibility = visibilityForStatus(status, fact.epistemicVisibility);
    const displayLabel = boundedString(fact.displayLabel || fact.label || subjectId, 180);
    const compactText = boundedString(fact.compactText || fact.summary || `${displayLabel}: ${status}.`, 500);
    return {
      subjectKind,
      subjectId,
      displayLabel,
      family: boundedString(fact.family, 120),
      status,
      knowledgeClass: normalizeEnum(fact.knowledgeClass, KNOWLEDGE_CLASSES, status === "unknown" ? "derived_projection" : "harness_observed"),
      residentVisible: fact.residentVisible !== false,
      callableInCurrentRequest: false,
      declaredAsProviderTool: false,
      controlState: status === "known_available" ? "known_available" : status.startsWith("blocked_") ? "blocked_by_policy" : "not_applicable",
      perCallAuthorityRequired: false,
      availableActions: [],
      blockedActions: blockerCodes,
      controlAvailable: false,
      controlAuthorityRequired: false,
      epistemicVisibility: visibility,
      transcriptVisible: "not_applicable",
      transcriptSourceRefs: [],
      epistemicUse: normalizeEnum(fact.epistemicUse, EPISTEMIC_USES, status === "unknown" ? "avoidance_context" : "self_status"),
      authorityUse: "may_not_act",
      priority: normalizeEnum(fact.priority, PRIORITIES, priorityFor(subjectKind, status)),
      omitWhenBudgeted: fact.omitWhenBudgeted === true || status === "unknown",
      freshness: normalizeEnum(fact.freshness, FRESHNESS_VALUES, status === "stale" ? "stale" : "fresh"),
      blockerCodes,
      evidenceRefs: normalizeEvidenceRefs(fact.evidenceRefs, source),
      lastObservedAt: normalizeString(fact.lastObservedAt, generatedAt),
      compactText,
      extensions: {
        bridgeSystemClass: subjectKind,
        classFamily: boundedString(fact.family, 120),
        readOnlyWitness: true,
        source,
        rawSecretsExposed: false,
        rawPathsExposed: false,
        rawPayloadExposed: false,
        accountMutationAllowed: false,
        memoryMutationAllowed: false,
        browserAutomationAllowed: false,
        mcpExecutionAllowed: false,
        routeExecutionAllowed: false,
      },
    };
  });
}

function countBy(rows, field) {
  const counts = {};
  for (const row of rows) {
    const key = normalizeString(row?.[field], "unknown");
    counts[key] = Number(counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function buildBridgeSystemEpistemicPreview(snapshot = {}) {
  const rows = Array.isArray(snapshot.residentSnapshot?.rows) ? snapshot.residentSnapshot.rows : [];
  const preview = {
    schema: BRIDGE_SYSTEM_EPISTEMIC_PREVIEW_SCHEMA,
    snapshotId: normalizeString(snapshot.snapshotId, ""),
    rowCount: rows.length,
    bySubjectKind: countBy(rows, "subjectKind"),
    byStatus: countBy(rows, "status"),
    readOnlyWitness: true,
    compactLines: rows
      .filter((row) => row.residentVisible !== false)
      .sort((a, b) => `${a.priority}:${a.subjectKind}:${a.displayLabel}`.localeCompare(`${b.priority}:${b.subjectKind}:${b.displayLabel}`))
      .slice(0, 12)
      .map((row) => `${row.displayLabel}: ${row.status}`),
    rawSecretsExposed: false,
    rawPathsExposed: false,
    rawPayloadExposed: false,
  };
  preview.previewDigest = digestFor("bridge-system-epistemic-preview@1", preview);
  return preview;
}

function buildBridgeSystemEpistemicSnapshot(input = {}) {
  const generatedAt = normalizeString(input.generatedAt, nowIso(input.nowMs));
  const rowInputs = buildBridgeSystemEpistemicRows({ ...input, generatedAt });
  const residentSnapshot = buildResidentEpistemicSnapshot({
    workThreadId: normalizeString(input.workThreadId, "work_thread_unknown"),
    codexThreadId: normalizeString(input.codexThreadId || input.threadId, ""),
    runtimeFamily: "direct",
    generatedAt,
    snapshotCompleteness: normalizeString(input.snapshotCompleteness, "stale_or_partial"),
    projectionBudget: input.projectionBudget || { maxRows: 48, maxChars: 6000, truncationPolicy: "priority_then_summary" },
    sourceDigests: normalizeStringList(input.sourceDigests),
    rows: rowInputs,
  });
  const snapshot = {
    schema: BRIDGE_SYSTEM_EPISTEMIC_SNAPSHOT_SCHEMA,
    snapshotId: `bridge_system_epistemic_${digestFor("bridge-system-epistemic-snapshot-id@1", {
      residentSnapshotDigest: residentSnapshot.snapshotDigest,
      generatedAt,
    }).slice(7, 31)}`,
    generatedAt,
    workThreadId: residentSnapshot.workThreadId,
    codexThreadId: residentSnapshot.codexThreadId,
    residentSnapshot,
    rowCount: residentSnapshot.rows.length,
    bySubjectKind: countBy(residentSnapshot.rows, "subjectKind"),
    byStatus: countBy(residentSnapshot.rows, "status"),
    readOnlyWitness: true,
    contextInjectionEnabled: false,
    accountMutationAllowed: false,
    memoryMutationAllowed: false,
    browserAutomationAllowed: false,
    mcpExecutionAllowed: false,
    routeExecutionAllowed: false,
    rawSecretsExposed: false,
    rawPathsExposed: false,
    rawPayloadExposed: false,
  };
  snapshot.preview = buildBridgeSystemEpistemicPreview(snapshot);
  snapshot.snapshotDigest = digestFor("bridge-system-epistemic-snapshot@1", snapshot);
  return snapshot;
}

function validateBridgeSystemEpistemicSnapshot(snapshot = {}) {
  const errors = [];
  if (!isPlainObject(snapshot) || snapshot.schema !== BRIDGE_SYSTEM_EPISTEMIC_SNAPSHOT_SCHEMA) return ["bridge_system_epistemic_snapshot_schema_mismatch"];
  try {
    validateResidentEpistemicSnapshot(snapshot.residentSnapshot);
  } catch (error) {
    errors.push(`resident_snapshot:${error.message}`);
  }
  for (const flag of [
    "readOnlyWitness",
  ]) {
    if (snapshot[flag] !== true) errors.push(`bridge_system_epistemic_required_true_missing:${flag}`);
  }
  for (const flag of [
    "contextInjectionEnabled",
    "accountMutationAllowed",
    "memoryMutationAllowed",
    "browserAutomationAllowed",
    "mcpExecutionAllowed",
    "routeExecutionAllowed",
    "rawSecretsExposed",
    "rawPathsExposed",
    "rawPayloadExposed",
  ]) {
    if (snapshot[flag] !== false) errors.push(`bridge_system_epistemic_authority_or_raw_leak:${flag}`);
  }
  if (snapshot.snapshotDigest !== digestFor("bridge-system-epistemic-snapshot@1", snapshot)) errors.push("bridge_system_epistemic_snapshot_digest_mismatch");
  const rows = Array.isArray(snapshot.residentSnapshot?.rows) ? snapshot.residentSnapshot.rows : [];
  for (const row of rows) {
    if (row.callableInCurrentRequest !== false) errors.push(`bridge_system_epistemic_callable_row:${row.subjectKind}:${row.subjectId}`);
    if (row.declaredAsProviderTool !== false) errors.push(`bridge_system_epistemic_provider_declaration:${row.subjectKind}:${row.subjectId}`);
    if (row.channels?.control?.controlAvailable !== false) errors.push(`bridge_system_epistemic_control_available:${row.subjectKind}:${row.subjectId}`);
    if (row.authorityUse !== "may_not_act") errors.push(`bridge_system_epistemic_authority_use_invalid:${row.subjectKind}:${row.subjectId}`);
    if (row.extensions?.readOnlyWitness !== true) errors.push(`bridge_system_epistemic_row_not_readonly:${row.subjectKind}:${row.subjectId}`);
    for (const flag of ["rawSecretsExposed", "rawPathsExposed", "rawPayloadExposed", "accountMutationAllowed", "memoryMutationAllowed", "browserAutomationAllowed", "mcpExecutionAllowed", "routeExecutionAllowed"]) {
      if (row.extensions?.[flag] !== false) errors.push(`bridge_system_epistemic_row_leak_or_authority:${row.subjectKind}:${row.subjectId}:${flag}`);
    }
  }
  return errors;
}

module.exports = {
  BRIDGE_SYSTEM_EPISTEMIC_PREVIEW_SCHEMA,
  BRIDGE_SYSTEM_EPISTEMIC_SNAPSHOT_SCHEMA,
  buildBridgeSystemEpistemicPreview,
  buildBridgeSystemEpistemicRows,
  buildBridgeSystemEpistemicSnapshot,
  validateBridgeSystemEpistemicSnapshot,
};
