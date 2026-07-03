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
  validateAuthorizationRequest,
} = require("./authorization-router");

const CONSTITUTIONAL_POLICY_PROFILE_SCHEMA = "direct_constitutional_policy_profile@1";
const CONSTITUTIONAL_POLICY_RULE_SCHEMA = "direct_constitutional_policy_rule@1";
const POLICY_EXCEPTION_RULE_SCHEMA = "direct_policy_exception_rule@1";
const SELF_BINDING_PREFERENCE_RECORD_SCHEMA = "direct_self_binding_preference_record@1";
const ADMIN_MODE_POLICY_UPDATE_SCHEMA = "direct_admin_mode_policy_update@1";
const POLICY_PROFILE_STORE_SCHEMA = "direct_constitutional_policy_profile_store@1";
const CONSTITUTIONAL_POLICY_RESOLUTION_TRACE_SCHEMA = "direct_constitutional_policy_resolution_trace@1";
const CHILD_POLICY_BOUNDARY_WITNESS_SCHEMA = "direct_child_policy_boundary_witness@1";

const POLICY_SCOPES = Object.freeze(["global_user", "project", "work_thread", "agent_class", "tool_family", "action_class"]);
const POLICY_POSTURES = Object.freeze([
  "deny",
  "admin_mode_required",
  "explicit_user_confirmation_required",
  "manager_discretion",
  "allow",
]);
const DEFAULT_DECISIONS = Object.freeze(["deny", "manager_discretion", "explicit_user_confirmation"]);
const CHANGE_KINDS = Object.freeze(["create_policy", "modify_policy", "retire_policy", "add_exception", "remove_exception"]);
const SELF_BINDING_KINDS = Object.freeze([
  "prefer_minimal_diff",
  "avoid_broad_refactor",
  "no_interference_subagent",
  "require_review_before_external_write",
  "custom",
]);

const POSTURE_RANK = Object.freeze({
  allow: 0,
  manager_discretion: 1,
  explicit_user_confirmation_required: 2,
  admin_mode_required: 3,
  deny: 4,
});

const DEFAULT_DECISION_TO_POSTURE = Object.freeze({
  deny: "deny",
  manager_discretion: "manager_discretion",
  explicit_user_confirmation: "explicit_user_confirmation_required",
});

const DIGEST_FIELDS = new Set([
  "profileDigest",
  "ruleDigest",
  "exceptionDigest",
  "selfBindingDigest",
  "updateDigest",
  "storeDigest",
  "traceDigest",
  "boundaryWitnessDigest",
]);

function validationError(code, detail = "") {
  const error = new Error(detail ? `${code}:${detail}` : code);
  error.code = code;
  if (detail) error.detail = detail;
  return error;
}

function requirePlainObject(value, label) {
  if (isPlainObject(value)) return value;
  throw validationError("direct_constitutional_policy_invalid_object", label);
}

function requireString(value, label) {
  const text = normalizeString(value, "");
  if (text) return text;
  throw validationError("direct_constitutional_policy_missing_string", label);
}

function requireArray(value, label) {
  if (Array.isArray(value)) return value;
  throw validationError("direct_constitutional_policy_missing_array", label);
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
    throw validationError("direct_constitutional_policy_digest_mismatch", `${label}.${fieldName}`);
  }
  return true;
}

function normalizeRefs(values, fallbackKind = "source_ref") {
  return (Array.isArray(values) ? values : [])
    .map((value) => {
      const source = isPlainObject(value) ? value : {};
      const id = normalizeString(source.id || source.refId || source.artifactId || source.policyId || source.ruleId, "");
      const digest = normalizeString(source.digest || source.artifactDigest || source.policyDigest || source.ruleDigest, "");
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
    throw validationError("direct_constitutional_policy_raw_ref_exposure", label);
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

function profileRef(profile) {
  return refFromDigest("constitutional_policy_profile", profile.profileId, profile.profileDigest, profile.scope);
}

function ruleRef(rule) {
  return refFromDigest("constitutional_policy_rule", rule.ruleId, rule.ruleDigest, rule.actionClass);
}

function exceptionRef(exception) {
  return refFromDigest("policy_exception_rule", exception.exceptionId, exception.exceptionDigest, exception.actionClass);
}

function normalizeScopeSelector(input = {}) {
  const source = isPlainObject(input) ? input : {};
  return {
    scopeKind: pickEnum(source.scopeKind, POLICY_SCOPES, "global_user"),
    projectId: normalizeString(source.projectId, ""),
    workThreadId: normalizeString(source.workThreadId, ""),
    agentClass: normalizeString(source.agentClass, ""),
    toolFamily: normalizeString(source.toolFamily, ""),
    actionClass: normalizeString(source.actionClass, ""),
  };
}

function scopeMatches(selector, request) {
  if (!isPlainObject(selector)) return true;
  if (selector.actionClass && selector.actionClass !== request.requestedAction.actionClass) return false;
  if (selector.workThreadId && selector.workThreadId !== request.workThreadId) return false;
  if (selector.scopeKind === "action_class") return selector.actionClass === request.requestedAction.actionClass;
  if (selector.scopeKind === "work_thread") return !selector.workThreadId || selector.workThreadId === request.workThreadId;
  return true;
}

function normalizeEvidenceRequirements(values) {
  return (Array.isArray(values) ? values : [])
    .map((value) => {
      if (typeof value === "string") {
        return {
          requirementId: value,
          description: value,
          satisfiedByRefKinds: [value],
        };
      }
      const source = isPlainObject(value) ? value : {};
      const requirementId = normalizeString(source.requirementId || source.id, "");
      if (!requirementId) return null;
      return {
        requirementId,
        description: normalizeString(source.description, requirementId),
        satisfiedByRefKinds: (Array.isArray(source.satisfiedByRefKinds) ? source.satisfiedByRefKinds : [requirementId])
          .map((item) => normalizeString(item, ""))
          .filter(Boolean),
      };
    })
    .filter(Boolean);
}

function validateEvidenceRequirements(values, label) {
  requireArray(values, label);
  for (const [index, requirement] of values.entries()) {
    requirePlainObject(requirement, `${label}.${index}`);
    requireString(requirement.requirementId, `${label}.${index}.requirementId`);
    requireArray(requirement.satisfiedByRefKinds, `${label}.${index}.satisfiedByRefKinds`);
  }
  return true;
}

function buildPolicyExceptionRule(input = {}, options = {}) {
  const source = isPlainObject(input) ? input : {};
  const exception = {
    schema: POLICY_EXCEPTION_RULE_SCHEMA,
    exceptionId: normalizeId(source.exceptionId, "policy_exception"),
    actionClass: requireString(source.actionClass, "policyException.actionClass"),
    beforePosture: pickEnum(source.beforePosture, POLICY_POSTURES, "deny"),
    afterPosture: pickEnum(source.afterPosture, POLICY_POSTURES, "manager_discretion"),
    scopeSelector: normalizeScopeSelector(source.scopeSelector || source),
    evidenceRequirements: normalizeEvidenceRequirements(source.evidenceRequirements),
    rationale: normalizeString(source.rationale, "Policy exception."),
    sourceRefs: normalizeOdeuSourceRefs(source.sourceRefs, options),
    createdAt: normalizeString(source.createdAt, nowIso(options.now || Date.now)),
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  exception.exceptionDigest = digestFor("direct-policy-exception-rule@1", exception);
  return exception;
}

function validatePolicyExceptionRule(exception) {
  requirePlainObject(exception, "policyException");
  if (exception.schema !== POLICY_EXCEPTION_RULE_SCHEMA) {
    throw validationError("direct_constitutional_policy_schema_mismatch", "policyException");
  }
  requireString(exception.exceptionId, "policyException.exceptionId");
  requireString(exception.actionClass, "policyException.actionClass");
  if (!POLICY_POSTURES.includes(exception.beforePosture) || !POLICY_POSTURES.includes(exception.afterPosture)) {
    throw validationError("direct_constitutional_policy_invalid_posture", "policyException");
  }
  validateEvidenceRequirements(exception.evidenceRequirements, "policyException.evidenceRequirements");
  if (exception.rawTextIncluded === true || exception.rawPathIncluded === true || exception.rawSecretIncluded === true) {
    throw validationError("direct_constitutional_policy_raw_exception_exposure", "policyException");
  }
  validateDigest(exception, "exceptionDigest", "direct-policy-exception-rule@1", "policyException");
  return true;
}

function buildConstitutionalPolicyRule(input = {}, options = {}) {
  const source = isPlainObject(input) ? input : {};
  const actionClass = requireString(source.actionClass, "policyRule.actionClass");
  const rule = {
    schema: CONSTITUTIONAL_POLICY_RULE_SCHEMA,
    ruleId: normalizeId(source.ruleId, `policy_rule_${actionClass}`),
    actionClass,
    scopeSelector: normalizeScopeSelector({ actionClass, ...(source.scopeSelector || {}) }),
    defaultPosture: pickEnum(source.defaultPosture, POLICY_POSTURES, "deny"),
    exceptions: (Array.isArray(source.exceptions) ? source.exceptions : [])
      .map((exception) => buildPolicyExceptionRule({ actionClass, ...exception }, options)),
    evidenceRequirements: normalizeEvidenceRequirements(source.evidenceRequirements),
    escalationRule: {
      escalationTarget: normalizeString(source.escalationRule?.escalationTarget || source.escalationTarget, "worldmodel_manager"),
      userConfirmationAllowed: Boolean(source.escalationRule?.userConfirmationAllowed ?? source.userConfirmationAllowed),
      adminModeRequired: Boolean(source.escalationRule?.adminModeRequired ?? source.adminModeRequired),
    },
    rationale: normalizeString(source.rationale, `Policy for ${actionClass}.`),
    sourceRefs: normalizeOdeuSourceRefs(source.sourceRefs, options),
    createdAt: normalizeString(source.createdAt, nowIso(options.now || Date.now)),
    updatedAt: normalizeString(source.updatedAt, nowIso(options.now || Date.now)),
    retired: Boolean(source.retired),
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  rule.ruleDigest = digestFor("direct-constitutional-policy-rule@1", rule);
  return rule;
}

function validateConstitutionalPolicyRule(rule) {
  requirePlainObject(rule, "policyRule");
  if (rule.schema !== CONSTITUTIONAL_POLICY_RULE_SCHEMA) {
    throw validationError("direct_constitutional_policy_schema_mismatch", "policyRule");
  }
  requireString(rule.ruleId, "policyRule.ruleId");
  requireString(rule.actionClass, "policyRule.actionClass");
  if (!POLICY_POSTURES.includes(rule.defaultPosture)) {
    throw validationError("direct_constitutional_policy_invalid_posture", "policyRule.defaultPosture");
  }
  requireArray(rule.exceptions, "policyRule.exceptions");
  rule.exceptions.forEach(validatePolicyExceptionRule);
  validateEvidenceRequirements(rule.evidenceRequirements, "policyRule.evidenceRequirements");
  if (rule.rawTextIncluded === true || rule.rawPathIncluded === true || rule.rawSecretIncluded === true) {
    throw validationError("direct_constitutional_policy_raw_rule_exposure", "policyRule");
  }
  validateDigest(rule, "ruleDigest", "direct-constitutional-policy-rule@1", "policyRule");
  return true;
}

function buildSelfBindingPreferenceRecord(input = {}, options = {}) {
  const source = isPlainObject(input) ? input : {};
  const record = {
    schema: SELF_BINDING_PREFERENCE_RECORD_SCHEMA,
    recordId: normalizeId(source.recordId, "self_binding"),
    userProfileId: normalizeId(source.userProfileId, "user_profile"),
    preferenceKind: pickEnum(source.preferenceKind, SELF_BINDING_KINDS, "custom"),
    scopeSelector: normalizeScopeSelector(source.scopeSelector || source),
    actionClass: normalizeString(source.actionClass, ""),
    standingInstruction: normalizeString(source.standingInstruction, ""),
    defaultPosture: pickEnum(source.defaultPosture, POLICY_POSTURES, "manager_discretion"),
    exceptionSummary: normalizeString(source.exceptionSummary, ""),
    requiresAdminModeToChange: source.requiresAdminModeToChange !== false,
    sourceRefs: normalizeOdeuSourceRefs(source.sourceRefs, options),
    createdAt: normalizeString(source.createdAt, nowIso(options.now || Date.now)),
    updatedAt: normalizeString(source.updatedAt, nowIso(options.now || Date.now)),
    rawUserTextIncluded: false,
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  record.selfBindingDigest = digestFor("direct-self-binding-preference-record@1", record);
  return record;
}

function validateSelfBindingPreferenceRecord(record) {
  requirePlainObject(record, "selfBindingRecord");
  if (record.schema !== SELF_BINDING_PREFERENCE_RECORD_SCHEMA) {
    throw validationError("direct_constitutional_policy_schema_mismatch", "selfBindingRecord");
  }
  requireString(record.recordId, "selfBindingRecord.recordId");
  requireString(record.userProfileId, "selfBindingRecord.userProfileId");
  if (!SELF_BINDING_KINDS.includes(record.preferenceKind)) {
    throw validationError("direct_constitutional_policy_invalid_self_binding_kind", "selfBindingRecord.preferenceKind");
  }
  if (!POLICY_POSTURES.includes(record.defaultPosture)) {
    throw validationError("direct_constitutional_policy_invalid_posture", "selfBindingRecord.defaultPosture");
  }
  if (record.rawUserTextIncluded !== false || record.rawTextIncluded === true || record.rawPathIncluded === true || record.rawSecretIncluded === true) {
    throw validationError("direct_constitutional_policy_raw_self_binding_exposure", "selfBindingRecord");
  }
  validateDigest(record, "selfBindingDigest", "direct-self-binding-preference-record@1", "selfBindingRecord");
  return true;
}

function buildSelfBindingPreferenceParserFixture(input = {}, options = {}) {
  const source = isPlainObject(input) ? input : {};
  const normalizedKind = normalizeString(source.normalizedKind || source.preferenceKind, "avoid_broad_refactor");
  return buildSelfBindingPreferenceRecord({
    userProfileId: source.userProfileId,
    preferenceKind: normalizedKind,
    actionClass: source.actionClass || (normalizedKind === "avoid_broad_refactor" ? "broad_refactor" : ""),
    standingInstruction: source.summary || "Prefer bounded changes unless exception evidence is present.",
    defaultPosture: source.defaultPosture || "explicit_user_confirmation_required",
    exceptionSummary: source.exceptionSummary || "Manager may remand for evidence-backed exception review.",
    sourceRefs: source.sourceRefs,
  }, options);
}

function buildConstitutionalPolicyProfile(input = {}, options = {}) {
  const source = isPlainObject(input) ? input : {};
  const updatedAt = normalizeString(source.updatedAt, nowIso(options.now || Date.now));
  const profile = {
    schema: CONSTITUTIONAL_POLICY_PROFILE_SCHEMA,
    profileId: normalizeId(source.profileId, "constitutional_policy_profile"),
    ownerUserId: normalizeId(source.ownerUserId || source.userProfileId, "user_profile"),
    scope: pickEnum(source.scope, POLICY_SCOPES, "global_user"),
    version: Number.isInteger(source.version) && source.version > 0 ? source.version : 1,
    policies: (Array.isArray(source.policies) ? source.policies : [])
      .map((policy) => buildConstitutionalPolicyRule(policy, options)),
    defaultDecision: pickEnum(source.defaultDecision, DEFAULT_DECISIONS, "manager_discretion"),
    selfBindingRecords: (Array.isArray(source.selfBindingRecords) ? source.selfBindingRecords : [])
      .map((record) => buildSelfBindingPreferenceRecord(record, options)),
    updatedAt,
    sourceRefs: normalizeOdeuSourceRefs(source.sourceRefs, options),
    rawPolicyTextIncluded: false,
    rawUserTextIncluded: false,
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  profile.profileDigest = digestFor("direct-constitutional-policy-profile@1", profile);
  return profile;
}

function validateConstitutionalPolicyProfile(profile) {
  requirePlainObject(profile, "constitutionalPolicyProfile");
  if (profile.schema !== CONSTITUTIONAL_POLICY_PROFILE_SCHEMA) {
    throw validationError("direct_constitutional_policy_schema_mismatch", "constitutionalPolicyProfile");
  }
  requireString(profile.profileId, "constitutionalPolicyProfile.profileId");
  requireString(profile.ownerUserId, "constitutionalPolicyProfile.ownerUserId");
  if (!POLICY_SCOPES.includes(profile.scope)) {
    throw validationError("direct_constitutional_policy_invalid_scope", "constitutionalPolicyProfile.scope");
  }
  if (!Number.isInteger(profile.version) || profile.version < 1) {
    throw validationError("direct_constitutional_policy_invalid_version", "constitutionalPolicyProfile.version");
  }
  requireArray(profile.policies, "constitutionalPolicyProfile.policies");
  profile.policies.forEach(validateConstitutionalPolicyRule);
  if (!DEFAULT_DECISIONS.includes(profile.defaultDecision)) {
    throw validationError("direct_constitutional_policy_invalid_default_decision", "constitutionalPolicyProfile.defaultDecision");
  }
  requireArray(profile.selfBindingRecords, "constitutionalPolicyProfile.selfBindingRecords");
  profile.selfBindingRecords.forEach(validateSelfBindingPreferenceRecord);
  if (profile.rawPolicyTextIncluded !== false || profile.rawUserTextIncluded !== false || profile.rawTextIncluded === true || profile.rawPathIncluded === true || profile.rawSecretIncluded === true) {
    throw validationError("direct_constitutional_policy_raw_profile_exposure", "constitutionalPolicyProfile");
  }
  validateDigest(profile, "profileDigest", "direct-constitutional-policy-profile@1", "constitutionalPolicyProfile");
  return true;
}

function buildPolicyProfileStore(input = {}, options = {}) {
  const source = isPlainObject(input) ? input : {};
  const profiles = (Array.isArray(source.profiles) ? source.profiles : [])
    .map((profile) => buildConstitutionalPolicyProfile(profile, options));
  const store = {
    schema: POLICY_PROFILE_STORE_SCHEMA,
    storeId: normalizeId(source.storeId, "constitutional_policy_store"),
    profiles,
    currentProfileRefs: profiles.map(profileRef),
    updatedAt: normalizeString(source.updatedAt, nowIso(options.now || Date.now)),
    rawPolicyTextIncluded: false,
    rawUserTextIncluded: false,
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  store.storeDigest = digestFor("direct-constitutional-policy-profile-store@1", store);
  return store;
}

function validatePolicyProfileStore(store) {
  requirePlainObject(store, "policyProfileStore");
  if (store.schema !== POLICY_PROFILE_STORE_SCHEMA) {
    throw validationError("direct_constitutional_policy_schema_mismatch", "policyProfileStore");
  }
  requireString(store.storeId, "policyProfileStore.storeId");
  requireArray(store.profiles, "policyProfileStore.profiles");
  store.profiles.forEach(validateConstitutionalPolicyProfile);
  requireArray(store.currentProfileRefs, "policyProfileStore.currentProfileRefs");
  store.currentProfileRefs.forEach((ref, index) => validateRef(ref, `policyProfileStore.currentProfileRefs.${index}`));
  if (store.rawPolicyTextIncluded !== false || store.rawUserTextIncluded !== false || store.rawTextIncluded === true || store.rawPathIncluded === true || store.rawSecretIncluded === true) {
    throw validationError("direct_constitutional_policy_raw_store_exposure", "policyProfileStore");
  }
  validateDigest(store, "storeDigest", "direct-constitutional-policy-profile-store@1", "policyProfileStore");
  return true;
}

function evidenceSatisfied(requirement, request) {
  const evidenceRefs = Array.isArray(request.evidenceRefs) ? request.evidenceRefs : [];
  const acceptable = new Set(requirement.satisfiedByRefKinds);
  return evidenceRefs.some((ref) => acceptable.has(ref.kind) || acceptable.has(ref.id));
}

function selectDominantPosture(postures) {
  return postures.reduce((dominant, posture) => (
    POSTURE_RANK[posture] > POSTURE_RANK[dominant] ? posture : dominant
  ), "allow");
}

function buildConstitutionalPolicyResolutionTrace(input = {}, options = {}) {
  const source = isPlainObject(input) ? input : {};
  const profile = source.profile || source.policyProfile;
  const request = source.request;
  validateConstitutionalPolicyProfile(profile);
  validateAuthorizationRequest(request);
  const defaultPosture = DEFAULT_DECISION_TO_POSTURE[profile.defaultDecision] || "manager_discretion";
  const matchingRules = profile.policies
    .filter((rule) => !rule.retired)
    .filter((rule) => rule.actionClass === request.requestedAction.actionClass)
    .filter((rule) => scopeMatches(rule.scopeSelector, request));
  const matchedPolicyRefs = matchingRules.map(ruleRef);
  const postures = matchingRules.length ? matchingRules.map((rule) => rule.defaultPosture) : [defaultPosture];
  let dominantPosture = selectDominantPosture(postures);
  const missingEvidence = [];
  let exceptionApplied = null;
  for (const rule of matchingRules) {
    for (const requirement of rule.evidenceRequirements) {
      if (!evidenceSatisfied(requirement, request)) {
        missingEvidence.push({
          requirementId: requirement.requirementId,
          actionClass: rule.actionClass,
          satisfied: false,
        });
      }
    }
    for (const exception of rule.exceptions) {
      const exceptionMatches = scopeMatches(exception.scopeSelector, request)
        && exception.beforePosture === dominantPosture
        && exception.evidenceRequirements.every((requirement) => evidenceSatisfied(requirement, request));
      if (exceptionMatches) {
        exceptionApplied = {
          exceptionRef: exceptionRef(exception),
          beforePosture: dominantPosture,
          afterPosture: exception.afterPosture,
          evidenceRefs: normalizeRefs(request.evidenceRefs, "authorization_evidence"),
        };
        dominantPosture = exception.afterPosture;
      } else {
        for (const requirement of exception.evidenceRequirements) {
          if (!evidenceSatisfied(requirement, request)) {
            missingEvidence.push({
              requirementId: requirement.requirementId,
              actionClass: exception.actionClass,
              exceptionId: exception.exceptionId,
              satisfied: false,
            });
          }
        }
      }
    }
  }
  const trace = {
    schema: CONSTITUTIONAL_POLICY_RESOLUTION_TRACE_SCHEMA,
    traceId: normalizeId(source.traceId, "constitutional_policy_trace"),
    requestId: request.requestId,
    policyProfileRef: profileRef(profile),
    matchedPolicyRefs,
    defaultPolicyRef: profileRef(profile),
    dominantPosture,
    exceptionApplied,
    evidenceSatisfied: missingEvidence.length === 0,
    missingEvidence,
    precedenceOrder: ["deny", "admin_mode_required", "explicit_user_confirmation_required", "manager_discretion", "allow"],
    rationale: normalizeString(source.rationale, matchingRules.length
      ? `Resolved ${request.requestedAction.actionClass} from constitutional policy rules.`
      : `Resolved ${request.requestedAction.actionClass} from profile default decision.`),
    evaluatedAt: normalizeString(source.evaluatedAt, nowIso(options.now || Date.now)),
    shadowOnly: true,
    rawPolicyLedgerExposed: false,
    rawUserTextIncluded: false,
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  trace.traceDigest = digestFor("direct-constitutional-policy-resolution-trace@1", trace);
  return trace;
}

function validateConstitutionalPolicyResolutionTrace(trace) {
  requirePlainObject(trace, "constitutionalPolicyTrace");
  if (trace.schema !== CONSTITUTIONAL_POLICY_RESOLUTION_TRACE_SCHEMA) {
    throw validationError("direct_constitutional_policy_schema_mismatch", "constitutionalPolicyTrace");
  }
  requireString(trace.traceId, "constitutionalPolicyTrace.traceId");
  requireString(trace.requestId, "constitutionalPolicyTrace.requestId");
  validateRef(trace.policyProfileRef, "constitutionalPolicyTrace.policyProfileRef");
  requireArray(trace.matchedPolicyRefs, "constitutionalPolicyTrace.matchedPolicyRefs");
  trace.matchedPolicyRefs.forEach((ref, index) => validateRef(ref, `constitutionalPolicyTrace.matchedPolicyRefs.${index}`));
  if (!POLICY_POSTURES.includes(trace.dominantPosture)) {
    throw validationError("direct_constitutional_policy_invalid_posture", "constitutionalPolicyTrace.dominantPosture");
  }
  requireArray(trace.missingEvidence, "constitutionalPolicyTrace.missingEvidence");
  if (trace.shadowOnly !== true || trace.rawPolicyLedgerExposed !== false || trace.rawUserTextIncluded !== false || trace.rawTextIncluded === true || trace.rawPathIncluded === true || trace.rawSecretIncluded === true) {
    throw validationError("direct_constitutional_policy_raw_trace_exposure", "constitutionalPolicyTrace");
  }
  validateDigest(trace, "traceDigest", "direct-constitutional-policy-resolution-trace@1", "constitutionalPolicyTrace");
  return true;
}

function buildAdminModePolicyUpdate(input = {}, options = {}) {
  const source = isPlainObject(input) ? input : {};
  if (source.userRoleState !== "admin_mode") {
    throw validationError("direct_constitutional_policy_admin_mode_required", "adminModePolicyUpdate.userRoleState");
  }
  const update = {
    schema: ADMIN_MODE_POLICY_UPDATE_SCHEMA,
    updateId: normalizeId(source.updateId, "admin_policy_update"),
    policyProfileId: requireString(source.policyProfileId, "adminModePolicyUpdate.policyProfileId"),
    userRoleState: "admin_mode",
    changeKind: pickEnum(source.changeKind, CHANGE_KINDS, "modify_policy"),
    actionClass: requireString(source.actionClass, "adminModePolicyUpdate.actionClass"),
    beforeDigest: normalizeString(source.beforeDigest, ""),
    afterDigest: requireString(source.afterDigest, "adminModePolicyUpdate.afterDigest"),
    expectedBenefits: (Array.isArray(source.expectedBenefits) ? source.expectedBenefits : [])
      .map((item) => normalizeString(item, ""))
      .filter(Boolean),
    failureModes: (Array.isArray(source.failureModes) ? source.failureModes : [])
      .map((item) => normalizeString(item, ""))
      .filter(Boolean),
    exceptionRules: (Array.isArray(source.exceptionRules) ? source.exceptionRules : [])
      .map((exception) => buildPolicyExceptionRule({ actionClass: source.actionClass, ...exception }, options)),
    futureAutomationAllowed: Boolean(source.futureAutomationAllowed),
    futureEscalationRequiredWhen: (Array.isArray(source.futureEscalationRequiredWhen) ? source.futureEscalationRequiredWhen : [])
      .map((item) => normalizeString(item, ""))
      .filter(Boolean),
    sourceRefs: normalizeOdeuSourceRefs(source.sourceRefs, options),
    createdAt: normalizeString(source.createdAt, nowIso(options.now || Date.now)),
    rawUserTextIncluded: false,
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  update.updateDigest = digestFor("direct-admin-mode-policy-update@1", update);
  return update;
}

function validateAdminModePolicyUpdate(update) {
  requirePlainObject(update, "adminModePolicyUpdate");
  if (update.schema !== ADMIN_MODE_POLICY_UPDATE_SCHEMA) {
    throw validationError("direct_constitutional_policy_schema_mismatch", "adminModePolicyUpdate");
  }
  requireString(update.updateId, "adminModePolicyUpdate.updateId");
  requireString(update.policyProfileId, "adminModePolicyUpdate.policyProfileId");
  if (update.userRoleState !== "admin_mode") {
    throw validationError("direct_constitutional_policy_admin_mode_required", "adminModePolicyUpdate.userRoleState");
  }
  if (!CHANGE_KINDS.includes(update.changeKind)) {
    throw validationError("direct_constitutional_policy_invalid_change_kind", "adminModePolicyUpdate.changeKind");
  }
  requireString(update.actionClass, "adminModePolicyUpdate.actionClass");
  requireString(update.afterDigest, "adminModePolicyUpdate.afterDigest");
  requireArray(update.expectedBenefits, "adminModePolicyUpdate.expectedBenefits");
  requireArray(update.failureModes, "adminModePolicyUpdate.failureModes");
  requireArray(update.exceptionRules, "adminModePolicyUpdate.exceptionRules");
  update.exceptionRules.forEach(validatePolicyExceptionRule);
  if (update.rawUserTextIncluded !== false || update.rawTextIncluded === true || update.rawPathIncluded === true || update.rawSecretIncluded === true) {
    throw validationError("direct_constitutional_policy_raw_update_exposure", "adminModePolicyUpdate");
  }
  validateDigest(update, "updateDigest", "direct-admin-mode-policy-update@1", "adminModePolicyUpdate");
  return true;
}

function buildChildPolicyBoundaryWitness(input = {}, options = {}) {
  const source = isPlainObject(input) ? input : {};
  const parentProfile = source.parentProfile;
  const childProfile = source.childProfile;
  const adminUpdate = source.adminUpdate;
  validateConstitutionalPolicyProfile(parentProfile);
  validateConstitutionalPolicyProfile(childProfile);
  if (adminUpdate) validateAdminModePolicyUpdate(adminUpdate);
  const parentRules = new Map(parentProfile.policies.map((rule) => [rule.actionClass, rule]));
  const broadeningRows = [];
  for (const childRule of childProfile.policies) {
    const parentRule = parentRules.get(childRule.actionClass);
    const parentPosture = parentRule ? parentRule.defaultPosture : DEFAULT_DECISION_TO_POSTURE[parentProfile.defaultDecision];
    if (POSTURE_RANK[childRule.defaultPosture] < POSTURE_RANK[parentPosture]) {
      broadeningRows.push({
        actionClass: childRule.actionClass,
        parentPosture,
        childPosture: childRule.defaultPosture,
        reason: "child_policy_broadens_parent_policy",
      });
    }
  }
  const witness = {
    schema: CHILD_POLICY_BOUNDARY_WITNESS_SCHEMA,
    witnessId: normalizeId(source.witnessId, "child_policy_boundary"),
    parentProfileRef: profileRef(parentProfile),
    childProfileRef: profileRef(childProfile),
    adminUpdateRef: adminUpdate ? refFromDigest("admin_mode_policy_update", adminUpdate.updateId, adminUpdate.updateDigest, adminUpdate.changeKind) : null,
    broadeningRows,
    blocksPromotion: broadeningRows.length > 0 && !adminUpdate,
    decision: broadeningRows.length === 0 ? "same_or_narrower" : adminUpdate ? "admin_authorized_broadening" : "blocked_child_broadening",
    checkedAt: normalizeString(source.checkedAt, nowIso(options.now || Date.now)),
    rawPolicyLedgerExposed: false,
    rawUserTextIncluded: false,
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  witness.boundaryWitnessDigest = digestFor("direct-child-policy-boundary-witness@1", witness);
  return witness;
}

function validateChildPolicyBoundaryWitness(witness) {
  requirePlainObject(witness, "childPolicyBoundaryWitness");
  if (witness.schema !== CHILD_POLICY_BOUNDARY_WITNESS_SCHEMA) {
    throw validationError("direct_constitutional_policy_schema_mismatch", "childPolicyBoundaryWitness");
  }
  requireString(witness.witnessId, "childPolicyBoundaryWitness.witnessId");
  validateRef(witness.parentProfileRef, "childPolicyBoundaryWitness.parentProfileRef");
  validateRef(witness.childProfileRef, "childPolicyBoundaryWitness.childProfileRef");
  if (witness.adminUpdateRef) validateRef(witness.adminUpdateRef, "childPolicyBoundaryWitness.adminUpdateRef");
  requireArray(witness.broadeningRows, "childPolicyBoundaryWitness.broadeningRows");
  if (witness.rawPolicyLedgerExposed !== false || witness.rawUserTextIncluded !== false || witness.rawTextIncluded === true || witness.rawPathIncluded === true || witness.rawSecretIncluded === true) {
    throw validationError("direct_constitutional_policy_raw_boundary_witness_exposure", "childPolicyBoundaryWitness");
  }
  validateDigest(witness, "boundaryWitnessDigest", "direct-child-policy-boundary-witness@1", "childPolicyBoundaryWitness");
  return true;
}

module.exports = {
  ADMIN_MODE_POLICY_UPDATE_SCHEMA,
  CHILD_POLICY_BOUNDARY_WITNESS_SCHEMA,
  CONSTITUTIONAL_POLICY_PROFILE_SCHEMA,
  CONSTITUTIONAL_POLICY_RESOLUTION_TRACE_SCHEMA,
  CONSTITUTIONAL_POLICY_RULE_SCHEMA,
  POLICY_EXCEPTION_RULE_SCHEMA,
  POLICY_PROFILE_STORE_SCHEMA,
  SELF_BINDING_PREFERENCE_RECORD_SCHEMA,
  buildAdminModePolicyUpdate,
  buildChildPolicyBoundaryWitness,
  buildConstitutionalPolicyProfile,
  buildConstitutionalPolicyResolutionTrace,
  buildConstitutionalPolicyRule,
  buildPolicyExceptionRule,
  buildPolicyProfileStore,
  buildSelfBindingPreferenceParserFixture,
  buildSelfBindingPreferenceRecord,
  validateAdminModePolicyUpdate,
  validateChildPolicyBoundaryWitness,
  validateConstitutionalPolicyProfile,
  validateConstitutionalPolicyResolutionTrace,
  validateConstitutionalPolicyRule,
  validatePolicyExceptionRule,
  validatePolicyProfileStore,
  validateSelfBindingPreferenceRecord,
};
