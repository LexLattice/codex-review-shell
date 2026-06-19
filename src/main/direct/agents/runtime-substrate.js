"use strict";

const crypto = require("node:crypto");

const DIRECT_AGENT_RUNTIME_REGISTRY_SCHEMA = "direct_agent_runtime_registry@1";
const DIRECT_AGENT_THREAD_GRAPH_SCHEMA = "direct_agent_thread_graph@1";
const DIRECT_AGENT_MAILBOX_SCHEMA = "direct_agent_mailbox@1";
const DIRECT_AGENT_LIFECYCLE_REGISTRY_SCHEMA = "direct_agent_lifecycle_registry@1";
const DIRECT_AGENT_CONTEXT_PACKET_FAMILY_SCHEMA = "direct_agent_context_packet_family@1";
const DIRECT_AGENT_AUTHORITY_BOUNDARY_SCHEMA = "direct_agent_authority_boundary@1";
const DIRECT_AGENT_SPAWN_PLAN_SCHEMA = "direct_agent_spawn_plan@1";
const DIRECT_AGENT_RUNTIME_RECOVERY_CLASSIFICATION_SCHEMA = "direct_agent_runtime_recovery_classification@1";
const DIRECT_AGENT_RUNTIME_SUBSTRATE_STATUS_SCHEMA = "direct_agent_runtime_substrate_status@1";

const AGENT_CLASS_KINDS = new Set([
  "primary_agent",
  "implementation_worker",
  "audit_worker",
  "fix_worker",
  "closeout_worker",
  "meta_orchestrator",
  "work_thread_broker",
  "memory_compaction_worker",
  "governance_broker",
  "sub_agent_worker",
]);
const AGENT_NODE_STATES = new Set(["planned", "created", "request_started", "running", "waiting", "completed", "failed", "timeout", "cancelled", "closed", "handoff_unknown", "recovery_required", "unknown"]);
const MAILBOX_MESSAGE_KINDS = new Set(["spawn_intent", "parent_prompt", "child_result", "followup", "wait_request", "interrupt_request", "status_update", "diagnostic"]);
const MAILBOX_DIRECTIONS = new Set(["parent_to_child", "child_to_parent", "runtime_to_parent", "operator_to_agent", "unknown"]);
const CONTEXT_PACKET_FAMILIES = new Set(["primary_agent_context", "text_only_child_context", "audit_worker_context", "implementation_worker_context", "diagnostic_only_context"]);
const RECOVERY_CLASSES = new Set(["child_created", "request_started", "result_pending", "handoff_unknown", "recovery_required", "terminal_known", "not_started", "unknown"]);

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

function finiteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function arrayOrEmpty(value) {
  return Array.isArray(value) ? value : [];
}

function stableStringify(value) {
  if (value && typeof value.toJSON === "function") return stableStringify(value.toJSON());
  if (value === null) return "null";
  const type = typeof value;
  if (type === "boolean" || type === "number" || type === "string") return JSON.stringify(value);
  if (type === "bigint" || type === "function" || type === "symbol" || type === "undefined") return undefined;
  if (Array.isArray(value)) {
    return `[${value.map((entry) => {
      const serialized = stableStringify(entry);
      return serialized === undefined ? "null" : serialized;
    }).join(",")}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => {
      const serialized = stableStringify(value[key]);
      return serialized === undefined ? "" : `${JSON.stringify(key)}:${serialized}`;
    })
    .filter(Boolean)
    .join(",")}}`;
}

function digestFor(domain, value) {
  return crypto.createHash("sha256").update(`${domain}:${stableStringify(value)}`).digest("hex");
}

function nowIso(nowMs) {
  const ms = typeof nowMs === "number" && Number.isFinite(nowMs) ? nowMs : Date.now();
  return new Date(ms).toISOString();
}

function normalizeEvidenceRef(input = {}, fallbackKind = "agent_runtime") {
  const source = isPlainObject(input) ? input : {};
  const ref = {
    kind: boundedString(source.kind || source.refKind || fallbackKind, 80),
    id: boundedString(source.id || source.refId || source.artifactId, 160),
    digest: boundedString(source.digest || source.artifactDigest || source.refDigest, 180),
    label: boundedString(source.label || source.rendererSafeLabel || fallbackKind, 180),
    confidence: boundedString(source.confidence || source.sourceConfidence || "diagnostic", 80),
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  ref.refDigest = digestFor("direct-agent-runtime-evidence-ref@1", ref);
  return ref;
}

function normalizeEvidenceRefs(values, fallbackKind = "agent_runtime") {
  return arrayOrEmpty(values)
    .filter((value) => isPlainObject(value))
    .map((value) => normalizeEvidenceRef(value, fallbackKind));
}

function normalizeAgentClassKind(value) {
  const text = normalizeString(value, "sub_agent_worker");
  return AGENT_CLASS_KINDS.has(text) ? text : "sub_agent_worker";
}

function buildAgentThreadKey(input = {}) {
  const projectId = normalizeString(input.projectId, "");
  const primaryThreadId = normalizeString(input.primaryThreadId, "");
  const providerThreadId = normalizeString(input.providerThreadId || input.threadId || input.agentThreadId, primaryThreadId);
  const sourceHomeEvidenceKey = normalizeString(input.sourceHomeEvidenceKey, "");
  const sessionFileEvidenceKey = normalizeString(input.sessionFileEvidenceKey, "");
  const key = {
    projectId,
    providerInstanceId: normalizeString(input.providerInstanceId, "direct_harness"),
    primaryThreadId,
    providerThreadId,
    sourceHomeEvidenceKey,
    sessionFileEvidenceKey,
  };
  key.threadKeyDigest = digestFor("direct-agent-thread-key@1", key);
  return key;
}

function buildAgentAuthorityBoundary(input = {}) {
  const boundary = {
    schema: DIRECT_AGENT_AUTHORITY_BOUNDARY_SCHEMA,
    boundaryId: normalizeString(input.boundaryId, ""),
    projectId: normalizeString(input.projectId, ""),
    parentAgentId: normalizeString(input.parentAgentId, ""),
    childAgentId: normalizeString(input.childAgentId, ""),
    agentClassKind: normalizeAgentClassKind(input.agentClassKind),
    parentMaySpawnChild: input.parentMaySpawnChild === true,
    childMayCallProvider: false,
    childMayUseTools: false,
    childMaySpawnChildren: false,
    childMayMutateWorkspace: false,
    childMayApproveRequests: false,
    childMayPromoteFinalAnswer: false,
    childTranscriptMayEnterPrimary: false,
    usageFoldedIntoParentOnly: false,
    requiresExplicitAgentClassSpec: true,
    requiresContextPacketFamily: true,
    requiresArtifactOutputContract: true,
    rendererSafeSummary: boundedString(input.rendererSafeSummary || "Child agent authority is explicit, text-only, no-tools, non-recursive, and cannot promote its transcript into primary output.", 420),
    evidenceRefs: normalizeEvidenceRefs(input.evidenceRefs, "agent_authority_boundary"),
    rawTextIncluded: false,
    rawSecretIncluded: false,
  };
  boundary.boundaryId = boundary.boundaryId || `agent_boundary_${digestFor("direct-agent-authority-boundary-source@1", boundary).slice(0, 24)}`;
  boundary.boundaryDigest = digestFor("direct-agent-authority-boundary@1", boundary);
  return boundary;
}

function buildAgentContextPacketFamily(input = {}) {
  const familyCandidate = normalizeString(input.family, "text_only_child_context").toLowerCase();
  const family = CONTEXT_PACKET_FAMILIES.has(familyCandidate) ? familyCandidate : "text_only_child_context";
  const packet = {
    schema: DIRECT_AGENT_CONTEXT_PACKET_FAMILY_SCHEMA,
    contextPacketFamilyId: normalizeString(input.contextPacketFamilyId, family),
    projectId: normalizeString(input.projectId, ""),
    family,
    agentClassKind: normalizeAgentClassKind(input.agentClassKind),
    maxPromptChars: finiteNumber(input.maxPromptChars, 12000),
    maxContextItemCount: finiteNumber(input.maxContextItemCount, 24),
    allowedContextFamilies: arrayOrEmpty(input.allowedContextFamilies).map((item) => normalizeString(item, "")).filter(Boolean),
    requiredArtifactOutputFamilies: arrayOrEmpty(input.requiredArtifactOutputFamilies).map((item) => normalizeString(item, "")).filter(Boolean),
    toolsAllowed: false,
    recursiveSpawnAllowed: false,
    rawParentTranscriptAllowed: false,
    rawProviderFrameAllowed: false,
    promptCompressionRequired: input.promptCompressionRequired !== false,
    rendererSafeSummary: boundedString(input.rendererSafeSummary || `${family} is a bounded context packet family, not a provider request by itself.`, 420),
    evidenceRefs: normalizeEvidenceRefs(input.evidenceRefs, "agent_context_packet_family"),
    rawTextIncluded: false,
    rawSecretIncluded: false,
  };
  packet.familyDigest = digestFor("direct-agent-context-packet-family@1", packet);
  return packet;
}

function buildAgentSpawnPlan(input = {}) {
  const authorityBoundary = isPlainObject(input.authorityBoundary)
    ? input.authorityBoundary
    : buildAgentAuthorityBoundary(input);
  const contextPacketFamily = isPlainObject(input.contextPacketFamily)
    ? input.contextPacketFamily
    : buildAgentContextPacketFamily(input);
  const plan = {
    schema: DIRECT_AGENT_SPAWN_PLAN_SCHEMA,
    spawnPlanId: normalizeString(input.spawnPlanId, ""),
    projectId: normalizeString(input.projectId, ""),
    parentAgentId: normalizeString(input.parentAgentId, "primary_agent"),
    childAgentId: normalizeString(input.childAgentId, ""),
    requestedAgentClassKind: normalizeAgentClassKind(input.requestedAgentClassKind || input.agentClassKind),
    requestedModel: normalizeString(input.requestedModel, ""),
    requestedReasoningEffort: normalizeString(input.requestedReasoningEffort, ""),
    authorityBoundaryRef: {
      boundaryId: authorityBoundary.boundaryId,
      digest: authorityBoundary.boundaryDigest,
    },
    contextPacketFamilyRef: {
      contextPacketFamilyId: contextPacketFamily.contextPacketFamilyId,
      digest: contextPacketFamily.familyDigest,
    },
    providerSpawnExecutable: false,
    localSpawnExecutable: false,
    requestShapeMutationAllowed: false,
    childSuccessClaimAllowed: false,
    parentSpawnIntentIsChildSuccess: false,
    executionState: "blocked_pending_text_only_sub_agent_tool_surface",
    blockerCodes: ["agent_spawn_tool_not_exposed", "provider_spawn_disabled_in_this_pr"],
    rendererSafeSummary: boundedString(input.rendererSafeSummary || "AgentSpawnPlan exists as evidence only; it cannot execute a provider spawn in this PR.", 420),
    evidenceRefs: normalizeEvidenceRefs(input.evidenceRefs, "agent_spawn_plan"),
    rawPromptIncluded: false,
    rawSecretIncluded: false,
  };
  plan.spawnPlanId = plan.spawnPlanId || `agent_spawn_plan_${digestFor("direct-agent-spawn-plan-source@1", plan).slice(0, 24)}`;
  plan.spawnPlanDigest = digestFor("direct-agent-spawn-plan@1", plan);
  return plan;
}

function buildAgentThreadGraph(input = {}) {
  const nodes = arrayOrEmpty(input.nodes).map((node, index) => {
    const safeNode = isPlainObject(node) ? node : {};
    const agentThreadId = normalizeString(safeNode.agentThreadId || safeNode.providerThreadId || safeNode.threadId, `agent_${index + 1}`);
    const stateCandidate = normalizeString(safeNode.nodeState || safeNode.lifecycleState, "planned").toLowerCase();
    const nodeState = AGENT_NODE_STATES.has(stateCandidate) ? stateCandidate : "planned";
    const threadKey = buildAgentThreadKey({
      projectId: input.projectId,
      primaryThreadId: input.primaryThreadId,
      providerThreadId: agentThreadId,
      providerInstanceId: safeNode.providerInstanceId || input.providerInstanceId,
      sourceHomeEvidenceKey: safeNode.sourceHomeEvidenceKey,
      sessionFileEvidenceKey: safeNode.sessionFileEvidenceKey,
    });
    return {
      agentNodeId: normalizeString(safeNode.agentNodeId, `agent_node_${digestFor("direct-agent-node-id@1", agentThreadId).slice(0, 18)}`),
      agentThreadId,
      parentAgentThreadId: normalizeString(safeNode.parentAgentThreadId || safeNode.parentThreadId, ""),
      agentClassKind: normalizeAgentClassKind(safeNode.agentClassKind),
      displayLabel: boundedString(safeNode.displayLabel || safeNode.nickname || safeNode.role || `Agent ${agentThreadId.slice(0, 8)}`, 160),
      model: normalizeString(safeNode.model, ""),
      reasoningEffort: normalizeString(safeNode.reasoningEffort, ""),
      nodeState,
      activityState: normalizeString(safeNode.activityState, ""),
      contextPacketFamilyId: normalizeString(safeNode.contextPacketFamilyId, "text_only_child_context"),
      authorityBoundaryId: normalizeString(safeNode.authorityBoundaryId, ""),
      usageScopeId: normalizeString(safeNode.usageScopeId, `agent_usage_${agentThreadId}`),
      threadKey,
      evidenceRefs: normalizeEvidenceRefs(safeNode.evidenceRefs, "agent_thread_node"),
    };
  });
  const edges = arrayOrEmpty(input.edges).map((edge, index) => {
    const safeEdge = isPlainObject(edge) ? edge : {};
    return {
      edgeId: normalizeString(safeEdge.edgeId, `agent_edge_${digestFor("direct-agent-runtime-edge@1", `${safeEdge.parentAgentThreadId || ""}:${safeEdge.childAgentThreadId || ""}:${index}`).slice(0, 18)}`),
      edgeKind: normalizeString(safeEdge.edgeKind, "spawn_intent"),
      parentAgentThreadId: normalizeString(safeEdge.parentAgentThreadId || safeEdge.parentThreadId, ""),
      childAgentThreadId: normalizeString(safeEdge.childAgentThreadId || safeEdge.childThreadId, ""),
      sourceMailboxMessageId: normalizeString(safeEdge.sourceMailboxMessageId, ""),
      status: normalizeString(safeEdge.status, "planned"),
      spawnIntentIsSuccess: false,
      evidenceRefs: normalizeEvidenceRefs(safeEdge.evidenceRefs, "agent_thread_edge"),
    };
  });
  const graph = {
    schema: DIRECT_AGENT_THREAD_GRAPH_SCHEMA,
    graphId: normalizeString(input.graphId, ""),
    projectId: normalizeString(input.projectId, ""),
    primaryThreadId: normalizeString(input.primaryThreadId, ""),
    graphRevision: finiteNumber(input.graphRevision, 1),
    canonicalRuntimeEvidence: true,
    subAgentPanelProjectionOnly: true,
    childTranscriptPromotionAllowed: false,
    parentSpawnIntentMayClaimChildSuccess: false,
    nodes,
    edges,
    evidenceRefs: normalizeEvidenceRefs(input.evidenceRefs, "agent_thread_graph"),
    rawTranscriptIncluded: false,
    rawPromptIncluded: false,
    rawProviderFrameIncluded: false,
  };
  graph.graphId = graph.graphId || `agent_thread_graph_${digestFor("direct-agent-thread-graph-source@1", graph).slice(0, 24)}`;
  graph.graphDigest = digestFor("direct-agent-thread-graph@1", graph);
  return graph;
}

function normalizeMailboxMessage(message = {}, index = 0) {
  const kindCandidate = normalizeString(message.messageKind, "diagnostic").toLowerCase();
  const kind = MAILBOX_MESSAGE_KINDS.has(kindCandidate) ? kindCandidate : "diagnostic";
  const directionCandidate = normalizeString(message.direction, "unknown").toLowerCase();
  const direction = MAILBOX_DIRECTIONS.has(directionCandidate) ? directionCandidate : "unknown";
  const messageCore = {
    messageId: normalizeString(message.messageId, `agent_mailbox_msg_${index + 1}`),
    sequence: finiteNumber(message.sequence, index + 1),
    idempotencyKey: normalizeString(message.idempotencyKey, ""),
    messageKind: kind,
    direction,
    parentAgentId: normalizeString(message.parentAgentId, ""),
    childAgentId: normalizeString(message.childAgentId, ""),
    state: normalizeString(message.state, "recorded"),
    createdAt: normalizeString(message.createdAt, ""),
    payloadRef: normalizeEvidenceRef(message.payloadRef || { kind: "mailbox_payload_ref", id: message.messageId || `message_${index + 1}` }, "mailbox_payload_ref"),
    rawPayloadIncluded: false,
    rawPromptIncluded: false,
  };
  messageCore.idempotencyKey = messageCore.idempotencyKey || digestFor("direct-agent-mailbox-idempotency@1", {
    kind,
    direction,
    parentAgentId: messageCore.parentAgentId,
    childAgentId: messageCore.childAgentId,
    sequence: messageCore.sequence,
    payloadDigest: messageCore.payloadRef.refDigest,
  });
  messageCore.messageDigest = digestFor("direct-agent-mailbox-message@1", messageCore);
  return messageCore;
}

function buildAgentMailbox(input = {}) {
  const normalizedMessages = arrayOrEmpty(input.messages)
    .map((message, index) => normalizeMailboxMessage(message, index));
  const sequenceViolationCount = normalizedMessages.reduce((count, message, index, source) => {
    if (index === 0) return count;
    return message.sequence > source[index - 1].sequence ? count : count + 1;
  }, 0);
  const messages = [...normalizedMessages].sort((a, b) => a.sequence - b.sequence || a.messageId.localeCompare(b.messageId));
  const idempotencyKeys = messages.map((message) => message.idempotencyKey);
  const mailbox = {
    schema: DIRECT_AGENT_MAILBOX_SCHEMA,
    mailboxId: normalizeString(input.mailboxId, ""),
    projectId: normalizeString(input.projectId, ""),
    primaryThreadId: normalizeString(input.primaryThreadId, ""),
    graphId: normalizeString(input.graphId, ""),
    sequenceLaw: "strictly_increasing_per_mailbox",
    sequenceValid: sequenceViolationCount === 0,
    sequenceViolationCount,
    idempotencyLaw: "idempotency_key_required_per_message",
    duplicateMessageCount: idempotencyKeys.length - new Set(idempotencyKeys).size,
    messageCount: messages.length,
    messages,
    providerTransportAllowed: false,
    workspaceMutationAllowed: false,
    rawPayloadIncluded: false,
  };
  mailbox.mailboxId = mailbox.mailboxId || `agent_mailbox_${digestFor("direct-agent-mailbox-source@1", mailbox).slice(0, 24)}`;
  mailbox.mailboxDigest = digestFor("direct-agent-mailbox@1", mailbox);
  return mailbox;
}

function buildAgentLifecycleRegistry(input = {}) {
  const entries = arrayOrEmpty(input.entries).map((entry, index) => {
    const safeEntry = isPlainObject(entry) ? entry : {};
    const stateCandidate = normalizeString(safeEntry.lifecycleState, "unknown").toLowerCase();
    const state = AGENT_NODE_STATES.has(stateCandidate) ? stateCandidate : "unknown";
    const lifecycleEntry = {
      lifecycleEntryId: normalizeString(safeEntry.lifecycleEntryId, `agent_lifecycle_${index + 1}`),
      agentThreadId: normalizeString(safeEntry.agentThreadId, `agent_${index + 1}`),
      lifecycleState: state,
      progressLabel: boundedString(safeEntry.progressLabel || state, 180),
      startedAt: normalizeString(safeEntry.startedAt, ""),
      completedAt: normalizeString(safeEntry.completedAt, ""),
      lastEventAt: normalizeString(safeEntry.lastEventAt, ""),
      terminal: ["completed", "failed", "timeout", "cancelled", "closed"].includes(state),
      parentNotified: safeEntry.parentNotified === true,
      resultAccepted: safeEntry.resultAccepted === true,
      evidenceRefs: normalizeEvidenceRefs(safeEntry.evidenceRefs, "agent_lifecycle_entry"),
    };
    lifecycleEntry.lifecycleEntryDigest = digestFor("direct-agent-lifecycle-entry@1", lifecycleEntry);
    return lifecycleEntry;
  });
  const registry = {
    schema: DIRECT_AGENT_LIFECYCLE_REGISTRY_SCHEMA,
    lifecycleRegistryId: normalizeString(input.lifecycleRegistryId, ""),
    projectId: normalizeString(input.projectId, ""),
    graphId: normalizeString(input.graphId, ""),
    entryCount: entries.length,
    activeCount: entries.filter((entry) => ["created", "request_started", "running", "waiting"].includes(entry.lifecycleState)).length,
    terminalCount: entries.filter((entry) => entry.terminal).length,
    unknownCount: entries.filter((entry) => ["handoff_unknown", "recovery_required", "unknown"].includes(entry.lifecycleState)).length,
    entries,
    evidenceRefs: normalizeEvidenceRefs(input.evidenceRefs, "agent_lifecycle_registry"),
  };
  registry.lifecycleRegistryId = registry.lifecycleRegistryId || `agent_lifecycle_registry_${digestFor("direct-agent-lifecycle-registry-source@1", registry).slice(0, 24)}`;
  registry.lifecycleRegistryDigest = digestFor("direct-agent-lifecycle-registry@1", registry);
  return registry;
}

function classifyAgentRuntimeRecovery(input = {}) {
  const lifecycleState = normalizeString(input.lifecycleState, "unknown");
  if (lifecycleState === "handoff_unknown") return "handoff_unknown";
  if (lifecycleState === "recovery_required") return "recovery_required";
  const hasCreateEvidence = input.hasCreateEvidence === true || ["created", "request_started", "running", "waiting", "completed", "failed", "timeout", "cancelled", "closed"].includes(lifecycleState);
  const hasRequestStart = input.hasRequestStart === true || ["request_started", "running", "waiting", "completed", "failed", "timeout", "cancelled", "closed"].includes(lifecycleState);
  const hasResult = input.hasResult === true || ["completed", "failed", "timeout", "cancelled", "closed"].includes(lifecycleState);
  if (!hasCreateEvidence) return "not_started";
  if (hasResult) return "terminal_known";
  if (hasRequestStart) return "result_pending";
  return "child_created";
}

function buildAgentRuntimeRecoveryClassification(input = {}) {
  const recoveryClassCandidate = normalizeString(input.recoveryClass, "").toLowerCase();
  const recoveryClass = RECOVERY_CLASSES.has(recoveryClassCandidate)
    ? recoveryClassCandidate
    : classifyAgentRuntimeRecovery(input);
  const classification = {
    schema: DIRECT_AGENT_RUNTIME_RECOVERY_CLASSIFICATION_SCHEMA,
    recoveryId: normalizeString(input.recoveryId, ""),
    projectId: normalizeString(input.projectId, ""),
    graphId: normalizeString(input.graphId, ""),
    agentThreadId: normalizeString(input.agentThreadId, ""),
    recoveryClass,
    restartPosture: recoveryClass === "terminal_known" ? "no_replay" : recoveryClass === "not_started" ? "safe_to_forget_intent" : "manual_or_runtime_reconciliation_required",
    automaticReplayAllowed: false,
    providerSpawnReplayAllowed: false,
    mailboxReplayAllowed: false,
    requiresOperatorOrRuntimeEvidence: !["terminal_known", "not_started"].includes(recoveryClass),
    evidenceRefs: normalizeEvidenceRefs(input.evidenceRefs, "agent_runtime_recovery"),
  };
  classification.recoveryId = classification.recoveryId || `agent_recovery_${digestFor("direct-agent-runtime-recovery-source@1", classification).slice(0, 24)}`;
  classification.recoveryDigest = digestFor("direct-agent-runtime-recovery@1", classification);
  return classification;
}

function buildAgentRuntimeRegistry(input = {}) {
  const contextPacketFamilies = arrayOrEmpty(input.contextPacketFamilies).length
    ? input.contextPacketFamilies.map((item) => buildAgentContextPacketFamily({ projectId: input.projectId, ...item }))
    : [
      buildAgentContextPacketFamily({
        projectId: input.projectId,
        family: "text_only_child_context",
        agentClassKind: "sub_agent_worker",
        allowedContextFamilies: ["work_thread_identity", "authority_boundary", "context_packet"],
        requiredArtifactOutputFamilies: ["sub_agent_result_artifact"],
      }),
    ];
  const authorityBoundaries = arrayOrEmpty(input.authorityBoundaries).length
    ? input.authorityBoundaries.map((item) => buildAgentAuthorityBoundary({ projectId: input.projectId, ...item }))
    : [
      buildAgentAuthorityBoundary({
        projectId: input.projectId,
        parentAgentId: normalizeString(input.primaryThreadId, "primary_agent"),
        childAgentId: "planned_child_agent",
        agentClassKind: "sub_agent_worker",
      }),
    ];
  const spawnPlan = buildAgentSpawnPlan({
    projectId: input.projectId,
    parentAgentId: normalizeString(input.primaryThreadId, "primary_agent"),
    childAgentId: normalizeString(input.plannedChildAgentId, "planned_child_agent"),
    authorityBoundary: authorityBoundaries[0],
    contextPacketFamily: contextPacketFamilies[0],
  });
  const registry = {
    schema: DIRECT_AGENT_RUNTIME_REGISTRY_SCHEMA,
    registryId: normalizeString(input.registryId, ""),
    projectId: normalizeString(input.projectId, ""),
    primaryThreadId: normalizeString(input.primaryThreadId, ""),
    mode: "substrate_only",
    contextPacketFamilies,
    authorityBoundaries,
    spawnPlans: [spawnPlan],
    providerSpawnEnabledInThisPr: false,
    localSpawnEnabledInThisPr: false,
    listAgentsToolEnabledInThisPr: false,
    waitAgentToolEnabledInThisPr: false,
    sendMessageToolEnabledInThisPr: false,
    interruptAgentToolEnabledInThisPr: false,
    recursiveSpawnEnabledInThisPr: false,
    providerDeclarationEnabledInThisPr: false,
    requestShapeMutationEnabledInThisPr: false,
    rawPromptIncluded: false,
    rawTranscriptIncluded: false,
    rawProviderFrameIncluded: false,
    createdAt: normalizeString(input.createdAt, nowIso(input.nowMs)),
  };
  registry.registryId = registry.registryId || `agent_runtime_registry_${digestFor("direct-agent-runtime-registry-source@1", registry).slice(0, 24)}`;
  registry.registryDigest = digestFor("direct-agent-runtime-registry@1", registry);
  return registry;
}

function buildAgentRuntimeSubstrateStatus(input = {}) {
  const registry = isPlainObject(input.registry) ? input.registry : buildAgentRuntimeRegistry(input);
  const graph = isPlainObject(input.graph)
    ? input.graph
    : buildAgentThreadGraph({
      projectId: registry.projectId,
      primaryThreadId: registry.primaryThreadId,
      nodes: input.nodes,
      edges: input.edges,
    });
  const mailbox = isPlainObject(input.mailbox)
    ? input.mailbox
    : buildAgentMailbox({
      projectId: registry.projectId,
      primaryThreadId: registry.primaryThreadId,
      graphId: graph.graphId,
      messages: input.messages,
    });
  const lifecycleRegistry = isPlainObject(input.lifecycleRegistry)
    ? input.lifecycleRegistry
    : buildAgentLifecycleRegistry({
      projectId: registry.projectId,
      graphId: graph.graphId,
      entries: input.lifecycleEntries,
    });
  const recoveryClassifications = arrayOrEmpty(input.recoveryClassifications).length
    ? input.recoveryClassifications.map((entry) => buildAgentRuntimeRecoveryClassification({
      projectId: registry.projectId,
      graphId: graph.graphId,
      ...entry,
    }))
    : [
      buildAgentRuntimeRecoveryClassification({ projectId: registry.projectId, graphId: graph.graphId, lifecycleState: "created", agentThreadId: "created_child" }),
      buildAgentRuntimeRecoveryClassification({ projectId: registry.projectId, graphId: graph.graphId, lifecycleState: "request_started", agentThreadId: "request_started_child" }),
      buildAgentRuntimeRecoveryClassification({ projectId: registry.projectId, graphId: graph.graphId, lifecycleState: "running", hasRequestStart: true, agentThreadId: "result_pending_child" }),
      buildAgentRuntimeRecoveryClassification({ projectId: registry.projectId, graphId: graph.graphId, lifecycleState: "handoff_unknown", agentThreadId: "handoff_unknown_child" }),
      buildAgentRuntimeRecoveryClassification({ projectId: registry.projectId, graphId: graph.graphId, lifecycleState: "recovery_required", agentThreadId: "recovery_required_child" }),
    ];
  const status = {
    schema: DIRECT_AGENT_RUNTIME_SUBSTRATE_STATUS_SCHEMA,
    projectId: registry.projectId,
    primaryThreadId: registry.primaryThreadId,
    mode: "substrate_only",
    registryId: registry.registryId,
    registryDigest: registry.registryDigest,
    graphId: graph.graphId,
    graphDigest: graph.graphDigest,
    mailboxId: mailbox.mailboxId,
    mailboxDigest: mailbox.mailboxDigest,
    lifecycleRegistryId: lifecycleRegistry.lifecycleRegistryId,
    lifecycleRegistryDigest: lifecycleRegistry.lifecycleRegistryDigest,
    nodeCount: arrayOrEmpty(graph.nodes).length,
    edgeCount: arrayOrEmpty(graph.edges).length,
    mailboxMessageCount: mailbox.messageCount,
    duplicateMailboxMessageCount: mailbox.duplicateMessageCount,
    mailboxSequenceValid: mailbox.sequenceValid === true,
    mailboxSequenceViolationCount: finiteNumber(mailbox.sequenceViolationCount, 0),
    lifecycleEntryCount: lifecycleRegistry.entryCount,
    activeAgentCount: lifecycleRegistry.activeCount,
    terminalAgentCount: lifecycleRegistry.terminalCount,
    unknownRecoveryCount: lifecycleRegistry.unknownCount,
    recoveryClasses: recoveryClassifications.map((entry) => entry.recoveryClass),
    canonicalGraphEvidence: graph.canonicalRuntimeEvidence === true,
    subAgentPanelProjectionOnly: graph.subAgentPanelProjectionOnly === true,
    childTranscriptPromotionAllowed: false,
    parentSpawnIntentMayClaimChildSuccess: false,
    agentSpawnPlanExists: arrayOrEmpty(registry.spawnPlans).length > 0,
    agentSpawnExecutable: false,
    agentContextPacketFamilyExists: arrayOrEmpty(registry.contextPacketFamilies).length > 0,
    agentAuthorityBoundaryExplicit: arrayOrEmpty(registry.authorityBoundaries).length > 0,
    mailboxSequenceLaw: mailbox.sequenceLaw,
    mailboxIdempotencyLaw: mailbox.idempotencyLaw,
    providerSpawnEnabledInThisPr: false,
    localSpawnEnabledInThisPr: false,
    providerDeclarationEnabledInThisPr: false,
    requestShapeMutationEnabledInThisPr: false,
    recursiveSpawnEnabledInThisPr: false,
    waitToolEnabledInThisPr: false,
    sendMessageToolEnabledInThisPr: false,
    interruptToolEnabledInThisPr: false,
    rawPromptIncluded: false,
    rawTranscriptIncluded: false,
    rawProviderFrameIncluded: false,
    rendererSafeSummary: boundedString(input.rendererSafeSummary || "Agent runtime substrate is canonical evidence only; sub-agent tools remain unexposed.", 420),
    generatedAt: normalizeString(input.generatedAt, nowIso(input.nowMs)),
  };
  status.statusDigest = digestFor("direct-agent-runtime-substrate-status@1", status);
  return status;
}

function assertAgentRuntimeSubstrateSafe(status = {}) {
  if (!isPlainObject(status) || status.schema !== DIRECT_AGENT_RUNTIME_SUBSTRATE_STATUS_SCHEMA) {
    throw new Error("direct_agent_runtime_substrate_status_schema_mismatch");
  }
  for (const flag of [
    "childTranscriptPromotionAllowed",
    "parentSpawnIntentMayClaimChildSuccess",
    "agentSpawnExecutable",
    "providerSpawnEnabledInThisPr",
    "localSpawnEnabledInThisPr",
    "providerDeclarationEnabledInThisPr",
    "requestShapeMutationEnabledInThisPr",
    "recursiveSpawnEnabledInThisPr",
    "waitToolEnabledInThisPr",
    "sendMessageToolEnabledInThisPr",
    "interruptToolEnabledInThisPr",
    "rawPromptIncluded",
    "rawTranscriptIncluded",
    "rawProviderFrameIncluded",
  ]) {
    if (status[flag] !== false) throw new Error(`direct_agent_runtime_substrate_authority_leak:${flag}`);
  }
  if (status.canonicalGraphEvidence !== true) throw new Error("direct_agent_runtime_substrate_graph_not_canonical");
  if (status.subAgentPanelProjectionOnly !== true) throw new Error("direct_agent_runtime_substrate_panel_not_projection");
  if (status.agentSpawnPlanExists !== true) throw new Error("direct_agent_runtime_substrate_spawn_plan_missing");
  if (status.agentContextPacketFamilyExists !== true) throw new Error("direct_agent_runtime_substrate_context_family_missing");
  if (status.agentAuthorityBoundaryExplicit !== true) throw new Error("direct_agent_runtime_substrate_authority_boundary_missing");
  if (status.mailboxSequenceValid !== true || status.mailboxSequenceViolationCount !== 0) {
    throw new Error("direct_agent_runtime_substrate_mailbox_sequence_invalid");
  }
  for (const required of ["child_created", "result_pending", "handoff_unknown", "recovery_required"]) {
    if (!arrayOrEmpty(status.recoveryClasses).includes(required)) {
      throw new Error(`direct_agent_runtime_substrate_recovery_class_missing:${required}`);
    }
  }
  return true;
}

module.exports = {
  DIRECT_AGENT_AUTHORITY_BOUNDARY_SCHEMA,
  DIRECT_AGENT_CONTEXT_PACKET_FAMILY_SCHEMA,
  DIRECT_AGENT_LIFECYCLE_REGISTRY_SCHEMA,
  DIRECT_AGENT_MAILBOX_SCHEMA,
  DIRECT_AGENT_RUNTIME_RECOVERY_CLASSIFICATION_SCHEMA,
  DIRECT_AGENT_RUNTIME_REGISTRY_SCHEMA,
  DIRECT_AGENT_RUNTIME_SUBSTRATE_STATUS_SCHEMA,
  DIRECT_AGENT_SPAWN_PLAN_SCHEMA,
  DIRECT_AGENT_THREAD_GRAPH_SCHEMA,
  assertAgentRuntimeSubstrateSafe,
  buildAgentAuthorityBoundary,
  buildAgentContextPacketFamily,
  buildAgentLifecycleRegistry,
  buildAgentMailbox,
  buildAgentRuntimeRecoveryClassification,
  buildAgentRuntimeRegistry,
  buildAgentRuntimeSubstrateStatus,
  buildAgentSpawnPlan,
  buildAgentThreadGraph,
  buildAgentThreadKey,
  classifyAgentRuntimeRecovery,
  stableStringify,
};
