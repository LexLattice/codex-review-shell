"use strict";

// Wave 26 PR 154 / C-03 remediation.  Projection policy is a closed trusted
// artifact; individual projection callers may request a cut but may not
// redefine privacy, traversal, audit, seed, worker, or budget law.
const { canonicalJson, sha256 } = require("../meta-session/digest");
const { isPlainObject, normalizeId, normalizeString } = require("../meta-session/ids");
const {
  DIRECT_HIERARCHICAL_WORLDMODEL_GRAPH_SCHEMA,
  DIRECT_SCOPED_WORLDMODEL_REVISION_REF_SCHEMA,
  validateHierarchicalWorldmodelGraph,
  validateScopedWorldmodelRevisionRef,
} = require("./hierarchical-graph");

const DIRECT_WORLDMODEL_GRAPH_PROJECTION_SCHEMA = "direct_worldmodel_graph_projection@1";
const DIRECT_WORLDMODEL_PROJECTION_POLICY_SCHEMA = "direct_worldmodel_projection_policy@1";
const DIRECT_WORLDMODEL_HISTORY_AUDIT_PROJECTION_SCHEMA = "direct_worldmodel_history_audit_projection@1";
const AUDIENCE_ROLES = Object.freeze(["world_manager", "project_manager", "thread_manager", "worker"]);
const ENTRY_PATHS = Object.freeze(["world_root", "world_to_project_descent", "project_resident", "project_to_work_thread_descent", "worker_boot"]);
const ALLOWED_RELATION_KINDS = Object.freeze(["affects", "depends_on", "refines", "implements", "supports", "applies_to", "relevant_to"]);
const INHERITED_KINDS = new Set(["principle", "preference", "policy", "constraint", "decision", "goal", "terminal_goal", "invariant"]);
const PROJECT_SEMANTIC_HEAD_KINDS = new Set(["project_root", "project_status", "goal", "terminal_goal", "risk", "decision", "constraint"]);
const WORLD_ROOT_GLOBAL_KINDS = new Set(["world_root", ...INHERITED_KINDS, "environment_binding", "agent_profile_binding", "project_status"]);
const DIGEST_FIELDS = new Set(["projectionDigest", "policyDigest", "auditProjectionDigest"]);
const POLICY_PURPOSES = Object.freeze(["current_context", "audit_history"]);
const PRIVATE_SENSITIVITIES = new Set(["private", "secret", "user_private", "manager_private", "restricted"]);
const FORBIDDEN_PAYLOAD_KEY = /^(?:raw(?:transcript|text)?|transcript|message(?:text)?|excerpt(?:text)?|body|bodies|text|content|summary|history|packet)$/i;

function error(code, detail = "") { const value = new Error(detail ? `${code}:${detail}` : code); value.code = code; return value; }
function object(value, label) { if (!isPlainObject(value)) throw error("direct_worldmodel_graph_projection_invalid_object", label); return value; }
function string(value, label) { const result = normalizeString(value, ""); if (!result) throw error("direct_worldmodel_graph_projection_missing_string", label); return result; }
function array(value, label) { if (!Array.isArray(value)) throw error("direct_worldmodel_graph_projection_missing_array", label); return value; }
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!isPlainObject(value)) return value;
  return Object.keys(value).sort().reduce((result, key) => {
    if (!DIGEST_FIELDS.has(key) && typeof value[key] !== "undefined") result[key] = stable(value[key]);
    return result;
  }, {});
}
function digestForDomain(domain, value) { return sha256(`${domain}\0${canonicalJson(stable(value), { omitDigestFields: false })}`); }
function digestFor(value) { return digestForDomain("direct-worldmodel-graph-projection@1", value); }
function refForNode(node) { return { kind: "worldmodel_semantic_node", id: node.nodeId, digest: node.digest }; }
function refForEdge(edge) { return { kind: "worldmodel_semantic_edge", id: edge.edgeId, digest: edge.digest }; }
function sortRefs(refs) { return [...refs].sort((left, right) => `${left.kind}:${left.id}`.localeCompare(`${right.kind}:${right.id}`)); }
function scopeKey(scope) { return `${scope.scopeKind}:${scope.projectId || ""}:${scope.workThreadId || ""}`; }
function sensitivityOf(node) { return normalizeString(node.sensitivity || node.structuredValue?.sensitivity || node.structuredValue?.classification, ""); }
function exactKeys(value, keys, label) {
  for (const key of Object.keys(value)) if (!keys.includes(key)) throw error("direct_worldmodel_graph_projection_unknown_field", `${label}.${key}`);
}
function rejectForbiddenPayload(value, label) {
  if (Array.isArray(value)) { value.forEach((entry, index) => rejectForbiddenPayload(entry, `${label}.${index}`)); return; }
  if (!isPlainObject(value)) return;
  for (const [key, entry] of Object.entries(value)) {
    if (FORBIDDEN_PAYLOAD_KEY.test(key.replace(/[_-]/g, ""))) throw error("direct_worldmodel_graph_projection_forbidden_payload", `${label}.${key}`);
    rejectForbiddenPayload(entry, `${label}.${key}`);
  }
}

function validateBudget(value, label = "semanticBudget") {
  object(value, label);
  for (const field of ["maxNodes", "maxEdges", "maxSummaryChars"]) if (!Number.isInteger(value[field]) || value[field] < 0) throw error("direct_worldmodel_graph_projection_invalid_budget", `${label}.${field}`);
  return true;
}
function validateFocalScope(value, role, entryPath, label = "focalScope") {
  object(value, label);
  if (!["user_world", "project", "work_thread"].includes(value.scopeKind)) throw error("direct_worldmodel_graph_projection_invalid_scope", `${label}.scopeKind`);
  if (value.scopeKind === "project" || value.scopeKind === "work_thread") string(value.projectId, `${label}.projectId`);
  if (value.scopeKind === "work_thread") string(value.workThreadId, `${label}.workThreadId`);
  const valid = (role === "world_manager" && ((entryPath === "world_root" && value.scopeKind === "user_world") || (entryPath === "world_to_project_descent" && value.scopeKind === "project")))
    || (role === "project_manager" && ((entryPath === "project_resident" && value.scopeKind === "project") || (entryPath === "project_to_work_thread_descent" && value.scopeKind === "work_thread")))
    || (role === "thread_manager" && entryPath === "project_to_work_thread_descent" && value.scopeKind === "work_thread")
    || (role === "worker" && entryPath === "worker_boot" && value.scopeKind === "work_thread");
  if (!valid) throw error("direct_worldmodel_graph_projection_invalid_role_path_scope", `${role}:${entryPath}:${value.scopeKind}`);
  return true;
}
function exactRef(input, label, fallbackKind) {
  const value = object(input, label);
  exactKeys(value, ["kind", "id", "digest"], label);
  const ref = { kind: string(value.kind || fallbackKind, `${label}.kind`), id: string(value.id, `${label}.id`), digest: string(value.digest, `${label}.digest`) };
  if (!ref.digest.startsWith("sha256:")) throw error("direct_worldmodel_graph_projection_invalid_ref_digest", label);
  return ref;
}
function profileIdentity(profile) {
  object(profile, "managerProfile");
  if (profile.schema === "odeu_worldmodel_manager_profile@1") {
    require("./manager").validateWorldmodelManagerProfile(profile);
    return { role: "world_manager", agentId: profile.managerAgentId, projectId: "", ref: { kind: "worldmodel_manager_profile", id: profile.managerProfileId, digest: profile.profileDigest } };
  }
  if (profile.schema === "direct_project_manager_profile@1") {
    require("./project-manager").validateProjectManagerProfile(profile);
    return { role: "project_manager", agentId: profile.projectManagerAgentId, projectId: profile.projectId, ref: { kind: "project_manager_profile", id: profile.projectManagerProfileId, digest: profile.profileDigest }, authorityBoundaryRef: { kind: profile.authorityBoundaryRef.kind, id: profile.authorityBoundaryRef.id, digest: profile.authorityBoundaryRef.digest }, configuredPolicyId: profile.graphProjectionPolicyRef.id };
  }
  if (profile.schema === "thread_manager_profile@1") {
    require("./thread-manager").validateThreadManagerProfile(profile);
    return { role: "thread_manager", agentId: profile.threadManagerAgentId, projectId: profile.projectId, workThreadId: profile.workThreadId, ref: { kind: "thread_manager_profile", id: profile.threadManagerProfileId, digest: profile.profileDigest } };
  }
  throw error("direct_worldmodel_graph_projection_invalid_profile", profile.schema || "unknown");
}
function authorityRef(input) {
  if (input?.schema === "worker_boot_authority_boundary@1") {
    require("./thread-manager").validateAuthorityBoundary(input);
    return { kind: "authority_boundary", id: input.authorityBoundaryId, digest: input.authorityBoundaryDigest };
  }
  return exactRef(input, "authoritySourceRef", "authority_boundary");
}
function uniqueStrings(values, label, allowed) {
  const result = [...new Set(array(values, label).map((entry) => string(entry, label)))].sort();
  if (allowed && result.some((entry) => !allowed.includes(entry))) throw error("direct_worldmodel_graph_projection_invalid_policy", label);
  return result;
}
function normalizedScope(value, label = "scope") {
  object(value, label); exactKeys(value, ["scopeKind", "projectId", "workThreadId"], label);
  const result = { scopeKind: string(value.scopeKind, `${label}.scopeKind`) };
  if (!['user_world', 'project', 'work_thread'].includes(result.scopeKind)) throw error("direct_worldmodel_graph_projection_invalid_scope", label);
  if (result.scopeKind !== "user_world") result.projectId = string(value.projectId, `${label}.projectId`);
  if (result.scopeKind === "work_thread") result.workThreadId = string(value.workThreadId, `${label}.workThreadId`);
  return result;
}
function validatePolicyShape(policy, label = "projectionPolicy") {
  object(policy, label); exactKeys(policy, ["schema", "policyId", "policyVersion", "purpose", "audienceRole", "audienceAgentId", "managerProfileRef", "authoritySourceRef", "trustedGraphRef", "allowedEntryPaths", "allowedFocalScopes", "trustedSeedNodeRefs", "custodyDenyList", "sensitivityDenyList", "allowedRelationKinds", "maxTraversalDepth", "semanticBudget", "workerAllowedProjectNodeRefs", "grantsAuthority", "policyDigest"], label);
  if (policy.schema !== DIRECT_WORLDMODEL_PROJECTION_POLICY_SCHEMA) throw error("direct_worldmodel_graph_projection_policy_schema_mismatch", label);
  string(policy.policyId, `${label}.policyId`); if (!Number.isInteger(policy.policyVersion) || policy.policyVersion < 1) throw error("direct_worldmodel_graph_projection_invalid_policy", "policyVersion");
  if (!POLICY_PURPOSES.includes(policy.purpose) || !AUDIENCE_ROLES.includes(policy.audienceRole)) throw error("direct_worldmodel_graph_projection_invalid_policy", "purpose/audienceRole");
  string(policy.audienceAgentId, `${label}.audienceAgentId`); exactRef(policy.managerProfileRef, `${label}.managerProfileRef`); exactRef(policy.authoritySourceRef, `${label}.authoritySourceRef`); exactRef(policy.trustedGraphRef, `${label}.trustedGraphRef`);
  const allowedEntryPaths = uniqueStrings(policy.allowedEntryPaths, `${label}.allowedEntryPaths`, ENTRY_PATHS); const allowedFocalScopes = array(policy.allowedFocalScopes, `${label}.allowedFocalScopes`); if (!allowedEntryPaths.length || !allowedFocalScopes.length) throw error("direct_worldmodel_graph_projection_invalid_policy", "allowed_projection_boundary_required"); allowedFocalScopes.forEach((scope, index) => normalizedScope(scope, `${label}.allowedFocalScopes.${index}`));
  array(policy.trustedSeedNodeRefs, `${label}.trustedSeedNodeRefs`).forEach((ref, index) => validateRef(ref, `${label}.trustedSeedNodeRefs.${index}`, "worldmodel_semantic_node"));
  uniqueStrings(policy.custodyDenyList, `${label}.custodyDenyList`); uniqueStrings(policy.sensitivityDenyList, `${label}.sensitivityDenyList`); uniqueStrings(policy.allowedRelationKinds, `${label}.allowedRelationKinds`, ALLOWED_RELATION_KINDS);
  if (!Number.isInteger(policy.maxTraversalDepth) || policy.maxTraversalDepth < 0) throw error("direct_worldmodel_graph_projection_invalid_policy", "maxTraversalDepth"); validateBudget(policy.semanticBudget, `${label}.semanticBudget`);
  array(policy.workerAllowedProjectNodeRefs, `${label}.workerAllowedProjectNodeRefs`).forEach((ref, index) => validateRef(ref, `${label}.workerAllowedProjectNodeRefs.${index}`, "worldmodel_semantic_node"));
  if (policy.audienceRole !== "worker" && policy.workerAllowedProjectNodeRefs.length) throw error("direct_worldmodel_graph_projection_invalid_policy", "worker_allowlist_role");
  if (!allowedEntryPaths.some((entryPath) => allowedFocalScopes.some((scope) => { try { validateFocalScope(scope, policy.audienceRole, entryPath); return true; } catch (_) { return false; } }))) throw error("direct_worldmodel_graph_projection_invalid_policy", "role_path_scope");
  if (policy.grantsAuthority !== false) throw error("direct_worldmodel_graph_projection_authority_forbidden", label);
  if (string(policy.policyDigest, `${label}.policyDigest`) !== digestForDomain("direct-worldmodel-projection-policy@1", policy)) throw error("direct_worldmodel_graph_projection_policy_digest_mismatch", label);
  return true;
}
function validatePolicyContext(policy, context = {}) {
  validatePolicyShape(policy); const graph = context.graph; validateHierarchicalWorldmodelGraph(graph); const identity = profileIdentity(context.managerProfile); const authority = authorityRef(context.authoritySourceRef || identity.authorityBoundaryRef);
  if (canonicalJson(policy.managerProfileRef) !== canonicalJson(identity.ref) || canonicalJson(policy.authoritySourceRef) !== canonicalJson(authority)) throw error("direct_worldmodel_graph_projection_policy_context_mismatch", "profile/authority");
  if (policy.trustedGraphRef.id !== graph.graphId || policy.trustedGraphRef.digest !== graph.digest) throw error("direct_worldmodel_graph_projection_policy_context_mismatch", "graph");
  if (policy.audienceRole !== (context.audienceRole || identity.role) || (policy.audienceRole !== "worker" && policy.audienceRole !== identity.role) || (policy.audienceRole !== "worker" && policy.audienceAgentId !== identity.agentId)) throw error("direct_worldmodel_graph_projection_policy_context_mismatch", "role/agent");
  if (identity.projectId && policy.allowedFocalScopes.some((scope) => scope.scopeKind !== "user_world" && scope.projectId !== identity.projectId)) throw error("direct_worldmodel_graph_projection_policy_context_mismatch", "project");
  if (identity.configuredPolicyId && identity.configuredPolicyId !== policy.policyId) throw error("direct_worldmodel_graph_projection_policy_context_mismatch", "configuredPolicyId");
  const nodes = new Map(graph.nodes.map((node) => [node.nodeId, node]));
  for (const ref of [...policy.trustedSeedNodeRefs, ...policy.workerAllowedProjectNodeRefs]) { const node = nodes.get(ref.id); if (!node || node.digest !== ref.digest) throw error("direct_worldmodel_graph_projection_policy_context_mismatch", `node:${ref.id}`); }
  const explicitSeedIds = new Set(policy.trustedSeedNodeRefs.map((ref) => ref.id));
  for (const ref of policy.trustedSeedNodeRefs) { const node = nodes.get(ref.id); if (!policy.allowedFocalScopes.some((scope) => scopePermits(node, scope, policy.audienceRole, policy, explicitSeedIds))) throw error("direct_worldmodel_graph_projection_policy_context_mismatch", `seedScope:${ref.id}`); }
  for (const ref of policy.workerAllowedProjectNodeRefs) { const node = nodes.get(ref.id); if (!policy.allowedFocalScopes.some((scope) => node.scope.scopeKind === "project" && node.scope.projectId === scope.projectId)) throw error("direct_worldmodel_graph_projection_policy_context_mismatch", `workerAllowScope:${ref.id}`); }
  return true;
}
function buildWorldmodelProjectionPolicy(input = {}) {
  object(input, "projectionPolicyInput"); const graph = input.graph; validateHierarchicalWorldmodelGraph(graph); const identity = profileIdentity(input.managerProfile); const role = string(input.audienceRole || identity.role, "projectionPolicyInput.audienceRole"); if (!AUDIENCE_ROLES.includes(role)) throw error("direct_worldmodel_graph_projection_invalid_role", role);
  if (role !== "worker" && role !== identity.role) throw error("direct_worldmodel_graph_projection_policy_context_mismatch", "role");
  const policyId = normalizeId(input.policyId || identity.configuredPolicyId, "worldmodel_projection_policy"); if (identity.configuredPolicyId && policyId !== identity.configuredPolicyId) throw error("direct_worldmodel_graph_projection_policy_context_mismatch", "configuredPolicyId");
  const purpose = POLICY_PURPOSES.includes(input.purpose) ? input.purpose : "current_context"; const trustedSeedNodeRefs = (input.trustedSeedNodeRefs || []).map((ref) => exactRef(ref, "trustedSeedNodeRef", "worldmodel_semantic_node")); const workerAllowedProjectNodeRefs = (input.workerAllowedProjectNodeRefs || []).map((ref) => exactRef(ref, "workerAllowedProjectNodeRef", "worldmodel_semantic_node"));
  const policy = { schema: DIRECT_WORLDMODEL_PROJECTION_POLICY_SCHEMA, policyId, policyVersion: Number.isInteger(input.policyVersion) && input.policyVersion >= 1 ? input.policyVersion : 1, purpose, audienceRole: role, audienceAgentId: normalizeId(input.audienceAgentId || identity.agentId, "audience_agent"), managerProfileRef: identity.ref, authoritySourceRef: authorityRef(input.authoritySourceRef || identity.authorityBoundaryRef), trustedGraphRef: { kind: "hierarchical_worldmodel_graph", id: graph.graphId, digest: graph.digest }, allowedEntryPaths: uniqueStrings(input.allowedEntryPaths || [], "allowedEntryPaths", ENTRY_PATHS), allowedFocalScopes: (input.allowedFocalScopes || []).map((scope, index) => normalizedScope(scope, `allowedFocalScopes.${index}`)).sort((a, b) => scopeKey(a).localeCompare(scopeKey(b))), trustedSeedNodeRefs: sortRefs(trustedSeedNodeRefs), custodyDenyList: uniqueStrings(input.custodyDenyList || [], "custodyDenyList"), sensitivityDenyList: uniqueStrings(input.sensitivityDenyList || [], "sensitivityDenyList"), allowedRelationKinds: uniqueStrings(input.allowedRelationKinds || ALLOWED_RELATION_KINDS, "allowedRelationKinds", ALLOWED_RELATION_KINDS), maxTraversalDepth: Number.isInteger(input.maxTraversalDepth) ? input.maxTraversalDepth : 4, semanticBudget: { ...(input.semanticBudget || {}) }, workerAllowedProjectNodeRefs: sortRefs(workerAllowedProjectNodeRefs), grantsAuthority: false };
  policy.policyDigest = digestForDomain("direct-worldmodel-projection-policy@1", policy); validatePolicyContext(policy, { graph, managerProfile: input.managerProfile, authoritySourceRef: input.authoritySourceRef || identity.authorityBoundaryRef, audienceRole: role }); return policy;
}
function validateWorldmodelProjectionPolicy(policy, context = {}) { if (!context.graph || !context.managerProfile) throw error("direct_worldmodel_graph_projection_policy_context_required"); return validatePolicyContext(policy, context); }
function validateWorldmodelProjectionPolicyShape(policy) { validatePolicyShape(policy); return { shapeValid: true, currentContextAdmissible: false, reason: "context_admission_required" }; }
function inputGraph(input) { return input.graph || input.worldmodelGraph || (input.schema === DIRECT_HIERARCHICAL_WORLDMODEL_GRAPH_SCHEMA ? input : null); }
function supplied(value, field) { return Object.prototype.hasOwnProperty.call(value, field); }

function omissionReason(node, policy, scopeAllowed) {
  const sensitivity = sensitivityOf(node).toLowerCase();
  if (PRIVATE_SENSITIVITIES.has(sensitivity) || policy.custodyDenyList.includes(node.custodianRole) || policy.sensitivityDenyList.includes(sensitivity)) return "unauthorized";
  if (node.scope.scopeKind !== "user_world" && node.custodianRole === "world_manager" && policy.audienceRole !== "world_manager") return "unauthorized";
  if (policy.purpose === "current_context" && (node.lifecycle === "stale" || node.epistemicStatus === "stale" || node.projectionEligibility === "blocked_stale")) return "stale";
  if (policy.purpose === "current_context" && (node.lifecycle === "refuted" || node.epistemicStatus === "refuted" || node.epistemicStatus === "disputed" || node.projectionEligibility === "blocked_conflicted")) return "conflicted";
  if (policy.purpose === "current_context" && (node.lifecycle === "archived" || node.lifecycle === "superseded" || node.projectionEligibility === "history_only")) return "historyOnly";
  // Audit projections deliberately retain lifecycle evidence as typed graph
  // refs.  Normal manager/worker projections remain active-truth only, but an
  // auditor must be able to inspect rejected, deferred, superseded, refuted,
  // and stale nodes without treating any of them as current context truth.
  if (policy.purpose === "current_context" && (node.lifecycle !== "active" || !["eligible", "eligible_with_warning"].includes(node.projectionEligibility))) return "irrelevant";
  return scopeAllowed ? null : "irrelevant";
}
function scopePermits(node, focalScope, role, policy, explicitSeedIds) {
  const scope = node.scope;
  if (focalScope.scopeKind === "user_world") {
    if (scope.scopeKind === "user_world") return WORLD_ROOT_GLOBAL_KINDS.has(node.nodeKind);
    return role === "world_manager" && scope.scopeKind === "project" && PROJECT_SEMANTIC_HEAD_KINDS.has(node.nodeKind);
  }
  const inherited = scope.scopeKind === "user_world" && INHERITED_KINDS.has(node.nodeKind);
  if (focalScope.scopeKind === "project") return inherited || (scope.scopeKind === "project" && scope.projectId === focalScope.projectId);
  if (scope.scopeKind === "user_world") return inherited;
  if (scope.scopeKind === "work_thread") return scope.projectId === focalScope.projectId && scope.workThreadId === focalScope.workThreadId;
  return role !== "worker" ? scope.scopeKind === "project" && scope.projectId === focalScope.projectId
    : scope.scopeKind === "project" && scope.projectId === focalScope.projectId && policy.workerAllowedProjectNodeRefs.some((ref) => ref.id === node.nodeId && ref.digest === node.digest) && explicitSeedIds.has(node.nodeId);
}
function seedNodes(nodes, explicit, focalScope, role, policy) {
  const focal = nodes.filter((node) => {
    if (focalScope.scopeKind === "project") return node.scope.scopeKind === "project" && node.scope.projectId === focalScope.projectId && node.nodeKind === "project_root";
    if (focalScope.scopeKind === "work_thread") return node.scope.scopeKind === "work_thread" && node.scope.projectId === focalScope.projectId && node.scope.workThreadId === focalScope.workThreadId && node.nodeKind === "work_thread_root";
    return node.scope.scopeKind === "user_world" && WORLD_ROOT_GLOBAL_KINDS.has(node.nodeKind)
      || node.scope.scopeKind === "project" && PROJECT_SEMANTIC_HEAD_KINDS.has(node.nodeKind);
  });
  const binding = nodes.filter((node) => scopePermits(node, focalScope, role, policy, explicit) && (node.normativeForce === "binding_constraint" || node.epistemicStatus === "accepted" && ["decision", "goal", "terminal_goal"].includes(node.nodeKind)));
  return new Set([...explicit, ...focal.map((node) => node.nodeId), ...binding.map((node) => node.nodeId)]);
}
function projectionScopeRevisions(graph, focalScope, selectedNodes) {
  const required = [{ scopeKind: "user_world" }, focalScope, ...selectedNodes.map((node) => node.scope)];
  return [...new Map(required.map((scope) => {
    const revision = graph.scopedRevisionRefs.find((entry) => scopeKey(entry) === scopeKey(scope));
    if (!revision) throw error("direct_worldmodel_graph_projection_missing_scope_revision", scopeKey(scope));
    return [scopeKey(scope), revision];
  })).values()].sort((left, right) => scopeKey(left).localeCompare(scopeKey(right)));
}
function compatiblePreviousProjection(previous, request, role, entryPath, focalScope, policy) {
  validateWorldmodelGraphProjection(previous);
  if (previous.audienceAgentId !== policy.audienceAgentId || previous.audienceRole !== role || previous.entryPath !== entryPath || previous.policyRef?.id !== policy.policyId || previous.policyRef?.digest !== policy.policyDigest || canonicalJson(previous.focalScope) !== canonicalJson(focalScope)) throw error("direct_worldmodel_graph_projection_previous_incompatible");
}

const AMBIENT_POLICY_FIELDS = Object.freeze(["auditMode", "custodyDenyList", "deniedCustodianRoles", "sensitivityDenyList", "deniedSensitivities", "allowedRelationKinds", "maxTraversalDepth", "workerProjectNodeIds", "workerAllowedProjectNodeIds", "workerAllowedProjectNodeRefs", "seedNodeIds", "trustedSeedNodeRefs", "semanticBudget", "selectionPolicy"]);
function assembleProjection(request, graph, policy) {
  const role = policy.audienceRole; const entryPath = string(request.entryPath, "entryPath");
  if (!policy.allowedEntryPaths.includes(entryPath)) throw error("direct_worldmodel_graph_projection_policy_denied", `entryPath:${entryPath}`);
  validateFocalScope(request.focalScope, role, entryPath); const focalScope = normalizedScope(request.focalScope, "focalScope");
  if (!policy.allowedFocalScopes.some((scope) => scopeKey(scope) === scopeKey(focalScope))) throw error("direct_worldmodel_graph_projection_policy_denied", `focalScope:${scopeKey(focalScope)}`);
  const budget = policy.semanticBudget; const explicitSeedIds = new Set(policy.trustedSeedNodeRefs.map((ref) => ref.id));
  const nodes = [...graph.nodes].sort((left, right) => left.nodeId.localeCompare(right.nodeId));
  const edges = [...graph.edges].sort((left, right) => left.edgeId.localeCompare(right.edgeId));
  const omissions = { irrelevant: 0, stale: 0, conflicted: 0, historyOnly: 0, overBudget: 0, unauthorized: 0 };
  const eligible = new Map();
  for (const node of nodes) {
    const reason = omissionReason(node, policy, scopePermits(node, focalScope, role, policy, explicitSeedIds));
    if (reason) omissions[reason] += 1; else eligible.set(node.nodeId, node);
  }
  const seeds = seedNodes(nodes, explicitSeedIds, focalScope, role, policy);
  const adjacency = new Map();
  for (const edge of edges) {
    if (edge.lifecycle !== "active" || !policy.allowedRelationKinds.includes(edge.relationKind)) continue;
    for (const [from, to] of [[edge.fromNodeId, edge.toNodeId], [edge.toNodeId, edge.fromNodeId]]) {
      if (!adjacency.has(from)) adjacency.set(from, []); adjacency.get(from).push(to);
    }
  }
  const discovered = new Set(); const queue = [...seeds].sort().map((id) => ({ id, depth: 0 }));
  while (queue.length) {
    const { id, depth } = queue.shift(); if (discovered.has(id) || !eligible.has(id)) continue;
    discovered.add(id);
    if (depth >= policy.maxTraversalDepth || (role === "worker" && depth >= 1)) continue;
    for (const next of (adjacency.get(id) || []).slice().sort()) if (!discovered.has(next)) queue.push({ id: next, depth: depth + 1 });
  }
  const selectedIds = new Set(); let summaryChars = 0;
  for (const node of [...discovered].map((id) => eligible.get(id)).sort((left, right) => left.nodeId.localeCompare(right.nodeId))) {
    const chars = node.semanticSummary.length;
    if (selectedIds.size >= budget.maxNodes || summaryChars + chars > budget.maxSummaryChars) { omissions.overBudget += 1; continue; }
    selectedIds.add(node.nodeId); summaryChars += chars;
  }
  const selectedNodes = nodes.filter((node) => selectedIds.has(node.nodeId));
  const sourceScopeRevisions = projectionScopeRevisions(graph, focalScope, selectedNodes);
  const selectedEdges = []; const boundary = [];
  for (const edge of edges) {
    const fromSelected = selectedIds.has(edge.fromNodeId); const toSelected = selectedIds.has(edge.toNodeId);
    if (fromSelected && toSelected && edge.lifecycle === "active" && policy.allowedRelationKinds.includes(edge.relationKind)) {
      if (selectedEdges.length >= budget.maxEdges) { omissions.overBudget += 1; continue; }
      selectedEdges.push(edge); continue;
    }
    if ((fromSelected || toSelected) && !fromSelected !== !toSelected && edge.lifecycle === "active" && policy.allowedRelationKinds.includes(edge.relationKind)) {
      const selectedNodeId = fromSelected ? edge.fromNodeId : edge.toNodeId;
      boundary.push({ kind: "worldmodel_projection_boundary", id: edge.edgeId, digest: edge.digest, selectedNodeId });
    }
  }
  const inherited = selectedNodes.filter((node) => node.scope.scopeKind === "user_world").map(refForNode);
  let changed = [];
  if (request.previousProjection) {
    compatiblePreviousProjection(request.previousProjection, request, role, entryPath, focalScope, policy);
    const currentRefs = [...selectedNodes.map(refForNode), ...selectedEdges.map(refForEdge)];
    const previousRefs = [...request.previousProjection.selectedNodeRefs, ...request.previousProjection.selectedEdgeRefs];
    const previous = new Map(previousRefs.map((ref) => [`${ref.kind}:${ref.id}`, ref]));
    const current = new Map(currentRefs.map((ref) => [`${ref.kind}:${ref.id}`, ref]));
    changed = currentRefs.filter((ref) => previous.get(`${ref.kind}:${ref.id}`)?.digest !== ref.digest);
    changed.push(...previousRefs.filter((ref) => !current.has(`${ref.kind}:${ref.id}`)).map((ref) => ({ kind: "worldmodel_projection_removed_ref", id: ref.id, digest: ref.digest, removedKind: ref.kind })));
  }
  const projectionId = normalizeId(request.projectionId || `worldmodel_projection_${graph.graphId}_${role}_${entryPath}_${focalScope.projectId || "world"}_${focalScope.workThreadId || ""}`, "worldmodel_projection");
  const result = {
    schema: DIRECT_WORLDMODEL_GRAPH_PROJECTION_SCHEMA, projectionId, purpose: "current_context", audienceAgentId: policy.audienceAgentId, audienceRole: role, entryPath, focalScope,
    graphRef: { kind: "hierarchical_worldmodel_graph", id: graph.graphId, digest: graph.digest }, policyRef: { kind: "worldmodel_projection_policy", id: policy.policyId, digest: policy.policyDigest }, selectionPolicyId: policy.policyId, semanticBudget: { maxNodes: budget.maxNodes, maxEdges: budget.maxEdges, maxSummaryChars: budget.maxSummaryChars },
    selectedNodeRefs: sortRefs(selectedNodes.map(refForNode)), selectedEdgeRefs: sortRefs(selectedEdges.map(refForEdge)), inheritedGlobalNodeRefs: sortRefs(inherited), changedSincePreviousProjectionRefs: sortRefs(changed), boundaryNodeRefs: sortRefs(boundary),
    omittedCounts: omissions, sourceScopeRevisions, contextAdmissionRequired: true, rawTranscriptIncluded: false, grantsAuthority: false,
  };
  result.projectionDigest = digestFor(result); validateWorldmodelGraphProjection(result); return result;
}
function projectionRequest(input, options) { object(input, "input"); return input.schema === DIRECT_HIERARCHICAL_WORLDMODEL_GRAPH_SCHEMA ? { ...options, graph: input } : { ...options, ...input }; }
function buildWorldmodelGraphProjection(input = {}, options = {}) {
  const request = projectionRequest(input, options); const graph = inputGraph(request); validateHierarchicalWorldmodelGraph(graph);
  for (const field of AMBIENT_POLICY_FIELDS) if (supplied(request, field)) throw error("direct_worldmodel_graph_projection_ambient_policy_forbidden", field);
  if (supplied(request, "rawTranscriptIncluded") && request.rawTranscriptIncluded !== false) throw error("direct_worldmodel_graph_projection_raw_transcript_forbidden"); if (supplied(request, "grantsAuthority") && request.grantsAuthority !== false) throw error("direct_worldmodel_graph_projection_authority_forbidden");
  const policy = request.policyArtifact; if (!policy) throw error("direct_worldmodel_graph_projection_policy_required"); validatePolicyContext(policy, { graph, managerProfile: request.managerProfile, authoritySourceRef: request.authoritySourceRef, audienceRole: policy.audienceRole });
  if (policy.purpose !== "current_context") throw error("direct_worldmodel_graph_projection_audit_not_current_context");
  return assembleProjection(request, graph, policy);
}
function buildWorldmodelHistoryAuditProjection(input = {}, options = {}) {
  const request = projectionRequest(input, options); const graph = inputGraph(request); validateHierarchicalWorldmodelGraph(graph);
  for (const field of AMBIENT_POLICY_FIELDS) if (supplied(request, field)) throw error("direct_worldmodel_graph_projection_ambient_policy_forbidden", field);
  const policy = request.policyArtifact; if (!policy) throw error("direct_worldmodel_graph_projection_policy_required"); validatePolicyContext(policy, { graph, managerProfile: request.managerProfile, authoritySourceRef: request.authoritySourceRef, audienceRole: policy.audienceRole });
  if (policy.purpose !== "audit_history") throw error("direct_worldmodel_graph_projection_audit_policy_required");
  const currentShape = assembleProjection(request, graph, policy); const nodes = new Map(graph.nodes.map((node) => [node.nodeId, node])); const edges = new Map(graph.edges.map((edge) => [edge.edgeId, edge]));
  const audit = { ...currentShape, schema: DIRECT_WORLDMODEL_HISTORY_AUDIT_PROJECTION_SCHEMA, purpose: "audit_history", selectedNodeRefs: currentShape.selectedNodeRefs.map((ref) => ({ ...ref, lifecycle: nodes.get(ref.id).lifecycle, epistemicStatus: nodes.get(ref.id).epistemicStatus, projectionEligibility: nodes.get(ref.id).projectionEligibility })), selectedEdgeRefs: currentShape.selectedEdgeRefs.map((ref) => ({ ...ref, lifecycle: edges.get(ref.id).lifecycle, epistemicStatus: edges.get(ref.id).epistemicStatus })), currentContextAdmissible: false };
  delete audit.contextAdmissionRequired; delete audit.projectionDigest; audit.auditProjectionDigest = digestForDomain("direct-worldmodel-history-audit-projection@1", audit); validateWorldmodelHistoryAuditProjection(audit); return audit;
}

function validateRef(ref, label, kind) {
  object(ref, label); rejectForbiddenPayload(ref, label); exactKeys(ref, ["kind", "id", "digest"], label); if (ref.kind !== kind) throw error("direct_worldmodel_graph_projection_invalid_ref", label); string(ref.id, `${label}.id`); const digest = string(ref.digest, `${label}.digest`); if (!digest.startsWith("sha256:")) throw error("direct_worldmodel_graph_projection_invalid_ref_digest", label);
}
function validateWorldmodelGraphProjection(value, label = "projection") {
  object(value, label); if (value.schema !== DIRECT_WORLDMODEL_GRAPH_PROJECTION_SCHEMA) throw error("direct_worldmodel_graph_projection_schema_mismatch", label);
  exactKeys(value, ["schema", "projectionId", "purpose", "audienceAgentId", "audienceRole", "entryPath", "focalScope", "graphRef", "policyRef", "selectionPolicyId", "semanticBudget", "selectedNodeRefs", "selectedEdgeRefs", "inheritedGlobalNodeRefs", "changedSincePreviousProjectionRefs", "boundaryNodeRefs", "omittedCounts", "sourceScopeRevisions", "contextAdmissionRequired", "rawTranscriptIncluded", "grantsAuthority", "projectionDigest"], label);
  string(value.projectionId, `${label}.projectionId`); string(value.audienceAgentId, `${label}.audienceAgentId`); if (!AUDIENCE_ROLES.includes(value.audienceRole)) throw error("direct_worldmodel_graph_projection_invalid_role", label); if (!ENTRY_PATHS.includes(value.entryPath)) throw error("direct_worldmodel_graph_projection_invalid_entry_path", label);
  if (value.purpose !== "current_context" || value.contextAdmissionRequired !== true) throw error("direct_worldmodel_graph_projection_not_current_context", label); exactRef(value.graphRef, `${label}.graphRef`, "hierarchical_worldmodel_graph"); exactRef(value.policyRef, `${label}.policyRef`, "worldmodel_projection_policy");
  exactKeys(value.focalScope, ["scopeKind", "projectId", "workThreadId"], `${label}.focalScope`); exactKeys(value.semanticBudget, ["maxNodes", "maxEdges", "maxSummaryChars"], `${label}.semanticBudget`); rejectForbiddenPayload(value.focalScope, `${label}.focalScope`); rejectForbiddenPayload(value.semanticBudget, `${label}.semanticBudget`);
  validateFocalScope(value.focalScope, value.audienceRole, value.entryPath, `${label}.focalScope`); string(value.selectionPolicyId, `${label}.selectionPolicyId`); validateBudget(value.semanticBudget, `${label}.semanticBudget`);
  for (const field of ["selectedNodeRefs", "inheritedGlobalNodeRefs"]) array(value[field], `${label}.${field}`).forEach((ref, index) => validateRef(ref, `${label}.${field}.${index}`, "worldmodel_semantic_node"));
  array(value.changedSincePreviousProjectionRefs, `${label}.changedSincePreviousProjectionRefs`).forEach((ref, index) => {
    if (ref.kind === "worldmodel_semantic_node") return validateRef(ref, `${label}.changedSincePreviousProjectionRefs.${index}`, "worldmodel_semantic_node");
    if (ref.kind === "worldmodel_semantic_edge") return validateRef(ref, `${label}.changedSincePreviousProjectionRefs.${index}`, "worldmodel_semantic_edge");
    object(ref, `${label}.changedSincePreviousProjectionRefs.${index}`); rejectForbiddenPayload(ref, `${label}.changedSincePreviousProjectionRefs.${index}`); exactKeys(ref, ["kind", "id", "digest", "removedKind"], `${label}.changedSincePreviousProjectionRefs.${index}`); if (ref.kind !== "worldmodel_projection_removed_ref" || !["worldmodel_semantic_node", "worldmodel_semantic_edge"].includes(ref.removedKind)) throw error("direct_worldmodel_graph_projection_invalid_change_ref", `${label}.${index}`); string(ref.id, `${label}.changedSincePreviousProjectionRefs.${index}.id`); if (!string(ref.digest, `${label}.changedSincePreviousProjectionRefs.${index}.digest`).startsWith("sha256:")) throw error("direct_worldmodel_graph_projection_invalid_ref_digest", `${label}.${index}`);
  });
  array(value.selectedEdgeRefs, `${label}.selectedEdgeRefs`).forEach((ref, index) => validateRef(ref, `${label}.selectedEdgeRefs.${index}`, "worldmodel_semantic_edge"));
  array(value.boundaryNodeRefs, `${label}.boundaryNodeRefs`).forEach((ref, index) => { object(ref, `${label}.boundaryNodeRefs.${index}`); rejectForbiddenPayload(ref, `${label}.boundaryNodeRefs.${index}`); exactKeys(ref, ["kind", "id", "digest", "selectedNodeId"], `${label}.boundaryNodeRefs.${index}`); if (ref.kind !== "worldmodel_projection_boundary") throw error("direct_worldmodel_graph_projection_invalid_ref", `${label}.boundaryNodeRefs.${index}`); string(ref.id, `${label}.boundaryNodeRefs.${index}.id`); if (!string(ref.digest, `${label}.boundaryNodeRefs.${index}.digest`).startsWith("sha256:")) throw error("direct_worldmodel_graph_projection_invalid_ref_digest", `${label}.${index}`); string(ref.selectedNodeId, `${label}.boundaryNodeRefs.${index}.selectedNodeId`); if (!value.selectedNodeRefs.some((nodeRef) => nodeRef.id === ref.selectedNodeId)) throw error("direct_worldmodel_graph_projection_boundary_target", `${label}.boundaryNodeRefs.${index}`); });
  object(value.omittedCounts, `${label}.omittedCounts`); for (const field of ["irrelevant", "stale", "conflicted", "historyOnly", "overBudget", "unauthorized"]) if (!Number.isInteger(value.omittedCounts[field]) || value.omittedCounts[field] < 0) throw error("direct_worldmodel_graph_projection_invalid_omissions", field);
  const scopeRevisions = array(value.sourceScopeRevisions, `${label}.sourceScopeRevisions`);
  scopeRevisions.forEach((ref, index) => { object(ref, `${label}.sourceScopeRevisions.${index}`); rejectForbiddenPayload(ref, `${label}.sourceScopeRevisions.${index}`); exactKeys(ref, ["schema", "scopeKind", "projectId", "workThreadId", "revision", "digest"], `${label}.sourceScopeRevisions.${index}`); if (ref.schema !== DIRECT_SCOPED_WORLDMODEL_REVISION_REF_SCHEMA) throw error("direct_worldmodel_graph_projection_invalid_scope_revision", `${label}.${index}`); validateScopedWorldmodelRevisionRef(ref, `${label}.sourceScopeRevisions.${index}`); });
  if (!scopeRevisions.some((ref) => scopeKey(ref) === "user_world::") || !scopeRevisions.some((ref) => scopeKey(ref) === scopeKey(value.focalScope))) throw error("direct_worldmodel_graph_projection_missing_scope_revision", label);
  if (value.focalScope.scopeKind !== "user_world" && scopeRevisions.some((ref) => ref.scopeKind !== "user_world" && ref.projectId !== value.focalScope.projectId)) throw error("direct_worldmodel_graph_projection_foreign_scope_revision", label);
  if (value.focalScope.scopeKind === "work_thread" && scopeRevisions.some((ref) => ref.scopeKind === "work_thread" && ref.workThreadId !== value.focalScope.workThreadId)) throw error("direct_worldmodel_graph_projection_foreign_scope_revision", label);
  if (value.policyRef.id !== value.selectionPolicyId) throw error("direct_worldmodel_graph_projection_policy_ref_mismatch", label); if (value.rawTranscriptIncluded !== false) throw error("direct_worldmodel_graph_projection_raw_transcript_forbidden", label); if (value.grantsAuthority !== false) throw error("direct_worldmodel_graph_projection_authority_forbidden", label);
  if (string(value.projectionDigest, `${label}.projectionDigest`) !== digestFor(value)) throw error("direct_worldmodel_graph_projection_digest_mismatch", label); return true;
}

function validateWorldmodelGraphProjectionShape(value) { validateWorldmodelGraphProjection(value); return { shapeValid: true, currentContextAdmissible: false, reason: "context_admission_required" }; }
function validateWorldmodelHistoryAuditProjection(value, label = "auditProjection") {
  object(value, label); if (value.schema !== DIRECT_WORLDMODEL_HISTORY_AUDIT_PROJECTION_SCHEMA || value.purpose !== "audit_history" || value.currentContextAdmissible !== false) throw error("direct_worldmodel_graph_projection_audit_schema_mismatch", label);
  exactKeys(value, ["schema", "projectionId", "purpose", "audienceAgentId", "audienceRole", "entryPath", "focalScope", "graphRef", "policyRef", "selectionPolicyId", "semanticBudget", "selectedNodeRefs", "selectedEdgeRefs", "inheritedGlobalNodeRefs", "changedSincePreviousProjectionRefs", "boundaryNodeRefs", "omittedCounts", "sourceScopeRevisions", "rawTranscriptIncluded", "grantsAuthority", "currentContextAdmissible", "auditProjectionDigest"], label);
  exactRef(value.graphRef, `${label}.graphRef`, "hierarchical_worldmodel_graph"); exactRef(value.policyRef, `${label}.policyRef`, "worldmodel_projection_policy"); validateFocalScope(value.focalScope, value.audienceRole, value.entryPath, `${label}.focalScope`); validateBudget(value.semanticBudget, `${label}.semanticBudget`);
  array(value.selectedNodeRefs, `${label}.selectedNodeRefs`).forEach((ref, index) => { object(ref, `${label}.selectedNodeRefs.${index}`); exactKeys(ref, ["kind", "id", "digest", "lifecycle", "epistemicStatus", "projectionEligibility"], `${label}.selectedNodeRefs.${index}`); string(ref.lifecycle, `${label}.selectedNodeRefs.${index}.lifecycle`); string(ref.epistemicStatus, `${label}.selectedNodeRefs.${index}.epistemicStatus`); string(ref.projectionEligibility, `${label}.selectedNodeRefs.${index}.projectionEligibility`); });
  array(value.selectedEdgeRefs, `${label}.selectedEdgeRefs`).forEach((ref, index) => { object(ref, `${label}.selectedEdgeRefs.${index}`); exactKeys(ref, ["kind", "id", "digest", "lifecycle", "epistemicStatus"], `${label}.selectedEdgeRefs.${index}`); string(ref.lifecycle, `${label}.selectedEdgeRefs.${index}.lifecycle`); string(ref.epistemicStatus, `${label}.selectedEdgeRefs.${index}.epistemicStatus`); });
  for (const field of ["inheritedGlobalNodeRefs", "changedSincePreviousProjectionRefs", "boundaryNodeRefs", "sourceScopeRevisions"]) array(value[field], `${label}.${field}`); object(value.omittedCounts, `${label}.omittedCounts`);
  if (value.rawTranscriptIncluded !== false || value.grantsAuthority !== false) throw error("direct_worldmodel_graph_projection_authority_forbidden", label); if (string(value.auditProjectionDigest, `${label}.auditProjectionDigest`) !== digestForDomain("direct-worldmodel-history-audit-projection@1", value)) throw error("direct_worldmodel_graph_projection_audit_digest_mismatch", label); return true;
}
function admitWorldmodelGraphProjectionAgainstContext(projection, context = {}) {
  if (projection?.schema === DIRECT_WORLDMODEL_HISTORY_AUDIT_PROJECTION_SCHEMA) throw error("direct_worldmodel_graph_projection_audit_not_current_context"); validateWorldmodelGraphProjection(projection);
  if (!context.graph?.trustAnchorRef) throw error("direct_worldmodel_graph_projection_trust_anchor_required");
  // A current-context projection is admitted only against the authority
  // privately pinned to the graph anchor.  `context.trustStore`, policy,
  // manager, and registry are never authority inputs on this path.
  const trust = require("./governance-trust-store");
  let store; let authoritative;
  try { store = trust.resolveAuthoritativeWorldmodelTrustStore(context.graph); authoritative = trust.readAuthoritativeWorldmodelGraph(store, context.graph); }
  catch (cause) { throw error(cause.code || "direct_worldmodel_graph_projection_store_authority_invalid"); }
  const graph = authoritative.graph;
  const registry = authoritative.governanceRegistry;
  if (projection.graphRef.id !== graph.graphId || projection.graphRef.digest !== graph.digest) throw error("direct_worldmodel_graph_projection_context_mismatch", "graph");
  const policyRecord = registry.records.find((record) => record.kind === "projection_policy" && record.artifactId === projection.policyRef.id && record.artifactDigest === projection.policyRef.digest);
  if (!policyRecord) throw error("direct_worldmodel_graph_projection_context_mismatch", "policy");
  const policy = policyRecord.body; validatePolicyShape(policy);
  const profileRecord = registry.records.find((record) => (record.kind === "project_manager_profile" || record.kind === "world_manager_profile") && record.artifactId === policy.managerProfileRef.id && record.artifactDigest === policy.managerProfileRef.digest);
  if (!profileRecord) throw error("direct_worldmodel_graph_projection_store_profile_missing");
  const managerProfile = profileRecord.body;
  const identity = profileIdentity(managerProfile);
  const authorityRecord = registry.records.find((record) => record.kind === "authority_decision" && record.artifactId === context.authorityDecision?.authorityDecisionId && record.artifactDigest === context.authorityDecision?.digest);
  if (!authorityRecord) throw error("direct_worldmodel_graph_projection_registry_authority_required");
  const authority = authorityRecord.body;
  // Project Manager authority is closed by its stored profile; the global
  // World Manager profile has no project authority-boundary field, so its
  // exact store-owned projection policy carries the authoritative source ref.
  validatePolicyContext(policy, { graph, managerProfile, authoritySourceRef: identity.authorityBoundaryRef || policy.authoritySourceRef, audienceRole: policy.audienceRole });
  if (context.policy && canonicalJson(context.policy) !== canonicalJson(policy)) throw error("direct_worldmodel_graph_projection_store_policy_substitution");
  if (context.managerProfile && canonicalJson(context.managerProfile) !== canonicalJson(managerProfile)) throw error("direct_worldmodel_graph_projection_store_profile_substitution");
  if (policy.purpose !== "current_context" || projection.graphRef.id !== graph.graphId || projection.graphRef.digest !== graph.digest || projection.policyRef.id !== policy.policyId || projection.policyRef.digest !== policy.policyDigest) throw error("direct_worldmodel_graph_projection_context_mismatch", "graph/policy");
  const { requireGovernanceProvenanceAdmission } = require("./governance-provenance-registry");
  const focal = projection.focalScope;
  const requiredArtifacts = [
    { kind: identity.role === "world_manager" ? "world_manager_profile" : "project_manager_profile", id: identity.ref.id, digest: identity.ref.digest },
    { kind: "projection_policy", id: policy.policyId, digest: policy.policyDigest },
    { kind: "authority_decision", id: authority.authorityDecisionId, digest: authority.digest, oneShot: true },
  ];
  if (!context.storeAdmission) throw error("direct_worldmodel_graph_projection_store_admission_required");
  trust.validateWorldmodelStoreAdmission(store, graph, context.storeAdmission, { agentId: projection.audienceAgentId, role: projection.audienceRole, purpose: "current_context", requiredArtifacts });
  requireGovernanceProvenanceAdmission(registry, {
    registryRef: authoritative.registryRef, expectedRegistryRevision: registry.revision,
    graphId: graph.graphId, graphDigest: graph.digest, userProfileId: graph.userProfileId,
    scopeKind: focal.scopeKind, projectId: focal.projectId, workThreadId: focal.workThreadId,
    projectRootNodeId: graph.nodes.find((node) => node.nodeKind === "project_root" && node.scope.projectId === focal.projectId)?.nodeId, role: projection.audienceRole, agentId: projection.audienceAgentId, purpose: "current_context",
    requiredArtifacts,
  });
  const expected = assembleProjection({ projectionId: projection.projectionId, entryPath: projection.entryPath, focalScope: projection.focalScope, previousProjection: context.previousProjection }, graph, policy);
  if (canonicalJson(expected) !== canonicalJson(projection)) throw error("direct_worldmodel_graph_projection_context_revalidation_failed", projection.projectionId);
  return { admitted: true, purpose: "current_context", graphId: graph.graphId, graphDigest: graph.digest, policyId: policy.policyId, policyDigest: policy.policyDigest, projectionId: projection.projectionId, projectionDigest: projection.projectionDigest };
}

module.exports = { DIRECT_WORLDMODEL_GRAPH_PROJECTION_SCHEMA, DIRECT_WORLDMODEL_PROJECTION_POLICY_SCHEMA, DIRECT_WORLDMODEL_HISTORY_AUDIT_PROJECTION_SCHEMA, AUDIENCE_ROLES, ENTRY_PATHS, ALLOWED_RELATION_KINDS, buildWorldmodelProjectionPolicy, validateWorldmodelProjectionPolicy, validateWorldmodelProjectionPolicyShape, buildWorldmodelGraphProjection, validateWorldmodelGraphProjection, validateWorldmodelGraphProjectionShape, admitWorldmodelGraphProjectionAgainstContext, buildWorldmodelHistoryAuditProjection, validateWorldmodelHistoryAuditProjection };
