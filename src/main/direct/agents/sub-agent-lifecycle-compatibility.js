"use strict";

const crypto = require("node:crypto");
const { normalizeString, nowIso } = require("../meta-session/ids");

const SUB_AGENT_LIFECYCLE_COMPATIBILITY_PACKET_SCHEMA = "sub_agent_lifecycle_compatibility_packet@1";
const AGENT_LIFECYCLE_STATE_MODEL_SCHEMA = "agent_lifecycle_state_model@1";
const AGENT_COMPATIBILITY_NAME_MAPPER_SCHEMA = "agent_compatibility_name_mapper@1";
const AGENT_LIFECYCLE_AUTHORITY_MATRIX_SCHEMA = "agent_lifecycle_authority_matrix@1";

const DIRECT_NATIVE_ACTIONS = Object.freeze([
  "spawn_agent",
  "list_agents",
  "inspect_agent",
  "wait_agent",
  "send_message",
  "followup_task",
  "close_agent",
  "interrupt_agent",
  "resume_agent",
  "recursive_spawn",
]);

const WAVE15_RESIDENT_CALLABLE_ACTIONS = Object.freeze([
  "spawn_agent",
  "list_agents",
  "inspect_agent",
  "wait_agent",
]);

const LEGACY_COMPATIBILITY_MAPPINGS = Object.freeze([
  ["spawnAgent", "spawn_agent"],
  ["listAgents", "list_agents"],
  ["inspectAgent", "inspect_agent"],
  ["sendInput", "send_message"],
  ["resumeAgent", "resume_agent"],
  ["wait", "wait_agent"],
  ["closeAgent", "close_agent"],
]);

const TERMINAL_LIFECYCLE_STATUSES = Object.freeze([
  "completed",
  "failed",
  "interrupted",
  "closed",
]);

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

function sourceRef(kind, id, label) {
  return {
    kind,
    id,
    label,
  };
}

function normalizeEnum(value, allowed, fallback) {
  const normalized = normalizeString(value, fallback);
  return allowed.includes(normalized) ? normalized : fallback;
}

function hasHandoffUnknownLifecycle(agent = {}) {
  return normalizeString(agent.lifecycleStatus || agent.lifecycleState, "") === "handoff_unknown";
}

function normalizeTransportStatus(agent = {}, lifecycleStatus = "") {
  if (hasHandoffUnknownLifecycle(agent)) return "provider_handoff_unknown";
  return normalizeEnum(agent.transportStatus, [
    "not_started",
    "provider_starting",
    "provider_running",
    "provider_terminal",
    "provider_handoff_unknown",
    "provider_unsupported",
    "unknown",
  ], lifecycleStatus === "not_found" ? "unknown" : "not_started");
}

function lifecycleFromSources(agent = {}) {
  const rawLifecycle = normalizeEnum(agent.lifecycleStatus || agent.lifecycleState, [
    "discovered",
    "starting",
    "running",
    "idle",
    "waiting",
    "completed",
    "failed",
    "interrupted",
    "closed",
    "stale",
    "not_found",
    "handoff_unknown",
    "unknown",
  ], "unknown");
  const rawTransport = normalizeEnum(agent.transportStatus, [
    "not_started",
    "provider_starting",
    "provider_running",
    "provider_terminal",
    "provider_handoff_unknown",
    "provider_unsupported",
    "unknown",
  ], "unknown");
  if (agent.notFound === true || rawLifecycle === "not_found") return "not_found";
  if (rawLifecycle === "handoff_unknown") return "unknown";
  if (TERMINAL_LIFECYCLE_STATUSES.includes(rawLifecycle) && (agent.lifecycleEvidence === "exact" || rawTransport === "provider_terminal")) {
    return rawLifecycle;
  }
  if (rawTransport === "provider_running") return ["starting", "idle", "waiting"].includes(rawLifecycle) ? rawLifecycle : "running";
  if (agent.stale === true || rawLifecycle === "stale") return "stale";
  if (rawTransport === "provider_handoff_unknown") return "unknown";
  return rawLifecycle;
}

function conflictFromSources(agent = {}, lifecycleStatus, transportStatus) {
  if (normalizeString(agent.conflictState, "") && agent.conflictState !== "none") {
    return normalizeEnum(agent.conflictState, [
      "none",
      "source_mismatch",
      "provider_vs_local_mismatch",
      "legacy_mapping_mismatch",
      "stale_projection",
      "unknown",
    ], "unknown");
  }
  if (lifecycleStatus === "stale") return "stale_projection";
  if (transportStatus === "provider_running" && TERMINAL_LIFECYCLE_STATUSES.includes(normalizeString(agent.lifecycleStatus || agent.lifecycleState, ""))) {
    return "provider_vs_local_mismatch";
  }
  return "none";
}

function deriveControlPosture(agent = {}, lifecycleStatus, transportStatus, conflictState) {
  const explicit = normalizeString(agent.controlPosture, "");
  if (["not_found", "stale"].includes(lifecycleStatus)) return "blocked";
  if (transportStatus === "provider_handoff_unknown") return "blocked";
  if (conflictState !== "none") return "blocked";
  if (explicit) {
    return normalizeEnum(explicit, [
      "observe_only",
      "followup_allowed",
      "lifecycle_operator_gated",
      "lifecycle_resident_allowed",
      "blocked",
      "unknown",
    ], "unknown");
  }
  return "observe_only";
}

function deriveTargetActionPosture(lifecycleStatus, transportStatus, controlPosture) {
  if (lifecycleStatus === "not_found") return "target_actions_blocked";
  if (transportStatus === "provider_handoff_unknown") return "target_actions_blocked";
  if (lifecycleStatus === "stale") return "status_only";
  if (controlPosture === "blocked") return "target_actions_blocked";
  return "read_only_available";
}

function buildLifecycleStateModel(agent = {}, context = {}, options = {}) {
  const agentId = normalizeString(agent.agentId || agent.childAgentId || agent.agentThreadId || agent.id, "agent_unknown");
  const childThreadId = normalizeString(agent.childThreadId || agent.agentThreadId || agent.threadId, agentId);
  const lifecycleStatus = lifecycleFromSources(agent);
  const transportStatus = normalizeTransportStatus(agent, lifecycleStatus);
  const mailboxStatus = normalizeEnum(agent.mailboxStatus, [
    "none",
    "ready",
    "pending_delivery",
    "delivery_failed",
    "delivery_unknown",
    "closed",
    "unknown",
  ], lifecycleStatus === "not_found" ? "none" : "unknown");
  const transcriptStatus = normalizeEnum(agent.transcriptStatus, [
    "none",
    "summary_only",
    "turn_activity_available",
    "full_history_available",
    "blocked",
    "unknown",
  ], lifecycleStatus === "not_found" ? "none" : "summary_only");
  const usageStatus = normalizeEnum(agent.usageStatus, [
    "none",
    "exact",
    "partial",
    "unavailable",
    "unknown",
  ], "unknown");
  const resultStatus = normalizeEnum(agent.resultStatus, [
    "none",
    "pending",
    "summary_admitted",
    "blocked",
    "failed",
    "unknown",
  ], TERMINAL_LIFECYCLE_STATUSES.includes(lifecycleStatus) ? "summary_admitted" : "unknown");
  const conflictState = conflictFromSources(agent, lifecycleStatus, transportStatus);
  const controlPosture = deriveControlPosture(agent, lifecycleStatus, transportStatus, conflictState);
  const row = {
    schema: AGENT_LIFECYCLE_STATE_MODEL_SCHEMA,
    stateModelId: `agent_lifecycle_state_${digestFor("agent-lifecycle-state-id@1", { agentId, childThreadId }).slice(0, 16)}`,
    agentId,
    childThreadId,
    parentThreadId: normalizeString(agent.parentThreadId || context.parentThreadId, context.primaryThreadId || "thread_parent_unknown"),
    workThreadId: normalizeString(agent.workThreadId || context.workThreadId, "work_thread_unknown"),
    lifecycleStatus,
    transportStatus,
    mailboxStatus,
    transcriptStatus,
    usageStatus,
    resultStatus,
    controlPosture,
    conflictState,
    targetActionPosture: deriveTargetActionPosture(lifecycleStatus, transportStatus, controlPosture),
    precedenceApplied: "terminal_exact_gt_provider_running_gt_stale_gt_unknown",
    evidenceRefs: Array.isArray(agent.evidenceRefs) && agent.evidenceRefs.length
      ? agent.evidenceRefs
      : [sourceRef("sub_agent_lifecycle_source", childThreadId, "child lifecycle source")],
    observedAt: nowIso(options.now || Date.now),
    providerTransportStarted: false,
    lifecycleMutationStarted: false,
    transcriptInjectedIntoPrimary: false,
    rawChildTranscriptIncluded: false,
    rawProviderPayloadIncluded: false,
  };
  row.stateDigest = digestFor("agent-lifecycle-state-model@1", row);
  return row;
}

function authorityPostureFor(action) {
  if (["list_agents", "inspect_agent"].includes(action)) return "read_only_available";
  if (["spawn_agent", "wait_agent"].includes(action)) return "existing_wave15_authority_required";
  if (["send_message", "followup_task"].includes(action)) return "blocked_until_pr100";
  if (["close_agent", "interrupt_agent", "resume_agent"].includes(action)) return "operator_gated_future_pr101";
  return "blocked";
}

function buildAuthorityMatrix(context = {}, options = {}) {
  const rows = DIRECT_NATIVE_ACTIONS.map((action) => {
    const authorityPosture = authorityPostureFor(action);
    const row = {
      rowId: `agent_lifecycle_authority_${action}`,
      directNativeName: action,
      authorityPosture,
      residentCallable: WAVE15_RESIDENT_CALLABLE_ACTIONS.includes(action),
      operatorCallable: false,
      compatibilitySourceAllowed: false,
      providerTransportAllowedInPr97: false,
      lifecycleMutationAllowedInPr97: false,
      sourceRefs: [sourceRef("direct_native_authority_row", action, "direct-native action authority")],
    };
    row.rowDigest = digestFor("agent-lifecycle-authority-row@1", row);
    return row;
  });
  const matrix = {
    schema: AGENT_LIFECYCLE_AUTHORITY_MATRIX_SCHEMA,
    matrixId: normalizeString(context.matrixId, "agent_lifecycle_authority_matrix_pr97"),
    generatedAt: nowIso(options.now || Date.now),
    projectId: normalizeString(context.projectId, "project_sub_agent_lifecycle"),
    workThreadId: normalizeString(context.workThreadId, "work_thread_sub_agent_lifecycle"),
    rows,
    providerTransportStarted: false,
    lifecycleMutationStarted: false,
  };
  matrix.matrixDigest = digestFor("agent-lifecycle-authority-matrix@1", matrix);
  return matrix;
}

function buildCompatibilityMapper(authorityMatrix, context = {}, options = {}) {
  const authorityRows = new Map(authorityMatrix.rows.map((row) => [row.directNativeName, row]));
  const rows = LEGACY_COMPATIBILITY_MAPPINGS.map(([legacyName, directNativeName]) => {
    const authorityRow = authorityRows.get(directNativeName);
    const row = {
      rowId: `agent_compatibility_mapping_${legacyName}`,
      legacyName,
      directNativeName,
      compatibilityOnly: true,
      sourceAuthority: "direct_native_row",
      authorityBypassAllowed: false,
      mappingState: authorityRow ? "mapped" : "blocked",
      directAuthorityRowId: authorityRow?.rowId || "",
      evidenceRefs: [sourceRef("direct_native_authority_row", authorityRow?.rowId || directNativeName, `maps to ${directNativeName}`)],
    };
    row.rowDigest = digestFor("agent-compatibility-mapping-row@1", row);
    return row;
  });
  const mapper = {
    schema: AGENT_COMPATIBILITY_NAME_MAPPER_SCHEMA,
    mapperId: normalizeString(context.mapperId, "agent_compatibility_name_mapper_pr97"),
    generatedAt: nowIso(options.now || Date.now),
    projectId: normalizeString(context.projectId, "project_sub_agent_lifecycle"),
    workThreadId: normalizeString(context.workThreadId, "work_thread_sub_agent_lifecycle"),
    rows,
    compatibilityDirection: "legacy_to_direct_native_only",
    legacyAuthorityAllowed: false,
    providerTransportStarted: false,
    lifecycleMutationStarted: false,
  };
  mapper.mapperDigest = digestFor("agent-compatibility-name-mapper@1", mapper);
  return mapper;
}

function buildCompatibilityBypassProbes(mapper, authorityMatrix, input = {}) {
  const actionNames = Array.isArray(input.legacyActions) && input.legacyActions.length
    ? input.legacyActions
    : ["spawnAgent", "sendInput", "resumeAgent", "wait", "closeAgent", "unknownLegacyAction"];
  const mappings = new Map(mapper.rows.map((row) => [row.legacyName, row]));
  const authorityRows = new Map(authorityMatrix.rows.map((row) => [row.directNativeName, row]));
  return actionNames.map((legacyName) => {
    const mapping = mappings.get(legacyName) || null;
    const authorityRow = mapping ? authorityRows.get(mapping.directNativeName) : null;
    const mapped = Boolean(mapping && authorityRow);
    const row = {
      probeId: `compatibility_bypass_probe_${legacyName}`,
      legacyName,
      directNativeName: mapping?.directNativeName || "",
      mapped,
      finalDecision: mapped ? "requires_direct_native_authority" : "blocked_compatibility_unknown",
      grantsAuthority: false,
      providerTransportStarted: false,
      lifecycleMutationStarted: false,
      executorStarted: false,
      blockerCodes: mapped ? ["legacy_name_not_source_authority"] : ["compatibility_unknown"],
      evidenceRefs: mapped ? [sourceRef("agent_compatibility_mapping", mapping.rowId, "compatibility mapping row")] : [],
    };
    row.probeDigest = digestFor("agent-compatibility-bypass-probe@1", row);
    return row;
  });
}

function buildSubAgentLifecycleCompatibilityPacket(input = {}, options = {}) {
  const context = {
    projectId: normalizeString(input.projectId, "project_sub_agent_lifecycle"),
    workThreadId: normalizeString(input.workThreadId, "work_thread_sub_agent_lifecycle"),
    primaryThreadId: normalizeString(input.primaryThreadId, input.parentThreadId || "thread_sub_agent_parent"),
    parentThreadId: normalizeString(input.parentThreadId, input.primaryThreadId || "thread_sub_agent_parent"),
    packetId: normalizeString(input.packetId, "sub_agent_lifecycle_compatibility_packet_pr97"),
    matrixId: input.matrixId,
    mapperId: input.mapperId,
  };
  const stateModels = (Array.isArray(input.agents) && input.agents.length ? input.agents : [{
    agentId: "agent_pr97_fixture",
    childThreadId: "child_thread_pr97_fixture",
    parentThreadId: context.parentThreadId,
    workThreadId: context.workThreadId,
    lifecycleStatus: "running",
    transportStatus: "provider_running",
  }]).map((agent) => buildLifecycleStateModel(agent, context, options));
  const authorityMatrix = buildAuthorityMatrix(context, options);
  const compatibilityMapper = buildCompatibilityMapper(authorityMatrix, context, options);
  const compatibilityBypassProbes = buildCompatibilityBypassProbes(compatibilityMapper, authorityMatrix, input);
  const packet = {
    schema: SUB_AGENT_LIFECYCLE_COMPATIBILITY_PACKET_SCHEMA,
    packetId: context.packetId,
    generatedAt: nowIso(options.now || Date.now),
    projectId: context.projectId,
    workThreadId: context.workThreadId,
    primaryThreadId: context.primaryThreadId,
    statePrecedenceLaw: "terminal_exact_gt_provider_running_gt_stale_gt_unknown_policy_blocked_overrides_controls",
    stateModels,
    authorityMatrix,
    compatibilityMapper,
    compatibilityBypassProbes,
    providerTransportStarted: false,
    lifecycleMutationStarted: false,
    transcriptInjectedIntoPrimary: false,
    workspaceMutationStarted: false,
    rawChildTranscriptIncluded: false,
    rawProviderPayloadIncluded: false,
  };
  packet.packetDigest = digestFor("sub-agent-lifecycle-compatibility-packet@1", packet);
  validateSubAgentLifecycleCompatibilityPacket(packet);
  return packet;
}

function validateSubAgentLifecycleCompatibilityPacket(packet = {}) {
  const errors = [];
  if (packet.schema !== SUB_AGENT_LIFECYCLE_COMPATIBILITY_PACKET_SCHEMA) throw new Error("sub_agent_lifecycle_compatibility_packet_schema_mismatch");
  for (const field of ["packetId", "projectId", "workThreadId", "primaryThreadId", "packetDigest"]) {
    if (!normalizeString(packet[field], "")) errors.push(`missing_required_string:${field}`);
  }
  const stateModels = Array.isArray(packet.stateModels) ? packet.stateModels : [];
  if (!stateModels.length) errors.push("state_models_missing");
  for (const row of stateModels) {
    if (row.schema !== AGENT_LIFECYCLE_STATE_MODEL_SCHEMA) errors.push(`state_model_schema_mismatch:${row.agentId}`);
    for (const field of ["lifecycleStatus", "transportStatus", "mailboxStatus", "transcriptStatus", "usageStatus", "resultStatus", "controlPosture", "conflictState"]) {
      if (!normalizeString(row[field], "")) errors.push(`state_model_axis_missing:${field}`);
    }
    if (["not_found", "stale"].includes(row.lifecycleStatus) && row.controlPosture !== "blocked") errors.push(`unsafe_control_posture:${row.agentId}`);
    if (row.transportStatus === "provider_handoff_unknown" && row.targetActionPosture !== "target_actions_blocked") errors.push(`handoff_unknown_action_leak:${row.agentId}`);
    for (const flag of ["providerTransportStarted", "lifecycleMutationStarted", "transcriptInjectedIntoPrimary", "rawChildTranscriptIncluded", "rawProviderPayloadIncluded"]) {
      if (row[flag] !== false) errors.push(`state_model_boundary_leak:${flag}`);
    }
  }
  if (packet.authorityMatrix?.schema !== AGENT_LIFECYCLE_AUTHORITY_MATRIX_SCHEMA) errors.push("authority_matrix_missing");
  const authorityRowsList = Array.isArray(packet.authorityMatrix?.rows) ? packet.authorityMatrix.rows : [];
  const authorityRows = new Map(authorityRowsList.map((row) => [row.directNativeName, row]));
  for (const action of DIRECT_NATIVE_ACTIONS) {
    if (!authorityRows.has(action)) errors.push(`authority_row_missing:${action}`);
  }
  for (const row of authorityRowsList) {
    if (row.compatibilitySourceAllowed !== false) errors.push(`compatibility_source_authority_leak:${row.directNativeName}`);
    if (row.providerTransportAllowedInPr97 !== false) errors.push(`provider_transport_allowed_in_pr97:${row.directNativeName}`);
    if (row.lifecycleMutationAllowedInPr97 !== false) errors.push(`lifecycle_mutation_allowed_in_pr97:${row.directNativeName}`);
  }
  if (packet.compatibilityMapper?.schema !== AGENT_COMPATIBILITY_NAME_MAPPER_SCHEMA) errors.push("compatibility_mapper_missing");
  const mapperRowsList = Array.isArray(packet.compatibilityMapper?.rows) ? packet.compatibilityMapper.rows : [];
  if (!mapperRowsList.length) errors.push("compatibility_mapper_rows_missing");
  for (const row of mapperRowsList) {
    if (row.compatibilityOnly !== true) errors.push(`compatibility_row_not_projection_only:${row.legacyName}`);
    if (row.authorityBypassAllowed !== false) errors.push(`compatibility_authority_bypass:${row.legacyName}`);
    if (row.sourceAuthority !== "direct_native_row") errors.push(`compatibility_source_authority_invalid:${row.legacyName}`);
    if (!authorityRows.has(row.directNativeName)) errors.push(`compatibility_direct_row_missing:${row.legacyName}`);
  }
  const bypassProbesList = Array.isArray(packet.compatibilityBypassProbes) ? packet.compatibilityBypassProbes : [];
  for (const row of bypassProbesList) {
    if (row.grantsAuthority !== false) errors.push(`compatibility_probe_grants_authority:${row.legacyName}`);
    for (const flag of ["providerTransportStarted", "lifecycleMutationStarted", "executorStarted"]) {
      if (row[flag] !== false) errors.push(`compatibility_probe_boundary_leak:${flag}`);
    }
  }
  for (const flag of ["providerTransportStarted", "lifecycleMutationStarted", "transcriptInjectedIntoPrimary", "workspaceMutationStarted", "rawChildTranscriptIncluded", "rawProviderPayloadIncluded"]) {
    if (packet[flag] !== false) errors.push(`packet_boundary_leak:${flag}`);
  }
  if (!errors.length) return true;
  throw new Error(`sub_agent_lifecycle_compatibility_validation_failed:${errors.join(",")}`);
}

module.exports = {
  AGENT_COMPATIBILITY_NAME_MAPPER_SCHEMA,
  AGENT_LIFECYCLE_AUTHORITY_MATRIX_SCHEMA,
  AGENT_LIFECYCLE_STATE_MODEL_SCHEMA,
  DIRECT_NATIVE_ACTIONS,
  LEGACY_COMPATIBILITY_MAPPINGS,
  SUB_AGENT_LIFECYCLE_COMPATIBILITY_PACKET_SCHEMA,
  WAVE15_RESIDENT_CALLABLE_ACTIONS,
  buildSubAgentLifecycleCompatibilityPacket,
  validateSubAgentLifecycleCompatibilityPacket,
};
