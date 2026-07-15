"use strict";

const { canonicalJson, sha256 } = require("../meta-session/digest");
const {
  isPlainObject,
  normalizeId,
  normalizeString,
  nowIso,
} = require("../meta-session/ids");
const { normalizeOdeuSourceRefs } = require("../odeu/source-ref");
const { validateSourceRefs } = require("./kernel");

const DIRECT_HIERARCHICAL_WORLDMODEL_GRAPH_SCHEMA =
  "direct_hierarchical_worldmodel_graph@1";
const DIRECT_SCOPED_WORLDMODEL_REVISION_REF_SCHEMA =
  "direct_scoped_worldmodel_revision_ref@1";
const DIRECT_WORLDMODEL_SEMANTIC_NODE_SCHEMA =
  "direct_worldmodel_semantic_node@1";
const DIRECT_WORLDMODEL_SEMANTIC_EDGE_SCHEMA =
  "direct_worldmodel_semantic_edge@1";
const DIRECT_WORLDMODEL_GRAPH_TRANSITION_SCHEMA =
  "direct_worldmodel_graph_transition@2";
const DIRECT_WORLDMODEL_GRAPH_WRITE_AUTHORIZATION_SCHEMA =
  "direct_worldmodel_graph_write_authorization@1";
const DIRECT_HIERARCHICAL_WORLDMODEL_VIEW_SCHEMA =
  "direct_hierarchical_worldmodel_materialized_view@1";
const DIRECT_WORLDMODEL_HISTORY_PROJECTION_SCHEMA =
  "direct_worldmodel_history_projection@1";
const SCOPE_KINDS = ["user_world", "project", "work_thread"];
const NODE_KINDS = [
  "world_root",
  "project_root",
  "work_thread_root",
  "principle",
  "preference",
  "policy",
  "goal",
  "terminal_goal",
  "idea",
  "hypothesis",
  "invariant",
  "decision",
  "constraint",
  "open_question",
  "risk",
  "procedure",
  "project_status",
  "environment_binding",
  "agent_profile_binding",
  "work_thread_summary",
];
const NODE_LIFECYCLES = [
  "proposed",
  "active",
  "deferred",
  "rejected",
  "superseded",
  "refuted",
  "stale",
  "archived",
];
const EPISTEMIC_STATUSES = [
  "observed",
  "accepted",
  "derived",
  "hypothesis",
  "unknown",
  "disputed",
  "refuted",
  "stale",
];
const EDGE_EPISTEMIC_STATUSES = [
  "accepted",
  "derived",
  "hypothesis",
  "disputed",
  "refuted",
  "stale",
];
const MUTATION_KINDS = [
  "add_node",
  "revise_node",
  "set_node_lifecycle",
  "add_edge",
  "revise_edge",
  "set_binding",
];
const ACTOR_ROLES = [
  "world_manager",
  "project_manager",
  "thread_manager",
  "migration",
];
const DIGEST_FIELDS = new Set(["digest", "viewDigest", "projectionDigest"]);
const LEGACY_NON_WAVE26_APPEND = Symbol("legacy_non_wave26_append");
function fail(code, detail = "") {
  const error = new Error(detail ? `${code}:${detail}` : code);
  error.code = code;
  throw error;
}
function object(value, label) {
  if (!isPlainObject(value))
    fail("direct_hierarchical_graph_invalid_object", label);
  return value;
}
function string(value, label) {
  const result = normalizeString(value, "");
  if (!result) fail("direct_hierarchical_graph_missing_string", label);
  return result;
}
function array(value, label) {
  if (!Array.isArray(value))
    fail("direct_hierarchical_graph_missing_array", label);
  return value;
}
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!isPlainObject(value)) return value;
  return Object.keys(value)
    .sort()
    .reduce(
      (out, key) =>
        !DIGEST_FIELDS.has(key) && typeof value[key] !== "undefined"
          ? { ...out, [key]: stable(value[key]) }
          : out,
      {},
    );
}
function graphDigestFor(domain, value) {
  return sha256(`${domain}\0${canonicalJson(stable(value))}`);
}
function checkDigest(value, field, domain, label) {
  if (
    string(value[field], `${label}.${field}`) !== graphDigestFor(domain, value)
  )
    fail("direct_hierarchical_graph_digest_mismatch", label);
}
function scopeKey(scope) {
  return `${scope.scopeKind}:${scope.projectId || ""}:${scope.workThreadId || ""}`;
}
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
function uniq(values, code) {
  if (new Set(values).size !== values.length) fail(code);
}
function refFor(kind, id, digest, extra = {}) {
  return { kind, id, digest, ...extra };
}
function normalizeScope(input = {}) {
  const s = isPlainObject(input) ? input : {};
  const scopeKind = SCOPE_KINDS.includes(s.scopeKind)
    ? s.scopeKind
    : "user_world";
  const out = {
    scopeKind,
    userProfileId: normalizeId(s.userProfileId, "user_profile"),
    semanticPath: Array.isArray(s.semanticPath)
      ? s.semanticPath.map((v) => normalizeString(v, "")).filter(Boolean)
      : [],
  };
  if (scopeKind !== "user_world")
    out.projectId = normalizeId(s.projectId, "project");
  if (scopeKind === "work_thread")
    out.workThreadId = normalizeId(s.workThreadId, "work_thread");
  return out;
}
function validateScope(scope, label) {
  object(scope, label);
  if (!SCOPE_KINDS.includes(scope.scopeKind))
    fail("direct_hierarchical_graph_invalid_scope", label);
  string(scope.userProfileId, `${label}.userProfileId`);
  array(scope.semanticPath, `${label}.semanticPath`);
  if (scope.scopeKind !== "user_world")
    string(scope.projectId, `${label}.projectId`);
  if (scope.scopeKind === "work_thread")
    string(scope.workThreadId, `${label}.workThreadId`);
}
function buildScopedWorldmodelRevisionRef(input = {}) {
  const s = isPlainObject(input) ? input : {};
  const scopeKind = SCOPE_KINDS.includes(s.scopeKind)
    ? s.scopeKind
    : "user_world";
  const result = {
    schema: DIRECT_SCOPED_WORLDMODEL_REVISION_REF_SCHEMA,
    scopeKind,
    revision: Number.isInteger(s.revision) && s.revision >= 0 ? s.revision : 0,
  };
  if (scopeKind !== "user_world")
    result.projectId = normalizeId(s.projectId, "project");
  if (scopeKind === "work_thread")
    result.workThreadId = normalizeId(s.workThreadId, "work_thread");
  result.digest = graphDigestFor(
    "direct-scoped-worldmodel-revision-ref@1",
    result,
  );
  return result;
}
function validateScopedWorldmodelRevisionRef(value, label = "scopeRevision") {
  object(value, label);
  if (
    value.schema !== DIRECT_SCOPED_WORLDMODEL_REVISION_REF_SCHEMA ||
    !SCOPE_KINDS.includes(value.scopeKind) ||
    !Number.isInteger(value.revision) ||
    value.revision < 0
  )
    fail("direct_hierarchical_graph_invalid_scope_revision", label);
  if (value.scopeKind !== "user_world")
    string(value.projectId, `${label}.projectId`);
  if (value.scopeKind === "work_thread")
    string(value.workThreadId, `${label}.workThreadId`);
  checkDigest(
    value,
    "digest",
    "direct-scoped-worldmodel-revision-ref@1",
    label,
  );
  return true;
}
function buildWorldmodelSemanticNode(input = {}, options = {}) {
  const s = isPlainObject(input) ? input : {};
  const at = normalizeString(s.createdAt, nowIso(options.now || Date.now));
  const result = {
    schema: DIRECT_WORLDMODEL_SEMANTIC_NODE_SCHEMA,
    nodeId: normalizeId(s.nodeId || s.id, "worldmodel_node"),
    graphId: normalizeId(s.graphId, "worldmodel_graph"),
    scope: normalizeScope(s.scope),
    nodeKind: NODE_KINDS.includes(s.nodeKind) ? s.nodeKind : "idea",
    abstractionLevel: [
      "world",
      "strategic",
      "conceptual",
      "operational",
      "execution",
    ].includes(s.abstractionLevel)
      ? s.abstractionLevel
      : "conceptual",
    semanticSummary: normalizeString(
      s.semanticSummary || s.summary,
      "semantic summary pending",
    ),
    odeuImpact: ["O", "E", "D", "U"].reduce(
      (o, k) => ({
        ...o,
        [k]: Array.isArray(s.odeuImpact?.[k]) ? s.odeuImpact[k] : [],
      }),
      {},
    ),
    lifecycle: NODE_LIFECYCLES.includes(s.lifecycle) ? s.lifecycle : "proposed",
    integrationStatus: ["not_integrated", "integrated", "realized"].includes(
      s.integrationStatus,
    )
      ? s.integrationStatus
      : "not_integrated",
    epistemicStatus: EPISTEMIC_STATUSES.includes(s.epistemicStatus)
      ? s.epistemicStatus
      : "unknown",
    normativeForce: [
      "none",
      "informational",
      "preference_hint",
      "project_commitment",
      "binding_constraint",
      "constitutional",
    ].includes(s.normativeForce)
      ? s.normativeForce
      : "none",
    custodianRole: ACTOR_ROLES.includes(s.custodianRole)
      ? s.custodianRole
      : "project_manager",
    authorizedWriterRoles: Array.isArray(s.authorizedWriterRoles)
      ? s.authorizedWriterRoles
      : [],
    projectionEligibility: [
      "eligible",
      "eligible_with_warning",
      "history_only",
      "blocked_conflicted",
      "blocked_stale",
    ].includes(s.projectionEligibility)
      ? s.projectionEligibility
      : "eligible",
    sourceRefs: normalizeOdeuSourceRefs(s.sourceRefs, options),
    promotionTransitionRefs: normalizeOdeuSourceRefs(
      s.promotionTransitionRefs,
      options,
    ),
    invalidationRules: Array.isArray(s.invalidationRules)
      ? s.invalidationRules
      : [],
    revision: Number.isInteger(s.revision) && s.revision >= 1 ? s.revision : 1,
    createdAt: at,
    updatedAt: normalizeString(s.updatedAt, at),
  };
  if (Object.hasOwn(s, "structuredValue"))
    result.structuredValue = s.structuredValue;
  for (const key of ["supersedesNodeId", "supersededByNodeId"])
    if (normalizeString(s[key], "")) result[key] = normalizeId(s[key], "node");
  result.digest = graphDigestFor("direct-worldmodel-semantic-node@1", result);
  return result;
}
function validateWorldmodelSemanticNode(value, label = "node") {
  object(value, label);
  if (value.schema !== DIRECT_WORLDMODEL_SEMANTIC_NODE_SCHEMA)
    fail("direct_hierarchical_graph_schema_mismatch", label);
  string(value.nodeId, `${label}.nodeId`);
  string(value.graphId, `${label}.graphId`);
  validateScope(value.scope, `${label}.scope`);
  if (
    !NODE_KINDS.includes(value.nodeKind) ||
    !NODE_LIFECYCLES.includes(value.lifecycle) ||
    !EPISTEMIC_STATUSES.includes(value.epistemicStatus)
  )
    fail("direct_hierarchical_graph_invalid_node", label);
  validateSourceRefs(value.sourceRefs, `${label}.sourceRefs`);
  validateSourceRefs(
    value.promotionTransitionRefs,
    `${label}.promotionTransitionRefs`,
  );
  if (!Number.isInteger(value.revision) || value.revision < 1)
    fail("direct_hierarchical_graph_invalid_revision", label);
  checkDigest(value, "digest", "direct-worldmodel-semantic-node@1", label);
  return true;
}
function buildWorldmodelSemanticEdge(input = {}, options = {}) {
  const s = isPlainObject(input) ? input : {};
  const result = {
    schema: DIRECT_WORLDMODEL_SEMANTIC_EDGE_SCHEMA,
    edgeId: normalizeId(s.edgeId || s.id, "worldmodel_edge"),
    graphId: normalizeId(s.graphId, "worldmodel_graph"),
    fromNodeId: normalizeId(s.fromNodeId, "from_node"),
    toNodeId: normalizeId(s.toNodeId, "to_node"),
    relationKind: normalizeString(s.relationKind, "relevant_to"),
    epistemicStatus: EDGE_EPISTEMIC_STATUSES.includes(s.epistemicStatus)
      ? s.epistemicStatus
      : "hypothesis",
    lifecycle: ["active", "stale", "superseded", "refuted"].includes(
      s.lifecycle,
    )
      ? s.lifecycle
      : "active",
    sourceRefs: normalizeOdeuSourceRefs(s.sourceRefs, options),
    revision: Number.isInteger(s.revision) && s.revision >= 1 ? s.revision : 1,
  };
  result.digest = graphDigestFor("direct-worldmodel-semantic-edge@1", result);
  return result;
}
function validateWorldmodelSemanticEdge(value, label = "edge") {
  object(value, label);
  if (value.schema !== DIRECT_WORLDMODEL_SEMANTIC_EDGE_SCHEMA)
    fail("direct_hierarchical_graph_schema_mismatch", label);
  for (const k of ["edgeId", "graphId", "fromNodeId", "toNodeId"])
    string(value[k], `${label}.${k}`);
  validateSourceRefs(value.sourceRefs, `${label}.sourceRefs`);
  checkDigest(value, "digest", "direct-worldmodel-semantic-edge@1", label);
  return true;
}
function normalizedMutationDigest(mutations) {
  const basis = mutations
    .map((m) => ({
      mutationKind: m.mutationKind,
      targetId: m.targetId,
      lifecycle: m.lifecycle || "",
      node: m.node
        ? stable({
            ...m.node,
            digest: undefined,
            sourceRefs: undefined,
            promotionTransitionRefs: undefined,
            createdAt: undefined,
            updatedAt: undefined,
            revision: undefined,
          })
        : undefined,
      edge: m.edge
        ? stable({
            ...m.edge,
            digest: undefined,
            sourceRefs: undefined,
            revision: undefined,
          })
        : undefined,
    }))
    .sort((a, b) => canonicalJson(a).localeCompare(canonicalJson(b)));
  return graphDigestFor("direct-worldmodel-normalized-mutation@1", basis);
}
function mutationScopes(graph, mutations) {
  return [
    ...new Map(
      mutations
        .flatMap((m) => {
          const existingNode = graph.nodes.find((n) => n.nodeId === m.targetId);
          const existingEdge = graph.edges.find((e) => e.edgeId === m.targetId);
          if (m.node)
            return [
              buildScopedWorldmodelRevisionRef(
                m.node.scope || existingNode?.scope,
              ),
            ];
          if (m.edge) {
            const a = graph.nodes.find(
              (n) =>
                n.nodeId === (m.edge.fromNodeId || existingEdge?.fromNodeId),
            );
            const b = graph.nodes.find(
              (n) => n.nodeId === (m.edge.toNodeId || existingEdge?.toNodeId),
            );
            return [a, b]
              .filter(Boolean)
              .map((n) => buildScopedWorldmodelRevisionRef(n.scope));
          }
          if (existingEdge)
            return [existingEdge.fromNodeId, existingEdge.toNodeId]
              .map((id) => graph.nodes.find((n) => n.nodeId === id))
              .filter(Boolean)
              .map((n) => buildScopedWorldmodelRevisionRef(n.scope));
          return existingNode?.scope
            ? [buildScopedWorldmodelRevisionRef(existingNode.scope)]
            : [];
        })
        .map((ref) => [scopeKey(ref), ref]),
    ).values(),
  ];
}
function buildWorldmodelGraphWriteAuthorization(input = {}, options = {}) {
  const s = isPlainObject(input) ? input : {};
  const scopes = (s.targetScopeRefs || s.targetScopes || [])
    .map(buildScopedWorldmodelRevisionRef)
    .sort((a, b) => scopeKey(a).localeCompare(scopeKey(b)));
  const expected = (s.expectedScopeRevisions || [])
    .map(buildScopedWorldmodelRevisionRef)
    .sort((a, b) => scopeKey(a).localeCompare(scopeKey(b)));
  const result = {
    schema: DIRECT_WORLDMODEL_GRAPH_WRITE_AUTHORIZATION_SCHEMA,
    authorizationId: normalizeId(
      s.authorizationId || s.id,
      "graph_write_authorization",
    ),
    graphId: normalizeId(s.graphId, "worldmodel_graph"),
    userProfileId: normalizeId(s.userProfileId, "user_profile"),
    actorAgentId: normalizeId(s.actorAgentId, "actor_agent"),
    actorRole: ACTOR_ROLES.includes(s.actorRole)
      ? s.actorRole
      : "project_manager",
    targetScopeRefs: scopes,
    allowedMutationKinds: [
      ...new Set(
        (s.allowedMutationKinds || []).filter((k) =>
          MUTATION_KINDS.includes(k),
        ),
      ),
    ].sort(),
    allowedTargetIds: [
      ...new Set(
        (s.allowedTargetIds || []).map((id) => normalizeId(id, "target")),
      ),
    ].sort(),
    normalizedSemanticMutationDigest: string(
      s.normalizedSemanticMutationDigest,
      "writeAuthorization.normalizedSemanticMutationDigest",
    ),
    expectedScopeRevisions: expected,
    authorityDecisionRef: normalizeOdeuSourceRefs(
      [s.authorityDecisionRef],
      options,
    )[0],
    issuedAt: normalizeString(s.issuedAt, nowIso(options.now || Date.now)),
    expiresAt: normalizeString(s.expiresAt, ""),
    oneTime: s.oneTime !== false,
    idempotencyKey: normalizeString(s.idempotencyKey, ""),
  };
  if (!result.expiresAt)
    fail("direct_hierarchical_graph_authorization_expiry_required");
  result.digest = graphDigestFor(
    "direct-worldmodel-graph-write-authorization@1",
    result,
  );
  return result;
}
function validateWorldmodelGraphWriteAuthorization(
  value,
  label = "writeAuthorization",
) {
  object(value, label);
  if (value.schema !== DIRECT_WORLDMODEL_GRAPH_WRITE_AUTHORIZATION_SCHEMA)
    fail("direct_hierarchical_graph_authorization_schema", label);
  for (const k of [
    "authorizationId",
    "graphId",
    "userProfileId",
    "actorAgentId",
    "normalizedSemanticMutationDigest",
    "issuedAt",
    "expiresAt",
    "idempotencyKey",
  ])
    string(value[k], `${label}.${k}`);
  if (!ACTOR_ROLES.includes(value.actorRole) || value.oneTime !== true)
    fail("direct_hierarchical_graph_authorization_invalid", label);
  array(value.targetScopeRefs, `${label}.targetScopeRefs`).forEach(
    validateScopedWorldmodelRevisionRef,
  );
  array(
    value.expectedScopeRevisions,
    `${label}.expectedScopeRevisions`,
  ).forEach(validateScopedWorldmodelRevisionRef);
  array(value.allowedMutationKinds, `${label}.allowedMutationKinds`);
  array(value.allowedTargetIds, `${label}.allowedTargetIds`);
  if (
    !value.allowedMutationKinds.length ||
    !value.allowedTargetIds.length ||
    !value.targetScopeRefs.length ||
    !value.expectedScopeRevisions.length ||
    !value.allowedMutationKinds.every((k) => MUTATION_KINDS.includes(k))
  )
    fail("direct_hierarchical_graph_authorization_invalid", label);
  validateSourceRefs(
    [value.authorityDecisionRef],
    `${label}.authorityDecisionRef`,
  );
  if (Date.parse(value.expiresAt) <= Date.parse(value.issuedAt))
    fail("direct_hierarchical_graph_authorization_expiry", label);
  checkDigest(
    value,
    "digest",
    "direct-worldmodel-graph-write-authorization@1",
    label,
  );
  return true;
}
function buildGraphWriteAuthorizationForTransition(
  graph,
  input = {},
  options = {},
) {
  const mutations = input.mutations || [];
  return buildWorldmodelGraphWriteAuthorization(
    {
      authorizationId: input.authorizationId,
      graphId: graph.graphId,
      userProfileId: graph.userProfileId,
      actorAgentId: input.actorAgentId,
      actorRole: input.actorRole,
      targetScopeRefs: mutationScopes(graph, mutations),
      allowedMutationKinds: mutations.map((m) => m.mutationKind),
      allowedTargetIds: mutations.map((m) => m.targetId),
      normalizedSemanticMutationDigest: normalizedMutationDigest(mutations),
      expectedScopeRevisions: input.expectedScopeRevisions,
      authorityDecisionRef:
        input.authorityTraceRef || input.authorityDecisionRef,
      issuedAt: input.createdAt,
      expiresAt: input.authorizationExpiresAt || "2099-01-01T00:00:00.000Z",
      idempotencyKey: input.idempotencyKey,
    },
    options,
  );
}
function currentTruth(node) {
  return (
    node.lifecycle === "active" &&
    ["accepted", "observed", "derived", "hypothesis", "unknown"].includes(
      node.epistemicStatus,
    ) &&
    ["eligible", "eligible_with_warning"].includes(node.projectionEligibility)
  );
}
function materialize(nodes, edges) {
  const nodeRefs = nodes.map((n) =>
    refFor("worldmodel_semantic_node", n.nodeId, n.digest, {
      lifecycle: n.lifecycle,
      scope: n.scope,
    }),
  );
  const activeNodeRefs = nodeRefs.filter((r) =>
    currentTruth(nodes.find((n) => n.nodeId === r.id)),
  );
  const active = new Set(activeNodeRefs.map((r) => r.id));
  const edgeRefs = edges.map((e) =>
    refFor("worldmodel_semantic_edge", e.edgeId, e.digest, {
      lifecycle: e.lifecycle,
    }),
  );
  const activeEdgeRefs = edgeRefs.filter((r) => {
    const e = edges.find((x) => x.edgeId === r.id);
    return (
      e.lifecycle === "active" &&
      active.has(e.fromNodeId) &&
      active.has(e.toNodeId)
    );
  });
  const result = {
    schema: DIRECT_HIERARCHICAL_WORLDMODEL_VIEW_SCHEMA,
    nodeRefs,
    edgeRefs,
    activeNodeRefs,
    activeEdgeRefs,
  };
  result.viewDigest = graphDigestFor(
    "direct-hierarchical-worldmodel-materialized-view@1",
    result,
  );
  return result;
}
function versionRef(kind, body) {
  return { kind, id: body.nodeId || body.edgeId, digest: body.digest };
}
function validateVersions(graph) {
  const nodeKeys = graph.nodeVersionBodies.map(
    (n) => `${n.nodeId}:${n.digest}`,
  );
  const edgeKeys = graph.edgeVersionBodies.map(
    (e) => `${e.edgeId}:${e.digest}`,
  );
  uniq(nodeKeys, "direct_hierarchical_graph_duplicate_node_version");
  uniq(edgeKeys, "direct_hierarchical_graph_duplicate_edge_version");
  graph.nodeVersionBodies.forEach(validateWorldmodelSemanticNode);
  graph.edgeVersionBodies.forEach(validateWorldmodelSemanticEdge);
  graph.nodeHistoryRefs.forEach((r) => {
    if (
      !graph.nodeVersionBodies.some(
        (n) => n.nodeId === r.id && n.digest === r.digest,
      )
    )
      fail("direct_hierarchical_graph_history_body_missing", r.id);
  });
  graph.edgeHistoryRefs.forEach((r) => {
    if (
      !graph.edgeVersionBodies.some(
        (e) => e.edgeId === r.id && e.digest === r.digest,
      )
    )
      fail("direct_hierarchical_graph_history_body_missing", r.id);
  });
}
function buildHierarchicalWorldmodelGraph(input = {}, options = {}) {
  const s = isPlainObject(input) ? input : {};
  const graphId = normalizeId(s.graphId, "hierarchical_worldmodel_graph");
  const userProfileId = normalizeId(s.userProfileId, "user_profile");
  if (
    (s.nodes || []).some(
      (n) => n?.scope?.userProfileId && n.scope.userProfileId !== userProfileId,
    )
  )
    fail("direct_hierarchical_graph_foreign_node", "input.scope.userProfileId");
  const nodes = (s.nodes || []).map((n) =>
    buildWorldmodelSemanticNode(
      { ...n, graphId, scope: { ...(n.scope || {}), userProfileId } },
      options,
    ),
  );
  const edges = (s.edges || []).map((e) =>
    buildWorldmodelSemanticEdge({ ...e, graphId }, options),
  );
  uniq(
    nodes.map((n) => n.nodeId),
    "direct_hierarchical_graph_duplicate_node_id",
  );
  uniq(
    edges.map((e) => e.edgeId),
    "direct_hierarchical_graph_duplicate_edge_id",
  );
  const revisions = (s.scopedRevisionRefs || []).map(
    buildScopedWorldmodelRevisionRef,
  );
  if (!revisions.some((r) => r.scopeKind === "user_world"))
    revisions.push(
      buildScopedWorldmodelRevisionRef({
        scopeKind: "user_world",
        revision: 0,
      }),
    );
  uniq(
    revisions.map(scopeKey),
    "direct_hierarchical_graph_duplicate_scope_revision",
  );
  const view = materialize(nodes, edges);
  const graph = {
    schema: DIRECT_HIERARCHICAL_WORLDMODEL_GRAPH_SCHEMA,
    graphId,
    userProfileId,
    rootNodeId: normalizeId(
      s.rootNodeId || nodes.find((n) => n.nodeKind === "world_root")?.nodeId,
      "user_world_root",
    ),
    // Absent only on a portable fixture/shape artifact.  An active graph is
    // created with the harness store's unforgeable anchor and is never allowed
    // to use request-owned governance as authority.
    ...(s.trustAnchorRef ? { trustAnchorRef: clone(s.trustAnchorRef) } : {}),
    scopedRevisionRefs: revisions,
    projectRootRefs: [],
    transitions: [],
    nodeVersionBodies: clone(nodes),
    edgeVersionBodies: clone(edges),
    nodeHistoryRefs: nodes.map((n) => ({
      ...versionRef("worldmodel_semantic_node", n),
      lifecycle: n.lifecycle,
    })),
    edgeHistoryRefs: edges.map((e) => ({
      ...versionRef("worldmodel_semantic_edge", e),
      lifecycle: e.lifecycle,
    })),
    consumedWriteAuthorizationRefs: [],
    consumedContextualAdmissionRefs: [],
    consumedPropagationTransactionRefs: [],
    genesis: {
      nodes: clone(nodes),
      edges: clone(edges),
      scopedRevisionRefs: clone(revisions),
    },
    nodes,
    edges,
    materializedView: view,
    currentMaterializedViewRef: refFor(
      "worldmodel_materialized_view",
      graphId,
      view.viewDigest,
    ),
    materializedAt: normalizeString(
      s.materializedAt,
      nowIso(options.now || Date.now),
    ),
    transitionLedgerHeadRef: {
      sourceRefId: `worldmodel_graph_${graphId}_genesis`,
      sourceKind: "worldmodel_graph",
      sourceId: graphId,
      sourceConfidence: "fixture",
      freshness: "fresh",
      observedAt: normalizeString(
        s.materializedAt,
        nowIso(options.now || Date.now),
      ),
    },
  };
  graph.projectRootRefs = nodes
    .filter((n) => n.nodeKind === "project_root")
    .map((n) => ({
      projectId: n.scope.projectId,
      rootNodeId: n.nodeId,
      revision:
        revisions.find((r) => scopeKey(r) === scopeKey(n.scope))?.revision || 0,
      digest: n.digest,
    }));
  graph.digest = graphDigestFor(
    "direct-hierarchical-worldmodel-graph@1",
    graph,
  );
  return graph;
}
function validateHierarchicalWorldmodelGraph(graph, label = "graph") {
  object(graph, label);
  if (graph.schema !== DIRECT_HIERARCHICAL_WORLDMODEL_GRAPH_SCHEMA)
    fail("direct_hierarchical_graph_schema_mismatch", label);
  string(graph.graphId, `${label}.graphId`);
  string(graph.userProfileId, `${label}.userProfileId`);
  if (graph.trustAnchorRef) {
    object(graph.trustAnchorRef, `${label}.trustAnchorRef`);
    if (graph.trustAnchorRef.kind !== "worldmodel_trust_store" || !normalizeString(graph.trustAnchorRef.storeId, "") || graph.trustAnchorRef.graphId !== graph.graphId || !/^sha256:[a-f0-9]{64}$/i.test(normalizeString(graph.trustAnchorRef.authorityIdentityDigest, "")) || !/^sha256:[a-f0-9]{64}$/i.test(normalizeString(graph.trustAnchorRef.anchorDigest, ""))) fail("direct_hierarchical_graph_trust_anchor_invalid", label);
  }
  array(graph.nodes, `${label}.nodes`);
  array(graph.edges, `${label}.edges`);
  uniq(
    graph.nodes.map((n) => n.nodeId),
    "direct_hierarchical_graph_duplicate_node_id",
  );
  uniq(
    graph.edges.map((e) => e.edgeId),
    "direct_hierarchical_graph_duplicate_edge_id",
  );
  array(graph.scopedRevisionRefs, `${label}.scopedRevisionRefs`).forEach(
    validateScopedWorldmodelRevisionRef,
  );
  array(graph.consumedPropagationTransactionRefs, `${label}.consumedPropagationTransactionRefs`).forEach((ref) => validateSourceRefs([ref], `${label}.consumedPropagationTransactionRefs`));
  uniq(
    graph.scopedRevisionRefs.map(scopeKey),
    "direct_hierarchical_graph_duplicate_scope_revision",
  );
  graph.nodes.forEach((n) => {
    validateWorldmodelSemanticNode(n);
    if (
      n.graphId !== graph.graphId ||
      n.scope.userProfileId !== graph.userProfileId
    )
      fail("direct_hierarchical_graph_foreign_node", n.nodeId);
  });
  graph.edges.forEach((e) => {
    validateWorldmodelSemanticEdge(e);
    if (
      e.graphId !== graph.graphId ||
      !graph.nodes.some((n) => n.nodeId === e.fromNodeId) ||
      !graph.nodes.some((n) => n.nodeId === e.toNodeId)
    )
      fail("direct_hierarchical_graph_dangling_edge", e.edgeId);
  });
  validateVersions(graph);
  object(graph.materializedView, `${label}.materializedView`);
  checkDigest(
    graph.materializedView,
    "viewDigest",
    "direct-hierarchical-worldmodel-materialized-view@1",
    `${label}.materializedView`,
  );
  if (
    canonicalJson(materialize(graph.nodes, graph.edges)) !==
    canonicalJson(graph.materializedView)
  )
    fail("direct_hierarchical_graph_materialized_view_mismatch", label);
  checkDigest(graph, "digest", "direct-hierarchical-worldmodel-graph@1", label);
  return true;
}
function validateWorldmodelGraphReplayConsistency(graph, label = "graphReplay", context = {}) {
  if (isPlainObject(label)) { context = label; label = "graphReplay"; }
  validateHierarchicalWorldmodelGraph(graph, label);
  for (let index = 0; index < graph.transitions.length; index += 1) {
    const transition = graph.transitions[index];
    if (transition.schema !== DIRECT_WORLDMODEL_GRAPH_TRANSITION_SCHEMA || transition.chainPosition !== index + 1 || !normalizeString(transition.actorAgentId, "") || !ACTOR_ROLES.includes(transition.actorRole) || !transition.writeAuthorizationRef?.digest || !transition.contextualAdmissionRef?.digest || !Array.isArray(transition.mutations) || !transition.mutations.length || transition.digest !== graphDigestFor("direct-worldmodel-graph-transition@2", transition)) fail("direct_hierarchical_graph_transition_receipt_invalid", transition.transitionId || String(index));
    if (
      index &&
      transition.previousTransitionDigest !==
        graph.transitions[index - 1].digest
    )
      fail(
        "direct_hierarchical_graph_transition_chain_mismatch",
        transition.transitionId,
      );
    for (const receipt of transition.mutations) {
      const bodies =
        receipt.afterRef.kind === "worldmodel_semantic_node"
          ? graph.nodeVersionBodies
          : graph.edgeVersionBodies;
      if (
        !bodies.some(
          (body) =>
            (body.nodeId || body.edgeId) === receipt.afterRef.id &&
            body.digest === receipt.afterRef.digest &&
            body.digest === receipt.afterDigest,
        )
      )
        fail(
          "direct_hierarchical_graph_transition_body_mismatch",
          receipt.targetId,
        );
      if (receipt.beforeRef) {
        const priorBodies =
          receipt.beforeRef.kind === "worldmodel_semantic_node"
            ? graph.nodeVersionBodies
            : graph.edgeVersionBodies;
        if (
          !priorBodies.some(
            (body) =>
              (body.nodeId || body.edgeId) === receipt.beforeRef.id &&
              body.digest === receipt.beforeRef.digest &&
              body.digest === receipt.beforeDigest,
          )
        )
          fail(
            "direct_hierarchical_graph_transition_body_mismatch",
            receipt.targetId,
          );
      }
    }
  }
  const replayNodes = new Map(
    graph.genesis.nodes.map((node) => [node.nodeId, node]),
  );
  const replayEdges = new Map(
    graph.genesis.edges.map((edge) => [edge.edgeId, edge]),
  );
  let replayRevisions = graph.genesis.scopedRevisionRefs;
  for (const transition of graph.transitions) {
    for (const receipt of transition.mutations) {
      const bodies =
        receipt.afterRef.kind === "worldmodel_semantic_node"
          ? graph.nodeVersionBodies
          : graph.edgeVersionBodies;
      const body = bodies.find(
        (entry) =>
          (entry.nodeId || entry.edgeId) === receipt.afterRef.id &&
          entry.digest === receipt.afterRef.digest,
      );
      if (receipt.afterRef.kind === "worldmodel_semantic_node")
        replayNodes.set(body.nodeId, body);
      else replayEdges.set(body.edgeId, body);
    }
    const expectedResult = replayRevisions.map((ref) =>
      transition.touchedScopeKeys.includes(scopeKey(ref))
        ? buildScopedWorldmodelRevisionRef({
            ...ref,
            revision: ref.revision + 1,
          })
        : ref,
    );
    if (
      canonicalJson(expectedResult) !==
      canonicalJson(
        transition.resultingScopeRevisions.length
          ? replayRevisions.map(
              (ref) =>
                transition.resultingScopeRevisions.find(
                  (next) => scopeKey(next) === scopeKey(ref),
                ) || ref,
            )
          : replayRevisions,
      )
    )
      fail(
        "direct_hierarchical_graph_replay_revision_mismatch",
        transition.transitionId,
      );
    replayRevisions = expectedResult;
  }
  if (
    canonicalJson(
      [...replayNodes.values()]
        .sort((a, b) => a.nodeId.localeCompare(b.nodeId))
        .map((node) => node.digest),
    ) !==
      canonicalJson(
        [...graph.nodes]
          .sort((a, b) => a.nodeId.localeCompare(b.nodeId))
          .map((node) => node.digest),
      ) ||
    canonicalJson(
      [...replayEdges.values()]
        .sort((a, b) => a.edgeId.localeCompare(b.edgeId))
        .map((edge) => edge.digest),
    ) !==
      canonicalJson(
        [...graph.edges]
          .sort((a, b) => a.edgeId.localeCompare(b.edgeId))
          .map((edge) => edge.digest),
      ) ||
    canonicalJson(replayRevisions) !== canonicalJson(graph.scopedRevisionRefs)
  )
    fail("direct_hierarchical_graph_replay_mismatch", label);
  const expectedHead = graph.transitions.length
    ? graph.transitions.at(-1).transitionId
    : graph.graphId;
  if (
    graph.transitions.length &&
    graph.transitionLedgerHeadRef?.sourceId !== expectedHead
  )
    fail("direct_hierarchical_graph_ledger_head_mismatch", graph.graphId);
  if (context.trustStore) {
    try { require("./governance-trust-store").readAuthoritativeWorldmodelGraph(context.trustStore, graph); }
    catch (error) { fail(error.code || "direct_hierarchical_graph_trust_store_replay_invalid", graph.graphId); }
  }
  return true;
}
function validateWorldmodelGraphReplay(graph, label = "graphReplay", context = {}) {
  if (isPlainObject(label)) { context = label; label = "graphReplay"; }
  if (!graph?.trustAnchorRef) fail("direct_hierarchical_graph_trust_anchor_required", label);
  let store;
  try { store = require("./governance-trust-store").resolveAuthoritativeWorldmodelTrustStore(graph); }
  catch (error) { fail(error.code || "direct_hierarchical_graph_trust_store_replay_invalid", graph?.graphId); }
  return validateWorldmodelGraphReplayConsistency(graph, label, { trustStore: store });
}
function validateLegacyNonWave26WorldmodelGraphReplay(graph, label = "graphReplay", context = {}) {
  if (isPlainObject(label)) { context = label; label = "graphReplay"; }
  if (graph?.trustAnchorRef) fail("direct_hierarchical_graph_legacy_anchor_forbidden", label);
  return validateWorldmodelGraphReplayConsistency(graph, label, context);
}
function remand(graph, code) {
  return { graph, committed: false, remand: { code }, transition: null };
}
function validateContextualAdmission(graph, input, mutations, governanceRegistry) {
  const admission = input.contextualAdmission;
  if (!admission)
    return "direct_hierarchical_graph_contextual_admission_required";
  try {
    require("./semantic-ingress").validateWorldmodelContextualAdmission(
      admission,
      { graph, governanceRegistry },
    );
  } catch (error) {
    return (
      error.code || "direct_hierarchical_graph_contextual_admission_invalid"
    );
  }
  if (
    admission.actorAgentId !== input.actorAgentId ||
    admission.actorRole !== input.actorRole ||
    canonicalJson(admission.mutations) !== canonicalJson(mutations) ||
    canonicalJson(
      admission.expectedScopeRevisions.map((ref) => ref.digest).sort(),
    ) !==
      canonicalJson(
        (input.expectedScopeRevisions || [])
          .map(buildScopedWorldmodelRevisionRef)
          .map((ref) => ref.digest)
          .sort(),
      ) ||
    graph.consumedContextualAdmissionRefs.some(
      (ref) =>
        ref.id === admission.admissionId && ref.digest === admission.digest,
    )
  )
    return "direct_hierarchical_graph_contextual_admission_mismatch";
  return "";
}
function appendWorldmodelGraphTransition(graphInput, input = {}, options = {}) {
  validateHierarchicalWorldmodelGraph(graphInput);
  const graph = clone(graphInput);
  const legacy = options[LEGACY_NON_WAVE26_APPEND] === true;
  if (!graphInput.trustAnchorRef && !legacy)
    return remand(graph, "direct_hierarchical_graph_trust_anchor_required");
  const requestedTransitionId = normalizeId(
    input.transitionId || input.id,
    "worldmodel_transition",
  );
  if (graph.transitions.some((transition) => transition.transitionId === requestedTransitionId))
    return remand(graph, "direct_hierarchical_graph_transition_reused");
  const propagationTransactionRef = input.propagationTransactionRef
    ? normalizeOdeuSourceRefs([input.propagationTransactionRef], options)[0]
    : null;
  if (propagationTransactionRef && graph.consumedPropagationTransactionRefs.some((ref) => ref.sourceId === propagationTransactionRef.sourceId && ref.sourceDigest?.value === propagationTransactionRef.sourceDigest?.value))
    return remand(graph, "direct_hierarchical_graph_propagation_transaction_reused");
  const mutations = Array.isArray(input.mutations) ? input.mutations : [];
  if (!mutations.length)
    return remand(graph, "direct_hierarchical_graph_missing_mutation");
  // The authority is resolved from the graph's pinned anchor, not from a
  // request-owned store handle.  Request governance can be compared as
  // evidence, but exact store-owned bodies drive every validation below.
  let authoritativeStoreContext; let authoritativeStore;
  if (!legacy) {
    try {
      const trust = require("./governance-trust-store");
      authoritativeStore = trust.resolveAuthoritativeWorldmodelTrustStore(graphInput);
      if (!input.storeAdmission) return remand(graph, "direct_hierarchical_graph_store_admission_required");
      authoritativeStoreContext = trust.validateWorldmodelStoreAdmission(authoritativeStore, graphInput, input.storeAdmission, {
        agentId: input.actorAgentId, role: input.actorRole, purpose: "graph_append", requiredArtifacts: input.contextualAdmission?.registryRequiredArtifacts || [],
      });
    } catch (error) { return remand(graph, error.code || "direct_hierarchical_graph_store_admission_invalid"); }
  }
  const governanceRegistry = legacy ? input.governanceRegistry : authoritativeStoreContext.governanceRegistry;
  const contextualAdmissionError = validateContextualAdmission(
    graphInput,
    input,
    mutations,
    governanceRegistry,
  );
  if (contextualAdmissionError) return remand(graph, contextualAdmissionError);
  let nextGovernanceRegistry;
  try {
    const { consumeGovernanceProvenanceAdmission } = require("./governance-provenance-registry");
    const admission = input.contextualAdmission;
    nextGovernanceRegistry = consumeGovernanceProvenanceAdmission(governanceRegistry, {
      registryRef: admission.registryRef, expectedRegistryRevision: admission.registryRevision,
      graphId: graph.graphId, graphDigest: graph.digest, userProfileId: graph.userProfileId,
      scopeKind: admission.candidate.targetScope.scopeKind, projectId: admission.candidate.targetScope.projectId, workThreadId: admission.candidate.targetScope.workThreadId,
      projectRootNodeId: graph.nodes.find((node) => node.nodeKind === "project_root" && node.scope.projectId === admission.candidate.targetScope.projectId)?.nodeId,
      role: admission.actorRole, agentId: admission.actorAgentId, purpose: "graph_append",
      expectedScopeRevisionDigest: admission.expectedScopeRevisions.find((ref) => ref.scopeKind === admission.candidate.targetScope.scopeKind && ref.projectId === admission.candidate.targetScope.projectId && ref.workThreadId === admission.candidate.targetScope.workThreadId)?.digest,
      requiredArtifacts: admission.registryRequiredArtifacts,
      consumeArtifacts: admission.registryRequiredArtifacts.filter((artifact) => artifact.kind === "authority_decision"),
      transitionId: `consume_${requestedTransitionId}`, createdAt: input.createdAt,
    }, options);
  } catch (error) {
    return remand(graph, error.code || "direct_hierarchical_graph_governance_registry_invalid");
  }
  const authorization =
    input.writeAuthorization || input.graphWriteAuthorization;
  if (!authorization)
    return remand(
      graph,
      "direct_hierarchical_graph_write_authorization_required",
    );
  try {
    validateWorldmodelGraphWriteAuthorization(authorization);
  } catch (e) {
    return remand(
      graph,
      e.code || "direct_hierarchical_graph_write_authorization_invalid",
    );
  }
  const now = Date.parse(nowIso(options.now || Date.now));
  if (Date.parse(authorization.expiresAt) <= now)
    return remand(
      graph,
      "direct_hierarchical_graph_write_authorization_expired",
    );
  const digest = normalizedMutationDigest(mutations);
  if (
    authorization.graphId !== graph.graphId ||
    authorization.userProfileId !== graph.userProfileId ||
    authorization.actorAgentId !== input.actorAgentId ||
    authorization.actorRole !== input.actorRole ||
    authorization.normalizedSemanticMutationDigest !== digest ||
    !mutations.every(
      (m) =>
        authorization.allowedMutationKinds.includes(m.mutationKind) &&
        authorization.allowedTargetIds.includes(m.targetId),
    )
  )
    return remand(
      graph,
      "direct_hierarchical_graph_write_authorization_mismatch",
    );
  const expected = (input.expectedScopeRevisions || []).map(
    buildScopedWorldmodelRevisionRef,
  );
  const scopes = mutationScopes(graph, mutations);
  if (
    !scopes.length ||
    new Set(scopes.map(scopeKey)).size !== scopes.length ||
    canonicalJson(scopes.map(scopeKey).sort()) !==
      canonicalJson(authorization.targetScopeRefs.map(scopeKey).sort()) ||
    canonicalJson(expected.map((r) => r.digest).sort()) !==
      canonicalJson(
        authorization.expectedScopeRevisions.map((r) => r.digest).sort(),
      )
  )
    return remand(
      graph,
      "direct_hierarchical_graph_write_authorization_scope_mismatch",
    );
  if (
    expected.some(
      (r) => !graph.scopedRevisionRefs.some((c) => c.digest === r.digest),
    )
  )
    return remand(graph, "direct_hierarchical_graph_stale_scope_revision");
  if (
    graph.consumedWriteAuthorizationRefs.some(
      (r) =>
        r.id === authorization.authorizationId &&
        r.digest === authorization.digest,
    )
  )
    return remand(
      graph,
      "direct_hierarchical_graph_write_authorization_reused",
    );
  if (
    graph.transitions.some(
      (t) =>
        t.normalizedSemanticMutationDigest === digest &&
        t.actorAgentId === input.actorAgentId &&
        t.actorRole === input.actorRole &&
        canonicalJson(t.touchedScopeKeys) ===
          canonicalJson(scopes.map(scopeKey).sort()),
    )
  )
    return remand(
      graph,
      "direct_hierarchical_graph_duplicate_semantic_mutation",
    );
  const nodes = new Map(graph.nodes.map((n) => [n.nodeId, n]));
  const edges = new Map(graph.edges.map((e) => [e.edgeId, e]));
  const receipts = [];
  for (const m of mutations) {
    if (
      ["add_node", "revise_node", "set_node_lifecycle"].includes(m.mutationKind)
    ) {
      const prior = nodes.get(m.targetId);
      if (m.mutationKind === "add_node" && prior)
        return remand(graph, "direct_hierarchical_graph_add_target_exists");
      if (m.mutationKind !== "add_node" && !prior)
        return remand(
          graph,
          "direct_hierarchical_graph_mutation_target_missing",
        );
      const body = buildWorldmodelSemanticNode(
        {
          ...(prior || {}),
          ...(m.node || {}),
          nodeId: m.targetId,
          graphId: graph.graphId,
          scope: m.node?.scope || prior?.scope,
          revision: (prior?.revision || 0) + 1,
          ...(m.mutationKind === "set_node_lifecycle"
            ? { lifecycle: m.lifecycle }
            : {}),
        },
        options,
      );
      if (body.scope.userProfileId !== graph.userProfileId)
        return remand(graph, "direct_hierarchical_graph_foreign_node");
      if (
        body.custodianRole !== input.actorRole ||
        !body.authorizedWriterRoles.includes(input.actorRole)
      )
        return remand(graph, "direct_hierarchical_graph_custody_denied");
      nodes.set(body.nodeId, body);
      receipts.push({
        mutationKind: m.mutationKind,
        targetId: body.nodeId,
        ...(prior
          ? {
              beforeRef: versionRef("worldmodel_semantic_node", prior),
              beforeDigest: prior.digest,
            }
          : {}),
        afterRef: versionRef("worldmodel_semantic_node", body),
        afterDigest: body.digest,
      });
    } else {
      const prior = edges.get(m.targetId);
      if (m.mutationKind === "add_edge" && prior)
        return remand(graph, "direct_hierarchical_graph_add_target_exists");
      if (m.mutationKind !== "add_edge" && !prior)
        return remand(
          graph,
          "direct_hierarchical_graph_mutation_target_missing",
        );
      const body = buildWorldmodelSemanticEdge(
        {
          ...(prior || {}),
          ...(m.edge || {}),
          edgeId: m.targetId,
          graphId: graph.graphId,
          revision: (prior?.revision || 0) + 1,
        },
        options,
      );
      if (!nodes.has(body.fromNodeId) || !nodes.has(body.toNodeId))
        return remand(graph, "direct_hierarchical_graph_dangling_edge");
      if (
        ![nodes.get(body.fromNodeId), nodes.get(body.toNodeId)].every(
          (node) =>
            node.custodianRole === input.actorRole &&
            node.authorizedWriterRoles.includes(input.actorRole),
        )
      )
        return remand(graph, "direct_hierarchical_graph_custody_denied");
      edges.set(body.edgeId, body);
      receipts.push({
        mutationKind: m.mutationKind,
        targetId: body.edgeId,
        ...(prior
          ? {
              beforeRef: versionRef("worldmodel_semantic_edge", prior),
              beforeDigest: prior.digest,
            }
          : {}),
        afterRef: versionRef("worldmodel_semantic_edge", body),
        afterDigest: body.digest,
      });
    }
  }
  const touched = graph.scopedRevisionRefs.map((r) =>
    scopes.some((s) => scopeKey(s) === scopeKey(r))
      ? buildScopedWorldmodelRevisionRef({ ...r, revision: r.revision + 1 })
      : r,
  );
  const transition = {
    schema: DIRECT_WORLDMODEL_GRAPH_TRANSITION_SCHEMA,
    transitionId: requestedTransitionId,
    graphId: graph.graphId,
    deltaCandidateId: normalizeId(input.deltaCandidateId, "delta_candidate"),
    actorAgentId: input.actorAgentId,
    actorRole: input.actorRole,
    chainPosition: graph.transitions.length + 1,
    writeAuthorizationRef: {
      id: authorization.authorizationId,
      digest: authorization.digest,
    },
    contextualAdmissionRef: {
      id: input.contextualAdmission.admissionId,
      digest: input.contextualAdmission.digest,
    },
    ...(graph.trustAnchorRef ? { trustAnchorRef: clone(graph.trustAnchorRef), storeAdmissionRef: { id: input.storeAdmission.admissionId, digest: input.storeAdmission.digest, storeRevision: input.storeAdmission.storeRevision } } : {}),
    normalizedSemanticMutationDigest: digest,
    touchedScopeKeys: scopes.map(scopeKey).sort(),
    mutations: receipts,
    expectedScopeRevisions: expected,
    resultingScopeRevisions: touched.filter((r) =>
      scopes.some((s) => scopeKey(s) === scopeKey(r)),
    ),
    sourceRefs: normalizeOdeuSourceRefs(input.sourceRefs, options),
    idempotencyKey: authorization.idempotencyKey,
    outcome: "committed",
    createdAt: normalizeString(
      input.createdAt,
      nowIso(options.now || Date.now),
    ),
    ...(graph.transitions.length
      ? { previousTransitionDigest: graph.transitions.at(-1).digest }
      : {}),
  };
  transition.digest = graphDigestFor(
    "direct-worldmodel-graph-transition@2",
    transition,
  );
  graph.nodes = [...nodes.values()];
  graph.edges = [...edges.values()];
  graph.scopedRevisionRefs = touched;
  graph.transitions.push(transition);
  graph.nodeVersionBodies = [
    ...graph.nodeVersionBodies,
    ...receipts
      .filter((r) => r.afterRef.kind === "worldmodel_semantic_node")
      .map((r) => nodes.get(r.targetId)),
  ];
  graph.edgeVersionBodies = [
    ...graph.edgeVersionBodies,
    ...receipts
      .filter((r) => r.afterRef.kind === "worldmodel_semantic_edge")
      .map((r) => edges.get(r.targetId)),
  ];
  graph.nodeHistoryRefs = graph.nodeVersionBodies.map((n) => ({
    ...versionRef("worldmodel_semantic_node", n),
    lifecycle: n.lifecycle,
  }));
  graph.edgeHistoryRefs = graph.edgeVersionBodies.map((e) => ({
    ...versionRef("worldmodel_semantic_edge", e),
    lifecycle: e.lifecycle,
  }));
  graph.consumedWriteAuthorizationRefs.push({
    id: authorization.authorizationId,
    digest: authorization.digest,
  });
  graph.consumedContextualAdmissionRefs.push({
    id: input.contextualAdmission.admissionId,
    digest: input.contextualAdmission.digest,
  });
  if (propagationTransactionRef) graph.consumedPropagationTransactionRefs.push(propagationTransactionRef);
  graph.materializedView = materialize(graph.nodes, graph.edges);
  graph.currentMaterializedViewRef = refFor(
    "worldmodel_materialized_view",
    graph.graphId,
    graph.materializedView.viewDigest,
  );
  graph.materializedAt = transition.createdAt;
  graph.transitionLedgerHeadRef = {
    sourceRefId: `worldmodel_transition_${transition.transitionId}`,
    sourceKind: "worldmodel_graph_transition",
    sourceId: transition.transitionId,
    sourceConfidence: "accepted",
    freshness: "fresh",
    observedAt: transition.createdAt,
  };
  graph.projectRootRefs = graph.nodes
    .filter((n) => n.nodeKind === "project_root")
    .map((n) => ({
      projectId: n.scope.projectId,
      rootNodeId: n.nodeId,
      revision:
        graph.scopedRevisionRefs.find((r) => scopeKey(r) === scopeKey(n.scope))
          ?.revision || 0,
      digest: n.digest,
    }));
  graph.digest = graphDigestFor(
    "direct-hierarchical-worldmodel-graph@1",
    graph,
  );
  if (!legacy) {
    try {
      require("./governance-trust-store").commitAuthoritativeWorldmodelGraph(authoritativeStore, graphInput, graph, nextGovernanceRegistry, input.storeAdmission);
    } catch (error) { return remand(graphInput, error.code || "direct_hierarchical_graph_store_commit_failed"); }
  }
  return { graph, governanceRegistry: nextGovernanceRegistry, transition, committed: true, remand: null };
}
function appendLegacyNonWave26WorldmodelGraphTransition(graph, input = {}, options = {}) {
  if (graph?.trustAnchorRef) return remand(clone(graph), "direct_hierarchical_graph_legacy_anchor_forbidden");
  return appendWorldmodelGraphTransition(graph, input, { ...options, [LEGACY_NON_WAVE26_APPEND]: true });
}
function buildWorldmodelHistoryProjection(graph, input = {}) {
  validateHierarchicalWorldmodelGraph(graph);
  const scope = input.focalScope || input.scope || {};
  const historyNodeRefs = graph.nodeVersionBodies
    .filter(
      (n) =>
        n.scope.scopeKind === scope.scopeKind &&
        n.scope.projectId === scope.projectId &&
        n.scope.workThreadId === scope.workThreadId &&
        !currentTruth(n),
    )
    .map((n) => ({
      ...versionRef("worldmodel_semantic_node", n),
      lifecycle: n.lifecycle,
      epistemicStatus: n.epistemicStatus,
      projectionEligibility: n.projectionEligibility,
    }));
  const result = {
    schema: DIRECT_WORLDMODEL_HISTORY_PROJECTION_SCHEMA,
    projectionId: normalizeId(
      input.projectionId,
      "worldmodel_history_projection",
    ),
    graphRef: { graphId: graph.graphId, graphDigest: graph.digest },
    focalScope: {
      scopeKind: scope.scopeKind,
      ...(scope.projectId ? { projectId: scope.projectId } : {}),
      ...(scope.workThreadId ? { workThreadId: scope.workThreadId } : {}),
    },
    sourceScopeRevisions: graph.scopedRevisionRefs.filter(
      (r) => scopeKey(r) === scopeKey(scope),
    ),
    historyNodeRefs,
    activeGraphTruthIncluded: false,
    rawTranscriptIncluded: false,
    grantsAuthority: false,
  };
  result.projectionDigest = graphDigestFor(
    "direct-worldmodel-history-projection@1",
    result,
  );
  return result;
}
function validateWorldmodelHistoryProjection(value, label = "history") {
  object(value, label);
  if (
    value.schema !== DIRECT_WORLDMODEL_HISTORY_PROJECTION_SCHEMA ||
    value.activeGraphTruthIncluded !== false ||
    value.rawTranscriptIncluded !== false ||
    value.grantsAuthority !== false
  )
    fail("direct_hierarchical_graph_history_projection_boundary", label);
  checkDigest(
    value,
    "projectionDigest",
    "direct-worldmodel-history-projection@1",
    label,
  );
  return true;
}
module.exports = {
  DIRECT_HIERARCHICAL_WORLDMODEL_GRAPH_SCHEMA,
  DIRECT_SCOPED_WORLDMODEL_REVISION_REF_SCHEMA,
  DIRECT_WORLDMODEL_SEMANTIC_NODE_SCHEMA,
  DIRECT_WORLDMODEL_SEMANTIC_EDGE_SCHEMA,
  DIRECT_WORLDMODEL_GRAPH_TRANSITION_SCHEMA,
  DIRECT_WORLDMODEL_GRAPH_WRITE_AUTHORIZATION_SCHEMA,
  DIRECT_HIERARCHICAL_WORLDMODEL_VIEW_SCHEMA,
  DIRECT_WORLDMODEL_HISTORY_PROJECTION_SCHEMA,
  INTEGRATION_STATUSES: ["not_integrated", "integrated", "realized"],
  buildScopedWorldmodelRevisionRef,
  validateScopedWorldmodelRevisionRef,
  buildWorldmodelSemanticNode,
  validateWorldmodelSemanticNode,
  buildWorldmodelSemanticEdge,
  validateWorldmodelSemanticEdge,
  buildWorldmodelGraphWriteAuthorization,
  validateWorldmodelGraphWriteAuthorization,
  buildGraphWriteAuthorizationForTransition,
  buildHierarchicalWorldmodelGraph,
  validateHierarchicalWorldmodelGraph,
  validateWorldmodelGraphReplay,
  validateLegacyNonWave26WorldmodelGraphReplay,
  appendWorldmodelGraphTransition,
  appendLegacyNonWave26WorldmodelGraphTransition,
  buildWorldmodelHistoryProjection,
  validateWorldmodelHistoryProjection,
  normalizedMutationDigest,
  graphDigestFor,
};
