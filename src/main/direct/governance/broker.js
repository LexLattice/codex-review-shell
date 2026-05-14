"use strict";

const crypto = require("node:crypto");

const DIRECT_GOVERNANCE_INPUT_SNAPSHOT_SCHEMA = "governance_input_snapshot@1";
const DIRECT_GOVERNANCE_PACKET_SCHEMA = "governance_packet@1";
const DIRECT_COMPILED_PROMPT_LAYERS_SCHEMA = "compiled_prompt_layers@1";
const DIRECT_WORKFLOW_TRANSITION_GRAPH_SCHEMA = "workflow_transition_graph@1";
const DIRECT_GOVERNANCE_SHADOW_REPORT_SCHEMA = "governance_shadow_report@1";
const DIRECT_SEMANTIC_BROKER_REGISTRY_SNAPSHOT_SCHEMA = "semantic_broker_registry_snapshot@1";
const DIRECT_SEMANTIC_BROKER_INPUT_SNAPSHOT_SCHEMA = "semantic_broker_input_snapshot@1";
const DIRECT_SEMANTIC_BROKER_PACKET_SCHEMA = "semantic_broker_packet@1";
const DIRECT_SEMANTIC_BROKER_FALLBACK_SCHEMA = "semantic_broker_fallback@1";
const DIRECT_GOVERNANCE_MODE_SNAPSHOT_SCHEMA = "governance_mode_snapshot@1";
const DIRECT_GOVERNANCE_ATTEMPT_RECORD_SCHEMA = "governance_attempt_record@1";
const DIRECT_GOVERNANCE_REQUEST_REFS_SCHEMA = "direct_governance_request_refs@1";
const DIRECT_GOVERNANCE_CITATION_POLICY_SCHEMA = "governance_citation_policy@1";
const DIRECT_GOVERNANCE_BROKER_REGRESSION_REPORT_SCHEMA = "direct_governance_broker_regression_report@1";
const DIRECT_GOVERNANCE_POLICY_VERSION = "direct-governance-shadow-policy@1";
const DIRECT_SEMANTIC_BROKER_POLICY_VERSION = "direct-semantic-broker-diagnostic-policy@1";
const DIRECT_WORKFLOW_GRAPH_VERSION = "direct-workflow-transition-graph@1";
const DIRECT_GOVERNANCE_COMPILER_VERSION = "direct-governance-shadow-compiler@1";
const DIRECT_SEMANTIC_BROKER_VERSION = "direct-semantic-broker-diagnostic@1";

const SOURCE_REF_KINDS = new Set([
  "runtime_tier",
  "current_user_intent",
  "context_pack",
  "request_manifest",
  "provider_input_projection",
  "context_recent_dialogue",
  "renderer_transcript_projection",
  "durable_thread_memory",
  "frontier_baton",
  "omission_ledger",
  "tool_obligation",
  "repair_loop",
  "workspace_effect_summary",
  "recovery_report",
  "thread_workbench_preview",
  "fresh_fork_seed",
  "policy_snapshot",
  "model_evidence",
  "semantic_registry",
  "unknown",
]);

const SOURCE_CONFIDENCE = new Set(["exact", "accepted", "derived", "diagnostic", "future"]);
const PROMPT_LAYER_AUTHORITIES = new Set([
  "harness_policy",
  "current_user_intent",
  "runtime_status",
  "tool_policy",
  "workspace_policy",
  "historical_context_evidence",
  "durable_memory_evidence",
  "frontier_baton_evidence",
  "omission_status_evidence",
  "semantic_broker_diagnostic",
  "governance_diagnostic",
  "unsupported",
]);
const WORKFLOW_EDGE_KINDS = new Set([
  "text",
  "tool_request",
  "approval",
  "local_action",
  "tool_result",
  "provider_continuation",
  "repair_loop",
  "fork_start",
  "context_maintenance",
  "terminal",
  "blocked",
]);
const BLOCKED_TRANSITION_REASONS = new Set([
  "missing_evidence",
  "runtime_tier_unavailable",
  "tool_authority_missing",
  "active_obligation_exists",
  "side_effect_recovery_required",
  "workspace_policy_block",
  "context_maintenance_blocked",
  "raw_exposure_blocked",
  "semantic_broker_ambiguous",
  "governance_packet_missing",
  "enforce_mode_unavailable",
  "unsupported_transition",
]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function nowIso(nowMs = Date.now()) {
  return new Date(Number(nowMs) || Date.now()).toISOString();
}

function artifactDigest(input) {
  return sha256(stableStringify(input));
}

function makeIntegrity(sourceDigest, previousArtifactDigest = "") {
  return {
    algorithm: "sha256",
    artifactDigest: "",
    sourceDigest: normalizeString(sourceDigest, ""),
    previousArtifactDigest: normalizeString(previousArtifactDigest, ""),
  };
}

function normalizeSourceRef(input = {}) {
  const kind = SOURCE_REF_KINDS.has(input.kind) ? input.kind : "unknown";
  const sourceConfidence = SOURCE_CONFIDENCE.has(input.sourceConfidence) ? input.sourceConfidence : "diagnostic";
  const ref = {
    kind,
    artifactId: normalizeString(input.artifactId, ""),
    artifactDigest: normalizeString(input.artifactDigest, ""),
    sourceConfidence,
    rendererSafeLabel: normalizeString(input.rendererSafeLabel, kind),
    rawTextIncluded: false,
  };
  ref.refDigest = sha256(stableStringify(ref));
  return ref;
}

function normalizeSourceRefs(values) {
  if (!Array.isArray(values)) return [];
  return values.map((value) => normalizeSourceRef(value));
}

function buildGovernanceModeSnapshot(input = {}) {
  const effectiveMode = ["off", "shadow", "enforce_unavailable"].includes(input.effectiveMode) ? input.effectiveMode : "shadow";
  const effectiveSource = ["default", "project", "runtime-profile", "diagnostic"].includes(input.effectiveSource) ? input.effectiveSource : "default";
  const snapshot = {
    schema: DIRECT_GOVERNANCE_MODE_SNAPSHOT_SCHEMA,
    governanceModeSnapshotId: normalizeString(input.governanceModeSnapshotId, `governance_mode_${sha256(`${effectiveMode}:${effectiveSource}:${input.sourceDigest || ""}`).slice(0, 24)}`),
    effectiveMode,
    effectiveSource,
    sourceDigest: normalizeString(input.sourceDigest, sha256(`${effectiveMode}:${effectiveSource}`)),
    editableInThisPr: false,
    enforceModeAvailable: false,
    enforceUnavailableReason: effectiveMode === "enforce_unavailable"
      ? normalizeString(input.enforceUnavailableReason, "not_implemented")
      : "",
    privateConfigIncluded: false,
    rendererSafeSummary: effectiveMode === "shadow"
      ? "Governance diagnostics are running in shadow mode."
      : effectiveMode === "off" ? "Governance diagnostics are off." : "Governance enforce mode is unavailable in this PR.",
  };
  snapshot.integrity = makeIntegrity(snapshot.sourceDigest);
  snapshot.integrity.artifactDigest = artifactDigest({ ...snapshot, integrity: { ...snapshot.integrity, artifactDigest: "" } });
  return snapshot;
}

function buildGovernanceInputSnapshot(input = {}) {
  const sourceRefs = {
    runtimeTierRef: normalizeSourceRef(input.runtimeTierRef || { kind: "runtime_tier", artifactId: "runtime_tier_unknown", artifactDigest: sha256("runtime_tier_unknown"), rendererSafeLabel: "Runtime tier", sourceConfidence: "diagnostic" }),
    currentUserIntentRef: input.currentUserIntentRef ? normalizeSourceRef(input.currentUserIntentRef) : null,
    contextPackRef: input.contextPackRef ? normalizeSourceRef(input.contextPackRef) : null,
    requestManifestRef: input.requestManifestRef ? normalizeSourceRef(input.requestManifestRef) : null,
    maintenanceRefs: normalizeSourceRefs(input.maintenanceRefs),
    memoryRefs: normalizeSourceRefs(input.memoryRefs),
    batonRef: input.batonRef ? normalizeSourceRef(input.batonRef) : null,
    omissionLedgerRef: input.omissionLedgerRef ? normalizeSourceRef(input.omissionLedgerRef) : null,
    toolObligationRefs: normalizeSourceRefs(input.toolObligationRefs),
    repairLoopRef: input.repairLoopRef ? normalizeSourceRef(input.repairLoopRef) : null,
    workspaceEffectRefs: normalizeSourceRefs(input.workspaceEffectRefs),
    recoveryStateRef: input.recoveryStateRef ? normalizeSourceRef(input.recoveryStateRef) : null,
    threadWorkbenchRefs: normalizeSourceRefs(input.threadWorkbenchRefs),
  };
  const sourceDigest = normalizeString(input.sourceDigest, sha256(stableStringify(sourceRefs)));
  const snapshot = {
    schema: DIRECT_GOVERNANCE_INPUT_SNAPSHOT_SCHEMA,
    governanceInputSnapshotId: normalizeString(input.governanceInputSnapshotId, `governance_input_${sha256(`${input.projectId}:${input.threadId}:${sourceDigest}`).slice(0, 24)}`),
    projectId: normalizeString(input.projectId, ""),
    threadId: normalizeString(input.threadId, ""),
    turnId: normalizeString(input.turnId, ""),
    trigger: normalizeString(input.trigger, "diagnostic"),
    ...sourceRefs,
    sourceDigest,
    createdAt: normalizeString(input.createdAt, nowIso(input.nowMs)),
    rawTextIncluded: false,
  };
  snapshot.integrity = makeIntegrity(sourceDigest);
  snapshot.integrity.artifactDigest = artifactDigest({ ...snapshot, integrity: { ...snapshot.integrity, artifactDigest: "" } });
  return snapshot;
}

function buildGovernancePacket(input = {}) {
  const inputSnapshot = isPlainObject(input.inputSnapshot) ? input.inputSnapshot : buildGovernanceInputSnapshot(input);
  const modeSnapshot = isPlainObject(input.modeSnapshot) ? input.modeSnapshot : buildGovernanceModeSnapshot(input);
  const diagnostics = Array.isArray(input.diagnostics) ? input.diagnostics : [];
  const sourceDigest = sha256(stableStringify({
    inputSnapshotDigest: inputSnapshot.integrity?.artifactDigest || inputSnapshot.sourceDigest,
    modeSnapshotDigest: modeSnapshot.integrity?.artifactDigest || modeSnapshot.sourceDigest,
    policy: input.packetPolicyDigest || DIRECT_GOVERNANCE_POLICY_VERSION,
  }));
  const packet = {
    schema: DIRECT_GOVERNANCE_PACKET_SCHEMA,
    governancePacketId: normalizeString(input.governancePacketId, `governance_packet_${sha256(sourceDigest).slice(0, 24)}`),
    projectId: normalizeString(input.projectId, inputSnapshot.projectId || ""),
    threadId: normalizeString(input.threadId, inputSnapshot.threadId || ""),
    turnId: normalizeString(input.turnId, inputSnapshot.turnId || ""),
    mode: modeSnapshot.effectiveMode,
    modeSource: modeSnapshot.effectiveSource,
    inputSnapshotId: inputSnapshot.governanceInputSnapshotId,
    inputSnapshotDigest: inputSnapshot.integrity?.artifactDigest || inputSnapshot.sourceDigest,
    packetPolicyDigest: normalizeString(input.packetPolicyDigest, sha256(DIRECT_GOVERNANCE_POLICY_VERSION)),
    roleMappingDigest: normalizeString(input.roleMappingDigest, ""),
    runtimeTierDigest: normalizeString(input.runtimeTierDigest, inputSnapshot.runtimeTierRef?.artifactDigest || ""),
    contextPolicyDigest: normalizeString(input.contextPolicyDigest, ""),
    maintenanceRefsDigest: normalizeString(input.maintenanceRefsDigest, ""),
    toolPolicyDigest: normalizeString(input.toolPolicyDigest, ""),
    workspacePolicyDigest: normalizeString(input.workspacePolicyDigest, ""),
    transitionGraphDigest: normalizeString(input.transitionGraphDigest, ""),
    semanticBrokerPolicyDigest: normalizeString(input.semanticBrokerPolicyDigest, sha256(DIRECT_SEMANTIC_BROKER_POLICY_VERSION)),
    layers: Array.isArray(input.layers) ? input.layers : [],
    diagnostics,
    rendererSafeSummary: normalizeString(input.rendererSafeSummary, "Governance packet compiled in diagnostic shadow mode."),
    editableInThisPr: false,
    enforceableInThisPr: false,
    rawTextIncluded: false,
    rawRequestBodyIncluded: false,
    rawProviderFrameIncluded: false,
  };
  packet.integrity = makeIntegrity(sourceDigest);
  packet.integrity.artifactDigest = artifactDigest({ ...packet, integrity: { ...packet.integrity, artifactDigest: "" } });
  return packet;
}

function buildCompiledPromptLayers(input = {}) {
  const governancePacket = isPlainObject(input.governancePacket) ? input.governancePacket : null;
  const baseRefs = governancePacket
    ? [normalizeSourceRef({
        kind: "policy_snapshot",
        artifactId: governancePacket.governancePacketId,
        artifactDigest: governancePacket.integrity?.artifactDigest || "",
        rendererSafeLabel: "Governance packet",
        sourceConfidence: "exact",
      })]
    : [];
  const layerInputs = Array.isArray(input.layers) && input.layers.length
    ? input.layers
    : [
        { kind: "harness", authority: "harness_policy", rendererSafeSummary: "Existing harness policy layer.", providerInputEligible: true, currentInstructionAuthority: true },
        { kind: "current_user_intent", authority: "current_user_intent", rendererSafeSummary: "Current user intent layer.", providerInputEligible: true, currentInstructionAuthority: true },
        { kind: "semantic_broker_status", authority: "semantic_broker_diagnostic", rendererSafeSummary: "Broker diagnostics remain status evidence.", providerInputEligible: false, currentInstructionAuthority: false },
      ];
  const layers = layerInputs.map((layer, index) => {
    const authority = PROMPT_LAYER_AUTHORITIES.has(layer.authority) ? layer.authority : "unsupported";
    const output = {
      layerId: normalizeString(layer.layerId, `prompt_layer_${index + 1}`),
      kind: normalizeString(layer.kind, "unsupported"),
      authority,
      sourceRefs: normalizeSourceRefs(layer.sourceRefs || baseRefs),
      rendererSafeSummary: normalizeString(layer.rendererSafeSummary, "Prompt layer diagnostic."),
      providerInputEligible: layer.providerInputEligible === true,
      currentInstructionAuthority: layer.currentInstructionAuthority === true,
      mayBecomeProviderInstructionInThisPr: layer.mayBecomeProviderInstructionInThisPr === true,
      includedInProviderInputByPr9: false,
      quotedEvidence: layer.quotedEvidence !== false && !["harness_policy", "current_user_intent", "tool_policy", "workspace_policy"].includes(authority),
      rawTextIncluded: false,
    };
    output.layerDigest = sha256(stableStringify(output));
    return output;
  });
  const sourceDigest = sha256(stableStringify({
    governancePacketDigest: governancePacket?.integrity?.artifactDigest || "",
    layers: layers.map((layer) => layer.layerDigest),
    compiler: DIRECT_GOVERNANCE_COMPILER_VERSION,
  }));
  const compiled = {
    schema: DIRECT_COMPILED_PROMPT_LAYERS_SCHEMA,
    providerInputMutationAllowedInThisPr: false,
    compiledPromptLayersId: normalizeString(input.compiledPromptLayersId, `compiled_layers_${sha256(sourceDigest).slice(0, 24)}`),
    governancePacketId: normalizeString(input.governancePacketId, governancePacket?.governancePacketId || ""),
    projectId: normalizeString(input.projectId, governancePacket?.projectId || ""),
    threadId: normalizeString(input.threadId, governancePacket?.threadId || ""),
    turnId: normalizeString(input.turnId, governancePacket?.turnId || ""),
    roleMappingDigest: normalizeString(input.roleMappingDigest, governancePacket?.roleMappingDigest || ""),
    layerOrder: layers.map((layer) => layer.kind),
    layers,
    providerInputProjectionId: normalizeString(input.providerInputProjectionId, ""),
    providerInputProjectionDigest: normalizeString(input.providerInputProjectionDigest, ""),
    compiledShapeHash: sha256(stableStringify(layers.map((layer) => ({ kind: layer.kind, authority: layer.authority })))),
    compiledTextHash: "",
    rawCompiledTextStored: false,
    diagnostics: Array.isArray(input.diagnostics) ? input.diagnostics : [],
  };
  compiled.integrity = makeIntegrity(sourceDigest);
  compiled.integrity.artifactDigest = artifactDigest({ ...compiled, integrity: { ...compiled.integrity, artifactDigest: "" } });
  return compiled;
}

function buildWorkflowTransitionGraph(input = {}) {
  const allowedEdges = Array.isArray(input.allowedEdges) ? input.allowedEdges : [
    { from: "text_turn", to: "assistant_final", edgeKind: "text" },
    { from: "read_file_obligation", to: "tool_continuation", edgeKind: "provider_continuation" },
    { from: "fresh_fork_start", to: "assistant_final", edgeKind: "fork_start" },
  ];
  const blockedEdges = Array.isArray(input.blockedEdges) ? input.blockedEdges : [
    { from: "run_command_obligation", to: "tool_continuation", edgeKind: "blocked", reasonCode: "side_effect_recovery_required" },
    { from: "context_maintenance", to: "tool_continuation", edgeKind: "blocked", reasonCode: "active_obligation_exists" },
  ];
  const normalizedAllowed = allowedEdges.map((edge) => ({
    from: normalizeString(edge.from, "text_turn"),
    to: normalizeString(edge.to, "assistant_final"),
    edgeKind: WORKFLOW_EDGE_KINDS.has(edge.edgeKind) ? edge.edgeKind : "text",
    rendererSafeSummary: normalizeString(edge.rendererSafeSummary, "Allowed transition diagnostic."),
  }));
  const normalizedBlocked = blockedEdges.map((edge) => ({
    from: normalizeString(edge.from, "text_turn"),
    to: normalizeString(edge.to, "blocked_terminal"),
    edgeKind: WORKFLOW_EDGE_KINDS.has(edge.edgeKind) ? edge.edgeKind : "blocked",
    reasonCode: BLOCKED_TRANSITION_REASONS.has(edge.reasonCode) ? edge.reasonCode : "unsupported_transition",
    rendererSafeSummary: normalizeString(edge.rendererSafeSummary, "Blocked transition diagnostic."),
  }));
  const graphSource = {
    allowedEdges: normalizedAllowed,
    blockedEdges: normalizedBlocked,
    policyDigests: input.policyDigests || {},
    version: DIRECT_WORKFLOW_GRAPH_VERSION,
  };
  const graphDigest = sha256(stableStringify(graphSource));
  const graph = {
    schema: DIRECT_WORKFLOW_TRANSITION_GRAPH_SCHEMA,
    transitionGraphId: normalizeString(input.transitionGraphId, `transition_graph_${graphDigest.slice(0, 24)}`),
    projectId: normalizeString(input.projectId, ""),
    graphVersion: normalizeString(input.graphVersion, DIRECT_WORKFLOW_GRAPH_VERSION),
    mode: normalizeString(input.mode, "diagnostic"),
    allowedNodes: Array.isArray(input.allowedNodes) ? input.allowedNodes : [
      "text_turn",
      "read_file_obligation",
      "apply_patch_obligation",
      "run_command_obligation",
      "tool_continuation",
      "repair_loop_step",
      "workspace_effect_scan",
      "fresh_fork_start",
      "context_maintenance",
      "assistant_final",
      "blocked_terminal",
    ],
    allowedEdges: normalizedAllowed,
    blockedEdges: normalizedBlocked,
    parityResult: input.parityResult || {
      graphId: `transition_graph_${graphDigest.slice(0, 24)}`,
      controllerVersion: "fixture_controller_parity@1",
      checkedTransitions: [...normalizedAllowed, ...normalizedBlocked].map((edge) => ({
        from: edge.from,
        to: edge.to,
        edgeKind: edge.edgeKind,
        graphDecision: normalizedBlocked.includes(edge) ? "blocked" : "allowed",
        controllerDecision: "unknown",
        parity: "not_checked",
      })),
    },
    policyDigests: {
      runtimePolicyDigest: normalizeString(input.policyDigests?.runtimePolicyDigest, ""),
      toolPolicyDigest: normalizeString(input.policyDigests?.toolPolicyDigest, ""),
      workspacePolicyDigest: normalizeString(input.policyDigests?.workspacePolicyDigest, ""),
      contextMaintenancePolicyDigest: normalizeString(input.policyDigests?.contextMaintenancePolicyDigest, ""),
      governancePolicyDigest: normalizeString(input.policyDigests?.governancePolicyDigest, sha256(DIRECT_GOVERNANCE_POLICY_VERSION)),
    },
    graphDigest,
    rawTextIncluded: false,
  };
  graph.integrity = makeIntegrity(graphDigest);
  graph.integrity.artifactDigest = artifactDigest({ ...graph, integrity: { ...graph.integrity, artifactDigest: "" } });
  return graph;
}

function buildSemanticBrokerRegistrySnapshot(input = {}) {
  const routes = Array.isArray(input.routes) && input.routes.length ? input.routes : [
    { routeKind: "text_only", toolSurface: "none", requiredEvidenceKinds: ["runtime_tier"], contextPolicyKinds: ["direct_text"], runtimeTierKinds: ["direct_text"] },
    { routeKind: "implementation_lane_read", toolSurface: "read_file", requiredEvidenceKinds: ["tool_obligation", "policy_snapshot"], contextPolicyKinds: ["tool_context"], runtimeTierKinds: ["direct_implementation"] },
    { routeKind: "implementation_lane_patch", toolSurface: "apply_patch", requiredEvidenceKinds: ["tool_obligation", "workspace_effect_summary"], contextPolicyKinds: ["tool_context"], runtimeTierKinds: ["direct_implementation"] },
    { routeKind: "implementation_lane_command", toolSurface: "run_command", requiredEvidenceKinds: ["tool_obligation", "workspace_effect_summary"], contextPolicyKinds: ["tool_context"], runtimeTierKinds: ["direct_implementation"] },
    { routeKind: "repair_loop", toolSurface: "mixed_sequential", requiredEvidenceKinds: ["repair_loop"], contextPolicyKinds: ["repair_context"], runtimeTierKinds: ["direct_implementation"] },
    { routeKind: "fresh_fork_start", toolSurface: "none", requiredEvidenceKinds: ["thread_workbench_preview", "fresh_fork_seed"], contextPolicyKinds: ["fork_start"], runtimeTierKinds: ["direct_text"] },
    { routeKind: "context_maintenance", toolSurface: "none", requiredEvidenceKinds: ["context_pack"], contextPolicyKinds: ["maintenance"], runtimeTierKinds: ["direct_text"] },
  ];
  const normalizedRoutes = routes.map((route) => ({
    routeKind: normalizeString(route.routeKind, "unsupported"),
    toolSurface: normalizeString(route.toolSurface, "none"),
    requiredEvidenceKinds: Array.isArray(route.requiredEvidenceKinds) ? route.requiredEvidenceKinds : [],
    contextPolicyKinds: Array.isArray(route.contextPolicyKinds) ? route.contextPolicyKinds : [],
    runtimeTierKinds: Array.isArray(route.runtimeTierKinds) ? route.runtimeTierKinds : [],
    enabledForAutoApplyInThisPr: false,
  }));
  const registryDigest = sha256(stableStringify(normalizedRoutes));
  return {
    schema: DIRECT_SEMANTIC_BROKER_REGISTRY_SNAPSHOT_SCHEMA,
    registrySnapshotId: normalizeString(input.registrySnapshotId, `semantic_registry_${registryDigest.slice(0, 24)}`),
    projectId: normalizeString(input.projectId, ""),
    version: normalizeString(input.version, DIRECT_SEMANTIC_BROKER_VERSION),
    routes: normalizedRoutes,
    registryDigest,
    rawPromptTextIncluded: false,
  };
}

function buildSemanticBrokerInputSnapshot(input = {}) {
  const refs = {
    currentUserIntentRef: input.currentUserIntentRef ? normalizeSourceRef(input.currentUserIntentRef) : null,
    runtimeTierRef: normalizeSourceRef(input.runtimeTierRef || { kind: "runtime_tier", artifactId: "runtime_tier_unknown", artifactDigest: sha256("runtime_tier_unknown"), rendererSafeLabel: "Runtime tier", sourceConfidence: "diagnostic" }),
    governancePacketRef: input.governancePacketRef ? normalizeSourceRef(input.governancePacketRef) : null,
    contextPolicyRef: input.contextPolicyRef ? normalizeSourceRef(input.contextPolicyRef) : null,
    toolPolicyRefs: normalizeSourceRefs(input.toolPolicyRefs),
    workspacePolicyRef: input.workspacePolicyRef ? normalizeSourceRef(input.workspacePolicyRef) : null,
    evidenceStatusRefs: normalizeSourceRefs(input.evidenceStatusRefs),
  };
  const sourceDigest = normalizeString(input.sourceDigest, sha256(stableStringify(refs)));
  const snapshot = {
    schema: DIRECT_SEMANTIC_BROKER_INPUT_SNAPSHOT_SCHEMA,
    semanticBrokerInputSnapshotId: normalizeString(input.semanticBrokerInputSnapshotId, `broker_input_${sourceDigest.slice(0, 24)}`),
    projectId: normalizeString(input.projectId, ""),
    threadId: normalizeString(input.threadId, ""),
    turnId: normalizeString(input.turnId, ""),
    ...refs,
    sourceDigest,
    rawUserPromptIncluded: false,
  };
  snapshot.integrity = makeIntegrity(sourceDigest);
  snapshot.integrity.artifactDigest = artifactDigest({ ...snapshot, integrity: { ...snapshot.integrity, artifactDigest: "" } });
  return snapshot;
}

function candidateFromRoute(route, overrides = {}) {
  return {
    candidateId: normalizeString(overrides.candidateId, `candidate_${sha256(`${route.routeKind}:${route.toolSurface}`).slice(0, 16)}`),
    routeKind: normalizeString(route.routeKind, "unsupported"),
    schemaKind: normalizeString(overrides.schemaKind, ""),
    toolSurface: normalizeString(route.toolSurface, "none"),
    contextPolicyHint: normalizeString(overrides.contextPolicyHint, route.contextPolicyKinds?.[0] || ""),
    requiredEvidenceRefs: normalizeSourceRefs(overrides.requiredEvidenceRefs),
    missingEvidenceCodes: Array.isArray(overrides.missingEvidenceCodes) ? overrides.missingEvidenceCodes : [],
    confidence: normalizeString(overrides.confidence, "medium"),
    reasonCodes: Array.isArray(overrides.reasonCodes) ? overrides.reasonCodes : ["diagnostic_route_candidate"],
    rendererSafeSummary: normalizeString(overrides.rendererSafeSummary, `${route.routeKind} diagnostic candidate.`),
    wouldRequireUserDecisionInFuture: overrides.wouldRequireUserDecisionInFuture === true,
    wouldMutateRuntimeIfAppliedInFuture: overrides.wouldMutateRuntimeIfAppliedInFuture === true,
    mayAutoApplyInThisPr: false,
    enabledInThisPr: false,
  };
}

function buildSemanticBrokerFallback(input = {}) {
  const fallbackKind = normalizeString(input.fallbackKind, "diagnostic_only");
  const reasonCode = normalizeString(input.reasonCode, "ambiguous_task_route");
  const sourceDigest = sha256(stableStringify({ fallbackKind, reasonCode, broker: input.semanticBrokerPacketId || "" }));
  const fallback = {
    schema: DIRECT_SEMANTIC_BROKER_FALLBACK_SCHEMA,
    fallbackId: normalizeString(input.fallbackId, `broker_fallback_${sourceDigest.slice(0, 24)}`),
    semanticBrokerPacketId: normalizeString(input.semanticBrokerPacketId, ""),
    fallbackKind,
    reasonCode,
    enabledInThisPr: false,
    fallbackUiState: normalizeString(input.fallbackUiState, fallbackKind === "ask_human" ? "disabled_ask_human" : "diagnostic_only"),
    rendererSafePrompt: normalizeString(input.rendererSafePrompt, ""),
    rawUserPromptIncluded: false,
  };
  fallback.integrity = makeIntegrity(sourceDigest);
  fallback.integrity.artifactDigest = artifactDigest({ ...fallback, integrity: { ...fallback.integrity, artifactDigest: "" } });
  return fallback;
}

function buildSemanticBrokerPacket(input = {}) {
  const registry = isPlainObject(input.registrySnapshot) ? input.registrySnapshot : buildSemanticBrokerRegistrySnapshot(input);
  const inputSnapshot = isPlainObject(input.inputSnapshot) ? input.inputSnapshot : buildSemanticBrokerInputSnapshot(input);
  const candidates = Array.isArray(input.candidates) && input.candidates.length
    ? input.candidates
    : registry.routes.map((route) => candidateFromRoute(route));
  const ambiguous = candidates.length !== 1 || input.forceAmbiguous === true;
  const sourceDigest = sha256(stableStringify({
    inputSnapshotDigest: inputSnapshot.integrity?.artifactDigest || inputSnapshot.sourceDigest,
    registryDigest: registry.registryDigest,
    candidates,
  }));
  const semanticBrokerPacketId = normalizeString(input.semanticBrokerPacketId, `broker_packet_${sourceDigest.slice(0, 24)}`);
  const fallbackState = input.fallbackState || (ambiguous
    ? buildSemanticBrokerFallback({
        semanticBrokerPacketId,
        fallbackKind: "ask_human",
        reasonCode: "ambiguous_task_route",
      })
    : null);
  const packet = {
    schema: DIRECT_SEMANTIC_BROKER_PACKET_SCHEMA,
    semanticBrokerPacketId,
    projectId: normalizeString(input.projectId, inputSnapshot.projectId || ""),
    threadId: normalizeString(input.threadId, inputSnapshot.threadId || ""),
    turnId: normalizeString(input.turnId, inputSnapshot.turnId || ""),
    mode: normalizeString(input.mode, "diagnostic"),
    inputSnapshotId: inputSnapshot.semanticBrokerInputSnapshotId,
    inputSnapshotDigest: inputSnapshot.integrity?.artifactDigest || inputSnapshot.sourceDigest,
    brokerPolicyDigest: normalizeString(input.brokerPolicyDigest, sha256(DIRECT_SEMANTIC_BROKER_POLICY_VERSION)),
    registrySnapshotDigest: registry.registryDigest,
    governancePacketDigest: normalizeString(input.governancePacketDigest, ""),
    candidates,
    adjudication: {
      status: ambiguous ? "ambiguous" : "selected_single_candidate",
      selectedCandidateId: ambiguous ? "" : candidates[0]?.candidateId,
      confidence: ambiguous ? "unknown" : normalizeString(candidates[0]?.confidence, "medium"),
      reasonCode: ambiguous ? "ambiguous_task_route" : "single_candidate_diagnostic",
      autoRouteApplied: false,
    },
    fallbackState,
    rendererSafeSummary: ambiguous ? "Semantic broker diagnostics found ambiguous route candidates." : "Semantic broker diagnostics selected one candidate.",
    rawUserPromptIncluded: false,
    rawToolArgsIncluded: false,
    rawContextTextIncluded: false,
  };
  packet.integrity = makeIntegrity(sourceDigest);
  packet.integrity.artifactDigest = artifactDigest({ ...packet, integrity: { ...packet.integrity, artifactDigest: "" } });
  return packet;
}

function buildGovernanceShadowReport(input = {}) {
  const status = normalizeString(input.status, "diagnostic_only");
  const sourceDigest = sha256(stableStringify({
    governancePacketId: input.governancePacket?.governancePacketId || input.governancePacketId || "",
    compiledPromptLayersId: input.compiledPromptLayers?.compiledPromptLayersId || input.compiledPromptLayersId || "",
    transitionGraphId: input.transitionGraph?.transitionGraphId || input.transitionGraphId || "",
    semanticBrokerPacketId: input.semanticBrokerPacket?.semanticBrokerPacketId || input.semanticBrokerPacketId || "",
    status,
  }));
  const report = {
    schema: DIRECT_GOVERNANCE_SHADOW_REPORT_SCHEMA,
    shadowReportId: normalizeString(input.shadowReportId, `governance_shadow_${sourceDigest.slice(0, 24)}`),
    governancePacketId: normalizeString(input.governancePacketId, input.governancePacket?.governancePacketId || ""),
    compiledPromptLayersId: normalizeString(input.compiledPromptLayersId, input.compiledPromptLayers?.compiledPromptLayersId || ""),
    transitionGraphId: normalizeString(input.transitionGraphId, input.transitionGraph?.transitionGraphId || ""),
    semanticBrokerPacketId: normalizeString(input.semanticBrokerPacketId, input.semanticBrokerPacket?.semanticBrokerPacketId || ""),
    projectId: normalizeString(input.projectId, input.governancePacket?.projectId || ""),
    threadId: normalizeString(input.threadId, input.governancePacket?.threadId || ""),
    turnId: normalizeString(input.turnId, input.governancePacket?.turnId || ""),
    status,
    diagnostics: Array.isArray(input.diagnostics) ? input.diagnostics : [],
    wouldBlockInFutureEnforceMode: input.wouldBlockInFutureEnforceMode === true,
    blockedInThisPr: false,
    rendererSafeSummary: normalizeString(input.rendererSafeSummary, "Governance shadow diagnostics recorded."),
    rawTextIncluded: false,
  };
  report.integrity = makeIntegrity(sourceDigest);
  report.integrity.artifactDigest = artifactDigest({ ...report, integrity: { ...report.integrity, artifactDigest: "" } });
  return report;
}

function buildGovernanceAttemptRecord(input = {}) {
  return {
    schema: DIRECT_GOVERNANCE_ATTEMPT_RECORD_SCHEMA,
    attemptId: normalizeString(input.attemptId, `governance_attempt_${sha256(`${input.attemptKind}:${input.status}:${input.sourceDigest || ""}`).slice(0, 24)}`),
    attemptKind: normalizeString(input.attemptKind, "governance_packet"),
    status: normalizeString(input.status, "diagnostic"),
    replacesCurrentPointer: false,
    rendererSafeSummary: normalizeString(input.rendererSafeSummary, "Governance diagnostic attempt recorded."),
    rawTextIncluded: false,
  };
}

function governanceRequestRefsFromArtifacts(input = {}) {
  const refs = {
    schema: DIRECT_GOVERNANCE_REQUEST_REFS_SCHEMA,
    governanceInputSnapshotId: normalizeString(input.governanceInputSnapshot?.governanceInputSnapshotId, ""),
    governanceInputSnapshotDigest: normalizeString(input.governanceInputSnapshot?.integrity?.artifactDigest, ""),
    governancePacketId: normalizeString(input.governancePacket?.governancePacketId, ""),
    governancePacketDigest: normalizeString(input.governancePacket?.integrity?.artifactDigest, ""),
    compiledPromptLayersId: normalizeString(input.compiledPromptLayers?.compiledPromptLayersId, ""),
    compiledPromptLayersDigest: normalizeString(input.compiledPromptLayers?.integrity?.artifactDigest, ""),
    transitionGraphId: normalizeString(input.transitionGraph?.transitionGraphId, ""),
    transitionGraphDigest: normalizeString(input.transitionGraph?.integrity?.artifactDigest || input.transitionGraph?.graphDigest, ""),
    semanticBrokerPacketId: normalizeString(input.semanticBrokerPacket?.semanticBrokerPacketId, ""),
    semanticBrokerPacketDigest: normalizeString(input.semanticBrokerPacket?.integrity?.artifactDigest, ""),
    brokerFallbackId: normalizeString(input.brokerFallback?.fallbackId || input.semanticBrokerPacket?.fallbackState?.fallbackId, ""),
    brokerFallbackDigest: normalizeString(input.brokerFallback?.integrity?.artifactDigest || input.semanticBrokerPacket?.fallbackState?.integrity?.artifactDigest, ""),
    citationPolicyDigest: normalizeString(input.citationPolicyDigest, sha256(DIRECT_GOVERNANCE_CITATION_POLICY_SCHEMA)),
  };
  refs.refsDigest = sha256(stableStringify(refs));
  return refs;
}

function validateGovernanceRequestRefs(refs = {}) {
  if (!refs || !isPlainObject(refs)) return true;
  for (const [key, value] of Object.entries(refs)) {
    if (/raw/i.test(key) && value === true) {
      const error = new Error("governance_request_refs_raw_exposure_blocked");
      error.code = "governance_request_refs_raw_exposure_blocked";
      throw error;
    }
  }
  if (refs.requiredForFutureEnforce === true) {
    const error = new Error("governance_enforce_unavailable");
    error.code = "governance_enforce_unavailable";
    throw error;
  }
  return true;
}

function buildGovernanceStatusProjection(input = {}) {
  const sourceDigest = normalizeString(input.sourceDigest, sha256(stableStringify({
    packet: input.governancePacketId,
    broker: input.semanticBrokerPacketId,
    graph: input.transitionGraphId,
  })));
  return {
    schema: "direct_governance_status_projection@1",
    projectId: normalizeString(input.projectId, ""),
    threadId: normalizeString(input.threadId, ""),
    turnId: normalizeString(input.turnId, ""),
    uiProjectionGeneration: Number(input.uiProjectionGeneration || 1),
    sourceDigest,
    operationLedgerHeadDigest: normalizeString(input.operationLedgerHeadDigest, ""),
    mode: normalizeString(input.mode, "shadow"),
    packetState: normalizeString(input.packetState, "valid"),
    brokerState: normalizeString(input.brokerState, "valid"),
    transitionGraphState: normalizeString(input.transitionGraphState, "valid"),
    rendererSafeSummary: normalizeString(input.rendererSafeSummary, "Governance diagnostics are display-only."),
    actionable: false,
    rawTextIncluded: false,
    projectionDigest: sha256(sourceDigest),
  };
}

function governanceRecoveryState(input = {}) {
  if (input.corrupt === true) return "corrupt";
  if (input.pointerDigestMismatch === true) return "current_pointer_digest_mismatch";
  if (input.schemaInvalid === true) return "current_pointer_schema_invalid";
  if (input.rawExposureBlocked === true) return "current_pointer_raw_exposure_blocked";
  if (input.packetValidLayersMissing === true) return "packet_valid_layers_missing";
  if (input.brokerValidFallbackMissing === true) return "broker_valid_fallback_missing";
  if (input.transitionGraphMismatch === true) return "transition_graph_mismatch";
  if (input.attemptHistoryOnly === true) return "attempt_history_only";
  if (input.pointerMissing === true) return "current_pointer_missing";
  return "healthy";
}

function validateGovernanceBrokerRegressionReport(report = {}) {
  if (report.schema !== DIRECT_GOVERNANCE_BROKER_REGRESSION_REPORT_SCHEMA) {
    throw new Error("direct_governance_broker_report_schema_mismatch");
  }
  if (!Array.isArray(report.cases) || !report.cases.length) throw new Error("direct_governance_broker_report_cases_missing");
  if (report.promotionCandidates?.D17_enforceMode !== false) throw new Error("direct_governance_enforce_promoted");
  const counters = report.sentinelCounters || {};
  for (const key of [
    "providerTransportCalls",
    "appServerSpawnCalls",
    "workspaceReadCalls",
    "patchApplyCalls",
    "commandRunCalls",
    "memoryEdits",
    "autoRouteApplications",
    "runtimeTierMutationCalls",
    "toolDeclarationMutations",
    "requestManifestBuildsFromBroker",
    "rightPaneMutationCalls",
    "handoffMutationCalls",
  ]) {
    if (Number(counters[key] || 0) !== 0) throw new Error(`direct_governance_broker_sentinel_nonzero:${key}`);
  }
  for (const entry of report.cases) {
    if (entry.coverageSource === "fixture_governance_broker" && entry.matrixPromotionCandidate === true) {
      throw new Error(`fixture_governance_broker_promoted:${entry.caseId}`);
    }
  }
  return true;
}

module.exports = {
  BLOCKED_TRANSITION_REASONS,
  DIRECT_COMPILED_PROMPT_LAYERS_SCHEMA,
  DIRECT_GOVERNANCE_ATTEMPT_RECORD_SCHEMA,
  DIRECT_GOVERNANCE_BROKER_REGRESSION_REPORT_SCHEMA,
  DIRECT_GOVERNANCE_CITATION_POLICY_SCHEMA,
  DIRECT_GOVERNANCE_INPUT_SNAPSHOT_SCHEMA,
  DIRECT_GOVERNANCE_MODE_SNAPSHOT_SCHEMA,
  DIRECT_GOVERNANCE_PACKET_SCHEMA,
  DIRECT_GOVERNANCE_REQUEST_REFS_SCHEMA,
  DIRECT_GOVERNANCE_SHADOW_REPORT_SCHEMA,
  DIRECT_SEMANTIC_BROKER_FALLBACK_SCHEMA,
  DIRECT_SEMANTIC_BROKER_INPUT_SNAPSHOT_SCHEMA,
  DIRECT_SEMANTIC_BROKER_PACKET_SCHEMA,
  DIRECT_SEMANTIC_BROKER_REGISTRY_SNAPSHOT_SCHEMA,
  DIRECT_WORKFLOW_TRANSITION_GRAPH_SCHEMA,
  PROMPT_LAYER_AUTHORITIES,
  SOURCE_CONFIDENCE,
  SOURCE_REF_KINDS,
  WORKFLOW_EDGE_KINDS,
  buildCompiledPromptLayers,
  buildGovernanceAttemptRecord,
  buildGovernanceInputSnapshot,
  buildGovernanceModeSnapshot,
  buildGovernancePacket,
  buildGovernanceShadowReport,
  buildGovernanceStatusProjection,
  buildSemanticBrokerFallback,
  buildSemanticBrokerInputSnapshot,
  buildSemanticBrokerPacket,
  buildSemanticBrokerRegistrySnapshot,
  buildWorkflowTransitionGraph,
  candidateFromRoute,
  governanceRecoveryState,
  governanceRequestRefsFromArtifacts,
  normalizeSourceRef,
  sha256,
  stableStringify,
  validateGovernanceBrokerRegressionReport,
  validateGovernanceRequestRefs,
};
