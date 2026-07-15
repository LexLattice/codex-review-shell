"use strict";

// Wave 26 governance/provenance authority.  Portable artifacts elsewhere are
// evidence only; this append-only registry is the local authoritative source
// that admits an exact body for an exact graph/user/project/scope/role/agent
// purpose tuple.  It deliberately makes no claim about an external signer.
const { canonicalJson, sha256 } = require("../meta-session/digest");
const { isPlainObject, normalizeId, normalizeString, nowIso } = require("../meta-session/ids");

const DIRECT_GOVERNANCE_PROVENANCE_REGISTRY_SCHEMA = "direct_governance_provenance_registry@1";
const DIRECT_GOVERNANCE_PROVENANCE_TRANSITION_SCHEMA = "direct_governance_provenance_transition@1";
const ADMITTED_KINDS = new Set(["world_manager_profile", "project_manager_profile", "parent_delegation", "project_root", "custody_matrix", "custody_witness", "authority_decision", "projection_policy"]);
const DIGEST_FIELDS = new Set(["digest", "registryDigest", "transitionDigest"]);
function fail(code, detail = "") { const error = new Error(detail ? `${code}:${detail}` : code); error.code = code; throw error; }
function object(value, label) { if (!isPlainObject(value)) fail("direct_governance_registry_invalid_object", label); return value; }
function string(value, label) { const result = normalizeString(value, ""); if (!result) fail("direct_governance_registry_missing_string", label); return result; }
function stable(value) { if (Array.isArray(value)) return value.map(stable); if (!isPlainObject(value)) return value; return Object.keys(value).sort().reduce((out, key) => { if (!DIGEST_FIELDS.has(key) && value[key] !== undefined) out[key] = stable(value[key]); return out; }, {}); }
function digest(domain, value) { return sha256(`${domain}\0${canonicalJson(stable(value))}`); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function scopeKey(value = {}) { return `${value.scopeKind || ""}:${value.projectId || ""}:${value.workThreadId || ""}:${value.semanticPath ? value.semanticPath.join("/") : ""}`; }
function exactDigest(value, label) { const result = string(value, label); if (!/^sha256:[a-f0-9]{64}$/i.test(result)) fail("direct_governance_registry_exact_digest_required", label); return result; }
function artifactIdentity(kind, body) {
  const idKeys = { world_manager_profile: "managerProfileId", project_manager_profile: "projectManagerProfileId", parent_delegation: "delegationId", project_root: "nodeId", custody_matrix: "matrixId", custody_witness: "path", authority_decision: "authorityDecisionId", projection_policy: "policyId" };
  const digestKeys = { world_manager_profile: "profileDigest", project_manager_profile: "profileDigest", parent_delegation: "delegationDigest", project_root: "digest", custody_matrix: "matrixDigest", custody_witness: "writeWitnessDigest", authority_decision: "digest", projection_policy: "policyDigest" };
  const id = body?.[idKeys[kind]] || body?.id;
  return { id: string(id, `artifact.${kind}.id`), digest: exactDigest(body?.[digestKeys[kind]] || body?.digest, `artifact.${kind}.digest`) };
}
function normalizeBinding(value = {}) {
  object(value, "binding");
  const out = { graphId: string(value.graphId, "binding.graphId"), graphDigest: exactDigest(value.graphDigest, "binding.graphDigest"), userProfileId: string(value.userProfileId, "binding.userProfileId"), scopeKind: string(value.scopeKind, "binding.scopeKind"), role: string(value.role, "binding.role"), agentId: string(value.agentId, "binding.agentId"), purpose: string(value.purpose, "binding.purpose") };
  if (value.projectId) out.projectId = string(value.projectId, "binding.projectId");
  if (value.workThreadId) out.workThreadId = string(value.workThreadId, "binding.workThreadId");
  if (value.projectRootNodeId) out.projectRootNodeId = string(value.projectRootNodeId, "binding.projectRootNodeId");
  if (value.expectedScopeRevisionDigest) out.expectedScopeRevisionDigest = exactDigest(value.expectedScopeRevisionDigest, "binding.expectedScopeRevisionDigest");
  return out;
}
function normalizeRecord(value = {}) {
  object(value, "registryRecord"); const kind = string(value.kind, "registryRecord.kind"); if (!ADMITTED_KINDS.has(kind)) fail("direct_governance_registry_kind_invalid", kind);
  const identity = artifactIdentity(kind, value.body); const binding = normalizeBinding(value.binding);
  return { recordId: normalizeId(value.recordId || `${kind}_${identity.id}`, "governance_record"), kind, artifactId: identity.id, artifactDigest: identity.digest, body: clone(value.body), binding, oneShot: value.oneShot === true, consumed: value.consumed === true, admittedAt: normalizeString(value.admittedAt, "1970-01-01T00:00:00.000Z") };
}
function recordKey(record) { return `${record.kind}:${record.artifactId}:${record.artifactDigest}:${scopeKey(record.binding)}:${record.binding.role}:${record.binding.agentId}:${record.binding.purpose}`; }
function buildGovernanceProvenanceRegistry(input = {}, options = {}) {
  const source = isPlainObject(input) ? input : {}; const records = (source.records || []).map(normalizeRecord);
  if (new Set(records.map(recordKey)).size !== records.length) fail("direct_governance_registry_duplicate_record");
  const registry = { schema: DIRECT_GOVERNANCE_PROVENANCE_REGISTRY_SCHEMA, registryId: normalizeId(source.registryId || source.id, "governance_provenance_registry"), userProfileId: string(source.userProfileId, "registry.userProfileId"), revision: Number.isInteger(source.revision) && source.revision >= 0 ? source.revision : 0, records, transitions: Array.isArray(source.transitions) ? clone(source.transitions) : [], createdAt: normalizeString(source.createdAt, nowIso(options.now || Date.now)) };
  registry.registryDigest = digest("direct-governance-provenance-registry@1", registry); return registry;
}
function validateGovernanceProvenanceRegistry(value, label = "governanceRegistry") {
  object(value, label); if (value.schema !== DIRECT_GOVERNANCE_PROVENANCE_REGISTRY_SCHEMA || !Number.isInteger(value.revision) || value.revision < 0) fail("direct_governance_registry_schema_invalid", label); string(value.registryId, `${label}.registryId`); string(value.userProfileId, `${label}.userProfileId`); if (!Array.isArray(value.records) || !Array.isArray(value.transitions)) fail("direct_governance_registry_invalid_array", label);
  const records = value.records.map(normalizeRecord); if (canonicalJson(records) !== canonicalJson(value.records) || new Set(records.map(recordKey)).size !== records.length) fail("direct_governance_registry_record_invalid", label);
  if (string(value.registryDigest, `${label}.registryDigest`) !== digest("direct-governance-provenance-registry@1", value)) fail("direct_governance_registry_digest_mismatch", label);
  let prior = "genesis"; let revision = 0;
  for (const transition of value.transitions) { object(transition, `${label}.transition`); if (transition.schema !== DIRECT_GOVERNANCE_PROVENANCE_TRANSITION_SCHEMA || transition.priorTransitionId !== prior || transition.revision !== ++revision || string(transition.transitionDigest, "transition.digest") !== digest("direct-governance-provenance-transition@1", transition)) fail("direct_governance_registry_replay_invalid", label); prior = transition.transitionId; }
  if (revision !== value.revision) fail("direct_governance_registry_revision_replay_mismatch", label); return true;
}
function registryRef(registry) { if (!registry) fail("direct_governance_registry_required"); return { kind: "governance_provenance_registry", id: registry.registryId, digest: registry.registryDigest, revision: registry.revision }; }
function bindingMatches(binding, context) { return binding.graphId === context.graphId && binding.graphDigest === context.graphDigest && binding.userProfileId === context.userProfileId && binding.scopeKind === context.scopeKind && (binding.projectId || "") === (context.projectId || "") && (binding.workThreadId || "") === (context.workThreadId || "") && binding.role === context.role && binding.agentId === context.agentId && binding.purpose === context.purpose && (!binding.projectRootNodeId || binding.projectRootNodeId === context.projectRootNodeId) && (!binding.expectedScopeRevisionDigest || binding.expectedScopeRevisionDigest === context.expectedScopeRevisionDigest); }
function requireGovernanceProvenanceAdmission(registry, context = {}) {
  validateGovernanceProvenanceRegistry(registry); object(context, "governanceContext"); const expectedRevision = context.expectedRegistryRevision;
  if (!Number.isInteger(expectedRevision) || expectedRevision !== registry.revision || context.registryRef?.id !== registry.registryId || context.registryRef?.digest !== registry.registryDigest || context.registryRef?.revision !== registry.revision) fail("direct_governance_registry_stale_or_swapped", "registry");
  const required = Array.isArray(context.requiredArtifacts) ? context.requiredArtifacts : []; if (!required.length) fail("direct_governance_registry_required_artifacts_missing");
  for (const artifact of required) { const match = registry.records.find((record) => record.kind === artifact.kind && record.artifactId === artifact.id && record.artifactDigest === artifact.digest && !record.consumed && bindingMatches(record.binding, context)); if (!match) fail("direct_governance_registry_membership_missing", artifact.kind); if (artifact.oneShot === true && !match.oneShot) fail("direct_governance_registry_one_shot_required", artifact.kind); }
  return { admitted: true, registryRef: registryRef(registry) };
}
function consumeGovernanceProvenanceAdmission(registryInput, context = {}, options = {}) {
  requireGovernanceProvenanceAdmission(registryInput, context); const registry = clone(registryInput); const requested = context.consumeArtifacts || [];
  for (const artifact of requested) { const record = registry.records.find((candidate) => candidate.kind === artifact.kind && candidate.artifactId === artifact.id && candidate.artifactDigest === artifact.digest && bindingMatches(candidate.binding, context)); if (!record || !record.oneShot || record.consumed) fail("direct_governance_registry_consumption_invalid", artifact.kind); record.consumed = true; }
  const transition = { schema: DIRECT_GOVERNANCE_PROVENANCE_TRANSITION_SCHEMA, transitionId: normalizeId(context.transitionId, "governance_transition"), priorTransitionId: registry.transitions.length ? registry.transitions.at(-1).transitionId : "genesis", revision: registry.revision + 1, expectedRevision: context.expectedRegistryRevision, consumedRecordKeys: requested.map((artifact) => `${artifact.kind}:${artifact.id}:${artifact.digest}`).sort(), createdAt: normalizeString(context.createdAt, nowIso(options.now || Date.now)) }; transition.transitionDigest = digest("direct-governance-provenance-transition@1", transition); registry.transitions.push(transition); registry.revision += 1; registry.registryDigest = digest("direct-governance-provenance-registry@1", registry); validateGovernanceProvenanceRegistry(registry); return registry;
}
module.exports = { DIRECT_GOVERNANCE_PROVENANCE_REGISTRY_SCHEMA, DIRECT_GOVERNANCE_PROVENANCE_TRANSITION_SCHEMA, ADMITTED_KINDS, buildGovernanceProvenanceRegistry, validateGovernanceProvenanceRegistry, registryRef, requireGovernanceProvenanceAdmission, consumeGovernanceProvenanceAdmission };
