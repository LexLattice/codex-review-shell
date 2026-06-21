"use strict";

const crypto = require("node:crypto");
const {
  directImplementationToolSchemas,
} = require("../transport/codex-responses-transport");

const DIRECT_ROLE_LANE_REGISTRY_SCHEMA = "direct_role_lane_registry@1";
const DIRECT_ROLE_LANE_SELECTION_SCHEMA = "direct_role_lane_selection@1";
const DIRECT_TOOL_BUNDLE_COMPOSER_INPUT_SCHEMA = "direct_tool_bundle_composer_input@1";
const PROVIDER_DECLARED_TOOL_BUNDLE_SCHEMA = "provider_declared_tool_bundle@1";
const DIRECT_TOOL_BUNDLE_COMPOSITION_WITNESS_SCHEMA = "direct_tool_bundle_composition_witness@1";
const RESIDENT_CAPABILITY_CATALOGUE_SCHEMA = "resident_capability_catalogue@1";
const TOOL_DECLARATION_AUTHORITY_TEMPLATE_SCHEMA = "tool_declaration_authority_template@1";

const LANE_KINDS = new Set([
  "front_conversation",
  "implementation_worker",
  "review_auditor",
  "meta_orchestrator",
  "sub_agent_worker",
  "discovery_research",
  "provider_hosted_web",
  "image_artifact",
  "memory_compaction",
  "headless_daemon",
]);

const IMPLEMENTED_STATES = new Set(["not_implemented", "schema_only", "projection_only", "restricted_executor", "full_executor"]);
const PROMOTION_STATES = new Set(["unsupported", "diagnostic_only", "activation_gated", "direct_restricted", "direct_enabled"]);
const ACTIVATION_STATES = new Set(["inactive", "active", "shadow_only", "suspended", "revoked", "expired"]);
const DECLARATION_STATES = new Set(["declared_callable", "not_declared", "blocked"]);
const CURRENT_REQUEST_STATUSES = new Set(["callable_now", "known_unavailable", "operator_gated", "blocked"]);
const CATALOGUE_STATUSES = new Set([
  "declared_callable",
  "known_unavailable",
  "blocked_by_lane",
  "blocked_by_policy",
  "blocked_by_provider",
  "blocked_by_runtime",
  "operator_gated",
  "requires_setup",
  "diagnostic_only",
  "future_wave",
  "unknown",
]);

const DEFAULT_ROLE_LANES = Object.freeze([
  {
    laneId: "lane_implementation_worker",
    laneKind: "implementation_worker",
    roleId: "implementation_worker",
    displayName: "Implementation worker",
    agentClassSpecId: "agent_class_spec_implementation_worker",
    defaultToolNames: ["read_file", "apply_patch", "run_command"],
    allowedToolFamilies: ["workspace_process_authority", "local_perception"],
    laneLawIds: ["direct_implementation_lane_tool_law@1", "direct_workspace_authority_law@1"],
  },
  {
    laneId: "lane_review_auditor",
    laneKind: "review_auditor",
    roleId: "review_auditor",
    displayName: "Review auditor",
    agentClassSpecId: "agent_class_spec_review_auditor",
    defaultToolNames: ["read_file"],
    allowedToolFamilies: ["local_perception", "session_control_state"],
    laneLawIds: ["direct_review_auditor_tool_law@1"],
  },
  {
    laneId: "lane_meta_orchestrator",
    laneKind: "meta_orchestrator",
    roleId: "meta_orchestrator",
    displayName: "Meta-orchestrator",
    agentClassSpecId: "agent_class_spec_meta_orchestrator",
    defaultToolNames: [],
    allowedToolFamilies: ["agent_runtime", "session_control_state", "human_authority_bridge"],
    laneLawIds: ["direct_meta_orchestrator_transition_law@1"],
  },
  {
    laneId: "lane_sub_agent_worker",
    laneKind: "sub_agent_worker",
    roleId: "sub_agent_worker",
    displayName: "Sub-agent worker",
    agentClassSpecId: "agent_class_spec_sub_agent_worker",
    defaultToolNames: ["read_file"],
    allowedToolFamilies: ["local_perception"],
    laneLawIds: ["direct_sub_agent_worker_tool_law@1"],
  },
  {
    laneId: "lane_discovery_research",
    laneKind: "discovery_research",
    roleId: "discovery_research",
    displayName: "Discovery/research",
    agentClassSpecId: "agent_class_spec_discovery_research",
    defaultToolNames: [],
    allowedToolFamilies: ["external_capability_discovery", "external_resource_action_authority"],
    laneLawIds: ["direct_external_discovery_tool_law@1"],
  },
]);

const TOOL_METADATA = Object.freeze({
  read_file: {
    capabilityId: "direct.read_file",
    toolFamily: "local_perception",
    implementedState: "restricted_executor",
    promotionState: "direct_enabled",
    targetScopePolicyId: "direct_workspace_read_scope_policy@1",
    resultEnvelopePolicyId: "direct_read_file_result_envelope@1",
    contextAdmissionPolicyId: "direct_read_file_context_admission@1",
  },
  apply_patch: {
    capabilityId: "direct.apply_patch",
    toolFamily: "workspace_process_authority",
    implementedState: "restricted_executor",
    promotionState: "direct_enabled",
    targetScopePolicyId: "direct_workspace_patch_scope_policy@1",
    resultEnvelopePolicyId: "direct_apply_patch_result_envelope@1",
    contextAdmissionPolicyId: "direct_apply_patch_context_admission@1",
  },
  run_command: {
    capabilityId: "direct.run_command",
    toolFamily: "workspace_process_authority",
    implementedState: "restricted_executor",
    promotionState: "direct_enabled",
    targetScopePolicyId: "direct_command_execution_scope_policy@1",
    resultEnvelopePolicyId: "direct_run_command_result_envelope@1",
    contextAdmissionPolicyId: "direct_run_command_context_admission@1",
  },
});

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

function normalizeStringList(value, fallback = []) {
  const source = Array.isArray(value) ? value : fallback;
  return [...new Set(source.map((entry) => normalizeString(entry, "")).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function stableStringify(value) {
  if (value && typeof value.toJSON === "function") return stableStringify(value.toJSON());
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => (entry === undefined ? "null" : stableStringify(entry))).join(",")}]`;
  return `{${Object.keys(value)
    .filter((key) => value[key] !== undefined && !String(key).endsWith("Digest"))
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

function evidenceRef(kind, id, label = "") {
  const safeKind = normalizeString(kind, "evidence");
  const safeId = normalizeString(id, safeKind);
  const safeLabel = normalizeString(label, safeId);
  return {
    kind: safeKind,
    id: safeId,
    label: safeLabel,
    digest: digestFor(`direct-role-lane-${safeKind}@1`, { id: safeId, label: safeLabel }),
    rendererSafe: true,
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
}

function normalizeEvidenceRef(value, fallbackKind, fallbackId, label = "") {
  if (isPlainObject(value)) {
    return {
      ...evidenceRef(value.kind || fallbackKind, value.id || value.refId || fallbackId, value.label || label),
      ...value,
      rawTextIncluded: false,
      rawPathIncluded: false,
      rawSecretIncluded: false,
    };
  }
  return evidenceRef(fallbackKind, fallbackId, label);
}

function defaultLaneRows() {
  return DEFAULT_ROLE_LANES.map((lane) => ({
    ...lane,
    agentClassSpecRef: evidenceRef("agent_class_spec", lane.agentClassSpecId, lane.displayName),
    laneLawRefs: lane.laneLawIds.map((id) => evidenceRef("lane_law", id, id)),
  }));
}

function buildDirectRoleLaneRegistry(input = {}) {
  input = isPlainObject(input) ? input : {};
  const rows = (Array.isArray(input.lanes) && input.lanes.length ? input.lanes : defaultLaneRows()).map((lane) => {
    const laneKind = normalizeEnum(lane.laneKind, LANE_KINDS, "implementation_worker");
    const laneId = normalizeString(lane.laneId, `lane_${laneKind}`);
    return {
      laneId,
      laneKind,
      roleId: normalizeString(lane.roleId, laneKind),
      displayName: normalizeString(lane.displayName, laneKind),
      agentClassSpecRef: normalizeEvidenceRef(lane.agentClassSpecRef, "agent_class_spec", lane.agentClassSpecId || `agent_class_spec_${laneKind}`, lane.displayName),
      defaultToolNames: normalizeStringList(lane.defaultToolNames),
      allowedToolFamilies: normalizeStringList(lane.allowedToolFamilies),
      laneLawRefs: (Array.isArray(lane.laneLawRefs) ? lane.laneLawRefs : []).map((ref, index) => normalizeEvidenceRef(ref, "lane_law", `${laneId}_law_${index + 1}`)),
    };
  });
  const registry = {
    schema: DIRECT_ROLE_LANE_REGISTRY_SCHEMA,
    registryId: normalizeString(input.registryId, `direct_role_lane_registry_${digestFor("direct-role-lane-registry-source@1", rows).slice(7, 31)}`),
    generatedAt: normalizeString(input.generatedAt, nowIso(input.nowMs)),
    rows,
    rowCount: rows.length,
    rawPromptIncluded: false,
    rawProviderPayloadIncluded: false,
    rawSecretIncluded: false,
  };
  registry.registryDigest = digestFor("direct-role-lane-registry@1", registry);
  return registry;
}

function laneFor(input = {}, registry = buildDirectRoleLaneRegistry(input)) {
  const laneKind = normalizeString(input.laneKind, "");
  const laneId = normalizeString(input.laneId, "");
  const roleId = normalizeString(input.roleId, "");
  const rows = Array.isArray(registry?.rows) ? registry.rows : [];
  return rows.find((row) => (
    (laneId && row.laneId === laneId)
    || (laneKind && row.laneKind === laneKind)
    || (roleId && row.roleId === roleId)
  )) || rows.find((row) => row.laneKind === "implementation_worker") || rows[0];
}

function buildDirectRoleLaneSelection(input = {}) {
  input = isPlainObject(input) ? input : {};
  const registry = isPlainObject(input.registry) ? input.registry : buildDirectRoleLaneRegistry(input);
  const lane = laneFor(input, registry);
  const laneKind = normalizeEnum(lane?.laneKind, LANE_KINDS, "implementation_worker");
  const selection = {
    schema: DIRECT_ROLE_LANE_SELECTION_SCHEMA,
    selectionId: normalizeString(input.selectionId, `direct_role_lane_selection_${digestFor("direct-role-lane-selection-source@1", {
      projectId: input.projectId,
      workThreadId: input.workThreadId,
      threadId: input.threadId,
      laneId: lane?.laneId,
    }).slice(7, 31)}`),
    projectId: normalizeString(input.projectId, "project_direct_role_lane"),
    workThreadId: normalizeString(input.workThreadId, "work_thread_direct_role_lane"),
    threadId: normalizeString(input.threadId, "direct_thread_role_lane"),
    laneId: normalizeString(lane?.laneId, `lane_${laneKind}`),
    laneKind,
    roleId: normalizeString(lane?.roleId, laneKind),
    agentClassSpecRef: normalizeEvidenceRef(input.agentClassSpecRef || lane?.agentClassSpecRef, "agent_class_spec", `agent_class_spec_${laneKind}`, lane?.displayName),
    controlledRouteRef: input.controlledRouteRef ? normalizeEvidenceRef(input.controlledRouteRef, "controlled_route", "controlled_route") : undefined,
    roleHandoffPacketRef: input.roleHandoffPacketRef ? normalizeEvidenceRef(input.roleHandoffPacketRef, "role_handoff_packet", "role_handoff_packet") : undefined,
    normalizedLaneRequestRef: input.normalizedLaneRequestRef ? normalizeEvidenceRef(input.normalizedLaneRequestRef, "normalized_lane_request", "normalized_lane_request") : undefined,
    objectiveRef: input.objectiveRef ? normalizeEvidenceRef(input.objectiveRef, "objective", "objective") : undefined,
    authorityBoundaryRef: normalizeEvidenceRef(input.authorityBoundaryRef, "authority_boundary", "direct_authority_boundary"),
    laneLawRefs: (Array.isArray(lane?.laneLawRefs) ? lane.laneLawRefs : []).map((ref, index) => normalizeEvidenceRef(ref, "lane_law", `${lane?.laneId || laneKind}_law_${index + 1}`)),
    selectedAt: normalizeString(input.selectedAt, nowIso(input.nowMs)),
  };
  selection.evidenceRefs = [
    selection.agentClassSpecRef,
    selection.authorityBoundaryRef,
    ...(selection.normalizedLaneRequestRef ? [selection.normalizedLaneRequestRef] : []),
    ...(selection.controlledRouteRef ? [selection.controlledRouteRef] : []),
    ...(selection.roleHandoffPacketRef ? [selection.roleHandoffPacketRef] : []),
    ...selection.laneLawRefs,
  ];
  selection.selectionDigest = digestFor("direct-role-lane-selection@1", selection);
  return selection;
}

function buildComposerInput(input = {}) {
  input = isPlainObject(input) ? input : {};
  const laneSelection = isPlainObject(input.laneSelection) ? input.laneSelection : buildDirectRoleLaneSelection(input);
  const composerInput = {
    schema: DIRECT_TOOL_BUNDLE_COMPOSER_INPUT_SCHEMA,
    compositionId: normalizeString(input.compositionId, `direct_tool_bundle_composition_${digestFor("direct-tool-bundle-composer-input-source@1", {
      laneSelectionId: laneSelection.selectionId,
      requestedToolFamilies: input.requestedToolFamilies,
      toolNames: input.toolNames,
    }).slice(7, 31)}`),
    laneSelection,
    providerProfileRef: normalizeEvidenceRef(input.providerProfileRef, "provider_profile", "direct_provider_profile"),
    runtimeFactsRef: normalizeEvidenceRef(input.runtimeFactsRef, "runtime_facts", "direct_runtime_facts"),
    activationSnapshotRefs: (Array.isArray(input.activationSnapshotRefs) && input.activationSnapshotRefs.length ? input.activationSnapshotRefs : [evidenceRef("activation_snapshot", "direct_tool_activation_snapshot")])
      .map((ref, index) => normalizeEvidenceRef(ref, "activation_snapshot", `activation_snapshot_${index + 1}`)),
    residentEpistemicSnapshotRef: input.residentEpistemicSnapshotRef ? normalizeEvidenceRef(input.residentEpistemicSnapshotRef, "resident_epistemic_snapshot", "resident_epistemic_snapshot") : undefined,
    sourceMessageRef: input.sourceMessageRef ? normalizeEvidenceRef(input.sourceMessageRef, "source_message", "source_message") : undefined,
    sourceSpanRefs: Array.isArray(input.sourceSpanRefs) ? input.sourceSpanRefs.map((ref, index) => normalizeEvidenceRef(ref, "source_span", `source_span_${index + 1}`)) : [],
    semanticParseRef: input.semanticParseRef ? normalizeEvidenceRef(input.semanticParseRef, "semantic_parse", "semantic_parse") : undefined,
    normalizedLaneRequestRef: input.normalizedLaneRequestRef
      ? normalizeEvidenceRef(input.normalizedLaneRequestRef, "normalized_lane_request", "normalized_lane_request")
      : laneSelection.normalizedLaneRequestRef,
    controlledRouteRef: input.controlledRouteRef
      ? normalizeEvidenceRef(input.controlledRouteRef, "controlled_route", "controlled_route")
      : laneSelection.controlledRouteRef,
    roleHandoffPacketRef: input.roleHandoffPacketRef
      ? normalizeEvidenceRef(input.roleHandoffPacketRef, "role_handoff_packet", "role_handoff_packet")
      : laneSelection.roleHandoffPacketRef,
    contextPacketRef: input.contextPacketRef ? normalizeEvidenceRef(input.contextPacketRef, "context_packet", "context_packet") : undefined,
    requestManifestRef: input.requestManifestRef ? normalizeEvidenceRef(input.requestManifestRef, "request_manifest", "request_manifest") : undefined,
    requestedToolFamilies: normalizeStringList(input.requestedToolFamilies),
    toolNames: normalizeStringList(input.toolNames),
    useLaneDefaultTools: input.useLaneDefaultTools !== false,
    requireRequestGrounding: input.requireRequestGrounding !== false,
    observedAt: normalizeString(input.observedAt, nowIso(input.nowMs)),
  };
  composerInput.inputDigest = digestFor("direct-tool-bundle-composer-input@1", composerInput);
  return composerInput;
}

function toolMetadata(toolName) {
  return TOOL_METADATA[toolName] || {
    capabilityId: `direct.${toolName}`,
    toolFamily: "unknown",
    implementedState: "not_implemented",
    promotionState: "unsupported",
    targetScopePolicyId: "unknown_target_scope_policy",
    resultEnvelopePolicyId: "unknown_result_envelope_policy",
    contextAdmissionPolicyId: "unknown_context_admission_policy",
  };
}

function axesFor(toolName, patch = {}) {
  const metadata = toolMetadata(toolName);
  return {
    implementedState: normalizeEnum(patch.implementedState || metadata.implementedState, IMPLEMENTED_STATES, "not_implemented"),
    promotionState: normalizeEnum(patch.promotionState || metadata.promotionState, PROMOTION_STATES, "unsupported"),
    activationState: normalizeEnum(patch.activationState, ACTIVATION_STATES, "active"),
    declarationState: normalizeEnum(patch.declarationState, DECLARATION_STATES, "declared_callable"),
    currentRequestStatus: normalizeEnum(patch.currentRequestStatus, CURRENT_REQUEST_STATUSES, "callable_now"),
  };
}

function authorityTemplateFor(toolName, laneSelection) {
  const metadata = toolMetadata(toolName);
  const template = {
    schema: TOOL_DECLARATION_AUTHORITY_TEMPLATE_SCHEMA,
    templateId: `tool_declaration_authority_template_${digestFor("tool-declaration-authority-template-id@1", {
      toolName,
      laneId: laneSelection.laneId,
      targetScopePolicyId: metadata.targetScopePolicyId,
    }).slice(7, 31)}`,
    toolName,
    laneId: laneSelection.laneId,
    allowedOperationClasses: [metadata.toolFamily],
    targetScopePolicyRef: evidenceRef("target_scope_policy", metadata.targetScopePolicyId, metadata.targetScopePolicyId),
    requiresConcreteCallDecision: true,
    resultEnvelopePolicyRef: evidenceRef("result_envelope_policy", metadata.resultEnvelopePolicyId, metadata.resultEnvelopePolicyId),
    contextAdmissionPolicyRef: evidenceRef("context_admission_policy", metadata.contextAdmissionPolicyId, metadata.contextAdmissionPolicyId),
  };
  template.templateDigest = digestFor("tool-declaration-authority-template@1", template);
  return template;
}

function providerSchemaFor(toolName) {
  const schema = directImplementationToolSchemas([toolName])[0];
  return isPlainObject(schema) ? schema : null;
}

function declaredToolRow(toolName, laneSelection, activationRef) {
  const metadata = toolMetadata(toolName);
  const authorityTemplate = authorityTemplateFor(toolName, laneSelection);
  const providerToolSchema = providerSchemaFor(toolName);
  const row = {
    toolName,
    capabilityId: metadata.capabilityId,
    toolFamily: metadata.toolFamily,
    declarationDigest: digestFor("direct-declared-tool-row-declaration@1", { toolName, providerToolSchema, laneId: laneSelection.laneId }),
    perCallAuthorityRequired: true,
    declarationAuthorityTemplateRef: authorityTemplate.templateId,
    declarationAuthorityTemplateDigest: authorityTemplate.templateDigest,
    laneScope: laneSelection.laneKind,
    providerSupported: Boolean(providerToolSchema),
    activationRef: activationRef.id,
    policyDecisionRef: `policy_decision_${laneSelection.laneId}_${toolName}`,
    axes: axesFor(toolName),
    providerToolSchema,
    authorityTemplate,
  };
  row.rowDigest = digestFor("direct-declared-tool-row@1", row);
  return row;
}

function catalogueRow(toolName, status, reason, patch = {}) {
  const metadata = toolMetadata(toolName);
  const safeStatus = normalizeEnum(status, CATALOGUE_STATUSES, "unknown");
  const row = {
    toolName,
    toolFamily: metadata.toolFamily,
    status: safeStatus,
    axes: axesFor(toolName, {
      declarationState: safeStatus === "declared_callable" ? "declared_callable" : "blocked",
      currentRequestStatus: safeStatus === "declared_callable" ? "callable_now" : safeStatus === "operator_gated" ? "operator_gated" : "blocked",
      activationState: safeStatus === "blocked_by_runtime" ? "expired" : "active",
      ...patch.axes,
    }),
    callableInCurrentRequest: safeStatus === "declared_callable",
    reason: normalizeString(reason, safeStatus),
    nextEnablementClass: normalizeString(patch.nextEnablementClass, safeStatus === "declared_callable" ? "not_enableable" : "policy_change"),
    nonOmittable: patch.nonOmittable === true,
    evidenceRefs: Array.isArray(patch.evidenceRefs) ? patch.evidenceRefs : [evidenceRef("tool_capability", metadata.capabilityId, toolName)],
  };
  row.rowDigest = digestFor("resident-capability-row@1", row);
  return row;
}

function omittedCounts(rows = []) {
  return {
    blockedTools: rows.filter((row) => String(row.status || "").startsWith("blocked")).length,
    unavailableTools: rows.filter((row) => row.status === "known_unavailable" || row.status === "requires_setup" || row.status === "diagnostic_only").length,
    futureWaveTools: rows.filter((row) => row.status === "future_wave").length,
    operatorGatedTools: rows.filter((row) => row.status === "operator_gated").length,
  };
}

function buildResidentCapabilityCatalogue({ compositionId, laneSelection, declaredRows, unavailableRows, observedAt }) {
  const callableNow = declaredRows.map((row) => catalogueRow(row.toolName, "declared_callable", "Declared callable in this request.", {
    evidenceRefs: [evidenceRef("declared_tool", row.rowDigest, row.toolName)],
  }));
  const knownUnavailable = unavailableRows;
  const catalogue = {
    schema: RESIDENT_CAPABILITY_CATALOGUE_SCHEMA,
    catalogueId: `resident_capability_catalogue_${digestFor("resident-capability-catalogue-id@1", { compositionId, laneId: laneSelection.laneId }).slice(7, 31)}`,
    laneId: laneSelection.laneId,
    roleId: laneSelection.roleId,
    callableNow,
    knownUnavailable,
    omittedCount: knownUnavailable.length,
    omittedByClass: omittedCounts(knownUnavailable),
    nonOmittableRows: knownUnavailable.filter((row) => row.nonOmittable === true),
    omissionPolicyRef: evidenceRef("resident_epistemic_context_policy", "resident_tool_catalogue_omission_policy@1"),
    budgetPolicy: "compact",
    createdAt: observedAt,
  };
  catalogue.catalogueDigest = digestFor("resident-capability-catalogue@1", catalogue);
  return catalogue;
}

function buildProviderDeclaredToolBundle({ compositionId, laneSelection, declaredRows, composerInput, observedAt }) {
  const toolDeclarations = declaredRows.map((row) => row.providerToolSchema).filter(Boolean);
  const bundle = {
    schema: PROVIDER_DECLARED_TOOL_BUNDLE_SCHEMA,
    bundleId: `provider_declared_tool_bundle_${digestFor("provider-declared-tool-bundle-id@1", { compositionId, laneId: laneSelection.laneId, tools: declaredRows.map((row) => row.toolName) }).slice(7, 31)}`,
    compositionId,
    laneId: laneSelection.laneId,
    roleId: laneSelection.roleId,
    workThreadId: laneSelection.workThreadId,
    declaredToolNames: declaredRows.map((row) => row.toolName),
    toolDeclarations,
    activationSnapshotRefs: composerInput.activationSnapshotRefs,
    providerProfileRef: composerInput.providerProfileRef,
    requestShapeProofRefs: declaredRows.map((row) => evidenceRef("request_shape_proof", row.declarationDigest, row.toolName)),
    parallelToolCalls: false,
    toolChoice: toolDeclarations.length ? "auto" : "none",
    rawProviderPayloadIncluded: false,
    rawSecretIncluded: false,
    createdAt: observedAt,
  };
  bundle.declarationDigest = digestFor("provider-declared-tool-bundle@1", bundle);
  return bundle;
}

function blockedRowsForMissingGrounding(toolNames = [], laneSelection) {
  return toolNames.map((toolName) => catalogueRow(toolName, "blocked_by_policy", "Declaration blocked: normalized lane request grounding is required.", {
    nextEnablementClass: "policy_change",
    nonOmittable: true,
    axes: {
      declarationState: "blocked",
      currentRequestStatus: "blocked",
      activationState: "active",
    },
    evidenceRefs: [
      evidenceRef("normalized_lane_request", `${laneSelection.selectionId}_missing_normalized_lane_request`, "Missing normalized lane request"),
      laneSelection.authorityBoundaryRef,
    ],
  }));
}

function classifyToolDeclarationCandidates(toolNames = [], lane, laneSelection, composerInput) {
  const laneAllowedFamilies = new Set(normalizeStringList(lane?.allowedToolFamilies));
  const requestedFamilies = new Set(normalizeStringList(composerInput.requestedToolFamilies));
  const declaredRows = [];
  const unavailableRows = [];
  const activationRef = composerInput.activationSnapshotRefs[0] || evidenceRef("activation_snapshot", "direct_tool_activation_snapshot");

  for (const toolName of toolNames) {
    const metadata = toolMetadata(toolName);
    const family = metadata.toolFamily;
    if (laneAllowedFamilies.size && !laneAllowedFamilies.has(family)) {
      unavailableRows.push(catalogueRow(toolName, "blocked_by_lane", `Declaration blocked: lane ${laneSelection.laneKind} does not allow tool family ${family}.`, {
        nextEnablementClass: "role_lane_change",
        nonOmittable: true,
        axes: {
          declarationState: "blocked",
          currentRequestStatus: "blocked",
          activationState: "active",
        },
        evidenceRefs: [
          evidenceRef("role_lane", laneSelection.laneId, laneSelection.laneKind),
          ...laneSelection.laneLawRefs,
        ],
      }));
      continue;
    }
    if (requestedFamilies.size && !requestedFamilies.has(family)) {
      unavailableRows.push(catalogueRow(toolName, "blocked_by_policy", `Declaration blocked: requested tool families do not include ${family}.`, {
        nextEnablementClass: "request_policy_change",
        nonOmittable: true,
        axes: {
          declarationState: "blocked",
          currentRequestStatus: "blocked",
          activationState: "active",
        },
        evidenceRefs: [
          evidenceRef("requested_tool_family", `${composerInput.compositionId}_${family}_not_requested`, family),
          laneSelection.authorityBoundaryRef,
        ],
      }));
      continue;
    }

    const row = declaredToolRow(toolName, laneSelection, activationRef);
    if (row.providerSupported) {
      declaredRows.push(row);
    } else {
      unavailableRows.push(catalogueRow(toolName, "blocked_by_provider", "Declaration blocked: provider schema is unavailable for this tool.", {
        nextEnablementClass: "provider_capability_change",
        nonOmittable: true,
        axes: {
          declarationState: "blocked",
          currentRequestStatus: "blocked",
          activationState: "active",
        },
        evidenceRefs: [
          evidenceRef("provider_profile", composerInput.providerProfileRef.id, "Provider profile"),
          evidenceRef("tool_capability", metadata.capabilityId, toolName),
        ],
      }));
    }
  }

  return { declaredRows, unavailableRows };
}

function composeDirectToolBundle(input = {}) {
  const composerInput = (isPlainObject(input) && input.schema === DIRECT_TOOL_BUNDLE_COMPOSER_INPUT_SCHEMA)
    ? input
    : buildComposerInput(input);
  const laneSelection = composerInput.laneSelection;
  const registry = isPlainObject(input?.registry) ? input.registry : buildDirectRoleLaneRegistry(input);
  const lane = laneFor(laneSelection, registry);
  const explicitToolNames = normalizeStringList(composerInput.toolNames);
  const toolNames = explicitToolNames.length
    ? explicitToolNames
    : composerInput.useLaneDefaultTools === false ? [] : normalizeStringList(lane?.defaultToolNames);
  const groundingMissing = composerInput.requireRequestGrounding && !composerInput.normalizedLaneRequestRef;
  const classifiedRows = groundingMissing
    ? { declaredRows: [], unavailableRows: blockedRowsForMissingGrounding(toolNames, laneSelection) }
    : classifyToolDeclarationCandidates(toolNames, lane, laneSelection, composerInput);
  const { declaredRows, unavailableRows } = classifiedRows;
  const providerBundle = buildProviderDeclaredToolBundle({
    compositionId: composerInput.compositionId,
    laneSelection,
    declaredRows,
    composerInput,
    observedAt: composerInput.observedAt,
  });
  const residentCatalogue = buildResidentCapabilityCatalogue({
    compositionId: composerInput.compositionId,
    laneSelection,
    declaredRows,
    unavailableRows,
    observedAt: composerInput.observedAt,
  });
  const omittedReasonRows = unavailableRows.map((row) => ({
    toolName: row.toolName,
    reason: row.reason,
    status: row.status,
    evidenceRefs: row.evidenceRefs,
  }));
  const witness = {
    schema: DIRECT_TOOL_BUNDLE_COMPOSITION_WITNESS_SCHEMA,
    compositionId: composerInput.compositionId,
    laneId: laneSelection.laneId,
    roleId: laneSelection.roleId,
    sourceMessageRef: composerInput.sourceMessageRef,
    semanticParseRef: composerInput.semanticParseRef,
    normalizedLaneRequestRef: composerInput.normalizedLaneRequestRef,
    controlledRouteRef: composerInput.controlledRouteRef,
    roleHandoffPacketRef: composerInput.roleHandoffPacketRef,
    providerDeclaredToolBundleRef: providerBundle.bundleId,
    providerDeclaredToolBundleDigest: providerBundle.declarationDigest,
    declaredTools: declaredRows,
    knownUndeclaredTools: [],
    blockedTools: unavailableRows.filter((row) => row.status.startsWith("blocked")),
    operatorGatedTools: unavailableRows.filter((row) => row.status === "operator_gated"),
    omittedReasonRows,
    residentCatalogueRef: residentCatalogue.catalogueId,
    residentCatalogueDigest: residentCatalogue.catalogueDigest,
    rawPromptIncluded: false,
    rawProviderPayloadIncluded: false,
    rawSecretIncluded: false,
    createdAt: composerInput.observedAt,
  };
  witness.witnessDigest = digestFor("direct-tool-bundle-composition-witness@1", witness);
  return {
    schema: "direct_tool_bundle_composition_report@1",
    compositionId: composerInput.compositionId,
    composerInput,
    roleLaneRegistry: registry,
    providerDeclaredToolBundle: providerBundle,
    residentCapabilityCatalogue: residentCatalogue,
    witness,
    status: validateDirectToolBundleComposition({ providerDeclaredToolBundle: providerBundle, residentCapabilityCatalogue: residentCatalogue, witness }).length ? "failed" : "passed",
  };
}

function validateDirectRoleLaneSelection(selection = {}) {
  const errors = [];
  if (selection.schema !== DIRECT_ROLE_LANE_SELECTION_SCHEMA) errors.push("role_lane_selection_schema_mismatch");
  for (const field of ["selectionId", "projectId", "workThreadId", "threadId", "laneId", "roleId"]) {
    if (!normalizeString(selection[field], "")) errors.push(`missing_${field}`);
  }
  if (!LANE_KINDS.has(selection.laneKind)) errors.push("invalid_lane_kind");
  if (!isPlainObject(selection.agentClassSpecRef)) errors.push("missing_agent_class_spec_ref");
  if (!isPlainObject(selection.authorityBoundaryRef)) errors.push("missing_authority_boundary_ref");
  if (!Array.isArray(selection.laneLawRefs) || !selection.laneLawRefs.length) errors.push("missing_lane_law_refs");
  return errors;
}

function validateProviderDeclaredToolBundle(bundle = {}) {
  const errors = [];
  if (bundle.schema !== PROVIDER_DECLARED_TOOL_BUNDLE_SCHEMA) errors.push("provider_declared_tool_bundle_schema_mismatch");
  for (const field of ["bundleId", "compositionId", "laneId", "roleId", "workThreadId", "declarationDigest"]) {
    if (!normalizeString(bundle[field], "")) errors.push(`missing_${field}`);
  }
  if (!Array.isArray(bundle.declaredToolNames)) errors.push("declared_tool_names_not_array");
  if (!Array.isArray(bundle.toolDeclarations)) errors.push("tool_declarations_not_array");
  if (bundle.parallelToolCalls !== false) errors.push("parallel_tool_calls_not_false");
  if (bundle.rawProviderPayloadIncluded !== false) errors.push("raw_provider_payload_flag_not_false");
  if (bundle.rawSecretIncluded !== false) errors.push("raw_secret_flag_not_false");
  return errors;
}

function validateResidentCapabilityCatalogue(catalogue = {}) {
  const errors = [];
  if (catalogue.schema !== RESIDENT_CAPABILITY_CATALOGUE_SCHEMA) errors.push("resident_capability_catalogue_schema_mismatch");
  if (!Array.isArray(catalogue.callableNow)) errors.push("callable_now_not_array");
  if (!Array.isArray(catalogue.knownUnavailable)) errors.push("known_unavailable_not_array");
  if (!isPlainObject(catalogue.omittedByClass)) errors.push("missing_omitted_by_class");
  if (!Array.isArray(catalogue.nonOmittableRows)) errors.push("non_omittable_rows_not_array");
  const callableNow = Array.isArray(catalogue.callableNow) ? catalogue.callableNow : [];
  const knownUnavailable = Array.isArray(catalogue.knownUnavailable) ? catalogue.knownUnavailable : [];
  for (const row of [...callableNow, ...knownUnavailable]) {
    if (!CATALOGUE_STATUSES.has(row?.status)) errors.push(`invalid_catalogue_status:${row?.toolName || ""}`);
    if (!isPlainObject(row?.axes)) errors.push(`missing_axes:${row?.toolName || ""}`);
  }
  return errors;
}

function validateDirectToolBundleComposition(report = {}) {
  const errors = [];
  const bundle = report.providerDeclaredToolBundle || report.providerBundle || {};
  const catalogue = report.residentCapabilityCatalogue || report.catalogue || {};
  const witness = report.witness || {};
  errors.push(...validateProviderDeclaredToolBundle(bundle).map((error) => `provider_bundle:${error}`));
  errors.push(...validateResidentCapabilityCatalogue(catalogue).map((error) => `resident_catalogue:${error}`));
  if (witness.schema !== DIRECT_TOOL_BUNDLE_COMPOSITION_WITNESS_SCHEMA) errors.push("witness_schema_mismatch");
  if (witness.providerDeclaredToolBundleRef !== bundle.bundleId) errors.push("witness_bundle_ref_mismatch");
  if (witness.residentCatalogueRef !== catalogue.catalogueId) errors.push("witness_catalogue_ref_mismatch");
  if (witness.rawPromptIncluded !== false) errors.push("witness_raw_prompt_flag_not_false");
  if (witness.rawProviderPayloadIncluded !== false) errors.push("witness_raw_provider_payload_flag_not_false");
  if (witness.rawSecretIncluded !== false) errors.push("witness_raw_secret_flag_not_false");
  return errors;
}

module.exports = {
  DIRECT_ROLE_LANE_REGISTRY_SCHEMA,
  DIRECT_ROLE_LANE_SELECTION_SCHEMA,
  DIRECT_TOOL_BUNDLE_COMPOSER_INPUT_SCHEMA,
  PROVIDER_DECLARED_TOOL_BUNDLE_SCHEMA,
  DIRECT_TOOL_BUNDLE_COMPOSITION_WITNESS_SCHEMA,
  RESIDENT_CAPABILITY_CATALOGUE_SCHEMA,
  TOOL_DECLARATION_AUTHORITY_TEMPLATE_SCHEMA,
  buildDirectRoleLaneRegistry,
  buildDirectRoleLaneSelection,
  buildComposerInput,
  composeDirectToolBundle,
  validateDirectRoleLaneSelection,
  validateProviderDeclaredToolBundle,
  validateResidentCapabilityCatalogue,
  validateDirectToolBundleComposition,
};
