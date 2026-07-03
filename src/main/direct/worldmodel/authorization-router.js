"use strict";

const { canonicalJson, sha256 } = require("../meta-session/digest");
const {
  isPlainObject,
  normalizeId,
  normalizeString,
  nowIso,
} = require("../meta-session/ids");
const { normalizeOdeuSourceRefs } = require("../odeu/source-ref");
const {
  buildRevisionCompatibility,
  validateActiveInteractionWorldmodel,
  validateRevisionCompatibility,
} = require("./kernel");
const { validateWorldmodelManagerProfile } = require("./manager");

const ACTION_CLASS_REGISTRY_ENTRY_SCHEMA = "direct_action_class_registry_entry@1";
const AUTHORIZATION_REQUEST_SCHEMA = "direct_authorization_request@1";
const AUTHORIZATION_DECISION_SCHEMA = "direct_authorization_decision@1";
const POLICY_RESOLUTION_TRACE_SCHEMA = "direct_policy_resolution_trace@1";
const AUTHORIZATION_CONTINUATION_ENVELOPE_SCHEMA = "direct_authorization_continuation_envelope@1";
const AUTHORIZATION_DECISION_LEDGER_ROW_SCHEMA = "direct_authorization_decision_ledger_row@1";

const REVERSIBILITY_VALUES = Object.freeze(["reversible", "partly_reversible", "irreversible", "unknown"]);
const RISK_LEVELS = Object.freeze(["low", "medium", "high", "critical"]);
const PROPOSED_MODES = Object.freeze(["manager_discretion", "explicit_user_confirmation", "admin_mode"]);
const POLICY_POSTURES = Object.freeze([
  "deny",
  "admin_mode_required",
  "explicit_user_confirmation_required",
  "manager_discretion",
  "allow",
]);
const AUTHORIZATION_DECISIONS = Object.freeze([
  "grant",
  "deny",
  "remand",
  "escalate_user_confirmation",
  "escalate_admin_mode",
]);
const CONTINUATION_STATUSES = Object.freeze(["authorized", "denied", "remanded", "escalated"]);
const LEDGER_ROW_KINDS = Object.freeze(["authorization_decision_recorded"]);

const POSTURE_RANK = Object.freeze({
  allow: 0,
  manager_discretion: 1,
  explicit_user_confirmation_required: 2,
  admin_mode_required: 3,
  deny: 4,
});

const DIGEST_FIELDS = new Set([
  "entryDigest",
  "requestDigest",
  "decisionDigest",
  "traceDigest",
  "continuationDigest",
  "rowDigest",
]);

const DEFAULT_ACTION_CLASS_SEEDS = Object.freeze([
  {
    actionClass: "read_context",
    roleLane: "any",
    targetKind: "context",
    defaultPosture: "allow",
    riskCeiling: "low",
    reversibility: "reversible",
    dangerousAction: false,
    managerCanDecide: true,
    userConfirmationAllowed: false,
    adminModeRequired: false,
  },
  {
    actionClass: "summarize",
    roleLane: "any",
    targetKind: "context",
    defaultPosture: "allow",
    riskCeiling: "low",
    reversibility: "reversible",
    dangerousAction: false,
    managerCanDecide: true,
    userConfirmationAllowed: false,
    adminModeRequired: false,
  },
  {
    actionClass: "apply_patch",
    roleLane: "implementation_worker",
    targetKind: "workspace_file",
    defaultPosture: "manager_discretion",
    riskCeiling: "medium",
    reversibility: "partly_reversible",
    dangerousAction: false,
    managerCanDecide: true,
    userConfirmationAllowed: true,
    adminModeRequired: false,
    evidenceRequirements: ["scoped_workthread", "workspace_target_refs"],
  },
  {
    actionClass: "broad_refactor",
    roleLane: "implementation_worker",
    targetKind: "workspace",
    defaultPosture: "explicit_user_confirmation_required",
    riskCeiling: "high",
    reversibility: "partly_reversible",
    dangerousAction: true,
    managerCanDecide: false,
    userConfirmationAllowed: true,
    adminModeRequired: false,
    evidenceRequirements: ["architecture_need", "blast_radius_summary"],
  },
  {
    actionClass: "destructive_delete",
    roleLane: "implementation_worker",
    targetKind: "workspace_file",
    defaultPosture: "admin_mode_required",
    riskCeiling: "critical",
    reversibility: "irreversible",
    dangerousAction: true,
    managerCanDecide: false,
    userConfirmationAllowed: false,
    adminModeRequired: true,
    evidenceRequirements: ["explicit_admin_intent", "target_inventory"],
  },
  {
    actionClass: "external_write",
    roleLane: "any",
    targetKind: "external_system",
    defaultPosture: "explicit_user_confirmation_required",
    riskCeiling: "high",
    reversibility: "unknown",
    dangerousAction: true,
    managerCanDecide: false,
    userConfirmationAllowed: true,
    adminModeRequired: false,
    evidenceRequirements: ["external_target_identity", "payload_summary"],
  },
  {
    actionClass: "account_mutation",
    roleLane: "any",
    targetKind: "account",
    defaultPosture: "admin_mode_required",
    riskCeiling: "critical",
    reversibility: "unknown",
    dangerousAction: true,
    managerCanDecide: false,
    userConfirmationAllowed: false,
    adminModeRequired: true,
    evidenceRequirements: ["explicit_admin_intent", "account_scope"],
  },
]);

function validationError(code, detail = "") {
  const error = new Error(detail ? `${code}:${detail}` : code);
  error.code = code;
  if (detail) error.detail = detail;
  return error;
}

function requirePlainObject(value, label) {
  if (isPlainObject(value)) return value;
  throw validationError("direct_authorization_router_invalid_object", label);
}

function requireString(value, label) {
  const text = normalizeString(value, "");
  if (text) return text;
  throw validationError("direct_authorization_router_missing_string", label);
}

function requireArray(value, label) {
  if (Array.isArray(value)) return value;
  throw validationError("direct_authorization_router_missing_array", label);
}

function pickEnum(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map((entry) => stableValue(entry));
  if (!isPlainObject(value)) return value;
  const output = {};
  for (const key of Object.keys(value).sort()) {
    if (DIGEST_FIELDS.has(key)) continue;
    if (typeof value[key] !== "undefined") output[key] = stableValue(value[key]);
  }
  return output;
}

function digestFor(domain, value) {
  return sha256(`${domain}\0${canonicalJson(stableValue(value), { omitDigestFields: false })}`);
}

function validateDigest(value, fieldName, domain, label) {
  const digest = requireString(value[fieldName], `${label}.${fieldName}`);
  if (digest !== digestFor(domain, value)) {
    throw validationError("direct_authorization_router_digest_mismatch", `${label}.${fieldName}`);
  }
  return true;
}

function normalizeRefs(values, fallbackKind = "source_ref") {
  return (Array.isArray(values) ? values : [])
    .map((value) => {
      const source = isPlainObject(value) ? value : {};
      const id = normalizeString(source.id || source.refId || source.artifactId || source.targetId, "");
      const digest = normalizeString(source.digest || source.artifactDigest || source.targetDigest, "");
      if (!id && !digest) return null;
      return {
        kind: normalizeString(source.kind || source.refKind, fallbackKind),
        id,
        digest,
        label: normalizeString(source.label || source.rendererSafeLabel, fallbackKind),
        rawTextIncluded: false,
        rawPathIncluded: false,
        rawSecretIncluded: false,
      };
    })
    .filter(Boolean);
}

function validateRef(ref, label, options = {}) {
  requirePlainObject(ref, label);
  requireString(ref.kind, `${label}.kind`);
  if (options.requireId !== false) requireString(ref.id, `${label}.id`);
  if (options.requireDigest !== false) requireString(ref.digest, `${label}.digest`);
  if (ref.rawTextIncluded === true || ref.rawPathIncluded === true || ref.rawSecretIncluded === true) {
    throw validationError("direct_authorization_router_raw_ref_exposure", label);
  }
  return true;
}

function refFromDigest(kind, id, digest, label = kind) {
  return {
    kind: normalizeString(kind, "unknown"),
    id: normalizeString(id, ""),
    digest: normalizeString(digest, ""),
    label: normalizeString(label, kind),
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
}

function actionClassRef(entry) {
  return refFromDigest(
    "action_class_registry_entry",
    entry.entryId,
    entry.entryDigest,
    entry.actionClass,
  );
}

function requestRef(request) {
  return refFromDigest(
    "authorization_request",
    request.requestId,
    request.requestDigest,
    request.requestedAction?.actionClass || "authorization_request",
  );
}

function traceRef(trace) {
  return refFromDigest("policy_resolution_trace", trace.traceId, trace.traceDigest, trace.dominantPosture);
}

function decisionRef(decision) {
  return refFromDigest("authorization_decision", decision.decisionId, decision.decisionDigest, decision.decision);
}

function continuationRef(continuation) {
  return refFromDigest("authorization_continuation", continuation.continuationId, continuation.continuationDigest, continuation.status);
}

function buildActionClassRegistryEntry(input = {}, options = {}) {
  const source = isPlainObject(input) ? input : {};
  const actionClass = requireString(source.actionClass, "actionRegistryEntry.actionClass");
  const createdAt = normalizeString(source.createdAt, nowIso(options.now || Date.now));
  const entry = {
    schema: ACTION_CLASS_REGISTRY_ENTRY_SCHEMA,
    entryId: normalizeString(source.entryId, `action_class_${actionClass}`),
    actionClass,
    roleLane: normalizeString(source.roleLane, "any"),
    targetKind: normalizeString(source.targetKind, "unknown"),
    defaultPosture: pickEnum(source.defaultPosture, POLICY_POSTURES, "deny"),
    riskCeiling: pickEnum(source.riskCeiling, RISK_LEVELS, "medium"),
    reversibility: pickEnum(source.reversibility, REVERSIBILITY_VALUES, "unknown"),
    dangerousAction: Boolean(source.dangerousAction),
    managerCanDecide: Boolean(source.managerCanDecide),
    userConfirmationAllowed: Boolean(source.userConfirmationAllowed),
    adminModeRequired: Boolean(source.adminModeRequired),
    evidenceRequirements: (Array.isArray(source.evidenceRequirements) ? source.evidenceRequirements : [])
      .map((item) => normalizeString(item, ""))
      .filter(Boolean),
    sourceRefs: normalizeOdeuSourceRefs(source.sourceRefs, options),
    createdAt,
    updatedAt: normalizeString(source.updatedAt, createdAt),
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  entry.entryDigest = digestFor("direct-action-class-registry-entry@1", entry);
  return entry;
}

function validateActionClassRegistryEntry(entry) {
  requirePlainObject(entry, "actionRegistryEntry");
  if (entry.schema !== ACTION_CLASS_REGISTRY_ENTRY_SCHEMA) {
    throw validationError("direct_authorization_router_schema_mismatch", "actionRegistryEntry");
  }
  requireString(entry.entryId, "actionRegistryEntry.entryId");
  requireString(entry.actionClass, "actionRegistryEntry.actionClass");
  if (!POLICY_POSTURES.includes(entry.defaultPosture)) {
    throw validationError("direct_authorization_router_invalid_policy_posture", "actionRegistryEntry.defaultPosture");
  }
  if (!RISK_LEVELS.includes(entry.riskCeiling)) {
    throw validationError("direct_authorization_router_invalid_risk_level", "actionRegistryEntry.riskCeiling");
  }
  if (!REVERSIBILITY_VALUES.includes(entry.reversibility)) {
    throw validationError("direct_authorization_router_invalid_reversibility", "actionRegistryEntry.reversibility");
  }
  requireArray(entry.evidenceRequirements, "actionRegistryEntry.evidenceRequirements");
  if (entry.rawTextIncluded === true || entry.rawPathIncluded === true || entry.rawSecretIncluded === true) {
    throw validationError("direct_authorization_router_raw_entry_exposure", "actionRegistryEntry");
  }
  validateDigest(entry, "entryDigest", "direct-action-class-registry-entry@1", "actionRegistryEntry");
  return true;
}

function buildSeedActionClassRegistry(options = {}) {
  return DEFAULT_ACTION_CLASS_SEEDS.map((seed) => buildActionClassRegistryEntry(seed, options));
}

function findActionClassEntry(registry, actionClass, roleLane = "") {
  const entries = Array.isArray(registry) && registry.length ? registry : buildSeedActionClassRegistry();
  const exact = entries.find((entry) => entry.actionClass === actionClass && roleLane && entry.roleLane === roleLane);
  const any = entries.find((entry) => entry.actionClass === actionClass && entry.roleLane === "any");
  const loose = entries.find((entry) => entry.actionClass === actionClass);
  return exact || any || loose || buildActionClassRegistryEntry({
    actionClass,
    roleLane: normalizeString(roleLane, "any"),
    targetKind: "unknown",
    defaultPosture: "deny",
    riskCeiling: "critical",
    reversibility: "unknown",
    dangerousAction: true,
    managerCanDecide: false,
    userConfirmationAllowed: false,
    adminModeRequired: false,
    evidenceRequirements: ["registered_action_class"],
  });
}

function normalizeRequestedAction(input = {}) {
  const source = isPlainObject(input) ? input : {};
  return {
    actionClass: requireString(source.actionClass, "authorizationRequest.requestedAction.actionClass"),
    toolName: normalizeString(source.toolName, ""),
    targetKind: normalizeString(source.targetKind, "unknown"),
    targetRefs: normalizeRefs(source.targetRefs, "action_target"),
    scope: normalizeString(source.scope, "work_thread"),
    reversibility: pickEnum(source.reversibility, REVERSIBILITY_VALUES, "unknown"),
    riskLevel: pickEnum(source.riskLevel, RISK_LEVELS, "medium"),
  };
}

function validateRequestedAction(action, label = "requestedAction") {
  requirePlainObject(action, label);
  requireString(action.actionClass, `${label}.actionClass`);
  requireString(action.targetKind, `${label}.targetKind`);
  requireString(action.scope, `${label}.scope`);
  if (!REVERSIBILITY_VALUES.includes(action.reversibility)) {
    throw validationError("direct_authorization_router_invalid_reversibility", `${label}.reversibility`);
  }
  if (!RISK_LEVELS.includes(action.riskLevel)) {
    throw validationError("direct_authorization_router_invalid_risk_level", `${label}.riskLevel`);
  }
  requireArray(action.targetRefs, `${label}.targetRefs`);
  action.targetRefs.forEach((ref, index) => validateRef(ref, `${label}.targetRefs.${index}`, { requireDigest: false }));
  return true;
}

function normalizeWorkerClaim(input = {}) {
  const source = isPlainObject(input) ? input : {};
  return {
    whyNeeded: normalizeString(source.whyNeeded, "Worker requested authorization for a blocked action."),
    expectedBenefit: normalizeString(source.expectedBenefit, ""),
    knownRisks: (Array.isArray(source.knownRisks) ? source.knownRisks : [])
      .map((item) => normalizeString(item, ""))
      .filter(Boolean),
    alternativesConsidered: (Array.isArray(source.alternativesConsidered) ? source.alternativesConsidered : [])
      .map((item) => normalizeString(item, ""))
      .filter(Boolean),
  };
}

function validateWorkerClaim(claim) {
  requirePlainObject(claim, "authorizationRequest.workerClaim");
  requireString(claim.whyNeeded, "authorizationRequest.workerClaim.whyNeeded");
  requireArray(claim.knownRisks, "authorizationRequest.workerClaim.knownRisks");
  requireArray(claim.alternativesConsidered, "authorizationRequest.workerClaim.alternativesConsidered");
  return true;
}

function buildAuthorizationRequest(input = {}, options = {}) {
  const source = isPlainObject(input) ? input : {};
  const worldmodel = source.worldmodel;
  if (worldmodel) validateActiveInteractionWorldmodel(worldmodel);
  const request = {
    schema: AUTHORIZATION_REQUEST_SCHEMA,
    requestId: normalizeId(source.requestId, "authorization_request"),
    workerAgentId: normalizeId(source.workerAgentId, "agent_worker"),
    agentRunId: normalizeId(source.agentRunId, "agent_run"),
    workThreadId: normalizeId(source.workThreadId || worldmodel?.scope?.workThreadId, "work_thread"),
    threadId: normalizeString(source.threadId, ""),
    worldmodelId: requireString(source.worldmodelId || worldmodel?.worldmodelId, "authorizationRequest.worldmodelId"),
    worldmodelRevision: Number(source.worldmodelRevision || worldmodel?.revision || 0),
    requestedAction: normalizeRequestedAction(source.requestedAction || source),
    workerClaim: normalizeWorkerClaim(source.workerClaim),
    evidenceRefs: normalizeRefs(source.evidenceRefs, "authorization_evidence"),
    proposedMode: pickEnum(source.proposedMode, PROPOSED_MODES, "manager_discretion"),
    createdAt: normalizeString(source.createdAt, nowIso(options.now || Date.now)),
    rawUserTextExposedToManager: false,
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  if (!Number.isInteger(request.worldmodelRevision) || request.worldmodelRevision < 1) {
    throw validationError("direct_authorization_router_invalid_revision", "authorizationRequest.worldmodelRevision");
  }
  request.requestDigest = digestFor("direct-authorization-request@1", request);
  return request;
}

function validateAuthorizationRequest(request) {
  requirePlainObject(request, "authorizationRequest");
  if (request.schema !== AUTHORIZATION_REQUEST_SCHEMA) {
    throw validationError("direct_authorization_router_schema_mismatch", "authorizationRequest");
  }
  requireString(request.requestId, "authorizationRequest.requestId");
  requireString(request.workerAgentId, "authorizationRequest.workerAgentId");
  requireString(request.agentRunId, "authorizationRequest.agentRunId");
  requireString(request.workThreadId, "authorizationRequest.workThreadId");
  requireString(request.worldmodelId, "authorizationRequest.worldmodelId");
  if (!Number.isInteger(request.worldmodelRevision) || request.worldmodelRevision < 1) {
    throw validationError("direct_authorization_router_invalid_revision", "authorizationRequest.worldmodelRevision");
  }
  validateRequestedAction(request.requestedAction, "authorizationRequest.requestedAction");
  validateWorkerClaim(request.workerClaim);
  requireArray(request.evidenceRefs, "authorizationRequest.evidenceRefs");
  request.evidenceRefs.forEach((ref, index) => validateRef(ref, `authorizationRequest.evidenceRefs.${index}`, { requireDigest: false }));
  if (!PROPOSED_MODES.includes(request.proposedMode)) {
    throw validationError("direct_authorization_router_invalid_proposed_mode", "authorizationRequest.proposedMode");
  }
  if (request.rawUserTextExposedToManager === true || request.rawTextIncluded === true || request.rawPathIncluded === true || request.rawSecretIncluded === true) {
    throw validationError("direct_authorization_router_raw_request_exposure", "authorizationRequest");
  }
  validateDigest(request, "requestDigest", "direct-authorization-request@1", "authorizationRequest");
  return true;
}

function evidenceRequirementRefs(request) {
  const available = new Set([
    ...request.evidenceRefs.map((ref) => ref.id).filter(Boolean),
    ...request.evidenceRefs.map((ref) => ref.kind).filter(Boolean),
  ]);
  if (request.workThreadId) available.add("scoped_workthread");
  if (request.requestedAction.targetRefs.length) available.add("workspace_target_refs");
  return available;
}

function buildPolicyResolutionTrace(input = {}, options = {}) {
  const source = isPlainObject(input) ? input : {};
  const request = source.request;
  validateAuthorizationRequest(request);
  const registryEntry = source.registryEntry || findActionClassEntry(source.registry, request.requestedAction.actionClass, source.roleLane || request.requestedAction.roleLane);
  validateActionClassRegistryEntry(registryEntry);
  const availableEvidence = evidenceRequirementRefs(request);
  const missingEvidence = registryEntry.evidenceRequirements
    .filter((requirement) => !availableEvidence.has(requirement))
    .map((requirement) => ({
      requirementId: requirement,
      actionClass: registryEntry.actionClass,
      satisfied: false,
    }));
  const evidenceSatisfied = missingEvidence.length === 0;
  const dominantPosture = pickEnum(source.dominantPosture, POLICY_POSTURES, registryEntry.defaultPosture);
  const trace = {
    schema: POLICY_RESOLUTION_TRACE_SCHEMA,
    traceId: normalizeId(source.traceId, "policy_resolution_trace"),
    requestId: request.requestId,
    matchedPolicyRefs: [actionClassRef(registryEntry)],
    defaultPolicyRef: actionClassRef(registryEntry),
    dominantPosture,
    exceptionApplied: null,
    evidenceSatisfied,
    missingEvidence,
    rationale: normalizeString(source.rationale, `Action class ${request.requestedAction.actionClass} resolves to ${dominantPosture}.`),
    evaluatedAt: normalizeString(source.evaluatedAt, nowIso(options.now || Date.now)),
    shadowOnly: true,
    rawPolicyLedgerExposed: false,
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  trace.traceDigest = digestFor("direct-policy-resolution-trace@1", trace);
  return trace;
}

function validatePolicyResolutionTrace(trace) {
  requirePlainObject(trace, "policyResolutionTrace");
  if (trace.schema !== POLICY_RESOLUTION_TRACE_SCHEMA) {
    throw validationError("direct_authorization_router_schema_mismatch", "policyResolutionTrace");
  }
  requireString(trace.traceId, "policyResolutionTrace.traceId");
  requireString(trace.requestId, "policyResolutionTrace.requestId");
  requireArray(trace.matchedPolicyRefs, "policyResolutionTrace.matchedPolicyRefs");
  trace.matchedPolicyRefs.forEach((ref, index) => validateRef(ref, `policyResolutionTrace.matchedPolicyRefs.${index}`));
  if (trace.defaultPolicyRef) validateRef(trace.defaultPolicyRef, "policyResolutionTrace.defaultPolicyRef");
  if (!POLICY_POSTURES.includes(trace.dominantPosture)) {
    throw validationError("direct_authorization_router_invalid_policy_posture", "policyResolutionTrace.dominantPosture");
  }
  requireArray(trace.missingEvidence, "policyResolutionTrace.missingEvidence");
  if (trace.shadowOnly !== true || trace.rawPolicyLedgerExposed === true || trace.rawTextIncluded === true || trace.rawPathIncluded === true || trace.rawSecretIncluded === true) {
    throw validationError("direct_authorization_router_raw_trace_exposure", "policyResolutionTrace");
  }
  validateDigest(trace, "traceDigest", "direct-policy-resolution-trace@1", "policyResolutionTrace");
  return true;
}

function decisionFromTrace(trace, sourceDecision = "") {
  if (!trace.evidenceSatisfied) return "remand";
  switch (trace.dominantPosture) {
    case "deny":
      return "deny";
    case "admin_mode_required":
      return "escalate_admin_mode";
    case "explicit_user_confirmation_required":
      return "escalate_user_confirmation";
    case "manager_discretion":
    case "allow":
      return pickEnum(sourceDecision, AUTHORIZATION_DECISIONS, "grant");
    default:
      return "remand";
  }
}

function decisionStatusFor(decision) {
  if (decision === "grant") return "authorized";
  if (decision === "deny") return "denied";
  if (decision === "remand") return "remanded";
  return "escalated";
}

function buildAuthorizationDecision(input = {}, options = {}) {
  const source = isPlainObject(input) ? input : {};
  const request = source.request;
  const managerProfile = source.managerProfile;
  const currentWorldmodel = source.currentWorldmodel || source.worldmodel;
  validateAuthorizationRequest(request);
  if (managerProfile) validateWorldmodelManagerProfile(managerProfile);
  if (currentWorldmodel) validateActiveInteractionWorldmodel(currentWorldmodel);
  const policyResolutionTrace = source.policyResolutionTrace || buildPolicyResolutionTrace({
    request,
    registry: source.registry,
    registryEntry: source.registryEntry,
  }, options);
  validatePolicyResolutionTrace(policyResolutionTrace);
  const revisionCompatibility = source.revisionCompatibility || buildRevisionCompatibility({
    expectedWorldmodelId: request.worldmodelId,
    expectedRevision: request.worldmodelRevision,
    currentWorldmodel,
    checkedAt: source.decidedAt,
    now: options.now,
  });
  validateRevisionCompatibility(revisionCompatibility);
  const revisionBlocked = revisionCompatibility.requiresRemand;
  const decision = revisionBlocked ? "remand" : decisionFromTrace(policyResolutionTrace, source.decision);
  const policyRefs = Array.isArray(source.policyRefs) && source.policyRefs.length
    ? normalizeRefs(source.policyRefs, "policy")
    : policyResolutionTrace.matchedPolicyRefs;
  const evidenceRefs = normalizeRefs(source.evidenceRefs || request.evidenceRefs, "authorization_evidence");
  const record = {
    schema: AUTHORIZATION_DECISION_SCHEMA,
    decisionId: normalizeId(source.decisionId, "authorization_decision"),
    requestId: request.requestId,
    requestRef: requestRef(request),
    managerAgentId: normalizeId(source.managerAgentId || managerProfile?.managerAgentId, "agent_worldmodel_manager"),
    worldmodelId: request.worldmodelId,
    worldmodelRevision: request.worldmodelRevision,
    decision,
    authorityScope: normalizeString(source.authorityScope || request.requestedAction.scope, ""),
    expiresAt: normalizeString(source.expiresAt, ""),
    oneShot: source.oneShot !== false,
    conditions: (Array.isArray(source.conditions) ? source.conditions : [])
      .map((condition) => normalizeString(condition, ""))
      .filter(Boolean),
    rationale: normalizeString(source.rationale, revisionBlocked
      ? "Authorization remanded because the active worldmodel revision is not compatible."
      : `Authorization decision derived from ${policyResolutionTrace.dominantPosture}.`),
    policyRefs,
    evidenceRefs,
    policyResolutionTraceRef: traceRef(policyResolutionTrace),
    rawUserTextExposedToWorker: false,
    revisionCompatibility,
    currentWorldmodelRevision: Number(currentWorldmodel?.revision || revisionCompatibility.currentRevision || 0),
    currentWorldmodelDigest: normalizeString(currentWorldmodel?.digest || revisionCompatibility.currentWorldmodelDigest, ""),
    decidedAt: normalizeString(source.decidedAt, nowIso(options.now || Date.now)),
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  record.decisionDigest = digestFor("direct-authorization-decision@1", record);
  return record;
}

function validateAuthorizationDecision(decision) {
  requirePlainObject(decision, "authorizationDecision");
  if (decision.schema !== AUTHORIZATION_DECISION_SCHEMA) {
    throw validationError("direct_authorization_router_schema_mismatch", "authorizationDecision");
  }
  requireString(decision.decisionId, "authorizationDecision.decisionId");
  requireString(decision.requestId, "authorizationDecision.requestId");
  validateRef(decision.requestRef, "authorizationDecision.requestRef");
  requireString(decision.managerAgentId, "authorizationDecision.managerAgentId");
  requireString(decision.worldmodelId, "authorizationDecision.worldmodelId");
  if (!Number.isInteger(decision.worldmodelRevision) || decision.worldmodelRevision < 1) {
    throw validationError("direct_authorization_router_invalid_revision", "authorizationDecision.worldmodelRevision");
  }
  if (!AUTHORIZATION_DECISIONS.includes(decision.decision)) {
    throw validationError("direct_authorization_router_invalid_decision", "authorizationDecision.decision");
  }
  requireArray(decision.conditions, "authorizationDecision.conditions");
  requireArray(decision.policyRefs, "authorizationDecision.policyRefs");
  decision.policyRefs.forEach((ref, index) => validateRef(ref, `authorizationDecision.policyRefs.${index}`, { requireDigest: false }));
  requireArray(decision.evidenceRefs, "authorizationDecision.evidenceRefs");
  decision.evidenceRefs.forEach((ref, index) => validateRef(ref, `authorizationDecision.evidenceRefs.${index}`, { requireDigest: false }));
  validateRef(decision.policyResolutionTraceRef, "authorizationDecision.policyResolutionTraceRef");
  validateRevisionCompatibility(decision.revisionCompatibility);
  if (decision.rawUserTextExposedToWorker !== false || decision.rawTextIncluded === true || decision.rawPathIncluded === true || decision.rawSecretIncluded === true) {
    throw validationError("direct_authorization_router_raw_decision_exposure", "authorizationDecision");
  }
  if (decision.decision === "grant" && !decision.authorityScope) {
    throw validationError("direct_authorization_router_unscoped_grant", "authorizationDecision.authorityScope");
  }
  validateDigest(decision, "decisionDigest", "direct-authorization-decision@1", "authorizationDecision");
  return true;
}

function buildAuthorizationContinuationEnvelope(input = {}, options = {}) {
  const source = isPlainObject(input) ? input : {};
  const decision = source.decision || source.authorizationDecision;
  validateAuthorizationDecision(decision);
  const status = decisionStatusFor(decision.decision);
  const envelope = {
    schema: AUTHORIZATION_CONTINUATION_ENVELOPE_SCHEMA,
    continuationId: normalizeId(source.continuationId, "authorization_continuation"),
    requestId: decision.requestId,
    decisionRef: decisionRef(decision),
    status,
    workerContinuationKind: decision.decision === "grant"
      ? "continue_with_scoped_authority"
      : decision.decision === "deny"
        ? "stop_requested_action"
        : decision.decision === "remand"
          ? "revise_request_or_refresh_worldmodel"
          : "wait_for_external_authority",
    authorityScope: normalizeString(decision.authorityScope, ""),
    oneShot: decision.oneShot,
    conditions: decision.conditions.slice(),
    expiresAt: normalizeString(decision.expiresAt, ""),
    message: normalizeString(source.message, status),
    createdAt: normalizeString(source.createdAt, nowIso(options.now || Date.now)),
    rawUserTextExposedToWorker: false,
    rawPolicyLedgerExposed: false,
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  envelope.continuationDigest = digestFor("direct-authorization-continuation-envelope@1", envelope);
  return envelope;
}

function validateAuthorizationContinuationEnvelope(envelope) {
  requirePlainObject(envelope, "authorizationContinuationEnvelope");
  if (envelope.schema !== AUTHORIZATION_CONTINUATION_ENVELOPE_SCHEMA) {
    throw validationError("direct_authorization_router_schema_mismatch", "authorizationContinuationEnvelope");
  }
  requireString(envelope.continuationId, "authorizationContinuationEnvelope.continuationId");
  requireString(envelope.requestId, "authorizationContinuationEnvelope.requestId");
  validateRef(envelope.decisionRef, "authorizationContinuationEnvelope.decisionRef");
  if (!CONTINUATION_STATUSES.includes(envelope.status)) {
    throw validationError("direct_authorization_router_invalid_continuation_status", "authorizationContinuationEnvelope.status");
  }
  requireArray(envelope.conditions, "authorizationContinuationEnvelope.conditions");
  if (envelope.rawUserTextExposedToWorker !== false || envelope.rawPolicyLedgerExposed !== false || envelope.rawTextIncluded === true || envelope.rawPathIncluded === true || envelope.rawSecretIncluded === true) {
    throw validationError("direct_authorization_router_raw_continuation_exposure", "authorizationContinuationEnvelope");
  }
  validateDigest(envelope, "continuationDigest", "direct-authorization-continuation-envelope@1", "authorizationContinuationEnvelope");
  return true;
}

function buildAuthorizationDecisionLedgerRow(input = {}, options = {}) {
  const source = isPlainObject(input) ? input : {};
  const request = source.request;
  const trace = source.policyResolutionTrace;
  const decision = source.decision || source.authorizationDecision;
  const continuation = source.continuation || source.continuationEnvelope;
  validateAuthorizationRequest(request);
  validatePolicyResolutionTrace(trace);
  validateAuthorizationDecision(decision);
  validateAuthorizationContinuationEnvelope(continuation);
  const row = {
    schema: AUTHORIZATION_DECISION_LEDGER_ROW_SCHEMA,
    rowId: normalizeId(source.rowId, "authorization_decision_row"),
    rowKind: "authorization_decision_recorded",
    sequence: Number.isInteger(source.sequence) && source.sequence > 0 ? source.sequence : 1,
    previousRowDigest: normalizeString(source.previousRowDigest, ""),
    requestRef: requestRef(request),
    policyResolutionTraceRef: traceRef(trace),
    decisionRef: decisionRef(decision),
    continuationRef: continuationRef(continuation),
    worldmodelId: decision.worldmodelId,
    worldmodelRevision: decision.worldmodelRevision,
    currentWorldmodelRevision: decision.currentWorldmodelRevision,
    currentWorldmodelDigest: decision.currentWorldmodelDigest,
    decision: decision.decision,
    recordedAt: normalizeString(source.recordedAt, nowIso(options.now || Date.now)),
    rawUserTextExposedToWorker: false,
    rawPolicyLedgerExposed: false,
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  row.rowDigest = digestFor("direct-authorization-decision-ledger-row@1", row);
  return row;
}

function validateAuthorizationDecisionLedgerRow(row) {
  requirePlainObject(row, "authorizationDecisionLedgerRow");
  if (row.schema !== AUTHORIZATION_DECISION_LEDGER_ROW_SCHEMA) {
    throw validationError("direct_authorization_router_schema_mismatch", "authorizationDecisionLedgerRow");
  }
  requireString(row.rowId, "authorizationDecisionLedgerRow.rowId");
  if (!LEDGER_ROW_KINDS.includes(row.rowKind)) {
    throw validationError("direct_authorization_router_invalid_ledger_row_kind", "authorizationDecisionLedgerRow.rowKind");
  }
  if (!Number.isInteger(row.sequence) || row.sequence < 1) {
    throw validationError("direct_authorization_router_invalid_sequence", "authorizationDecisionLedgerRow.sequence");
  }
  validateRef(row.requestRef, "authorizationDecisionLedgerRow.requestRef");
  validateRef(row.policyResolutionTraceRef, "authorizationDecisionLedgerRow.policyResolutionTraceRef");
  validateRef(row.decisionRef, "authorizationDecisionLedgerRow.decisionRef");
  validateRef(row.continuationRef, "authorizationDecisionLedgerRow.continuationRef");
  if (row.rawUserTextExposedToWorker !== false || row.rawPolicyLedgerExposed !== false || row.rawTextIncluded === true || row.rawPathIncluded === true || row.rawSecretIncluded === true) {
    throw validationError("direct_authorization_router_raw_ledger_row_exposure", "authorizationDecisionLedgerRow");
  }
  validateDigest(row, "rowDigest", "direct-authorization-decision-ledger-row@1", "authorizationDecisionLedgerRow");
  return true;
}

module.exports = {
  ACTION_CLASS_REGISTRY_ENTRY_SCHEMA,
  AUTHORIZATION_CONTINUATION_ENVELOPE_SCHEMA,
  AUTHORIZATION_DECISION_LEDGER_ROW_SCHEMA,
  AUTHORIZATION_DECISION_SCHEMA,
  AUTHORIZATION_REQUEST_SCHEMA,
  POLICY_RESOLUTION_TRACE_SCHEMA,
  buildActionClassRegistryEntry,
  buildAuthorizationContinuationEnvelope,
  buildAuthorizationDecision,
  buildAuthorizationDecisionLedgerRow,
  buildAuthorizationRequest,
  buildPolicyResolutionTrace,
  buildSeedActionClassRegistry,
  findActionClassEntry,
  validateActionClassRegistryEntry,
  validateAuthorizationContinuationEnvelope,
  validateAuthorizationDecision,
  validateAuthorizationDecisionLedgerRow,
  validateAuthorizationRequest,
  validatePolicyResolutionTrace,
};
