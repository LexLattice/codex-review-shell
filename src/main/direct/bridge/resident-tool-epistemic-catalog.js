"use strict";

const crypto = require("node:crypto");
const {
  buildResidentEpistemicSnapshot,
  validateResidentEpistemicSnapshot,
} = require("./resident-epistemic-snapshot");
const {
  buildToolCapabilityRegistry,
} = require("./tool-capability-registry");
const {
  buildDirectToolActivationRegistry,
} = require("../headless/tool-activation-registry");

const RESIDENT_TOOL_EPISTEMIC_CATALOG_SCHEMA = "resident_tool_epistemic_catalog@1";
const RESIDENT_TOOL_EPISTEMIC_PREVIEW_SCHEMA = "resident_tool_epistemic_preview@1";

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype;
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
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
    .filter((key) => value[key] !== undefined && key !== "catalogDigest" && key !== "previewDigest")
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(",")}}`;
}

function digestFor(domain, value) {
  return crypto.createHash("sha256").update(`${domain}:${stableStringify(value)}`).digest("hex");
}

function nowIso(nowMs) {
  const ms = typeof nowMs === "number" && Number.isFinite(nowMs) ? nowMs : Date.now();
  return new Date(ms).toISOString();
}

function countBy(rows, field) {
  const counts = {};
  for (const row of rows) {
    const key = normalizeString(row?.[field], "unknown");
    counts[key] = Number(counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function rowNames(capabilityRow = {}) {
  return normalizeStringList([
    capabilityRow.toolId,
    ...(Array.isArray(capabilityRow.directNames) ? capabilityRow.directNames : []),
    ...(Array.isArray(capabilityRow.vanillaNames) ? capabilityRow.vanillaNames : []),
  ]);
}

function capabilityAliases(capabilityRow = {}) {
  const toolId = normalizeString(capabilityRow.toolId, "");
  const aliases = [];
  if (toolId === "vanilla.get_context_remaining") {
    aliases.push("get_context_remaining", "session_control.plan_and_context_witness", "context_status_or_control");
  }
  return aliases;
}

function activationNames(activationRow = {}) {
  return normalizeStringList([
    activationRow.toolName,
    activationRow.toolClassId,
    activationRow.providerRequestShapeSupport?.requestShapeFamily,
  ]);
}

function buildActivationIndex(activationRegistry = {}) {
  const byKey = new Map();
  for (const row of Array.isArray(activationRegistry.rows) ? activationRegistry.rows : []) {
    for (const key of activationNames(row)) {
      if (!byKey.has(key)) byKey.set(key, row);
    }
  }
  return byKey;
}

function buildDeclarationIndex(firstToolSlice = {}) {
  const byKey = new Map();
  for (const row of Array.isArray(firstToolSlice.declarations) ? firstToolSlice.declarations : []) {
    for (const key of normalizeStringList([
      row.toolName,
      row.toolClassId,
      row.activationRowId,
      row.requestShapeFamily,
    ])) {
      if (!byKey.has(key)) byKey.set(key, row);
    }
  }
  return byKey;
}

function buildGateIndex(perCallGates = []) {
  const byKey = new Map();
  for (const gate of Array.isArray(perCallGates) ? perCallGates : []) {
    for (const key of normalizeStringList([
      gate.toolName,
      gate.activationRowId,
      gate.declarationRowId,
      gate.declarationDigest,
    ])) {
      if (!byKey.has(key)) byKey.set(key, gate);
    }
  }
  return byKey;
}

function findActivationRow(capabilityRow = {}, activationIndex = new Map()) {
  for (const key of [
    ...rowNames(capabilityRow),
    ...capabilityAliases(capabilityRow),
    ...(Array.isArray(capabilityRow.requestShapeFamilies) ? capabilityRow.requestShapeFamilies : []),
  ]) {
    if (activationIndex.has(key)) return activationIndex.get(key);
  }
  return null;
}

function findDeclaration(capabilityRow = {}, activationRow = null, declarationIndex = new Map()) {
  const keys = normalizeStringList([
    ...rowNames(capabilityRow),
    ...capabilityAliases(capabilityRow),
    ...(Array.isArray(capabilityRow.requestShapeFamilies) ? capabilityRow.requestShapeFamilies : []),
    activationRow?.toolName,
    activationRow?.toolClassId,
    activationRow?.activationRowId,
    activationRow?.providerRequestShapeSupport?.requestShapeFamily,
  ]);
  for (const key of keys) {
    if (declarationIndex.has(key)) return declarationIndex.get(key);
  }
  return null;
}

function findGate(capabilityRow = {}, activationRow = null, declaration = null, gateIndex = new Map()) {
  const keys = normalizeStringList([
    ...rowNames(capabilityRow),
    ...capabilityAliases(capabilityRow),
    activationRow?.toolName,
    activationRow?.activationRowId,
    declaration?.toolName,
    declaration?.declarationRowId,
    declaration?.declarationDigest,
  ]);
  for (const key of keys) {
    if (gateIndex.has(key)) return gateIndex.get(key);
  }
  return null;
}

function hasAuthBlocker(blockers = []) {
  return normalizeStringList(blockers).some((code) => code.includes("auth") || code.includes("login"));
}

function hasRuntimeBlocker(blockers = []) {
  return normalizeStringList(blockers).some((code) => code.includes("runtime") || code.includes("provider_profile") || code.includes("model"));
}

function hasMissingEvidenceBlocker(blockers = []) {
  return normalizeStringList(blockers).some((code) => code.includes("evidence") || code.includes("smoke") || code.includes("fixture"));
}

function statusFor({ capabilityRow = {}, activationRow = null, declaration = null, gate = null } = {}) {
  const blockers = normalizeStringList([
    ...(Array.isArray(activationRow?.blockerCodes) ? activationRow.blockerCodes : []),
    ...(Array.isArray(gate?.blockerCodes) ? gate.blockerCodes : []),
  ]);
  if (gate?.status === "blocked") {
    if (hasAuthBlocker(blockers)) return "blocked_by_auth";
    if (hasRuntimeBlocker(blockers)) return "blocked_by_runtime";
    if (hasMissingEvidenceBlocker(blockers)) return "blocked_by_missing_evidence";
    return "blocked_by_policy";
  }
  if (declaration && activationRow?.state === "active" && gate?.status !== "blocked") return "callable_now";
  if (activationRow?.state === "shadow_only") return "shadow_only";
  if (["revoked", "suspended"].includes(activationRow?.state)) {
    if (hasAuthBlocker(blockers)) return "blocked_by_auth";
    if (hasRuntimeBlocker(blockers)) return "blocked_by_runtime";
    if (hasMissingEvidenceBlocker(blockers)) return "blocked_by_missing_evidence";
    return "blocked_by_policy";
  }
  if (activationRow?.state === "active" && !declaration) return "blocked_by_missing_evidence";
  if (capabilityRow.promotionState === "unsupported" || capabilityRow.implementationState === "none") return "not_implemented";
  if (hasMissingEvidenceBlocker(blockers) || capabilityRow.promotionState === "fixture_only" || capabilityRow.promotionState === "diagnostic_only") return "blocked_by_missing_evidence";
  if (activationRow?.state === "inactive") return "known_disabled";
  if (capabilityRow.promotionState === "direct_restricted" || capabilityRow.promotionState === "direct_enabled") return "known_available";
  return "unknown";
}

function controlStateFor(status) {
  if (status === "callable_now") return "callable_now";
  if (status === "known_available") return "known_available";
  if (status === "shadow_only") return "shadow_only";
  if (status === "blocked_by_runtime" || status === "blocked_by_auth") return "blocked_by_runtime";
  if (status === "blocked_by_policy") return "blocked_by_policy";
  if (status === "blocked_by_missing_evidence") return "blocked_by_missing_authority";
  return "not_applicable";
}

function priorityFor(status) {
  if (status === "callable_now") return "critical";
  if (status === "shadow_only" || status === "known_available") return "high";
  if (status.startsWith("blocked_")) return "normal";
  if (status === "known_disabled") return "low";
  return "diagnostic";
}

function authorityUseFor(status) {
  if (status === "callable_now") return "may_prepare_call";
  if (status === "known_available" || status === "shadow_only" || status.startsWith("blocked_")) return "may_request_authority";
  return "may_not_act";
}

function compactTextFor({ capabilityRow = {}, activationRow = null, declaration = null, gate = null, status = "unknown" } = {}) {
  const toolName = normalizeString(declaration?.toolName || activationRow?.toolName || capabilityRow.toolId, "tool");
  const activationState = normalizeString(activationRow?.state, "no_activation_row");
  const declarationState = declaration ? "declared_in_request" : normalizeString(activationRow?.providerRequestShapeSupport?.providerDeclarationState || capabilityRow.providerDeclarationState, "not_declared");
  const gateState = gate ? `; latest gate=${normalizeString(gate.status, "unknown")}` : "";
  return `${toolName} is ${status}; activation=${activationState}; provider=${declarationState}; per-call authority remains required${gateState}.`;
}

function enablementPathFor({ capabilityRow = {}, activationRow = null, status = "unknown" } = {}) {
  if (status === "callable_now") {
    return [{
      kind: "operator_enablement",
      label: "Callable in the current request; each call still passes the per-call authority gate.",
      authorityRequired: true,
      enablementPathUse: "operator_explanation_only",
    }];
  }
  if (status === "not_implemented") {
    return [{
      kind: "implementation_required",
      label: normalizeString(capabilityRow.unsupportedReason, "Implement the local executor and evidence gates before this tool can become callable."),
      authorityRequired: false,
      enablementPathUse: "agent_must_not_request",
    }];
  }
  if (status === "blocked_by_missing_evidence" || status === "shadow_only") {
    return [{
      kind: "live_probe",
      label: "Promotion/full-loop evidence is missing or restricted; run the promotion evidence path before exposing this tool.",
      authorityRequired: false,
      enablementPathUse: "operator_explanation_only",
    }];
  }
  if (status === "blocked_by_auth") {
    return [{
      kind: "auth_login",
      label: "Authenticate the required provider/account before this tool can become available.",
      authorityRequired: false,
      enablementPathUse: "operator_explanation_only",
    }];
  }
  if (status === "blocked_by_runtime") {
    return [{
      kind: "runtime_switch",
      label: "Switch or repair the runtime/provider profile before this tool can become available.",
      authorityRequired: false,
      enablementPathUse: "operator_explanation_only",
    }];
  }
  if (status === "blocked_by_policy") {
    return [{
      kind: "policy_change",
      label: "A policy or revoke row blocks this tool; operator policy must change before use.",
      authorityRequired: true,
      enablementPathUse: "agent_may_request_operator",
    }];
  }
  if (activationRow?.state === "inactive" || status === "known_disabled") {
    return [{
      kind: "operator_enablement",
      label: "Enable the tool class for this project/work-thread if the operator wants it available.",
      authorityRequired: true,
      enablementPathUse: "agent_may_request_operator",
    }];
  }
  return [{
    kind: "not_supported",
    label: "No safe enablement path is known from the current evidence.",
    authorityRequired: false,
    enablementPathUse: "agent_must_not_request",
  }];
}

function evidenceRefsFor({ capabilityRow = {}, activationRow = null, declaration = null } = {}) {
  const refs = [];
  if (capabilityRow.rowDigest) {
    refs.push({ refId: capabilityRow.rowDigest, source: "audit_row", digest: capabilityRow.rowDigest });
  }
  if (activationRow?.rowDigest) {
    refs.push({ refId: activationRow.activationRowId || activationRow.rowDigest, source: "activation_registry", digest: activationRow.rowDigest });
  }
  if (activationRow?.promotionDecisionRef?.decisionDigest) {
    refs.push({ refId: activationRow.promotionDecisionRef.decisionId || activationRow.promotionDecisionRef.decisionDigest, source: "promotion_decision", digest: activationRow.promotionDecisionRef.decisionDigest });
  }
  if (declaration?.declarationDigest) {
    refs.push({ refId: declaration.declarationRowId || declaration.declarationDigest, source: "tool_declaration", digest: declaration.declarationDigest });
  }
  return refs;
}

function residentToolRowFor(input = {}) {
  const { capabilityRow = {}, activationRow = null, declaration = null, gate = null } = input;
  const status = statusFor(input);
  const callable = status === "callable_now";
  const blockers = normalizeStringList([
    ...(Array.isArray(activationRow?.blockerCodes) ? activationRow.blockerCodes : []),
    ...(Array.isArray(gate?.blockerCodes) ? gate.blockerCodes : []),
    ...(status === "known_disabled" ? ["activation_inactive"] : []),
    ...(status === "not_implemented" ? ["implementation_missing"] : []),
    ...(status === "blocked_by_missing_evidence" && !activationRow?.blockerCodes?.length ? ["provider_declaration_or_promotion_evidence_missing"] : []),
  ]);
  return {
    subjectKind: "tool",
    subjectId: normalizeString(capabilityRow.toolId || activationRow?.toolClassId || activationRow?.toolName, "unknown_tool"),
    displayLabel: normalizeString(capabilityRow.displayName || activationRow?.toolName || capabilityRow.toolId, "Tool"),
    family: normalizeString(capabilityRow.odeuFamily || activationRow?.localExecutorState?.authorityFamily, "unknown"),
    status,
    knowledgeClass: declaration ? "exact_runtime" : activationRow ? "harness_observed" : "registry_declared",
    residentVisible: true,
    callableInCurrentRequest: callable,
    declaredAsProviderTool: Boolean(declaration),
    controlState: controlStateFor(status),
    perCallAuthorityRequired: callable || activationRow?.authorityEnvelope?.perCallAuthorityRequired === true,
    availableActions: callable ? ["call"] : [],
    blockedActions: callable ? [] : blockers,
    controlAvailable: callable,
    controlAuthorityRequired: callable || status.startsWith("blocked_"),
    epistemicVisibility: "full_status",
    transcriptVisible: "not_applicable",
    epistemicUse: status === "callable_now" ? "planning_context" : "avoidance_context",
    authorityUse: authorityUseFor(status),
    priority: priorityFor(status),
    omitWhenBudgeted: !["callable_now", "shadow_only", "blocked_by_policy"].includes(status),
    scope: normalizeString(activationRow?.scope?.kind, "") === "single_turn_override" ? "turn" : "work_thread",
    blockerCodes: blockers,
    enablementPath: enablementPathFor({ capabilityRow, activationRow, status }),
    evidenceRefs: evidenceRefsFor({ capabilityRow, activationRow, declaration }),
    compactText: compactTextFor({ capabilityRow, activationRow, declaration, gate, status }),
    extensions: {
      toolClassId: normalizeString(activationRow?.toolClassId, ""),
      toolName: normalizeString(declaration?.toolName || activationRow?.toolName || capabilityRow.toolId, ""),
      activationState: normalizeString(activationRow?.state, "missing"),
      activationRowId: normalizeString(activationRow?.activationRowId, ""),
      promotionDecisionState: normalizeString(activationRow?.promotionDecisionRef?.decisionState, ""),
      evidenceClass: normalizeString(activationRow?.promotionDecisionRef?.evidenceClass || activationRow?.providerRequestShapeSupport?.evidenceClass, ""),
      providerDeclarationState: declaration ? "declared_in_current_request" : normalizeString(activationRow?.providerRequestShapeSupport?.providerDeclarationState || capabilityRow.providerDeclarationState, ""),
      declarationRowId: normalizeString(declaration?.declarationRowId, ""),
      gateStatus: normalizeString(gate?.status, ""),
    },
  };
}

function buildResidentToolEpistemicRows(input = {}) {
  const capabilityRegistry = isPlainObject(input.capabilityRegistry)
    ? input.capabilityRegistry
    : buildToolCapabilityRegistry(input);
  const activationRegistry = isPlainObject(input.activationRegistry)
    ? input.activationRegistry
    : buildDirectToolActivationRegistry(input);
  const activationIndex = buildActivationIndex(activationRegistry);
  const declarationIndex = buildDeclarationIndex(input.firstToolSlice || input.declarationSlice || {});
  const gateIndex = buildGateIndex(input.perCallGates || input.toolCallGates || []);
  return (Array.isArray(capabilityRegistry.rows) ? capabilityRegistry.rows : [])
    .map((capabilityRow) => {
      const activationRow = findActivationRow(capabilityRow, activationIndex);
      const declaration = findDeclaration(capabilityRow, activationRow, declarationIndex);
      const gate = findGate(capabilityRow, activationRow, declaration, gateIndex);
      return residentToolRowFor({ capabilityRow, activationRow, declaration, gate });
    });
}

function buildResidentToolEpistemicCatalog(input = {}) {
  const generatedAt = normalizeString(input.generatedAt, nowIso(input.nowMs));
  const capabilityRegistry = isPlainObject(input.capabilityRegistry)
    ? input.capabilityRegistry
    : buildToolCapabilityRegistry(input);
  const activationRegistry = isPlainObject(input.activationRegistry)
    ? input.activationRegistry
    : buildDirectToolActivationRegistry(input);
  const firstToolSlice = isPlainObject(input.firstToolSlice) ? input.firstToolSlice : null;
  const rows = buildResidentToolEpistemicRows({
    ...input,
    capabilityRegistry,
    activationRegistry,
    firstToolSlice,
  });
  const snapshot = buildResidentEpistemicSnapshot({
    workThreadId: normalizeString(input.workThreadId, capabilityRegistry.workThreadId || "work_thread_unknown"),
    codexThreadId: normalizeString(input.codexThreadId, ""),
    runtimeFamily: "direct",
    generatedAt,
    declarationDigest: normalizeString(firstToolSlice?.toolDeclarationDigest, "") || undefined,
    sourceDigests: normalizeStringList([
      capabilityRegistry.registryDigest,
      activationRegistry.registryDigest,
      firstToolSlice?.sliceDigest,
    ]),
    projectionBudget: input.projectionBudget || { maxRows: 12, maxChars: 2400, truncationPolicy: "priority_then_summary" },
    rows,
  });
  const compactRows = snapshot.rows.filter((row) => snapshot.compactTextSourceRowIds.includes(row.rowId));
  const preview = {
    schema: RESIDENT_TOOL_EPISTEMIC_PREVIEW_SCHEMA,
    generatedAt,
    workThreadId: snapshot.workThreadId,
    status: "preview_only",
    compactText: snapshot.compactResidentText,
    compactTextDigest: snapshot.compactTextDigest,
    includedRowIds: snapshot.compactTextSourceRowIds,
    omittedClassCounts: snapshot.omittedClassCounts,
    byStatus: countBy(snapshot.rows, "status"),
    callableToolIds: compactRows.filter((row) => row.status === "callable_now").map((row) => row.subjectId),
    blockedToolIds: compactRows.filter((row) => row.status.startsWith("blocked_")).map((row) => row.subjectId),
    contextInjectionEnabled: false,
    authorityGranted: false,
  };
  preview.previewDigest = digestFor("resident-tool-epistemic-preview@1", preview);
  const catalog = {
    schema: RESIDENT_TOOL_EPISTEMIC_CATALOG_SCHEMA,
    catalogId: normalizeString(input.catalogId, `resident_tool_epistemic_catalog_${digestFor("resident-tool-epistemic-catalog-id@1", {
      capabilityRegistryDigest: capabilityRegistry.registryDigest,
      activationRegistryDigest: activationRegistry.registryDigest,
      firstToolSliceDigest: firstToolSlice?.sliceDigest,
    }).slice(0, 24)}`),
    generatedAt,
    projectId: normalizeString(input.projectId, capabilityRegistry.projectId || ""),
    workThreadId: snapshot.workThreadId,
    capabilityRegistryDigest: normalizeString(capabilityRegistry.registryDigest, ""),
    activationRegistryDigest: normalizeString(activationRegistry.registryDigest, ""),
    firstToolSliceDigest: normalizeString(firstToolSlice?.sliceDigest, ""),
    firstToolDeclarationDigest: normalizeString(firstToolSlice?.toolDeclarationDigest, ""),
    rowCount: snapshot.rows.length,
    rows: snapshot.rows,
    snapshot,
    preview,
    contextInjectionEnabled: false,
    providerDeclarationsEnabledByCatalog: false,
    localExecutionEnabledByCatalog: false,
    perCallAuthorityBypassed: false,
    rendererAuthorityGranted: false,
    requestShapeMutationEnabledByCatalog: false,
    rawPromptIncluded: false,
    rawResultIncluded: false,
    rawWorkspacePathIncluded: false,
    rawSecretIncluded: false,
  };
  catalog.catalogDigest = digestFor("resident-tool-epistemic-catalog@1", catalog);
  return catalog;
}

function validateResidentToolEpistemicCatalog(catalog = {}) {
  const errors = [];
  if (!isPlainObject(catalog) || catalog.schema !== RESIDENT_TOOL_EPISTEMIC_CATALOG_SCHEMA) {
    return ["resident_tool_epistemic_catalog_schema_mismatch"];
  }
  if (!Array.isArray(catalog.rows) || !catalog.rows.length) errors.push("resident_tool_epistemic_rows_missing");
  if (!isPlainObject(catalog.snapshot)) errors.push("resident_tool_epistemic_snapshot_missing");
  if (!isPlainObject(catalog.preview) || catalog.preview.schema !== RESIDENT_TOOL_EPISTEMIC_PREVIEW_SCHEMA) errors.push("resident_tool_epistemic_preview_missing");
  try {
    validateResidentEpistemicSnapshot(catalog.snapshot);
  } catch (error) {
    errors.push(`resident_snapshot:${error.message}`);
  }
  if (catalog.catalogDigest !== digestFor("resident-tool-epistemic-catalog@1", catalog)) errors.push("resident_tool_epistemic_catalog_digest_mismatch");
  for (const row of Array.isArray(catalog.rows) ? catalog.rows : []) {
    if (row.subjectKind !== "tool") errors.push(`resident_tool_epistemic_non_tool_row:${row.rowId || ""}`);
    if (row.status === "callable_now") {
      if (row.declaredAsProviderTool !== true) errors.push(`resident_tool_epistemic_callable_not_declared:${row.subjectId || ""}`);
      if (row.perCallAuthorityRequired !== true) errors.push(`resident_tool_epistemic_callable_without_per_call_authority:${row.subjectId || ""}`);
    }
    if (row.callableInCurrentRequest === true && row.status !== "callable_now") {
      errors.push(`resident_tool_epistemic_callable_flag_mismatch:${row.subjectId || ""}`);
    }
  }
  for (const flag of [
    "contextInjectionEnabled",
    "providerDeclarationsEnabledByCatalog",
    "localExecutionEnabledByCatalog",
    "perCallAuthorityBypassed",
    "rendererAuthorityGranted",
    "requestShapeMutationEnabledByCatalog",
    "rawPromptIncluded",
    "rawResultIncluded",
    "rawWorkspacePathIncluded",
    "rawSecretIncluded",
  ]) {
    if (catalog[flag] !== false) errors.push(`resident_tool_epistemic_authority_or_raw_leak:${flag}`);
  }
  if (catalog.preview?.contextInjectionEnabled !== false || catalog.preview?.authorityGranted !== false) {
    errors.push("resident_tool_epistemic_preview_authority_leak");
  }
  return errors;
}

module.exports = {
  RESIDENT_TOOL_EPISTEMIC_CATALOG_SCHEMA,
  RESIDENT_TOOL_EPISTEMIC_PREVIEW_SCHEMA,
  buildResidentToolEpistemicCatalog,
  buildResidentToolEpistemicRows,
  validateResidentToolEpistemicCatalog,
};
