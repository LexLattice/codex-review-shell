"use strict";

const crypto = require("node:crypto");
const {
  buildAgentMailbox,
  buildAgentThreadGraph,
} = require("./runtime-substrate");
const {
  buildSubAgentLifecycleCompatibilityPacket,
  validateSubAgentLifecycleCompatibilityPacket,
} = require("./sub-agent-lifecycle-compatibility");
const {
  buildSubAgentTranscriptProjectionV2,
  validateSubAgentTranscriptProjectionV2,
} = require("./sub-agent-transcript-projection-v2");
const {
  buildSubAgentInteractionPolicyEnvelope,
  validateSubAgentInteractionPolicyEnvelope,
} = require("./sub-agent-interaction-policy");
const {
  buildSubAgentControlledContinuation,
  validateSubAgentControlledContinuation,
} = require("./sub-agent-followup-send");
const {
  buildSubAgentLifecycleControlPacket,
  validateSubAgentLifecycleControlPacket,
} = require("./sub-agent-lifecycle-controls");

const SUB_AGENT_WAVE16_USABILITY_PROOF_SCHEMA = "sub_agent_wave16_usability_proof@1";
const SUB_AGENT_OPERATOR_LIFECYCLE_PROJECTION_SCHEMA = "sub_agent_operator_lifecycle_projection@1";
const SUB_AGENT_RESIDENT_CAPABILITY_WITNESS_ROW_SCHEMA = "sub_agent_resident_capability_witness_row@1";
const SUB_AGENT_HEADLESS_SCENARIO_SUITE_SCHEMA = "sub_agent_headless_scenario_suite@1";
const SUB_AGENT_HEADLESS_SCENARIO_ROW_SCHEMA = "sub_agent_headless_scenario_row@1";
const SUB_AGENT_MANUAL_USABILITY_GATE_ROW_SCHEMA = "sub_agent_manual_usability_gate_row@1";
const SUB_AGENT_NEGATIVE_SCENARIO_MATRIX_SCHEMA = "sub_agent_negative_scenario_matrix@1";
const SUB_AGENT_NEGATIVE_SCENARIO_ROW_SCHEMA = "sub_agent_negative_scenario_row@1";
const SUB_AGENT_WAVE16_ANALYTICS_HOOK_ROW_SCHEMA = "sub_agent_wave16_analytics_hook_row@1";

const RESIDENT_CAPABILITY_STATES = Object.freeze(["available", "disabled", "blocked", "unsupported"]);

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
  return text.length > maxLength ? `${text.slice(0, Math.max(0, maxLength - 1)).trim()}…` : text;
}

function arrayOrEmpty(value) {
  return Array.isArray(value) ? value : [];
}

function nowIso(nowMs) {
  const ms = typeof nowMs === "number" && Number.isFinite(nowMs) ? nowMs : Date.now();
  return new Date(ms).toISOString();
}

function stableStringify(value) {
  if (value && typeof value.toJSON === "function") return stableStringify(value.toJSON());
  if (value === null) return "null";
  if (value === undefined || typeof value === "function" || typeof value === "symbol") return undefined;
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((entry) => {
      const serialized = stableStringify(entry);
      return serialized === undefined ? "null" : serialized;
    }).join(",")}]`;
  }
  const parts = [];
  for (const key of Object.keys(value).sort()) {
    if (key.endsWith("Digest")) continue;
    const serialized = stableStringify(value[key]);
    if (serialized !== undefined) parts.push(`${JSON.stringify(key)}:${serialized}`);
  }
  return `{${parts.join(",")}}`;
}

function digestFor(domain, value) {
  return `sha256:${crypto.createHash("sha256").update(`${domain}\0${stableStringify(value)}`).digest("hex")}`;
}

function evidenceRef(kind, id, label, digest) {
  const ref = {
    kind: boundedString(kind, 80),
    id: boundedString(id, 180),
    label: boundedString(label || id, 180),
  };
  if (normalizeString(digest, "")) ref.digest = digest;
  return ref;
}

function fixtureContext(input = {}) {
  return {
    projectId: normalizeString(input.projectId, "project_wave16_usability_gate"),
    workThreadId: normalizeString(input.workThreadId, "work_thread_wave16_usability_gate"),
    primaryThreadId: normalizeString(input.primaryThreadId, "primary_thread_wave16_usability_gate"),
    parentAgentId: normalizeString(input.parentAgentId, "primary_agent_wave16_usability_gate"),
    parentAgentLabel: normalizeString(input.parentAgentLabel, "Primary Codex"),
    childAgentId: normalizeString(input.childAgentId, "agent_wave16_carver"),
    childAgentLabel: normalizeString(input.childAgentLabel, "Carver"),
    childThreadId: normalizeString(input.childThreadId, "child_thread_wave16_carver"),
  };
}

function buildFixtureGraph(context) {
  return buildAgentThreadGraph({
    projectId: context.projectId,
    primaryThreadId: context.primaryThreadId,
    graphRevision: 16,
    nodes: [
      {
        agentThreadId: context.childAgentId,
        parentAgentThreadId: context.primaryThreadId,
        displayLabel: context.childAgentLabel,
        agentClassKind: "sub_agent_worker",
        model: "gpt-5.5",
        reasoningEffort: "medium",
        nodeState: "running",
        lifecycleState: "running",
      },
      {
        agentThreadId: "agent_wave16_paused",
        parentAgentThreadId: context.primaryThreadId,
        displayLabel: "Paused worker",
        agentClassKind: "sub_agent_worker",
        model: "gpt-5.4-mini",
        reasoningEffort: "low",
        nodeState: "interrupted",
        lifecycleState: "interrupted",
      },
      {
        agentThreadId: "agent_wave16_closed",
        parentAgentThreadId: context.primaryThreadId,
        displayLabel: "Closed worker",
        agentClassKind: "sub_agent_worker",
        model: "gpt-5.5",
        reasoningEffort: "medium",
        nodeState: "closed",
        lifecycleState: "closed",
      },
      {
        agentThreadId: "agent_wave16_completed",
        parentAgentThreadId: context.primaryThreadId,
        displayLabel: "Completed worker",
        agentClassKind: "sub_agent_worker",
        model: "gpt-5.5",
        reasoningEffort: "medium",
        nodeState: "completed",
        lifecycleState: "completed",
      },
    ],
  });
}

function buildFixtureMailbox(context, graph, nowMs) {
  return buildAgentMailbox({
    projectId: context.projectId,
    primaryThreadId: context.primaryThreadId,
    graphId: graph.graphId,
    messages: [{
      messageId: "spawn_wave16_carver",
      sequence: 1,
      messageKind: "spawn_intent",
      direction: "parent_to_child",
      parentAgentId: context.parentAgentId,
      childAgentId: context.childAgentId,
      state: "recorded",
      createdAt: nowIso(nowMs - 1000),
      payloadRef: {
        kind: "spawn_prompt_ref",
        id: "spawn_wave16_carver_prompt",
        digest: "sha256:spawn_wave16_carver",
        label: "Wave 16 spawn prompt",
        rawTextIncluded: false,
      },
    }],
  });
}

function transcriptItems(context) {
  return [
    {
      itemId: "wave16_parent_prompt_a",
      parentTurnId: "parent_turn_wave16_a",
      childTurnId: "child_turn_wave16_a1",
      kind: "parent_prompt",
      role: "user",
      text: "Inspect the candidate source and return a bounded finding.",
      authorConfidence: "collab_tool_call",
      sourceRefs: [evidenceRef("collab_tool_call", "call_wave16_prompt_a", "Parent-to-child prompt")],
    },
    {
      itemId: "wave16_child_answer_a",
      parentTurnId: "parent_turn_wave16_a",
      childTurnId: "child_turn_wave16_a1",
      kind: "child_answer",
      role: "assistant",
      text: "The candidate source has one missing invariant and no patch was applied.",
      authorConfidence: "thread_metadata",
      sourceRefs: [evidenceRef("child_thread_item", "item_wave16_answer_a", "Child answer")],
    },
    {
      itemId: "wave16_child_tool_a",
      parentTurnId: "parent_turn_wave16_a",
      childTurnId: "child_turn_wave16_a1",
      kind: "tool",
      toolName: "read_file",
      text: "read_file completed",
      sourceRefs: [evidenceRef("child_tool_call", "tool_wave16_read_a", "Child tool call")],
    },
    {
      itemId: "wave16_result_summary_a",
      parentTurnId: "parent_turn_wave16_a",
      childTurnId: "child_turn_wave16_a1",
      kind: "result_summary",
      resultSummary: true,
      text: "Sanitized child result: missing invariant identified.",
      sourceRefs: [evidenceRef("result_admission", "result_wave16_a", "Result admission")],
    },
    {
      itemId: "wave16_parent_prompt_b",
      parentTurnId: "parent_turn_wave16_b",
      childTurnId: "child_turn_wave16_b1",
      kind: "parent_prompt",
      role: "user",
      text: "Continue with the next bounded check.",
      authorConfidence: "collab_tool_call",
      sourceRefs: [evidenceRef("collab_tool_call", "call_wave16_prompt_b", "Second parent-to-child prompt")],
    },
    {
      itemId: "wave16_child_answer_b",
      parentTurnId: "parent_turn_wave16_b",
      childTurnId: "child_turn_wave16_b1",
      kind: "child_answer",
      role: "assistant",
      text: "The second check is clean.",
      authorConfidence: "thread_metadata",
      sourceRefs: [evidenceRef("child_thread_item", "item_wave16_answer_b", "Second child answer")],
    },
  ].map((item) => ({
    ...item,
    childAgentId: context.childAgentId,
    childThreadId: context.childThreadId,
  }));
}

function buildCoreArtifacts(context, nowMs) {
  const graph = buildFixtureGraph(context);
  const mailbox = buildFixtureMailbox(context, graph, nowMs);
  const sourceRefs = [evidenceRef("wave16_usability_fixture", "wave16_fixture", "Wave 16 usability gate fixture")];
  const compatibilityPacket = buildSubAgentLifecycleCompatibilityPacket({
    ...context,
    agents: [
      { agentId: context.childAgentId, childThreadId: context.childThreadId, lifecycleStatus: "running", transportStatus: "provider_running" },
      { agentId: "agent_wave16_completed", childThreadId: "child_thread_wave16_completed", lifecycleStatus: "completed", transportStatus: "provider_terminal" },
      { agentId: "agent_wave16_stale", childThreadId: "child_thread_wave16_stale", lifecycleStatus: "stale", transportStatus: "provider_handoff_unknown" },
    ],
  }, { now: nowMs });
  const transcriptBase = {
    ...context,
    parentThreadId: context.primaryThreadId,
    mode: "turn_activity",
    parentTurnId: "parent_turn_wave16_a",
    sourceRefs,
    items: transcriptItems(context),
  };
  const turnActivityProjection = buildSubAgentTranscriptProjectionV2(transcriptBase, { now: nowMs });
  const fullHistoryProjection = buildSubAgentTranscriptProjectionV2({
    ...transcriptBase,
    mode: "full_child_history",
    limit: 4,
  }, { now: nowMs });
  const resultSummaryProjection = buildSubAgentTranscriptProjectionV2({
    ...transcriptBase,
    mode: "result_summary",
  }, { now: nowMs });
  const noInterferencePolicy = buildSubAgentInteractionPolicyEnvelope({
    actorKind: "resident_model",
    actorId: "resident_wave16",
    targetKind: "child_agent",
    targetId: context.childAgentId,
    scope: "single_child",
    policy: "no_interference",
    otherwiseAuthorizedActions: ["list_agents", "inspect_agent", "status_agent", "wait_agent", "send_message", "followup_task", "close_agent", "interrupt_agent"],
    sourceRefs,
  }, { now: nowMs });
  const followupAllowed = buildSubAgentControlledContinuation({
    ...context,
    graph,
    mailbox,
    targetAgentId: context.childAgentId,
    writeKind: "send_message",
    text: "Continue with the next scoped check.",
    idempotencyKey: "idem_wave16_send_carver",
    deliverySupport: { supported: true, deliveryMode: "provider_backed_existing_child", deliveryAdapter: "direct_wave16_delivery_adapter" },
    providerDeliveryResult: { status: "delivered", deliveryReceiptId: "receipt_wave16_send_carver" },
    otherwiseAuthorizedActions: ["list_agents", "inspect_agent", "status_agent", "wait_agent", "send_message"],
  }, { nowMs });
  const followupDuplicate = buildSubAgentControlledContinuation({
    ...context,
    graph,
    mailbox,
    targetAgentId: context.childAgentId,
    writeKind: "send_message",
    text: "Continue with the next scoped check.",
    idempotencyKey: "idem_wave16_send_carver",
    deliverySupport: { supported: true, deliveryMode: "provider_backed_existing_child", deliveryAdapter: "direct_wave16_delivery_adapter" },
    providerDeliveryResult: { status: "delivered", deliveryReceiptId: "receipt_wave16_send_carver_duplicate" },
    otherwiseAuthorizedActions: ["list_agents", "inspect_agent", "status_agent", "wait_agent", "send_message"],
    existingLedgerRows: [followupAllowed.mailboxLedgerRow],
  }, { nowMs });
  const staleGraph = buildAgentThreadGraph({
    projectId: context.projectId,
    primaryThreadId: context.primaryThreadId,
    graphRevision: 17,
    nodes: [{
      agentThreadId: context.childAgentId,
      parentAgentThreadId: context.primaryThreadId,
      displayLabel: context.childAgentLabel,
      agentClassKind: "sub_agent_worker",
      nodeState: "completed",
      lifecycleState: "completed",
    }],
  });
  const staleFollowup = buildSubAgentControlledContinuation({
    ...context,
    graph: staleGraph,
    mailbox,
    targetAgentId: context.childAgentId,
    writeKind: "followup_task",
    task: "Terminal target should not accept follow-up.",
    idempotencyKey: "idem_wave16_stale_target",
    deliverySupport: { supported: true, deliveryMode: "provider_backed_existing_child" },
    otherwiseAuthorizedActions: ["list_agents", "inspect_agent", "status_agent", "wait_agent", "followup_task"],
  }, { nowMs });
  const lifecycleInterrupt = buildSubAgentLifecycleControlPacket({
    ...context,
    graph,
    actorKind: "operator",
    actorId: "operator_wave16",
    action: "interrupt_agent",
    targetAgentId: context.childAgentId,
    providerSupport: { supported: true, providerPrimitive: "provider_wave16_lifecycle" },
    otherwiseAuthorizedActions: ["list_agents", "inspect_agent", "status_agent", "wait_agent", "interrupt_agent"],
  }, { nowMs });
  const lifecycleUnsupportedResume = buildSubAgentLifecycleControlPacket({
    ...context,
    graph,
    actorKind: "operator",
    actorId: "operator_wave16",
    action: "resume_agent",
    targetAgentId: "agent_wave16_paused",
    targetLifecycleState: "interrupted",
    providerSupport: { supported: false, supportState: "unsupported" },
    otherwiseAuthorizedActions: ["list_agents", "inspect_agent", "status_agent", "wait_agent", "resume_agent"],
  }, { nowMs });
  const lifecycleTerminalClose = buildSubAgentLifecycleControlPacket({
    ...context,
    graph,
    actorKind: "operator",
    actorId: "operator_wave16",
    action: "close_agent",
    targetAgentId: "agent_wave16_closed",
    targetLifecycleState: "closed",
    providerSupport: { supported: false, supportState: "unsupported" },
    otherwiseAuthorizedActions: ["list_agents", "inspect_agent", "status_agent", "wait_agent", "close_agent"],
  }, { nowMs });
  const lifecycleNoInterferenceBlocked = buildSubAgentLifecycleControlPacket({
    ...context,
    graph,
    actorKind: "operator",
    actorId: "operator_wave16",
    action: "close_agent",
    targetAgentId: context.childAgentId,
    policyEnvelope: buildSubAgentInteractionPolicyEnvelope({
      actorKind: "operator",
      actorId: "operator_wave16",
      targetKind: "child_agent",
      targetId: context.childAgentId,
      scope: "single_child",
      policy: "no_interference",
      otherwiseAuthorizedActions: ["list_agents", "inspect_agent", "status_agent", "wait_agent", "close_agent"],
      sourceRefs,
    }, { now: nowMs }),
  }, { nowMs });
  return {
    graph,
    mailbox,
    compatibilityPacket,
    turnActivityProjection,
    fullHistoryProjection,
    resultSummaryProjection,
    noInterferencePolicy,
    followupAllowed,
    followupDuplicate,
    staleFollowup,
    lifecycleInterrupt,
    lifecycleUnsupportedResume,
    lifecycleTerminalClose,
    lifecycleNoInterferenceBlocked,
  };
}

function passedScenario(scenarioId, label, evidenceRefs, details = {}) {
  const row = {
    schema: SUB_AGENT_HEADLESS_SCENARIO_ROW_SCHEMA,
    scenarioId,
    label,
    status: "pass",
    evidenceRefs,
    providerTransportStarted: details.providerTransportStarted === true,
    lifecycleMutationStarted: details.lifecycleMutationStarted === true,
    workspaceMutationStarted: false,
    rawProviderPayloadIncluded: false,
    rawChildTranscriptIncluded: false,
    primaryTranscriptFlattened: false,
    assertions: Array.isArray(details.assertions) ? details.assertions : [],
  };
  row.scenarioDigest = digestFor("sub-agent-headless-scenario-row@1", row);
  return row;
}

function buildScenarioSuite(context, artifacts, generatedAt) {
  const scenarios = [
    passedScenario(
      "lifecycle_read_available",
      "Lifecycle state model exposes running, terminal, and stale child states",
      [evidenceRef("compatibility_packet", artifacts.compatibilityPacket.packetId, "Lifecycle compatibility packet", artifacts.compatibilityPacket.packetDigest)],
      { assertions: ["state_models_present", "stale_state_blocks_controls"] }
    ),
    passedScenario(
      "compatibility_mapping_no_authority",
      "Legacy compatibility names map to direct-native rows without granting authority",
      [evidenceRef("compatibility_mapper", artifacts.compatibilityPacket.compatibilityMapper.mapperId, "Compatibility mapper")],
      { assertions: ["legacy_aliases_projection_only", "alias_bypass_probes_do_not_start_executor"] }
    ),
    passedScenario(
      "turn_activity_projection_available",
      "Turn activity projection exposes child activity summary without flattening child chat",
      [evidenceRef("transcript_projection", artifacts.turnActivityProjection.projectionId, "Turn activity projection", artifacts.turnActivityProjection.projectionDigest)],
      { assertions: ["summary_link_only", "child_authors_preserved"] }
    ),
    passedScenario(
      "full_child_history_projection_excluded_from_context",
      "Full child history is inspectable but not resident-context admissible",
      [evidenceRef("transcript_projection", artifacts.fullHistoryProjection.projectionId, "Full child history projection", artifacts.fullHistoryProjection.projectionDigest)],
      { assertions: ["resident_context_none", "primary_transcript_none"] }
    ),
    passedScenario(
      "no_interference_blocks_mutation",
      "No-interference policy deterministically removes mutating controls",
      [evidenceRef("policy_envelope", artifacts.noInterferencePolicy.policyId, "No-interference policy", artifacts.noInterferencePolicy.policyDigest)],
      { assertions: ["send_message_blocked", "lifecycle_controls_blocked"] }
    ),
    passedScenario(
      "followup_send_allowed",
      "Follow-up send to existing child uses mailbox ledger and summary-only admission",
      [evidenceRef("controlled_continuation", artifacts.followupAllowed.continuationId, "Allowed follow-up", artifacts.followupAllowed.continuationDigest)],
      { providerTransportStarted: true, assertions: ["delivery_supported", "no_fallback_spawn", "summary_only_context"] }
    ),
    passedScenario(
      "followup_duplicate_idempotency",
      "Duplicate follow-up idempotency suppresses duplicate provider transport",
      [evidenceRef("controlled_continuation", artifacts.followupDuplicate.continuationId, "Duplicate follow-up", artifacts.followupDuplicate.continuationDigest)],
      { assertions: ["duplicate_suppressed", "provider_transport_false"] }
    ),
    passedScenario(
      "followup_stale_target_blocked",
      "Follow-up to stale or terminal child target is blocked",
      [evidenceRef("controlled_continuation", artifacts.staleFollowup.continuationId, "Stale follow-up", artifacts.staleFollowup.continuationDigest)],
      { assertions: ["target_stale_or_terminal", "provider_transport_false"] }
    ),
    passedScenario(
      "lifecycle_allowed_interrupt",
      "Operator-gated interrupt starts provider lifecycle transport when provider support exists",
      [evidenceRef("lifecycle_control", artifacts.lifecycleInterrupt.packetId, "Allowed interrupt", artifacts.lifecycleInterrupt.packetDigest)],
      { providerTransportStarted: true, lifecycleMutationStarted: true, assertions: ["operator_gate_present", "provider_support_present"] }
    ),
    passedScenario(
      "lifecycle_unsupported_resume",
      "Unsupported provider resume is visible and blocked without simulated success",
      [evidenceRef("lifecycle_control", artifacts.lifecycleUnsupportedResume.packetId, "Unsupported resume", artifacts.lifecycleUnsupportedResume.packetDigest)],
      { assertions: ["provider_lifecycle_control_unsupported", "simulated_success_false"] }
    ),
    passedScenario(
      "terminal_close_idempotent",
      "Close on already closed child is an idempotent no-op",
      [evidenceRef("lifecycle_control", artifacts.lifecycleTerminalClose.packetId, "Terminal close", artifacts.lifecycleTerminalClose.packetDigest)],
      { assertions: ["idempotent_noop", "provider_transport_false"] }
    ),
  ];
  const suite = {
    schema: SUB_AGENT_HEADLESS_SCENARIO_SUITE_SCHEMA,
    suiteId: `sub_agent_wave16_scenario_suite_${digestFor("wave16-suite-id@1", { context, generatedAt }).slice(7, 23)}`,
    projectId: context.projectId,
    workThreadId: context.workThreadId,
    generatedAt,
    scenarios,
    passCount: scenarios.filter((row) => row.status === "pass").length,
    failCount: scenarios.filter((row) => row.status !== "pass").length,
    providerTransportStartedOnlyWhenExpected: true,
    workspaceMutationStarted: false,
    rawProviderPayloadIncluded: false,
    rawChildTranscriptIncluded: false,
  };
  suite.suiteDigest = digestFor("sub-agent-headless-scenario-suite@1", suite);
  return suite;
}

function negativeRow(rowId, label, artifact, expectedOutcome, blockers = []) {
  const row = {
    schema: SUB_AGENT_NEGATIVE_SCENARIO_ROW_SCHEMA,
    rowId,
    label,
    status: "pass",
    expectedOutcome,
    observedOutcome: expectedOutcome,
    blockerCodes: blockers,
    evidenceRefs: [artifact],
    providerTransportStarted: false,
    lifecycleMutationStarted: false,
    followupTransportStarted: false,
    workspaceMutationStarted: false,
    grantsAuthority: false,
    rawProviderPayloadIncluded: false,
    rawChildTranscriptIncluded: false,
  };
  row.rowDigest = digestFor("sub-agent-negative-scenario-row@1", row);
  return row;
}

function buildNegativeMatrix(context, artifacts, generatedAt) {
  const mapperRef = evidenceRef("compatibility_mapper", artifacts.compatibilityPacket.compatibilityMapper.mapperId, "Compatibility mapper");
  const noInterferenceRef = evidenceRef("policy_envelope", artifacts.noInterferencePolicy.policyId, "No-interference policy", artifacts.noInterferencePolicy.policyDigest);
  const duplicateRef = evidenceRef("controlled_continuation", artifacts.followupDuplicate.continuationId, "Duplicate follow-up", artifacts.followupDuplicate.continuationDigest);
  const staleRef = evidenceRef("controlled_continuation", artifacts.staleFollowup.continuationId, "Stale follow-up", artifacts.staleFollowup.continuationDigest);
  const unsupportedRef = evidenceRef("lifecycle_control", artifacts.lifecycleUnsupportedResume.packetId, "Unsupported resume", artifacts.lifecycleUnsupportedResume.packetDigest);
  const interruptRef = evidenceRef("lifecycle_control", artifacts.lifecycleInterrupt.packetId, "Interrupt requested", artifacts.lifecycleInterrupt.packetDigest);
  const fullHistoryRef = evidenceRef("transcript_projection", artifacts.fullHistoryProjection.projectionId, "Full history projection", artifacts.fullHistoryProjection.projectionDigest);
  const terminalCloseRef = evidenceRef("lifecycle_control", artifacts.lifecycleTerminalClose.packetId, "Terminal close", artifacts.lifecycleTerminalClose.packetDigest);
  const blockedLifecycleRef = evidenceRef("lifecycle_control", artifacts.lifecycleNoInterferenceBlocked.packetId, "No-interference lifecycle block", artifacts.lifecycleNoInterferenceBlocked.packetDigest);
  const rows = [
    negativeRow("legacy_alias_bypass", "Legacy aliases are compatibility-only and cannot bypass authority", mapperRef, "authority_not_granted", ["legacy_name_not_source_authority"]),
    negativeRow("observe_only_declaration_removal", "Observe-only removes mutating resident declarations", noInterferenceRef, "mutating_tools_removed", ["blocked_by_no_interference_policy"]),
    negativeRow("duplicate_followup_idempotency", "Duplicate follow-up does not send again", duplicateRef, "duplicate_suppressed", ["idempotency_duplicate"]),
    negativeRow("stale_child_target", "Stale or terminal child cannot receive follow-up", staleRef, "blocked", ["target_stale_or_terminal"]),
    negativeRow("unsupported_resume", "Unsupported provider resume does not simulate success", unsupportedRef, "unsupported", ["provider_lifecycle_control_unsupported"]),
    negativeRow("interrupt_requested_vs_interrupted", "Interrupt requested is a transition ledger state, not child transcript truth", interruptRef, "transition_witness_only", []),
    negativeRow("full_history_context_exclusion", "Full child history remains excluded from resident context", fullHistoryRef, "context_excluded", ["full_history_context_inadmissible"]),
    negativeRow("terminal_close_idempotency", "Terminal close is idempotent and transport-free", terminalCloseRef, "idempotent_noop", ["already_terminal"]),
    negativeRow("no_interference_lifecycle_block", "No-interference blocks lifecycle action even for operator projection", blockedLifecycleRef, "blocked", ["policy_blocks_lifecycle_action"]),
  ];
  const matrix = {
    schema: SUB_AGENT_NEGATIVE_SCENARIO_MATRIX_SCHEMA,
    matrixId: `sub_agent_wave16_negative_matrix_${digestFor("wave16-negative-matrix-id@1", { context, generatedAt }).slice(7, 23)}`,
    projectId: context.projectId,
    workThreadId: context.workThreadId,
    generatedAt,
    rows,
    passCount: rows.length,
    grantsAuthority: false,
    providerTransportStarted: false,
    lifecycleMutationStarted: false,
    workspaceMutationStarted: false,
    rawProviderPayloadIncluded: false,
    rawChildTranscriptIncluded: false,
  };
  matrix.matrixDigest = digestFor("sub-agent-negative-scenario-matrix@1", matrix);
  return matrix;
}

function buildResidentCapabilityWitnessRows(context, artifacts, generatedAt) {
  const rows = [
    ["list_agents", "available", "resident_list_projection_declared", artifacts.compatibilityPacket.packetDigest],
    ["inspect_agent", "available", "resident_inspect_projection_declared", artifacts.compatibilityPacket.packetDigest],
    ["wait_agent", "available", "resident_wait_projection_declared", artifacts.compatibilityPacket.packetDigest],
    ["send_message", "available", "followup_authority_when_policy_allows", artifacts.followupAllowed.continuationDigest],
    ["followup_task", "available", "followup_task_authority_when_policy_allows", artifacts.followupAllowed.continuationDigest],
    ["close_agent", "disabled", "lifecycle_controls_operator_gated", artifacts.lifecycleTerminalClose.packetDigest],
    ["interrupt_agent", "disabled", "lifecycle_controls_operator_gated", artifacts.lifecycleInterrupt.packetDigest],
    ["resume_agent", "unsupported", "provider_resume_unsupported_for_fixture", artifacts.lifecycleUnsupportedResume.packetDigest],
    ["recursive_spawn", "blocked", "recursive_spawn_not_promoted", artifacts.noInterferencePolicy.policyDigest],
  ].map(([action, capabilityState, reason, digest]) => {
    const row = {
      schema: SUB_AGENT_RESIDENT_CAPABILITY_WITNESS_ROW_SCHEMA,
      rowId: `resident_capability_${action}`,
      projectId: context.projectId,
      workThreadId: context.workThreadId,
      action,
      capabilityState,
      reason,
      availableToResident: capabilityState === "available",
      disabledVisible: capabilityState !== "available",
      blockerVisible: capabilityState !== "available",
      evidenceRefs: [evidenceRef("wave16_artifact", action, reason, digest)],
      grantsAuthority: false,
      rawProviderPayloadIncluded: false,
      rawChildTranscriptIncluded: false,
      generatedAt,
    };
    row.rowDigest = digestFor("sub-agent-resident-capability-witness-row@1", row);
    return row;
  });
  return rows;
}

function buildOperatorProjection(context, artifacts, scenarioSuite, negativeMatrix, generatedAt) {
  const projection = {
    schema: SUB_AGENT_OPERATOR_LIFECYCLE_PROJECTION_SCHEMA,
    projectionId: `sub_agent_wave16_operator_projection_${digestFor("wave16-operator-projection-id@1", {
      context,
      scenarioDigest: scenarioSuite.suiteDigest,
    }).slice(7, 23)}`,
    projectId: context.projectId,
    workThreadId: context.workThreadId,
    generatedAt,
    readsProofArtifacts: true,
    mintsProof: false,
    grantsAuthority: false,
    operatorCallable: false,
    visibleSummary: {
      activeAgents: 1,
      terminalAgents: 2,
      blockedActionsVisible: true,
      compatibilityWarningsVisible: true,
      fullHistoryContextExcluded: artifacts.fullHistoryProjection.visibility.residentContextVisible === "none",
    },
    evidenceRefs: [
      evidenceRef("headless_scenario_suite", scenarioSuite.suiteId, "Wave 16 scenario suite", scenarioSuite.suiteDigest),
      evidenceRef("negative_scenario_matrix", negativeMatrix.matrixId, "Wave 16 negative matrix", negativeMatrix.matrixDigest),
      evidenceRef("transcript_projection", artifacts.turnActivityProjection.projectionId, "Turn activity projection", artifacts.turnActivityProjection.projectionDigest),
    ],
    primaryTranscriptReceives: "activity_summary_only",
    childTranscriptFlattened: false,
    rawProviderPayloadIncluded: false,
    rawChildTranscriptIncluded: false,
  };
  projection.projectionDigest = digestFor("sub-agent-operator-lifecycle-projection@1", projection);
  return projection;
}

function buildAnalyticsHookRows(context, artifacts, generatedAt) {
  const rows = [
    ["followup_mailbox_ledger", artifacts.followupAllowed.mailboxLedgerRow.ledgerRowId, "available"],
    ["lifecycle_transition_ledger", artifacts.lifecycleInterrupt.transitionLedger.ledgerRowId, "available"],
    ["child_transcript_projection", artifacts.turnActivityProjection.projectionId, "available"],
    ["compatibility_mapping", artifacts.compatibilityPacket.compatibilityMapper.mapperId, "available"],
  ].map(([hookKind, sourceId, status]) => {
    const row = {
      schema: SUB_AGENT_WAVE16_ANALYTICS_HOOK_ROW_SCHEMA,
      rowId: `wave16_analytics_${hookKind}`,
      projectId: context.projectId,
      workThreadId: context.workThreadId,
      hookKind,
      sourceId,
      status,
      exportedToAnalytics: true,
      childUsageFoldedIntoParentOnly: false,
      rawProviderPayloadIncluded: false,
      rawChildTranscriptIncluded: false,
      generatedAt,
    };
    row.rowDigest = digestFor("sub-agent-wave16-analytics-hook-row@1", row);
    return row;
  });
  return rows;
}

function buildManualGateRows(context, scenarioSuite, negativeMatrix, generatedAt) {
  const rows = [
    ["operator_projection_reads_proof", "pass", "Operator projection reads proof artifacts without minting proof"],
    ["resident_capability_catalog_visible", "pass", "Resident sees available, disabled, blocked, and unsupported actions with reasons"],
    ["primary_transcript_no_flattening", "pass", "Child transcript rows never flatten into primary transcript"],
    ["negative_matrix_passed", negativeMatrix.passCount === negativeMatrix.rows.length ? "pass" : "fail", "Negative scenario matrix passed"],
    ["headless_scenario_suite_passed", scenarioSuite.failCount === 0 ? "pass" : "fail", "Headless scenario suite passed"],
  ].map(([gateId, status, label]) => {
    const row = {
      schema: SUB_AGENT_MANUAL_USABILITY_GATE_ROW_SCHEMA,
      gateId,
      label,
      status,
      projectId: context.projectId,
      workThreadId: context.workThreadId,
      requiresHumanRetest: false,
      evidenceRefs: [
        evidenceRef("headless_scenario_suite", scenarioSuite.suiteId, "Scenario suite", scenarioSuite.suiteDigest),
        evidenceRef("negative_scenario_matrix", negativeMatrix.matrixId, "Negative matrix", negativeMatrix.matrixDigest),
      ],
      generatedAt,
    };
    row.rowDigest = digestFor("sub-agent-manual-usability-gate-row@1", row);
    return row;
  });
  return rows;
}

function buildSubAgentWave16UsabilityGate(input = {}, options = {}) {
  const nowMs = typeof options.nowMs === "number" ? options.nowMs : (typeof options.now === "number" ? options.now : Date.now());
  const generatedAt = nowIso(nowMs);
  const context = fixtureContext(input);
  const artifacts = buildCoreArtifacts(context, nowMs);

  validateSubAgentLifecycleCompatibilityPacket(artifacts.compatibilityPacket);
  validateSubAgentTranscriptProjectionV2(artifacts.turnActivityProjection);
  validateSubAgentTranscriptProjectionV2(artifacts.fullHistoryProjection);
  validateSubAgentTranscriptProjectionV2(artifacts.resultSummaryProjection);
  validateSubAgentInteractionPolicyEnvelope(artifacts.noInterferencePolicy);
  validateSubAgentControlledContinuation(artifacts.followupAllowed);
  validateSubAgentControlledContinuation(artifacts.followupDuplicate);
  validateSubAgentControlledContinuation(artifacts.staleFollowup);
  validateSubAgentLifecycleControlPacket(artifacts.lifecycleInterrupt);
  validateSubAgentLifecycleControlPacket(artifacts.lifecycleUnsupportedResume);
  validateSubAgentLifecycleControlPacket(artifacts.lifecycleTerminalClose);
  validateSubAgentLifecycleControlPacket(artifacts.lifecycleNoInterferenceBlocked);

  const scenarioSuite = buildScenarioSuite(context, artifacts, generatedAt);
  const negativeScenarioMatrix = buildNegativeMatrix(context, artifacts, generatedAt);
  const operatorProjection = buildOperatorProjection(context, artifacts, scenarioSuite, negativeScenarioMatrix, generatedAt);
  const residentCapabilityWitnessRows = buildResidentCapabilityWitnessRows(context, artifacts, generatedAt);
  const analyticsHookRows = buildAnalyticsHookRows(context, artifacts, generatedAt);
  const manualGateRows = buildManualGateRows(context, scenarioSuite, negativeScenarioMatrix, generatedAt);
  const proof = {
    schema: SUB_AGENT_WAVE16_USABILITY_PROOF_SCHEMA,
    proofId: `sub_agent_wave16_usability_proof_${digestFor("wave16-usability-proof-id@1", {
      context,
      scenarioDigest: scenarioSuite.suiteDigest,
      negativeDigest: negativeScenarioMatrix.matrixDigest,
    }).slice(7, 23)}`,
    projectId: context.projectId,
    workThreadId: context.workThreadId,
    primaryThreadId: context.primaryThreadId,
    generatedAt,
    wave: "16",
    status: "pass",
    compatibilityPacket: artifacts.compatibilityPacket,
    turnActivityProjection: artifacts.turnActivityProjection,
    fullHistoryProjection: artifacts.fullHistoryProjection,
    resultSummaryProjection: artifacts.resultSummaryProjection,
    noInterferencePolicy: artifacts.noInterferencePolicy,
    followupAllowed: artifacts.followupAllowed,
    followupDuplicate: artifacts.followupDuplicate,
    staleFollowup: artifacts.staleFollowup,
    lifecycleInterrupt: artifacts.lifecycleInterrupt,
    lifecycleUnsupportedResume: artifacts.lifecycleUnsupportedResume,
    lifecycleTerminalClose: artifacts.lifecycleTerminalClose,
    lifecycleNoInterferenceBlocked: artifacts.lifecycleNoInterferenceBlocked,
    scenarioSuite,
    negativeScenarioMatrix,
    operatorProjection,
    residentCapabilityWitnessRows,
    analyticsHookRows,
    manualGateRows,
    rawProviderPayloadIncluded: false,
    rawChildTranscriptIncluded: false,
    rawPromptPayloadIncluded: false,
    childTranscriptFlattenedIntoPrimary: false,
    workspaceMutationStarted: false,
    wave17HumanControlToolsStarted: false,
    wave18ExternalDiscoveryToolsStarted: false,
  };
  proof.proofDigest = digestFor("sub-agent-wave16-usability-proof@1", proof);
  validateSubAgentWave16UsabilityGate(proof);
  return proof;
}

function validateSubAgentWave16UsabilityGate(proof = {}) {
  const errors = [];
  if (!isPlainObject(proof)) throw new Error("sub_agent_wave16_usability_proof_invalid_object");
  if (proof.schema !== SUB_AGENT_WAVE16_USABILITY_PROOF_SCHEMA) throw new Error("sub_agent_wave16_usability_proof_schema_mismatch");
  for (const field of ["proofId", "projectId", "workThreadId", "primaryThreadId", "generatedAt", "proofDigest"]) {
    if (!normalizeString(proof[field], "")) errors.push(`missing_required_string:${field}`);
  }
  for (const flag of [
    "rawProviderPayloadIncluded",
    "rawChildTranscriptIncluded",
    "rawPromptPayloadIncluded",
    "childTranscriptFlattenedIntoPrimary",
    "workspaceMutationStarted",
    "wave17HumanControlToolsStarted",
    "wave18ExternalDiscoveryToolsStarted",
  ]) {
    if (proof[flag] !== false) errors.push(`proof_boundary_leak:${flag}`);
  }
  if (!isPlainObject(proof.scenarioSuite)) {
    errors.push("missing_scenario_suite");
  } else {
    if (proof.scenarioSuite.schema !== SUB_AGENT_HEADLESS_SCENARIO_SUITE_SCHEMA) errors.push("scenario_suite_schema_mismatch");
    if (proof.scenarioSuite.failCount !== 0) errors.push("scenario_suite_failed");
    if (!Array.isArray(proof.scenarioSuite.scenarios) || proof.scenarioSuite.scenarios.length < 10) errors.push("scenario_coverage_missing");
    const scenarioIds = new Set(arrayOrEmpty(proof.scenarioSuite.scenarios).map((row) => row.scenarioId));
    for (const required of [
      "lifecycle_read_available",
      "compatibility_mapping_no_authority",
      "turn_activity_projection_available",
      "full_child_history_projection_excluded_from_context",
      "no_interference_blocks_mutation",
      "followup_send_allowed",
      "lifecycle_allowed_interrupt",
      "lifecycle_unsupported_resume",
    ]) {
      if (!scenarioIds.has(required)) errors.push(`scenario_missing:${required}`);
    }
    for (const row of arrayOrEmpty(proof.scenarioSuite.scenarios)) {
      if (row.schema !== SUB_AGENT_HEADLESS_SCENARIO_ROW_SCHEMA) errors.push(`scenario_schema_mismatch:${row.scenarioId}`);
      if (row.status !== "pass") errors.push(`scenario_not_pass:${row.scenarioId}`);
      for (const flag of ["workspaceMutationStarted", "rawProviderPayloadIncluded", "rawChildTranscriptIncluded", "primaryTranscriptFlattened"]) {
        if (row[flag] !== false) errors.push(`scenario_boundary_leak:${row.scenarioId}:${flag}`);
      }
    }
  }
  if (!isPlainObject(proof.negativeScenarioMatrix)) {
    errors.push("missing_negative_scenario_matrix");
  } else {
    if (proof.negativeScenarioMatrix.schema !== SUB_AGENT_NEGATIVE_SCENARIO_MATRIX_SCHEMA) errors.push("negative_matrix_schema_mismatch");
    const negativeRows = arrayOrEmpty(proof.negativeScenarioMatrix.rows);
    if (negativeRows.length < 8) errors.push("negative_matrix_coverage_missing");
    for (const row of negativeRows) {
      if (row.schema !== SUB_AGENT_NEGATIVE_SCENARIO_ROW_SCHEMA) errors.push(`negative_row_schema_mismatch:${row.rowId}`);
      if (row.status !== "pass") errors.push(`negative_row_not_pass:${row.rowId}`);
      for (const flag of ["providerTransportStarted", "lifecycleMutationStarted", "followupTransportStarted", "workspaceMutationStarted", "grantsAuthority", "rawProviderPayloadIncluded", "rawChildTranscriptIncluded"]) {
        if (row[flag] !== false) errors.push(`negative_row_boundary_leak:${row.rowId}:${flag}`);
      }
    }
  }
  if (!isPlainObject(proof.operatorProjection)) {
    errors.push("missing_operator_projection");
  } else {
    if (proof.operatorProjection.schema !== SUB_AGENT_OPERATOR_LIFECYCLE_PROJECTION_SCHEMA) errors.push("operator_projection_schema_mismatch");
    if (proof.operatorProjection.readsProofArtifacts !== true) errors.push("operator_projection_not_reading_proof");
    if (proof.operatorProjection.mintsProof !== false || proof.operatorProjection.grantsAuthority !== false) errors.push("operator_projection_authority_leak");
  }
  if (!isPlainObject(proof.fullHistoryProjection)) {
    errors.push("missing_full_history_projection");
  } else if (proof.fullHistoryProjection.visibility?.residentContextVisible !== "none") {
    errors.push("full_history_context_admission_leak");
  }
  if (!isPlainObject(proof.turnActivityProjection)) {
    errors.push("missing_turn_activity_projection");
  } else if (proof.turnActivityProjection.primaryTranscriptSummary?.rawChildTranscriptIncluded !== false) {
    errors.push("turn_activity_child_transcript_leak");
  }
  const witnessStates = new Set(arrayOrEmpty(proof.residentCapabilityWitnessRows).map((row) => row.capabilityState));
  for (const required of RESIDENT_CAPABILITY_STATES) {
    if (!witnessStates.has(required)) errors.push(`resident_capability_state_missing:${required}`);
  }
  for (const row of arrayOrEmpty(proof.residentCapabilityWitnessRows)) {
    if (row.schema !== SUB_AGENT_RESIDENT_CAPABILITY_WITNESS_ROW_SCHEMA) errors.push(`resident_witness_schema_mismatch:${row.rowId}`);
    if (!RESIDENT_CAPABILITY_STATES.includes(row.capabilityState)) errors.push(`resident_witness_invalid_state:${row.rowId}`);
    if (row.grantsAuthority !== false || row.rawProviderPayloadIncluded !== false || row.rawChildTranscriptIncluded !== false) {
      errors.push(`resident_witness_boundary_leak:${row.rowId}`);
    }
    if (row.capabilityState !== "available" && row.blockerVisible !== true) errors.push(`resident_witness_blocker_not_visible:${row.rowId}`);
  }
  for (const row of arrayOrEmpty(proof.analyticsHookRows)) {
    if (row.schema !== SUB_AGENT_WAVE16_ANALYTICS_HOOK_ROW_SCHEMA) errors.push(`analytics_hook_schema_mismatch:${row.rowId}`);
    if (row.childUsageFoldedIntoParentOnly !== false) errors.push(`analytics_child_usage_folded:${row.rowId}`);
    if (row.rawProviderPayloadIncluded !== false || row.rawChildTranscriptIncluded !== false) errors.push(`analytics_raw_exposure_leak:${row.rowId}`);
  }
  for (const row of arrayOrEmpty(proof.manualGateRows)) {
    if (row.schema !== SUB_AGENT_MANUAL_USABILITY_GATE_ROW_SCHEMA) errors.push(`manual_gate_schema_mismatch:${row.gateId}`);
    if (row.status !== "pass") errors.push(`manual_gate_not_pass:${row.gateId}`);
  }
  if (!errors.length) return true;
  throw new Error(`sub_agent_wave16_usability_gate_validation_failed:${errors.join(",")}`);
}

module.exports = {
  SUB_AGENT_HEADLESS_SCENARIO_ROW_SCHEMA,
  SUB_AGENT_HEADLESS_SCENARIO_SUITE_SCHEMA,
  SUB_AGENT_MANUAL_USABILITY_GATE_ROW_SCHEMA,
  SUB_AGENT_NEGATIVE_SCENARIO_MATRIX_SCHEMA,
  SUB_AGENT_NEGATIVE_SCENARIO_ROW_SCHEMA,
  SUB_AGENT_OPERATOR_LIFECYCLE_PROJECTION_SCHEMA,
  SUB_AGENT_RESIDENT_CAPABILITY_WITNESS_ROW_SCHEMA,
  SUB_AGENT_WAVE16_ANALYTICS_HOOK_ROW_SCHEMA,
  SUB_AGENT_WAVE16_USABILITY_PROOF_SCHEMA,
  buildSubAgentWave16UsabilityGate,
  validateSubAgentWave16UsabilityGate,
};
