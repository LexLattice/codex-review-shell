"use strict";

const crypto = require("node:crypto");

const DIRECT_AGENT_GRAPH_SCHEMA = "direct_agent_graph@1";
const DIRECT_AGENT_PROGRESS_REGISTRY_SCHEMA = "direct_agent_progress_registry@1";
const DIRECT_AGENT_PROGRESS_WITNESS_SCHEMA = "agent_progress_witness@1";
const DIRECT_AGENT_PROGRESS_INSPECTION_SCHEMA = "direct_agent_progress_inspection@1";
const DIRECT_AGENT_CONTAINMENT_PROFILE_SCHEMA = "direct_agent_containment_profile@1";
const DIRECT_SUB_AGENT_TRANSCRIPT_PROJECTION_SCHEMA = "direct_sub_agent_transcript_projection@1";
const DIRECT_AGENT_ATTENTION_PROJECTION_SCHEMA = "direct_agent_attention_projection@1";
const DIRECT_SUB_AGENT_OBSERVABILITY_REPORT_SCHEMA = "direct_sub_agent_observability_report@1";
const DIRECT_AGENT_OBSERVABILITY_VERSION = "direct-sub-agent-observability@1";

const RUNTIME_SOURCE_CLASSES = new Set([
  "codex_app_server_collab",
  "direct_harness_agent_run",
  "legacy_imported_evidence",
  "fixture",
  "unknown",
]);

const EVIDENCE_REF_KINDS = new Set([
  "session_metadata",
  "collab_tool_call",
  "agents_states",
  "agent_run_record",
  "thread_graph_projection",
  "progress_registry",
  "progress_witness",
  "transcript_projection",
  "containment_profile",
  "operation_ledger",
  "fixture",
]);

const SOURCE_CONFIDENCE = new Set(["exact", "accepted", "derived", "diagnostic", "future"]);
const IDENTITY_SOURCES = new Set(["thread_id", "agent_run_record", "agent_thread_ref", "collab_tool_call", "session_metadata", "fixture"]);
const IDENTITY_COLLISIONS = new Set(["none", "duplicate_label", "duplicate_thread_ref", "conflicting_sources", "unknown"]);
const LIFECYCLE_STATES = new Set(["discovered", "starting", "running", "waiting", "completed", "failed", "closed", "stale", "not_found", "unknown"]);
const ACTIVITY_STATES = new Set(["idle", "active", "responding", "blocked", "attention_required", "unknown"]);
const CONTAINMENT_STATES = new Set(["known_contained", "observed_external", "unknown", "violated", "not_applicable"]);
const EDGE_KINDS = new Set(["spawned_child", "sent_input", "resumed", "waited_on", "closed", "reported_progress", "derived_from_fixture"]);
const EDGE_STATUS = new Set(["in_progress", "completed", "failed", "unknown"]);
const PROGRESS_PHASES = new Set(["discovered", "created", "input_sent", "running", "waiting", "completed", "failed", "closed", "stale", "unknown"]);
const ATTENTION_STATES = new Set(["none", "unread", "active", "blocked", "failed", "stale", "unknown"]);
const ATTENTION_PROJECTION_STATES = new Set(["none", "unread", "active", "failed", "blocked", "stale"]);
const MODEL_SAFE_USES = new Set(["future_tool_candidate_only", "diagnostic_only", "blocked"]);

const PROGRESS_TRANSITIONS = {
  discovered: new Set(["created", "running", "unknown"]),
  created: new Set(["input_sent", "running", "failed", "stale"]),
  input_sent: new Set(["running", "waiting", "failed", "stale"]),
  running: new Set(["waiting", "completed", "failed", "stale"]),
  waiting: new Set(["running", "completed", "failed", "stale"]),
  completed: new Set(["closed", "stale"]),
  failed: new Set(["closed", "stale"]),
  closed: new Set(["stale"]),
  stale: new Set(["running", "completed", "failed", "closed", "unknown"]),
  unknown: new Set(["discovered", "created", "running", "waiting", "completed", "failed", "stale"]),
};

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function finiteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${Array.from(value).map((entry) => (entry === undefined ? "null" : stableStringify(entry))).join(",")}]`;
  return `{${Object.keys(value)
    .filter((key) => value[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(",")}}`;
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function artifactDigest(value) {
  return sha256(stableStringify(value));
}

function nowIso(nowMs = Date.now()) {
  return new Date(Number(nowMs) || Date.now()).toISOString();
}

function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}

function clipText(value, max = 240) {
  const text = String(value || "");
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 3))}...`;
}

function normalizeRuntimeSourceClass(value) {
  return RUNTIME_SOURCE_CLASSES.has(value) ? value : "unknown";
}

function normalizeEvidenceRef(input = {}) {
  const kind = EVIDENCE_REF_KINDS.has(input.kind) ? input.kind : "fixture";
  const ref = {
    kind,
    artifactId: normalizeString(input.artifactId, `${kind}_artifact`),
    artifactDigest: normalizeString(input.artifactDigest, sha256(`${kind}:${input.artifactId || ""}`)),
    sourceConfidence: SOURCE_CONFIDENCE.has(input.sourceConfidence) ? input.sourceConfidence : "diagnostic",
    rendererSafeLabel: normalizeString(input.rendererSafeLabel, kind),
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawChatGptUrlIncluded: false,
  };
  ref.refDigest = sha256(stableStringify(ref));
  return ref;
}

function normalizeEvidenceRefs(values) {
  return arrayValue(values).map((value) => normalizeEvidenceRef(value));
}

function buildAgentSourceSchemaRef(input = {}) {
  const sourceRef = {
    runtimeSourceClass: normalizeRuntimeSourceClass(input.runtimeSourceClass),
    codexVersion: normalizeString(input.codexVersion, ""),
    appServerSchemaGeneratedAt: normalizeString(input.appServerSchemaGeneratedAt, ""),
    appServerSchemaDigest: normalizeString(input.appServerSchemaDigest, ""),
    sourceNormalizerVersion: normalizeString(input.sourceNormalizerVersion, DIRECT_AGENT_OBSERVABILITY_VERSION),
    experimentalApiEnabled: input.experimentalApiEnabled === true,
  };
  sourceRef.sourceSchemaRefDigest = sha256(stableStringify(sourceRef));
  return sourceRef;
}

function buildAgentIdentityResolution(input = {}) {
  const source = IDENTITY_SOURCES.has(input.source) ? input.source : "thread_id";
  const identityKey = normalizeString(input.identityKey, input.agentThreadId || input.threadId || "");
  return {
    identityKey,
    source,
    confidence: ["exact", "derived", "diagnostic", "unknown"].includes(input.confidence) ? input.confidence : identityKey ? "exact" : "unknown",
    collisionState: IDENTITY_COLLISIONS.has(input.collisionState) ? input.collisionState : "none",
  };
}

function graphNodeId(agentThreadId, index = 0) {
  const id = normalizeString(agentThreadId, `agent_${index + 1}`);
  return `agent_node_${sha256(id).slice(0, 16)}`;
}

function displayLabelForNode(input = {}, index = 0) {
  const explicit = normalizeString(input.displayLabel || input.label, "");
  if (explicit) return explicit;
  const nickname = normalizeString(input.nickname, "");
  if (nickname) return nickname;
  const role = normalizeString(input.role, "");
  if (role) return role;
  const threadId = normalizeString(input.agentThreadId || input.threadId, "");
  return threadId ? `Agent ${threadId.slice(0, 8)}` : `Agent ${index + 1}`;
}

function normalizeGraphNode(input = {}, index = 0, duplicateLabelSet = new Set()) {
  const agentThreadId = normalizeString(input.agentThreadId || input.threadId, `agent_thread_${index + 1}`);
  const displayLabel = displayLabelForNode({ ...input, agentThreadId }, index);
  const suppliedIdentity = isPlainObject(input.identityResolution) ? input.identityResolution : {};
  const collisionState = suppliedIdentity.collisionState || (duplicateLabelSet.has(displayLabel) ? "duplicate_label" : "none");
  return {
    agentNodeId: normalizeString(input.agentNodeId, graphNodeId(agentThreadId, index)),
    agentThreadId,
    parentThreadId: normalizeString(input.parentThreadId, ""),
    depth: finiteNumber(input.depth, 0),
    role: normalizeString(input.role, ""),
    nickname: normalizeString(input.nickname, ""),
    displayLabel,
    identityResolution: buildAgentIdentityResolution({ ...suppliedIdentity, agentThreadId, collisionState }),
    labelConfidence: ["thread_metadata", "collab_tool_call", "harness_record", "fixture", "unknown"].includes(input.labelConfidence) ? input.labelConfidence : "unknown",
    lifecycleState: LIFECYCLE_STATES.has(input.lifecycleState) ? input.lifecycleState : "discovered",
    activityState: ACTIVITY_STATES.has(input.activityState) ? input.activityState : "unknown",
    transcriptProjectionId: normalizeString(input.transcriptProjectionId, ""),
    progressWitnessId: normalizeString(input.progressWitnessId, ""),
    containmentState: CONTAINMENT_STATES.has(input.containmentState) ? input.containmentState : "unknown",
    evidenceRefs: normalizeEvidenceRefs(input.evidenceRefs),
  };
}

function normalizeGraphEdge(input = {}, index = 0, nodeByThreadId = new Map()) {
  const edgeKind = EDGE_KINDS.has(input.edgeKind) ? input.edgeKind : "derived_from_fixture";
  const parentThreadId = normalizeString(input.parentThreadId, "");
  const childThreadId = normalizeString(input.childThreadId, "");
  const parentNode = nodeByThreadId.get(parentThreadId);
  const childNode = nodeByThreadId.get(childThreadId);
  let sourceAgentNodeId = normalizeString(input.sourceAgentNodeId, parentNode?.agentNodeId || "");
  let targetAgentNodeId = normalizeString(input.targetAgentNodeId, childNode?.agentNodeId || "");
  if (edgeKind === "reported_progress") {
    sourceAgentNodeId = normalizeString(input.sourceAgentNodeId, childNode?.agentNodeId || sourceAgentNodeId);
    targetAgentNodeId = normalizeString(input.targetAgentNodeId, parentNode?.agentNodeId || targetAgentNodeId);
  }
  return {
    edgeId: normalizeString(input.edgeId, `agent_edge_${sha256(`${edgeKind}:${parentThreadId}:${childThreadId}:${index}`).slice(0, 20)}`),
    edgeKind,
    sourceAgentNodeId,
    targetAgentNodeId,
    parentThreadId,
    childThreadId,
    sourceCallId: normalizeString(input.sourceCallId, ""),
    status: EDGE_STATUS.has(input.status) ? input.status : "unknown",
    systemOwned: true,
    removableByUser: false,
    evidenceRefs: normalizeEvidenceRefs(input.evidenceRefs),
  };
}

function detectCycles(nodes, edges) {
  const adjacency = new Map(nodes.map((node) => [node.agentNodeId, []]));
  for (const edge of edges) {
    if (edge.edgeKind === "derived_from_fixture" || edge.edgeKind === "reported_progress") continue;
    if (adjacency.has(edge.sourceAgentNodeId)) adjacency.get(edge.sourceAgentNodeId).push(edge.targetAgentNodeId);
  }
  const visiting = new Set();
  const visited = new Set();
  function visit(nodeId) {
    if (!nodeId) return false;
    if (visiting.has(nodeId)) return true;
    if (visited.has(nodeId)) return false;
    visiting.add(nodeId);
    for (const next of adjacency.get(nodeId) || []) {
      if (visit(next)) return true;
    }
    visiting.delete(nodeId);
    visited.add(nodeId);
    return false;
  }
  return nodes.some((node) => visit(node.agentNodeId));
}

function graphCounts(nodes) {
  const counts = { total: nodes.length, active: 0, waiting: 0, completed: 0, failed: 0, stale: 0, unknown: 0 };
  for (const node of nodes) {
    if (node.lifecycleState === "running" || node.activityState === "active" || node.activityState === "responding") counts.active += 1;
    else if (node.lifecycleState === "waiting") counts.waiting += 1;
    else if (node.lifecycleState === "completed" || node.lifecycleState === "closed") counts.completed += 1;
    else if (node.lifecycleState === "failed") counts.failed += 1;
    else if (node.lifecycleState === "stale") counts.stale += 1;
    else counts.unknown += 1;
  }
  return counts;
}

function buildContainmentProfile(input = {}) {
  const runtimeSourceClass = normalizeRuntimeSourceClass(input.runtimeSourceClass);
  const containmentEvidence = {
    source: ["direct_capability_profile", "app_server_observed_metadata", "fork_capability_profile", "fixture", "unknown"].includes(input.containmentEvidence?.source || input.profileSource)
      ? (input.containmentEvidence?.source || input.profileSource)
      : "unknown",
    sourceConfidence: ["exact", "derived", "diagnostic", "future"].includes(input.containmentEvidence?.sourceConfidence) ? input.containmentEvidence.sourceConfidence : "diagnostic",
    schemaRef: isPlainObject(input.containmentEvidence?.schemaRef) ? buildAgentSourceSchemaRef(input.containmentEvidence.schemaRef) : undefined,
  };
  const profileCore = {
    projectId: normalizeString(input.projectId, ""),
    runtimeSourceClass,
    profileSource: containmentEvidence.source,
    appliesToAgentThreadIds: arrayValue(input.appliesToAgentThreadIds).map((value) => normalizeString(value, "")).filter(Boolean).sort(),
    toolSurfaceVisibility: ["none", "observed_only", "declared_bounded", "unknown"].includes(input.toolSurfaceVisibility) ? input.toolSurfaceVisibility : "unknown",
    containmentEvidence,
    policyVersion: DIRECT_AGENT_OBSERVABILITY_VERSION,
  };
  const profileDigest = normalizeString(input.profileDigest, sha256(stableStringify(profileCore)));
  return finalizeArtifact({
    schema: DIRECT_AGENT_CONTAINMENT_PROFILE_SCHEMA,
    containmentProfileId: normalizeString(input.containmentProfileId, `agent_containment_${profileDigest.slice(0, 24)}`),
    ...profileCore,
    profileDigest,
    spawnAllowedInThisPr: false,
    sendInputAllowedInThisPr: false,
    waitAllowedInThisPr: false,
    closeAllowedInThisPr: false,
    recursiveDelegationAllowedInThisPr: false,
    implementationLaneToolsGrantedByThisProfile: false,
    providerTransportGrantedByThisProfile: false,
    workspaceMutationGrantedByThisProfile: false,
    networkGrantedByThisProfile: false,
    rendererSafeSummary: normalizeString(input.rendererSafeSummary, profileCore.toolSurfaceVisibility === "unknown" ? "Sub-agent containment is unknown and diagnostic only." : "Sub-agent containment is visible but grants no authority."),
    rawConfigIncluded: false,
    rawPromptIncluded: false,
    integrity: { algorithm: "sha256", sourceDigest: profileDigest, artifactDigest: "" },
  });
}

function finalizeArtifact(artifact) {
  if (!artifact.integrity) artifact.integrity = { algorithm: "sha256", sourceDigest: artifact.sourceDigest || "", artifactDigest: "" };
  artifact.integrity.artifactDigest = artifactDigest({ ...artifact, integrity: { ...artifact.integrity, artifactDigest: "" } });
  return artifact;
}

function buildAgentGraph(input = {}) {
  const runtimeSourceClass = normalizeRuntimeSourceClass(input.runtimeSourceClass);
  const labelCounts = new Map();
  for (const rawNode of arrayValue(input.nodes)) {
    const label = displayLabelForNode(rawNode, 0);
    labelCounts.set(label, (labelCounts.get(label) || 0) + 1);
  }
  const duplicateLabels = new Set([...labelCounts.entries()].filter(([, count]) => count > 1).map(([label]) => label));
  const nodes = arrayValue(input.nodes).map((node, index) => normalizeGraphNode(node, index, duplicateLabels));
  const nodeByThreadId = new Map(nodes.map((node) => [node.agentThreadId, node]));
  const edges = arrayValue(input.edges).map((edge, index) => normalizeGraphEdge(edge, index, nodeByThreadId));
  const edgeTopologyDigestInput = edges
    .map((edge) => ({
      edgeKind: edge.edgeKind,
      sourceAgentNodeId: edge.sourceAgentNodeId,
      targetAgentNodeId: edge.targetAgentNodeId,
      parentThreadId: edge.parentThreadId,
      childThreadId: edge.childThreadId,
      status: edge.status,
    }))
    .sort((left, right) => stableStringify(left).localeCompare(stableStringify(right)));
  const sourceSchemaRef = buildAgentSourceSchemaRef(input.sourceSchemaRef || { runtimeSourceClass });
  const sourceSchemaRefDigest = normalizeString(input.sourceSchemaRefDigest, sourceSchemaRef.sourceSchemaRefDigest || sha256(stableStringify(sourceSchemaRef)));
  const digestInput = {
    schema: "direct_agent_graph_source@1",
    projectId: normalizeString(input.projectId, ""),
    primaryThreadId: normalizeString(input.primaryThreadId, ""),
    runtimeSourceClass,
    sourceEventDigests: arrayValue(input.sourceEventDigests).map((value) => normalizeString(value, "")).filter(Boolean).sort(),
    sourceThreadIds: nodes.map((node) => node.agentThreadId).sort(),
    edgeTopology: edgeTopologyDigestInput,
    sourceSchemaRefDigest,
    containmentProfileDigest: normalizeString(input.containmentProfileDigest, ""),
    normalizerVersion: sourceSchemaRef.sourceNormalizerVersion,
    operationLedgerHeadDigest: normalizeString(input.operationLedgerHeadDigest, ""),
  };
  const sourceDigest = normalizeString(input.sourceDigest, sha256(stableStringify(digestInput)));
  const cycleDetected = input.cycleDetected === true || detectCycles(nodes, edges);
  const maxGraphDepth = finiteNumber(input.maxGraphDepth, 4);
  const graph = {
    schema: DIRECT_AGENT_GRAPH_SCHEMA,
    agentGraphId: normalizeString(input.agentGraphId, `agent_graph_${sourceDigest.slice(0, 24)}`),
    projectId: digestInput.projectId,
    primaryThreadId: digestInput.primaryThreadId,
    runtimeSourceClass,
    graphRevision: finiteNumber(input.graphRevision, 1),
    activationEpoch: finiteNumber(input.activationEpoch, 0),
    sourceSchemaRef,
    sourceSchemaRefDigest,
    sourceDigest,
    operationLedgerHeadDigest: digestInput.operationLedgerHeadDigest,
    containmentProfileId: normalizeString(input.containmentProfileId, ""),
    containmentProfileDigest: digestInput.containmentProfileDigest,
    maxGraphDepth,
    cycleDetected,
    cyclePolicy: input.cyclePolicy === "block_projection" ? "block_projection" : "break_and_mark",
    directProviderPrimitiveProven: false,
    providerContinuityGranted: false,
    directRuntimeAuthorityGranted: false,
    nodes,
    edges,
    counts: graphCounts(nodes),
    lifecycle: normalizeString(input.lifecycle, cycleDetected && input.cyclePolicy === "block_projection" ? "corrupt" : nodes.length ? "active" : "empty"),
    rendererSafeSummary: normalizeString(input.rendererSafeSummary, nodes.length ? `Observed ${nodes.length} sub-agent nodes.` : "No sub-agent graph evidence is available."),
    rawTranscriptIncluded: false,
    rawPromptIncluded: false,
    rawProviderFrameIncluded: false,
    integrity: { algorithm: "sha256", sourceDigest, artifactDigest: "" },
  };
  return finalizeArtifact(graph);
}

function progressPhaseFromNode(node = {}) {
  if (node.lifecycleState === "running") return "running";
  if (node.lifecycleState === "waiting") return "waiting";
  if (node.lifecycleState === "completed") return "completed";
  if (node.lifecycleState === "failed") return "failed";
  if (node.lifecycleState === "closed") return "closed";
  if (node.lifecycleState === "stale") return "stale";
  return "discovered";
}

function progressTransitionState(previousPhase, nextPhase) {
  const previous = PROGRESS_PHASES.has(previousPhase) ? previousPhase : "";
  const next = PROGRESS_PHASES.has(nextPhase) ? nextPhase : "unknown";
  if (!previous || previous === next) return "valid";
  return PROGRESS_TRANSITIONS[previous]?.has(next) ? "valid" : "progress_transition_invalid";
}

function maybeStalePhase(phase, lastEventAt, policy = {}, nowMs = Date.now()) {
  if (!["running", "waiting"].includes(phase)) return phase;
  const staleAfterMs = finiteNumber(policy.staleAfterMs, 0);
  if (!staleAfterMs || !lastEventAt) return phase;
  const ageMs = nowMs - Date.parse(lastEventAt);
  return Number.isFinite(ageMs) && ageMs > staleAfterMs ? "stale" : phase;
}

function buildProgressRegistry(input = {}) {
  const graph = input.agentGraph || {};
  const stalenessPolicy = {
    staleAfterMs: finiteNumber(input.stalenessPolicy?.staleAfterMs, 900000),
    terminalNeverStalesForMs: finiteNumber(input.stalenessPolicy?.terminalNeverStalesForMs, 0),
    unknownWhenNoEventDigest: input.stalenessPolicy?.unknownWhenNoEventDigest !== false,
  };
  const entriesSource = arrayValue(input.entries).length
    ? arrayValue(input.entries)
    : arrayValue(graph.nodes).map((node, index) => ({
        agentThreadId: node.agentThreadId,
        progressSeq: index + 1,
        phase: progressPhaseFromNode(node),
        activeWorkSummary: node.displayLabel,
        blockerCodes: node.containmentState === "unknown" ? ["containment_unknown"] : [],
        evidenceRefs: node.evidenceRefs,
      }));
  const entries = entriesSource.map((entry, index) => {
    const rawPhase = PROGRESS_PHASES.has(entry.phase) ? entry.phase : "unknown";
    const previousPhase = entry.previousPhase || "";
    const lastEventAt = normalizeString(entry.lastEventAt, nowIso(input.nowMs));
    const stalePhase = maybeStalePhase(rawPhase, lastEventAt, stalenessPolicy, Number(input.nowMs) || Date.now());
    const transitionState = stalePhase === "stale" && rawPhase !== "stale"
      ? "stale_due_to_policy"
      : progressTransitionState(previousPhase, stalePhase);
    return {
      progressEntryId: normalizeString(entry.progressEntryId, `agent_progress_${sha256(`${entry.agentThreadId}:${index}`).slice(0, 20)}`),
      agentThreadId: normalizeString(entry.agentThreadId, ""),
      progressSeq: finiteNumber(entry.progressSeq, index + 1),
      phase: stalePhase,
      activeWorkSummary: clipText(entry.activeWorkSummary || "", 240),
      blockerCodes: arrayValue(entry.blockerCodes).map((value) => normalizeString(value, "")).filter(Boolean),
      lastEventAt,
      lastEventDigest: normalizeString(entry.lastEventDigest, sha256(`${entry.agentThreadId}:${lastEventAt}:${stalePhase}`)),
      transitionState,
      evidenceRefs: normalizeEvidenceRefs(entry.evidenceRefs),
    };
  });
  const sourceDigest = normalizeString(input.sourceDigest, sha256(stableStringify({
    graphDigest: graph.integrity?.artifactDigest || graph.sourceDigest || "",
    entries: entries.map((entry) => ({ agentThreadId: entry.agentThreadId, phase: entry.phase, seq: entry.progressSeq })),
    stalenessPolicy,
  })));
  const registry = {
    schema: DIRECT_AGENT_PROGRESS_REGISTRY_SCHEMA,
    progressRegistryId: normalizeString(input.progressRegistryId, `agent_progress_registry_${sourceDigest.slice(0, 24)}`),
    projectId: normalizeString(input.projectId, graph.projectId || ""),
    primaryThreadId: normalizeString(input.primaryThreadId, graph.primaryThreadId || ""),
    agentGraphId: normalizeString(input.agentGraphId, graph.agentGraphId || ""),
    graphRevision: finiteNumber(input.graphRevision, graph.graphRevision || 0),
    registrySeq: finiteNumber(input.registrySeq, 1),
    stalenessPolicy,
    sourceDigest,
    entries,
    activeWorkCount: entries.filter((entry) => ["running", "waiting"].includes(entry.phase)).length,
    blockedCount: entries.filter((entry) => entry.blockerCodes.length).length,
    attentionCount: entries.filter((entry) => ["failed", "stale"].includes(entry.phase) || entry.blockerCodes.length).length,
    staleCount: entries.filter((entry) => entry.phase === "stale").length,
    rendererSafeSummary: normalizeString(input.rendererSafeSummary, `Recorded ${entries.length} sub-agent progress entries.`),
    rawPromptIncluded: false,
    rawTranscriptIncluded: false,
    rawToolArgsIncluded: false,
    integrity: { algorithm: "sha256", sourceDigest, artifactDigest: "" },
  };
  return finalizeArtifact(registry);
}

function attentionFromPhase(phase, blockers = []) {
  if (phase === "failed") return "failed";
  if (phase === "stale") return "stale";
  if (blockers.length) return "blocked";
  if (phase === "running" || phase === "waiting") return "active";
  return "none";
}

function buildProgressWitness(input = {}) {
  const registry = input.progressRegistry || {};
  const entry = input.progressEntry || arrayValue(registry.entries)[0] || {};
  const phase = PROGRESS_PHASES.has(input.phase || entry.phase) ? (input.phase || entry.phase) : "unknown";
  const attentionState = ATTENTION_STATES.has(input.attentionState) ? input.attentionState : attentionFromPhase(phase, entry.blockerCodes);
  const sourceDigest = normalizeString(input.sourceDigest, sha256(stableStringify({
    registryDigest: registry.integrity?.artifactDigest || registry.sourceDigest || "",
    progressEntryId: entry.progressEntryId || "",
    phase,
    attentionState,
  })));
  const witness = {
    schema: DIRECT_AGENT_PROGRESS_WITNESS_SCHEMA,
    witnessId: normalizeString(input.witnessId, `agent_witness_${sourceDigest.slice(0, 24)}`),
    projectId: normalizeString(input.projectId, registry.projectId || ""),
    primaryThreadId: normalizeString(input.primaryThreadId, registry.primaryThreadId || ""),
    agentThreadId: normalizeString(input.agentThreadId, entry.agentThreadId || ""),
    agentGraphId: normalizeString(input.agentGraphId, registry.agentGraphId || ""),
    progressRegistryId: normalizeString(input.progressRegistryId, registry.progressRegistryId || ""),
    progressEntryId: normalizeString(input.progressEntryId, entry.progressEntryId || ""),
    witnessSeq: finiteNumber(input.witnessSeq, entry.progressSeq || 1),
    phase,
    attentionState,
    rendererSafeSummary: normalizeString(input.rendererSafeSummary, entry.activeWorkSummary || `Agent progress is ${phase}.`),
    modelSafeSummary: clipText(input.modelSafeSummary || input.rendererSafeSummary || entry.activeWorkSummary || `Agent progress is ${phase}.`, 240),
    modelSafeSummaryUse: MODEL_SAFE_USES.has(input.modelSafeSummaryUse) ? input.modelSafeSummaryUse : "future_tool_candidate_only",
    inspectableInRenderer: true,
    modelVisibleToolEnabledInThisPr: false,
    waitEnabledInThisPr: false,
    spawnEnabledInThisPr: false,
    replayAuthority: false,
    continuationAuthority: false,
    approvalAuthority: false,
    evidenceRefs: normalizeEvidenceRefs(input.evidenceRefs || entry.evidenceRefs),
    rawPromptIncluded: false,
    rawTranscriptIncluded: false,
    rawProviderFrameIncluded: false,
    integrity: { algorithm: "sha256", sourceDigest, artifactDigest: "" },
  };
  return finalizeArtifact(witness);
}

function buildProgressInspection(input = {}) {
  const witnesses = arrayValue(input.witnesses);
  const limit = Math.max(1, Math.min(100, finiteNumber(input.limit, 50)));
  const cursor = Math.max(0, finiteNumber(input.cursor, 0));
  const page = witnesses.slice(cursor, cursor + limit);
  const sourceDigest = sha256(stableStringify({
    witnessIds: page.map((witness) => witness.witnessId),
    cursor,
    limit,
    agentGraphId: input.agentGraphId || "",
  }));
  return {
    schema: DIRECT_AGENT_PROGRESS_INSPECTION_SCHEMA,
    inspectionId: normalizeString(input.inspectionId, `agent_inspection_${sourceDigest.slice(0, 24)}`),
    projectId: normalizeString(input.projectId, ""),
    primaryThreadId: normalizeString(input.primaryThreadId, ""),
    requestedAgentThreadId: normalizeString(input.requestedAgentThreadId, ""),
    agentGraphId: normalizeString(input.agentGraphId, ""),
    progressRegistryId: normalizeString(input.progressRegistryId, ""),
    witnesses: page,
    nextCursor: cursor + limit < witnesses.length ? String(cursor + limit) : "",
    hasMore: cursor + limit < witnesses.length,
    maxWitnessesReturned: limit,
    actionability: {
      actionable: false,
      allowedActions: [],
      reason: "inspection_is_read_only",
    },
    providerToolCallUsed: false,
    appServerMutationUsed: false,
    rightPaneMutationUsed: false,
    handoffMutationUsed: false,
    sourceDigest,
  };
}

function buildActivityTag(input = {}) {
  const tagCore = {
    agentThreadId: normalizeString(input.agentThreadId, ""),
    attentionState: ["active", "blocked", "failed", "completed", "stale", "unknown"].includes(input.attentionState) ? input.attentionState : "unknown",
    rendererSafeLabel: normalizeString(input.rendererSafeLabel, "Sub-agent activity"),
    progressWitnessId: normalizeString(input.progressWitnessId, ""),
  };
  return {
    tagId: normalizeString(input.tagId, `agent_tag_${sha256(stableStringify(tagCore)).slice(0, 20)}`),
    ...tagCore,
    actionability: {
      actionable: false,
      allowedActions: [],
    },
    rawTranscriptIncluded: false,
  };
}

function authorKindForTranscriptItem(input = {}) {
  const explicit = normalizeString(input.authorKind, "");
  if (["parent_agent", "child_agent", "harness_controller", "tool", "system", "unknown_agent"].includes(explicit)) return explicit;
  const role = normalizeString(input.role, "");
  if (role === "assistant") return "child_agent";
  if (role === "user") return "parent_agent";
  if (role === "tool") return "tool";
  if (role === "system") return "system";
  return "unknown_agent";
}

function buildSubAgentTranscriptProjection(input = {}) {
  const items = arrayValue(input.items);
  const limit = Math.max(1, Math.min(100, finiteNumber(input.limit, input.maxItemsReturned || 50)));
  const cursor = Math.max(0, finiteNumber(input.cursor, 0));
  const maxTextPreviewChars = Math.max(80, Math.min(1400, finiteNumber(input.maxTextPreviewChars, 500)));
  const page = items.slice(cursor, cursor + limit).map((item, index) => ({
    itemId: normalizeString(item.itemId, `sub_agent_item_${cursor + index + 1}`),
    sourceItemId: normalizeString(item.sourceItemId, ""),
    authorKind: authorKindForTranscriptItem(item),
    rendererSafeTextPreview: clipText(item.rendererSafeTextPreview || item.text || "", maxTextPreviewChars),
    textTruncated: String(item.rendererSafeTextPreview || item.text || "").length > maxTextPreviewChars,
    evidenceRefs: normalizeEvidenceRefs(item.evidenceRefs),
  }));
  const sourceDigest = normalizeString(input.sourceDigest, sha256(stableStringify({
    primaryThreadId: input.primaryThreadId || "",
    agentThreadId: input.agentThreadId || "",
    sourceItemIds: page.map((item) => item.sourceItemId || item.itemId),
    cursor,
    limit,
  })));
  const projection = {
    schema: DIRECT_SUB_AGENT_TRANSCRIPT_PROJECTION_SCHEMA,
    transcriptProjectionId: normalizeString(input.transcriptProjectionId, `sub_agent_transcript_${sourceDigest.slice(0, 24)}`),
    projectId: normalizeString(input.projectId, ""),
    primaryThreadId: normalizeString(input.primaryThreadId, ""),
    agentThreadId: normalizeString(input.agentThreadId, ""),
    agentGraphId: normalizeString(input.agentGraphId, ""),
    graphRevision: finiteNumber(input.graphRevision, 0),
    activationEpoch: finiteNumber(input.activationEpoch, 0),
    itemCount: items.length,
    itemsTruncated: cursor + limit < items.length,
    maxItemsReturned: limit,
    nextCursor: cursor + limit < items.length ? String(cursor + limit) : "",
    hasMore: cursor + limit < items.length,
    maxTextPreviewChars,
    rendererSafeItems: page,
    sourceDigest,
    rawProviderFrameIncluded: false,
    rawHostPathIncluded: false,
    integrity: { algorithm: "sha256", sourceDigest, artifactDigest: "" },
  };
  return finalizeArtifact(projection);
}

function buildAttentionProjection(input = {}) {
  const graph = input.agentGraph || {};
  const witnessesByAgent = new Map(arrayValue(input.witnesses).map((witness) => [witness.agentThreadId, witness]));
  const perAgent = arrayValue(graph.nodes).map((node) => {
    const witness = witnessesByAgent.get(node.agentThreadId);
    const attentionState = ATTENTION_PROJECTION_STATES.has(witness?.attentionState)
      ? witness.attentionState
      : node.lifecycleState === "failed"
        ? "failed"
        : node.lifecycleState === "stale"
          ? "stale"
          : node.activityState === "blocked" || node.activityState === "attention_required"
            ? "blocked"
            : node.activityState === "active" || node.activityState === "responding"
              ? "active"
              : "none";
    return {
      agentThreadId: node.agentThreadId,
      attentionState,
      selectedByDefault: false,
      rendererSafeSummary: `${node.displayLabel}: ${attentionState}`,
    };
  });
  const selectedAgent = perAgent.find((agent) => agent.attentionState === "active") ||
    perAgent.find((agent) => agent.attentionState === "blocked") ||
    perAgent.find((agent) => agent.attentionState === "failed");
  if (selectedAgent) selectedAgent.selectedByDefault = true;
  const sourceDigest = normalizeString(input.sourceDigest, sha256(stableStringify({
    graphDigest: graph.integrity?.artifactDigest || graph.sourceDigest || "",
    perAgent,
  })));
  return {
    schema: DIRECT_AGENT_ATTENTION_PROJECTION_SCHEMA,
    attentionProjectionId: normalizeString(input.attentionProjectionId, `agent_attention_${sourceDigest.slice(0, 24)}`),
    projectId: normalizeString(input.projectId, graph.projectId || ""),
    primaryThreadId: normalizeString(input.primaryThreadId, graph.primaryThreadId || ""),
    agentGraphId: normalizeString(input.agentGraphId, graph.agentGraphId || ""),
    graphRevision: finiteNumber(input.graphRevision, graph.graphRevision || 0),
    tabBadge: {
      total: perAgent.length,
      active: perAgent.filter((agent) => agent.attentionState === "active").length,
      unread: perAgent.filter((agent) => agent.attentionState === "unread").length,
      failed: perAgent.filter((agent) => agent.attentionState === "failed").length,
      blocked: perAgent.filter((agent) => agent.attentionState === "blocked").length,
    },
    perAgent,
    autoSwitchRecommended: input.autoSwitchRecommended === true,
    autoSwitchApplied: input.autoSwitchApplied === true,
    autoSwitchReason: ["first_active_agent", "user_pinned_chatgpt", "chatgpt_composer_nonempty", "stale_graph", "not_applicable"].includes(input.autoSwitchReason) ? input.autoSwitchReason : "not_applicable",
    autoSwitchAuthority: "renderer_only",
    runtimeStateMutated: false,
    sourceDigest,
  };
}

function buildSelectedAgentTabState(input = {}) {
  return {
    selectedAgentThreadId: normalizeString(input.selectedAgentThreadId, ""),
    selectedAtGraphRevision: finiteNumber(input.selectedAtGraphRevision, 0),
    selectedAtActivationEpoch: finiteNumber(input.selectedAtActivationEpoch, 0),
    selectionState: ["valid", "stale_graph", "agent_not_found", "child_thread_not_found", "unknown"].includes(input.selectionState) ? input.selectionState : "unknown",
  };
}

function agentObservabilityRecoveryState(input = {}) {
  if (input.rawExposureBlocked === true) return "raw_exposure_blocked";
  if (input.graphCorrupt === true) return "graph_corrupt";
  if (input.graphCycleDetected === true) return "graph_cycle_detected";
  if (input.graphMissing === true) return "graph_missing";
  if (input.graphStale === true) return "graph_stale";
  if (input.graphDigestMismatch === true) return "graph_digest_mismatch";
  if (input.progressRegistryMissing === true) return "progress_registry_missing";
  if (input.progressRegistryStale === true) return "progress_registry_stale";
  if (input.witnessDigestMismatch === true) return "witness_digest_mismatch";
  if (input.witnessMissing === true) return "witness_missing";
  if (input.transcriptHydrationFailed === true) return "transcript_hydration_failed";
  if (input.transcriptProjectionMissing === true) return "transcript_projection_missing";
  if (input.containmentProfileMissing === true) return "containment_profile_missing";
  if (input.containmentUnknown === true) return "containment_unknown";
  if (input.unsupportedRuntimeSource === true) return "unsupported_runtime_source";
  if (input.sourceThreadNotFound === true) return "source_thread_not_found";
  if (input.unknown === true) return "unknown";
  return "healthy";
}

function validateSentinelCounters(counters = {}) {
  for (const key of [
    "providerTransportCalls",
    "appServerMutationCalls",
    "appServerTurnStartCalls",
    "appServerApprovalResponseCalls",
    "workspaceReadCalls",
    "patchApplyCalls",
    "commandRunCalls",
    "contextPackBuilds",
    "requestManifestBuilds",
    "directSessionCreates",
    "spawnAgentCalls",
    "sendInputCalls",
    "waitAgentCalls",
    "closeAgentCalls",
    "rightPaneMutationCalls",
    "handoffMutationCalls",
  ]) {
    if (finiteNumber(counters[key], 0) !== 0) {
      const error = new Error(`direct_sub_agent_observability_sentinel_nonzero:${key}`);
      error.code = "direct_sub_agent_observability_sentinel_nonzero";
      error.counter = key;
      throw error;
    }
  }
  return true;
}

function validateSubAgentObservabilityReport(report = {}) {
  if (report.schema !== DIRECT_SUB_AGENT_OBSERVABILITY_REPORT_SCHEMA) {
    throw new Error("direct_sub_agent_observability_report_schema_mismatch");
  }
  if (report.matrixPromotionCandidate !== false || report.authorityPromotionCandidate !== false) {
    throw new Error("direct_sub_agent_observability_promoted_authority");
  }
  if (report.runtimeAuthorityExercised !== false || report.providerAuthorityExercised !== false) {
    throw new Error("direct_sub_agent_observability_authority_exercised");
  }
  const promotion = report.promotionCandidates || {};
  for (const key of ["H4_inspectToolAuthority", "H5_waitToolAuthority", "H7_collabToolAuthority", "H10_waitDeadlockPrevention"]) {
    if (promotion[key] !== false) throw new Error(`direct_sub_agent_observability_promoted:${key}`);
  }
  validateSentinelCounters(report.sentinelCounters || {});
  if (!Array.isArray(report.cases) || report.cases.length === 0) {
    throw new Error("direct_sub_agent_observability_cases_missing");
  }
  for (const entry of report.cases) {
    if (entry.matrixPromotionCandidate === true || entry.authorityPromotionCandidate === true) {
      throw new Error(`direct_sub_agent_observability_case_promoted:${entry.caseId}`);
    }
  }
  return true;
}

module.exports = {
  DIRECT_AGENT_ATTENTION_PROJECTION_SCHEMA,
  DIRECT_AGENT_CONTAINMENT_PROFILE_SCHEMA,
  DIRECT_AGENT_GRAPH_SCHEMA,
  DIRECT_AGENT_OBSERVABILITY_VERSION,
  DIRECT_AGENT_PROGRESS_INSPECTION_SCHEMA,
  DIRECT_AGENT_PROGRESS_REGISTRY_SCHEMA,
  DIRECT_AGENT_PROGRESS_WITNESS_SCHEMA,
  DIRECT_SUB_AGENT_OBSERVABILITY_REPORT_SCHEMA,
  DIRECT_SUB_AGENT_TRANSCRIPT_PROJECTION_SCHEMA,
  agentObservabilityRecoveryState,
  buildActivityTag,
  buildAgentGraph,
  buildAgentIdentityResolution,
  buildAgentSourceSchemaRef,
  buildAttentionProjection,
  buildContainmentProfile,
  buildProgressInspection,
  buildProgressRegistry,
  buildProgressWitness,
  buildSelectedAgentTabState,
  buildSubAgentTranscriptProjection,
  normalizeEvidenceRef,
  progressTransitionState,
  sha256,
  stableStringify,
  validateSentinelCounters,
  validateSubAgentObservabilityReport,
};
