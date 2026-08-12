"use strict";

const crypto = require("node:crypto");

const ARTIFACT_AUDIT_POLICY_SCHEMA = "direct_artifact_audit_policy@2";
const ARTIFACT_AUDIT_EVENT_SCHEMA = "direct_artifact_audit_event@3";
const ARTIFACT_AUDIT_EVIDENCE_SCHEMA = "direct_artifact_audit_evidence@1";
const ARTIFACT_AUDIT_EVIDENCE_RECEIPT_SCHEMA = "direct_artifact_audit_evidence_receipt@1";
const ARTIFACT_AUDIT_PRINCIPAL_SCHEMA = "direct_artifact_audit_principal@1";
const ARTIFACT_AUDIT_ROUTE_PLAN_SCHEMA = "direct_artifact_audit_route_plan@2";
const ARTIFACT_AUDIT_PROJECTION_SCHEMA = "direct_artifact_audit_projection@1";

const RIGHTS = Object.freeze(["read", "propose", "challenge", "admit", "subscribe"]);
const PRINCIPAL_PURPOSES = Object.freeze(["declare", "act", "admin_read", "register_evidence"]);
const STATES = Object.freeze([
  "requested", "under_production", "candidate", "under_audit", "supported",
  "requires_revision", "contradicted", "admitted", "rejected", "remanded",
]);
const AUDIT_VERDICTS = Object.freeze(["supported", "requires_revision", "contradicted"]);
const EVIDENCE_KINDS = Object.freeze([
  "workspace_worker_terminal", "artifact_blob", "test_report", "audit_observation",
]);
const RAW_KEY = /(?:prompt|path|provider|payload|transcript|command|stdout|stderr|body|content)/i;
const PATH_TEXT = /[\\/]/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const PRINCIPAL_RECORDS = new WeakMap();
const AUTHORITY_RECORDS = new WeakMap();
const EVIDENCE_RECEIPT_AUTHORITY_RECORDS = new WeakMap();
const EVIDENCE_RECEIPT_RECORDS = new WeakMap();

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

function deepFreeze(value, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const entry of Object.values(value)) deepFreeze(entry, seen);
  return Object.freeze(value);
}

function assertNoRawExposure(value, label = "input") {
  const seen = new Set();
  const visit = (current, location) => {
    if (typeof current === "string") {
      if (PATH_TEXT.test(current)) fail("artifact_audit_raw_exposure", location);
      return;
    }
    if (Array.isArray(current)) {
      current.forEach((entry, index) => visit(entry, `${location}[${index}]`));
      return;
    }
    if (!isObject(current) || seen.has(current)) return;
    seen.add(current);
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

function createArtifactAuditPrincipalAuthority(input = {}) {
  exactObject(input, ["authorityId", "bindings"], "artifact_audit_authority_invalid");
  const authorityId = requiredId(input.authorityId, "authorityId");
  if (!Array.isArray(input.bindings) || !input.bindings.length) fail("artifact_audit_authority_binding_missing");
  const bindings = input.bindings.map((binding) => {
    exactObject(binding, ["projectId", "artifactClassId", "policyDigest", "actorId", "roleId", "purposes"], "artifact_audit_authority_binding_invalid");
    const normalized = {
      projectId: requiredId(binding.projectId, "projectId"),
      artifactClassId: requiredId(binding.artifactClassId, "artifactClassId"),
      policyDigest: requiredDigest(binding.policyDigest, "policyDigest"),
      actorId: requiredId(binding.actorId, "actorId"),
      roleId: requiredId(binding.roleId, "roleId"),
      purposes: sortedUniqueIds(binding.purposes, "purposes"),
    };
    if (normalized.purposes.some((purpose) => !PRINCIPAL_PURPOSES.includes(purpose))) {
      fail("artifact_audit_principal_purpose_invalid");
    }
    return normalized;
  }).sort((a, b) => canonicalJson(a).localeCompare(canonicalJson(b)));
  const identityKeys = bindings.flatMap((binding) => binding.purposes.map((purpose) =>
    canonicalJson({ projectId: binding.projectId, artifactClassId: binding.artifactClassId,
      policyDigest: binding.policyDigest, actorId: binding.actorId, roleId: binding.roleId, purpose })));
  if (new Set(identityKeys).size !== identityKeys.length) fail("artifact_audit_duplicate_authority_binding");
  const authorityDigest = digestFor("direct_artifact_audit_principal_authority@1", { authorityId, bindings });
  const authority = Object.freeze({
    schema: "direct_artifact_audit_principal_authority@1",
    authorityId,
    authorityDigest,
    issue(request = {}) {
      exactObject(request, ["projectId", "artifactClassId", "policyDigest", "actorId", "roleId", "purpose"], "artifact_audit_principal_request_invalid");
      const record = {
        projectId: requiredId(request.projectId, "projectId"),
        artifactClassId: requiredId(request.artifactClassId, "artifactClassId"),
        policyDigest: requiredDigest(request.policyDigest, "policyDigest"),
        actorId: requiredId(request.actorId, "actorId"),
        roleId: requiredId(request.roleId, "roleId"),
        purpose: requiredId(request.purpose, "purpose"),
      };
      const binding = bindings.find((candidate) => candidate.projectId === record.projectId &&
        candidate.artifactClassId === record.artifactClassId && candidate.policyDigest === record.policyDigest &&
        candidate.actorId === record.actorId && candidate.roleId === record.roleId &&
        candidate.purposes.includes(record.purpose));
      if (!binding) fail("artifact_audit_principal_not_pinned");
      const principal = deepFreeze({
        schema: ARTIFACT_AUDIT_PRINCIPAL_SCHEMA,
        authorityId,
        principalId: digestFor(ARTIFACT_AUDIT_PRINCIPAL_SCHEMA, record),
        ...record,
      });
      PRINCIPAL_RECORDS.set(principal, { authority, ...record });
      return principal;
    },
  });
  AUTHORITY_RECORDS.set(authority, { authorityId, authorityDigest, bindings: deepFreeze(bindings) });
  return authority;
}

function verifyArtifactAuditPrincipal(authority, principal, expected = {}) {
  if (!AUTHORITY_RECORDS.has(authority)) fail("artifact_audit_authority_untrusted");
  const record = PRINCIPAL_RECORDS.get(principal);
  if (!record || record.authority !== authority) fail("artifact_audit_principal_untrusted");
  for (const field of ["projectId", "artifactClassId", "policyDigest", "actorId", "roleId", "purpose"]) {
    if (expected[field] !== undefined && record[field] !== expected[field]) {
      fail("artifact_audit_principal_scope_mismatch", field);
    }
  }
  return deepFreeze({ actorId: record.actorId, roleId: record.roleId, projectId: record.projectId,
    artifactClassId: record.artifactClassId, policyDigest: record.policyDigest, purpose: record.purpose });
}

function validateArtifactAuditPrincipalAuthority(authority) {
  const record = AUTHORITY_RECORDS.get(authority);
  if (!record) fail("artifact_audit_authority_untrusted");
  return deepFreeze({ authorityId: record.authorityId, authorityDigest: record.authorityDigest });
}

function assertArtifactAuditBindingPinned(authority, input) {
  const authorityRecord = AUTHORITY_RECORDS.get(authority);
  if (!authorityRecord) fail("artifact_audit_authority_untrusted");
  exactObject(input, ["projectId", "artifactClassId", "policyDigest", "actorId", "roleId", "purpose"], "artifact_audit_principal_request_invalid");
  const normalized = {
    projectId: requiredId(input.projectId, "projectId"), artifactClassId: requiredId(input.artifactClassId, "artifactClassId"),
    policyDigest: requiredDigest(input.policyDigest, "policyDigest"), actorId: requiredId(input.actorId, "actorId"),
    roleId: requiredId(input.roleId, "roleId"), purpose: requiredId(input.purpose, "purpose"),
  };
  const pinned = authorityRecord.bindings.some((binding) => binding.projectId === normalized.projectId &&
    binding.artifactClassId === normalized.artifactClassId && binding.policyDigest === normalized.policyDigest &&
    binding.actorId === normalized.actorId && binding.roleId === normalized.roleId &&
    binding.purposes.includes(normalized.purpose));
  if (!pinned) fail("artifact_audit_principal_not_pinned");
  return deepFreeze(normalized);
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
  if (!Array.isArray(input.roles) || !input.roles.length) fail("artifact_audit_role_set_required", "roles");
  const roles = input.roles.map(normalizeRole).sort((a, b) => a.roleId.localeCompare(b.roleId));
  if (new Set(roles.map((role) => role.roleId)).size !== roles.length) fail("artifact_audit_duplicate_role");
  const roleIds = new Set(roles.map((role) => role.roleId));
  const producerRoleIds = sortedUniqueIds(input.producerRoleIds, "producerRoleIds");
  const managerRoleId = requiredId(input.managerRoleId, "managerRoleId");
  const admissionRoleId = requiredId(input.admissionRoleId, "admissionRoleId");
  for (const roleId of [...producerRoleIds, managerRoleId, admissionRoleId]) {
    if (!roleIds.has(roleId)) fail("artifact_audit_role_unknown", roleId);
  }
  if (!Array.isArray(input.auditRequirements) || !input.auditRequirements.length) fail("artifact_audit_requirement_missing");
  const auditRequirements = input.auditRequirements.map((requirement) => {
    exactObject(requirement, ["requirementId", "auditorRoleIds", "separationRequired", "evidenceKinds"], "artifact_audit_requirement_invalid");
    const auditorRoleIds = sortedUniqueIds(requirement.auditorRoleIds, `${requirement.requirementId}.auditorRoleIds`);
    for (const roleId of auditorRoleIds) if (!roleIds.has(roleId)) fail("artifact_audit_role_unknown", roleId);
    const evidenceKinds = sortedUniqueIds(requirement.evidenceKinds, `${requirement.requirementId}.evidenceKinds`);
    if (evidenceKinds.some((kind) => !EVIDENCE_KINDS.includes(kind))) fail("artifact_audit_evidence_kind_invalid");
    return {
      requirementId: requiredId(requirement.requirementId, "requirementId"), auditorRoleIds,
      separationRequired: requirement.separationRequired === true, evidenceKinds,
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
    projectId: requiredId(input.projectId, "projectId"), revision: Number(input.revision),
    managerRoleId, roles, producerRoleIds, auditRequirements, admissionRoleId, allowedEvidenceKinds,
  };
  if (!Number.isSafeInteger(snapshot.revision) || snapshot.revision < 1) fail("artifact_audit_policy_revision_invalid");
  snapshot.policyDigest = digestFor(ARTIFACT_AUDIT_POLICY_SCHEMA, snapshot);
  return deepFreeze(snapshot);
}

function validatePolicySnapshot(input) {
  exactObject(input, [
    "schema", "artifactClassId", "projectId", "revision", "managerRoleId", "roles",
    "producerRoleIds", "auditRequirements", "admissionRoleId", "allowedEvidenceKinds", "policyDigest",
  ], "artifact_audit_policy_snapshot_invalid");
  if (input.schema !== ARTIFACT_AUDIT_POLICY_SCHEMA) fail("artifact_audit_policy_schema_invalid");
  const rebuilt = buildPolicySnapshot({
    artifactClassId: input.artifactClassId, projectId: input.projectId, managerRoleId: input.managerRoleId,
    roles: input.roles, producerRoleIds: input.producerRoleIds, auditRequirements: input.auditRequirements,
    admissionRoleId: input.admissionRoleId, allowedEvidenceKinds: input.allowedEvidenceKinds, revision: input.revision,
  });
  if (canonicalJson(rebuilt) !== canonicalJson(input)) fail("artifact_audit_policy_integrity_failed");
  return rebuilt;
}

function assertAuthorized(policyInput, actorInput, right, eligibleRoleIds = null) {
  const policy = validatePolicySnapshot(policyInput);
  const actor = normalizeActor(actorInput);
  const role = policy.roles.find((entry) => entry.roleId === actor.roleId);
  if (!role || !role.actors.includes(actor.actorId)) fail("artifact_audit_role_forgery", actor.actorId);
  if (!role.rights.includes(right)) fail("artifact_audit_right_denied", right);
  if (eligibleRoleIds && !eligibleRoleIds.includes(actor.roleId)) fail("artifact_audit_role_ineligible", actor.roleId);
  return deepFreeze(actor);
}

function normalizeScope(input, options = {}) {
  const fields = ["projectId", "workThreadId", "artifactId", "artifactClassId"];
  if (options.revision) fields.push("revision");
  exactObject(input, fields, "artifact_audit_scope_invalid");
  const scope = {
    projectId: requiredId(input.projectId, "projectId"), workThreadId: requiredId(input.workThreadId, "workThreadId"),
    artifactId: requiredId(input.artifactId, "artifactId"), artifactClassId: requiredId(input.artifactClassId, "artifactClassId"),
  };
  if (options.revision) {
    scope.revision = Number(input.revision);
    if (!Number.isSafeInteger(scope.revision) || scope.revision < 1) fail("artifact_audit_revision_invalid");
  }
  return deepFreeze(scope);
}

function buildEvidenceRecord(input) {
  assertNoRawExposure(input, "evidence");
  exactObject(input, [
    "kind", "evidenceId", "projectId", "workThreadId", "artifactId", "artifactClassId", "revision",
    "policyDigest", "sourceCaptureId", "sourceSessionId", "sourceTurnId", "canonicalEnvelopeDigest",
  ], "artifact_audit_evidence_invalid");
  const evidence = {
    schema: ARTIFACT_AUDIT_EVIDENCE_SCHEMA,
    kind: requiredId(input.kind, "evidence.kind"), evidenceId: requiredId(input.evidenceId, "evidenceId"),
    projectId: requiredId(input.projectId, "evidence.projectId"),
    workThreadId: requiredId(input.workThreadId, "evidence.workThreadId"),
    artifactId: requiredId(input.artifactId, "evidence.artifactId"),
    artifactClassId: requiredId(input.artifactClassId, "evidence.artifactClassId"),
    revision: Number(input.revision), policyDigest: requiredDigest(input.policyDigest, "evidence.policyDigest"),
    sourceCaptureId: requiredId(input.sourceCaptureId, "evidence.sourceCaptureId"),
    sourceSessionId: requiredId(input.sourceSessionId, "evidence.sourceSessionId"),
    sourceTurnId: requiredId(input.sourceTurnId, "evidence.sourceTurnId"),
    canonicalEnvelopeDigest: requiredDigest(input.canonicalEnvelopeDigest, "evidence.canonicalEnvelopeDigest"),
  };
  if (!EVIDENCE_KINDS.includes(evidence.kind)) fail("artifact_audit_evidence_kind_invalid", evidence.kind);
  if (!Number.isSafeInteger(evidence.revision) || evidence.revision < 1) fail("artifact_audit_revision_invalid");
  evidence.evidenceDigest = digestFor(ARTIFACT_AUDIT_EVIDENCE_SCHEMA, evidence);
  return deepFreeze(evidence);
}

function validateEvidenceRecord(input) {
  exactObject(input, [
    "schema", "kind", "evidenceId", "projectId", "workThreadId", "artifactId", "artifactClassId", "revision",
    "policyDigest", "sourceCaptureId", "sourceSessionId", "sourceTurnId", "canonicalEnvelopeDigest", "evidenceDigest",
  ], "artifact_audit_evidence_invalid");
  if (input.schema !== ARTIFACT_AUDIT_EVIDENCE_SCHEMA) fail("artifact_audit_evidence_schema_invalid");
  const rebuilt = buildEvidenceRecord({
    kind: input.kind, evidenceId: input.evidenceId, projectId: input.projectId,
    workThreadId: input.workThreadId, artifactId: input.artifactId, artifactClassId: input.artifactClassId,
    revision: input.revision, policyDigest: input.policyDigest, sourceCaptureId: input.sourceCaptureId,
    sourceSessionId: input.sourceSessionId, sourceTurnId: input.sourceTurnId,
    canonicalEnvelopeDigest: input.canonicalEnvelopeDigest,
  });
  if (canonicalJson(rebuilt) !== canonicalJson(input)) fail("artifact_audit_evidence_integrity_failed");
  return rebuilt;
}

function createArtifactAuditEvidenceReceiptAuthority(input = {}) {
  exactObject(input, ["authorityId", "adapter"], "artifact_audit_evidence_authority_invalid");
  const authorityId = requiredId(input.authorityId, "evidenceAuthorityId");
  const adapter = deepFreeze(normalizeActor(input.adapter));
  const authorityDigest = digestFor("direct_artifact_audit_evidence_authority@1", { authorityId, adapter });
  const authority = Object.freeze({
    schema: "direct_artifact_audit_evidence_authority@1",
    authorityId,
    authorityDigest,
    issue(evidenceInput = {}) {
      const evidence = buildEvidenceRecord(evidenceInput);
      const receipt = deepFreeze({
        schema: ARTIFACT_AUDIT_EVIDENCE_RECEIPT_SCHEMA,
        authorityId,
        receiptId: `aer_${evidence.evidenceDigest.slice(7, 31)}`,
        evidence,
        receiptDigest: digestFor(ARTIFACT_AUDIT_EVIDENCE_RECEIPT_SCHEMA, {
          authorityId,
          authorityDigest,
          evidenceDigest: evidence.evidenceDigest,
        }),
      });
      EVIDENCE_RECEIPT_RECORDS.set(receipt, { authority, evidence });
      return receipt;
    },
  });
  EVIDENCE_RECEIPT_AUTHORITY_RECORDS.set(authority, { authorityId, authorityDigest, adapter });
  return authority;
}

function validateArtifactAuditEvidenceReceiptAuthority(authority) {
  const record = EVIDENCE_RECEIPT_AUTHORITY_RECORDS.get(authority);
  if (!record) fail("artifact_audit_evidence_authority_untrusted");
  return deepFreeze({
    authorityId: record.authorityId,
    authorityDigest: record.authorityDigest,
    adapter: record.adapter,
  });
}

function verifyArtifactAuditEvidenceReceipt(authority, receipt) {
  if (!EVIDENCE_RECEIPT_AUTHORITY_RECORDS.has(authority)) {
    fail("artifact_audit_evidence_authority_untrusted");
  }
  const record = EVIDENCE_RECEIPT_RECORDS.get(receipt);
  if (!record || record.authority !== authority) fail("artifact_audit_evidence_receipt_untrusted");
  return record.evidence;
}

function normalizeEvidenceRefs(values, expectedScope, policyDigest, allowedKinds) {
  if (!Array.isArray(values) || !values.length) fail("artifact_audit_evidence_missing");
  const refs = values.map(validateEvidenceRecord);
  for (const ref of refs) {
    if (!allowedKinds.includes(ref.kind)) fail("artifact_audit_evidence_kind_invalid", ref.kind);
    for (const field of ["projectId", "workThreadId", "artifactId", "artifactClassId", "revision"]) {
      if (ref[field] !== expectedScope[field]) fail("artifact_audit_cross_scope_ref", field);
    }
    if (ref.policyDigest !== policyDigest) fail("artifact_audit_evidence_policy_mismatch");
  }
  const keys = refs.map((ref) => `${ref.evidenceId}:${ref.evidenceDigest}`);
  if (new Set(keys).size !== keys.length) fail("artifact_audit_duplicate_evidence");
  return deepFreeze(refs.sort((a, b) => canonicalJson(a).localeCompare(canonicalJson(b))));
}

function actorCandidates(policy, roleIds, right) {
  const byActor = new Map();
  for (const role of policy.roles) {
    if (!roleIds.includes(role.roleId) || !role.rights.includes(right)) continue;
    for (const actorId of role.actors) {
      const candidate = { actorId, roleId: role.roleId };
      const prior = byActor.get(actorId);
      if (!prior || canonicalJson(candidate) < canonicalJson(prior)) byActor.set(actorId, candidate);
    }
  }
  return [...byActor.values()].sort((a, b) => canonicalJson(a).localeCompare(canonicalJson(b)));
}

function findDistinctAuditAssignment(audits, producerActorId) {
  const selected = [];
  const used = new Set();
  const visit = (index) => {
    if (index === audits.length) return true;
    const audit = audits[index];
    for (const actor of audit.eligibleActors) {
      if (used.has(actor.actorId) || (audit.separationRequired && actor.actorId === producerActorId)) continue;
      used.add(actor.actorId);
      selected.push({ requirementId: audit.requirementId, ...actor });
      if (visit(index + 1)) return true;
      selected.pop();
      used.delete(actor.actorId);
    }
    return false;
  };
  return visit(0) ? selected : null;
}

function compileArtifactRoutingPlan(policyInput, scopeInput) {
  const policy = policyInput?.schema === ARTIFACT_AUDIT_POLICY_SCHEMA
    ? validatePolicySnapshot(policyInput) : buildPolicySnapshot(policyInput);
  const scope = normalizeScope(scopeInput);
  if (scope.projectId !== policy.projectId || scope.artifactClassId !== policy.artifactClassId) {
    fail("artifact_audit_policy_scope_mismatch");
  }
  const producerCandidates = actorCandidates(policy, policy.producerRoleIds, "propose");
  const requesters = actorCandidates(policy, [policy.managerRoleId], "propose");
  const audits = policy.auditRequirements.map((requirement) => ({
    requirementId: requirement.requirementId, requiredRight: "challenge",
    separationRequired: requirement.separationRequired,
    eligibleActors: actorCandidates(policy, requirement.auditorRoleIds, "challenge"),
  }));
  const assignments = producerCandidates.map((producer) => ({
    producer, audits: findDistinctAuditAssignment(audits, producer.actorId),
  })).filter((entry) => entry.audits).map((entry) => ({
    producer: entry.producer, audits: entry.audits,
  }));
  const admissionActors = actorCandidates(policy, [policy.admissionRoleId], "admit");
  if (!requesters.length || !assignments.length || !admissionActors.length) fail("artifact_audit_route_unfillable");
  const plan = {
    schema: ARTIFACT_AUDIT_ROUTE_PLAN_SCHEMA, scope,
    policyRef: { id: policy.artifactClassId, digest: policy.policyDigest },
    request: { requiredRight: "propose", eligibleActors: requesters },
    producer: { requiredRight: "propose", eligibleActors: assignments.map((entry) => entry.producer) }, audits,
    feasibleAssignments: assignments,
    admission: { requiredRight: "admit", eligibleActors: admissionActors },
    distinctAuditorActorsRequired: true, launchesProviders: false,
  };
  plan.planDigest = digestFor(ARTIFACT_AUDIT_ROUTE_PLAN_SCHEMA, plan);
  return deepFreeze(plan);
}

function normalizeAuditAssignment(input) {
  if (!Array.isArray(input) || !input.length) fail("artifact_audit_assignment_missing");
  const assignment = input.map((entry) => {
    exactObject(entry, ["requirementId", "actorId", "roleId"], "artifact_audit_assignment_invalid");
    return {
      requirementId: requiredId(entry.requirementId, "assignment.requirementId"),
      actorId: requiredId(entry.actorId, "assignment.actorId"),
      roleId: requiredId(entry.roleId, "assignment.roleId"),
    };
  }).sort((a, b) => a.requirementId.localeCompare(b.requirementId));
  if (new Set(assignment.map((entry) => entry.requirementId)).size !== assignment.length ||
      new Set(assignment.map((entry) => entry.actorId)).size !== assignment.length) {
    fail("artifact_audit_assignment_invalid");
  }
  return deepFreeze(assignment);
}

function buildEvent(input) {
  assertNoRawExposure(input, "event");
  const fields = [
    "eventId", "sequence", "previousEventDigest", "eventType", "scope", "policyRef", "actor",
    "stateFrom", "stateTo", "evidenceRefs", "occurredAt",
  ];
  if (input.audit !== undefined) fields.push("audit");
  if (input.decision !== undefined) fields.push("decision");
  if (input.assignment !== undefined) fields.push("assignment");
  exactObject(input, fields, "artifact_audit_event_input_invalid");
  const policyRef = exactObject(input.policyRef, ["id", "digest"], "artifact_audit_policy_ref_invalid");
  const event = {
    schema: ARTIFACT_AUDIT_EVENT_SCHEMA, eventId: requiredId(input.eventId, "eventId"),
    sequence: Number(input.sequence), previousEventDigest: requiredDigest(input.previousEventDigest, "previousEventDigest"),
    eventType: requiredId(input.eventType, "eventType"), scope: normalizeScope(input.scope, { revision: true }),
    policyRef: { id: requiredId(policyRef.id, "policyRef.id"), digest: requiredDigest(policyRef.digest, "policyRef.digest") },
    actor: normalizeActor(input.actor), stateFrom: input.stateFrom === null ? null : input.stateFrom,
    stateTo: input.stateTo,
    evidenceRefs: (input.evidenceRefs || []).map(validateEvidenceRecord), occurredAt: input.occurredAt,
    authorityDomain: "direct_workbench_artifact_audit", canonicalProjectTruth: false,
  };
  if (event.stateFrom !== null && !STATES.includes(event.stateFrom)) fail("artifact_audit_state_invalid");
  if (!STATES.includes(event.stateTo)) fail("artifact_audit_state_invalid");
  if (!Number.isSafeInteger(event.sequence) || event.sequence < 1) fail("artifact_audit_sequence_invalid");
  if (typeof event.occurredAt !== "string" || !Number.isFinite(Date.parse(event.occurredAt))) fail("artifact_audit_time_invalid");
  if (input.audit !== undefined) {
    exactObject(input.audit, ["requirementId", "verdict"], "artifact_audit_event_audit_invalid");
    if (!AUDIT_VERDICTS.includes(input.audit.verdict)) fail("artifact_audit_verdict_invalid");
    event.audit = { requirementId: requiredId(input.audit.requirementId, "requirementId"), verdict: input.audit.verdict };
  }
  if (input.decision !== undefined) {
    exactObject(input.decision, ["disposition"], "artifact_audit_event_decision_invalid");
    if (!["admitted", "rejected", "remanded"].includes(input.decision.disposition)) fail("artifact_audit_decision_invalid");
    event.decision = { disposition: input.decision.disposition };
  }
  if (input.assignment !== undefined) event.assignment = normalizeAuditAssignment(input.assignment);
  event.eventDigest = digestFor(ARTIFACT_AUDIT_EVENT_SCHEMA, event);
  return deepFreeze(event);
}

function validateEvent(input) {
  const base = [
    "schema", "eventId", "sequence", "previousEventDigest", "eventType", "scope", "policyRef", "actor",
    "stateFrom", "stateTo", "evidenceRefs", "occurredAt", "authorityDomain", "canonicalProjectTruth", "eventDigest",
  ];
  if (input?.audit !== undefined) base.push("audit");
  if (input?.decision !== undefined) base.push("decision");
  if (input?.assignment !== undefined) base.push("assignment");
  exactObject(input, base, "artifact_audit_event_invalid");
  if (input.schema !== ARTIFACT_AUDIT_EVENT_SCHEMA || input.authorityDomain !== "direct_workbench_artifact_audit" ||
      input.canonicalProjectTruth !== false) fail("artifact_audit_event_schema_invalid");
  const rebuilt = buildEvent({
    eventId: input.eventId, sequence: input.sequence, previousEventDigest: input.previousEventDigest,
    eventType: input.eventType, scope: input.scope, policyRef: input.policyRef, actor: input.actor,
    stateFrom: input.stateFrom, stateTo: input.stateTo, evidenceRefs: input.evidenceRefs,
    occurredAt: input.occurredAt, ...(input.audit === undefined ? {} : { audit: input.audit }),
    ...(input.decision === undefined ? {} : { decision: input.decision }),
    ...(input.assignment === undefined ? {} : { assignment: input.assignment }),
  });
  if (canonicalJson(rebuilt) !== canonicalJson(input)) fail("artifact_audit_event_integrity_failed");
  return rebuilt;
}

function safeTransitionProjection(subscription, events) {
  const selected = events.filter((event) => event.sequence > subscription.afterSequence &&
    event.scope.projectId === subscription.projectId &&
    (!subscription.workThreadId || event.scope.workThreadId === subscription.workThreadId) &&
    (!subscription.artifactId || event.scope.artifactId === subscription.artifactId) &&
    event.scope.artifactClassId === subscription.artifactClassId && subscription.eventTypes.includes(event.eventType));
  const transitions = selected.slice(0, subscription.limit).map((event) => {
    const transition = {
      sequence: event.sequence, eventId: event.eventId, eventDigest: event.eventDigest,
      previousEventDigest: event.previousEventDigest, eventType: event.eventType, scope: event.scope,
      policyRef: event.policyRef, stateFrom: event.stateFrom, stateTo: event.stateTo,
      evidenceRefs: event.evidenceRefs, occurredAt: event.occurredAt,
      authorityDomain: event.authorityDomain, canonicalProjectTruth: false,
    };
    if (event.audit) transition.audit = event.audit;
    if (event.decision) transition.decision = event.decision;
    return deepFreeze(transition);
  });
  return deepFreeze({
    schema: ARTIFACT_AUDIT_PROJECTION_SCHEMA, subscriptionId: subscription.subscriptionId,
    afterSequence: subscription.afterSequence,
    nextSequence: transitions.length ? transitions.at(-1).sequence : subscription.afterSequence,
    transitions, truncated: selected.length > transitions.length, deliveryMode: "passive_poll",
    activeWorkerMessageCount: 0,
  });
}

module.exports = {
  ARTIFACT_AUDIT_EVENT_SCHEMA,
  ARTIFACT_AUDIT_EVIDENCE_SCHEMA,
  ARTIFACT_AUDIT_EVIDENCE_RECEIPT_SCHEMA,
  ARTIFACT_AUDIT_POLICY_SCHEMA,
  ARTIFACT_AUDIT_PRINCIPAL_SCHEMA,
  ARTIFACT_AUDIT_PROJECTION_SCHEMA,
  ARTIFACT_AUDIT_ROUTE_PLAN_SCHEMA,
  AUDIT_VERDICTS,
  EVIDENCE_KINDS,
  RIGHTS,
  STATES,
  assertAuthorized,
  assertArtifactAuditBindingPinned,
  assertNoRawExposure,
  buildEvent,
  buildEvidenceRecord,
  buildPolicySnapshot,
  canonicalJson,
  compileArtifactRoutingPlan,
  createArtifactAuditEvidenceReceiptAuthority,
  createArtifactAuditPrincipalAuthority,
  deepFreeze,
  digestFor,
  fail,
  normalizeActor,
  normalizeEvidenceRefs,
  normalizeAuditAssignment,
  normalizeScope,
  safeTransitionProjection,
  validateEvent,
  validateEvidenceRecord,
  validateArtifactAuditPrincipalAuthority,
  validateArtifactAuditEvidenceReceiptAuthority,
  validatePolicySnapshot,
  verifyArtifactAuditEvidenceReceipt,
  verifyArtifactAuditPrincipal,
};
