"use strict";

const { normalizeId, normalizeString, nowIso, isPlainObject } = require("../meta-session/ids");
const { buildOdeuArtifactBase } = require("./artifact");
const { artifactDigest, buildOdeuDigest } = require("./digest");
const { normalizeOdeuSourceRefs } = require("./source-ref");
const { validateOdeuArtifactBase, validateOdeuDigest } = require("./schema");
const { ODEU_ACTIVATION_STATES, ODEU_SIDE_EFFECT_CLASSES } = require("./lifecycle");
const { pickEnum } = require("./status");

const ODEU_PER_CALL_AUTHORITY_DECISION_SCHEMA = "odeu_per_call_authority_decision@1";
const ODEU_LIVE_CAPABILITY_TRANSACTION_SCHEMA = "odeu_live_capability_transaction@1";

const ODEU_AUTHORITY_CALLERS = Object.freeze([
  "resident_model",
  "operator_ui",
  "headless_route",
  "sub_agent",
  "system_recovery",
  "fixture",
]);

const ODEU_CALL_SURFACES = Object.freeze([
  "provider_tool_call",
  "operator_action",
  "headless_command",
  "internal_transition",
]);

const ODEU_ARGUMENT_VALIDATION_STATES = Object.freeze([
  "valid",
  "invalid",
  "stale",
  "unknown",
]);

const ODEU_POLICY_DECISIONS = Object.freeze([
  "allow",
  "block",
  "needs_human",
  "shadow_only",
  "stale",
  "unsupported",
]);

const ODEU_APPROVAL_REQUIREMENTS = Object.freeze([
  "none",
  "operator_confirm",
  "single_action",
  "turn_scope",
]);

const ODEU_EXECUTOR_STATES = Object.freeze([
  "not_started",
  "ready",
  "unavailable",
  "degraded",
]);

const ODEU_RECOVERY_STATES = Object.freeze([
  "not_needed",
  "retryable",
  "not_retryable",
  "handoff_unknown",
]);

const ODEU_REPLAY_POLICIES = Object.freeze([
  "never",
  "idempotent_same_key",
  "manual_only",
]);

const ODEU_FINAL_AUTHORITY_DECISIONS = Object.freeze([
  "allow_execute",
  "allow_read_only",
  "block",
  "needs_human",
  "shadow_only",
  "unsupported",
]);

const ODEU_TRANSACTION_LIFECYCLES = Object.freeze([
  "planned",
  "authority_blocked",
  "waiting_for_human",
  "approved",
  "executor_started",
  "executing",
  "local_effect_observed",
  "result_recorded",
  "result_enveloped",
  "context_admission_recorded",
  "provider_result_sent",
  "provider_terminal_completed",
  "completed",
  "failed",
  "cancelled",
  "timeout",
  "handoff_unknown",
  "recovery_required",
]);

const READ_ONLY_SIDE_EFFECT_CLASSES = new Set([
  "none",
  "workspace_read",
  "external_read",
  "human_decision",
  "control_state",
]);

const EXECUTOR_STARTED_LIFECYCLES = new Set([
  "executor_started",
  "executing",
  "local_effect_observed",
  "result_recorded",
  "result_enveloped",
  "context_admission_recorded",
  "provider_result_sent",
  "provider_terminal_completed",
  "completed",
]);

function normalizeStringList(value) {
  return Array.isArray(value)
    ? [...new Set(value.map((entry) => normalizeString(entry, "")).filter(Boolean))].sort((a, b) => a.localeCompare(b))
    : [];
}

function normalizeArgumentValidation(input = {}) {
  const value = isPlainObject(input) ? input : {};
  const state = pickEnum(value.state, ODEU_ARGUMENT_VALIDATION_STATES, "unknown");
  const blockers = normalizeStringList(value.blockers);
  const normalized = {
    state: blockers.length ? "invalid" : state,
    blockers,
  };
  if (value.schemaDigest && typeof value.schemaDigest === "object") {
    normalized.schemaDigest = buildOdeuDigest(value.schemaDigest);
  }
  if (value.argumentsDigest && typeof value.argumentsDigest === "object") {
    normalized.argumentsDigest = buildOdeuDigest(value.argumentsDigest);
  }
  return normalized;
}

function normalizeAuthorityScope(input = {}) {
  const scope = {};
  for (const field of [
    "projectId",
    "workThreadId",
    "threadId",
    "turnId",
    "routeId",
    "providerProfileId",
    "modelId",
  ]) {
    const value = normalizeString(input[field], "");
    if (value) scope[field] = value;
  }
  const activationScopeKind = normalizeString(input.activationScopeKind || input.kind, "");
  if (activationScopeKind) scope.activationScopeKind = activationScopeKind;
  return scope;
}

function decideFinalAuthority(input = {}) {
  const argumentValidation = input.argumentValidation || {};
  if (argumentValidation.state === "invalid" || argumentValidation.state === "stale") return "block";
  if (input.activationDecision !== "active") {
    if (input.activationDecision === "shadow_only") return "shadow_only";
    if (input.activationDecision === "not_found" || input.activationDecision === "inactive") return "block";
    if (input.activationDecision === "revoked" || input.activationDecision === "expired") return "block";
    return "block";
  }
  if (input.policyDecision === "unsupported" || input.executorState === "unavailable") return "unsupported";
  if (input.policyDecision === "needs_human") return "needs_human";
  if (input.policyDecision === "shadow_only") return "shadow_only";
  if (input.policyDecision === "block" || input.policyDecision === "stale") return "block";
  if (input.executorState !== "ready" && input.executorState !== "degraded") return "block";
  return READ_ONLY_SIDE_EFFECT_CLASSES.has(input.sideEffectClass) ? "allow_read_only" : "allow_execute";
}

function buildAuthorityArtifactBase(input = {}, options = {}, artifactKind) {
  return buildOdeuArtifactBase({
    ...input,
    artifactKind,
    rawExposureValue: input.rawExposureValue || {
      artifactKind,
      artifactId: input.artifactId,
      sourceRefs: input.sourceRefs,
      callId: input.callId,
      capabilityId: input.capabilityId,
    },
  }, options);
}

function buildOdeuPerCallAuthorityDecision(input = {}, options = {}) {
  const authorityDecisionId = normalizeId(input.authorityDecisionId, "odeu_authority_decision");
  const callId = normalizeId(input.callId, "odeu_capability_call");
  const capabilityId = normalizeId(input.capabilityId, "odeu_capability");
  const sourceRefs = normalizeOdeuSourceRefs(input.sourceRefs, options);
  const argumentValidation = normalizeArgumentValidation(input.argumentValidation);
  const sideEffectClass = pickEnum(input.sideEffectClass, ODEU_SIDE_EFFECT_CLASSES, "none");
  const activationDecision = pickEnum(input.activationDecision, [
    ...ODEU_ACTIVATION_STATES,
    "not_found",
  ], "not_found");
  const policyDecision = pickEnum(input.policyDecision, ODEU_POLICY_DECISIONS, "block");
  const executorState = pickEnum(input.executorState, ODEU_EXECUTOR_STATES, "not_started");
  const decisionBasis = {
    argumentValidation,
    activationDecision,
    policyDecision,
    executorState,
    sideEffectClass,
  };
  const finalDecision = pickEnum(input.finalDecision, ODEU_FINAL_AUTHORITY_DECISIONS, decideFinalAuthority(decisionBasis));
  const decision = {
    ...buildAuthorityArtifactBase({
      ...input,
      schema: ODEU_PER_CALL_AUTHORITY_DECISION_SCHEMA,
      artifactId: input.artifactId || authorityDecisionId,
      sourceRefs,
    }, options, "odeu_per_call_authority_decision"),
    schema: ODEU_PER_CALL_AUTHORITY_DECISION_SCHEMA,
    authorityDecisionId,
    callId,
    capabilityId,
    scope: normalizeAuthorityScope(input.scope || input),
    activationDecision,
    policyDecision,
    executorState,
    recoveryState: pickEnum(input.recoveryState, ODEU_RECOVERY_STATES, "not_needed"),
    replayPolicy: pickEnum(input.replayPolicy, ODEU_REPLAY_POLICIES, "never"),
    finalDecision,
    caller: pickEnum(input.caller, ODEU_AUTHORITY_CALLERS, "fixture"),
    callSurface: pickEnum(input.callSurface, ODEU_CALL_SURFACES, "internal_transition"),
    argumentValidation,
    sideEffectClass,
    decidedAt: normalizeString(input.decidedAt, nowIso(options.now || Date.now)),
  };
  for (const field of ["activationSnapshotId", "declarationSnapshotId", "activationRowId"]) {
    const value = normalizeString(input[field], "");
    if (value) decision[field] = value;
  }
  const approvalRequirement = pickEnum(input.approvalRequirement, ODEU_APPROVAL_REQUIREMENTS, "");
  if (approvalRequirement) decision.approvalRequirement = approvalRequirement;
  decision.artifactDigest = artifactDigest({
    schema: decision.schema,
    artifactKind: "odeu_per_call_authority_decision",
    value: decision,
  });
  validateOdeuPerCallAuthorityDecision(decision);
  return decision;
}

function inferLifecycleFromDecision(authorityDecision) {
  if (!authorityDecision) return "planned";
  if (authorityDecision.finalDecision === "needs_human") return "waiting_for_human";
  if (authorityDecision.finalDecision === "shadow_only") return "planned";
  if (authorityDecision.finalDecision === "block" || authorityDecision.finalDecision === "unsupported") return "authority_blocked";
  return "approved";
}

function buildOdeuLiveCapabilityTransaction(input = {}, options = {}) {
  const authorityDecision = isPlainObject(input.authorityDecision) ? input.authorityDecision : null;
  const transactionId = normalizeId(input.transactionId, "odeu_live_capability_transaction");
  const capabilityId = normalizeId(input.capabilityId || authorityDecision?.capabilityId, "odeu_capability");
  const callId = normalizeId(input.callId || authorityDecision?.callId, "odeu_capability_call");
  const sourceRefs = normalizeOdeuSourceRefs(input.sourceRefs, options);
  const lifecycle = pickEnum(input.lifecycle, ODEU_TRANSACTION_LIFECYCLES, inferLifecycleFromDecision(authorityDecision));
  const sideEffectClass = pickEnum(input.sideEffectClass || authorityDecision?.sideEffectClass, ODEU_SIDE_EFFECT_CLASSES, "none");
  const replayPolicy = pickEnum(input.replayPolicy || authorityDecision?.replayPolicy, ODEU_REPLAY_POLICIES, "never");
  const replayAllowed = input.replayAllowed === true && replayPolicy === "idempotent_same_key";
  const transaction = {
    ...buildAuthorityArtifactBase({
      ...input,
      schema: ODEU_LIVE_CAPABILITY_TRANSACTION_SCHEMA,
      artifactId: input.artifactId || transactionId,
      sourceRefs,
    }, options, "odeu_live_capability_transaction"),
    schema: ODEU_LIVE_CAPABILITY_TRANSACTION_SCHEMA,
    transactionId,
    capabilityId,
    callId,
    sideEffectClass,
    lifecycle,
    replayAllowed,
  };
  const authorityDecisionId = normalizeString(input.authorityDecisionId || authorityDecision?.authorityDecisionId, "");
  if (authorityDecisionId) transaction.authorityDecisionId = authorityDecisionId;
  const idempotencyKey = normalizeString(input.idempotencyKey, "");
  if (idempotencyKey) transaction.idempotencyKey = idempotencyKey;
  const recoveryClassifierId = normalizeString(input.recoveryClassifierId, "");
  if (recoveryClassifierId) transaction.recoveryClassifierId = recoveryClassifierId;
  for (const field of ["startedAt", "completedAt"]) {
    const value = normalizeString(input[field], "");
    if (value) transaction[field] = value;
  }
  transaction.artifactDigest = artifactDigest({
    schema: transaction.schema,
    artifactKind: "odeu_live_capability_transaction",
    value: transaction,
  });
  validateOdeuLiveCapabilityTransaction(transaction, { authorityDecision });
  return transaction;
}

function validateRequiredString(value, label, errors) {
  if (typeof value === "string" && value.trim()) return;
  errors.push(`missing_required_string:${label}`);
}

function validateEnum(value, allowed, label, errors) {
  if (allowed.includes(value)) return;
  errors.push(`invalid_enum:${label}:${value || ""}`);
}

function validateBoolean(value, label, errors) {
  if (typeof value === "boolean") return;
  errors.push(`missing_required_boolean:${label}`);
}

function validateBase(value, errors) {
  try {
    validateOdeuArtifactBase(value);
  } catch (error) {
    errors.push(error.message || String(error));
  }
}

function validateScope(value = {}, errors) {
  if (!isPlainObject(value)) {
    errors.push("missing_required_object:scope");
    return;
  }
  if (!Object.keys(value).length) errors.push("empty_scope");
}

function validateArgumentValidation(value = {}, errors) {
  if (!isPlainObject(value)) {
    errors.push("missing_required_object:argumentValidation");
    return;
  }
  validateEnum(value.state, ODEU_ARGUMENT_VALIDATION_STATES, "argumentValidation.state", errors);
  if (!Array.isArray(value.blockers)) errors.push("missing_required_array:argumentValidation.blockers");
  try {
    if (value.schemaDigest) validateOdeuDigest(value.schemaDigest, "argumentValidation.schemaDigest");
    if (value.argumentsDigest) validateOdeuDigest(value.argumentsDigest, "argumentValidation.argumentsDigest");
  } catch (error) {
    errors.push(error.message || String(error));
  }
  if (value.state === "valid" && Array.isArray(value.blockers) && value.blockers.length) {
    errors.push("valid_arguments_cannot_have_blockers");
  }
}

function authorityAllowsExecutorStart(authorityDecision) {
  return ["allow_execute", "allow_read_only"].includes(authorityDecision?.finalDecision);
}

function validateOdeuPerCallAuthorityDecision(value = {}) {
  const errors = [];
  validateBase(value, errors);
  validateRequiredString(value.authorityDecisionId, "authorityDecisionId", errors);
  validateRequiredString(value.callId, "callId", errors);
  validateRequiredString(value.capabilityId, "capabilityId", errors);
  validateScope(value.scope, errors);
  validateEnum(value.caller, ODEU_AUTHORITY_CALLERS, "caller", errors);
  validateEnum(value.callSurface, ODEU_CALL_SURFACES, "callSurface", errors);
  validateArgumentValidation(value.argumentValidation, errors);
  validateEnum(value.activationDecision, [...ODEU_ACTIVATION_STATES, "not_found"], "activationDecision", errors);
  validateEnum(value.policyDecision, ODEU_POLICY_DECISIONS, "policyDecision", errors);
  if (value.approvalRequirement !== undefined) {
    validateEnum(value.approvalRequirement, ODEU_APPROVAL_REQUIREMENTS, "approvalRequirement", errors);
  }
  validateEnum(value.executorState, ODEU_EXECUTOR_STATES, "executorState", errors);
  validateEnum(value.recoveryState, ODEU_RECOVERY_STATES, "recoveryState", errors);
  validateEnum(value.replayPolicy, ODEU_REPLAY_POLICIES, "replayPolicy", errors);
  validateEnum(value.finalDecision, ODEU_FINAL_AUTHORITY_DECISIONS, "finalDecision", errors);
  validateEnum(value.sideEffectClass, ODEU_SIDE_EFFECT_CLASSES, "sideEffectClass", errors);
  validateRequiredString(value.decidedAt, "decidedAt", errors);
  const inferred = decideFinalAuthority(value);
  if (value.finalDecision !== inferred) errors.push(`final_decision_mismatch:${inferred}`);
  if (value.policyDecision === "needs_human" && (!value.approvalRequirement || value.approvalRequirement === "none")) {
    errors.push("needs_human_requires_approval_requirement");
  }
  if (!errors.length) return true;
  throw new Error(`odeu_authority_validation_failed:${errors.join(",")}`);
}

function validateOdeuLiveCapabilityTransaction(value = {}, options = {}) {
  const errors = [];
  validateBase(value, errors);
  validateRequiredString(value.transactionId, "transactionId", errors);
  validateRequiredString(value.capabilityId, "capabilityId", errors);
  validateRequiredString(value.callId, "callId", errors);
  validateEnum(value.sideEffectClass, ODEU_SIDE_EFFECT_CLASSES, "sideEffectClass", errors);
  validateEnum(value.lifecycle, ODEU_TRANSACTION_LIFECYCLES, "lifecycle", errors);
  validateBoolean(value.replayAllowed, "replayAllowed", errors);
  if (value.replayAllowed && !value.idempotencyKey) errors.push("replay_allowed_requires_idempotency_key");
  if (value.replayAllowed && options.authorityDecision?.replayPolicy !== "idempotent_same_key") {
    errors.push("replay_allowed_requires_idempotent_authority");
  }
  if (EXECUTOR_STARTED_LIFECYCLES.has(value.lifecycle) && !authorityAllowsExecutorStart(options.authorityDecision)) {
    errors.push("executor_lifecycle_requires_allowing_authority_decision");
  }
  if (value.lifecycle === "authority_blocked" && authorityAllowsExecutorStart(options.authorityDecision)) {
    errors.push("authority_blocked_conflicts_with_allowing_decision");
  }
  if (!errors.length) return true;
  throw new Error(`odeu_transaction_validation_failed:${errors.join(",")}`);
}

module.exports = {
  ODEU_APPROVAL_REQUIREMENTS,
  ODEU_ARGUMENT_VALIDATION_STATES,
  ODEU_AUTHORITY_CALLERS,
  ODEU_CALL_SURFACES,
  ODEU_EXECUTOR_STATES,
  ODEU_FINAL_AUTHORITY_DECISIONS,
  ODEU_LIVE_CAPABILITY_TRANSACTION_SCHEMA,
  ODEU_PER_CALL_AUTHORITY_DECISION_SCHEMA,
  ODEU_POLICY_DECISIONS,
  ODEU_RECOVERY_STATES,
  ODEU_REPLAY_POLICIES,
  ODEU_TRANSACTION_LIFECYCLES,
  buildOdeuLiveCapabilityTransaction,
  buildOdeuPerCallAuthorityDecision,
  decideFinalAuthority,
  validateOdeuLiveCapabilityTransaction,
  validateOdeuPerCallAuthorityDecision,
};
