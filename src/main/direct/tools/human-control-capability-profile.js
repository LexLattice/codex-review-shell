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

const HUMAN_CONTROL_CAPABILITY_PROFILE_SCHEMA = "human_control_capability_profile@1";

const RESIDENT_PROFILE_TOOLS = Object.freeze([
  "get_context_remaining",
  "update_plan",
  "request_user_input",
]);

const GUARDED_PROFILE_TOOLS = Object.freeze([
  "request_permissions",
  "view_image",
]);

const KNOWN_DISABLED_PROFILE_TOOLS = Object.freeze([
  "new_context",
]);

const TOOL_CONFIG = Object.freeze({
  get_context_remaining: {
    capabilityKind: "get_context_remaining",
    authorityFamily: "control_state",
    sideEffectClass: "none",
    requestShapeFamilies: ["direct_context_remaining_witness@1"],
    resultEnvelopeKinds: ["direct_context_remaining_witness@1"],
    implementationState: "projection_only",
    promotionState: "direct_restricted",
    decision: "promotable_restricted",
    profileStatus: "profile_promoted_shadow",
    declarationPosture: "resident_visible_shadow_only",
    unavailableReason: "callable_executor_deferred_to_pr104",
    restrictions: [
      ["context_remaining_no_request_blocking", "Witness cannot block or authorize requests in Wave 17 PR103", "per_call"],
      ["context_remaining_no_compaction_authority", "Witness grants no compaction/new_context authority", "result_admission"],
    ],
  },
  update_plan: {
    capabilityKind: "update_plan",
    authorityFamily: "control_state",
    sideEffectClass: "control_state",
    requestShapeFamilies: ["plan_projection_mutation_envelope@1"],
    resultEnvelopeKinds: ["plan_projection_mutation_envelope@1"],
    implementationState: "projection_only",
    promotionState: "direct_restricted",
    decision: "promotable_restricted",
    profileStatus: "profile_promoted_shadow",
    declarationPosture: "resident_visible_shadow_only",
    unavailableReason: "plan_projection_store_deferred_to_pr104",
    restrictions: [
      ["update_plan_projection_only", "Plan update cannot mutate WorkThread, operator plan, or project truth", "per_call"],
      ["update_plan_no_completion_proof", "Plan completion is not objective or obligation completion proof", "result_admission"],
    ],
  },
  request_user_input: {
    capabilityKind: "request_user_input",
    authorityFamily: "human_decision",
    sideEffectClass: "human_decision",
    requestShapeFamilies: ["direct_human_decision_tool_packet@1"],
    resultEnvelopeKinds: ["human_decision_result_envelope@1"],
    implementationState: "projection_only",
    promotionState: "direct_restricted",
    decision: "promotable_restricted",
    profileStatus: "profile_promoted_shadow",
    declarationPosture: "resident_visible_shadow_only",
    unavailableReason: "bounded_human_decision_bridge_deferred_to_pr105",
    restrictions: [
      ["request_user_input_single_pending_default", "Only one resident-created pending packet by default", "activation"],
      ["request_user_input_non_authoritative", "Choices and free text grant no authority in Wave 17", "result_admission"],
    ],
  },
  request_permissions: {
    capabilityKind: "request_permissions",
    authorityFamily: "human_decision",
    sideEffectClass: "human_decision",
    requestShapeFamilies: ["permission_widening_request@1"],
    resultEnvelopeKinds: ["permission_widening_decision@1"],
    implementationState: "schema_only",
    promotionState: "diagnostic_only",
    decision: "blocked",
    profileStatus: "guarded_request_only",
    declarationPosture: "resident_visible_guarded_blocked",
    unavailableReason: "permission_widening_decision_gate_deferred_to_pr106",
    blocker: "permission_widening_decision_gate_missing",
    futurePrOwner: "PR106",
  },
  view_image: {
    capabilityKind: "view_image",
    authorityFamily: "local_perception",
    sideEffectClass: "workspace_read",
    requestShapeFamilies: ["image_view_staging_envelope@1"],
    resultEnvelopeKinds: ["direct_view_image_projection@1", "direct_first_tool_result_envelope@1"],
    implementationState: "projection_only",
    promotionState: "diagnostic_only",
    decision: "blocked",
    profileStatus: "guarded_metadata_only",
    declarationPosture: "resident_visible_guarded_blocked",
    unavailableReason: "provider_image_payload_unsupported_wave17",
    blocker: "image_payload_submission_disabled",
    futurePrOwner: "Future provider image payload wave",
  },
  new_context: {
    capabilityKind: "new_context",
    authorityFamily: "context_world",
    sideEffectClass: "context_world",
    requestShapeFamilies: ["direct_new_context_blocked_projection@1"],
    resultEnvelopeKinds: ["direct_new_context_blocked_projection@1"],
    implementationState: "projection_only",
    promotionState: "unsupported",
    decision: "blocked",
    profileStatus: "known_disabled",
    declarationPosture: "resident_visible_known_disabled",
    unavailableReason: "blocked_until_wave20_context_transition_law",
    blocker: "context_transition_law_missing",
    futurePrOwner: "Wave20",
  },
});

function stableCapabilityId(toolName) {
  return `human_control_${toolName}`;
}

function sourceRefFor(options = {}) {
  return normalizeOdeuSourceRef({
    sourceRefId: "source_human_control_capability_profile",
    sourceKind: "activation_registry",
    sourceId: "human_control_capability_profile",
    sourceConfidence: "fixture",
    freshness: "fresh",
    rowId: "wave17_pr103_human_control_capability_profile",
  }, options);
}

function evidenceRefFor(toolName, sourceRef, options = {}) {
  return buildOdeuEvidenceRef({
    evidenceId: `evidence_human_control_${toolName}`,
    evidenceKind: "human_control_capability_profile",
    artifactRef: `capability:${stableCapabilityId(toolName)}`,
    sourceRefs: [sourceRef],
  }, options);
}

function restrictionsFor(toolName, config) {
  if (config.decision === "blocked") {
    return [
      {
        restrictionId: `restriction_${stableCapabilityId(toolName)}_blocked`,
        reason: `${config.blocker}; owner=${config.futurePrOwner}`,
        appliesTo: "activation",
      },
      {
        restrictionId: `restriction_${stableCapabilityId(toolName)}_not_declared`,
        reason: "not provider-declared or model-callable in Wave 17 PR103",
        appliesTo: "declaration",
      },
    ];
  }
  return (Array.isArray(config.restrictions) ? config.restrictions : []).map(([restrictionId, reason, appliesTo]) => ({
    restrictionId,
    reason,
    appliesTo,
  }));
}

function buildCapability(toolName, config, context, options = {}) {
  const sourceRef = context.sourceRef;
  const evidenceRef = evidenceRefFor(toolName, sourceRef, options);
  const capabilityId = stableCapabilityId(toolName);
  return buildOdeuCapabilityRow({
    capabilityId,
    family: "human_control_local_perception",
    capabilityKind: config.capabilityKind,
    authorityFamily: config.authorityFamily,
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
      profileStatus: config.profileStatus,
      unavailableReason: config.unavailableReason,
      providerDeclarationAllowedInPr103: false,
      residentCallableAllowedInPr103: false,
      localExecutorAllowedInPr103: false,
      requestShapeMutationAllowedInPr103: false,
    },
  }, options);
}

function buildPromotion(toolName, config, capability, context, options = {}) {
  const sourceRef = context.sourceRef;
  return buildOdeuPromotionDecision({
    promotionDecisionId: `promotion_${capability.capabilityId}`,
    capabilityId: capability.capabilityId,
    decision: config.decision,
    promotionClass: config.decision === "blocked"
      ? "human_control_blocked_guarded_profile"
      : "human_control_profile_promotable_shadow",
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
      profileStatus: config.profileStatus,
      unavailableReason: config.unavailableReason,
      futurePrOwner: config.futurePrOwner || "",
      residentCallableAllowedInPr103: false,
      providerDeclarationAllowedInPr103: false,
    },
  }, options);
}

function buildActivation(toolName, config, capability, promotion, context, options = {}) {
  const sourceRef = context.sourceRef;
  const blocked = config.decision === "blocked";
  return buildOdeuActivationRow({
    activationId: `activation_${capability.capabilityId}`,
    capabilityId: capability.capabilityId,
    promotionDecisionId: promotion.promotionDecisionId,
    state: blocked ? "suspended" : "shadow_only",
    activationScope: {
      kind: "work_thread_override",
      projectId: context.projectId,
      workThreadId: context.workThreadId,
    },
    effect: blocked ? "deny" : "shadow",
    activationDecision: {
      activatedBy: "test_fixture",
      decisionId: `activation_decision_${capability.capabilityId}`,
      reason: `${config.profileStatus}; not resident-callable or provider-declared in PR103.`,
    },
    sourceRefs: [sourceRef],
    scope: context.scope,
    familyExtension: {
      toolName,
      activationPosture: config.profileStatus,
      unavailableReason: config.unavailableReason,
      blockedActivation: blocked,
      residentCallableAllowedInPr103: false,
      providerDeclarationAllowedInPr103: false,
      localExecutorAllowedInPr103: false,
    },
  }, options);
}

function buildDeclaration(toolName, config, capability, activation, context, options = {}) {
  const sourceRef = context.sourceRef;
  const activationRegistryDigest = digestCanonicalJson({
    profileId: context.profileId,
    capabilityId: capability.capabilityId,
    activationId: activation.activationId,
    activationState: activation.state,
    profileStatus: config.profileStatus,
  }, { domain: "human-control-capability-activation-registry@1", digestOf: "metadata" });
  const declarationDigest = digestCanonicalJson({
    profileId: context.profileId,
    toolName,
    residentVisible: true,
    providerDeclared: false,
    modelCallable: false,
    profileStatus: config.profileStatus,
  }, { domain: "human-control-capability-declaration@1", digestOf: "metadata" });
  return buildOdeuDeclarationSnapshot({
    declarationSnapshotId: `declaration_${capability.capabilityId}`,
    activationId: activation.activationId,
    activationSnapshotId: `activation_snapshot_${context.profileId}`,
    activationRegistryDigest,
    declarationDigest,
    requestShapeFamily: config.requestShapeFamilies[0],
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
      declarationPosture: config.declarationPosture,
      profileStatus: config.profileStatus,
      unavailableReason: config.unavailableReason,
      residentCallableAllowedInPr103: false,
      providerDeclarationAllowedInPr103: false,
    },
  }, options);
}

function buildEligibility(toolName, config, capability, activation, declaration) {
  const residentVisibleState = config.profileStatus === "known_disabled"
    ? "known_disabled"
    : config.decision === "blocked"
      ? "visible_guarded"
      : "visible_shadow";
  return {
    schema: "human_control_declaration_eligibility@1",
    toolName,
    capabilityId: capability.capabilityId,
    activationId: activation.activationId,
    declarationSnapshotId: declaration.declarationSnapshotId,
    residentVisibleState,
    profileStatus: config.profileStatus,
    unavailableReason: config.unavailableReason,
    providerDeclared: false,
    modelCallable: false,
    residentCallable: false,
    providerDeclarationAllowedInPr103: false,
    localExecutorAllowedInPr103: false,
    permissionGrantAllowedInPr103: false,
  };
}

function expectedTools() {
  return [
    ...RESIDENT_PROFILE_TOOLS,
    ...GUARDED_PROFILE_TOOLS,
    ...KNOWN_DISABLED_PROFILE_TOOLS,
  ];
}

function artifactDigestValue(row, label) {
  const value = row?.artifactDigest?.value;
  if (typeof value === "string" && value) return value;
  throw new Error(`human_control_capability_profile_missing_artifact_digest:${label}`);
}

function validateHumanControlCapabilityProfile(profile = {}) {
  if (!profile || profile.schema !== HUMAN_CONTROL_CAPABILITY_PROFILE_SCHEMA) {
    throw new Error("human_control_capability_profile_schema_mismatch");
  }
  const tools = expectedTools();
  for (const field of ["capabilityRows", "promotionDecisions", "activationRows", "declarationSnapshots", "declarationEligibilityRows"]) {
    if (!Array.isArray(profile[field])) throw new Error(`human_control_capability_profile_missing_array:${field}`);
    if (profile[field].length < tools.length) throw new Error(`human_control_capability_profile_incomplete_array:${field}`);
  }
  for (const row of profile.capabilityRows) validateOdeuCapabilityRow(row);
  for (const row of profile.promotionDecisions) validateOdeuPromotionDecision(row);
  for (const row of profile.activationRows) validateOdeuActivationRow(row);
  for (const row of profile.declarationSnapshots) validateOdeuDeclarationSnapshot(row);

  const capabilityByKind = new Map(profile.capabilityRows.map((row) => [row.capabilityKind, row]));
  const promotionByCapability = new Map(profile.promotionDecisions.map((row) => [row.capabilityId, row]));
  const activationByCapability = new Map(profile.activationRows.map((row) => [row.capabilityId, row]));
  const declarationByActivation = new Map(profile.declarationSnapshots.map((row) => [row.activationId, row]));
  const eligibilityByTool = new Map(profile.declarationEligibilityRows.map((row) => [row.toolName, row]));

  for (const toolName of tools) {
    const capability = capabilityByKind.get(toolName);
    if (!capability) throw new Error(`human_control_capability_profile_capability_row_missing:${toolName}`);
    const promotion = promotionByCapability.get(capability.capabilityId);
    if (!promotion) throw new Error(`human_control_capability_profile_promotion_row_missing:${toolName}`);
    const activation = activationByCapability.get(capability.capabilityId);
    if (!activation) throw new Error(`human_control_capability_profile_activation_row_missing:${toolName}`);
    const declaration = declarationByActivation.get(activation.activationId);
    if (!declaration) throw new Error(`human_control_capability_profile_declaration_row_missing:${toolName}`);
    const eligibility = eligibilityByTool.get(toolName);
    if (!eligibility) throw new Error(`human_control_capability_profile_eligibility_row_missing:${toolName}`);
    if (declaration.providerDeclared !== false || declaration.modelCallable !== false) {
      throw new Error(`human_control_capability_profile_declaration_leak:${toolName}`);
    }
    if (
      eligibility.providerDeclared !== false ||
      eligibility.modelCallable !== false ||
      eligibility.residentCallable !== false ||
      eligibility.providerDeclarationAllowedInPr103 !== false ||
      eligibility.localExecutorAllowedInPr103 !== false ||
      eligibility.permissionGrantAllowedInPr103 !== false
    ) {
      throw new Error(`human_control_capability_profile_eligibility_authority_leak:${toolName}`);
    }
  }

  for (const field of [
    "providerTransportStarted",
    "providerDeclarationEnabled",
    "residentCallableEnabled",
    "executorCallsStarted",
    "permissionGrantEnabled",
    "workspaceMutationStarted",
    "contextWorldMutationStarted",
    "requestShapeMutationStarted",
    "rawPromptIncluded",
    "rawTranscriptIncluded",
    "rawProviderPayloadIncluded",
    "rawImageBytesIncluded",
    "rawPathIncluded",
  ]) {
    if (profile[field] !== false) throw new Error(`human_control_capability_profile_authority_or_raw_leak:${field}`);
  }
  const knownDisabled = new Set(profile.knownDisabledTools || []);
  for (const toolName of KNOWN_DISABLED_PROFILE_TOOLS) {
    if (!knownDisabled.has(toolName)) throw new Error(`human_control_capability_profile_known_disabled_missing:${toolName}`);
  }
  const guarded = new Set((profile.guardedTools || []).map((row) => row.toolName));
  for (const toolName of GUARDED_PROFILE_TOOLS) {
    if (!guarded.has(toolName)) throw new Error(`human_control_capability_profile_guarded_tool_missing:${toolName}`);
  }
  return true;
}

function buildHumanControlCapabilityProfile(input = {}, options = {}) {
  input = input || {};
  options = options || {};
  const projectId = normalizeString(input.projectId, "project_human_control_capability_profile");
  const workThreadId = normalizeString(input.workThreadId, "work_thread_human_control_capability_profile");
  const profileId = normalizeString(input.profileId, "human_control_capability_profile_wave17_pr103");
  const generatedAt = normalizeString(input.generatedAt, nowIso(options.now || Date.now));
  const scope = {
    projectId,
    workThreadId,
    runtimeTier: "headless_direct",
    environment: "fixture",
  };
  const sourceRef = sourceRefFor(options);
  const context = { projectId, workThreadId, profileId, generatedAt, scope, sourceRef };
  const toolNames = expectedTools();
  const capabilityRows = [];
  const promotionDecisions = [];
  const activationRows = [];
  const declarationSnapshots = [];
  const declarationEligibilityRows = [];

  for (const toolName of toolNames) {
    const config = TOOL_CONFIG[toolName];
    const capability = buildCapability(toolName, config, context, options);
    const promotion = buildPromotion(toolName, config, capability, context, options);
    const activation = buildActivation(toolName, config, capability, promotion, context, options);
    const declaration = buildDeclaration(toolName, config, capability, activation, context, options);
    const eligibility = buildEligibility(toolName, config, capability, activation, declaration);
    capabilityRows.push(capability);
    promotionDecisions.push(promotion);
    activationRows.push(activation);
    declarationSnapshots.push(declaration);
    declarationEligibilityRows.push(eligibility);
  }

  const guardedTools = GUARDED_PROFILE_TOOLS.map((toolName) => ({
    toolName,
    capabilityId: stableCapabilityId(toolName),
    profileStatus: TOOL_CONFIG[toolName].profileStatus,
    unavailableReason: TOOL_CONFIG[toolName].unavailableReason,
    futurePrOwner: TOOL_CONFIG[toolName].futurePrOwner,
  }));
  const profile = {
    schema: HUMAN_CONTROL_CAPABILITY_PROFILE_SCHEMA,
    profileId,
    projectId,
    workThreadId,
    generatedAt,
    residentProfileTools: [...RESIDENT_PROFILE_TOOLS],
    guardedTools,
    knownDisabledTools: [...KNOWN_DISABLED_PROFILE_TOOLS],
    capabilityRows,
    promotionDecisions,
    activationRows,
    declarationSnapshots,
    declarationEligibilityRows,
    providerTransportStarted: false,
    providerDeclarationEnabled: false,
    residentCallableEnabled: false,
    executorCallsStarted: false,
    permissionGrantEnabled: false,
    workspaceMutationStarted: false,
    contextWorldMutationStarted: false,
    requestShapeMutationStarted: false,
    rawPromptIncluded: false,
    rawTranscriptIncluded: false,
    rawProviderPayloadIncluded: false,
    rawImageBytesIncluded: false,
    rawPathIncluded: false,
  };
  profile.profileDigest = digestCanonicalJson({
    profileId,
    residentProfileTools: profile.residentProfileTools,
    guardedTools,
    knownDisabledTools: profile.knownDisabledTools,
    capabilityDigests: capabilityRows.map((row) => artifactDigestValue(row, "capability")),
    promotionDigests: promotionDecisions.map((row) => artifactDigestValue(row, "promotion")),
    activationDigests: activationRows.map((row) => artifactDigestValue(row, "activation")),
    declarationDigests: declarationSnapshots.map((row) => artifactDigestValue(row, "declaration")),
    eligibilityRows: declarationEligibilityRows,
  }, { domain: "human-control-capability-profile@1", digestOf: "metadata" });
  validateHumanControlCapabilityProfile(profile);
  return profile;
}

module.exports = {
  GUARDED_PROFILE_TOOLS,
  HUMAN_CONTROL_CAPABILITY_PROFILE_SCHEMA,
  KNOWN_DISABLED_PROFILE_TOOLS,
  RESIDENT_PROFILE_TOOLS,
  buildHumanControlCapabilityProfile,
  validateHumanControlCapabilityProfile,
};
