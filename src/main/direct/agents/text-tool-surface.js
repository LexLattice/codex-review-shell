"use strict";

const crypto = require("node:crypto");
const {
  buildAgentMailbox,
  buildAgentThreadGraph,
  buildAgentRuntimeRegistry,
} = require("./runtime-substrate");
const {
  buildAgentClassRegistry,
} = require("../bridge/agent-class-spec");

const DIRECT_TEXT_SUB_AGENT_TOOL_SURFACE_SCHEMA = "direct_text_sub_agent_tool_surface@1";
const DIRECT_SUB_AGENT_LIST_PROJECTION_SCHEMA = "direct_sub_agent_list_projection@1";
const DIRECT_TEXT_SUB_AGENT_SPAWN_REQUEST_SCHEMA = "direct_text_sub_agent_spawn_request@1";
const DIRECT_AGENT_WAIT_PLAN_SCHEMA = "direct_agent_wait_plan@1";
const DIRECT_AGENT_MAILBOX_WRITE_PLAN_SCHEMA = "direct_agent_mailbox_write_plan@1";
const DIRECT_AGENT_INTERRUPT_REQUEST_SCHEMA = "direct_agent_interrupt_request@1";

const WAIT_MODES = new Set(["any", "all", "specific"]);
const WAIT_RESTART_STATES = new Set(["not_started", "waiting", "target_completed", "timeout", "handoff_unknown", "recovery_required"]);
const MAILBOX_WRITE_KINDS = new Set(["send_message", "followup_task"]);

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

function positiveNumber(value, fallback) {
  const parsed = finiteNumber(value, fallback);
  return parsed > 0 ? parsed : fallback;
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

function normalizeEvidenceRef(input = {}, fallbackKind = "agent_tool_surface") {
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
  ref.refDigest = digestFor("direct-agent-tool-surface-evidence-ref@1", ref);
  return ref;
}

function normalizeEvidenceRefs(values, fallbackKind = "agent_tool_surface") {
  return arrayOrEmpty(values)
    .filter((value) => isPlainObject(value))
    .map((value) => normalizeEvidenceRef(value, fallbackKind));
}

function graphNodes(graph = {}) {
  return arrayOrEmpty(graph.nodes);
}

function mailboxMessages(mailbox = {}) {
  return arrayOrEmpty(mailbox.messages);
}

function lifecycleEntries(lifecycleRegistry = {}) {
  return arrayOrEmpty(lifecycleRegistry.entries);
}

function findNode(graph, agentThreadId) {
  const safeId = normalizeString(agentThreadId, "");
  return graphNodes(graph).find((node) => normalizeString(node.agentThreadId, "") === safeId) || null;
}

function findClassSpec(agentClassRegistry, agentClassKind) {
  const safeKind = normalizeString(agentClassKind, "sub_agent_worker");
  return arrayOrEmpty(agentClassRegistry.specs).find((spec) => normalizeString(spec.agentClassKind, "") === safeKind) || null;
}

function hasRequiredClassContract(spec) {
  if (!isPlainObject(spec)) return false;
  const consumed = new Set(arrayOrEmpty(spec.consumedContextFamilies));
  const produced = new Set(arrayOrEmpty(spec.producedArtifactFamilies));
  return consumed.has("context_packet") &&
    consumed.has("authority_boundary") &&
    produced.has("sub_agent_result_artifact") &&
    spec.authorityContract?.maySpawnSubAgent !== true &&
    spec.authorityContract?.mayCallProviderDirectly !== true &&
    spec.authorityContract?.mayExecuteWorkspaceMutation !== true;
}

function nextMailboxSequence(mailbox = {}) {
  return mailboxMessages(mailbox).reduce((max, message) => Math.max(max, finiteNumber(message.sequence, 0)), 0) + 1;
}

function buildSubAgentListProjection(input = {}) {
  const graph = isPlainObject(input.graph) ? input.graph : buildAgentThreadGraph(input);
  const lifecycleByAgent = new Map(lifecycleEntries(input.lifecycleRegistry)
    .map((entry) => [normalizeString(entry.agentThreadId, ""), entry]));
  const rows = graphNodes(graph).map((node, index) => {
    const lifecycle = lifecycleByAgent.get(normalizeString(node.agentThreadId, "")) || {};
    const row = {
      rowId: normalizeString(node.agentNodeId, `sub_agent_row_${index + 1}`),
      agentThreadId: normalizeString(node.agentThreadId, ""),
      parentAgentThreadId: normalizeString(node.parentAgentThreadId, ""),
      displayLabel: boundedString(node.displayLabel || node.agentThreadId || `Agent ${index + 1}`, 160),
      agentClassKind: normalizeString(node.agentClassKind, "sub_agent_worker"),
      model: normalizeString(node.model, ""),
      reasoningEffort: normalizeString(node.reasoningEffort, ""),
      nodeState: normalizeString(node.nodeState, "unknown"),
      lifecycleState: normalizeString(lifecycle.lifecycleState, node.nodeState || "unknown"),
      terminal: lifecycle.terminal === true,
      usageScopeId: normalizeString(node.usageScopeId, ""),
      contextPacketFamilyId: normalizeString(node.contextPacketFamilyId, ""),
      authorityBoundaryId: normalizeString(node.authorityBoundaryId, ""),
      evidenceRefs: normalizeEvidenceRefs(node.evidenceRefs, "sub_agent_list_row"),
    };
    row.rowDigest = digestFor("direct-sub-agent-list-row@1", row);
    return row;
  });
  const projection = {
    schema: DIRECT_SUB_AGENT_LIST_PROJECTION_SCHEMA,
    projectionId: normalizeString(input.projectionId, ""),
    projectId: normalizeString(input.projectId || graph.projectId, ""),
    primaryThreadId: normalizeString(input.primaryThreadId || graph.primaryThreadId, ""),
    graphId: normalizeString(graph.graphId, ""),
    graphDigest: normalizeString(graph.graphDigest, ""),
    rowCount: rows.length,
    activeCount: rows.filter((row) => ["created", "request_started", "running", "waiting"].includes(row.lifecycleState)).length,
    terminalCount: rows.filter((row) => row.terminal).length,
    rows,
    listAgentsEnabledInThisPr: true,
    providerTransportAllowed: false,
    requestShapeMutationAllowed: false,
    rawTranscriptIncluded: false,
    rawPromptIncluded: false,
    rawSecretIncluded: false,
  };
  projection.projectionId = projection.projectionId || `sub_agent_list_${digestFor("direct-sub-agent-list-source@1", projection).slice(0, 24)}`;
  projection.projectionDigest = digestFor("direct-sub-agent-list-projection@1", projection);
  return projection;
}

function buildTextSubAgentSpawnRequest(input = {}) {
  const graph = isPlainObject(input.graph) ? input.graph : buildAgentThreadGraph(input);
  const mailbox = isPlainObject(input.mailbox) ? input.mailbox : buildAgentMailbox(input);
  const runtimeRegistry = isPlainObject(input.runtimeRegistry) ? input.runtimeRegistry : buildAgentRuntimeRegistry(input);
  const agentClassRegistry = isPlainObject(input.agentClassRegistry) ? input.agentClassRegistry : buildAgentClassRegistry(input);
  const requestedAgentClassKind = normalizeString(input.requestedAgentClassKind || input.agentClassKind, "sub_agent_worker");
  const classSpec = findClassSpec(agentClassRegistry, requestedAgentClassKind);
  const classSpecValid = hasRequiredClassContract(classSpec);
  const contextFamily = arrayOrEmpty(runtimeRegistry.contextPacketFamilies)
    .find((family) => normalizeString(family.family, "") === "text_only_child_context") ||
    arrayOrEmpty(runtimeRegistry.contextPacketFamilies)[0] ||
    null;
  const authorityBoundary = arrayOrEmpty(runtimeRegistry.authorityBoundaries)[0] || null;
  const promptChars = finiteNumber(input.promptChars, 0);
  const maxPromptChars = positiveNumber(input.maxPromptChars || contextFamily?.maxPromptChars, 12000);
  const request = {
    schema: DIRECT_TEXT_SUB_AGENT_SPAWN_REQUEST_SCHEMA,
    spawnRequestId: normalizeString(input.spawnRequestId, ""),
    projectId: normalizeString(input.projectId || graph.projectId, ""),
    primaryThreadId: normalizeString(input.primaryThreadId || graph.primaryThreadId, ""),
    graphId: normalizeString(graph.graphId, ""),
    mailboxId: normalizeString(mailbox.mailboxId, ""),
    parentAgentId: normalizeString(input.parentAgentId, graph.primaryThreadId || "primary_agent"),
    childAgentId: normalizeString(input.childAgentId, `text_child_${digestFor("direct-text-sub-agent-child-source@1", {
      projectId: input.projectId || graph.projectId,
      parentAgentId: input.parentAgentId || graph.primaryThreadId,
      class: requestedAgentClassKind,
      sequence: nextMailboxSequence(mailbox),
    }).slice(0, 16)}`),
    requestedAgentClassKind,
    agentClassSpecRef: classSpec ? {
      agentClassId: normalizeString(classSpec.agentClassId, ""),
      specDigest: normalizeString(classSpec.specDigest, ""),
    } : null,
    agentClassSpecValid: classSpecValid,
    contextPacketFamilyRef: contextFamily ? {
      contextPacketFamilyId: normalizeString(contextFamily.contextPacketFamilyId, ""),
      digest: normalizeString(contextFamily.familyDigest, ""),
    } : null,
    authorityBoundaryRef: authorityBoundary ? {
      boundaryId: normalizeString(authorityBoundary.boundaryId, ""),
      digest: normalizeString(authorityBoundary.boundaryDigest, ""),
    } : null,
    promptEvidenceRef: normalizeEvidenceRef(input.promptEvidenceRef || {
      kind: "bounded_spawn_prompt_ref",
      id: input.promptEvidenceId || "spawn_prompt_ref",
      digest: input.promptDigest || "",
      label: "Bounded text-only spawn prompt",
    }, "bounded_spawn_prompt_ref"),
    promptChars,
    maxPromptChars,
    promptWithinBounds: promptChars <= maxPromptChars,
    mailboxSequence: nextMailboxSequence(mailbox),
    idempotencyKey: normalizeString(input.idempotencyKey, ""),
    textOnlyChild: true,
    childToolsAllowed: false,
    childRecursiveSpawnAllowed: false,
    inheritedParentAuthorityAllowed: false,
    childTranscriptPromotionAllowed: false,
    providerDeclarationAllowed: false,
    providerTransportAllowed: false,
    requestShapeMutationAllowed: false,
    localRuntimeMutationAllowed: classSpecValid && promptChars <= maxPromptChars,
    spawnIntentIsSuccess: false,
    usageAttribution: "agent_thread",
    evidenceRefs: normalizeEvidenceRefs(input.evidenceRefs, "text_sub_agent_spawn_request"),
    rawPromptIncluded: false,
    rawTranscriptIncluded: false,
    rawSecretIncluded: false,
  };
  request.idempotencyKey = request.idempotencyKey || digestFor("direct-text-sub-agent-spawn-idempotency@1", {
    parentAgentId: request.parentAgentId,
    childAgentId: request.childAgentId,
    promptDigest: request.promptEvidenceRef.refDigest,
    mailboxSequence: request.mailboxSequence,
  });
  request.spawnRequestId = request.spawnRequestId || `text_sub_agent_spawn_${digestFor("direct-text-sub-agent-spawn-source@1", request).slice(0, 24)}`;
  request.blockerCodes = [
    ...(classSpecValid ? [] : ["agent_class_spec_invalid_or_missing"]),
    ...(request.contextPacketFamilyRef ? [] : ["context_packet_family_missing"]),
    ...(request.authorityBoundaryRef ? [] : ["authority_boundary_missing"]),
    ...(request.promptWithinBounds ? [] : ["spawn_prompt_exceeds_bound"]),
  ];
  request.acceptedAsTextOnlyIntent = request.blockerCodes.length === 0;
  request.spawnRequestDigest = digestFor("direct-text-sub-agent-spawn-request@1", request);
  return request;
}

function buildAgentWaitPlan(input = {}) {
  const graph = isPlainObject(input.graph) ? input.graph : buildAgentThreadGraph(input);
  const parentAgentId = normalizeString(input.parentAgentId, graph.primaryThreadId || "primary_agent");
  const targetAgentIds = arrayOrEmpty(input.targetAgentIds).map((item) => normalizeString(item, "")).filter(Boolean);
  const effectiveTargets = targetAgentIds.length
    ? targetAgentIds
    : graphNodes(graph).map((node) => normalizeString(node.agentThreadId, "")).filter(Boolean).slice(0, 1);
  const waitModeCandidate = normalizeString(input.waitMode, effectiveTargets.length > 1 ? "all" : "specific");
  const waitMode = WAIT_MODES.has(waitModeCandidate) ? waitModeCandidate : "specific";
  const timeoutMs = positiveNumber(input.timeoutMs, 30000);
  const maxWaitDepth = positiveNumber(input.maxWaitDepth, 1);
  const targetSet = new Set(effectiveTargets);
  const cycleDetected = effectiveTargets.includes(parentAgentId) || graphNodes(graph)
    .some((node) => targetSet.has(normalizeString(node.parentAgentThreadId, "")) && normalizeString(node.agentThreadId, "") === parentAgentId);
  const lifecycleByAgent = new Map(lifecycleEntries(input.lifecycleRegistry)
    .map((entry) => [normalizeString(entry.agentThreadId, ""), entry]));
  const allTargetsTerminal = effectiveTargets.length > 0 && effectiveTargets.every((target) => lifecycleByAgent.get(target)?.terminal === true);
  const restartCandidate = normalizeString(input.restartState, allTargetsTerminal ? "target_completed" : "waiting");
  const restartState = WAIT_RESTART_STATES.has(restartCandidate) ? restartCandidate : "waiting";
  const plan = {
    schema: DIRECT_AGENT_WAIT_PLAN_SCHEMA,
    waitId: normalizeString(input.waitId, ""),
    projectId: normalizeString(input.projectId || graph.projectId, ""),
    primaryThreadId: normalizeString(input.primaryThreadId || graph.primaryThreadId, ""),
    graphId: normalizeString(graph.graphId, ""),
    parentAgentId,
    targetAgentIds: effectiveTargets,
    waitMode,
    timeoutMs,
    maxWaitDepth,
    cycleCheck: cycleDetected ? "failed" : "passed",
    waitGraphDigest: normalizeString(graph.graphDigest, ""),
    restartState,
    parentWorkflowMayBlockIndefinitely: false,
    noDeadlockLawSatisfied: !cycleDetected && timeoutMs > 0 && maxWaitDepth > 0,
    providerTransportAllowed: false,
    requestShapeMutationAllowed: false,
    evidenceRefs: normalizeEvidenceRefs(input.evidenceRefs, "agent_wait_plan"),
    rawTranscriptIncluded: false,
    rawSecretIncluded: false,
  };
  plan.waitId = plan.waitId || `agent_wait_${digestFor("direct-agent-wait-plan-source@1", plan).slice(0, 24)}`;
  plan.waitPlanDigest = digestFor("direct-agent-wait-plan@1", plan);
  return plan;
}

function buildAgentMailboxWritePlan(input = {}) {
  const mailbox = isPlainObject(input.mailbox) ? input.mailbox : buildAgentMailbox(input);
  const graph = isPlainObject(input.graph) ? input.graph : buildAgentThreadGraph(input);
  const writeKindCandidate = normalizeString(input.writeKind, "send_message");
  const writeKind = MAILBOX_WRITE_KINDS.has(writeKindCandidate) ? writeKindCandidate : "send_message";
  const targetAgentId = normalizeString(input.targetAgentId || input.childAgentId, graphNodes(graph)[0]?.agentThreadId || "");
  const targetExists = Boolean(targetAgentId && findNode(graph, targetAgentId));
  const sequence = nextMailboxSequence(mailbox);
  const payloadRef = normalizeEvidenceRef(input.payloadRef || {
    kind: writeKind === "followup_task" ? "followup_task_ref" : "agent_message_ref",
    id: input.payloadId || `${writeKind}_${sequence}`,
    digest: input.payloadDigest || "",
    label: writeKind === "followup_task" ? "Follow-up task payload" : "Agent message payload",
  }, writeKind === "followup_task" ? "followup_task_ref" : "agent_message_ref");
  const plan = {
    schema: DIRECT_AGENT_MAILBOX_WRITE_PLAN_SCHEMA,
    writePlanId: normalizeString(input.writePlanId, ""),
    projectId: normalizeString(input.projectId || mailbox.projectId || graph.projectId, ""),
    primaryThreadId: normalizeString(input.primaryThreadId || mailbox.primaryThreadId || graph.primaryThreadId, ""),
    graphId: normalizeString(graph.graphId || mailbox.graphId, ""),
    mailboxId: normalizeString(mailbox.mailboxId, ""),
    writeKind,
    messageKind: writeKind === "followup_task" ? "followup" : "parent_prompt",
    direction: "parent_to_child",
    parentAgentId: normalizeString(input.parentAgentId, graph.primaryThreadId || "primary_agent"),
    targetAgentId,
    targetExists,
    sequence,
    idempotencyKey: normalizeString(input.idempotencyKey, ""),
    payloadRef,
    mailboxSequenceLaw: normalizeString(mailbox.sequenceLaw, "strictly_increasing_per_mailbox"),
    mailboxIdempotencyLaw: normalizeString(mailbox.idempotencyLaw, "idempotency_key_required_per_message"),
    canAppend: targetExists && mailbox.sequenceValid === true && mailbox.duplicateMessageCount === 0,
    providerTransportAllowed: false,
    requestShapeMutationAllowed: false,
    childTranscriptPromotionAllowed: false,
    evidenceRefs: normalizeEvidenceRefs(input.evidenceRefs, "agent_mailbox_write_plan"),
    rawPayloadIncluded: false,
    rawPromptIncluded: false,
    rawSecretIncluded: false,
  };
  plan.idempotencyKey = plan.idempotencyKey || digestFor("direct-agent-mailbox-write-idempotency@1", {
    writeKind,
    parentAgentId: plan.parentAgentId,
    targetAgentId,
    sequence,
    payloadDigest: payloadRef.refDigest,
  });
  plan.writePlanId = plan.writePlanId || `agent_mailbox_write_${digestFor("direct-agent-mailbox-write-source@1", plan).slice(0, 24)}`;
  plan.writePlanDigest = digestFor("direct-agent-mailbox-write-plan@1", plan);
  return plan;
}

function buildAgentInterruptRequest(input = {}) {
  const graph = isPlainObject(input.graph) ? input.graph : buildAgentThreadGraph(input);
  const targetAgentId = normalizeString(input.targetAgentId || input.childAgentId, graphNodes(graph)[0]?.agentThreadId || "");
  const targetExists = Boolean(targetAgentId && findNode(graph, targetAgentId));
  const request = {
    schema: DIRECT_AGENT_INTERRUPT_REQUEST_SCHEMA,
    interruptRequestId: normalizeString(input.interruptRequestId, ""),
    projectId: normalizeString(input.projectId || graph.projectId, ""),
    primaryThreadId: normalizeString(input.primaryThreadId || graph.primaryThreadId, ""),
    graphId: normalizeString(graph.graphId, ""),
    targetAgentId,
    targetExists,
    requestState: targetExists ? "mark_requested_only" : "blocked_target_missing",
    markRequestedAllowed: targetExists,
    providerCancelAllowed: false,
    processKillAllowed: false,
    mailboxReplayAllowed: false,
    partialOutputRecoveryRequired: targetExists,
    providerPrimitiveEvidenceRef: null,
    blockerCodes: targetExists ? ["provider_cancel_primitive_missing"] : ["target_agent_missing", "provider_cancel_primitive_missing"],
    evidenceRefs: normalizeEvidenceRefs(input.evidenceRefs, "agent_interrupt_request"),
    rawTranscriptIncluded: false,
    rawSecretIncluded: false,
  };
  request.interruptRequestId = request.interruptRequestId || `agent_interrupt_${digestFor("direct-agent-interrupt-source@1", request).slice(0, 24)}`;
  request.interruptRequestDigest = digestFor("direct-agent-interrupt-request@1", request);
  return request;
}

function buildTextOnlySubAgentToolSurface(input = {}) {
  const graph = isPlainObject(input.graph) ? input.graph : buildAgentThreadGraph(input);
  const mailbox = isPlainObject(input.mailbox) ? input.mailbox : buildAgentMailbox({
    projectId: graph.projectId,
    primaryThreadId: graph.primaryThreadId,
    graphId: graph.graphId,
    messages: input.messages,
  });
  const lifecycleRegistry = isPlainObject(input.lifecycleRegistry) ? input.lifecycleRegistry : { entries: [] };
  const runtimeRegistry = isPlainObject(input.runtimeRegistry) ? input.runtimeRegistry : buildAgentRuntimeRegistry({
    projectId: graph.projectId,
    primaryThreadId: graph.primaryThreadId,
  });
  const agentClassRegistry = isPlainObject(input.agentClassRegistry) ? input.agentClassRegistry : buildAgentClassRegistry({
    projectId: graph.projectId,
  });
  const listProjection = buildSubAgentListProjection({
    projectId: graph.projectId,
    primaryThreadId: graph.primaryThreadId,
    graph,
    lifecycleRegistry,
  });
  const spawnRequest = buildTextSubAgentSpawnRequest({
    projectId: graph.projectId,
    primaryThreadId: graph.primaryThreadId,
    graph,
    mailbox,
    runtimeRegistry,
    agentClassRegistry,
    ...(isPlainObject(input.spawnRequest) ? input.spawnRequest : {}),
  });
  const waitPlan = buildAgentWaitPlan({
    projectId: graph.projectId,
    primaryThreadId: graph.primaryThreadId,
    graph,
    lifecycleRegistry,
    ...(isPlainObject(input.waitPlan) ? input.waitPlan : {}),
  });
  const sendMessagePlan = buildAgentMailboxWritePlan({
    projectId: graph.projectId,
    primaryThreadId: graph.primaryThreadId,
    graph,
    mailbox,
    writeKind: "send_message",
    ...(isPlainObject(input.sendMessagePlan) ? input.sendMessagePlan : {}),
  });
  const followupTaskPlan = buildAgentMailboxWritePlan({
    projectId: graph.projectId,
    primaryThreadId: graph.primaryThreadId,
    graph,
    mailbox,
    writeKind: "followup_task",
    ...(isPlainObject(input.followupTaskPlan) ? input.followupTaskPlan : {}),
  });
  const interruptRequest = buildAgentInterruptRequest({
    projectId: graph.projectId,
    primaryThreadId: graph.primaryThreadId,
    graph,
    ...(isPlainObject(input.interruptRequest) ? input.interruptRequest : {}),
  });
  const surface = {
    schema: DIRECT_TEXT_SUB_AGENT_TOOL_SURFACE_SCHEMA,
    surfaceId: normalizeString(input.surfaceId, ""),
    projectId: normalizeString(input.projectId || graph.projectId, ""),
    primaryThreadId: normalizeString(input.primaryThreadId || graph.primaryThreadId, ""),
    mode: "text_only_sub_agent_tool_surface",
    graphId: normalizeString(graph.graphId, ""),
    graphDigest: normalizeString(graph.graphDigest, ""),
    mailboxId: normalizeString(mailbox.mailboxId, ""),
    mailboxDigest: normalizeString(mailbox.mailboxDigest, ""),
    listProjection,
    spawnRequest,
    waitPlan,
    sendMessagePlan,
    followupTaskPlan,
    interruptRequest,
    listAgentsToolEnabledInThisPr: true,
    spawnAgentTextOnlyEnabledInThisPr: spawnRequest.acceptedAsTextOnlyIntent === true,
    waitAgentToolEnabledInThisPr: waitPlan.noDeadlockLawSatisfied === true,
    sendMessageToolEnabledInThisPr: sendMessagePlan.canAppend === true,
    followupTaskToolEnabledInThisPr: followupTaskPlan.canAppend === true,
    interruptAgentMarkRequestedEnabledInThisPr: interruptRequest.markRequestedAllowed === true,
    interruptAgentProviderCancelEnabledInThisPr: false,
    childToolsAllowed: false,
    recursiveSpawnAllowed: false,
    inheritedParentAuthorityAllowed: false,
    providerDeclarationAllowed: false,
    providerTransportAllowed: false,
    requestShapeMutationAllowed: false,
    childTranscriptPromotionAllowed: false,
    parentSpawnIntentMayClaimChildSuccess: false,
    separateUsageAttributionRequired: true,
    rendererSafeSummary: boundedString(input.rendererSafeSummary || "Text-only sub-agent surface exposes graph/list, spawn intent, bounded wait, and mailbox-plan evidence without provider tool declarations or recursive authority.", 420),
    evidenceRefs: normalizeEvidenceRefs(input.evidenceRefs, "text_sub_agent_tool_surface"),
    rawPromptIncluded: false,
    rawTranscriptIncluded: false,
    rawProviderFrameIncluded: false,
    rawSecretIncluded: false,
    generatedAt: normalizeString(input.generatedAt, nowIso(input.nowMs)),
  };
  surface.surfaceId = surface.surfaceId || `text_sub_agent_surface_${digestFor("direct-text-sub-agent-surface-source@1", surface).slice(0, 24)}`;
  surface.surfaceDigest = digestFor("direct-text-sub-agent-tool-surface@1", surface);
  return surface;
}

function assertTextOnlySubAgentToolSurfaceSafe(surface = {}) {
  if (!isPlainObject(surface) || surface.schema !== DIRECT_TEXT_SUB_AGENT_TOOL_SURFACE_SCHEMA) {
    throw new Error("direct_text_sub_agent_tool_surface_schema_mismatch");
  }
  for (const flag of [
    "interruptAgentProviderCancelEnabledInThisPr",
    "childToolsAllowed",
    "recursiveSpawnAllowed",
    "inheritedParentAuthorityAllowed",
    "providerDeclarationAllowed",
    "providerTransportAllowed",
    "requestShapeMutationAllowed",
    "childTranscriptPromotionAllowed",
    "parentSpawnIntentMayClaimChildSuccess",
    "rawPromptIncluded",
    "rawTranscriptIncluded",
    "rawProviderFrameIncluded",
    "rawSecretIncluded",
  ]) {
    if (surface[flag] !== false) throw new Error(`direct_text_sub_agent_tool_surface_authority_leak:${flag}`);
  }
  if (surface.listAgentsToolEnabledInThisPr !== true) throw new Error("direct_text_sub_agent_list_disabled");
  if (surface.spawnAgentTextOnlyEnabledInThisPr !== true) throw new Error("direct_text_sub_agent_spawn_not_accepted");
  if (surface.waitAgentToolEnabledInThisPr !== true) throw new Error("direct_text_sub_agent_wait_not_bounded");
  if (surface.separateUsageAttributionRequired !== true) throw new Error("direct_text_sub_agent_usage_attribution_missing");
  if (surface.spawnRequest?.acceptedAsTextOnlyIntent !== true) throw new Error("direct_text_sub_agent_spawn_request_blocked");
  if (surface.spawnRequest?.childToolsAllowed !== false || surface.spawnRequest?.childRecursiveSpawnAllowed !== false) {
    throw new Error("direct_text_sub_agent_spawn_authority_leak");
  }
  if (surface.waitPlan?.noDeadlockLawSatisfied !== true || surface.waitPlan?.cycleCheck !== "passed") {
    throw new Error("direct_text_sub_agent_wait_deadlock_risk");
  }
  for (const plan of [surface.sendMessagePlan, surface.followupTaskPlan]) {
    if (plan?.schema !== DIRECT_AGENT_MAILBOX_WRITE_PLAN_SCHEMA) throw new Error("direct_text_sub_agent_mailbox_write_missing");
    if (plan.providerTransportAllowed !== false || plan.requestShapeMutationAllowed !== false) {
      throw new Error("direct_text_sub_agent_mailbox_authority_leak");
    }
  }
  if (surface.interruptRequest?.providerCancelAllowed !== false || surface.interruptRequest?.processKillAllowed !== false) {
    throw new Error("direct_text_sub_agent_interrupt_authority_leak");
  }
  return true;
}

module.exports = {
  DIRECT_AGENT_INTERRUPT_REQUEST_SCHEMA,
  DIRECT_AGENT_MAILBOX_WRITE_PLAN_SCHEMA,
  DIRECT_AGENT_WAIT_PLAN_SCHEMA,
  DIRECT_SUB_AGENT_LIST_PROJECTION_SCHEMA,
  DIRECT_TEXT_SUB_AGENT_SPAWN_REQUEST_SCHEMA,
  DIRECT_TEXT_SUB_AGENT_TOOL_SURFACE_SCHEMA,
  assertTextOnlySubAgentToolSurfaceSafe,
  buildAgentInterruptRequest,
  buildAgentMailboxWritePlan,
  buildAgentWaitPlan,
  buildSubAgentListProjection,
  buildTextOnlySubAgentToolSurface,
  buildTextSubAgentSpawnRequest,
};
