"use strict";

const crypto = require("node:crypto");
const {
  buildResidentEpistemicSnapshot,
  validateResidentEpistemicSnapshot,
} = require("./resident-epistemic-snapshot");

const SUB_AGENT_GOVERNANCE_ENVELOPE_SCHEMA = "sub_agent_governance_envelope@1";
const SUB_AGENT_GOVERNANCE_AGENT_ROW_SCHEMA = "sub_agent_governance_agent_row@1";
const SUB_AGENT_E_CHANNEL_SNAPSHOT_SCHEMA = "sub_agent_e_channel_snapshot@1";

const NO_INTERFERENCE_POLICIES = new Set([
  "observe_only",
  "sealed_audit",
  "blind_run",
  "operator_locked",
  "time_boxed",
  "handoff_only",
]);
const LIFECYCLE_STATES = new Set(["discovered", "starting", "running", "waiting", "completed", "failed", "closed", "stale", "not_found", "unknown"]);
const ACTIVITY_STATES = new Set(["idle", "active", "responding", "blocked", "attention_required", "unknown"]);
const RELEASE_STATES = new Set(["not_releasable", "release_available", "released", "expired", "operator_required", "unknown"]);
const GOVERNANCE_STATUSES = new Set(["observing", "completed", "failed", "stale", "blocked", "sealed", "unknown"]);

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
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trim()}…` : text;
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
    .filter((key) => value[key] !== undefined && key !== "envelopeDigest" && key !== "snapshotDigest")
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

function normalizeEvidenceRef(input = {}, fallbackSource = "agent_graph") {
  const source = isPlainObject(input) ? input : {};
  const ref = {
    refId: boundedString(source.refId || source.id || source.artifactId || source.digest || fallbackSource, 180),
    source: normalizeString(source.source || source.kind || fallbackSource, fallbackSource),
    digest: normalizeString(source.digest || source.artifactDigest || source.refDigest, ""),
    label: boundedString(source.label || source.rendererSafeLabel || fallbackSource, 180),
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  ref.refDigest = digestFor("sub-agent-governance-evidence-ref@1", ref);
  return ref;
}

function normalizeEvidenceRefs(values, fallbackSource = "agent_graph") {
  return (Array.isArray(values) ? values : [])
    .filter(isPlainObject)
    .map((value) => normalizeEvidenceRef(value, fallbackSource));
}

function normalizePolicy(value, fallback = "observe_only") {
  const text = normalizeString(value, fallback);
  return NO_INTERFERENCE_POLICIES.has(text) ? text : fallback;
}

function normalizeNode(input = {}, index = 0) {
  const source = isPlainObject(input) ? input : {};
  const agentThreadId = normalizeString(source.agentThreadId || source.providerThreadId || source.threadId, `agent_${index + 1}`);
  const displayLabel = boundedString(source.displayLabel || source.nickname || source.role || `Agent ${agentThreadId.slice(0, 8)}`, 160);
  const lifecycleState = normalizeString(source.lifecycleState || source.nodeState, "unknown");
  const activityState = normalizeString(source.activityState, "unknown");
  return {
    agentThreadId,
    agentNodeId: normalizeString(source.agentNodeId || source.workerNodeId, `agent_node_${digestFor("sub-agent-node-id@1", agentThreadId).slice(7, 23)}`),
    parentThreadId: normalizeString(source.parentThreadId || source.parentAgentThreadId || source.parentProviderThreadId, ""),
    displayLabel,
    role: boundedString(source.role, 120),
    nickname: boundedString(source.nickname, 120),
    model: normalizeString(source.model, ""),
    reasoningEffort: normalizeString(source.reasoningEffort, ""),
    serviceTier: normalizeString(source.serviceTier, ""),
    lifecycleState: LIFECYCLE_STATES.has(lifecycleState) ? lifecycleState : "unknown",
    activityState: ACTIVITY_STATES.has(activityState) ? activityState : "unknown",
    evidenceRefs: normalizeEvidenceRefs(source.evidenceRefs, "agent_graph"),
  };
}

function progressFor(agentThreadId, progressRegistry = {}) {
  return (Array.isArray(progressRegistry.entries) ? progressRegistry.entries : [])
    .find((entry) => entry?.agentThreadId === agentThreadId) || null;
}

function inspectFor(agentThreadId, inspectPackets = []) {
  return (Array.isArray(inspectPackets) ? inspectPackets : [])
    .find((packet) => packet?.agent?.agentThreadId === agentThreadId || packet?.requestedAgentThreadId === agentThreadId) || null;
}

function transcriptWitnessFor(agentThreadId, transcriptProjections = []) {
  const projection = (Array.isArray(transcriptProjections) ? transcriptProjections : [])
    .find((entry) => entry?.agentThreadId === agentThreadId || entry?.threadId === agentThreadId || entry?.transcriptProjectionId?.includes(agentThreadId));
  const items = Array.isArray(projection?.rendererSafeItems) ? projection.rendererSafeItems : [];
  return {
    transcriptProjectionId: normalizeString(projection?.transcriptProjectionId, ""),
    itemCount: Number.isFinite(Number(projection?.itemCount)) ? Number(projection.itemCount) : items.length,
    rendererSafeItemCount: items.length,
    hasMore: projection?.hasMore === true,
    visibility: projection ? "summary_only" : "metadata_only",
    transcriptDigest: normalizeString(projection?.projectionDigest || projection?.sourceDigest || "", ""),
    childTranscriptRenderedAsOperator: false,
    childReplyRenderedAsPrimaryFinal: false,
    rawTranscriptIncluded: false,
  };
}

function governanceStatusFor(node = {}, progress = {}) {
  const lifecycle = normalizeString(progress?.phase || node.lifecycleState, "unknown");
  if (["completed", "closed"].includes(lifecycle)) return "completed";
  if (lifecycle === "failed") return "failed";
  if (lifecycle === "stale") return "stale";
  if (node.activityState === "blocked" || node.activityState === "attention_required") return "blocked";
  if (["running", "waiting", "starting", "discovered"].includes(lifecycle)) return "observing";
  return "unknown";
}

function releaseStateFor(policy, node = {}, progress = {}, input = {}) {
  const explicit = normalizeString(input.releaseState, "");
  if (RELEASE_STATES.has(explicit)) return explicit;
  if (policy === "operator_locked") return "operator_required";
  if (policy === "time_boxed" && input.releaseAt) return "release_available";
  if (["completed", "closed", "failed"].includes(progress?.phase || node.lifecycleState)) return "not_releasable";
  return "not_releasable";
}

function blockedActionsFor(policy, status) {
  const base = ["provider_declaration", "provider_transport", "workspace_mutation", "approval_response", "child_transcript_promotion"];
  const interference = ["send_input", "resume", "interrupt", "close", "wait_mutation", "recursive_spawn"];
  if (policy === "handoff_only") return [...new Set([...base, ...interference, "non_handoff_control"])].sort();
  if (policy === "blind_run") return [...new Set([...base, ...interference, "inspect_full_transcript"])].sort();
  if (policy === "sealed_audit") return [...new Set([...base, ...interference, "release_without_audit"])].sort();
  if (policy === "operator_locked") return [...new Set([...base, ...interference, "release_without_operator"])].sort();
  if (status === "completed") return [...new Set([...base, ...interference])].sort();
  return [...new Set([...base, ...interference])].sort();
}

function observableActionsFor(policy) {
  if (policy === "blind_run") return ["observe_summary"];
  return ["observe_status", "inspect_metadata", "view_progress_witness"];
}

function normalizeAgentPolicy(inputPolicy, defaultPolicy) {
  const source = isPlainObject(inputPolicy) ? inputPolicy : {};
  return {
    noInterferencePolicy: normalizePolicy(source.noInterferencePolicy || source.policy, defaultPolicy),
    releaseState: normalizeString(source.releaseState, ""),
    releaseAt: normalizeString(source.releaseAt, ""),
    releaseEvidenceRefs: normalizeEvidenceRefs(source.releaseEvidenceRefs, "sub_agent_release"),
  };
}

function buildSubAgentGovernanceRow({ node, index = 0, progressRegistry = {}, inspectPackets = [], transcriptProjections = [], policy = {}, defaultPolicy = "observe_only", generatedAt = "" } = {}) {
  const normalizedNode = normalizeNode(node, index);
  const progress = progressFor(normalizedNode.agentThreadId, progressRegistry) || {};
  const inspectPacket = inspectFor(normalizedNode.agentThreadId, inspectPackets);
  const selectedPolicy = normalizeAgentPolicy(policy, defaultPolicy);
  const noInterferencePolicy = selectedPolicy.noInterferencePolicy;
  const status = governanceStatusFor(normalizedNode, progress);
  const releaseState = releaseStateFor(noInterferencePolicy, normalizedNode, progress, selectedPolicy);
  const transcriptWitness = transcriptWitnessFor(normalizedNode.agentThreadId, transcriptProjections);
  const row = {
    schema: SUB_AGENT_GOVERNANCE_AGENT_ROW_SCHEMA,
    rowId: `sub_agent_governance_${digestFor("sub-agent-governance-row-id@1", {
      agentThreadId: normalizedNode.agentThreadId,
      noInterferencePolicy,
      generatedAt,
    }).slice(7, 31)}`,
    agentThreadId: normalizedNode.agentThreadId,
    agentNodeId: normalizedNode.agentNodeId,
    parentThreadId: normalizedNode.parentThreadId,
    displayLabel: normalizedNode.displayLabel,
    role: normalizedNode.role,
    nickname: normalizedNode.nickname,
    model: normalizedNode.model,
    reasoningEffort: normalizedNode.reasoningEffort,
    serviceTier: normalizedNode.serviceTier,
    lifecycleState: normalizedNode.lifecycleState,
    activityState: normalizedNode.activityState,
    progressPhase: normalizeString(progress.phase, normalizedNode.lifecycleState),
    governanceStatus: GOVERNANCE_STATUSES.has(status) ? status : "unknown",
    noInterferencePolicy,
    observableActions: observableActionsFor(noInterferencePolicy),
    blockedActions: blockedActionsFor(noInterferencePolicy, status),
    releaseState,
    releaseAt: selectedPolicy.releaseAt || undefined,
    releaseEvidenceRefs: selectedPolicy.releaseEvidenceRefs,
    currentActivity: boundedString(inspectPacket?.rendererSafeSummary || `${normalizedNode.lifecycleState}/${normalizedNode.activityState}`, 240),
    progressWitnessId: normalizeString(progress.progressWitnessId || inspectPacket?.progress?.progressWitnessId, ""),
    waitState: normalizeString(inspectPacket?.waitState, ""),
    attentionState: normalizeString(inspectPacket?.attentionState, ""),
    transcriptWitness,
    providerDeclarationBlocked: true,
    providerTransportBlocked: true,
    workspaceMutationBlocked: true,
    childTranscriptPromotionBlocked: true,
    parentSelfBindingEnforced: true,
    rawTranscriptIncluded: false,
    rawPromptIncluded: false,
    rawProviderFrameIncluded: false,
    evidenceRefs: normalizeEvidenceRefs([
      ...normalizedNode.evidenceRefs,
      ...(Array.isArray(progress.evidenceRefs) ? progress.evidenceRefs : []),
      ...(Array.isArray(inspectPacket?.evidenceRefs) ? inspectPacket.evidenceRefs : []),
    ], "sub_agent_e_channel"),
  };
  row.rowDigest = digestFor("sub-agent-governance-agent-row@1", row);
  return row;
}

function buildSubAgentGovernanceEnvelope(input = {}) {
  const safeInput = isPlainObject(input) ? input : {};
  const generatedAt = normalizeString(safeInput.generatedAt, nowIso(safeInput.nowMs));
  const graph = isPlainObject(safeInput.agentGraph || safeInput.graph) ? (safeInput.agentGraph || safeInput.graph) : {};
  const progressRegistry = isPlainObject(safeInput.progressRegistry) ? safeInput.progressRegistry : {};
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : Array.isArray(safeInput.nodes) ? safeInput.nodes : [];
  const policyByAgent = new Map((Array.isArray(safeInput.policies) ? safeInput.policies : [])
    .filter(isPlainObject)
    .map((policy) => [normalizeString(policy.agentThreadId || policy.threadId, ""), policy])
    .filter(([agentThreadId]) => agentThreadId));
  const defaultPolicy = normalizePolicy(safeInput.defaultNoInterferencePolicy, "observe_only");
  const rows = nodes
    .filter(isPlainObject)
    .map((node, index) => {
      const agentThreadId = normalizeString(node.agentThreadId || node.threadId || node.providerThreadId, "");
      return buildSubAgentGovernanceRow({
        node,
        index,
        progressRegistry,
        inspectPackets: safeInput.inspectPackets,
        transcriptProjections: safeInput.transcriptProjections,
        policy: policyByAgent.get(agentThreadId) || safeInput.policy || {},
        defaultPolicy,
        generatedAt,
      });
    });
  const envelope = {
    schema: SUB_AGENT_GOVERNANCE_ENVELOPE_SCHEMA,
    envelopeId: normalizeString(safeInput.envelopeId, `sub_agent_governance_envelope_${digestFor("sub-agent-governance-envelope-id@1", {
      graphDigest: graph.graphDigest || graph.sourceDigest || graph.integrity?.artifactDigest,
      rowDigests: rows.map((row) => row.rowDigest),
    }).slice(7, 31)}`),
    generatedAt,
    projectId: normalizeString(safeInput.projectId || graph.projectId, ""),
    workThreadId: normalizeString(safeInput.workThreadId, ""),
    primaryThreadId: normalizeString(safeInput.primaryThreadId || graph.primaryThreadId, ""),
    agentGraphId: normalizeString(graph.agentGraphId || graph.graphId, ""),
    graphRevision: Number.isFinite(Number(graph.graphRevision)) ? Number(graph.graphRevision) : 0,
    defaultNoInterferencePolicy: defaultPolicy,
    rowCount: rows.length,
    rows,
    noInterferencePolicies: [...new Set(rows.map((row) => row.noInterferencePolicy))].sort(),
    activeAgentCount: rows.filter((row) => ["observing", "blocked", "stale"].includes(row.governanceStatus)).length,
    completedAgentCount: rows.filter((row) => row.governanceStatus === "completed").length,
    failedAgentCount: rows.filter((row) => row.governanceStatus === "failed").length,
    providerDeclarationsBlocked: true,
    providerTransportBlocked: true,
    workspaceMutationBlocked: true,
    childTranscriptPromotionBlocked: true,
    parentSelfBindingEnforced: true,
    contextInjectionEnabled: false,
    releaseWithoutEvidenceAllowed: false,
    rawTranscriptIncluded: false,
    rawPromptIncluded: false,
    rawProviderFrameIncluded: false,
  };
  envelope.envelopeDigest = digestFor("sub-agent-governance-envelope@1", envelope);
  return envelope;
}

function residentStatusFor(row = {}) {
  if (row.governanceStatus === "completed") return "known_available";
  if (row.governanceStatus === "failed") return "blocked_by_runtime";
  if (row.governanceStatus === "stale") return "stale";
  if (row.governanceStatus === "blocked") return "blocked_by_policy";
  if (row.noInterferencePolicy === "blind_run") return "known_available";
  return "known_available";
}

function buildSubAgentEpistemicRows(input = {}) {
  const envelope = isPlainObject(input.envelope) ? input.envelope : buildSubAgentGovernanceEnvelope(input);
  return (Array.isArray(envelope.rows) ? envelope.rows : []).map((row) => ({
    subjectKind: "sub_agent",
    subjectId: row.agentThreadId,
    displayLabel: row.displayLabel,
    family: row.noInterferencePolicy,
    status: residentStatusFor(row),
    knowledgeClass: "harness_observed",
    residentVisible: true,
    callableInCurrentRequest: false,
    declaredAsProviderTool: false,
    controlState: "blocked_by_policy",
    perCallAuthorityRequired: false,
    availableActions: row.observableActions,
    blockedActions: row.blockedActions,
    controlAvailable: false,
    controlAuthorityRequired: false,
    epistemicVisibility: row.noInterferencePolicy === "blind_run" ? "summary_only" : "full_status",
    transcriptVisible: row.transcriptWitness.visibility,
    transcriptSourceRefs: row.transcriptWitness.transcriptDigest
      ? [{ refId: row.transcriptWitness.transcriptProjectionId || row.agentThreadId, source: "sub_agent_e_channel", digest: row.transcriptWitness.transcriptDigest }]
      : [],
    epistemicUse: "planning_context",
    authorityUse: "may_not_act",
    priority: row.governanceStatus === "stale" ? "high" : "normal",
    omitWhenBudgeted: row.governanceStatus === "completed",
    freshness: row.governanceStatus === "stale" ? "stale" : "fresh",
    blockerCodes: row.blockedActions,
    evidenceRefs: [
      { refId: row.rowId, source: "agent_graph", digest: row.rowDigest },
    ],
    compactText: `${row.displayLabel}: ${row.lifecycleState}/${row.activityState}; policy=${row.noInterferencePolicy}; release=${row.releaseState}; model=${row.model || "unknown"} effort=${row.reasoningEffort || "unknown"}.`,
    extensions: {
      governanceRowId: row.rowId,
      governanceStatus: row.governanceStatus,
      releaseState: row.releaseState,
      observableActions: row.observableActions,
      transcriptItemCount: row.transcriptWitness.itemCount,
      parentSelfBindingEnforced: row.parentSelfBindingEnforced,
    },
  }));
}

function buildSubAgentEChannelSnapshot(input = {}) {
  const envelope = isPlainObject(input.envelope) ? input.envelope : buildSubAgentGovernanceEnvelope(input);
  const residentSnapshot = buildResidentEpistemicSnapshot({
    workThreadId: envelope.workThreadId || input.workThreadId || "work_thread_unknown",
    codexThreadId: envelope.primaryThreadId || input.primaryThreadId || "",
    runtimeFamily: "direct",
    generatedAt: envelope.generatedAt,
    sourceDigests: [envelope.envelopeDigest],
    projectionBudget: input.projectionBudget || { maxRows: 10, maxChars: 2000, truncationPolicy: "priority_then_summary" },
    rows: buildSubAgentEpistemicRows({ envelope }),
  });
  const snapshot = {
    schema: SUB_AGENT_E_CHANNEL_SNAPSHOT_SCHEMA,
    snapshotId: `sub_agent_e_channel_${digestFor("sub-agent-e-channel-snapshot-id@1", {
      envelopeDigest: envelope.envelopeDigest,
      residentSnapshotDigest: residentSnapshot.snapshotDigest,
    }).slice(7, 31)}`,
    generatedAt: envelope.generatedAt,
    workThreadId: envelope.workThreadId,
    primaryThreadId: envelope.primaryThreadId,
    envelopeId: envelope.envelopeId,
    envelopeDigest: envelope.envelopeDigest,
    residentSnapshot,
    rowCount: residentSnapshot.rows.length,
    contextInjectionEnabled: false,
    controlAuthorityGranted: false,
    rawTranscriptIncluded: false,
    rawPromptIncluded: false,
    rawProviderFrameIncluded: false,
  };
  snapshot.snapshotDigest = digestFor("sub-agent-e-channel-snapshot@1", snapshot);
  return snapshot;
}

function validateSubAgentGovernanceEnvelope(envelope = {}) {
  const errors = [];
  if (!isPlainObject(envelope) || envelope.schema !== SUB_AGENT_GOVERNANCE_ENVELOPE_SCHEMA) return ["sub_agent_governance_envelope_schema_mismatch"];
  if (!Array.isArray(envelope.rows)) errors.push("sub_agent_governance_rows_missing");
  for (const flag of [
    "providerDeclarationsBlocked",
    "providerTransportBlocked",
    "workspaceMutationBlocked",
    "childTranscriptPromotionBlocked",
    "parentSelfBindingEnforced",
  ]) {
    if (envelope[flag] !== true) errors.push(`sub_agent_governance_required_block_missing:${flag}`);
  }
  for (const flag of ["contextInjectionEnabled", "releaseWithoutEvidenceAllowed", "rawTranscriptIncluded", "rawPromptIncluded", "rawProviderFrameIncluded"]) {
    if (envelope[flag] !== false) errors.push(`sub_agent_governance_authority_or_raw_leak:${flag}`);
  }
  if (envelope.envelopeDigest !== digestFor("sub-agent-governance-envelope@1", envelope)) errors.push("sub_agent_governance_envelope_digest_mismatch");
  for (const row of Array.isArray(envelope.rows) ? envelope.rows : []) {
    if (!isPlainObject(row) || row.schema !== SUB_AGENT_GOVERNANCE_AGENT_ROW_SCHEMA) {
      errors.push("sub_agent_governance_row_schema_mismatch");
      continue;
    }
    if (!NO_INTERFERENCE_POLICIES.has(row.noInterferencePolicy)) errors.push(`sub_agent_governance_invalid_policy:${row.agentThreadId || ""}`);
    if (!RELEASE_STATES.has(row.releaseState)) errors.push(`sub_agent_governance_invalid_release_state:${row.agentThreadId || ""}`);
    if (!GOVERNANCE_STATUSES.has(row.governanceStatus)) errors.push(`sub_agent_governance_invalid_status:${row.agentThreadId || ""}`);
    if (row.parentSelfBindingEnforced !== true) errors.push(`sub_agent_governance_self_binding_missing:${row.agentThreadId || ""}`);
    for (const action of ["provider_declaration", "provider_transport", "workspace_mutation", "child_transcript_promotion"]) {
      if (!row.blockedActions.includes(action)) errors.push(`sub_agent_governance_interference_action_not_blocked:${row.agentThreadId || ""}:${action}`);
    }
    for (const flag of ["providerDeclarationBlocked", "providerTransportBlocked", "workspaceMutationBlocked", "childTranscriptPromotionBlocked", "rawTranscriptIncluded", "rawPromptIncluded", "rawProviderFrameIncluded"]) {
      if (row[flag] !== (flag.startsWith("raw") ? false : true)) errors.push(`sub_agent_governance_row_flag_invalid:${row.agentThreadId || ""}:${flag}`);
    }
    if (row.transcriptWitness?.childTranscriptRenderedAsOperator !== false || row.transcriptWitness?.childReplyRenderedAsPrimaryFinal !== false) {
      errors.push(`sub_agent_governance_transcript_flattened:${row.agentThreadId || ""}`);
    }
  }
  return errors;
}

function validateSubAgentEChannelSnapshot(snapshot = {}) {
  const errors = [];
  if (!isPlainObject(snapshot) || snapshot.schema !== SUB_AGENT_E_CHANNEL_SNAPSHOT_SCHEMA) return ["sub_agent_e_channel_snapshot_schema_mismatch"];
  try {
    validateResidentEpistemicSnapshot(snapshot.residentSnapshot);
  } catch (error) {
    errors.push(`resident_snapshot:${error.message}`);
  }
  for (const flag of ["contextInjectionEnabled", "controlAuthorityGranted", "rawTranscriptIncluded", "rawPromptIncluded", "rawProviderFrameIncluded"]) {
    if (snapshot[flag] !== false) errors.push(`sub_agent_e_channel_authority_or_raw_leak:${flag}`);
  }
  if (snapshot.snapshotDigest !== digestFor("sub-agent-e-channel-snapshot@1", snapshot)) errors.push("sub_agent_e_channel_snapshot_digest_mismatch");
  return errors;
}

module.exports = {
  SUB_AGENT_E_CHANNEL_SNAPSHOT_SCHEMA,
  SUB_AGENT_GOVERNANCE_AGENT_ROW_SCHEMA,
  SUB_AGENT_GOVERNANCE_ENVELOPE_SCHEMA,
  buildSubAgentEChannelSnapshot,
  buildSubAgentEpistemicRows,
  buildSubAgentGovernanceEnvelope,
  validateSubAgentEChannelSnapshot,
  validateSubAgentGovernanceEnvelope,
};
