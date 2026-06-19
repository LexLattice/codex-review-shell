"use strict";

const {
  buildOdeuActivationRow,
  buildOdeuCapabilityRow,
  buildOdeuDeclarationSnapshot,
  buildOdeuEvidenceRef,
  buildOdeuPromotionDecision,
  digestCanonicalJson,
  normalizeOdeuSourceRef,
  validateOdeuActivationRow,
  validateOdeuCapabilityRow,
  validateOdeuDeclarationSnapshot,
  validateOdeuPromotionDecision,
} = require("../odeu");
const { normalizeString, nowIso } = require("../meta-session/ids");

const SUB_AGENT_CAPABILITY_PROFILE_SCHEMA = "sub_agent_capability_profile@1";

const RESIDENT_FIRST_SLICE_TOOLS = Object.freeze([
  "spawn_agent",
  "list_agents",
  "inspect_agent",
  "wait_agent",
]);

const DEFERRED_SUB_AGENT_CONTROLS = Object.freeze([
  "send_message",
  "followup_task",
  "close_agent",
  "interrupt_agent",
  "resume_agent",
  "recursive_spawn",
]);

const TOOL_CONFIG = Object.freeze({
  spawn_agent: {
    capabilityKind: "spawn_agent",
    sideEffectClass: "agent_runtime",
    requestShapeFamilies: ["resident_sub_agent_spawn_agent@1", "resident_sub_agent_mvp@1"],
    resultEnvelopeKinds: ["sub_agent_spawn_status@1"],
    implementationState: "restricted_executor",
    promotionState: "direct_restricted",
    decision: "promotable_restricted",
    promotionClass: "sub_agent_first_slice_shadow",
    restrictions: [
      ["sub_agent_spawn_single_shot", "single-shot text-only worker only", "per_call"],
      ["sub_agent_spawn_no_provider_declaration", "PR92 is shadow/test only", "declaration"],
    ],
  },
  list_agents: {
    capabilityKind: "list_agents",
    sideEffectClass: "none",
    requestShapeFamilies: ["resident_sub_agent_list_agents@1", "resident_sub_agent_mvp@1"],
    resultEnvelopeKinds: ["sub_agent_list_summary@1"],
    implementationState: "projection_only",
    promotionState: "direct_restricted",
    decision: "promotable_restricted",
    promotionClass: "sub_agent_first_slice_shadow",
    restrictions: [
      ["sub_agent_list_current_thread_default", "current_thread scope by default", "per_call"],
      ["sub_agent_list_no_provider_declaration", "PR92 is shadow/test only", "declaration"],
    ],
  },
  inspect_agent: {
    capabilityKind: "inspect_agent",
    sideEffectClass: "none",
    requestShapeFamilies: ["resident_sub_agent_inspect_agent@1", "resident_sub_agent_mvp@1"],
    resultEnvelopeKinds: ["sub_agent_e_channel_status@1"],
    implementationState: "projection_only",
    promotionState: "direct_restricted",
    decision: "promotable_restricted",
    promotionClass: "sub_agent_first_slice_shadow",
    restrictions: [
      ["sub_agent_inspect_e_channel_only", "E-channel status only; no transcript flattening", "per_call"],
      ["sub_agent_inspect_no_provider_declaration", "PR92 is shadow/test only", "declaration"],
    ],
  },
  wait_agent: {
    capabilityKind: "wait_agent",
    sideEffectClass: "agent_runtime",
    requestShapeFamilies: ["resident_sub_agent_wait_agent@1", "resident_sub_agent_mvp@1"],
    resultEnvelopeKinds: ["sub_agent_wait_status@1"],
    implementationState: "restricted_executor",
    promotionState: "direct_restricted",
    decision: "promotable_restricted",
    promotionClass: "sub_agent_first_slice_shadow",
    restrictions: [
      ["sub_agent_wait_bounded_only", "bounded wait plan required", "per_call"],
      ["sub_agent_wait_no_provider_replay", "wait cannot replay provider work", "per_call"],
    ],
  },
  send_message: {
    capabilityKind: "send_message",
    sideEffectClass: "agent_runtime",
    requestShapeFamilies: ["resident_sub_agent_send_message@future"],
    resultEnvelopeKinds: ["blocked_capability@1"],
    implementationState: "schema_only",
    promotionState: "diagnostic_only",
    decision: "blocked",
    blocker: "future_wave_interference_control",
    futureWaveOwner: "Wave 16+ child conversation controls",
  },
  followup_task: {
    capabilityKind: "followup_task",
    sideEffectClass: "agent_runtime",
    requestShapeFamilies: ["resident_sub_agent_followup_task@future"],
    resultEnvelopeKinds: ["blocked_capability@1"],
    implementationState: "schema_only",
    promotionState: "diagnostic_only",
    decision: "blocked",
    blocker: "future_wave_interference_control",
    futureWaveOwner: "Wave 16+ child conversation controls",
  },
  close_agent: {
    capabilityKind: "close_agent",
    sideEffectClass: "control_state",
    requestShapeFamilies: ["resident_sub_agent_close_agent@future"],
    resultEnvelopeKinds: ["blocked_capability@1"],
    implementationState: "schema_only",
    promotionState: "diagnostic_only",
    decision: "blocked",
    blocker: "future_wave_lifecycle_control",
    futureWaveOwner: "Wave 16+ lifecycle controls",
  },
  interrupt_agent: {
    capabilityKind: "interrupt_agent",
    sideEffectClass: "control_state",
    requestShapeFamilies: ["resident_sub_agent_interrupt_agent@future"],
    resultEnvelopeKinds: ["blocked_capability@1"],
    implementationState: "schema_only",
    promotionState: "diagnostic_only",
    decision: "blocked",
    blocker: "future_wave_lifecycle_control",
    futureWaveOwner: "Wave 16+ lifecycle controls",
  },
  resume_agent: {
    capabilityKind: "resume_agent",
    sideEffectClass: "control_state",
    requestShapeFamilies: ["resident_sub_agent_resume_agent@future"],
    resultEnvelopeKinds: ["blocked_capability@1"],
    implementationState: "schema_only",
    promotionState: "diagnostic_only",
    decision: "blocked",
    blocker: "future_wave_lifecycle_control",
    futureWaveOwner: "Wave 16+ lifecycle controls",
  },
  recursive_spawn: {
    capabilityKind: "recursive_spawn",
    sideEffectClass: "agent_runtime",
    requestShapeFamilies: ["resident_sub_agent_recursive_spawn@future"],
    resultEnvelopeKinds: ["blocked_capability@1"],
    implementationState: "schema_only",
    promotionState: "diagnostic_only",
    decision: "blocked",
    blocker: "recursive_spawn_disabled",
    futureWaveOwner: "Future multi-agent institution wave",
  },
});

function stableToolId(toolName) {
  return `sub_agent_${toolName}`;
}

function lifecycleSourceRef(options = {}) {
  return normalizeOdeuSourceRef({
    sourceRefId: "source_sub_agent_capability_profile",
    sourceKind: "activation_registry",
    sourceId: "sub_agent_capability_profile",
    sourceConfidence: "fixture",
    freshness: "fresh",
    rowId: "wave15_pr92_sub_agent_capability_profile",
  }, options);
}

function evidenceRefFor(toolName, sourceRef, options = {}) {
  return buildOdeuEvidenceRef({
    evidenceId: `evidence_sub_agent_${toolName}`,
    evidenceKind: "sub_agent_capability_profile",
    artifactRef: `capability:${stableToolId(toolName)}`,
    sourceRefs: [sourceRef],
  }, options);
}

function restrictionsFor(toolName, config) {
  const rows = Array.isArray(config.restrictions) ? config.restrictions : [];
  if (config.decision === "blocked") {
    return [
      {
        restrictionId: `restriction_${stableToolId(toolName)}_blocked`,
        reason: `${config.blocker}; owner=${config.futureWaveOwner}`,
        appliesTo: "activation",
      },
      {
        restrictionId: `restriction_${stableToolId(toolName)}_declaration_blocked`,
        reason: "not provider-declared in Wave 15 PR92",
        appliesTo: "declaration",
      },
    ];
  }
  return rows.map(([restrictionId, reason, appliesTo]) => ({
    restrictionId,
    reason,
    appliesTo,
  }));
}

function buildCapability(toolName, config, context, options = {}) {
  const sourceRef = context.sourceRef;
  const evidenceRef = evidenceRefFor(toolName, sourceRef, options);
  const capabilityId = stableToolId(toolName);
  return buildOdeuCapabilityRow({
    capabilityId,
    family: "sub_agent_runtime",
    capabilityKind: config.capabilityKind,
    authorityFamily: "sub_agent_control",
    capabilityState: "profile_declared",
    implementationState: config.implementationState,
    promotionState: config.promotionState,
    providerDeclarationState: "not_declared",
    requestShapeFamilies: config.requestShapeFamilies,
    resultEnvelopeKinds: config.resultEnvelopeKinds,
    sideEffectClass: config.sideEffectClass,
    evidenceRefs: [evidenceRef],
    sourceRefs: [sourceRef],
    scope: context.scope,
    familyExtension: {
      toolName,
      firstSlice: RESIDENT_FIRST_SLICE_TOOLS.includes(toolName),
      futureWaveOwner: config.futureWaveOwner || "",
      providerTransportAllowedInPr92: false,
      providerDeclarationAllowedInPr92: false,
      residentCallableAllowedInPr92: false,
    },
  }, options);
}

function buildPromotion(toolName, config, capability, context, options = {}) {
  const sourceRef = context.sourceRef;
  return buildOdeuPromotionDecision({
    promotionDecisionId: `promotion_${capability.capabilityId}`,
    capabilityId: capability.capabilityId,
    decision: config.decision,
    promotionClass: config.promotionClass || "sub_agent_blocked_future_control",
    evidenceClass: "fixture_only",
    restrictions: restrictionsFor(toolName, config),
    freshness: "fresh",
    negativeEvidence: {
      noRawExposure: true,
      noRendererAuthorityGrant: true,
      noOutOfContractProviderTransport: true,
      noOutOfContractSideEffect: true,
      noContextSmuggling: true,
      noReplayUnsafeState: true,
    },
    blockers: config.decision === "blocked" ? [config.blocker] : [],
    evidenceRefs: capability.evidenceRefs,
    sourceRefs: [sourceRef],
    scope: context.scope,
    familyExtension: {
      toolName,
      futureWaveOwner: config.futureWaveOwner || "",
      residentCallableAllowedInPr92: false,
    },
  }, options);
}

function buildActivation(toolName, capability, promotion, context, options = {}) {
  const sourceRef = context.sourceRef;
  const isFirstSlice = RESIDENT_FIRST_SLICE_TOOLS.includes(toolName);
  return buildOdeuActivationRow({
    activationId: `activation_${capability.capabilityId}`,
    capabilityId: capability.capabilityId,
    promotionDecisionId: promotion.promotionDecisionId,
    state: "shadow_only",
    activationScope: {
      kind: "work_thread_override",
      projectId: context.projectId,
      workThreadId: context.workThreadId,
    },
    effect: "shadow",
    activationDecision: {
      activatedBy: "test_fixture",
      decisionId: `activation_decision_${capability.capabilityId}`,
      reason: isFirstSlice
        ? "Wave 15 PR92 shadow/headless-test activation; not resident-callable."
        : `Blocked future control: ${TOOL_CONFIG[toolName].futureWaveOwner}`,
    },
    sourceRefs: [sourceRef],
    scope: context.scope,
    familyExtension: {
      activationPosture: isFirstSlice ? "headless_test_only" : "shadow_only",
      fixtureOnly: true,
      residentCallableAllowedInPr92: false,
      providerDeclarationAllowedInPr92: false,
    },
  }, options);
}

function buildDeclaration(toolName, capability, activation, context, options = {}) {
  const sourceRef = context.sourceRef;
  const activationRegistryDigest = digestCanonicalJson({
    profileId: context.profileId,
    capabilityId: capability.capabilityId,
    activationId: activation.activationId,
    activationState: activation.state,
    activationPosture: activation.familyExtension?.activationPosture || "shadow_only",
  }, { domain: "sub-agent-capability-activation-registry@1", digestOf: "metadata" });
  const declarationDigest = digestCanonicalJson({
    profileId: context.profileId,
    toolName,
    residentVisible: true,
    providerDeclared: false,
    modelCallable: false,
    requestShapeFamily: "resident_sub_agent_mvp@1",
  }, { domain: "sub-agent-capability-declaration@1", digestOf: "metadata" });
  return buildOdeuDeclarationSnapshot({
    declarationSnapshotId: `declaration_${capability.capabilityId}`,
    activationId: activation.activationId,
    activationSnapshotId: `activation_snapshot_${context.profileId}`,
    activationRegistryDigest,
    declarationDigest,
    requestShapeFamily: "resident_sub_agent_mvp@1",
    surfaceKind: "resident_tool",
    residentVisible: true,
    operatorVisible: true,
    rendererVisible: true,
    providerDeclared: false,
    modelCallable: false,
    sourceRefs: [sourceRef],
    scope: context.scope,
    familyExtension: {
      toolName,
      declarationPosture: "resident_visible_shadow_only",
      residentCallableAllowedInPr92: false,
      providerDeclarationAllowedInPr92: false,
    },
  }, options);
}

function validateProfile(profile = {}) {
  if (profile.schema !== SUB_AGENT_CAPABILITY_PROFILE_SCHEMA) throw new Error("sub_agent_capability_profile_schema_mismatch");
  for (const row of profile.capabilityRows || []) validateOdeuCapabilityRow(row);
  for (const row of profile.promotionDecisions || []) validateOdeuPromotionDecision(row);
  for (const row of profile.activationRows || []) validateOdeuActivationRow(row);
  for (const row of profile.declarationSnapshots || []) validateOdeuDeclarationSnapshot(row);
  if (profile.providerTransportStarted !== false) throw new Error("sub_agent_capability_profile_provider_transport_started");
  if (profile.providerDeclarationEnabled !== false) throw new Error("sub_agent_capability_profile_provider_declaration_enabled");
  if (profile.residentCallableEnabled !== false) throw new Error("sub_agent_capability_profile_resident_callable_enabled");
  if (profile.rawPromptIncluded !== false || profile.rawTranscriptIncluded !== false || profile.rawProviderPayloadIncluded !== false) {
    throw new Error("sub_agent_capability_profile_raw_exposure");
  }
  const firstSlice = new Set(profile.firstSliceTools || []);
  for (const toolName of RESIDENT_FIRST_SLICE_TOOLS) {
    if (!firstSlice.has(toolName)) throw new Error(`sub_agent_capability_profile_first_slice_missing:${toolName}`);
  }
  const blocked = new Set((profile.blockedControls || []).map((row) => row.toolName));
  for (const toolName of DEFERRED_SUB_AGENT_CONTROLS) {
    if (!blocked.has(toolName)) throw new Error(`sub_agent_capability_profile_blocked_control_missing:${toolName}`);
  }
  return true;
}

function buildSubAgentCapabilityProfile(input = {}, options = {}) {
  const projectId = normalizeString(input.projectId, "project_sub_agent_capability_profile");
  const workThreadId = normalizeString(input.workThreadId, "work_thread_sub_agent_capability_profile");
  const profileId = normalizeString(input.profileId, "sub_agent_capability_profile_wave15_pr92");
  const generatedAt = normalizeString(input.generatedAt, nowIso(options.now || Date.now));
  const scope = {
    projectId,
    workThreadId,
    runtimeTier: "headless_direct",
    environment: "fixture",
  };
  const sourceRef = lifecycleSourceRef(options);
  const context = { projectId, workThreadId, profileId, generatedAt, scope, sourceRef };
  const toolNames = [...RESIDENT_FIRST_SLICE_TOOLS, ...DEFERRED_SUB_AGENT_CONTROLS];
  const capabilityRows = [];
  const promotionDecisions = [];
  const activationRows = [];
  const declarationSnapshots = [];

  for (const toolName of toolNames) {
    const config = TOOL_CONFIG[toolName];
    const capability = buildCapability(toolName, config, context, options);
    const promotion = buildPromotion(toolName, config, capability, context, options);
    const activation = buildActivation(toolName, capability, promotion, context, options);
    const declaration = buildDeclaration(toolName, capability, activation, context, options);
    capabilityRows.push(capability);
    promotionDecisions.push(promotion);
    activationRows.push(activation);
    declarationSnapshots.push(declaration);
  }

  const blockedControls = DEFERRED_SUB_AGENT_CONTROLS.map((toolName) => ({
    toolName,
    capabilityId: stableToolId(toolName),
    reason: TOOL_CONFIG[toolName].blocker,
    futureWaveOwner: TOOL_CONFIG[toolName].futureWaveOwner,
  }));
  const profile = {
    schema: SUB_AGENT_CAPABILITY_PROFILE_SCHEMA,
    profileId,
    projectId,
    workThreadId,
    generatedAt,
    firstSliceTools: [...RESIDENT_FIRST_SLICE_TOOLS],
    blockedControls,
    capabilityRows,
    promotionDecisions,
    activationRows,
    declarationSnapshots,
    providerTransportStarted: false,
    providerDeclarationEnabled: false,
    residentCallableEnabled: false,
    executorCallsStarted: false,
    workspaceMutationStarted: false,
    rawPromptIncluded: false,
    rawTranscriptIncluded: false,
    rawProviderPayloadIncluded: false,
  };
  profile.profileDigest = digestCanonicalJson({
    profileId,
    firstSliceTools: profile.firstSliceTools,
    blockedControls,
    capabilityDigests: capabilityRows.map((row) => row.artifactDigest.value),
    promotionDigests: promotionDecisions.map((row) => row.artifactDigest.value),
    activationDigests: activationRows.map((row) => row.artifactDigest.value),
    declarationDigests: declarationSnapshots.map((row) => row.artifactDigest.value),
  }, { domain: "sub-agent-capability-profile@1", digestOf: "metadata" });
  validateProfile(profile);
  return profile;
}

module.exports = {
  DEFERRED_SUB_AGENT_CONTROLS,
  RESIDENT_FIRST_SLICE_TOOLS,
  SUB_AGENT_CAPABILITY_PROFILE_SCHEMA,
  buildSubAgentCapabilityProfile,
  validateSubAgentCapabilityProfile: validateProfile,
};
