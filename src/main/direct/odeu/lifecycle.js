"use strict";

const { normalizeId, normalizeString, nowIso, isPlainObject } = require("../meta-session/ids");
const { buildOdeuArtifactBase } = require("./artifact");
const { artifactDigest, buildOdeuDigest } = require("./digest");
const { buildOdeuEvidenceRef, normalizeOdeuSourceRefs } = require("./source-ref");
const { validateOdeuArtifactBase, validateOdeuDigest } = require("./schema");
const { ODEU_FRESHNESS_VALUES, pickEnum } = require("./status");

const ODEU_CAPABILITY_ROW_SCHEMA = "odeu_capability_row@1";
const ODEU_PROMOTION_DECISION_SCHEMA = "odeu_promotion_decision@1";
const ODEU_ACTIVATION_ROW_SCHEMA = "odeu_activation_row@1";
const ODEU_DECLARATION_SNAPSHOT_SCHEMA = "odeu_declaration_snapshot@1";

const ODEU_CAPABILITY_STATES = Object.freeze([
  "unknown",
  "known",
  "profile_declared",
  "runtime_probed",
  "provider_accepted",
]);

const ODEU_IMPLEMENTATION_STATES = Object.freeze([
  "none",
  "schema_only",
  "projection_only",
  "fixture_executor",
  "restricted_executor",
  "full_executor",
]);

const ODEU_PROMOTION_STATES = Object.freeze([
  "unsupported",
  "diagnostic_only",
  "fixture_only",
  "direct_restricted",
  "direct_enabled",
]);

const ODEU_PROVIDER_DECLARATION_STATES = Object.freeze([
  "not_provider_tool",
  "not_declared",
  "declared_fixture_only",
  "declared_live_unproved",
  "declared_live_accepted",
  "rejected_by_provider",
]);

const ODEU_SIDE_EFFECT_CLASSES = Object.freeze([
  "none",
  "workspace_read",
  "workspace_write",
  "process_execution",
  "agent_runtime",
  "external_read",
  "external_action",
  "provider_hosted",
  "account_mutation",
  "context_world",
  "module_execution",
  "control_state",
  "human_decision",
  "browser_state",
  "artifact_write",
]);

const ODEU_PROMOTION_DECISIONS = Object.freeze([
  "promotable",
  "promotable_restricted",
  "blocked",
  "needs_more_evidence",
  "not_applicable",
]);

const ODEU_EVIDENCE_CLASSES = Object.freeze([
  "fixture_only",
  "diagnostic_only",
  "real_provider_declaration",
  "real_provider_full_loop",
  "real_runtime_full_loop",
]);

const ODEU_ACTIVATION_STATES = Object.freeze([
  "inactive",
  "active",
  "shadow_only",
  "suspended",
  "revoked",
  "expired",
]);

const ODEU_ACTIVATION_SCOPE_KINDS = Object.freeze([
  "global_default",
  "project_default",
  "work_thread_override",
  "single_turn_override",
]);

const ODEU_ACTIVATION_EFFECTS = Object.freeze([
  "allow",
  "deny",
  "shadow",
  "revoke",
]);

const ODEU_ACTIVATED_BY_VALUES = Object.freeze([
  "operator",
  "project_policy",
  "test_fixture",
  "migration",
]);

const ODEU_SURFACE_KINDS = Object.freeze([
  "resident_tool",
  "operator_ui_action",
  "headless_command",
  "provider_hosted_tool",
  "mcp_resource",
  "mcp_tool",
  "sub_agent_control",
]);

const ODEU_ACTIVATION_PRECEDENCE_LAW = Object.freeze({
  order: ["single_turn_override", "work_thread_override", "project_default", "global_default"],
  denyWins: true,
  emergencyRevokeWins: true,
});

function normalizeStringList(value) {
  return Array.isArray(value)
    ? [...new Set(value.map((entry) => normalizeString(entry, "")).filter(Boolean))].sort((a, b) => a.localeCompare(b))
    : [];
}

function normalizeEvidenceRefs(value, options = {}) {
  return Array.isArray(value) ? value.map((entry) => buildOdeuEvidenceRef(entry, options)) : [];
}

function normalizeActivationRestrictions(value) {
  const allowedAppliesTo = ["activation", "declaration", "per_call", "result_admission"];
  return Array.isArray(value) ? value.map((entry) => ({
    restrictionId: normalizeId(entry?.restrictionId, "odeu_activation_restriction"),
    reason: normalizeString(entry?.reason, "unspecified"),
    appliesTo: pickEnum(entry?.appliesTo, allowedAppliesTo, "activation"),
  })) : [];
}

function normalizeActivationScope(input = {}) {
  const scope = isPlainObject(input) ? input : {};
  const kind = pickEnum(scope.kind, ODEU_ACTIVATION_SCOPE_KINDS, "global_default");
  const normalized = { kind };
  if (kind === "project_default" || kind === "work_thread_override" || kind === "single_turn_override") {
    normalized.projectId = normalizeString(scope.projectId, "");
  }
  if (kind === "work_thread_override" || kind === "single_turn_override") {
    normalized.workThreadId = normalizeString(scope.workThreadId, "");
  }
  if (kind === "single_turn_override") {
    normalized.turnId = normalizeString(scope.turnId, "");
  }
  return normalized;
}

function attachDigest(artifact, artifactKind) {
  artifact.artifactDigest = artifactDigest({
    schema: artifact.schema,
    artifactKind,
    value: artifact,
  });
  return artifact;
}

function buildLifecycleArtifactBase(input = {}, options = {}, artifactKind) {
  return buildOdeuArtifactBase({
    ...input,
    artifactKind,
    rawExposureValue: input.rawExposureValue || {
      artifactKind,
      artifactId: input.artifactId,
      sourceRefs: input.sourceRefs,
      evidenceRefs: input.evidenceRefs,
    },
  }, options);
}

function buildOdeuCapabilityRow(input = {}, options = {}) {
  const capabilityId = normalizeId(input.capabilityId, "odeu_capability");
  const sourceRefs = normalizeOdeuSourceRefs(input.sourceRefs, options);
  const evidenceRefs = normalizeEvidenceRefs(input.evidenceRefs, options);
  const row = {
    ...buildLifecycleArtifactBase({
      ...input,
      schema: ODEU_CAPABILITY_ROW_SCHEMA,
      artifactId: input.artifactId || capabilityId,
      sourceRefs,
      evidenceRefs,
    }, options, "odeu_capability_row"),
    schema: ODEU_CAPABILITY_ROW_SCHEMA,
    capabilityId,
    family: normalizeString(input.family, "unknown"),
    capabilityKind: normalizeString(input.capabilityKind, "unknown"),
    authorityFamily: normalizeString(input.authorityFamily, "unknown"),
    capabilityState: pickEnum(input.capabilityState, ODEU_CAPABILITY_STATES, "unknown"),
    implementationState: pickEnum(input.implementationState, ODEU_IMPLEMENTATION_STATES, "none"),
    promotionState: pickEnum(input.promotionState, ODEU_PROMOTION_STATES, "unsupported"),
    providerDeclarationState: pickEnum(input.providerDeclarationState, ODEU_PROVIDER_DECLARATION_STATES, "not_declared"),
    requestShapeFamilies: normalizeStringList(input.requestShapeFamilies),
    resultEnvelopeKinds: normalizeStringList(input.resultEnvelopeKinds),
    sideEffectClass: pickEnum(input.sideEffectClass, ODEU_SIDE_EFFECT_CLASSES, "none"),
    evidenceRefs,
  };
  attachDigest(row, "odeu_capability_row");
  validateOdeuCapabilityRow(row);
  return row;
}

function buildOdeuPromotionDecision(input = {}, options = {}) {
  const promotionDecisionId = normalizeId(input.promotionDecisionId, "odeu_promotion_decision");
  const evidenceRefs = normalizeEvidenceRefs(input.evidenceRefs, options);
  const negativeEvidence = {
    noRawExposure: input.negativeEvidence?.noRawExposure === true,
    noRendererAuthorityGrant: input.negativeEvidence?.noRendererAuthorityGrant !== false,
    noOutOfContractProviderTransport: input.negativeEvidence?.noOutOfContractProviderTransport !== false,
    noOutOfContractSideEffect: input.negativeEvidence?.noOutOfContractSideEffect !== false,
    noContextSmuggling: input.negativeEvidence?.noContextSmuggling !== false,
    noReplayUnsafeState: input.negativeEvidence?.noReplayUnsafeState !== false,
  };
  const blockers = normalizeStringList(input.blockers);
  for (const [key, value] of Object.entries(negativeEvidence)) {
    if (value !== true) blockers.push(`negative_evidence_failed:${key}`);
  }
  const decision = {
    ...buildLifecycleArtifactBase({
      ...input,
      schema: ODEU_PROMOTION_DECISION_SCHEMA,
      artifactId: input.artifactId || promotionDecisionId,
      evidenceRefs,
      blockers,
    }, options, "odeu_promotion_decision"),
    schema: ODEU_PROMOTION_DECISION_SCHEMA,
    promotionDecisionId,
    capabilityId: normalizeId(input.capabilityId, "odeu_capability"),
    decision: blockers.length ? "blocked" : pickEnum(input.decision, ODEU_PROMOTION_DECISIONS, "needs_more_evidence"),
    promotionClass: normalizeString(input.promotionClass, "unknown"),
    evidenceClass: pickEnum(input.evidenceClass, ODEU_EVIDENCE_CLASSES, "diagnostic_only"),
    restrictions: normalizeActivationRestrictions(input.restrictions),
    freshness: pickEnum(input.freshness, ODEU_FRESHNESS_VALUES, "unknown"),
    negativeEvidence,
    evidenceRefs,
    blockers: normalizeStringList(blockers),
    decidedAt: normalizeString(input.decidedAt, nowIso(options.now || Date.now)),
  };
  attachDigest(decision, "odeu_promotion_decision");
  validateOdeuPromotionDecision(decision);
  return decision;
}

function buildOdeuActivationRow(input = {}, options = {}) {
  const activationId = normalizeId(input.activationId, "odeu_activation");
  const state = pickEnum(input.state, ODEU_ACTIVATION_STATES, "inactive");
  const activation = {
    ...buildLifecycleArtifactBase({
      ...input,
      schema: ODEU_ACTIVATION_ROW_SCHEMA,
      artifactId: input.artifactId || activationId,
      scope: input.artifactScope || {},
    }, options, "odeu_activation_row"),
    schema: ODEU_ACTIVATION_ROW_SCHEMA,
    activationId,
    capabilityId: normalizeId(input.capabilityId, "odeu_capability"),
    promotionDecisionId: normalizeId(input.promotionDecisionId, "odeu_promotion_decision"),
    state,
    scope: normalizeActivationScope(input.activationScope || input.scope),
    effect: pickEnum(input.effect, ODEU_ACTIVATION_EFFECTS, state === "active" ? "allow" : state === "shadow_only" ? "shadow" : state === "revoked" ? "revoke" : "deny"),
    precedenceLaw: {
      order: [...ODEU_ACTIVATION_PRECEDENCE_LAW.order],
      denyWins: true,
      emergencyRevokeWins: true,
    },
    activationDecision: {
      activatedBy: pickEnum(input.activationDecision?.activatedBy, ODEU_ACTIVATED_BY_VALUES, "test_fixture"),
      decisionId: normalizeId(input.activationDecision?.decisionId, "odeu_activation_decision"),
      reason: normalizeString(input.activationDecision?.reason, "unspecified"),
    },
    activatedAt: normalizeString(input.activatedAt, nowIso(options.now || Date.now)),
  };
  const expiresAt = normalizeString(input.expiresAt, "");
  if (expiresAt) activation.expiresAt = expiresAt;
  attachDigest(activation, "odeu_activation_row");
  validateOdeuActivationRow(activation);
  return activation;
}

function buildOdeuDeclarationSnapshot(input = {}, options = {}) {
  const declarationSnapshotId = normalizeId(input.declarationSnapshotId, "odeu_declaration_snapshot");
  const snapshot = {
    ...buildLifecycleArtifactBase({
      ...input,
      schema: ODEU_DECLARATION_SNAPSHOT_SCHEMA,
      artifactId: input.artifactId || declarationSnapshotId,
    }, options, "odeu_declaration_snapshot"),
    schema: ODEU_DECLARATION_SNAPSHOT_SCHEMA,
    declarationSnapshotId,
    activationId: normalizeId(input.activationId, "odeu_activation"),
    activationSnapshotId: normalizeId(input.activationSnapshotId, "odeu_activation_snapshot"),
    activationRegistryDigest: buildOdeuDigest(input.activationRegistryDigest),
    declarationDigest: buildOdeuDigest(input.declarationDigest),
    surfaceKind: pickEnum(input.surfaceKind, ODEU_SURFACE_KINDS, "resident_tool"),
    residentVisible: input.residentVisible === true,
    operatorVisible: input.operatorVisible === true,
    rendererVisible: input.rendererVisible === true,
    providerDeclared: input.providerDeclared === true,
    modelCallable: input.modelCallable === true,
    declaredAt: normalizeString(input.declaredAt, nowIso(options.now || Date.now)),
  };
  const optionalDigest = input.toolSchemaDigest && typeof input.toolSchemaDigest === "object" ? buildOdeuDigest(input.toolSchemaDigest) : null;
  if (optionalDigest) snapshot.toolSchemaDigest = optionalDigest;
  for (const field of ["requestShapeFamily", "providerProfileId", "modelId"]) {
    const value = normalizeString(input[field], "");
    if (value) snapshot[field] = value;
  }
  const requestShapeDigest = input.requestShapeDigest && typeof input.requestShapeDigest === "object" ? buildOdeuDigest(input.requestShapeDigest) : null;
  if (requestShapeDigest) snapshot.requestShapeDigest = requestShapeDigest;
  attachDigest(snapshot, "odeu_declaration_snapshot");
  validateOdeuDeclarationSnapshot(snapshot);
  return snapshot;
}

function validateRequiredString(value, label, errors) {
  if (typeof value === "string" && value.trim()) return;
  errors.push(`missing_required_string:${label}`);
}

function validateEnum(value, allowed, label, errors) {
  if (allowed.includes(value)) return;
  errors.push(`invalid_enum:${label}:${value || ""}`);
}

function validateArray(value, label, errors) {
  if (Array.isArray(value)) return;
  errors.push(`missing_required_array:${label}`);
}

function validateBase(value, errors) {
  try {
    validateOdeuArtifactBase(value);
  } catch (error) {
    errors.push(error.message || String(error));
  }
}

function throwIfErrors(errors) {
  if (!errors.length) return true;
  throw new Error(`odeu_lifecycle_validation_failed:${errors.join(",")}`);
}

function validateOdeuCapabilityRow(value = {}) {
  const errors = [];
  validateBase(value, errors);
  validateRequiredString(value.capabilityId, "capabilityId", errors);
  validateRequiredString(value.family, "family", errors);
  validateRequiredString(value.capabilityKind, "capabilityKind", errors);
  validateRequiredString(value.authorityFamily, "authorityFamily", errors);
  validateEnum(value.capabilityState, ODEU_CAPABILITY_STATES, "capabilityState", errors);
  validateEnum(value.implementationState, ODEU_IMPLEMENTATION_STATES, "implementationState", errors);
  validateEnum(value.promotionState, ODEU_PROMOTION_STATES, "promotionState", errors);
  validateEnum(value.providerDeclarationState, ODEU_PROVIDER_DECLARATION_STATES, "providerDeclarationState", errors);
  validateArray(value.requestShapeFamilies, "requestShapeFamilies", errors);
  validateArray(value.resultEnvelopeKinds, "resultEnvelopeKinds", errors);
  validateArray(value.evidenceRefs, "evidenceRefs", errors);
  validateEnum(value.sideEffectClass, ODEU_SIDE_EFFECT_CLASSES, "sideEffectClass", errors);
  return throwIfErrors(errors);
}

function validateOdeuPromotionDecision(value = {}) {
  const errors = [];
  validateBase(value, errors);
  validateRequiredString(value.promotionDecisionId, "promotionDecisionId", errors);
  validateRequiredString(value.capabilityId, "capabilityId", errors);
  validateEnum(value.decision, ODEU_PROMOTION_DECISIONS, "decision", errors);
  validateRequiredString(value.promotionClass, "promotionClass", errors);
  validateEnum(value.evidenceClass, ODEU_EVIDENCE_CLASSES, "evidenceClass", errors);
  validateArray(value.restrictions, "restrictions", errors);
  validateEnum(value.freshness, ODEU_FRESHNESS_VALUES, "freshness", errors);
  if (!isPlainObject(value.negativeEvidence)) errors.push("missing_required_object:negativeEvidence");
  validateArray(value.evidenceRefs, "evidenceRefs", errors);
  validateArray(value.blockers, "blockers", errors);
  validateRequiredString(value.decidedAt, "decidedAt", errors);
  return throwIfErrors(errors);
}

function validateOdeuActivationRow(value = {}) {
  const errors = [];
  validateBase(value, errors);
  validateRequiredString(value.activationId, "activationId", errors);
  validateRequiredString(value.capabilityId, "capabilityId", errors);
  validateRequiredString(value.promotionDecisionId, "promotionDecisionId", errors);
  validateEnum(value.state, ODEU_ACTIVATION_STATES, "state", errors);
  if (!isPlainObject(value.scope)) errors.push("missing_required_object:scope");
  validateEnum(value.effect, ODEU_ACTIVATION_EFFECTS, "effect", errors);
  if (!isPlainObject(value.precedenceLaw)) errors.push("missing_required_object:precedenceLaw");
  if (!isPlainObject(value.activationDecision)) errors.push("missing_required_object:activationDecision");
  validateRequiredString(value.activatedAt, "activatedAt", errors);
  return throwIfErrors(errors);
}

function validateOdeuDeclarationSnapshot(value = {}) {
  const errors = [];
  validateBase(value, errors);
  validateRequiredString(value.declarationSnapshotId, "declarationSnapshotId", errors);
  validateRequiredString(value.activationId, "activationId", errors);
  validateRequiredString(value.activationSnapshotId, "activationSnapshotId", errors);
  try {
    validateOdeuDigest(value.activationRegistryDigest, "activationRegistryDigest");
    validateOdeuDigest(value.declarationDigest, "declarationDigest");
  } catch (error) {
    errors.push(error.message || String(error));
  }
  validateEnum(value.surfaceKind, ODEU_SURFACE_KINDS, "surfaceKind", errors);
  for (const field of ["residentVisible", "operatorVisible", "rendererVisible", "providerDeclared", "modelCallable"]) {
    if (typeof value[field] !== "boolean") errors.push(`missing_required_boolean:${field}`);
  }
  if (value.modelCallable === true && value.providerDeclared !== true) {
    errors.push("model_callable_requires_provider_declaration");
  }
  validateRequiredString(value.declaredAt, "declaredAt", errors);
  return throwIfErrors(errors);
}

module.exports = {
  ODEU_ACTIVATED_BY_VALUES,
  ODEU_ACTIVATION_EFFECTS,
  ODEU_ACTIVATION_PRECEDENCE_LAW,
  ODEU_ACTIVATION_ROW_SCHEMA,
  ODEU_ACTIVATION_SCOPE_KINDS,
  ODEU_ACTIVATION_STATES,
  ODEU_CAPABILITY_ROW_SCHEMA,
  ODEU_CAPABILITY_STATES,
  ODEU_DECLARATION_SNAPSHOT_SCHEMA,
  ODEU_EVIDENCE_CLASSES,
  ODEU_IMPLEMENTATION_STATES,
  ODEU_PROMOTION_DECISION_SCHEMA,
  ODEU_PROMOTION_DECISIONS,
  ODEU_PROMOTION_STATES,
  ODEU_PROVIDER_DECLARATION_STATES,
  ODEU_SIDE_EFFECT_CLASSES,
  ODEU_SURFACE_KINDS,
  buildOdeuActivationRow,
  buildOdeuCapabilityRow,
  buildOdeuDeclarationSnapshot,
  buildOdeuPromotionDecision,
  normalizeActivationScope,
  validateOdeuActivationRow,
  validateOdeuCapabilityRow,
  validateOdeuDeclarationSnapshot,
  validateOdeuPromotionDecision,
};
