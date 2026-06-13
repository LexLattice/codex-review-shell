"use strict";

const crypto = require("node:crypto");

const DIRECT_SUB_AGENT_INSPECT_PACKET_SCHEMA = "direct_sub_agent_inspect_packet@1";
const DIRECT_SUB_AGENT_WAIT_STATUS_PACKET_SCHEMA = "direct_sub_agent_wait_status_packet@1";
const DIRECT_SUB_AGENT_CONTAINED_TAB_PROJECTION_SCHEMA = "direct_sub_agent_contained_tab_projection@1";

const LIFECYCLE_STATES = new Set(["discovered", "starting", "running", "waiting", "completed", "failed", "closed", "stale", "not_found", "unknown"]);
const ACTIVITY_STATES = new Set(["idle", "active", "responding", "blocked", "attention_required", "unknown"]);
const WAIT_STATES = new Set(["not_waiting", "waiting", "completed", "failed", "stale", "deadlock_risk", "unknown"]);
const ATTENTION_STATES = new Set(["none", "active", "blocked", "failed", "stale", "unknown"]);
const INSPECT_REASONS = new Set(["operator_focus", "attention_badge", "wait_status_refresh", "stale_diagnostic", "fixture"]);

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype;
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function boundedString(value, maxLength = 280) {
  const text = normalizeString(value, "");
  return text.length > maxLength ? `${text.slice(0, Math.max(0, maxLength - 1)).trim()}…` : text;
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
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => (entry === undefined ? "null" : stableStringify(entry))).join(",")}]`;
  return `{${Object.keys(value)
    .filter((key) => value[key] !== undefined && !["artifactDigest", "inspectPacketDigest", "waitStatusPacketDigest", "projectionDigest", "refDigest"].includes(key))
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(",")}}`;
}

function digestFor(domain, value) {
  return `sha256:${crypto.createHash("sha256").update(`${domain}\0${stableStringify(value)}`).digest("hex")}`;
}

function normalizeEvidenceRef(input = {}, fallbackKind = "sub_agent_containment") {
  const source = isPlainObject(input) ? input : {};
  const ref = {
    kind: normalizeString(source.kind || source.refKind, fallbackKind),
    id: normalizeString(source.id || source.refId || source.artifactId, ""),
    digest: normalizeString(source.digest || source.artifactDigest || source.sourceDigest || source.refDigest, ""),
    label: boundedString(source.label || source.rendererSafeLabel || source.kind || fallbackKind, 180),
    confidence: normalizeString(source.confidence || source.sourceConfidence, "diagnostic"),
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  ref.refDigest = digestFor("direct-sub-agent-containment-ref@1", ref);
  return ref;
}

function normalizeEvidenceRefs(values, fallbackKind = "sub_agent_containment") {
  return arrayOrEmpty(values)
    .filter((value) => isPlainObject(value) && (
      value.id ||
      value.refId ||
      value.artifactId ||
      value.digest ||
      value.artifactDigest ||
      value.sourceDigest ||
      value.label ||
      value.rendererSafeLabel ||
      value.kind
    ))
    .map((value) => normalizeEvidenceRef(value, fallbackKind));
}

function normalizeAgentNode(input = {}, index = 0) {
  const source = isPlainObject(input) ? input : {};
  const agentThreadId = normalizeString(source.agentThreadId || source.providerThreadId || source.threadId, `agent_${index + 1}`);
  const label = normalizeString(source.displayLabel || source.nickname || source.role, agentThreadId ? `Agent ${agentThreadId.slice(0, 8)}` : `Agent ${index + 1}`);
  const lifecycleState = LIFECYCLE_STATES.has(source.lifecycleState) ? source.lifecycleState : "unknown";
  const activityState = ACTIVITY_STATES.has(source.activityState) ? source.activityState : "unknown";
  return {
    agentThreadId,
    agentNodeId: normalizeString(source.agentNodeId || source.workerNodeId, `agent_node_${digestFor("direct-agent-node-id@1", agentThreadId).slice(7, 23)}`),
    parentThreadId: normalizeString(source.parentThreadId || source.parentProviderThreadId, ""),
    displayLabel: boundedString(label, 160),
    role: boundedString(source.role, 120),
    nickname: boundedString(source.nickname, 120),
    model: normalizeString(source.model, ""),
    reasoningEffort: normalizeString(source.reasoningEffort, ""),
    serviceTier: normalizeString(source.serviceTier, ""),
    lifecycleState,
    activityState,
    identityConfidence: normalizeString(source.identityResolution?.confidence || source.labelConfidence || source.agentClassMappingConfidence, "unknown"),
    transcriptProjectionId: normalizeString(source.transcriptProjectionId, ""),
    progressWitnessId: normalizeString(source.progressWitnessId, ""),
    evidenceRefs: normalizeEvidenceRefs(source.evidenceRefs, "agent_node"),
  };
}

function normalizeTranscriptProjection(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const items = arrayOrEmpty(source.rendererSafeItems).map((item, index) => {
    const rendererSafeTextPreview = normalizeString(item.rendererSafeTextPreview, "");
    return {
      itemId: normalizeString(item.itemId, `sub_agent_item_${index + 1}`),
      sourceItemId: normalizeString(item.sourceItemId, ""),
      authorKind: ["parent_agent", "child_agent", "harness_controller", "tool", "system", "unknown_agent"].includes(item.authorKind) ? item.authorKind : "unknown_agent",
      rendererSafeTextPreview: boundedString(rendererSafeTextPreview, 900),
      textTruncated: item.textTruncated === true || rendererSafeTextPreview.length > 900,
      evidenceRefs: normalizeEvidenceRefs(item.evidenceRefs, "transcript_projection"),
    };
  });
  return {
    transcriptProjectionId: normalizeString(source.transcriptProjectionId, ""),
    itemCount: finiteNumber(source.itemCount, items.length),
    hasMore: source.hasMore === true,
    itemsTruncated: source.itemsTruncated === true,
    rendererSafeItems: items,
    rawTranscriptIncluded: false,
    rawProviderFrameIncluded: false,
    rawHostPathIncluded: false,
  };
}

function progressEntryFor(agentThreadId, progressRegistry = {}) {
  return arrayOrEmpty(progressRegistry.entries).find((entry) => entry.agentThreadId === agentThreadId) || null;
}

function witnessFor(agentThreadId, witnesses = []) {
  return arrayOrEmpty(witnesses).find((entry) => entry.agentThreadId === agentThreadId) || null;
}

function attentionStateFor(node = {}, progressEntry = {}, witness = {}) {
  const phase = normalizeString(progressEntry?.phase || witness?.phase || node.lifecycleState, "unknown");
  const blockers = arrayOrEmpty(progressEntry?.blockerCodes);
  if (phase === "failed" || node.lifecycleState === "failed") return "failed";
  if (phase === "stale" || node.lifecycleState === "stale") return "stale";
  if (blockers.length || node.activityState === "blocked" || node.activityState === "attention_required") return "blocked";
  if (["running", "waiting"].includes(phase) || ["active", "responding"].includes(node.activityState)) return "active";
  if (["completed", "closed"].includes(phase) || ["completed", "closed"].includes(node.lifecycleState)) return "none";
  return "unknown";
}

function waitStateFor(node = {}, progressEntry = {}, options = {}) {
  const phase = normalizeString(progressEntry?.phase || node.lifecycleState, "unknown");
  const blockers = arrayOrEmpty(progressEntry?.blockerCodes);
  if (phase === "failed" || node.lifecycleState === "failed") return "failed";
  if (phase === "stale" || node.lifecycleState === "stale") return "stale";
  if (phase === "completed" || node.lifecycleState === "completed" || node.lifecycleState === "closed") return "completed";
  if (blockers.includes("wait_deadlock_risk") || blockers.includes("deadlock_risk")) return "deadlock_risk";
  if (phase === "waiting") return "waiting";
  if (["running", "discovered", "created", "input_sent"].includes(phase)) return "not_waiting";
  if (options.deadlockRisk === true) return "deadlock_risk";
  return "unknown";
}

function buildStatusBadges(node = {}, progressEntry = {}, witness = {}) {
  const attentionState = attentionStateFor(node, progressEntry, witness);
  const badges = [];
  if (attentionState !== "none") badges.push(attentionState);
  const waitState = waitStateFor(node, progressEntry);
  if (["waiting", "deadlock_risk"].includes(waitState)) badges.push(waitState);
  if (node.identityConfidence === "unknown") badges.push("unknown_identity");
  return [...new Set(badges)];
}

function buildInspectPacket(input = {}) {
  const node = normalizeAgentNode(input.agentNode || input.node, 0);
  const progressRegistry = isPlainObject(input.progressRegistry) ? input.progressRegistry : {};
  const progressEntry = input.progressEntry || progressEntryFor(node.agentThreadId, progressRegistry) || {};
  const witness = input.progressWitness || witnessFor(node.agentThreadId, input.witnesses) || {};
  const transcriptProjection = normalizeTranscriptProjection(input.transcriptProjection);
  const reason = INSPECT_REASONS.has(input.inspectReason) ? input.inspectReason : "operator_focus";
  const sourceDigest = normalizeString(input.sourceDigest, digestFor("direct-sub-agent-inspect-source@1", {
    agentThreadId: node.agentThreadId,
    progressEntryId: progressEntry.progressEntryId || "",
    witnessId: witness.witnessId || "",
    transcriptProjectionId: transcriptProjection.transcriptProjectionId,
    reason,
  }));
  const packet = {
    schema: DIRECT_SUB_AGENT_INSPECT_PACKET_SCHEMA,
    inspectPacketId: normalizeString(input.inspectPacketId, `sub_agent_inspect_${sourceDigest.slice(7, 31)}`),
    projectId: normalizeString(input.projectId, ""),
    workThreadId: normalizeString(input.workThreadId, ""),
    primaryThreadId: normalizeString(input.primaryThreadId, ""),
    agentGraphId: normalizeString(input.agentGraphId, ""),
    graphRevision: finiteNumber(input.graphRevision, 0),
    activationEpoch: finiteNumber(input.activationEpoch, 0),
    inspectReason: reason,
    requestedAgentThreadId: normalizeString(input.requestedAgentThreadId, node.agentThreadId),
    agent: node,
    lifecycleState: node.lifecycleState,
    activityState: node.activityState,
    progress: {
      progressEntryId: normalizeString(progressEntry.progressEntryId, ""),
      phase: normalizeString(progressEntry.phase || witness.phase || node.lifecycleState, "unknown"),
      blockerCodes: arrayOrEmpty(progressEntry.blockerCodes).map((item) => normalizeString(item, "")).filter(Boolean),
      transitionState: normalizeString(progressEntry.transitionState, ""),
      lastEventAt: normalizeString(progressEntry.lastEventAt, ""),
      lastEventDigest: normalizeString(progressEntry.lastEventDigest, ""),
      progressWitnessId: normalizeString(witness.witnessId || node.progressWitnessId, ""),
    },
    waitState: waitStateFor(node, progressEntry),
    attentionState: attentionStateFor(node, progressEntry, witness),
    statusBadges: buildStatusBadges(node, progressEntry, witness),
    transcriptProjection,
    childTranscriptRenderedAsOperator: false,
    childReplyRenderedAsPrimaryFinal: false,
    recursiveSpawnAllowed: false,
    sendInputAllowed: false,
    resumeAllowed: false,
    closeAllowed: false,
    autonomousScheduleAllowed: false,
    providerTransportAllowed: false,
    workspaceMutationAllowed: false,
    readOnly: true,
    rendererSafeSummary: boundedString(input.rendererSafeSummary || `${node.displayLabel}: ${node.lifecycleState}/${node.activityState}`, 240),
    evidenceRefs: normalizeEvidenceRefs([
      { kind: "agent_graph", id: normalizeString(input.agentGraphId, ""), digest: normalizeString(input.agentGraphDigest, ""), confidence: "diagnostic" },
      { kind: "progress_registry", id: normalizeString(progressRegistry.progressRegistryId, ""), digest: normalizeString(progressRegistry.integrity?.artifactDigest || progressRegistry.sourceDigest, ""), confidence: "diagnostic" },
      ...arrayOrEmpty(input.evidenceRefs),
    ], "sub_agent_inspect"),
    sourceDigest,
    rawTranscriptIncluded: false,
    rawPromptIncluded: false,
    rawProviderFrameIncluded: false,
    rawPathIncluded: false,
  };
  packet.inspectPacketDigest = digestFor("direct-sub-agent-inspect-packet@1", packet);
  return packet;
}

function buildWaitStatusPacket(input = {}) {
  const inspectPacket = isPlainObject(input.inspectPacket) ? input.inspectPacket : buildInspectPacket(input);
  const waitState = WAIT_STATES.has(input.waitState) ? input.waitState : waitStateFor(inspectPacket.agent, inspectPacket.progress, input);
  const blockerCodes = [
    ...arrayOrEmpty(inspectPacket.progress?.blockerCodes),
    ...arrayOrEmpty(input.blockerCodes),
  ].map((item) => normalizeString(item, "")).filter(Boolean);
  if (waitState === "deadlock_risk" && !blockerCodes.includes("wait_deadlock_risk")) blockerCodes.push("wait_deadlock_risk");
  if (waitState === "stale" && !blockerCodes.includes("stale_worker")) blockerCodes.push("stale_worker");
  if (waitState === "failed" && !blockerCodes.includes("worker_failed")) blockerCodes.push("worker_failed");
  const sourceDigest = normalizeString(input.sourceDigest, digestFor("direct-sub-agent-wait-status-source@1", {
    inspectPacketDigest: inspectPacket.inspectPacketDigest,
    waitState,
    blockerCodes,
  }));
  const packet = {
    schema: DIRECT_SUB_AGENT_WAIT_STATUS_PACKET_SCHEMA,
    waitStatusPacketId: normalizeString(input.waitStatusPacketId, `sub_agent_wait_${sourceDigest.slice(7, 31)}`),
    projectId: inspectPacket.projectId,
    workThreadId: inspectPacket.workThreadId,
    primaryThreadId: inspectPacket.primaryThreadId,
    agentThreadId: inspectPacket.agent.agentThreadId,
    inspectPacketId: inspectPacket.inspectPacketId,
    inspectPacketDigest: inspectPacket.inspectPacketDigest,
    waitState,
    waitReadable: true,
    waitOperationStarted: false,
    waitOperationAuthorityGranted: false,
    providerWaitToolCalled: false,
    appServerMutationUsed: false,
    recursiveControlAllowed: false,
    autonomousScheduleAllowed: false,
    blockerCodes,
    rendererSafeSummary: boundedString(input.rendererSafeSummary || `${inspectPacket.agent.displayLabel}: wait status ${waitState}`, 220),
    evidenceRefs: normalizeEvidenceRefs(input.evidenceRefs, "sub_agent_wait_status"),
    sourceDigest,
    rawTranscriptIncluded: false,
    rawPromptIncluded: false,
    rawProviderFrameIncluded: false,
    rawPathIncluded: false,
  };
  packet.waitStatusPacketDigest = digestFor("direct-sub-agent-wait-status-packet@1", packet);
  return packet;
}

function buildContainedTabProjection(input = {}) {
  const graph = isPlainObject(input.agentGraph) ? input.agentGraph : {};
  const progressRegistry = isPlainObject(input.progressRegistry) ? input.progressRegistry : {};
  const transcriptsByAgent = new Map(arrayOrEmpty(input.transcriptProjections).map((projection) => [normalizeString(projection.agentThreadId, ""), projection]));
  const witnesses = arrayOrEmpty(input.witnesses);
  const inspectPackets = arrayOrEmpty(graph.nodes).map((node, index) => buildInspectPacket({
    projectId: input.projectId || graph.projectId,
    workThreadId: input.workThreadId,
    primaryThreadId: input.primaryThreadId || graph.primaryThreadId,
    agentGraphId: graph.agentGraphId,
    agentGraphDigest: graph.integrity?.artifactDigest || graph.sourceDigest,
    graphRevision: graph.graphRevision,
    activationEpoch: graph.activationEpoch,
    agentNode: node,
    requestedAgentThreadId: node.agentThreadId,
    progressRegistry,
    progressWitness: witnessFor(node.agentThreadId, witnesses),
    transcriptProjection: transcriptsByAgent.get(node.agentThreadId),
    inspectReason: index === 0 ? "attention_badge" : "operator_focus",
  }));
  const waitStatusPackets = inspectPackets.map((inspectPacket) => buildWaitStatusPacket({ inspectPacket }));
  const selected = inspectPackets.find((packet) => ["active", "blocked", "failed", "stale"].includes(packet.attentionState)) || inspectPackets[0] || null;
  const tabRows = inspectPackets.map((packet) => ({
    agentThreadId: packet.agent.agentThreadId,
    displayLabel: packet.agent.displayLabel,
    role: packet.agent.role,
    model: packet.agent.model,
    reasoningEffort: packet.agent.reasoningEffort,
    lifecycleState: packet.lifecycleState,
    activityState: packet.activityState,
    waitState: packet.waitState,
    attentionState: packet.attentionState,
    statusBadges: packet.statusBadges,
    selected: selected?.agent.agentThreadId === packet.agent.agentThreadId,
    inspectPacketId: packet.inspectPacketId,
    inspectPacketDigest: packet.inspectPacketDigest,
  }));
  const counts = {
    total: tabRows.length,
    active: tabRows.filter((row) => row.attentionState === "active").length,
    blocked: tabRows.filter((row) => row.attentionState === "blocked").length,
    failed: tabRows.filter((row) => row.attentionState === "failed").length,
    stale: tabRows.filter((row) => row.attentionState === "stale").length,
    unknownIdentity: tabRows.filter((row) => row.statusBadges.includes("unknown_identity")).length,
  };
  const sourceDigest = normalizeString(input.sourceDigest, digestFor("direct-sub-agent-contained-tab-source@1", {
    graphDigest: graph.integrity?.artifactDigest || graph.sourceDigest || "",
    inspectDigests: inspectPackets.map((packet) => packet.inspectPacketDigest),
    waitDigests: waitStatusPackets.map((packet) => packet.waitStatusPacketDigest),
  }));
  const projection = {
    schema: DIRECT_SUB_AGENT_CONTAINED_TAB_PROJECTION_SCHEMA,
    projectionId: normalizeString(input.projectionId, `sub_agent_tab_${sourceDigest.slice(7, 31)}`),
    projectId: normalizeString(input.projectId || graph.projectId, ""),
    workThreadId: normalizeString(input.workThreadId, ""),
    primaryThreadId: normalizeString(input.primaryThreadId || graph.primaryThreadId, ""),
    agentGraphId: normalizeString(graph.agentGraphId, ""),
    graphRevision: finiteNumber(graph.graphRevision, 0),
    activationEpoch: finiteNumber(graph.activationEpoch, 0),
    selectedAgentThreadId: selected?.agent.agentThreadId || "",
    tabRows,
    inspectPackets,
    waitStatusPackets,
    counts,
    rightPaneMutationAllowed: false,
    childTranscriptRenderedAsOperator: false,
    childReplyRenderedAsPrimaryFinal: false,
    recursiveSpawnAllowed: false,
    sendInputAllowed: false,
    resumeAllowed: false,
    closeAllowed: false,
    autonomousScheduleAllowed: false,
    providerTransportAllowed: false,
    workspaceMutationAllowed: false,
    rendererSafeSummary: boundedString(input.rendererSafeSummary || `Projected ${tabRows.length} contained sub-agent tab(s).`, 220),
    sourceDigest,
    rawTranscriptIncluded: false,
    rawPromptIncluded: false,
    rawProviderFrameIncluded: false,
    rawPathIncluded: false,
  };
  projection.projectionDigest = digestFor("direct-sub-agent-contained-tab-projection@1", projection);
  return projection;
}

function validateInspectPacket(packet = {}) {
  if (!isPlainObject(packet) || packet.schema !== DIRECT_SUB_AGENT_INSPECT_PACKET_SCHEMA) throw new Error("direct_sub_agent_inspect_packet_schema_mismatch");
  for (const key of ["childTranscriptRenderedAsOperator", "childReplyRenderedAsPrimaryFinal", "recursiveSpawnAllowed", "sendInputAllowed", "resumeAllowed", "closeAllowed", "autonomousScheduleAllowed", "providerTransportAllowed", "workspaceMutationAllowed", "rawTranscriptIncluded", "rawPromptIncluded", "rawProviderFrameIncluded", "rawPathIncluded"]) {
    if (packet[key] !== false) throw new Error(`direct_sub_agent_inspect_packet_authority_leak:${key}`);
  }
  if (packet.readOnly !== true) throw new Error("direct_sub_agent_inspect_packet_not_readonly");
  for (const item of arrayOrEmpty(packet.transcriptProjection?.rendererSafeItems)) {
    if (item.authorKind === "operator" || item.authorKind === "primary_agent") throw new Error("direct_sub_agent_inspect_packet_child_flattened");
  }
  return true;
}

function validateWaitStatusPacket(packet = {}) {
  if (!isPlainObject(packet) || packet.schema !== DIRECT_SUB_AGENT_WAIT_STATUS_PACKET_SCHEMA) throw new Error("direct_sub_agent_wait_status_packet_schema_mismatch");
  if (!WAIT_STATES.has(packet.waitState)) throw new Error(`direct_sub_agent_wait_status_invalid:${packet.waitState || ""}`);
  for (const key of ["waitOperationStarted", "waitOperationAuthorityGranted", "providerWaitToolCalled", "appServerMutationUsed", "recursiveControlAllowed", "autonomousScheduleAllowed", "rawTranscriptIncluded", "rawPromptIncluded", "rawProviderFrameIncluded", "rawPathIncluded"]) {
    if (packet[key] !== false) throw new Error(`direct_sub_agent_wait_status_authority_leak:${key}`);
  }
  return true;
}

function validateContainedTabProjection(projection = {}) {
  if (!isPlainObject(projection) || projection.schema !== DIRECT_SUB_AGENT_CONTAINED_TAB_PROJECTION_SCHEMA) throw new Error("direct_sub_agent_contained_tab_projection_schema_mismatch");
  for (const key of ["rightPaneMutationAllowed", "childTranscriptRenderedAsOperator", "childReplyRenderedAsPrimaryFinal", "recursiveSpawnAllowed", "sendInputAllowed", "resumeAllowed", "closeAllowed", "autonomousScheduleAllowed", "providerTransportAllowed", "workspaceMutationAllowed", "rawTranscriptIncluded", "rawPromptIncluded", "rawProviderFrameIncluded", "rawPathIncluded"]) {
    if (projection[key] !== false) throw new Error(`direct_sub_agent_contained_tab_authority_leak:${key}`);
  }
  for (const packet of arrayOrEmpty(projection.inspectPackets)) validateInspectPacket(packet);
  for (const packet of arrayOrEmpty(projection.waitStatusPackets)) validateWaitStatusPacket(packet);
  return true;
}

module.exports = {
  DIRECT_SUB_AGENT_CONTAINED_TAB_PROJECTION_SCHEMA,
  DIRECT_SUB_AGENT_INSPECT_PACKET_SCHEMA,
  DIRECT_SUB_AGENT_WAIT_STATUS_PACKET_SCHEMA,
  buildContainedTabProjection,
  buildInspectPacket,
  buildWaitStatusPacket,
  validateContainedTabProjection,
  validateInspectPacket,
  validateWaitStatusPacket,
};
