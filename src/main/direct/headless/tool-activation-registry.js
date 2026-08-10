"use strict";

const crypto = require("node:crypto");
const {
  buildDirectToolPromotionDecisionReport,
  validateDirectToolPromotionDecisionReport,
} = require("./tool-promotion-decision-report");

const DIRECT_TOOL_ACTIVATION_REGISTRY_SCHEMA = "direct_tool_activation_registry@1";
const DIRECT_TOOL_ACTIVATION_ROW_SCHEMA = "direct_tool_activation_row@1";
const DIRECT_TOOL_ACTIVATION_SNAPSHOT_SCHEMA = "direct_tool_activation_snapshot@1";

const ACTIVATION_STATES = new Set(["inactive", "active", "shadow_only", "suspended", "revoked", "expired"]);
const ACTIVATION_SCOPE_KINDS = new Set(["global_default", "project_default", "work_thread_override", "single_turn_override"]);
const ACTIVATION_EFFECTS = new Set(["allow", "deny", "shadow", "revoke"]);
const PROMOTABLE_STATES = new Set(["promotable", "promotable_restricted"]);
const SCOPE_PRECEDENCE_ORDER = ["single_turn_override", "work_thread_override", "project_default", "global_default"];

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
    .filter((key) => value[key] !== undefined)
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
  return counts;
}

function activationRequestKey(value = {}) {
  const request = isPlainObject(value) ? value : {};
  const scope = isPlainObject(request.scope) ? request.scope : {};
  return [
    normalizeString(request.toolClassId || scope.toolClassId, "*"),
    normalizeString(request.toolName, "*"),
    normalizeString(scope.kind || request.scopeKind, "*"),
    normalizeString(scope.projectId || request.projectId, "*"),
    normalizeString(scope.workThreadId || request.workThreadId, "*"),
    normalizeString(scope.turnId || request.turnId, "*"),
  ].join("|");
}

function activationRequestEffectPriority(request = {}) {
  const state = requestState(request);
  if (state === "revoked") return 0;
  if (state === "inactive" || state === "expired") return 1;
  if (state === "shadow_only" || state === "suspended") return 2;
  return 3;
}

function decisionRequestCandidates(decision = {}, requestMap = new Map(), options = {}) {
  const scope = isPlainObject(decision.scope) ? decision.scope : {};
  const toolClassId = normalizeString(scope.toolClassId, "*");
  const toolName = normalizeString(scope.toolName, "*");
  const projectId = normalizeString(options.projectId, "");
  const workThreadId = normalizeString(options.workThreadId, "");
  const turnId = normalizeString(options.turnId, "");
  const scopeSpecs = [
    { kind: "single_turn_override", projectId, workThreadId, turnId },
    { kind: "work_thread_override", projectId, workThreadId, turnId: "*" },
    { kind: "project_default", projectId, workThreadId: "*", turnId: "*" },
    { kind: "global_default", projectId: "*", workThreadId: "*", turnId: "*" },
  ];
  const toolSpecs = [
    { toolClassId, toolName, specificity: 2 },
    { toolClassId, toolName: "*", specificity: 1 },
    { toolClassId: "*", toolName: "*", specificity: 0 },
  ];
  const candidates = [];
  for (const scopeSpec of scopeSpecs) {
    const scopePrecedence = SCOPE_PRECEDENCE_ORDER.indexOf(scopeSpec.kind);
    for (const toolSpec of toolSpecs) {
      const key = [
        toolSpec.toolClassId,
        toolSpec.toolName,
        scopeSpec.kind,
        scopeSpec.projectId,
        scopeSpec.workThreadId,
        scopeSpec.turnId,
      ].join("|");
      if (!requestMap.has(key)) continue;
      const request = requestMap.get(key);
      candidates.push({
        key,
        request,
        scopePrecedence,
        effectPriority: activationRequestEffectPriority(request),
        specificity: toolSpec.specificity,
      });
    }
  }
  return candidates.sort((left, right) => (
    left.scopePrecedence - right.scopePrecedence
    || left.effectPriority - right.effectPriority
    || right.specificity - left.specificity
  ));
}

function activationRequestFor(decision = {}, requestMap = new Map(), options = {}) {
  return decisionRequestCandidates(decision, requestMap, options)[0]?.request || null;
}

function normalizeScope(request = {}, options = {}) {
  const safeRequest = isPlainObject(request) ? request : {};
  const scope = isPlainObject(safeRequest.scope) ? safeRequest.scope : {};
  const kind = normalizeString(scope.kind || safeRequest.scopeKind, options.workThreadId ? "work_thread_override" : options.projectId ? "project_default" : "global_default");
  const safeKind = ACTIVATION_SCOPE_KINDS.has(kind) ? kind : "project_default";
  const hasProject = safeKind !== "global_default";
  const hasWorkThread = safeKind === "work_thread_override" || safeKind === "single_turn_override";
  const hasTurn = safeKind === "single_turn_override";
  return {
    kind: safeKind,
    projectId: hasProject ? normalizeString(scope.projectId || safeRequest.projectId, normalizeString(options.projectId, "")) : "",
    workThreadId: hasWorkThread ? normalizeString(scope.workThreadId || safeRequest.workThreadId, normalizeString(options.workThreadId, "")) : "",
    turnId: hasTurn ? normalizeString(scope.turnId || safeRequest.turnId, normalizeString(options.turnId, "")) : "",
    operatorId: normalizeString(scope.operatorId || safeRequest.operatorId, normalizeString(options.operatorId, "")),
    configRef: normalizeString(scope.configRef || safeRequest.configRef, ""),
  };
}

function defaultScope(options = {}) {
  return normalizeScope({ scopeKind: options.projectId ? "project_default" : "global_default" }, options);
}

function isHarmlessGlobalTool(decision = {}) {
  const requestShape = normalizeString(decision.scope?.requestShapeFamily, "");
  const authorityFamily = normalizeString(decision.scope?.authorityFamily, "");
  return requestShape === "context_status_or_control" || authorityFamily === "session_control";
}

function requestState(request = null) {
  if (!isPlainObject(request)) return "inactive";
  const state = normalizeString(request.state, "");
  if (ACTIVATION_STATES.has(state)) return state;
  const effect = normalizeString(request.activationEffect, "");
  if (effect === "allow") return "active";
  if (effect === "shadow") return "shadow_only";
  if (effect === "revoke") return "revoked";
  if (effect === "deny") return "inactive";
  return "inactive";
}

function requestedEffect(request = null, state = "inactive") {
  if (isPlainObject(request) && ACTIVATION_EFFECTS.has(request.activationEffect)) return request.activationEffect;
  if (state === "active") return "allow";
  if (state === "shadow_only") return "shadow";
  if (state === "revoked") return "revoke";
  return "deny";
}

function activationStateFor(decision = {}, request = null, scope = {}) {
  const wantedState = requestState(request);
  if (wantedState === "revoked" || wantedState === "expired") return wantedState;
  if (wantedState === "inactive") return "inactive";
  if (normalizeString(decision.state, "") === "promotable_restricted") return wantedState === "active" ? "shadow_only" : wantedState;
  if (!PROMOTABLE_STATES.has(normalizeString(decision.state, ""))) return "suspended";
  if (wantedState === "active" && scope.kind === "global_default" && !isHarmlessGlobalTool(decision)) return "suspended";
  return wantedState;
}

function blockerCodesFor(decision = {}, request = null, state = "inactive", scope = {}) {
  const blockers = [];
  const promotionState = normalizeString(decision.state, "unknown");
  if (!PROMOTABLE_STATES.has(promotionState) && state !== "inactive" && state !== "revoked" && state !== "expired") {
    blockers.push(`promotion_decision_not_promotable:${promotionState}`);
  }
  if (requestState(request) === "active" && promotionState === "promotable_restricted" && state === "shadow_only") {
    blockers.push("restricted_promotion_downgraded_to_shadow_only");
  }
  if (requestState(request) === "active" && scope.kind === "global_default" && !isHarmlessGlobalTool(decision) && state === "suspended") {
    blockers.push("positive_global_activation_disabled_in_v0");
  }
  if (state === "inactive" && !request) blockers.push("activation_not_configured");
  return normalizeStringList([...blockers, ...(Array.isArray(decision.blockerCodes) && state === "suspended" ? decision.blockerCodes : [])]);
}

function providerRequestShapeSupportFor(decision = {}, state = "inactive") {
  const requestShapeFamily = normalizeString(decision.scope?.requestShapeFamily, "direct_tool_class");
  const evidenceClass = normalizeString(decision.evidenceClass, "unknown");
  let providerDeclarationState = "not_declared";
  if (state === "active" && ["real_provider_full_loop", "real_runtime_full_loop"].includes(evidenceClass)) {
    providerDeclarationState = "eligible_not_declared";
  } else if (state === "shadow_only") {
    providerDeclarationState = "shadow_not_declared";
  } else if (state === "suspended") {
    providerDeclarationState = "blocked_not_declared";
  }
  return {
    requestShapeFamily,
    evidenceClass,
    providerProfileId: normalizeString(decision.scope?.providerProfileId, ""),
    modelId: normalizeString(decision.scope?.modelId, ""),
    providerDeclarationState,
    declarationEligibleByRegistry: state === "active",
    providerDeclarationEnabled: false,
    modelVisibleToolEnabled: false,
  };
}

function localExecutorStateFor(decision = {}) {
  return {
    localExecutorVersion: normalizeString(decision.scope?.localExecutorVersion, "direct_executor_unknown"),
    implementationState: PROMOTABLE_STATES.has(normalizeString(decision.state, "")) ? "implemented_evidence_bound" : "not_eligible",
    authorityFamily: normalizeString(decision.scope?.authorityFamily, "unknown"),
  };
}

function activationEffectFor(state = "inactive") {
  if (state === "active") return "allow";
  if (state === "shadow_only") return "shadow";
  if (state === "revoked") return "revoke";
  return "deny";
}

function buildActivationRow(decision = {}, request = null, options = {}) {
  const scope = request ? normalizeScope(request, options) : defaultScope(options);
  const state = activationStateFor(decision, request, scope);
  const activationEffect = activationEffectFor(state);
  const providerRequestShapeSupport = providerRequestShapeSupportFor(decision, state);
  const row = {
    schema: DIRECT_TOOL_ACTIVATION_ROW_SCHEMA,
    activationRowId: `tool_activation_${digestFor("direct-tool-activation-row-id@1", {
      decisionDigest: decision.decisionDigest,
      scope,
      state,
      activationEffect,
    }).slice(0, 24)}`,
    toolClassId: normalizeString(decision.scope?.toolClassId, "unknown"),
    toolName: normalizeString(decision.scope?.toolName, normalizeString(decision.scope?.toolClassId, "unknown")),
    toolSchemaVersion: normalizeString(decision.scope?.toolSchemaVersion, "direct_tool_class@1"),
    state,
    activationEffect,
    scope,
    scopePrecedence: SCOPE_PRECEDENCE_ORDER.indexOf(scope.kind),
    promotionDecisionRef: {
      decisionId: normalizeString(decision.decisionId, ""),
      decisionDigest: normalizeString(decision.decisionDigest, ""),
      decisionState: normalizeString(decision.state, "unknown"),
      evidenceClass: normalizeString(decision.evidenceClass, "unknown"),
    },
    activationDecision: {
      configured: Boolean(request),
      requestedState: requestState(request),
      requestedEffect: requestedEffect(request, requestState(request)),
      activatedBy: normalizeString(request?.activatedBy, "registry_default"),
      reason: normalizeString(request?.reason, request ? "activation_request" : "not_configured"),
      createdAt: normalizeString(request?.createdAt, normalizeString(options.generatedAt, nowIso(options.nowMs))),
      appliesAt: state === "revoked" ? "immediate" : "next_turn",
    },
    providerRequestShapeSupport,
    localExecutorState: localExecutorStateFor(decision),
    authorityEnvelope: {
      authorityEnvelopeVersion: normalizeString(decision.scope?.authorityEnvelopeVersion, "authority_envelope@1"),
      perCallAuthorityRequired: true,
      activationIsDeclarationEligibilityOnly: true,
    },
    recoveryReplayClassifier: {
      classifierId: normalizeString(options.recoveryReplayClassifierId, "direct_recovery_replay_classifier@1"),
      replaySafeState: state === "active" || state === "shadow_only" || state === "inactive",
      emergencyRevokeWins: true,
    },
    contextResultEnvelopePolicy: {
      resultEnvelopeVersion: normalizeString(decision.scope?.resultEnvelopeVersion, "tool_result_envelope@1"),
      contextContributionRequiresPolicy: true,
      rawPayloadExposureAllowed: false,
    },
    inheritedRestrictions: Array.isArray(decision.restrictions) ? decision.restrictions : [],
    blockerCodes: blockerCodesFor(decision, request, state, scope),
    declarationEligibleByRegistry: providerRequestShapeSupport.declarationEligibleByRegistry,
    providerDeclarationEnabled: false,
    modelVisibleToolEnabled: false,
    perCallAuthorityBypassed: false,
    rendererAuthorityGranted: false,
    runtimeDefaultChanged: false,
    providerCallStartedByActivation: false,
    workspaceMutationStartedByActivation: false,
    rawPromptIncluded: false,
    rawResultIncluded: false,
    rawWorkspacePathIncluded: false,
    rawSecretIncluded: false,
  };
  row.rowDigest = digestFor("direct-tool-activation-row@1", row);
  return row;
}

function requestMapFor(requests = []) {
  const map = new Map();
  for (const request of Array.isArray(requests) ? requests : []) {
    if (!isPlainObject(request)) continue;
    map.set(activationRequestKey(request), request);
  }
  return map;
}

function buildSnapshot(rows = [], registrySource = {}) {
  const activeRows = (Array.isArray(rows) ? rows : []).filter((row) => row.state === "active");
  const snapshot = {
    schema: DIRECT_TOOL_ACTIVATION_SNAPSHOT_SCHEMA,
    snapshotId: `tool_activation_snapshot_${digestFor("direct-tool-activation-snapshot-id@1", {
      rowDigests: activeRows.map((row) => row.rowDigest),
      registryId: registrySource.registryId,
    }).slice(0, 24)}`,
    activeRowDigests: activeRows.map((row) => row.rowDigest),
    toolDeclarationDigest: "",
    providerDeclarationsBuilt: false,
    modelVisibleToolsEnabled: false,
    note: "PR71 records activation eligibility only; PR72 owns provider declaration materialization.",
  };
  snapshot.snapshotDigest = digestFor("direct-tool-activation-snapshot@1", snapshot);
  return snapshot;
}

function buildDirectToolActivationRegistry(options = {}) {
  const promotionReport = isPlainObject(options.promotionReport)
    ? options.promotionReport
    : buildDirectToolPromotionDecisionReport(options);
  const promotionValidationErrors = validateDirectToolPromotionDecisionReport(promotionReport);
  const requestMap = requestMapFor(options.activationRequests);
  const rows = (Array.isArray(promotionReport.decisions) ? promotionReport.decisions : [])
    .map((decision) => buildActivationRow(decision, activationRequestFor(decision, requestMap, options), options));
  const rawExposureScan = {
    passed: rows.every((row) => row.rawPromptIncluded === false
      && row.rawResultIncluded === false
      && row.rawWorkspacePathIncluded === false
      && row.rawSecretIncluded === false)
      && promotionReport.rawPromptIncluded === false
      && promotionReport.rawResultIncluded === false
      && promotionReport.rawWorkspacePathIncluded === false
      && promotionReport.rawSecretIncluded === false,
    blockedReasons: normalizeStringList(rows.flatMap((row) => (
      row.rawPromptIncluded === false
      && row.rawResultIncluded === false
      && row.rawWorkspacePathIncluded === false
      && row.rawSecretIncluded === false
        ? []
        : [`raw_exposure:${row.toolClassId}`]
    ))),
  };
  const validationErrors = [
    ...promotionValidationErrors.map((error) => `promotion_report:${error}`),
    ...(promotionReport.status !== "passed" ? [`promotion_report_not_passed:${normalizeString(promotionReport.status, "unknown")}`] : []),
    ...(rawExposureScan.passed ? [] : ["activation_raw_exposure_scan_failed"]),
    ...rows.filter((row) => row.state === "active" && row.scope.kind === "global_default" && !isHarmlessGlobalTool({ scope: { requestShapeFamily: row.providerRequestShapeSupport.requestShapeFamily, authorityFamily: row.localExecutorState.authorityFamily } }))
      .map((row) => `unsafe_positive_global_activation:${row.toolClassId}`),
  ];
  const registryId = normalizeString(options.registryId, `direct_tool_activation_registry_${digestFor("direct-tool-activation-registry-source@1", {
    promotionReportDigest: promotionReport.reportDigest,
    rowDigests: rows.map((row) => row.rowDigest),
  }).slice(0, 24)}`);
  const registry = {
    schema: DIRECT_TOOL_ACTIVATION_REGISTRY_SCHEMA,
    registryId,
    generatedAt: normalizeString(options.generatedAt, nowIso(options.nowMs)),
    registryVersion: Number.isInteger(options.registryVersion) && options.registryVersion > 0 ? options.registryVersion : 1,
    sourceEvidence: {
      promotionReportId: normalizeString(promotionReport.reportId, ""),
      promotionReportDigest: normalizeString(promotionReport.reportDigest, ""),
      toolConstitutionDigest: normalizeString(promotionReport.sourceEvidence?.toolConstitutionDigest, ""),
      implementationDigest: normalizeString(promotionReport.sourceEvidence?.implementationDigest, ""),
      providerProfileDigest: normalizeString(promotionReport.sourceEvidence?.providerProfileDigest, ""),
    },
    status: validationErrors.length ? "failed" : "passed",
    validationErrors,
    rowCount: rows.length,
    rows,
    precedenceLaw: {
      order: SCOPE_PRECEDENCE_ORDER,
      denyWins: true,
      emergencyRevokeWins: true,
      normalActivationAppliesAt: "next_turn",
    },
    snapshot: buildSnapshot(rows, { registryId }),
    rawExposureScan,
    summary: {
      byState: countBy(rows, "state"),
      byScopeKind: countBy(rows.map((row) => ({ scopeKind: row.scope.kind })), "scopeKind"),
      byActivationEffect: countBy(rows, "activationEffect"),
      activeToolClasses: rows.filter((row) => row.state === "active").map((row) => row.toolClassId),
      shadowToolClasses: rows.filter((row) => row.state === "shadow_only").map((row) => row.toolClassId),
      suspendedToolClasses: rows.filter((row) => row.state === "suspended").map((row) => row.toolClassId),
      revokedToolClasses: rows.filter((row) => row.state === "revoked").map((row) => row.toolClassId),
      inactiveToolClasses: rows.filter((row) => row.state === "inactive").map((row) => row.toolClassId),
    },
    providerDeclarationsBuilt: false,
    modelVisibleToolsEnabled: false,
    perCallAuthorityBypassed: false,
    runtimeDefaultChanged: false,
    rendererAuthorityGranted: false,
    providerCallStartedByRegistry: false,
    workspaceMutationStartedByRegistry: false,
    rawPromptIncluded: false,
    rawResultIncluded: false,
    rawWorkspacePathIncluded: false,
    rawSecretIncluded: false,
  };
  registry.registryDigest = digestFor("direct-tool-activation-registry@1", registry);
  return registry;
}

function validateDirectToolActivationRegistry(registry = {}) {
  const errors = [];
  if (!isPlainObject(registry) || registry.schema !== DIRECT_TOOL_ACTIVATION_REGISTRY_SCHEMA) {
    return ["direct_tool_activation_registry_schema_mismatch"];
  }
  if (!Array.isArray(registry.rows) || !registry.rows.length) errors.push("activation_rows_missing");
  if (!isPlainObject(registry.precedenceLaw)) errors.push("activation_precedence_law_missing");
  if (stableStringify(registry.precedenceLaw?.order || []) !== stableStringify(SCOPE_PRECEDENCE_ORDER)) {
    errors.push("activation_scope_precedence_mismatch");
  }
  if (registry.precedenceLaw?.denyWins !== true || registry.precedenceLaw?.emergencyRevokeWins !== true) {
    errors.push("activation_precedence_denial_or_revoke_law_missing");
  }
  for (const row of Array.isArray(registry.rows) ? registry.rows : []) {
    if (!isPlainObject(row) || row.schema !== DIRECT_TOOL_ACTIVATION_ROW_SCHEMA) {
      errors.push("activation_row_schema_mismatch");
      continue;
    }
    if (!ACTIVATION_STATES.has(row.state)) errors.push(`invalid_activation_state:${row.toolClassId || ""}:${row.state || ""}`);
    if (!ACTIVATION_EFFECTS.has(row.activationEffect)) errors.push(`invalid_activation_effect:${row.toolClassId || ""}:${row.activationEffect || ""}`);
    if (!isPlainObject(row.scope) || !ACTIVATION_SCOPE_KINDS.has(row.scope.kind)) errors.push(`invalid_activation_scope:${row.toolClassId || ""}`);
    if (!isPlainObject(row.promotionDecisionRef) || !row.promotionDecisionRef.decisionDigest) errors.push(`activation_missing_promotion_decision_ref:${row.toolClassId || ""}`);
    if (row.state === "active" && row.promotionDecisionRef.decisionState !== "promotable") errors.push(`active_activation_without_promotable_decision:${row.toolClassId || ""}`);
    if (row.state === "active" && row.scope.kind === "global_default" && !isHarmlessGlobalTool({ scope: { requestShapeFamily: row.providerRequestShapeSupport?.requestShapeFamily, authorityFamily: row.localExecutorState?.authorityFamily } })) {
      errors.push(`positive_global_activation_disabled:${row.toolClassId || ""}`);
    }
    if (!isPlainObject(row.authorityEnvelope) || row.authorityEnvelope.perCallAuthorityRequired !== true || row.authorityEnvelope.activationIsDeclarationEligibilityOnly !== true) {
      errors.push(`activation_authority_envelope_incomplete:${row.toolClassId || ""}`);
    }
    for (const flag of [
      "providerDeclarationEnabled",
      "modelVisibleToolEnabled",
      "perCallAuthorityBypassed",
      "rendererAuthorityGranted",
      "runtimeDefaultChanged",
      "providerCallStartedByActivation",
      "workspaceMutationStartedByActivation",
      "rawPromptIncluded",
      "rawResultIncluded",
      "rawWorkspacePathIncluded",
      "rawSecretIncluded",
    ]) {
      if (row[flag] !== false) errors.push(`activation_row_authority_or_raw_leak:${row.toolClassId || ""}:${flag}`);
    }
  }
  if (!isPlainObject(registry.snapshot) || registry.snapshot.schema !== DIRECT_TOOL_ACTIVATION_SNAPSHOT_SCHEMA) {
    errors.push("activation_snapshot_missing");
  } else if (registry.snapshot.providerDeclarationsBuilt !== false || registry.snapshot.modelVisibleToolsEnabled !== false || registry.snapshot.toolDeclarationDigest !== "") {
    errors.push("activation_snapshot_declared_tools_too_early");
  }
  if (!isPlainObject(registry.rawExposureScan) || (registry.rawExposureScan.passed !== true && registry.status !== "failed")) {
    errors.push("activation_raw_exposure_scan_not_passed");
  }
  for (const flag of [
    "providerDeclarationsBuilt",
    "modelVisibleToolsEnabled",
    "perCallAuthorityBypassed",
    "runtimeDefaultChanged",
    "rendererAuthorityGranted",
    "providerCallStartedByRegistry",
    "workspaceMutationStartedByRegistry",
    "rawPromptIncluded",
    "rawResultIncluded",
    "rawWorkspacePathIncluded",
    "rawSecretIncluded",
  ]) {
    if (registry[flag] !== false) errors.push(`activation_registry_authority_or_raw_leak:${flag}`);
  }
  if (Array.isArray(registry.validationErrors) && registry.validationErrors.length && registry.status !== "failed") {
    errors.push("activation_validation_errors_without_failed_status");
  }
  return errors;
}

module.exports = {
  DIRECT_TOOL_ACTIVATION_REGISTRY_SCHEMA,
  DIRECT_TOOL_ACTIVATION_ROW_SCHEMA,
  DIRECT_TOOL_ACTIVATION_SNAPSHOT_SCHEMA,
  buildDirectToolActivationRegistry,
  validateDirectToolActivationRegistry,
};
