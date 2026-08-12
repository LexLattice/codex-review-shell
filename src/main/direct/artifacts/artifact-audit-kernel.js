"use strict";

const crypto = require("node:crypto");

const ARTIFACT_AUDIT_POLICY_SCHEMA = "direct_artifact_audit_policy@1";
const ARTIFACT_AUDIT_EVENT_SCHEMA = "direct_artifact_audit_event@1";
const ARTIFACT_AUDIT_ROUTE_PLAN_SCHEMA = "direct_artifact_audit_route_plan@1";
const ARTIFACT_AUDIT_PROJECTION_SCHEMA = "direct_artifact_audit_projection@1";

const RIGHTS = Object.freeze(["read", "propose", "challenge", "admit", "subscribe"]);
const STATES = Object.freeze([
  "requested",
  "under_production",
  "candidate",
  "under_audit",
  "supported",
  "requires_revision",
  "contradicted",
  "admitted",
  "rejected",
  "remanded",
]);
const AUDIT_VERDICTS = Object.freeze(["supported", "requires_revision", "contradicted"]);
const EVIDENCE_KINDS = Object.freeze([
  "workspace_worker_terminal",
  "artifact_blob",
  "test_report",
  "audit_observation",
]);
const RAW_KEY = /(?:prompt|path|provider|payload|transcript|command|stdout|stderr)/i;
const PATH_TEXT = /[\\/]/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;

function fail(code, detail = "") {
  const error = new Error(detail ? `${code}:${detail}` : code);
  error.code = code;
  if (detail) error.detail = detail;
  throw error;
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactObject(value, fields, code) {
  if (!isObject(value)) fail(code);
  const keys = Object.keys(value).sort();
  if (JSON.stringify(keys) !== JSON.stringify([...fields].sort())) fail(code);
  return value;
}

function requiredId(value, label) {
  if (typeof value !== "string" || !ID.test(value)) fail("artifact_audit_id_invalid", label);
  return value;
}

function requiredDigest(value, label) {
  if (typeof value !== "string" || !DIGEST.test(value)) fail("artifact_audit_digest_invalid", label);
  return value;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isObject(value)) return value;
  const result = {};
  for (const key of Object.keys(value).sort()) result[key] = canonicalize(value[key]);
  return result;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function digestFor(domain, value) {
  return `sha256:${crypto.createHash("sha256").update(`${domain}\n${canonicalJson(value)}`).digest("hex")}`;
}

function assertNoRawExposure(value, label = "input") {
  const visit = (current, location) => {
    if (typeof current === "string") {
      if (PATH_TEXT.test(current)) fail("artifact_audit_raw_exposure", location);
      return;
    }
    if (Array.isArray(current)) {
      current.forEach((entry, index) => visit(entry, `${location}[${index}]`));
      return;
    }
    if (!isObject(current)) return;
    for (const [key, entry] of Object.entries(current)) {
      if (RAW_KEY.test(key)) fail("artifact_audit_raw_exposure", `${location}.${key}`);
      visit(entry, `${location}.${key}`);
    }
  };
  visit(value, label);
}

function sortedUniqueIds(values, label) {
  if (!Array.isArray(values) || !values.length) fail("artifact_audit_role_set_required", label);
  const normalized = values.map((value) => requiredId(value, label));
  if (new Set(normalized).size !== normalized.length) fail("artifact_audit_duplicate_identity", label);
  return normalized.sort();
}

function normalizeActor(input) {
  exactObject(input, ["actorId", "roleId"], "artifact_audit_actor_invalid");
  return {
    actorId: requiredId(input.actorId, "actorId"),
    roleId: requiredId(input.roleId, "roleId"),
  };
}

function normalizeRole(input) {
  exactObject(input, ["roleId", "actors", "rights"], "artifact_audit_role_invalid");
  const rights = sortedUniqueIds(input.rights, `${input.roleId}.rights`);
  if (rights.some((right) => !RIGHTS.includes(right))) fail("artifact_audit_right_invalid", input.roleId);
  return {
    roleId: requiredId(input.roleId, "roleId"),
    actors: sortedUniqueIds(input.actors, `${input.roleId}.actors`),
    rights,
  };
}

function buildPolicySnapshot(input) {
  assertNoRawExposure(input, "policy");
  const allowed = [
    "artifactClassId", "projectId", "managerRoleId", "roles", "producerRoleIds",
    "auditRequirements", "admissionRoleId", "allowedEvidenceKinds", "revision",
  ];
  exactObject(input, allowed, "artifact_audit_policy_shape_invalid");
  const roles = input.roles.map(normalizeRole).sort((a, b) => a.roleId.localeCompare(b.roleId));
  if (new Set(roles.map((role) => role.roleId)).size !== roles.length) fail("artifact_audit_duplicate_role");
  const roleIds = new Set(roles.map((role) => role.roleId));
  const producerRoleIds = sortedUniqueIds(input.producerRoleIds, "producerRoleIds");
  const managerRoleId = requiredId(input.managerRoleId, "managerRoleId");
  const admissionRoleId = requiredId(input.admissionRoleId, "admissionRoleId");
  for (const roleId of [...producerRoleIds, managerRoleId, admissionRoleId]) {
    if (!roleIds.has(roleId)) fail("artifact_audit_role_unknown", roleId);
  }
  if (!Array.isArray(input.auditRequirements) || !input.auditRequirements.length) {
    fail("artifact_audit_requirement_missing");
  }
  const auditRequirements = input.auditRequirements.map((requirement) => {
    exactObject(requirement, ["requirementId", "auditorRoleIds", "separationRequired", "evidenceKinds"], "artifact_audit_requirement_invalid");
    const auditorRoleIds = sortedUniqueIds(requirement.auditorRoleIds, `${requirement.requirementId}.auditorRoleIds`);
    for (const roleId of auditorRoleIds) if (!roleIds.has(roleId)) fail("artifact_audit_role_unknown", roleId);
    const evidenceKinds = sortedUniqueIds(requirement.evidenceKinds, `${requirement.requirementId}.evidenceKinds`);
    if (evidenceKinds.some((kind) => !EVIDENCE_KINDS.includes(kind))) fail("artifact_audit_evidence_kind_invalid");
    return {
      requirementId: requiredId(requirement.requirementId, "requirementId"),
      auditorRoleIds,
      separationRequired: requirement.separationRequired === true,
      evidenceKinds,
    };
  }).sort((a, b) => a.requirementId.localeCompare(b.requirementId));
  if (new Set(auditRequirements.map((entry) => entry.requirementId)).size !== auditRequirements.length) {
    fail("artifact_audit_duplicate_requirement");
  }
  const auditorRoleIds = new Set(auditRequirements.flatMap((entry) => entry.auditorRoleIds));
  if (producerRoleIds.some((roleId) => auditorRoleIds.has(roleId)) ||
      producerRoleIds.includes(admissionRoleId) || auditorRoleIds.has(admissionRoleId)) {
    fail("artifact_audit_role_separation_invalid");
  }
  const allowedEvidenceKinds = sortedUniqueIds(input.allowedEvidenceKinds, "allowedEvidenceKinds");
  if (allowedEvidenceKinds.some((kind) => !EVIDENCE_KINDS.includes(kind))) fail("artifact_audit_evidence_kind_invalid");
  const snapshot = {
    schema: ARTIFACT_AUDIT_POLICY_SCHEMA,
    artifactClassId: requiredId(input.artifactClassId, "artifactClassId"),
    projectId: requiredId(input.projectId, "projectId"),
    revision: Number(input.revision),
    managerRoleId,
    roles,
    producerRoleIds,
    auditRequirements,
    admissionRoleId,
    allowedEvidenceKinds,
  };
  if (!Number.isSafeInteger(snapshot.revision) || snapshot.revision < 1) fail("artifact_audit_policy_revision_invalid");
  snapshot.policyDigest = digestFor(ARTIFACT_AUDIT_POLICY_SCHEMA, snapshot);
  return Object.freeze(snapshot);
}

function assertAuthorized(policy, actorInput, right, eligibleRoleIds = null) {
  const actor = normalizeActor(actorInput);
  const role = policy.roles.find((entry) => entry.roleId === actor.roleId);
  if (!role || !role.actors.includes(actor.actorId)) fail("artifact_audit_role_forgery", actor.actorId);
  if (!role.rights.includes(right)) fail("artifact_audit_right_denied", right);
  if (eligibleRoleIds && !eligibleRoleIds.includes(actor.roleId)) fail("artifact_audit_role_ineligible", actor.roleId);
  return actor;
}

function normalizeScope(input, options = {}) {
  const fields = ["projectId", "workThreadId", "artifactId", "artifactClassId"];
  if (options.revision) fields.push("revision");
  exactObject(input, fields, "artifact_audit_scope_invalid");
  const scope = {
    projectId: requiredId(input.projectId, "projectId"),
    workThreadId: requiredId(input.workThreadId, "workThreadId"),
    artifactId: requiredId(input.artifactId, "artifactId"),
    artifactClassId: requiredId(input.artifactClassId, "artifactClassId"),
  };
  if (options.revision) {
    scope.revision = Number(input.revision);
    if (!Number.isSafeInteger(scope.revision) || scope.revision < 1) fail("artifact_audit_revision_invalid");
  }
  return scope;
}

function normalizeEvidenceRef(input, expectedScope, allowedKinds) {
  exactObject(input, ["kind", "id", "digest", "projectId", "workThreadId", "artifactId", "revision"], "artifact_audit_evidence_ref_invalid");
  const ref = {
    kind: requiredId(input.kind, "evidence.kind"),
    id: requiredId(input.id, "evidence.id"),
    digest: requiredDigest(input.digest, "evidence.digest"),
    projectId: requiredId(input.projectId, "evidence.projectId"),
    workThreadId: requiredId(input.workThreadId, "evidence.workThreadId"),
    artifactId: requiredId(input.artifactId, "evidence.artifactId"),
    revision: Number(input.revision),
  };
  if (!EVIDENCE_KINDS.includes(ref.kind) || !allowedKinds.includes(ref.kind)) fail("artifact_audit_evidence_kind_invalid", ref.kind);
  if (!Number.isSafeInteger(ref.revision) || ref.revision < 1) fail("artifact_audit_revision_invalid");
  for (const field of ["projectId", "workThreadId", "artifactId", "revision"]) {
    if (ref[field] !== expectedScope[field]) fail("artifact_audit_cross_scope_ref", field);
  }
  return ref;
}

function normalizeEvidenceRefs(values, expectedScope, allowedKinds) {
  if (!Array.isArray(values) || !values.length) fail("artifact_audit_evidence_missing");
  const refs = values.map((value) => normalizeEvidenceRef(value, expectedScope, allowedKinds));
  const keys = refs.map((ref) => `${ref.kind}:${ref.id}:${ref.digest}`);
  if (new Set(keys).size !== keys.length) fail("artifact_audit_duplicate_evidence");
  return refs.sort((a, b) => canonicalJson(a).localeCompare(canonicalJson(b)));
}

function compileArtifactRoutingPlan(policyInput, scopeInput) {
  const policy = policyInput.schema === ARTIFACT_AUDIT_POLICY_SCHEMA ? policyInput : buildPolicySnapshot(policyInput);
  const scope = normalizeScope(scopeInput);
  if (scope.projectId !== policy.projectId || scope.artifactClassId !== policy.artifactClassId) {
    fail("artifact_audit_policy_scope_mismatch");
  }
  const actorsFor = (roleIds, right) => policy.roles
    .filter((role) => roleIds.includes(role.roleId) && role.rights.includes(right))
    .flatMap((role) => role.actors.map((actorId) => ({ actorId, roleId: role.roleId })))
    .sort((a, b) => canonicalJson(a).localeCompare(canonicalJson(b)));
  const plan = {
    schema: ARTIFACT_AUDIT_ROUTE_PLAN_SCHEMA,
    scope,
    policyRef: { id: policy.artifactClassId, digest: policy.policyDigest },
    producer: {
      requiredRight: "propose",
      eligibleActors: actorsFor(policy.producerRoleIds, "propose"),
    },
    audits: policy.auditRequirements.map((requirement) => ({
      requirementId: requirement.requirementId,
      requiredRight: "challenge",
      separationRequired: requirement.separationRequired,
      eligibleActors: actorsFor(requirement.auditorRoleIds, "challenge"),
    })),
    admission: {
      requiredRight: "admit",
      eligibleActors: actorsFor([policy.admissionRoleId], "admit"),
    },
    launchesProviders: false,
  };
  if (!plan.producer.eligibleActors.length || plan.audits.some((audit) => !audit.eligibleActors.length) || !plan.admission.eligibleActors.length) {
    fail("artifact_audit_route_unfillable");
  }
  plan.planDigest = digestFor(ARTIFACT_AUDIT_ROUTE_PLAN_SCHEMA, plan);
  return plan;
}

function buildEvent(input) {
  const event = {
    schema: ARTIFACT_AUDIT_EVENT_SCHEMA,
    eventId: requiredId(input.eventId, "eventId"),
    sequence: Number(input.sequence),
    eventType: requiredId(input.eventType, "eventType"),
    scope: normalizeScope(input.scope, { revision: true }),
    policyRef: {
      id: requiredId(input.policyRef?.id, "policyRef.id"),
      digest: requiredDigest(input.policyRef?.digest, "policyRef.digest"),
    },
    actor: normalizeActor(input.actor),
    stateFrom: input.stateFrom === null ? null : input.stateFrom,
    stateTo: input.stateTo,
    evidenceRefs: input.evidenceRefs || [],
    occurredAt: input.occurredAt,
    authorityDomain: "direct_workbench_artifact_audit",
    canonicalProjectTruth: false,
  };
  if (event.stateFrom !== null && !STATES.includes(event.stateFrom)) fail("artifact_audit_state_invalid");
  if (!STATES.includes(event.stateTo)) fail("artifact_audit_state_invalid");
  if (!Number.isSafeInteger(event.sequence) || event.sequence < 1) fail("artifact_audit_sequence_invalid");
  if (typeof event.occurredAt !== "string" || !event.occurredAt) fail("artifact_audit_time_invalid");
  if (input.audit) event.audit = input.audit;
  if (input.decision) event.decision = input.decision;
  event.eventDigest = digestFor(ARTIFACT_AUDIT_EVENT_SCHEMA, event);
  return event;
}

function safeTransitionProjection(subscription, events) {
  const selected = events.filter((event) =>
    event.sequence > subscription.afterSequence &&
    event.scope.projectId === subscription.projectId &&
    (!subscription.workThreadId || event.scope.workThreadId === subscription.workThreadId) &&
    (!subscription.artifactId || event.scope.artifactId === subscription.artifactId) &&
    event.scope.artifactClassId === subscription.artifactClassId &&
    subscription.eventTypes.includes(event.eventType));
  const transitions = selected.slice(0, subscription.limit).map((event) => {
    const transition = {
      sequence: event.sequence,
      eventId: event.eventId,
      eventDigest: event.eventDigest,
      eventType: event.eventType,
      scope: event.scope,
      policyRef: event.policyRef,
      stateFrom: event.stateFrom,
      stateTo: event.stateTo,
      evidenceRefs: event.evidenceRefs,
      occurredAt: event.occurredAt,
      authorityDomain: event.authorityDomain,
      canonicalProjectTruth: false,
    };
    if (event.audit) transition.audit = event.audit;
    if (event.decision) transition.decision = event.decision;
    return transition;
  });
  return {
    schema: ARTIFACT_AUDIT_PROJECTION_SCHEMA,
    subscriptionId: subscription.subscriptionId,
    afterSequence: subscription.afterSequence,
    nextSequence: transitions.length ? transitions.at(-1).sequence : subscription.afterSequence,
    transitions,
    truncated: selected.length > transitions.length,
    deliveryMode: "passive_poll",
    activeWorkerMessageCount: 0,
  };
}

module.exports = {
  ARTIFACT_AUDIT_EVENT_SCHEMA,
  ARTIFACT_AUDIT_POLICY_SCHEMA,
  ARTIFACT_AUDIT_PROJECTION_SCHEMA,
  ARTIFACT_AUDIT_ROUTE_PLAN_SCHEMA,
  AUDIT_VERDICTS,
  EVIDENCE_KINDS,
  RIGHTS,
  STATES,
  assertAuthorized,
  assertNoRawExposure,
  buildEvent,
  buildPolicySnapshot,
  canonicalJson,
  compileArtifactRoutingPlan,
  digestFor,
  fail,
  normalizeActor,
  normalizeEvidenceRefs,
  normalizeScope,
  safeTransitionProjection,
};
