"use strict";

const crypto = require("node:crypto");
const {
  buildOdeuCapabilityWitnessRow,
  validateOdeuCapabilityWitnessRow,
} = require("../odeu");
const { normalizeId, normalizeString, nowIso, isPlainObject } = require("../meta-session/ids");
const {
  DEFERRED_SUB_AGENT_CONTROLS,
  RESIDENT_FIRST_SLICE_TOOLS,
} = require("./sub-agent-capability-profile");
const {
  RESIDENT_SUB_AGENT_TOOL_DECLARATION_SCHEMA,
  validateResidentSubAgentToolDeclaration,
} = require("./sub-agent-resident-declaration");

const RESIDENT_SUB_AGENT_OPERATOR_PROJECTION_SCHEMA = "resident_sub_agent_operator_projection@1";
const RESIDENT_SUB_AGENT_MANUAL_USABILITY_GATE_SCHEMA = "resident_sub_agent_manual_usability_gate@1";
const RESIDENT_SUB_AGENT_ANALYTICS_HOOK_SCHEMA = "resident_sub_agent_analytics_hook@1";

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

function optionNow(options = {}) {
  if (typeof options.now === "function") return options.now();
  if (Number.isFinite(Number(options.now))) return Number(options.now);
  if (Number.isFinite(Number(options.nowMs))) return Number(options.nowMs);
  return Date.now();
}

function declarationInput(input = {}) {
  const declaration = isPlainObject(input.declaration) ? input.declaration : null;
  if (!declaration || declaration.schema !== RESIDENT_SUB_AGENT_TOOL_DECLARATION_SCHEMA) {
    throw new Error("resident_sub_agent_operator_projection_requires_pr95_declaration");
  }
  validateResidentSubAgentToolDeclaration(declaration);
  return declaration;
}

function toolRowMap(declaration = {}) {
  return new Map((declaration.catalog?.rows || []).map((row) => [row.extensions?.toolName || row.subjectId, row]));
}

function buildPrimaryTranscriptActivitySummary(declaration = {}, generatedAt = "") {
  const routeSmoke = declaration.routeSmoke || {};
  const childAgentId = normalizeString(routeSmoke.childAgentId, "unknown_child_agent");
  const status = normalizeString(routeSmoke.status, "unknown");
  const resultAdmitted = Boolean(routeSmoke.resultEnvelopeId && routeSmoke.contextAdmissionId && routeSmoke.resultAdmissionEnvelopeId);
  const rows = [
    {
      rowId: "sub_agent_activity_spawn_pr96",
      eventKind: "sub_agent_spawned",
      childAgentId,
      status,
      displayLabel: `Sub-agent ${childAgentId}`,
      compactText: `Sub-agent ${childAgentId} spawned under summary-only Wave 15 policy.`,
      primaryTranscriptBubbleKind: "sub_agent_activity_summary",
      childTranscriptFlattened: false,
      childOutputPromotedToPrimaryTranscript: false,
      operatorActionAvailable: "open_sub_agent_panel_read_only",
    },
    {
      rowId: "sub_agent_activity_result_pr96",
      eventKind: resultAdmitted ? "sub_agent_result_admitted" : "sub_agent_result_unavailable",
      childAgentId,
      status,
      displayLabel: resultAdmitted ? "Child result admitted" : "Child result unavailable",
      compactText: resultAdmitted
        ? "Child result was reduced, enveloped, and admitted as parent-context summary evidence."
        : "Child result did not produce the full result/admission witness chain.",
      primaryTranscriptBubbleKind: "sub_agent_activity_summary",
      childTranscriptFlattened: false,
      childOutputPromotedToPrimaryTranscript: false,
      operatorActionAvailable: "inspect_result_witnesses",
    },
  ];
  const summary = {
    schema: "resident_sub_agent_primary_transcript_activity_summary@1",
    generatedAt,
    workThreadId: declaration.workThreadId,
    primaryThreadId: declaration.primaryThreadId,
    rowCount: rows.length,
    rows,
    childTranscriptFlattened: false,
    childOutputPromotedToPrimaryTranscript: false,
    rawChildPromptIncluded: false,
    rawChildTranscriptIncluded: false,
    rawProviderPayloadIncluded: false,
  };
  summary.summaryDigest = digestFor("resident-sub-agent-primary-transcript-activity-summary@1", summary);
  return summary;
}

function buildOperatorWitnessRows(declaration = {}) {
  return RESIDENT_FIRST_SLICE_TOOLS.map((toolName) => buildOdeuCapabilityWitnessRow({
    witnessRowId: `operator_sub_agent_witness_${toolName}`,
    capabilityId: `sub_agent_${toolName}`,
    residentVisible: true,
    residentCallable: true,
    operatorVisible: true,
    operatorCallable: false,
    status: "callable_now",
    usabilityProofId: declaration.usabilityProof.proofId,
    compactText: `${toolName} is resident-callable; operator projection is status/proof-only and cannot invoke or widen it.`,
    sourceRefs: declaration.usabilityProof.sourceRefs,
  }));
}

function buildOperatorStatusRows(declaration = {}) {
  const rowsByTool = toolRowMap(declaration);
  const rows = [];
  for (const toolName of RESIDENT_FIRST_SLICE_TOOLS) {
    const catalogRow = rowsByTool.get(toolName);
    rows.push({
      rowId: `operator_status_${toolName}`,
      toolName,
      status: catalogRow?.status || "unknown",
      operatorVisible: true,
      operatorCallable: false,
      residentCallable: catalogRow?.callableInCurrentRequest === true,
      proofId: declaration.usabilityProof.proofId,
      compactText: `${toolName}: ${catalogRow?.status || "unknown"} for resident; operator view is proof/status only.`,
    });
  }
  for (const toolName of DEFERRED_SUB_AGENT_CONTROLS) {
    const catalogRow = rowsByTool.get(toolName);
    rows.push({
      rowId: `operator_status_${toolName}`,
      toolName,
      status: catalogRow?.status || "blocked",
      operatorVisible: true,
      operatorCallable: false,
      residentCallable: false,
      proofId: "",
      compactText: `${toolName}: undeclared in Wave 15 and blocked from operator projection.`,
    });
  }
  return rows;
}

function manualGateRow(input = {}) {
  const available = input.available === true;
  const row = {
    rowId: normalizeId(input.rowId, "resident_sub_agent_manual_gate_row"),
    checkKind: normalizeString(input.checkKind, "unknown"),
    label: normalizeString(input.label, "Manual gate check"),
    state: available ? "passed" : "blocked",
    required: input.required !== false,
    evidenceRefs: Array.isArray(input.evidenceRefs) ? input.evidenceRefs : [],
    blockerCodes: available ? [] : [normalizeString(input.blockerCode, `${input.checkKind || "check"}_missing`)],
    operatorAction: normalizeString(input.operatorAction, "Inspect proof evidence."),
  };
  row.rowDigest = digestFor("resident-sub-agent-manual-gate-row@1", row);
  return row;
}

function buildManualUsabilityGate(declaration = {}, generatedAt = "") {
  const rowsByTool = toolRowMap(declaration);
  const routeSmoke = declaration.routeSmoke || {};
  const rows = [
    manualGateRow({
      rowId: "manual_gate_spawn_agent",
      checkKind: "spawn_agent",
      label: "Spawn agent resident tool declared",
      available: rowsByTool.get("spawn_agent")?.status === "callable_now",
      evidenceRefs: [{ kind: "resident_tool_declaration", digest: declaration.declarationDigest, label: "spawn declaration" }],
      operatorAction: "Confirm spawn is resident-callable only, not an operator control.",
    }),
    manualGateRow({
      rowId: "manual_gate_list_agents",
      checkKind: "list_agents",
      label: "List agents resident tool declared",
      available: rowsByTool.get("list_agents")?.status === "callable_now",
      evidenceRefs: [{ kind: "resident_tool_catalog", digest: declaration.catalog.catalogDigest, label: "list catalog row" }],
      operatorAction: "Confirm listing is scoped to the active work thread.",
    }),
    manualGateRow({
      rowId: "manual_gate_inspect_agent",
      checkKind: "inspect_agent",
      label: "Inspect agent E-channel visible",
      available: rowsByTool.get("inspect_agent")?.status === "callable_now",
      evidenceRefs: [{ kind: "resident_tool_catalog", digest: declaration.catalog.catalogDigest, label: "inspect catalog row" }],
      operatorAction: "Confirm inspect is read-only and does not interfere with the child.",
    }),
    manualGateRow({
      rowId: "manual_gate_wait_agent",
      checkKind: "wait_agent",
      label: "Wait agent bounded operation visible",
      available: rowsByTool.get("wait_agent")?.status === "callable_now",
      evidenceRefs: [{ kind: "resident_tool_catalog", digest: declaration.catalog.catalogDigest, label: "wait catalog row" }],
      operatorAction: "Confirm wait is bounded and result-admission governed.",
    }),
    manualGateRow({
      rowId: "manual_gate_result_admission",
      checkKind: "result_admission",
      label: "Child result admitted as summary",
      available: Boolean(routeSmoke.resultEnvelopeId && routeSmoke.contextAdmissionId && routeSmoke.resultAdmissionEnvelopeId),
      evidenceRefs: [
        { kind: "result_envelope", id: routeSmoke.resultEnvelopeId || "", label: "child result envelope" },
        { kind: "context_admission", id: routeSmoke.contextAdmissionId || "", label: "child context admission" },
        { kind: "result_admission_envelope", id: routeSmoke.resultAdmissionEnvelopeId || "", label: "child result admission envelope" },
      ],
      operatorAction: "Confirm child result appears as summary evidence, not transcript flattening.",
    }),
    manualGateRow({
      rowId: "manual_gate_no_interference_controls",
      checkKind: "no_interference_controls",
      label: "Interference/lifecycle controls remain unavailable",
      available: declaration.negativeSmoke?.sendFollowupCloseInterruptResumeBlocked === true
        && declaration.negativeSmoke?.recursiveSpawnBlockedByChildToolsDisabled === true,
      evidenceRefs: [{ kind: "negative_smoke", digest: declaration.declarationDigest, label: "negative smoke" }],
      operatorAction: "Confirm send/followup/close/interrupt/resume/recursive spawn are absent from operator controls.",
    }),
  ];
  const requiredBlockedCount = rows.filter((row) => row.required && row.state === "blocked").length;
  const gate = {
    schema: RESIDENT_SUB_AGENT_MANUAL_USABILITY_GATE_SCHEMA,
    gateId: "resident_sub_agent_manual_usability_gate_pr96",
    generatedAt,
    projectId: declaration.projectId,
    workThreadId: declaration.workThreadId,
    gateState: requiredBlockedCount ? "blocked" : "passed",
    rows,
    counts: {
      rowCount: rows.length,
      passedCount: rows.filter((row) => row.state === "passed").length,
      blockedCount: rows.filter((row) => row.state === "blocked").length,
      requiredBlockedCount,
    },
    sentinelCounters: {
      providerTransportCalls: 0,
      appServerMutationCalls: 0,
      operatorControlInvocations: 0,
      activationOverrides: 0,
      childTranscriptInjections: 0,
      followupOrLifecycleControlCalls: 0,
      workspaceMutationCalls: 0,
    },
    operatorProjectionAuthority: {
      declaresProviderTools: false,
      overridesActivation: false,
      injectsChildTranscript: false,
      sendsFollowup: false,
      interruptsOrClosesChild: false,
      mutatesWorkspace: false,
    },
  };
  gate.gateDigest = digestFor("resident-sub-agent-manual-usability-gate@1", gate);
  return gate;
}

function buildAnalyticsHook(declaration = {}, generatedAt = "") {
  const routeSmoke = declaration.routeSmoke || {};
  const tokenUsage = isPlainObject(routeSmoke.tokenUsage) ? routeSmoke.tokenUsage : null;
  const hook = {
    schema: RESIDENT_SUB_AGENT_ANALYTICS_HOOK_SCHEMA,
    hookId: "resident_sub_agent_analytics_hook_pr96",
    generatedAt,
    projectId: declaration.projectId,
    workThreadId: declaration.workThreadId,
    primaryThreadId: declaration.primaryThreadId,
    childAgentId: normalizeString(routeSmoke.childAgentId, ""),
    usageAttributionAvailable: routeSmoke.usageAttributionAvailable === true,
    usageAttributionId: normalizeString(routeSmoke.usageAttributionId, ""),
    usageAttribution: normalizeString(routeSmoke.usageAttribution, "unknown"),
    parentUsageMerged: routeSmoke.parentUsageMerged === true,
    tokenUsage,
    usageUnavailableReason: normalizeString(routeSmoke.usageUnavailableReason, ""),
    analyticsSurface: "direct_middle_analytics_future",
    rawPromptIncluded: false,
    rawResultIncluded: false,
    rawProviderPayloadIncluded: false,
  };
  hook.hookDigest = digestFor("resident-sub-agent-analytics-hook@1", hook);
  return hook;
}

function buildResidentSubAgentOperatorProjection(input = {}, options = {}) {
  const declaration = declarationInput(input);
  const generatedAt = normalizeString(input.generatedAt, nowIso(optionNow(options)));
  const primaryTranscriptActivitySummary = buildPrimaryTranscriptActivitySummary(declaration, generatedAt);
  const operatorWitnessRows = buildOperatorWitnessRows(declaration);
  const operatorStatusRows = buildOperatorStatusRows(declaration);
  const manualUsabilityGate = buildManualUsabilityGate(declaration, generatedAt);
  const analyticsHook = buildAnalyticsHook(declaration, generatedAt);
  const projection = {
    schema: RESIDENT_SUB_AGENT_OPERATOR_PROJECTION_SCHEMA,
    projectionId: normalizeId(input.projectionId, "resident_sub_agent_operator_projection"),
    generatedAt,
    projectId: declaration.projectId,
    workThreadId: declaration.workThreadId,
    primaryThreadId: declaration.primaryThreadId,
    sourceDeclarationId: declaration.declarationId,
    sourceDeclarationDigest: declaration.declarationDigest,
    sourceUsabilityProofId: declaration.usabilityProof.proofId,
    sourceCatalogDigest: declaration.catalog.catalogDigest,
    primaryTranscriptActivitySummary,
    operatorWitnessRows,
    operatorStatusRows,
    manualUsabilityGate,
    analyticsHook,
    subAgentsPanelCompatibility: {
      status: "compatible_read_only_projection",
      note: "PR96 reuses summary/status/result-admission witnesses; it does not redesign right-pane child transcript UX.",
      fullChildTranscriptViewIntroduced: false,
    },
    proofPosture: {
      readsProofArtifacts: true,
      mintsProof: false,
      selfReportIsSupplemental: declaration.selfReportPosture?.selfReportIsSupplemental === true,
    },
    operatorProjectionAuthority: {
      declaresProviderTools: false,
      overridesActivation: false,
      injectsChildTranscript: false,
      sendsFollowup: false,
      interruptsOrClosesChild: false,
      mutatesWorkspace: false,
    },
    rawPromptIncluded: false,
    rawResultIncluded: false,
    rawWorkspacePathIncluded: false,
    rawProviderPayloadIncluded: false,
    rawSecretIncluded: false,
  };
  projection.projectionDigest = digestFor("resident-sub-agent-operator-projection@1", projection);
  validateResidentSubAgentOperatorProjection(projection);
  return projection;
}

function validateResidentSubAgentOperatorProjection(value = {}) {
  const errors = [];
  if (!isPlainObject(value) || value.schema !== RESIDENT_SUB_AGENT_OPERATOR_PROJECTION_SCHEMA) {
    throw new Error("resident_sub_agent_operator_projection_schema_mismatch");
  }
  for (const field of ["projectionId", "projectId", "workThreadId", "primaryThreadId", "sourceDeclarationId", "sourceDeclarationDigest", "sourceUsabilityProofId", "sourceCatalogDigest", "projectionDigest"]) {
    if (!normalizeString(value[field], "")) errors.push(`missing_required_string:${field}`);
  }
  if (value.proofPosture?.readsProofArtifacts !== true || value.proofPosture?.mintsProof !== false) {
    errors.push("operator_projection_must_read_not_mint_proof");
  }
  if (value.primaryTranscriptActivitySummary?.childTranscriptFlattened !== false
    || value.primaryTranscriptActivitySummary?.childOutputPromotedToPrimaryTranscript !== false) {
    errors.push("primary_transcript_summary_flattening_leak");
  }
  for (const row of Array.isArray(value.operatorWitnessRows) ? value.operatorWitnessRows : []) {
    validateOdeuCapabilityWitnessRow(row);
    if (row.operatorCallable !== false) errors.push(`operator_witness_callable_leak:${row.capabilityId}`);
  }
  const firstSliceStatus = new Set((value.operatorStatusRows || [])
    .filter((row) => RESIDENT_FIRST_SLICE_TOOLS.includes(row.toolName) && row.residentCallable === true)
    .map((row) => row.toolName));
  for (const toolName of RESIDENT_FIRST_SLICE_TOOLS) {
    if (!firstSliceStatus.has(toolName)) errors.push(`operator_status_missing_first_slice:${toolName}`);
  }
  for (const row of value.operatorStatusRows || []) {
    if (row.operatorCallable !== false) errors.push(`operator_status_callable_leak:${row.toolName}`);
    if (DEFERRED_SUB_AGENT_CONTROLS.includes(row.toolName) && row.residentCallable !== false) {
      errors.push(`blocked_control_resident_callable_leak:${row.toolName}`);
    }
  }
  if (value.manualUsabilityGate?.schema !== RESIDENT_SUB_AGENT_MANUAL_USABILITY_GATE_SCHEMA) {
    errors.push("manual_usability_gate_missing");
  }
  if (value.manualUsabilityGate?.gateState !== "passed") errors.push("manual_usability_gate_not_passed");
  const manualGateRows = Array.isArray(value.manualUsabilityGate?.rows) ? value.manualUsabilityGate.rows : [];
  const recomputedRequiredBlockedCount = manualGateRows.filter((row) => row?.required !== false && row?.state === "blocked").length;
  const recomputedBlockedCount = manualGateRows.filter((row) => row?.state === "blocked").length;
  const recomputedPassedCount = manualGateRows.filter((row) => row?.state === "passed").length;
  const requiredCheckKinds = new Set(["spawn_agent", "list_agents", "inspect_agent", "wait_agent", "result_admission", "no_interference_controls"]);
  for (const checkKind of requiredCheckKinds) {
    if (!manualGateRows.some((row) => row?.checkKind === checkKind && row?.state === "passed")) {
      errors.push(`manual_gate_required_check_not_passed:${checkKind}`);
    }
  }
  if (value.manualUsabilityGate?.counts?.requiredBlockedCount !== recomputedRequiredBlockedCount) {
    errors.push("manual_gate_required_blocked_count_mismatch");
  }
  if (value.manualUsabilityGate?.counts?.blockedCount !== recomputedBlockedCount) {
    errors.push("manual_gate_blocked_count_mismatch");
  }
  if (value.manualUsabilityGate?.counts?.passedCount !== recomputedPassedCount) {
    errors.push("manual_gate_passed_count_mismatch");
  }
  if (value.manualUsabilityGate?.counts?.rowCount !== manualGateRows.length) {
    errors.push("manual_gate_row_count_mismatch");
  }
  for (const countKey of ["providerTransportCalls", "appServerMutationCalls", "operatorControlInvocations", "activationOverrides", "childTranscriptInjections", "followupOrLifecycleControlCalls", "workspaceMutationCalls"]) {
    if (value.manualUsabilityGate?.sentinelCounters?.[countKey] !== 0) errors.push(`manual_gate_sentinel_leak:${countKey}`);
  }
  if (value.analyticsHook?.schema !== RESIDENT_SUB_AGENT_ANALYTICS_HOOK_SCHEMA) errors.push("analytics_hook_missing");
  if (value.analyticsHook?.parentUsageMerged !== false) errors.push("analytics_parent_usage_merged");
  for (const flag of ["declaresProviderTools", "overridesActivation", "injectsChildTranscript", "sendsFollowup", "interruptsOrClosesChild", "mutatesWorkspace"]) {
    if (value.operatorProjectionAuthority?.[flag] !== false) errors.push(`operator_projection_authority_leak:${flag}`);
    if (value.manualUsabilityGate?.operatorProjectionAuthority?.[flag] !== false) errors.push(`manual_gate_authority_leak:${flag}`);
  }
  for (const flag of ["rawPromptIncluded", "rawResultIncluded", "rawWorkspacePathIncluded", "rawProviderPayloadIncluded", "rawSecretIncluded"]) {
    if (value[flag] !== false) errors.push(`raw_exposure_flag:${flag}`);
  }
  for (const flag of ["rawChildPromptIncluded", "rawChildTranscriptIncluded", "rawProviderPayloadIncluded"]) {
    if (value.primaryTranscriptActivitySummary?.[flag] !== false) errors.push(`primary_transcript_summary_raw_exposure_flag:${flag}`);
  }
  for (const flag of ["rawPromptIncluded", "rawResultIncluded", "rawProviderPayloadIncluded"]) {
    if (value.analyticsHook?.[flag] !== false) errors.push(`analytics_hook_raw_exposure_flag:${flag}`);
  }
  const serialized = JSON.stringify(value);
  if (serialized.includes("\"childTranscriptFlattened\":true")) errors.push("child_transcript_flattened");
  if (serialized.includes("\"operatorCallable\":true")) errors.push("operator_callable_leak");
  if (!errors.length) return true;
  throw new Error(`resident_sub_agent_operator_projection_validation_failed:${errors.join(",")}`);
}

module.exports = {
  RESIDENT_SUB_AGENT_ANALYTICS_HOOK_SCHEMA,
  RESIDENT_SUB_AGENT_MANUAL_USABILITY_GATE_SCHEMA,
  RESIDENT_SUB_AGENT_OPERATOR_PROJECTION_SCHEMA,
  buildResidentSubAgentOperatorProjection,
  validateResidentSubAgentOperatorProjection,
};
