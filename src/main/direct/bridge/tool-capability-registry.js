"use strict";

const crypto = require("node:crypto");

const DIRECT_TOOL_CAPABILITY_REGISTRY_SCHEMA = "direct_tool_capability_registry@1";
const DIRECT_TOOL_CAPABILITY_ROW_SCHEMA = "direct_tool_capability_row@1";
const DIRECT_TOOL_CAPABILITY_STATUS_PROJECTION_SCHEMA = "direct_tool_capability_status_projection@1";

const ODEU_TOOL_FAMILIES = new Set([
  "workspace_process_authority",
  "local_perception",
  "session_control_state",
  "human_authority_bridge",
  "agent_runtime",
  "batch_agent_orchestration",
  "external_capability_discovery",
  "external_resource_action_authority",
  "provider_hosted_tools",
  "structured_execution_lane",
]);

const CAPABILITY_STATES = new Set(["unknown", "vanilla_known", "profile_declared", "provider_accepted", "runtime_probed"]);
const IMPLEMENTATION_STATES = new Set(["none", "schema_only", "projection_only", "fixture_executor", "restricted_executor", "full_executor"]);
const PROMOTION_STATES = new Set(["unsupported", "diagnostic_only", "fixture_only", "direct_restricted", "direct_enabled", "deferred_external_authority"]);
const PROVIDER_DECLARATION_STATES = new Set([
  "not_declared",
  "declared_fixture_only",
  "declared_live_unproved",
  "declared_live_accepted",
  "rejected_by_provider",
  "not_provider_tool",
]);
const LOCAL_EXECUTOR_STATES = new Set(["none", "scaffolded", "fixture_only", "implemented_restricted", "implemented_full"]);
const SIDE_EFFECT_CLASSES = new Set([
  "none",
  "workspace_read",
  "workspace_write",
  "process_session",
  "session_state",
  "context_world",
  "human_decision",
  "agent_graph",
  "external_discovery",
  "external_read",
  "external_action",
  "provider_hosted",
  "capability_mutation",
  "structured_execution",
]);
const AUTHORITY_REQUIREMENTS = new Set([
  "none",
  "display_only",
  "workspace_read_gate",
  "workspace_mutation_gate",
  "process_session_gate",
  "context_maintenance_gate",
  "human_decision_packet",
  "agent_runtime_gate",
  "external_discovery_gate",
  "external_action_gate",
  "provider_hosted_capability_evidence",
  "plugin_governance_gate",
  "code_mode_execution_gate",
]);
const APPROVAL_MODES = new Set([
  "none",
  "display_only",
  "human_decision",
  "per_action",
  "per_write",
  "per_session",
  "policy_blocked",
  "future_gate_required",
]);
const REPLAY_RISKS = new Set(["none", "low", "medium", "high", "replay_forbidden", "unknown"]);
const CONTEXT_VISIBILITIES = new Set([
  "not_context_eligible",
  "diagnostic_only",
  "result_envelope_only",
  "plan_evidence",
  "human_decision_ref",
  "agent_summary_only",
  "external_evidence_ref",
  "provider_artifact_ref",
]);
const UI_PROJECTIONS = new Set(["hidden", "status_only", "settings_row", "approval_card", "tool_panel", "agent_panel", "future_surface"]);
const USAGE_ATTRIBUTIONS = new Set(["none", "parent_turn", "tool_call", "agent_thread", "batch_job", "provider_hosted", "external_tool"]);
const AGENT_ELIGIBILITIES = new Set(["not_agent_tool", "primary_only", "child_allowed_future", "sub_agent_only", "batch_worker_only"]);
const PROVIDER_RESULT_ENVELOPES = new Set([
  "none",
  "function_call_output",
  "custom_tool_call_output",
  "bounded_result_envelope",
  "plan_projection",
  "human_decision_packet",
  "agent_mailbox_event",
  "external_evidence_ref",
  "provider_hosted_result",
  "generated_artifact_ref",
  "code_mode_result",
]);
const RAW_EXPOSURE_POLICIES = new Set(["none", "redacted_summary", "metadata_only", "bounded_preview", "forbidden"]);
const FAILURE_CLASSES = new Set([
  "projection_laundering",
  "authority_inflation",
  "context_smuggling",
  "action_replay",
  "memory_overclaim",
  "thread_flattening",
  "world_target_confusion",
  "silent_compression_loss",
  "renderer_authority_leak",
]);

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype;
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function boundedString(value, maxLength = 320) {
  const text = normalizeString(value, "");
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
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

function normalizeEnum(value, allowed, fallback) {
  const text = normalizeString(value, fallback);
  return allowed.has(text) ? text : fallback;
}

function normalizeStringList(values, fallback = []) {
  const source = Array.isArray(values) ? values : fallback;
  return [...new Set(source.map((value) => normalizeString(value, "")).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function normalizeEnumList(values, allowed, fallback = []) {
  const normalized = normalizeStringList(values, fallback).filter((value) => allowed.has(value));
  return normalized.length ? normalized : fallback.filter((value) => allowed.has(value));
}

function defaultUnsupportedReason(row = {}) {
  if (row.promotionState === "unsupported") return "not_implemented";
  if (row.promotionState === "diagnostic_only") return "diagnostic_only";
  if (row.promotionState === "fixture_only") return "fixture_only";
  if (row.promotionState === "deferred_external_authority") return "deferred_external_authority";
  return "";
}

function familyDefaults(family) {
  switch (family) {
    case "workspace_process_authority":
      return { sideEffectClass: "workspace_write", authorityRequired: "workspace_mutation_gate", replayRisk: "high", contextVisibility: "result_envelope_only", usageAttribution: "tool_call" };
    case "local_perception":
      return { sideEffectClass: "workspace_read", authorityRequired: "workspace_read_gate", replayRisk: "low", contextVisibility: "result_envelope_only", usageAttribution: "tool_call" };
    case "session_control_state":
      return { sideEffectClass: "session_state", authorityRequired: "display_only", replayRisk: "medium", contextVisibility: "plan_evidence", usageAttribution: "none" };
    case "human_authority_bridge":
      return { sideEffectClass: "human_decision", authorityRequired: "human_decision_packet", replayRisk: "medium", contextVisibility: "human_decision_ref", usageAttribution: "none" };
    case "agent_runtime":
      return { sideEffectClass: "agent_graph", authorityRequired: "agent_runtime_gate", replayRisk: "high", contextVisibility: "agent_summary_only", usageAttribution: "agent_thread" };
    case "batch_agent_orchestration":
      return { sideEffectClass: "agent_graph", authorityRequired: "agent_runtime_gate", replayRisk: "high", contextVisibility: "agent_summary_only", usageAttribution: "batch_job" };
    case "external_capability_discovery":
      return { sideEffectClass: "external_discovery", authorityRequired: "external_discovery_gate", replayRisk: "medium", contextVisibility: "diagnostic_only", usageAttribution: "external_tool" };
    case "external_resource_action_authority":
      return { sideEffectClass: "external_action", authorityRequired: "external_action_gate", replayRisk: "high", contextVisibility: "external_evidence_ref", usageAttribution: "external_tool" };
    case "provider_hosted_tools":
      return { sideEffectClass: "provider_hosted", authorityRequired: "provider_hosted_capability_evidence", replayRisk: "medium", contextVisibility: "provider_artifact_ref", usageAttribution: "provider_hosted" };
    case "structured_execution_lane":
      return { sideEffectClass: "structured_execution", authorityRequired: "code_mode_execution_gate", replayRisk: "high", contextVisibility: "result_envelope_only", usageAttribution: "tool_call" };
    default:
      return { sideEffectClass: "none", authorityRequired: "display_only", replayRisk: "unknown", contextVisibility: "diagnostic_only", usageAttribution: "none" };
  }
}

function buildToolCapabilityRow(input = {}) {
  const family = normalizeEnum(input.odeuFamily || input.family, ODEU_TOOL_FAMILIES, "local_perception");
  const defaults = familyDefaults(family);
  const promotionState = normalizeEnum(input.promotionState, PROMOTION_STATES, "unsupported");
  const capabilityState = normalizeEnum(input.capabilityState, CAPABILITY_STATES, "vanilla_known");
  const implementationState = normalizeEnum(input.implementationState, IMPLEMENTATION_STATES, "none");
  const providerDeclarationState = normalizeEnum(input.providerDeclarationState, PROVIDER_DECLARATION_STATES, "not_declared");
  const localExecutorState = normalizeEnum(input.localExecutorState, LOCAL_EXECUTOR_STATES, "none");
  const row = {
    schema: DIRECT_TOOL_CAPABILITY_ROW_SCHEMA,
    toolId: normalizeString(input.toolId || input.id, ""),
    displayName: boundedString(input.displayName || input.name || input.toolId || input.id, 140),
    vanillaNames: normalizeStringList(input.vanillaNames),
    directNames: normalizeStringList(input.directNames),
    odeuFamily: family,
    capabilityState,
    implementationState,
    promotionState,
    providerDeclarationState,
    localExecutorState,
    sideEffectClass: normalizeEnum(input.sideEffectClass, SIDE_EFFECT_CLASSES, defaults.sideEffectClass),
    authorityRequired: normalizeEnum(input.authorityRequired, AUTHORITY_REQUIREMENTS, defaults.authorityRequired),
    requestShapeFamilies: normalizeStringList(input.requestShapeFamilies, ["none"]),
    localExecutor: boundedString(input.localExecutor, 220),
    approvalMode: normalizeEnum(input.approvalMode, APPROVAL_MODES, promotionState === "unsupported" ? "policy_blocked" : "future_gate_required"),
    replayRisk: normalizeEnum(input.replayRisk, REPLAY_RISKS, defaults.replayRisk),
    recoveryLaw: boundedString(input.recoveryLaw || "No automatic replay; missing evidence degrades or blocks per family law.", 420),
    contextVisibility: normalizeEnum(input.contextVisibility, CONTEXT_VISIBILITIES, defaults.contextVisibility),
    uiProjection: normalizeEnum(input.uiProjection, UI_PROJECTIONS, "settings_row"),
    usageAttribution: normalizeEnum(input.usageAttribution, USAGE_ATTRIBUTIONS, defaults.usageAttribution),
    agentEligibility: normalizeEnum(input.agentEligibility, AGENT_ELIGIBILITIES, "not_agent_tool"),
    providerResultEnvelopeType: normalizeEnum(input.providerResultEnvelopeType, PROVIDER_RESULT_ENVELOPES, "none"),
    rawExposurePolicy: normalizeEnum(input.rawExposurePolicy, RAW_EXPOSURE_POLICIES, "redacted_summary"),
    failureClasses: normalizeEnumList(input.failureClasses, FAILURE_CLASSES, ["projection_laundering", "authority_inflation"]),
    unsupportedReason: boundedString(input.unsupportedReason || defaultUnsupportedReason({ promotionState }), 160),
    authorityWideningTarget: normalizeString(input.authorityWideningTarget, ""),
    wideningScope: normalizeString(input.wideningScope, ""),
    rendererSafeSummary: boundedString(input.rendererSafeSummary || `${input.toolId || input.id || "tool"} is ${promotionState}.`, 420),
    toolEnabledInThisPr: false,
    providerDeclarationEnabledInThisPr: false,
    localExecutionEnabledInThisPr: false,
    authorityGateEnabledInThisPr: false,
    rawPayloadIncluded: false,
    rawTextIncluded: false,
    rawSecretIncluded: false,
  };
  row.rowDigest = digestFor("direct-tool-capability-row@1", row);
  return row;
}

function defaultToolCapabilityInputs() {
  return [
    {
      toolId: "direct.read_file",
      displayName: "Direct read_file",
      directNames: ["read_file", "readFile"],
      odeuFamily: "local_perception",
      capabilityState: "runtime_probed",
      implementationState: "restricted_executor",
      promotionState: "direct_restricted",
      providerDeclarationState: "declared_live_unproved",
      localExecutorState: "implemented_restricted",
      requestShapeFamilies: ["function_call", "custom_tool_call", "quoted_tool_result_continuation"],
      localExecutor: "src/main/direct/tools/read-only-authority.js",
      approvalMode: "per_action",
      providerResultEnvelopeType: "bounded_result_envelope",
      failureClasses: ["projection_laundering", "authority_inflation", "context_smuggling", "action_replay"],
      rendererSafeSummary: "Implemented as relative workspace read with sensitive path blocks, caps, redaction, approval, result evidence, and continuation envelope.",
    },
    {
      toolId: "vanilla.apply_patch",
      displayName: "apply_patch",
      vanillaNames: ["apply_patch"],
      directNames: ["apply_patch", "applyPatch"],
      odeuFamily: "workspace_process_authority",
      capabilityState: "runtime_probed",
      implementationState: "restricted_executor",
      promotionState: "direct_restricted",
      providerDeclarationState: "declared_live_unproved",
      localExecutorState: "implemented_restricted",
      requestShapeFamilies: ["custom_tool_call", "function_call", "quoted_tool_result_continuation"],
      localExecutor: "src/main/direct/tools/patch-apply-authority.js",
      approvalMode: "per_action",
      providerResultEnvelopeType: "bounded_result_envelope",
      recoveryLaw: "Patch replay is forbidden after ambiguous side effects; recovery must cite patch plan/result/effect summary.",
      failureClasses: ["projection_laundering", "authority_inflation", "context_smuggling", "action_replay", "world_target_confusion"],
      rendererSafeSummary: "Implemented as model proposal plus local patch plan, approval, mutation evidence, recovery posture, and continuation envelope.",
    },
    {
      toolId: "direct.run_command",
      displayName: "Direct run_command",
      directNames: ["run_command", "runCommand"],
      odeuFamily: "workspace_process_authority",
      capabilityState: "runtime_probed",
      implementationState: "restricted_executor",
      promotionState: "direct_restricted",
      providerDeclarationState: "declared_live_unproved",
      localExecutorState: "implemented_restricted",
      sideEffectClass: "process_session",
      authorityRequired: "process_session_gate",
      requestShapeFamilies: ["function_call", "custom_tool_call", "quoted_tool_result_continuation"],
      localExecutor: "src/main/direct/tools/command-execution-authority.js",
      approvalMode: "per_action",
      providerResultEnvelopeType: "bounded_result_envelope",
      recoveryLaw: "Bounded package-manager script execution is never automatically replayed after restart ambiguity.",
      failureClasses: ["projection_laundering", "authority_inflation", "context_smuggling", "action_replay", "world_target_confusion"],
      rendererSafeSummary: "Implemented as bounded package-manager test/run script authority, not full vanilla exec parity.",
    },
    {
      toolId: "vanilla.exec_command",
      displayName: "exec_command",
      vanillaNames: ["exec_command"],
      odeuFamily: "workspace_process_authority",
      capabilityState: "vanilla_known",
      implementationState: "schema_only",
      promotionState: "diagnostic_only",
      providerDeclarationState: "not_declared",
      localExecutorState: "scaffolded",
      sideEffectClass: "process_session",
      authorityRequired: "process_session_gate",
      requestShapeFamilies: ["none"],
      approvalMode: "future_gate_required",
      providerResultEnvelopeType: "bounded_result_envelope",
      recoveryLaw: "Stateful process sessions require session identity, output frames, cancellation, cleanup, stdin policy, and replay classifier before declaration.",
      failureClasses: ["projection_laundering", "authority_inflation", "context_smuggling", "action_replay"],
      rendererSafeSummary: "Vanilla stateful process session parity is planned; current direct run_command is not an alias.",
    },
    {
      toolId: "vanilla.write_stdin",
      displayName: "write_stdin",
      vanillaNames: ["write_stdin"],
      odeuFamily: "workspace_process_authority",
      capabilityState: "vanilla_known",
      implementationState: "schema_only",
      promotionState: "diagnostic_only",
      providerDeclarationState: "not_declared",
      localExecutorState: "none",
      sideEffectClass: "process_session",
      authorityRequired: "process_session_gate",
      requestShapeFamilies: ["none"],
      approvalMode: "future_gate_required",
      recoveryLaw: "Stdin write can trigger side effects and requires command-class stdin policy before use.",
      failureClasses: ["projection_laundering", "authority_inflation", "context_smuggling", "action_replay"],
    },
    {
      toolId: "vanilla.shell_command",
      displayName: "shell_command",
      vanillaNames: ["shell_command"],
      odeuFamily: "workspace_process_authority",
      capabilityState: "vanilla_known",
      implementationState: "none",
      promotionState: "unsupported",
      providerDeclarationState: "not_declared",
      localExecutorState: "none",
      sideEffectClass: "process_session",
      authorityRequired: "process_session_gate",
      requestShapeFamilies: ["none"],
      approvalMode: "policy_blocked",
      unsupportedReason: "legacy_replaced_by_exec_command",
    },
    {
      toolId: "vanilla.request_permissions",
      displayName: "request_permissions",
      vanillaNames: ["request_permissions"],
      odeuFamily: "human_authority_bridge",
      capabilityState: "vanilla_known",
      implementationState: "schema_only",
      promotionState: "diagnostic_only",
      providerDeclarationState: "not_declared",
      localExecutorState: "none",
      sideEffectClass: "human_decision",
      authorityRequired: "human_decision_packet",
      requestShapeFamilies: ["none"],
      approvalMode: "human_decision",
      contextVisibility: "human_decision_ref",
      providerResultEnvelopeType: "human_decision_packet",
      authorityWideningTarget: "workspace_process",
      wideningScope: "single_action",
      recoveryLaw: "Permission widening defaults to single-action or blocked; model request never widens authority by itself.",
      failureClasses: ["projection_laundering", "authority_inflation", "renderer_authority_leak"],
    },
    {
      toolId: "vanilla.view_image",
      displayName: "view_image",
      vanillaNames: ["view_image"],
      odeuFamily: "local_perception",
      capabilityState: "vanilla_known",
      implementationState: "schema_only",
      promotionState: "diagnostic_only",
      providerDeclarationState: "not_declared",
      localExecutorState: "scaffolded",
      requestShapeFamilies: ["none"],
      approvalMode: "future_gate_required",
      providerResultEnvelopeType: "bounded_result_envelope",
      rawExposurePolicy: "metadata_only",
      recoveryLaw: "Renderer preview, file read, provider image payload sent, and model use are separate evidence states.",
      failureClasses: ["projection_laundering", "authority_inflation", "context_smuggling"],
    },
    {
      toolId: "vanilla.update_plan",
      displayName: "update_plan",
      vanillaNames: ["update_plan"],
      odeuFamily: "session_control_state",
      capabilityState: "vanilla_known",
      implementationState: "schema_only",
      promotionState: "diagnostic_only",
      providerDeclarationState: "not_declared",
      localExecutorState: "none",
      sideEffectClass: "session_state",
      requestShapeFamilies: ["none"],
      approvalMode: "display_only",
      contextVisibility: "plan_evidence",
      providerResultEnvelopeType: "plan_projection",
      recoveryLaw: "Model-authored plan updates cannot override human objective, tool approval, or task completion proof.",
      failureClasses: ["projection_laundering", "authority_inflation", "context_smuggling"],
    },
    {
      toolId: "vanilla.request_user_input",
      displayName: "request_user_input",
      vanillaNames: ["request_user_input"],
      odeuFamily: "human_authority_bridge",
      capabilityState: "vanilla_known",
      implementationState: "schema_only",
      promotionState: "diagnostic_only",
      providerDeclarationState: "not_declared",
      localExecutorState: "scaffolded",
      sideEffectClass: "human_decision",
      authorityRequired: "human_decision_packet",
      requestShapeFamilies: ["none"],
      approvalMode: "human_decision",
      contextVisibility: "human_decision_ref",
      providerResultEnvelopeType: "human_decision_packet",
      recoveryLaw: "Bounded choices may carry authority; free text is context only and cannot widen tool authority.",
      failureClasses: ["projection_laundering", "authority_inflation", "context_smuggling"],
    },
    {
      toolId: "vanilla.get_context_remaining",
      displayName: "get_context_remaining",
      vanillaNames: ["get_context_remaining"],
      odeuFamily: "session_control_state",
      capabilityState: "vanilla_known",
      implementationState: "schema_only",
      promotionState: "diagnostic_only",
      providerDeclarationState: "not_declared",
      localExecutorState: "scaffolded",
      sideEffectClass: "session_state",
      requestShapeFamilies: ["none"],
      approvalMode: "display_only",
      contextVisibility: "diagnostic_only",
      recoveryLaw: "Context remaining is display/maintenance diagnostic unless provider evidence makes it request-blocking.",
    },
    {
      toolId: "vanilla.new_context",
      displayName: "new_context",
      vanillaNames: ["new_context"],
      odeuFamily: "session_control_state",
      capabilityState: "vanilla_known",
      implementationState: "schema_only",
      promotionState: "unsupported",
      providerDeclarationState: "not_declared",
      localExecutorState: "none",
      sideEffectClass: "context_world",
      authorityRequired: "context_maintenance_gate",
      requestShapeFamilies: ["none"],
      approvalMode: "policy_blocked",
      contextVisibility: "not_context_eligible",
      unsupportedReason: "blocked_until_context_maintenance_law",
      recoveryLaw: "Context-world transition remains blocked until omission ledger, frontier baton, request manifest, and source refs are wired.",
      failureClasses: ["projection_laundering", "authority_inflation", "context_smuggling", "silent_compression_loss"],
    },
    ...["spawn_agent", "list_agents", "wait_agent", "send_message", "followup_task", "interrupt_agent"].map((name) => ({
      toolId: `vanilla.agent.${name}`,
      displayName: name,
      vanillaNames: [name],
      odeuFamily: "agent_runtime",
      capabilityState: "vanilla_known",
      implementationState: "projection_only",
      promotionState: "diagnostic_only",
      providerDeclarationState: "not_declared",
      localExecutorState: "none",
      sideEffectClass: name === "list_agents" ? "none" : "agent_graph",
      requestShapeFamilies: ["none"],
      approvalMode: name === "list_agents" ? "display_only" : "future_gate_required",
      providerResultEnvelopeType: name === "list_agents" ? "agent_mailbox_event" : "none",
      agentEligibility: "primary_only",
      recoveryLaw: "Agent runtime requires graph, mailbox, lifecycle, context packet, authority boundary, and usage attribution before tool exposure.",
      failureClasses: ["projection_laundering", "authority_inflation", "context_smuggling", "action_replay", "thread_flattening"],
      rendererSafeSummary: `${name} is classified under agent runtime; direct spawning/messaging/waiting is not enabled by this PR.`,
    })),
    ...["multi_agent_v1.spawn_agent", "multi_agent_v1.send_input", "multi_agent_v1.resume_agent", "multi_agent_v1.wait_agent", "multi_agent_v1.close_agent"].map((name) => ({
      toolId: `vanilla.${name}`,
      displayName: name,
      vanillaNames: [name],
      odeuFamily: "agent_runtime",
      capabilityState: "vanilla_known",
      implementationState: "none",
      promotionState: "unsupported",
      providerDeclarationState: "not_declared",
      localExecutorState: "none",
      sideEffectClass: "agent_graph",
      requestShapeFamilies: ["none"],
      approvalMode: "policy_blocked",
      unsupportedReason: "legacy_v1_compat_deferred",
      agentEligibility: "primary_only",
      failureClasses: ["projection_laundering", "authority_inflation", "thread_flattening"],
    })),
    {
      toolId: "vanilla.spawn_agents_on_csv",
      displayName: "spawn_agents_on_csv",
      vanillaNames: ["spawn_agents_on_csv"],
      odeuFamily: "batch_agent_orchestration",
      capabilityState: "vanilla_known",
      implementationState: "none",
      promotionState: "unsupported",
      providerDeclarationState: "not_declared",
      localExecutorState: "none",
      requestShapeFamilies: ["none"],
      approvalMode: "policy_blocked",
      unsupportedReason: "deferred_until_agent_runtime_stable",
      usageAttribution: "batch_job",
      agentEligibility: "primary_only",
      failureClasses: ["projection_laundering", "authority_inflation", "action_replay", "thread_flattening"],
    },
    {
      toolId: "vanilla.report_agent_job_result",
      displayName: "report_agent_job_result",
      vanillaNames: ["report_agent_job_result"],
      odeuFamily: "batch_agent_orchestration",
      capabilityState: "vanilla_known",
      implementationState: "none",
      promotionState: "unsupported",
      providerDeclarationState: "not_declared",
      localExecutorState: "none",
      requestShapeFamilies: ["none"],
      approvalMode: "policy_blocked",
      unsupportedReason: "worker_only_deferred_until_batch_agent_jobs",
      usageAttribution: "batch_job",
      agentEligibility: "batch_worker_only",
    },
    {
      toolId: "vanilla.tool_search",
      displayName: "tool_search",
      vanillaNames: ["tool_search"],
      odeuFamily: "external_capability_discovery",
      capabilityState: "vanilla_known",
      implementationState: "schema_only",
      promotionState: "diagnostic_only",
      providerDeclarationState: "not_declared",
      localExecutorState: "none",
      requestShapeFamilies: ["none"],
      approvalMode: "display_only",
      contextVisibility: "diagnostic_only",
      recoveryLaw: "Tool discovery is not tool execution; discovered tools are not declared or approved.",
      failureClasses: ["projection_laundering", "authority_inflation", "renderer_authority_leak"],
    },
    ...["list_mcp_resources", "list_mcp_resource_templates"].map((name) => ({
      toolId: `vanilla.${name}`,
      displayName: name,
      vanillaNames: [name],
      odeuFamily: "external_capability_discovery",
      capabilityState: "vanilla_known",
      implementationState: "schema_only",
      promotionState: "diagnostic_only",
      providerDeclarationState: "not_declared",
      localExecutorState: "none",
      requestShapeFamilies: ["none"],
      approvalMode: "display_only",
      contextVisibility: "diagnostic_only",
      failureClasses: ["projection_laundering", "authority_inflation", "renderer_authority_leak"],
    })),
    {
      toolId: "vanilla.read_mcp_resource",
      displayName: "read_mcp_resource",
      vanillaNames: ["read_mcp_resource"],
      odeuFamily: "external_resource_action_authority",
      capabilityState: "vanilla_known",
      implementationState: "schema_only",
      promotionState: "deferred_external_authority",
      providerDeclarationState: "not_declared",
      localExecutorState: "none",
      sideEffectClass: "external_read",
      requestShapeFamilies: ["none"],
      approvalMode: "future_gate_required",
      providerResultEnvelopeType: "external_evidence_ref",
      recoveryLaw: "MCP resource read is imported external evidence, not trusted project truth until staged/cited.",
      failureClasses: ["projection_laundering", "authority_inflation", "context_smuggling"],
    },
    {
      toolId: "vanilla.mcp_dynamic_tool",
      displayName: "MCP dynamic tool call",
      odeuFamily: "external_resource_action_authority",
      capabilityState: "vanilla_known",
      implementationState: "schema_only",
      promotionState: "deferred_external_authority",
      providerDeclarationState: "not_declared",
      localExecutorState: "none",
      sideEffectClass: "external_action",
      requestShapeFamilies: ["none"],
      approvalMode: "future_gate_required",
      recoveryLaw: "Dynamic MCP action requires server identity, schema digest, permission class, side-effect class, and approval.",
      failureClasses: ["projection_laundering", "authority_inflation", "context_smuggling", "action_replay"],
    },
    {
      toolId: "vanilla.list_available_plugins_to_install",
      displayName: "list_available_plugins_to_install",
      vanillaNames: ["list_available_plugins_to_install"],
      odeuFamily: "external_capability_discovery",
      capabilityState: "vanilla_known",
      implementationState: "schema_only",
      promotionState: "diagnostic_only",
      providerDeclarationState: "not_declared",
      localExecutorState: "none",
      requestShapeFamilies: ["none"],
      approvalMode: "display_only",
    },
    {
      toolId: "vanilla.request_plugin_install",
      displayName: "request_plugin_install",
      vanillaNames: ["request_plugin_install"],
      odeuFamily: "external_resource_action_authority",
      capabilityState: "vanilla_known",
      implementationState: "schema_only",
      promotionState: "deferred_external_authority",
      providerDeclarationState: "not_declared",
      localExecutorState: "none",
      sideEffectClass: "capability_mutation",
      authorityRequired: "plugin_governance_gate",
      requestShapeFamilies: ["none"],
      approvalMode: "future_gate_required",
      unsupportedReason: "install_blocked_until_plugin_governance",
      recoveryLaw: "Plugin install mutates future authority surface and remains blocked until pinned source, capability diff, rollback, and recoverable registry changes exist.",
      failureClasses: ["projection_laundering", "authority_inflation", "action_replay", "renderer_authority_leak"],
    },
    ...["web_search", "image_generation"].map((name) => ({
      toolId: `vanilla.hosted.${name}`,
      displayName: name,
      vanillaNames: [name],
      odeuFamily: "provider_hosted_tools",
      capabilityState: "vanilla_known",
      implementationState: "schema_only",
      promotionState: "diagnostic_only",
      providerDeclarationState: "not_declared",
      localExecutorState: "none",
      requestShapeFamilies: ["none"],
      approvalMode: "future_gate_required",
      providerResultEnvelopeType: name === "web_search" ? "provider_hosted_result" : "generated_artifact_ref",
      recoveryLaw: name === "web_search"
        ? "Web search result is external epistemic evidence requiring source refs, retrieval time, citation policy, and staleness."
        : "Image generation result is generated artifact requiring prompt evidence, asset id, storage, and metadata/redaction policy.",
      failureClasses: ["projection_laundering", "authority_inflation", "context_smuggling"],
    })),
    ...["code_mode_execute", "code_mode_wait"].map((name) => ({
      toolId: `vanilla.${name}`,
      displayName: name,
      vanillaNames: [name],
      odeuFamily: "structured_execution_lane",
      capabilityState: "vanilla_known",
      implementationState: "schema_only",
      promotionState: "unsupported",
      providerDeclarationState: "not_declared",
      localExecutorState: "none",
      requestShapeFamilies: ["none"],
      approvalMode: "policy_blocked",
      unsupportedReason: "deferred_until_code_mode_execution_lane",
      providerResultEnvelopeType: "code_mode_result",
      recoveryLaw: "Code mode is a separate kernel/session/artifact lane and must not inherit shell approval profile.",
      failureClasses: ["projection_laundering", "authority_inflation", "context_smuggling", "action_replay"],
    })),
  ];
}

function buildToolCapabilityRegistry(input = {}) {
  const rows = (Array.isArray(input.rows) ? input.rows : defaultToolCapabilityInputs())
    .map((row) => buildToolCapabilityRow(row))
    .sort((a, b) => a.toolId.localeCompare(b.toolId));
  const source = {
    rowDigests: rows.map((row) => row.rowDigest),
    toolIds: rows.map((row) => row.toolId),
  };
  const registrySourceDigest = digestFor("direct-tool-capability-registry-source@1", source);
  const registry = {
    schema: DIRECT_TOOL_CAPABILITY_REGISTRY_SCHEMA,
    registryId: normalizeString(input.registryId, `direct_tool_capability_registry_${registrySourceDigest.slice(0, 24)}`),
    projectId: normalizeString(input.projectId, ""),
    workThreadId: normalizeString(input.workThreadId, ""),
    upstreamCodexTag: normalizeString(input.upstreamCodexTag, "rust-v0.140.0"),
    mode: normalizeString(input.mode, "constitution_only"),
    rowCount: rows.length,
    rows,
    registrySourceDigest,
    providerDeclarationsEnabledInThisPr: false,
    localExecutionEnabledInThisPr: false,
    authorityGateEnabledInThisPr: false,
    requestShapeMutationEnabledInThisPr: false,
    rawTextIncluded: false,
    rawSecretIncluded: false,
    createdAt: normalizeString(input.createdAt, nowIso(input.nowMs)),
  };
  registry.registryDigest = digestFor("direct-tool-capability-registry@1", registry);
  return registry;
}

function countBy(rows, field) {
  const counts = {};
  for (const row of rows) {
    const key = normalizeString(row?.[field], "unknown");
    counts[key] = Number(counts[key] || 0) + 1;
  }
  return counts;
}

function buildToolCapabilityStatusProjection(input = {}) {
  const registry = isPlainObject(input.registry) ? input.registry : buildToolCapabilityRegistry(input);
  const rows = Array.isArray(registry.rows) ? registry.rows : [];
  const projection = {
    schema: DIRECT_TOOL_CAPABILITY_STATUS_PROJECTION_SCHEMA,
    projectId: normalizeString(input.projectId, registry.projectId || ""),
    workThreadId: normalizeString(input.workThreadId, registry.workThreadId || ""),
    uiProjectionGeneration: Number(input.uiProjectionGeneration || 1),
    upstreamCodexTag: normalizeString(registry.upstreamCodexTag, "rust-v0.140.0"),
    registryId: normalizeString(registry.registryId, ""),
    registryDigest: normalizeString(registry.registryDigest, ""),
    status: normalizeString(input.status, "constitution_only"),
    rowCount: rows.length,
    byFamily: countBy(rows, "odeuFamily"),
    byCapabilityState: countBy(rows, "capabilityState"),
    byImplementationState: countBy(rows, "implementationState"),
    byPromotionState: countBy(rows, "promotionState"),
    byProviderDeclarationState: countBy(rows, "providerDeclarationState"),
    byLocalExecutorState: countBy(rows, "localExecutorState"),
    providerDeclaredCount: rows.filter((row) => ["declared_fixture_only", "declared_live_unproved", "declared_live_accepted"].includes(row.providerDeclarationState)).length,
    localExecutorCount: rows.filter((row) => ["implemented_restricted", "implemented_full"].includes(row.localExecutorState)).length,
    directRestrictedCount: rows.filter((row) => row.promotionState === "direct_restricted").length,
    unsupportedCount: rows.filter((row) => row.promotionState === "unsupported").length,
    deferredExternalAuthorityCount: rows.filter((row) => row.promotionState === "deferred_external_authority").length,
    providerDeclarationsEnabledInThisPr: false,
    localExecutionEnabledInThisPr: false,
    authorityGateEnabledInThisPr: false,
    requestShapeMutationEnabledInThisPr: false,
    actionable: false,
    rendererSafeSummary: boundedString(input.rendererSafeSummary || "Direct tool capability rows are a constitution/projection only; this PR declares no provider tools and enables no new execution.", 420),
    rawTextIncluded: false,
    rawSecretIncluded: false,
  };
  projection.projectionDigest = digestFor("direct-tool-capability-status-projection@1", projection);
  return projection;
}

function validateToolCapabilityRegistry(registry = {}) {
  if (!isPlainObject(registry) || registry.schema !== DIRECT_TOOL_CAPABILITY_REGISTRY_SCHEMA) {
    throw new Error("direct_tool_capability_registry_schema_mismatch");
  }
  const rows = Array.isArray(registry.rows) ? registry.rows : [];
  if (!rows.length) throw new Error("direct_tool_capability_registry_empty");
  const seen = new Set();
  for (const row of rows) {
    if (!isPlainObject(row) || row.schema !== DIRECT_TOOL_CAPABILITY_ROW_SCHEMA) throw new Error("direct_tool_capability_row_schema_mismatch");
    if (!normalizeString(row.toolId, "")) throw new Error("direct_tool_capability_missing_tool_id");
    if (seen.has(row.toolId)) throw new Error(`direct_tool_capability_duplicate_tool_id:${row.toolId}`);
    seen.add(row.toolId);
    if (!ODEU_TOOL_FAMILIES.has(row.odeuFamily)) throw new Error(`direct_tool_capability_invalid_family:${row.toolId}`);
    if (!CAPABILITY_STATES.has(row.capabilityState)) throw new Error(`direct_tool_capability_invalid_capability_state:${row.toolId}`);
    if (!IMPLEMENTATION_STATES.has(row.implementationState)) throw new Error(`direct_tool_capability_invalid_implementation_state:${row.toolId}`);
    if (!PROMOTION_STATES.has(row.promotionState)) throw new Error(`direct_tool_capability_invalid_promotion_state:${row.toolId}`);
    if (!PROVIDER_DECLARATION_STATES.has(row.providerDeclarationState)) throw new Error(`direct_tool_capability_invalid_provider_state:${row.toolId}`);
    if (!LOCAL_EXECUTOR_STATES.has(row.localExecutorState)) throw new Error(`direct_tool_capability_invalid_executor_state:${row.toolId}`);
    if (!Array.isArray(row.requestShapeFamilies) || !row.requestShapeFamilies.length) throw new Error(`direct_tool_capability_missing_request_shape:${row.toolId}`);
    if (!PROVIDER_RESULT_ENVELOPES.has(row.providerResultEnvelopeType)) throw new Error(`direct_tool_capability_invalid_result_envelope:${row.toolId}`);
    if (row.promotionState === "unsupported" && !row.unsupportedReason) throw new Error(`direct_tool_capability_missing_unsupported_reason:${row.toolId}`);
    if (row.promotionState === "unsupported" && row.providerDeclarationState !== "not_declared") throw new Error(`direct_tool_capability_unsupported_provider_declared:${row.toolId}`);
    if (row.providerDeclarationState !== "not_declared" && row.providerDeclarationState !== "not_provider_tool" && row.requestShapeFamilies.includes("none")) {
      throw new Error(`direct_tool_capability_provider_declared_without_shape:${row.toolId}`);
    }
    if (row.promotionState === "direct_restricted" && row.localExecutorState !== "implemented_restricted") {
      throw new Error(`direct_tool_capability_restricted_without_executor:${row.toolId}`);
    }
    if (row.promotionState === "direct_enabled" && row.localExecutorState !== "implemented_full") {
      throw new Error(`direct_tool_capability_enabled_without_full_executor:${row.toolId}`);
    }
    if (["implemented_restricted", "implemented_full"].includes(row.localExecutorState) && !normalizeString(row.localExecutor, "")) {
      throw new Error(`direct_tool_capability_missing_executor_path:${row.toolId}`);
    }
    for (const flag of ["toolEnabledInThisPr", "providerDeclarationEnabledInThisPr", "localExecutionEnabledInThisPr", "authorityGateEnabledInThisPr"]) {
      if (row[flag] !== false) throw new Error(`direct_tool_capability_authority_leak:${row.toolId}:${flag}`);
    }
    if (row.rawPayloadIncluded !== false || row.rawTextIncluded !== false || row.rawSecretIncluded !== false) {
      throw new Error(`direct_tool_capability_raw_exposure:${row.toolId}`);
    }
  }
  if (
    registry.providerDeclarationsEnabledInThisPr !== false ||
    registry.localExecutionEnabledInThisPr !== false ||
    registry.authorityGateEnabledInThisPr !== false ||
    registry.requestShapeMutationEnabledInThisPr !== false
  ) {
    throw new Error("direct_tool_capability_registry_authority_enabled");
  }
  return true;
}

module.exports = {
  CAPABILITY_STATES,
  DIRECT_TOOL_CAPABILITY_REGISTRY_SCHEMA,
  DIRECT_TOOL_CAPABILITY_ROW_SCHEMA,
  DIRECT_TOOL_CAPABILITY_STATUS_PROJECTION_SCHEMA,
  IMPLEMENTATION_STATES,
  LOCAL_EXECUTOR_STATES,
  ODEU_TOOL_FAMILIES,
  PROMOTION_STATES,
  PROVIDER_DECLARATION_STATES,
  buildToolCapabilityRegistry,
  buildToolCapabilityRow,
  buildToolCapabilityStatusProjection,
  defaultToolCapabilityInputs,
  stableStringify,
  validateToolCapabilityRegistry,
};
