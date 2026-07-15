"use strict";

// Wave 26 PR157 is intentionally a compatibility overlay.  It classifies
// legacy artifacts and emits deterministic, append-only migration evidence; it
// never rewrites a legacy store, mines a transcript, or turns legacy memory
// into current graph truth without the normal PR153 promotion controller.
const { canonicalJson, sha256 } = require("../meta-session/digest");
const fs = require("node:fs");
const path = require("node:path");
const {
  isPlainObject,
  normalizeId,
  normalizeString,
} = require("../meta-session/ids");
const { normalizeOdeuSourceRefs } = require("../odeu/source-ref");
const { buildAgentMemoryRow } = require("../bridge/agent-memory-store");
const { buildWorkThread } = require("../bridge/work-thread-registry");
const {
  buildManagerScopeMigrationWitness,
  validateHierarchicalWorldmodelMigrationWitness,
} = require("./project-manager");
const {
  buildWorldmodelManagerProfile,
  validateWorldmodelManagerProfile,
} = require("./manager");
const {
  buildScopedWorldMemoryBinding,
  validateScopedWorldMemoryBinding,
} = require("./project-memory-propagation");
const {
  appendWorldmodelGraphTransition,
  buildWorldmodelSemanticNode,
  validateWorldmodelSemanticNode,
  validateHierarchicalWorldmodelGraph,
} = require("./hierarchical-graph");
const { validateWorldmodelGraphProjection } = require("./graph-projection");

const WORLDMODEL_MIGRATION_REPORT_SCHEMA =
  "direct_worldmodel_migration_report@1";
const LEGACY_AGENT_MEMORY_PROMOTION_CANDIDATE_SCHEMA =
  "direct_legacy_agent_memory_promotion_candidate@1";
const WORK_THREAD_PROJECT_PARENT_LINKAGE_WITNESS_SCHEMA =
  "direct_work_thread_project_parent_linkage_witness@1";
const SCOPED_WORLD_MEMORY_NO_DOUBLE_INCLUSION_WITNESS_SCHEMA =
  "direct_scoped_world_memory_no_double_inclusion_witness@1";
const ARTIFACT_DRIFT_STALE_WITNESS_SCHEMA =
  "direct_artifact_drift_stale_witness@1";
const MEMORY_AUTHORITY_CUTOVER_REGISTRY_SCHEMA =
  "direct_memory_authority_cutover_registry@1";
const MEMORY_AUTHORITY_CUTOVER_RECEIPT_SCHEMA =
  "direct_memory_authority_cutover_receipt@1";
const MEMORY_AUTHORITY_CUTOVER_RUNTIME_SCHEMA =
  "direct_memory_authority_cutover_runtime@1";
const MEMORY_AUTHORITY_CUTOVER_RUNTIME_HEAD_SCHEMA =
  "direct_memory_authority_cutover_runtime_head@1";
const MEMORY_AUTHORITY_CUTOVER_RUNTIME_LEDGER_ENTRY_SCHEMA =
  "direct_memory_authority_cutover_runtime_ledger_entry@1";

// This is intentionally a capability, not a serializable request shape.  The
// normal AgentMemory selector may read a current head from one of these
// factory-owned runtimes, but it cannot turn a caller's resolver or registry
// into authority.
const memoryAuthorityRuntimeState = new WeakMap();

const DIGEST_FIELDS = new Set([
  "digest",
  "reportDigest",
  "candidateDigest",
  "linkageDigest",
  "witnessDigest",
  "registryDigest",
  "receiptDigest",
]);
const MEMORY_NODE_KINDS = Object.freeze({
  project_fact: "idea",
  decision: "decision",
  constraint: "constraint",
  open_question: "open_question",
  risk: "risk",
  procedure: "procedure",
  pattern: "idea",
  preference: "preference",
});
const CANDIDATE_CLASSIFICATIONS = new Set([
  "agent_private_remains_private",
  "world_manager_review_required",
  "legacy_candidate_not_accepted",
  "project_world_promotion_candidate",
]);
const SHA256 = /^sha256:[a-f0-9]{64}$/i;

function fail(code, detail = "") {
  const error = new Error(detail ? `${code}:${detail}` : code);
  error.code = code;
  throw error;
}
function object(value, label) {
  if (!isPlainObject(value))
    fail("direct_worldmodel_migration_invalid_object", label);
  return value;
}
function string(value, label) {
  const result = normalizeString(value, "");
  if (!result) fail("direct_worldmodel_migration_missing_string", label);
  return result;
}
function list(value, label) {
  if (!Array.isArray(value))
    fail("direct_worldmodel_migration_missing_array", label);
  return value;
}
function stable(value, nested = false) {
  if (Array.isArray(value)) return value.map((entry) => stable(entry, true));
  if (!isPlainObject(value)) return value;
  return Object.keys(value)
    .sort()
    .reduce((out, key) => {
      if ((nested || !DIGEST_FIELDS.has(key)) && typeof value[key] !== "undefined")
        out[key] = stable(value[key], true);
      return out;
    }, {});
}
function memoryProjectionStable(value) {
  if (Array.isArray(value)) return value.map(memoryProjectionStable);
  if (!isPlainObject(value)) return value;
  return Object.keys(value)
    .sort()
    .reduce((out, key) => {
      if (typeof value[key] !== "undefined")
        out[key] = memoryProjectionStable(value[key]);
      return out;
    }, {});
}
function digest(domain, value) {
  // The artifact's own digest is removed by stable(), but nested evidence
  // digests are identity-bearing inputs and must remain receipt-bound.
  return sha256(`${domain}\0${canonicalJson(stable(value), { omitDigestFields: false })}`);
}
function checked(value, field, domain, label) {
  if (string(value[field], `${label}.${field}`) !== digest(domain, value))
    fail("direct_worldmodel_migration_digest_mismatch", label);
}
function closed(value, keys, label) {
  Object.keys(value).forEach((key) => {
    if (!keys.has(key))
      fail(
        "direct_worldmodel_migration_closed_schema_violation",
        `${label}.${key}`,
      );
  });
}
function exactDigest(value, label) {
  const result = string(value, label);
  if (!SHA256.test(result))
    fail("direct_worldmodel_migration_exact_digest_required", label);
  return result;
}
function sourceRef(
  id,
  digestValue,
  kind = "legacy_artifact",
  confidence = "derived",
  observedAt = "1970-01-01T00:00:00.000Z",
) {
  return normalizeOdeuSourceRefs([
    {
      sourceRefId: `${kind}_${id}`,
      sourceKind: kind,
      sourceId: id,
      sourceConfidence: confidence,
      freshness: "fresh",
      observedAt,
      sourceDigest: {
        algorithm: "sha256",
        value: exactDigest(digestValue, `${kind}.digest`),
        digestOf: "canonical_json",
      },
    },
  ])[0];
}
function exactRef(kind, id, digestValue) {
  return {
    kind,
    id: normalizeId(id, kind),
    digest: exactDigest(digestValue, `${kind}.digest`),
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
}
function assertSafe(value, label) {
  if (Array.isArray(value))
    return value.forEach((entry, index) =>
      assertSafe(entry, `${label}.${index}`),
    );
  if (!isPlainObject(value)) return;
  for (const [key, entry] of Object.entries(value)) {
    if (
      /(raw|transcript|prompt|excerpt|messageText|instruction)/i.test(key) &&
      entry !== false &&
      entry !== "" &&
      entry != null &&
      (!Array.isArray(entry) || entry.length)
    )
      fail(
        "direct_worldmodel_migration_raw_evidence_forbidden",
        `${label}.${key}`,
      );
    if (
      /(authority.*grant|grant.*authority|spawnAllowed|toolUseAllowed|workspaceMutationAllowed)/i.test(
        key,
      ) &&
      entry !== false &&
      entry != null
    )
      fail("direct_worldmodel_migration_authority_leak", `${label}.${key}`);
    assertSafe(entry, `${label}.${key}`);
  }
}
function safeId(value, fallback) {
  return normalizeId(value, fallback);
}
function nodeLifecycle(row) {
  if (row.auditState === "rejected") return "rejected";
  if (row.confidence === "stale") return "stale";
  if (row.conflictState !== "none" || row.confidence === "conflicted")
    return "deferred";
  return "proposed";
}
function candidateClassification(row) {
  if (row.scope?.memoryScope === "agent_private")
    return "agent_private_remains_private";
  if (
    row.kind === "preference" &&
    (row.scope?.memoryScope === "cross_project_explicit" || !row.projectId)
  )
    return "world_manager_review_required";
  if (row.auditState !== "accepted") return "legacy_candidate_not_accepted";
  return "project_world_promotion_candidate";
}
function candidateRef(candidate) {
  return exactRef(
    "legacy_agent_memory_promotion_candidate",
    candidate.candidateId,
    candidate.candidateDigest,
  );
}

function buildLegacyAgentMemoryPromotionCandidate(input = {}, options = {}) {
  const source = object(input, "legacyAgentMemoryPromotionCandidateInput");
  const row = source.memoryRow;
  object(row, "memoryRow");
  const rebuilt = buildAgentMemoryRow(row, {
    nowMs: Date.parse(row.updatedAt) || options.nowMs,
  });
  if (
    row.schema !== rebuilt.schema ||
    row.digest !== rebuilt.digest ||
    row.memoryDigest !== row.digest
  )
    fail("direct_worldmodel_migration_legacy_memory_integrity", "memoryRow");
  const classification = candidateClassification(row);
  const memoryRef = sourceRef(
    row.memoryId,
    row.digest,
    "agent_memory_row",
    "exact",
  );
  const projectId = normalizeString(row.projectId || row.scope?.projectId, "");
  const homeScope =
    classification === "world_manager_review_required"
      ? "user_world"
      : classification === "agent_private_remains_private"
        ? "agent_private"
        : "project";
  const semanticNodeId = safeId(
    source.semanticNodeId || `legacy_memory_node_${row.memoryId}`,
    "legacy_memory_node",
  );
  const userProfileId = safeId(
    source.userProfileId || "migration_user_profile",
    "user_profile",
  );
  const targetScope =
    homeScope === "project"
      ? {
          scopeKind: "project",
          userProfileId,
          projectId: safeId(projectId, "project"),
          semanticPath: [
            "projects",
            safeId(projectId, "project"),
            "memory",
            row.kind,
          ],
        }
      : {
          scopeKind: "user_world",
          userProfileId,
          semanticPath: ["preferences"],
        };
  const proposedNode =
    homeScope === "agent_private"
      ? null
      : buildWorldmodelSemanticNode(
          {
            nodeId: semanticNodeId,
            graphId: safeId(source.graphId, "worldmodel_graph"),
            scope: targetScope,
            nodeKind: MEMORY_NODE_KINDS[row.kind] || "idea",
            abstractionLevel:
              row.kind === "procedure" ? "operational" : "conceptual",
            semanticSummary: row.contentSummary,
            structuredValue: {
              legacyMemoryId: row.memoryId,
              legacyRevision: row.revision,
              confidence: row.confidence,
              conflictState: row.conflictState,
              conflictResolution: row.conflictResolution,
              auditState: row.auditState,
              supersedesMemoryId: row.supersedesMemoryId || "",
              supersededByMemoryId: row.supersededByMemoryId || "",
              authorityUse: row.authorityUse,
            },
            lifecycle: nodeLifecycle(row),
            integrationStatus: "not_integrated",
            epistemicStatus:
              row.confidence === "exact"
                ? "observed"
                : row.confidence === "stale"
                  ? "stale"
                  : row.confidence === "conflicted"
                    ? "disputed"
                    : "derived",
            normativeForce:
              row.kind === "constraint"
                ? "binding_constraint"
                : row.kind === "preference"
                  ? "preference_hint"
                  : "informational",
            custodianRole:
              homeScope === "user_world" ? "world_manager" : "project_manager",
            authorizedWriterRoles: [
              homeScope === "user_world" ? "world_manager" : "project_manager",
            ],
            projectionEligibility:
              nodeLifecycle(row) === "stale" ? "blocked_stale" : "history_only",
            sourceRefs: [memoryRef],
            promotionTransitionRefs: [],
            invalidationRules: row.invalidationRule
              ? [row.invalidationRule]
              : [],
          },
          options,
        );
  const binding = buildScopedWorldMemoryBinding(
    {
      bindingId: source.bindingId || `legacy_memory_binding_${row.memoryId}`,
      memoryId: row.memoryId,
      memoryArtifactRef: memoryRef,
      semanticNodeId,
      semanticNodeDigest: proposedNode
        ? proposedNode.digest
        : exactDigest(
            source.agentPrivateRouteDigest || row.digest,
            "agentPrivateRouteDigest",
          ),
      homeScope,
      ...(homeScope === "project" ? { projectId } : {}),
      custodianRole:
        homeScope === "project"
          ? "project_manager"
          : homeScope === "user_world"
            ? "world_manager"
            : "agent",
      compatibilityState:
        homeScope === "agent_private"
          ? "agent_private_unpromoted"
          : "migration_pending",
      sourceRefs: [memoryRef],
    },
    options,
  );
  validateScopedWorldMemoryBinding(binding);
  const result = {
    schema: LEGACY_AGENT_MEMORY_PROMOTION_CANDIDATE_SCHEMA,
    candidateId: safeId(
      source.candidateId || `legacy_memory_candidate_${row.memoryId}`,
      "legacy_memory_candidate",
    ),
    legacyMemoryRef: memoryRef,
    classification,
    targetScope: homeScope,
    ...(projectId ? { projectId: safeId(projectId, "project") } : {}),
    proposedNode,
    compatibilityBinding: binding,
    preserves: {
      provenance: true,
      confidence: true,
      conflict: true,
      supersession: true,
      revision: true,
    },
    automaticGraphTruth: false,
    automaticPromotionAllowed: false,
    actionAuthorityGranted: false,
    rawTextIncluded: false,
    rawTranscriptIncluded: false,
  };
  result.candidateDigest = digest(
    "direct-legacy-agent-memory-promotion-candidate@1",
    result,
  );
  return result;
}
function validateLegacyAgentMemoryPromotionCandidate(value) {
  object(value, "legacyAgentMemoryPromotionCandidate");
  closed(
    value,
    new Set([
      "schema",
      "candidateId",
      "legacyMemoryRef",
      "classification",
      "targetScope",
      "projectId",
      "proposedNode",
      "compatibilityBinding",
      "preserves",
      "automaticGraphTruth",
      "automaticPromotionAllowed",
      "actionAuthorityGranted",
      "rawTextIncluded",
      "rawTranscriptIncluded",
      "candidateDigest",
    ]),
    "legacyAgentMemoryPromotionCandidate",
  );
  if (value.schema !== LEGACY_AGENT_MEMORY_PROMOTION_CANDIDATE_SCHEMA)
    fail(
      "direct_worldmodel_migration_schema_mismatch",
      "legacyAgentMemoryPromotionCandidate",
    );
  string(value.candidateId, "legacyAgentMemoryPromotionCandidate.candidateId");
  exactDigest(
    value.legacyMemoryRef?.sourceDigest?.value,
    "legacyAgentMemoryPromotionCandidate.legacyMemoryRef",
  );
  if (!CANDIDATE_CLASSIFICATIONS.has(value.classification))
    fail(
      "direct_worldmodel_migration_invalid_classification",
      "legacyAgentMemoryPromotionCandidate.classification",
    );
  object(value.preserves, "legacyAgentMemoryPromotionCandidate.preserves");
  closed(
    value.preserves,
    new Set([
      "provenance",
      "confidence",
      "conflict",
      "supersession",
      "revision",
    ]),
    "legacyAgentMemoryPromotionCandidate.preserves",
  );
  if (Object.values(value.preserves).some((entry) => entry !== true))
    fail(
      "direct_worldmodel_migration_preservation_required",
      "legacyAgentMemoryPromotionCandidate.preserves",
    );
  validateScopedWorldMemoryBinding(value.compatibilityBinding);
  if (
    value.classification !== "agent_private_remains_private" &&
    (value.compatibilityBinding.mayEnterContextThroughGraphProjection ||
      value.compatibilityBinding.mayEnterContextThroughLegacyMemoryProjection)
  )
    fail(
      "direct_worldmodel_migration_pending_binding_required",
      "legacyAgentMemoryPromotionCandidate.compatibilityBinding",
    );
  if (value.proposedNode) {
    validateWorldmodelSemanticNode(value.proposedNode);
    const expectedHome =
      value.classification === "world_manager_review_required"
        ? "user_world"
        : "project";
    if (
      value.targetScope !== expectedHome ||
      value.compatibilityBinding.homeScope !== expectedHome ||
      value.proposedNode.nodeId !== value.compatibilityBinding.semanticNodeId ||
      value.proposedNode.digest !==
        value.compatibilityBinding.semanticNodeDigest ||
      (expectedHome === "project" &&
        (value.proposedNode.scope.scopeKind !== "project" ||
          value.proposedNode.scope.projectId !== value.projectId ||
          value.compatibilityBinding.projectId !== value.projectId)) ||
      (expectedHome === "user_world" &&
        value.proposedNode.scope.scopeKind !== "user_world")
    )
      fail(
        "direct_worldmodel_migration_candidate_binding_mismatch",
        "legacyAgentMemoryPromotionCandidate",
      );
  } else if (
    value.targetScope !== "agent_private" ||
    value.classification !== "agent_private_remains_private" ||
    value.compatibilityBinding.homeScope !== "agent_private" ||
    value.compatibilityBinding.mayEnterContextThroughLegacyMemoryProjection !==
      true
  )
    fail(
      "direct_worldmodel_migration_agent_private_route_required",
      "legacyAgentMemoryPromotionCandidate",
    );
  if (
    value.automaticGraphTruth !== false ||
    value.automaticPromotionAllowed !== false ||
    value.actionAuthorityGranted !== false ||
    value.rawTextIncluded !== false ||
    value.rawTranscriptIncluded !== false
  )
    fail(
      "direct_worldmodel_migration_candidate_boundary",
      "legacyAgentMemoryPromotionCandidate",
    );
  assertSafe(value, "legacyAgentMemoryPromotionCandidate");
  checked(
    value,
    "candidateDigest",
    "direct-legacy-agent-memory-promotion-candidate@1",
    "legacyAgentMemoryPromotionCandidate",
  );
  return true;
}

function buildWorkThreadProjectParentLinkageWitness(input = {}, options = {}) {
  const source = object(input, "workThreadProjectParentLinkageInput");
  const thread = source.workThread;
  object(thread, "workThread");
  const rebuilt = buildWorkThread(thread, {
    nowMs: Date.parse(thread.updatedAt) || options.nowMs,
  });
  if (thread.schema !== rebuilt.schema || thread.digest !== rebuilt.digest)
    fail("direct_worldmodel_migration_work_thread_integrity", "workThread");
  const projectId = safeId(thread.projectId, "project");
  const projectRootNodeId = safeId(source.projectRootNodeId, "project_root");
  const projectRootDigest = exactDigest(
    source.projectRootDigest,
    "projectRootDigest",
  );
  const result = {
    schema: WORK_THREAD_PROJECT_PARENT_LINKAGE_WITNESS_SCHEMA,
    witnessId: safeId(
      source.witnessId || `work_thread_parent_${thread.workThreadId}`,
      "work_thread_parent",
    ),
    workThreadRef: exactRef("work_thread", thread.workThreadId, thread.digest),
    projectId,
    projectWorldRootRef: exactRef(
      "worldmodel_semantic_node",
      projectRootNodeId,
      projectRootDigest,
    ),
    parentLinkState: "linked_without_store_replacement",
    workThreadStoreReplaced: false,
    projectOntologyMovedOutOfWorkThread: true,
    actionAuthorityGranted: false,
    rawTextIncluded: false,
    sourceRefs: [
      sourceRef(thread.workThreadId, thread.digest, "work_thread", "exact"),
    ],
  };
  result.linkageDigest = digest(
    "direct-work-thread-project-parent-linkage-witness@1",
    result,
  );
  return result;
}
function validateWorkThreadProjectParentLinkageWitness(value) {
  object(value, "workThreadProjectParentLinkageWitness");
  closed(
    value,
    new Set([
      "schema",
      "witnessId",
      "workThreadRef",
      "projectId",
      "projectWorldRootRef",
      "parentLinkState",
      "workThreadStoreReplaced",
      "projectOntologyMovedOutOfWorkThread",
      "actionAuthorityGranted",
      "rawTextIncluded",
      "sourceRefs",
      "linkageDigest",
    ]),
    "workThreadProjectParentLinkageWitness",
  );
  if (
    value.schema !== WORK_THREAD_PROJECT_PARENT_LINKAGE_WITNESS_SCHEMA ||
    value.parentLinkState !== "linked_without_store_replacement" ||
    value.workThreadStoreReplaced !== false ||
    value.projectOntologyMovedOutOfWorkThread !== true ||
    value.actionAuthorityGranted !== false ||
    value.rawTextIncluded !== false
  )
    fail(
      "direct_worldmodel_migration_work_thread_boundary",
      "workThreadProjectParentLinkageWitness",
    );
  exactDigest(
    value.workThreadRef?.digest,
    "workThreadProjectParentLinkageWitness.workThreadRef",
  );
  exactDigest(
    value.projectWorldRootRef?.digest,
    "workThreadProjectParentLinkageWitness.projectWorldRootRef",
  );
  assertSafe(value, "workThreadProjectParentLinkageWitness");
  checked(
    value,
    "linkageDigest",
    "direct-work-thread-project-parent-linkage-witness@1",
    "workThreadProjectParentLinkageWitness",
  );
  return true;
}
function validateWorkThreadProjectParentLinkageWitnessContext(
  value,
  context = {},
  options = {},
) {
  validateWorkThreadProjectParentLinkageWitness(value);
  const thread = context.workThreads?.find(
    (entry) => entry.workThreadId === value.workThreadRef.id,
  );
  const graph = context.graph;
  if (!thread || !graph)
    fail(
      "direct_worldmodel_migration_linkage_context_required",
      "workThreadProjectParentLinkageWitness",
    );
  const rebuilt = buildWorkThread(thread, {
    nowMs: Date.parse(thread.updatedAt) || options.nowMs,
  });
  validateHierarchicalWorldmodelGraph(graph);
  const root = graph.nodes.find(
    (entry) => entry.nodeId === value.projectWorldRootRef.id,
  );
  if (
    rebuilt.digest !== value.workThreadRef.digest ||
    thread.projectId !== value.projectId ||
    !root ||
    root.nodeKind !== "project_root" ||
    root.scope.scopeKind !== "project" ||
    root.scope.projectId !== value.projectId ||
    root.digest !== value.projectWorldRootRef.digest
  )
    fail(
      "direct_worldmodel_migration_linkage_context_mismatch",
      "workThreadProjectParentLinkageWitness",
    );
  return true;
}

function validateLegacyMemoryProjection(projection) {
  object(projection, "legacyMemoryProjection");
  if (
    projection.schema !== "direct_agent_memory_context_projection@1" ||
    projection.rawMemoryTextIncluded !== false ||
    projection.rawTranscriptIncluded !== false ||
    projection.providerInstruction !== false ||
    projection.providerContextTextIncluded !== false
  )
    fail(
      "direct_worldmodel_migration_legacy_projection_invalid",
      "legacyMemoryProjection",
    );
  string(projection.projectionId, "legacyMemoryProjection.projectionId");
  exactDigest(
    projection.projectionDigest,
    "legacyMemoryProjection.projectionDigest",
  );
  const { projectionDigest, ...withoutDigest } = projection;
  if (
    projectionDigest !==
    sha256(
      `direct-agent-memory-context-projection@1\0${JSON.stringify(memoryProjectionStable(withoutDigest))}`,
    )
  )
    fail(
      "direct_worldmodel_migration_legacy_projection_digest_mismatch",
      "legacyMemoryProjection",
    );
  list(
    projection.selectedMemoryRefs,
    "legacyMemoryProjection.selectedMemoryRefs",
  ).forEach((entry, index) => {
    object(entry, `legacyMemoryProjection.selectedMemoryRefs.${index}`);
    string(
      entry.memoryId,
      `legacyMemoryProjection.selectedMemoryRefs.${index}.memoryId`,
    );
    exactDigest(
      entry.digest,
      `legacyMemoryProjection.selectedMemoryRefs.${index}.digest`,
    );
    if (
      entry.rawMemoryTextIncluded !== false ||
      entry.rawTranscriptIncluded !== false ||
      entry.providerInstruction !== false
    )
      fail(
        "direct_worldmodel_migration_legacy_projection_invalid",
        `legacyMemoryProjection.selectedMemoryRefs.${index}`,
      );
  });
  assertSafe(projection, "legacyMemoryProjection");
  return true;
}
function buildScopedWorldMemoryNoDoubleInclusionWitness(input = {}) {
  const source = object(input, "noDoubleInclusionInput");
  const binding = source.binding;
  validateScopedWorldMemoryBinding(
    binding,
    binding.compatibilityState === "graph_primary"
      ? { graph: source.graph }
      : {},
  );
  const legacyProjection = source.legacyMemoryProjection;
  const graphProjection = source.graphProjection;
  validateLegacyMemoryProjection(legacyProjection);
  validateWorldmodelGraphProjection(graphProjection);
  const legacyIncluded = legacyProjection.selectedMemoryRefs.some(
    (entry) => entry.memoryId === binding.memoryId,
  );
  const graphIncluded = graphProjection.selectedNodeRefs.some(
    (entry) => entry.id === binding.semanticNodeId,
  );
  const prohibited = legacyIncluded && graphIncluded;
  const result = {
    schema: SCOPED_WORLD_MEMORY_NO_DOUBLE_INCLUSION_WITNESS_SCHEMA,
    witnessId: safeId(
      source.witnessId || `no_double_inclusion_${binding.bindingId}`,
      "no_double_inclusion",
    ),
    bindingRef: exactRef(
      "scoped_world_memory_binding",
      binding.bindingId,
      binding.bindingDigest,
    ),
    memoryId: binding.memoryId,
    semanticNodeId: binding.semanticNodeId,
    compatibilityState: binding.compatibilityState,
    legacyProjectionInputRef: exactRef(
      "agent_memory_context_projection",
      legacyProjection.projectionId,
      legacyProjection.projectionDigest,
    ),
    graphProjectionInputRef: exactRef(
      "worldmodel_graph_projection",
      graphProjection.projectionId,
      graphProjection.projectionDigest,
    ),
    legacyIncluded,
    graphIncluded,
    doubleInclusionCount: prohibited ? 1 : 0,
    decision: prohibited ? "remand" : "pass",
    actionAuthorityGranted: false,
    rawTextIncluded: false,
  };
  result.witnessDigest = digest(
    "direct-scoped-world-memory-no-double-inclusion-witness@1",
    result,
  );
  return result;
}
function validateScopedWorldMemoryNoDoubleInclusionWitness(value) {
  object(value, "noDoubleInclusionWitness");
  closed(
    value,
    new Set([
      "schema",
      "witnessId",
      "bindingRef",
      "memoryId",
      "semanticNodeId",
      "compatibilityState",
      "legacyProjectionInputRef",
      "graphProjectionInputRef",
      "legacyIncluded",
      "graphIncluded",
      "doubleInclusionCount",
      "decision",
      "actionAuthorityGranted",
      "rawTextIncluded",
      "witnessDigest",
    ]),
    "noDoubleInclusionWitness",
  );
  if (
    value.schema !== SCOPED_WORLD_MEMORY_NO_DOUBLE_INCLUSION_WITNESS_SCHEMA ||
    !["pass", "remand"].includes(value.decision) ||
    value.doubleInclusionCount !==
      (value.legacyIncluded && value.graphIncluded ? 1 : 0) ||
    (value.decision === "pass") !== (value.doubleInclusionCount === 0) ||
    value.actionAuthorityGranted !== false ||
    value.rawTextIncluded !== false
  )
    fail(
      "direct_worldmodel_migration_double_inclusion_boundary",
      "noDoubleInclusionWitness",
    );
  assertSafe(value, "noDoubleInclusionWitness");
  checked(
    value,
    "witnessDigest",
    "direct-scoped-world-memory-no-double-inclusion-witness@1",
    "noDoubleInclusionWitness",
  );
  return true;
}

function buildWorldmodelMigrationReport(input = {}, options = {}) {
  const source = object(input, "worldmodelMigrationReportInput");
  const graph = source.graph || options.graph;
  validateHierarchicalWorldmodelGraph(graph);
  if (
    (source.graphId && source.graphId !== graph.graphId) ||
    (source.graphDigest && source.graphDigest !== graph.digest)
  )
    fail(
      "direct_worldmodel_migration_graph_context_mismatch",
      "worldmodelMigrationReport",
    );
  const memoryCandidates = (
    Array.isArray(source.agentMemoryRows) ? source.agentMemoryRows : []
  )
    .map((row) =>
      buildLegacyAgentMemoryPromotionCandidate(
        {
          memoryRow: row,
          graphId: graph.graphId,
          userProfileId: graph.userProfileId,
        },
        options,
      ),
    )
    .sort((a, b) => a.candidateId.localeCompare(b.candidateId));
  const linkages = (Array.isArray(source.workThreads) ? source.workThreads : [])
    .map((thread) =>
      buildWorkThreadProjectParentLinkageWitness(
        {
          workThread: thread,
          projectRootNodeId: source.projectRootNodeId,
          projectRootDigest: source.projectRootDigest,
        },
        options,
      ),
    )
    .sort((a, b) => a.witnessId.localeCompare(b.witnessId));
  const managerScopeWitnesses = (
    Array.isArray(source.managerProfiles) ? source.managerProfiles : []
  )
    .map((profile) => {
      validateWorldmodelManagerProfile(profile);
      const rebuilt = buildWorldmodelManagerProfile(profile, {
        now: Date.parse(profile.createdAt) || options.now,
      });
      if (rebuilt.profileDigest !== profile.profileDigest)
        fail(
          "direct_worldmodel_migration_manager_profile_integrity",
          profile.managerProfileId,
        );
      const scope = profile.scope.scopeKind;
      if (!["global_user", "project", "work_thread"].includes(scope))
        fail(
          "direct_worldmodel_migration_invalid_manager_scope",
          "managerProfile.scope",
        );
      const ref = {
        kind: "worldmodel_manager_profile",
        id: safeId(profile.managerProfileId, "manager_profile"),
        digest: exactDigest(
          profile.profileDigest,
          "managerProfile.profileDigest",
        ),
      };
      return buildManagerScopeMigrationWitness({
        witnessId: `manager_scope_${profile.managerProfileId}`,
        legacyScopeKind: scope,
        sourceArtifactRefs: [ref],
        legacyManagerProfileRef: ref,
        resultingManagerProfileRef: {
          kind:
            scope === "global_user"
              ? "worldmodel_manager_profile"
              : scope === "project"
                ? "project_manager_profile"
                : "thread_manager_profile",
          id: safeId(profile.managerProfileId, "manager_profile"),
          digest: exactDigest(
            profile.profileDigest,
            "managerProfile.profileDigest",
          ),
        },
      });
    })
    .sort((a, b) => a.witnessId.localeCompare(b.witnessId));
  const bindings = memoryCandidates.map(
    (candidate) => candidate.compatibilityBinding,
  );
  const noDoubleInclusionWitnesses = (
    Array.isArray(source.noDoubleInclusionWitnesses)
      ? source.noDoubleInclusionWitnesses
      : []
  ).sort((a, b) => a.witnessId.localeCompare(b.witnessId));
  if (noDoubleInclusionWitnesses.length !== bindings.length)
    fail(
      "direct_worldmodel_migration_no_double_witness_required",
      "worldmodelMigrationReport",
    );
  noDoubleInclusionWitnesses.forEach((witness) => {
    validateScopedWorldMemoryNoDoubleInclusionWitness(witness);
    if (witness.decision !== "pass" || witness.doubleInclusionCount !== 0)
      fail("direct_worldmodel_migration_incomplete_double_inclusion", "worldmodelMigrationReport");
  });
  const cutoverRegistry = source.memoryAuthorityCutoverRegistry;
  if (cutoverRegistry) validateMemoryAuthorityCutoverRegistry(cutoverRegistry, { graph });
  const memoryAuthorityCutoverReceipts = cutoverRegistry
    ? cutoverRegistry.transitions
    : Array.isArray(source.memoryAuthorityCutoverReceipts)
      ? source.memoryAuthorityCutoverReceipts
      : [];
  for (const binding of bindings)
    if (binding.compatibilityState === "graph_primary" && !memoryAuthorityCutoverReceipts.some((receipt) => receipt.bindingId === binding.bindingId && receipt.nextBinding?.bindingDigest === binding.bindingDigest))
      fail("direct_worldmodel_migration_cutover_receipt_required", binding.bindingId);
  const result = {
    schema: WORLDMODEL_MIGRATION_REPORT_SCHEMA,
    reportId: safeId(
      source.reportId || "worldmodel_migration_report",
      "worldmodel_migration_report",
    ),
    graphRef: exactRef(
      "hierarchical_worldmodel_graph",
      graph.graphId,
      graph.digest,
    ),
    managerScopeWitnesses,
    memoryCandidates,
    workThreadLinkages: linkages,
    compatibilityBindings: bindings,
    noDoubleInclusionWitnesses,
    memoryAuthorityCutoverReceipts,
    sourceArtifactRefs: [
      ...memoryCandidates.map((candidate) => candidate.legacyMemoryRef),
      ...linkages.flatMap((entry) => entry.sourceRefs),
    ],
    preservedProvenanceCount: memoryCandidates.length,
    skippedCandidateCount: memoryCandidates.filter(
      (candidate) =>
        candidate.classification === "agent_private_remains_private",
    ).length,
    conflictCount: memoryCandidates.filter(
      (candidate) =>
        candidate.proposedNode?.structuredValue?.conflictState !== "none",
    ).length,
    doubleInclusionCount: noDoubleInclusionWitnesses.reduce(
      (total, witness) => total + witness.doubleInclusionCount,
      0,
    ),
    historicalTranscriptMiningPerformed: false,
    destructiveRewritePerformed: false,
    automaticPromotionPerformed: false,
    actionAuthorityGranted: false,
    rawTextIncluded: false,
    rawTranscriptIncluded: false,
  };
  result.reportDigest = digest("direct-worldmodel-migration-report@1", result);
  return result;
}
function validateWorldmodelMigrationReport(value, context = {}) {
  object(value, "worldmodelMigrationReport");
  closed(
    value,
    new Set([
      "schema",
      "reportId",
      "graphRef",
      "managerScopeWitnesses",
      "memoryCandidates",
      "workThreadLinkages",
      "compatibilityBindings",
      "noDoubleInclusionWitnesses",
      "memoryAuthorityCutoverReceipts",
      "sourceArtifactRefs",
      "preservedProvenanceCount",
      "skippedCandidateCount",
      "conflictCount",
      "doubleInclusionCount",
      "historicalTranscriptMiningPerformed",
      "destructiveRewritePerformed",
      "automaticPromotionPerformed",
      "actionAuthorityGranted",
      "rawTextIncluded",
      "rawTranscriptIncluded",
      "reportDigest",
    ]),
    "worldmodelMigrationReport",
  );
  if (
    value.schema !== WORLDMODEL_MIGRATION_REPORT_SCHEMA ||
    value.historicalTranscriptMiningPerformed !== false ||
    value.destructiveRewritePerformed !== false ||
    value.automaticPromotionPerformed !== false ||
    value.actionAuthorityGranted !== false ||
    value.rawTextIncluded !== false ||
    value.rawTranscriptIncluded !== false
  )
    fail(
      "direct_worldmodel_migration_report_boundary",
      "worldmodelMigrationReport",
    );
  list(
    value.managerScopeWitnesses,
    "worldmodelMigrationReport.managerScopeWitnesses",
  ).forEach(validateHierarchicalWorldmodelMigrationWitness);
  list(
    value.memoryCandidates,
    "worldmodelMigrationReport.memoryCandidates",
  ).forEach(validateLegacyAgentMemoryPromotionCandidate);
  list(
    value.workThreadLinkages,
    "worldmodelMigrationReport.workThreadLinkages",
  ).forEach((linkage) =>
    context.graph
      ? validateWorkThreadProjectParentLinkageWitnessContext(linkage, context)
      : validateWorkThreadProjectParentLinkageWitness(linkage),
  );
  list(
    value.compatibilityBindings,
    "worldmodelMigrationReport.compatibilityBindings",
  ).forEach((binding) =>
    validateScopedWorldMemoryBinding(
      binding,
      binding.compatibilityState === "graph_primary"
        ? { graph: context.graph }
        : {},
    ),
  );
  list(
    value.noDoubleInclusionWitnesses,
    "worldmodelMigrationReport.noDoubleInclusionWitnesses",
  ).forEach(validateScopedWorldMemoryNoDoubleInclusionWitness);
  list(value.memoryAuthorityCutoverReceipts, "worldmodelMigrationReport.memoryAuthorityCutoverReceipts").forEach((receipt) => {
    if (receipt.schema !== MEMORY_AUTHORITY_CUTOVER_RECEIPT_SCHEMA || !receipt.receiptDigest) fail("direct_worldmodel_migration_cutover_receipt_invalid", "memoryAuthorityCutoverReceipts");
  });
  if (
    value.compatibilityBindings.length !== value.memoryCandidates.length ||
    value.noDoubleInclusionWitnesses.length !==
      value.compatibilityBindings.length ||
    value.workThreadLinkages.length !==
      (context.workThreads?.length || value.workThreadLinkages.length)
  )
    fail(
      "direct_worldmodel_migration_report_cardinality_mismatch",
      "worldmodelMigrationReport",
    );
  for (const candidate of value.memoryCandidates)
    if (
      !value.compatibilityBindings.some(
        (binding) =>
          binding.bindingId === candidate.compatibilityBinding.bindingId,
      ) ||
      !value.noDoubleInclusionWitnesses.some(
        (witness) =>
          witness.bindingRef.id === candidate.compatibilityBinding.bindingId,
      )
    )
      fail(
        "direct_worldmodel_migration_report_binding_mismatch",
        candidate.candidateId,
      );
  for (const binding of value.compatibilityBindings)
    if (binding.compatibilityState === "graph_primary" && !value.memoryAuthorityCutoverReceipts.some((receipt) => receipt.bindingId === binding.bindingId && receipt.nextBinding?.bindingDigest === binding.bindingDigest))
      fail("direct_worldmodel_migration_cutover_receipt_required", binding.bindingId);
  const expectedDouble = value.noDoubleInclusionWitnesses.reduce(
    (total, witness) => total + witness.doubleInclusionCount,
    0,
  );
  if (
    expectedDouble !== 0 ||
    value.noDoubleInclusionWitnesses.some((witness) =>
      witness.decision !== "pass" || witness.doubleInclusionCount !== 0,
    ) ||
    value.doubleInclusionCount !== expectedDouble ||
    value.preservedProvenanceCount !== value.memoryCandidates.length ||
    value.skippedCandidateCount !==
      value.memoryCandidates.filter(
        (candidate) =>
          candidate.classification === "agent_private_remains_private",
      ).length ||
    value.conflictCount !==
      value.memoryCandidates.filter(
        (candidate) =>
          candidate.proposedNode?.structuredValue?.conflictState !== "none",
      ).length
  )
    fail(
      "direct_worldmodel_migration_incomplete_double_inclusion",
      "worldmodelMigrationReport",
    );
  assertSafe(value, "worldmodelMigrationReport");
  checked(
    value,
    "reportDigest",
    "direct-worldmodel-migration-report@1",
    "worldmodelMigrationReport",
  );
  return true;
}

function memoryAuthorityRef(value, kind, label) {
  return exactRef(kind, value?.id || value?.sourceId, value?.digest || value?.sourceDigest?.value || "");
}
function registryBindingSet(values, graph) {
  const bindings = list(values, "memoryAuthorityCutoverRegistry.bindings").map((binding) => ({ ...binding }));
  const ids = new Set();
  for (const binding of bindings) {
    if (ids.has(binding.bindingId)) fail("direct_memory_authority_cutover_duplicate_binding", binding.bindingId);
    ids.add(binding.bindingId);
    validateScopedWorldMemoryBinding(binding, binding.compatibilityState === "graph_primary" ? { graph } : {});
  }
  return bindings.sort((left, right) => left.bindingId.localeCompare(right.bindingId));
}
function buildMemoryAuthorityCutoverRegistry(input = {}, options = {}) {
  const source = object(input, "memoryAuthorityCutoverRegistryInput");
  const graph = source.graph || options.graph;
  if (graph) validateHierarchicalWorldmodelGraph(graph);
  const bindings = registryBindingSet(source.bindings || [], graph);
  const result = {
    schema: MEMORY_AUTHORITY_CUTOVER_REGISTRY_SCHEMA,
    registryId: safeId(source.registryId || source.id, "memory_authority_cutover_registry"),
    projectId: safeId(source.projectId, "project"),
    userProfileId: safeId(source.userProfileId, "user_profile"),
    revision: Number.isInteger(source.revision) && source.revision >= 0 ? source.revision : 0,
    genesisBindings: source.genesisBindings ? registryBindingSet(source.genesisBindings, graph) : bindings,
    bindings,
    transitions: Array.isArray(source.transitions) ? source.transitions : [],
    consumedDecisionRefs: Array.isArray(source.consumedDecisionRefs) ? source.consumedDecisionRefs.map((ref) => memoryAuthorityRef(ref, "contextual_authority_decision", "consumedDecision")) : [],
    transitionLedgerHeadRef: source.transitionLedgerHeadRef ? memoryAuthorityRef(source.transitionLedgerHeadRef, "memory_authority_cutover_receipt", "transitionLedgerHead") : null,
  };
  result.registryDigest = digest("direct-memory-authority-cutover-registry@1", result);
  validateMemoryAuthorityCutoverRegistry(result, { ...options, graph });
  return result;
}
function validateMemoryAuthorityCutoverRegistry(value, context = {}) {
  object(value, "memoryAuthorityCutoverRegistry");
  closed(value, new Set(["schema", "registryId", "projectId", "userProfileId", "revision", "genesisBindings", "bindings", "transitions", "consumedDecisionRefs", "transitionLedgerHeadRef", "registryDigest"]), "memoryAuthorityCutoverRegistry");
  if (value.schema !== MEMORY_AUTHORITY_CUTOVER_REGISTRY_SCHEMA || !Number.isInteger(value.revision) || value.revision < 0) fail("direct_memory_authority_cutover_registry_invalid", "registry");
  ["registryId", "projectId", "userProfileId"].forEach((key) => string(value[key], `memoryAuthorityCutoverRegistry.${key}`));
  const graph = context.graph;
  if (graph) validateHierarchicalWorldmodelGraph(graph);
  if (value.transitions.length && !graph) fail("direct_memory_authority_cutover_replay_context_required", value.registryId);
  const projectionValues = Array.isArray(context.graphProjections) ? context.graphProjections : [context.graphProjection].filter(Boolean);
  const projectionByRef = new Map();
  for (const projection of projectionValues) {
    validateWorldmodelGraphProjection(projection);
    projectionByRef.set(`${projection.projectionId}:${projection.projectionDigest}`, projection);
  }
  const authorityRefs = new Map((Array.isArray(context.contextualAuthorityDecisionRefs) ? context.contextualAuthorityDecisionRefs : []).map((ref) => [`${ref.id}:${ref.digest}`, ref]));
  const admissionRefs = new Map((Array.isArray(context.contextualAdmissionRefs) ? context.contextualAdmissionRefs : []).map((ref) => [`${ref.id}:${ref.digest}`, ref]));
  const governanceRegistries = Array.isArray(context.governanceRegistries) ? context.governanceRegistries : [];
  for (const governanceRegistry of governanceRegistries)
    require("./governance-provenance-registry").validateGovernanceProvenanceRegistry(governanceRegistry);
  const genesis = registryBindingSet(value.genesisBindings, graph);
  let current = genesis;
  const consumed = [];
  let priorDigest = "";
  value.transitions.forEach((transition, index) => {
    object(transition, `memoryAuthorityCutoverRegistry.transitions.${index}`);
    closed(transition, new Set(["schema", "receiptId", "cutoverId", "registryId", "expectedRegistryRevision", "resultingRegistryRevision", "priorRegistryDigest", "bindingId", "memoryId", "legacyMemoryRowRef", "semanticNodeRef", "graphRef", "projectionRef", "policyRef", "managerProfileRef", "custodyMatrixRef", "custodyWitnessRef", "contextualAuthorityDecisionRef", "contextualAdmissionRef", "governanceRegistryPreRef", "governanceRegistryPostRef", "priorBinding", "nextBinding", "priorCompatibilityState", "nextCompatibilityState", "priorBindingRevision", "nextBindingRevision", "priorTransitionRef", "receiptDigest"]), `memoryAuthorityCutoverRegistry.transitions.${index}`);
    if (transition.schema !== MEMORY_AUTHORITY_CUTOVER_RECEIPT_SCHEMA || transition.registryId !== value.registryId || transition.expectedRegistryRevision !== index || transition.resultingRegistryRevision !== index + 1 || transition.priorRegistryDigest !== priorDigest || transition.priorCompatibilityState !== "legacy_memory_primary" || transition.nextCompatibilityState !== "graph_primary" || transition.priorBindingRevision !== index || transition.nextBindingRevision !== index + 1) fail("direct_memory_authority_cutover_replay_invalid", transition.cutoverId);
    ["legacyMemoryRowRef", "semanticNodeRef", "graphRef", "projectionRef", "policyRef", "managerProfileRef", "custodyMatrixRef", "custodyWitnessRef", "contextualAuthorityDecisionRef", "contextualAdmissionRef", "governanceRegistryPreRef", "governanceRegistryPostRef"].forEach((key) => { if (!transition[key]?.digest) fail("direct_memory_authority_cutover_receipt_ref_missing", key); });
    const copy = { ...transition }; delete copy.receiptDigest;
    if (transition.receiptDigest !== digest("direct-memory-authority-cutover-receipt@1", copy)) fail("direct_memory_authority_cutover_receipt_digest", transition.cutoverId);
    validateScopedWorldMemoryBinding(transition.priorBinding);
    validateScopedWorldMemoryBinding(transition.nextBinding, graph ? { graph } : {});
    const old = current.find((binding) => binding.bindingId === transition.bindingId);
    if (!old || old.bindingDigest !== transition.priorBinding.bindingDigest || transition.priorBinding.memoryId !== transition.memoryId || transition.nextBinding.memoryId !== transition.memoryId || transition.nextBinding.compatibilityState !== "graph_primary") fail("direct_memory_authority_cutover_replay_invalid", transition.cutoverId);
    if (transition.graphRef.kind !== "hierarchical_worldmodel_graph" || transition.projectionRef.kind !== "worldmodel_graph_projection" || transition.policyRef.kind !== "worldmodel_projection_policy" || transition.contextualAuthorityDecisionRef.kind !== "contextual_authority_decision" || transition.contextualAdmissionRef.kind !== "contextual_admission") fail("direct_memory_authority_cutover_receipt_ref_kind", transition.cutoverId);
    if (!graph || transition.graphRef.id !== graph.graphId || transition.graphRef.digest !== graph.digest || transition.semanticNodeRef.id !== transition.nextBinding.semanticNodeId || transition.semanticNodeRef.digest !== transition.nextBinding.semanticNodeDigest || !graph.nodes.some((node) => node.nodeId === transition.semanticNodeRef.id && node.digest === transition.semanticNodeRef.digest)) fail("direct_memory_authority_cutover_replay_context_mismatch", transition.cutoverId);
    const projection = projectionByRef.get(`${transition.projectionRef.id}:${transition.projectionRef.digest}`);
    if (!projection || projection.graphRef.id !== graph.graphId || projection.graphRef.digest !== graph.digest || projection.policyRef.id !== transition.policyRef.id || projection.policyRef.digest !== transition.policyRef.digest || !projection.selectedNodeRefs.some((ref) => ref.id === transition.semanticNodeRef.id && ref.digest === transition.semanticNodeRef.digest)) fail("direct_memory_authority_cutover_replay_context_mismatch", transition.cutoverId);
    if (!authorityRefs.has(`${transition.contextualAuthorityDecisionRef.id}:${transition.contextualAuthorityDecisionRef.digest}`) || !admissionRefs.has(`${transition.contextualAdmissionRef.id}:${transition.contextualAdmissionRef.digest}`)) fail("direct_memory_authority_cutover_replay_context_mismatch", transition.cutoverId);
    const preRegistry = governanceRegistries.find((entry) => entry.registryId === transition.governanceRegistryPreRef.id && entry.registryDigest === transition.governanceRegistryPreRef.digest && entry.revision === transition.governanceRegistryPreRef.revision);
    const postRegistry = governanceRegistries.find((entry) => entry.registryId === transition.governanceRegistryPostRef.id && entry.registryDigest === transition.governanceRegistryPostRef.digest && entry.revision === transition.governanceRegistryPostRef.revision);
    const requiredGovernanceRefs = [
      ["project_manager_profile", transition.managerProfileRef],
      ["project_root", { id: graph.nodes.find((node) => node.nodeKind === "project_root" && node.scope.projectId === value.projectId)?.nodeId, digest: graph.nodes.find((node) => node.nodeKind === "project_root" && node.scope.projectId === value.projectId)?.digest }],
      ["custody_matrix", transition.custodyMatrixRef],
      ["custody_witness", transition.custodyWitnessRef],
      ["authority_decision", transition.contextualAuthorityDecisionRef],
    ];
    if (!preRegistry || !postRegistry || postRegistry.revision !== preRegistry.revision + 1)
      fail("direct_memory_authority_cutover_governance_replay_mismatch", `${transition.cutoverId}:registry_pair`);
    for (const [kind, ref] of requiredGovernanceRefs)
      if (!preRegistry.records.some((record) => record.kind === kind && record.artifactId === ref.id && record.artifactDigest === ref.digest && record.consumed === false))
        fail("direct_memory_authority_cutover_governance_replay_mismatch", `${transition.cutoverId}:${kind}`);
    if (!postRegistry.records.some((record) => record.kind === "authority_decision" && record.artifactId === transition.contextualAuthorityDecisionRef.id && record.artifactDigest === transition.contextualAuthorityDecisionRef.digest && record.consumed === true) || canonicalJson(postRegistry.transitions.at(-1)?.consumedRecordKeys) !== canonicalJson([`authority_decision:${transition.contextualAuthorityDecisionRef.id}:${transition.contextualAuthorityDecisionRef.digest}`]))
      fail("direct_memory_authority_cutover_governance_replay_mismatch", `${transition.cutoverId}:consumption`);
    if (consumed.includes(transition.contextualAuthorityDecisionRef.digest)) fail("direct_memory_authority_cutover_decision_reused", transition.cutoverId);
    consumed.push(transition.contextualAuthorityDecisionRef.digest);
    current = current.map((binding) => binding.bindingId === old.bindingId ? transition.nextBinding : binding);
    priorDigest = transition.receiptDigest;
  });
  if (value.revision !== value.transitions.length || canonicalJson(current) !== canonicalJson(registryBindingSet(value.bindings, graph)) || canonicalJson(consumed) !== canonicalJson(value.consumedDecisionRefs.map((ref) => ref.digest)) || (value.transitionLedgerHeadRef ? value.transitionLedgerHeadRef.digest : "") !== priorDigest) fail("direct_memory_authority_cutover_registry_replay_mismatch", value.registryId);
  checked(value, "registryDigest", "direct-memory-authority-cutover-registry@1", "memoryAuthorityCutoverRegistry");
  return true;
}
function cutoverMemoryAuthorityBinding(input = {}, options = {}) {
  const source = object(input, "memoryAuthorityCutoverInput");
  const registry = source.registry;
  const graph = source.graph;
  const validationContext = { graph, graphProjection: source.graphProjection, graphProjections: [source.graphProjection].filter(Boolean), contextualAuthorityDecisionRefs: [source.contextualAuthorityDecisionRef].filter(Boolean), contextualAdmissionRefs: [source.contextualAdmissionRef].filter(Boolean), governanceRegistries: [source.governanceRegistry].filter(Boolean) };
  try { validateMemoryAuthorityCutoverRegistry(registry, validationContext); validateHierarchicalWorldmodelGraph(graph); } catch (error) { return { committed: false, remand: error.code || "direct_memory_authority_cutover_registry_invalid", registry, receipt: null }; }
  if (source.expectedRegistryRevision !== registry.revision) return { committed: false, remand: "direct_memory_authority_cutover_stale_revision", registry, receipt: null };
  const prior = registry.bindings.find((binding) => binding.bindingId === source.bindingId);
  const row = source.memoryRow;
  if (!prior || prior.compatibilityState !== "legacy_memory_primary" || !row || row.memoryId !== prior.memoryId || row.digest !== prior.memoryArtifactRef.sourceDigest?.value) return { committed: false, remand: "direct_memory_authority_cutover_legacy_row_mismatch", registry, receipt: null };
  const node = graph.nodes.find((entry) => entry.nodeId === prior.semanticNodeId);
  const projection = source.graphProjection;
  try { validateWorldmodelGraphProjection(projection); } catch (error) { return { committed: false, remand: error.code || "direct_memory_authority_cutover_projection_invalid", registry, receipt: null }; }
  const authority = memoryAuthorityRef(source.contextualAuthorityDecisionRef, "contextual_authority_decision", "contextualAuthorityDecision");
  const admission = memoryAuthorityRef(source.contextualAdmissionRef, "contextual_admission", "contextualAdmission");
  if (!node || node.digest !== prior.semanticNodeDigest || node.scope.projectId !== registry.projectId || graph.userProfileId !== registry.userProfileId || projection.graphRef.id !== graph.graphId || projection.graphRef.digest !== graph.digest || projection.policyRef.id !== source.policyRef?.id || projection.policyRef.digest !== source.policyRef?.digest || !projection.selectedNodeRefs.some((ref) => ref.id === node.nodeId && ref.digest === node.digest) || registry.consumedDecisionRefs.some((ref) => ref.digest === authority.digest)) return { committed: false, remand: "direct_memory_authority_cutover_context_mismatch", registry, receipt: null };
  const managerProfile = source.managerProfile;
  const custodyMatrix = source.custodyMatrix;
  const custodyWitness = source.custodyWriteWitness;
  const governanceRegistry = source.governanceRegistry;
  if (!governanceRegistry)
    return { committed: false, remand: "direct_governance_registry_required", registry, governanceRegistry: null, receipt: null };
  const scopeRevision = projection.sourceScopeRevisions.find((ref) => ref.scopeKind === "project" && ref.projectId === registry.projectId);
  const governanceContext = { registryRef: source.governanceRegistryRef, expectedRegistryRevision: source.expectedGovernanceRegistryRevision, graphId: graph.graphId, graphDigest: graph.digest, userProfileId: graph.userProfileId, scopeKind: "project", projectId: registry.projectId, projectRootNodeId: graph.nodes.find((entry) => entry.nodeKind === "project_root" && entry.scope.projectId === registry.projectId)?.nodeId, role: "project_manager", agentId: managerProfile?.projectManagerAgentId, purpose: "memory_authority_cutover", expectedScopeRevisionDigest: scopeRevision?.digest, requiredArtifacts: [
    { kind: "project_manager_profile", id: managerProfile?.projectManagerProfileId, digest: managerProfile?.profileDigest },
    { kind: "project_root", id: graph.nodes.find((entry) => entry.nodeKind === "project_root" && entry.scope.projectId === registry.projectId)?.nodeId, digest: graph.nodes.find((entry) => entry.nodeKind === "project_root" && entry.scope.projectId === registry.projectId)?.digest },
    { kind: "custody_matrix", id: custodyMatrix?.matrixId, digest: custodyMatrix?.matrixDigest },
    { kind: "custody_witness", id: custodyWitness?.path, digest: custodyWitness?.writeWitnessDigest },
    { kind: "authority_decision", id: authority.id, digest: authority.digest, oneShot: true },
  ] };
  let nextGovernanceRegistry;
  try {
    const governance = require("./governance-provenance-registry");
    governance.requireGovernanceProvenanceAdmission(governanceRegistry, governanceContext);
    nextGovernanceRegistry = governance.consumeGovernanceProvenanceAdmission(governanceRegistry, { ...governanceContext, consumeArtifacts: [governanceContext.requiredArtifacts.at(-1)], transitionId: `consume_memory_cutover_${source.cutoverId}`, createdAt: source.createdAt }, options);
  } catch (error) {
    return { committed: false, remand: error.code || "direct_memory_authority_cutover_governance_invalid", registry, governanceRegistry, receipt: null };
  }
  const next = buildScopedWorldMemoryBinding({ ...prior, compatibilityState: "graph_primary", sourceRefs: prior.sourceRefs }, options);
  const receipt = { schema: MEMORY_AUTHORITY_CUTOVER_RECEIPT_SCHEMA, receiptId: safeId(source.receiptId || `memory_cutover_${prior.bindingId}_${registry.revision + 1}`, "memory_authority_cutover_receipt"), cutoverId: safeId(source.cutoverId, "memory_authority_cutover"), registryId: registry.registryId, expectedRegistryRevision: registry.revision, resultingRegistryRevision: registry.revision + 1, priorRegistryDigest: registry.transitionLedgerHeadRef?.digest || "", bindingId: prior.bindingId, memoryId: prior.memoryId, legacyMemoryRowRef: exactRef("agent_memory_row", row.memoryId, row.digest), semanticNodeRef: exactRef("worldmodel_semantic_node", node.nodeId, node.digest), graphRef: exactRef("hierarchical_worldmodel_graph", graph.graphId, graph.digest), projectionRef: exactRef("worldmodel_graph_projection", projection.projectionId, projection.projectionDigest), policyRef: exactRef("worldmodel_projection_policy", projection.policyRef.id, projection.policyRef.digest), managerProfileRef: exactRef("project_manager_profile", managerProfile.projectManagerProfileId, managerProfile.profileDigest), custodyMatrixRef: exactRef("project_custody_write_matrix", custodyMatrix.matrixId, custodyMatrix.matrixDigest), custodyWitnessRef: { kind: "project_custody_write_witness", id: custodyWitness.path, digest: custodyWitness.writeWitnessDigest, rawTextIncluded: false, rawPathIncluded: false, rawSecretIncluded: false }, contextualAuthorityDecisionRef: authority, contextualAdmissionRef: admission, governanceRegistryPreRef: require("./governance-provenance-registry").registryRef(governanceRegistry), governanceRegistryPostRef: require("./governance-provenance-registry").registryRef(nextGovernanceRegistry), priorBinding: prior, nextBinding: next, priorCompatibilityState: prior.compatibilityState, nextCompatibilityState: next.compatibilityState, priorBindingRevision: registry.revision, nextBindingRevision: registry.revision + 1, priorTransitionRef: registry.transitionLedgerHeadRef, };
  receipt.receiptDigest = digest("direct-memory-authority-cutover-receipt@1", receipt);
  const nextRegistry = buildMemoryAuthorityCutoverRegistry({ ...registry, revision: registry.revision + 1, bindings: registry.bindings.map((binding) => binding.bindingId === prior.bindingId ? next : binding), transitions: [...registry.transitions, receipt], consumedDecisionRefs: [...registry.consumedDecisionRefs, authority], transitionLedgerHeadRef: { id: receipt.receiptId, digest: receipt.receiptDigest } }, { ...validationContext, governanceRegistries: [governanceRegistry, nextGovernanceRegistry] });
  if (source.memoryAuthorityRuntime) {
    try {
      installMemoryAuthorityCutoverRuntimeHead(source.memoryAuthorityRuntime, {
        expectedRevision: source.expectedRuntimeHeadRevision,
        registry: nextRegistry,
        graphContext: {
          graph,
          graphProjection: projection,
          contextualAuthorityDecisionRefs: [source.contextualAuthorityDecisionRef],
          contextualAdmissionRefs: [source.contextualAdmissionRef],
          governanceRegistries: [governanceRegistry, nextGovernanceRegistry],
        },
      });
    } catch (error) {
      return { committed: false, remand: error.code || "direct_memory_authority_runtime_head_invalid", registry, governanceRegistry, receipt: null };
    }
  }
  return { committed: true, registry: nextRegistry, governanceRegistry: nextGovernanceRegistry, receipt };
}

function cloneMemoryAuthorityRuntimeValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function validateMemoryAuthorityRuntimeHead(value) {
  object(value, "memoryAuthorityCutoverRuntimeHead");
  closed(value, new Set(["schema", "runtimeId", "revision", "registry", "graphContext", "headDigest"]), "memoryAuthorityCutoverRuntimeHead");
  if (value.schema !== MEMORY_AUTHORITY_CUTOVER_RUNTIME_HEAD_SCHEMA || !Number.isInteger(value.revision) || value.revision < 0)
    fail("direct_memory_authority_runtime_head_invalid", "schema_or_revision");
  string(value.runtimeId, "memoryAuthorityCutoverRuntimeHead.runtimeId");
  object(value.graphContext, "memoryAuthorityCutoverRuntimeHead.graphContext");
  const graph = value.graphContext.graph;
  const graphProjection = value.graphContext.graphProjection;
  try {
    validateHierarchicalWorldmodelGraph(graph);
    validateWorldmodelGraphProjection(graphProjection);
    validateMemoryAuthorityCutoverRegistry(value.registry, {
      graph,
      graphProjection,
      graphProjections: [graphProjection],
      contextualAuthorityDecisionRefs: value.graphContext.contextualAuthorityDecisionRefs || [],
      contextualAdmissionRefs: value.graphContext.contextualAdmissionRefs || [],
      governanceRegistries: value.graphContext.governanceRegistries || [],
    });
  } catch (error) {
    fail(error.code || "direct_memory_authority_runtime_head_invalid", "authority_context");
  }
  if (value.registry.projectId !== graphProjection.focalScope?.projectId || value.registry.userProfileId !== graph.userProfileId || graphProjection.graphRef?.id !== graph.graphId || graphProjection.graphRef?.digest !== graph.digest)
    fail("direct_memory_authority_runtime_head_invalid", "graph_context_binding");
  const copy = { ...value };
  delete copy.headDigest;
  if (value.headDigest !== digest("direct-memory-authority-cutover-runtime-head@1", copy))
    fail("direct_memory_authority_runtime_head_invalid", "digest");
  return true;
}

function makeMemoryAuthorityRuntimeHead(runtimeId, revision, authority = {}) {
  const source = object(authority, "memoryAuthorityCutoverRuntimeAuthority");
  const head = {
    schema: MEMORY_AUTHORITY_CUTOVER_RUNTIME_HEAD_SCHEMA,
    runtimeId,
    revision,
    registry: cloneMemoryAuthorityRuntimeValue(source.registry),
    graphContext: cloneMemoryAuthorityRuntimeValue(source.graphContext),
  };
  head.headDigest = digest("direct-memory-authority-cutover-runtime-head@1", head);
  validateMemoryAuthorityRuntimeHead(head);
  return head;
}

// The head file is a cache of the current authority state, not the authority
// history by itself.  A valid earlier head must not become current merely
// because a local file was restored.  Keep an append-only, hash-chained copy
// of every accepted head beside it and require the cache to equal the terminal
// ledger entry on every startup/read.  This is deliberately fail-closed: a
// crash or operator restore that leaves the two files out of sync requires an
// explicit recovery/migration procedure rather than silently reviving legacy
// memory selection.
function memoryAuthorityRuntimeLedgerFile(stateFile) {
  return `${stateFile}.ledger.jsonl`;
}

function makeMemoryAuthorityRuntimeLedgerEntry(runtimeId, head, previousEntryDigest = "") {
  const entry = {
    schema: MEMORY_AUTHORITY_CUTOVER_RUNTIME_LEDGER_ENTRY_SCHEMA,
    runtimeId,
    revision: head.revision,
    previousEntryDigest,
    head: cloneMemoryAuthorityRuntimeValue(head),
  };
  entry.entryDigest = digest("direct-memory-authority-cutover-runtime-ledger-entry@1", entry);
  return entry;
}

function validateMemoryAuthorityRuntimeLedgerEntry(value, expected = {}) {
  object(value, "memoryAuthorityCutoverRuntimeLedgerEntry");
  closed(value, new Set(["schema", "runtimeId", "revision", "previousEntryDigest", "head", "entryDigest"]), "memoryAuthorityCutoverRuntimeLedgerEntry");
  if (value.schema !== MEMORY_AUTHORITY_CUTOVER_RUNTIME_LEDGER_ENTRY_SCHEMA || !Number.isInteger(value.revision) || value.revision < 0)
    fail("direct_memory_authority_runtime_ledger_invalid", "schema_or_revision");
  string(value.runtimeId, "memoryAuthorityCutoverRuntimeLedgerEntry.runtimeId");
  if (typeof value.previousEntryDigest !== "string")
    fail("direct_memory_authority_runtime_ledger_invalid", "previous_entry_digest");
  validateMemoryAuthorityRuntimeHead(value.head);
  if (value.head.runtimeId !== value.runtimeId || value.head.revision !== value.revision)
    fail("direct_memory_authority_runtime_ledger_invalid", "head_binding");
  const copy = { ...value };
  delete copy.entryDigest;
  if (value.entryDigest !== digest("direct-memory-authority-cutover-runtime-ledger-entry@1", copy))
    fail("direct_memory_authority_runtime_ledger_invalid", "digest");
  if (expected.runtimeId && value.runtimeId !== expected.runtimeId)
    fail("direct_memory_authority_runtime_rollback_detected", "ledger_runtime_identity");
  if (expected.revision !== undefined && value.revision !== expected.revision)
    fail("direct_memory_authority_runtime_ledger_invalid", "ledger_revision");
  if ((expected.previousEntryDigest || "") !== value.previousEntryDigest)
    fail("direct_memory_authority_runtime_ledger_invalid", "ledger_chain");
  return true;
}

function readMemoryAuthorityRuntimeLedger(runtime) {
  const state = memoryAuthorityRuntimeState.get(runtime);
  if (!state) fail("direct_memory_authority_runtime_required", "runtime");
  let text;
  try {
    text = fs.readFileSync(state.ledgerFile, "utf8");
  } catch (_) {
    fail("direct_memory_authority_runtime_rollback_detected", "ledger_missing");
  }
  const lines = text.split("\n").filter(Boolean);
  if (!lines.length)
    fail("direct_memory_authority_runtime_rollback_detected", "ledger_empty");
  const entries = [];
  let previousEntryDigest = "";
  for (let index = 0; index < lines.length; index += 1) {
    let entry;
    try {
      entry = JSON.parse(lines[index]);
    } catch (_) {
      fail("direct_memory_authority_runtime_ledger_invalid", `line_${index}`);
    }
    validateMemoryAuthorityRuntimeLedgerEntry(entry, {
      runtimeId: state.runtimeId,
      revision: index,
      previousEntryDigest,
    });
    entries.push(entry);
    previousEntryDigest = entry.entryDigest;
  }
  return entries;
}

function appendMemoryAuthorityRuntimeLedgerHead(runtime, head) {
  const state = memoryAuthorityRuntimeState.get(runtime);
  if (!state) fail("direct_memory_authority_runtime_required", "runtime");
  validateMemoryAuthorityRuntimeHead(head);
  const existing = fs.existsSync(state.ledgerFile) ? readMemoryAuthorityRuntimeLedger(runtime) : [];
  const previous = existing.at(-1);
  if (head.revision !== existing.length)
    fail("direct_memory_authority_runtime_stale_head", "ledger_revision");
  const entry = makeMemoryAuthorityRuntimeLedgerEntry(state.runtimeId, head, previous?.entryDigest || "");
  validateMemoryAuthorityRuntimeLedgerEntry(entry, {
    runtimeId: state.runtimeId,
    revision: existing.length,
    previousEntryDigest: previous?.entryDigest || "",
  });
  fs.mkdirSync(path.dirname(state.ledgerFile), { recursive: true, mode: 0o700 });
  const descriptor = fs.openSync(state.ledgerFile, "a", 0o600);
  try {
    fs.writeSync(descriptor, `${JSON.stringify(entry)}\n`, undefined, "utf8");
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  return entry;
}

function readMemoryAuthorityRuntimeHead(runtime) {
  const state = memoryAuthorityRuntimeState.get(runtime);
  if (!state) fail("direct_memory_authority_runtime_required", "runtime");
  let persisted;
  try {
    persisted = JSON.parse(fs.readFileSync(state.stateFile, "utf8"));
  } catch (_) {
    fail("direct_memory_authority_runtime_head_invalid", "readback");
  }
  validateMemoryAuthorityRuntimeHead(persisted);
  if (persisted.runtimeId !== state.runtimeId)
    fail("direct_memory_authority_runtime_head_invalid", "runtime_identity");
  const ledger = readMemoryAuthorityRuntimeLedger(runtime);
  const terminal = ledger.at(-1);
  if (!terminal || terminal.head.revision !== persisted.revision || terminal.head.headDigest !== persisted.headDigest)
    fail("direct_memory_authority_runtime_rollback_detected", "head_not_terminal_ledger_state");
  return persisted;
}

function persistMemoryAuthorityRuntimeHead(runtime, head) {
  const state = memoryAuthorityRuntimeState.get(runtime);
  if (!state) fail("direct_memory_authority_runtime_required", "runtime");
  validateMemoryAuthorityRuntimeHead(head);
  if (head.runtimeId !== state.runtimeId)
    fail("direct_memory_authority_runtime_head_invalid", "runtime_identity");
  fs.mkdirSync(path.dirname(state.stateFile), { recursive: true, mode: 0o700 });
  const tempFile = `${state.stateFile}.${process.pid}.${Date.now()}.tmp`;
  const descriptor = fs.openSync(tempFile, "w", 0o600);
  try {
    fs.writeSync(descriptor, `${JSON.stringify(head)}\n`, undefined, "utf8");
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  fs.renameSync(tempFile, state.stateFile);
}

function createMemoryAuthorityCutoverRuntime(input = {}) {
  const source = object(input, "memoryAuthorityCutoverRuntimeInput");
  const stateFile = normalizeString(source.stateFile, "") || (normalizeString(source.stateDirectory, "") ? path.join(path.resolve(source.stateDirectory), "memory-authority-cutover-head.json") : "");
  if (!stateFile) fail("direct_memory_authority_runtime_state_file_required", "stateFile");
  const resolvedStateFile = path.resolve(stateFile);
  const runtimeId = safeId(source.runtimeId || source.id, "memory_authority_cutover_runtime");
  const runtime = {};
  const ledgerFile = memoryAuthorityRuntimeLedgerFile(resolvedStateFile);
  memoryAuthorityRuntimeState.set(runtime, { runtimeId, stateFile: resolvedStateFile, ledgerFile });
  if (fs.existsSync(resolvedStateFile)) {
    if (!fs.existsSync(ledgerFile))
      fail("direct_memory_authority_runtime_rollback_detected", "ledger_missing_for_existing_head");
    const head = readMemoryAuthorityRuntimeHead(runtime);
    if (head.runtimeId !== runtimeId)
      fail("direct_memory_authority_runtime_head_invalid", "configured_runtime_identity");
  } else {
    if (fs.existsSync(ledgerFile))
      fail("direct_memory_authority_runtime_rollback_detected", "head_missing_for_existing_ledger");
    const initial = makeMemoryAuthorityRuntimeHead(runtimeId, 0, source);
    persistMemoryAuthorityRuntimeHead(runtime, initial);
    appendMemoryAuthorityRuntimeLedgerHead(runtime, initial);
  }
  Object.defineProperties(runtime, {
    runtimeId: { value: runtimeId, enumerable: true },
    schema: { value: MEMORY_AUTHORITY_CUTOVER_RUNTIME_SCHEMA, enumerable: true },
    resolveMemoryAuthority: { value: (request = {}) => resolveMemoryAuthorityFromCutoverRuntime(runtime, request), enumerable: false },
  });
  return Object.freeze(runtime);
}

function installMemoryAuthorityCutoverRuntimeHead(runtime, input = {}) {
  const previous = readMemoryAuthorityRuntimeHead(runtime);
  const source = object(input, "memoryAuthorityCutoverRuntimeInstallInput");
  if (source.expectedRevision !== undefined && source.expectedRevision !== previous.revision)
    fail("direct_memory_authority_runtime_stale_head", "revision");
  const next = makeMemoryAuthorityRuntimeHead(previous.runtimeId, previous.revision + 1, source);
  // Append evidence before replacing the cache.  Any interrupted write or
  // later rollback leaves a mismatch and therefore fails closed on reopen.
  appendMemoryAuthorityRuntimeLedgerHead(runtime, next);
  persistMemoryAuthorityRuntimeHead(runtime, next);
  return cloneMemoryAuthorityRuntimeValue(next);
}

function resolveMemoryAuthorityFromCutoverRuntime(runtime, request = {}) {
  const head = readMemoryAuthorityRuntimeHead(runtime);
  const source = isPlainObject(request) ? request : {};
  const memoryIds = [...new Set((Array.isArray(source.memoryIds) ? source.memoryIds : []).map((entry) => normalizeString(entry, "")).filter(Boolean))].sort();
  if (!memoryIds.length) fail("direct_memory_authority_runtime_identity_missing", "memoryIds");
  if (normalizeString(source.projectId, "") !== head.registry.projectId)
    fail("direct_memory_authority_runtime_project_mismatch", "projectId");
  const bindings = new Map(head.registry.bindings.map((binding) => [binding.memoryId, binding]));
  for (const memoryId of memoryIds) {
    const binding = bindings.get(memoryId);
    if (!binding || binding.projectId !== head.registry.projectId)
      fail("direct_memory_authority_runtime_identity_missing", memoryId);
  }
  return {
    registry: cloneMemoryAuthorityRuntimeValue(head.registry),
    graphContext: cloneMemoryAuthorityRuntimeValue(head.graphContext),
    headRef: { runtimeId: head.runtimeId, revision: head.revision, digest: head.headDigest },
  };
}

function markArtifactDriftStale(input = {}, options = {}) {
  const source = object(input, "artifactDriftStaleInput");
  const graph = source.graph;
  validateHierarchicalWorldmodelGraph(graph);
  const claim = graph.nodes.find((node) => node.nodeId === source.claimNodeId);
  const edge = graph.edges.find(
    (entry) => entry.edgeId === source.implementsEdgeId,
  );
  const goal = graph.nodes.find(
    (node) => node.nodeId === source.independentGoalNodeId,
  );
  if (
    !claim ||
    !edge ||
    edge.relationKind !== "implements" ||
    ![edge.fromNodeId, edge.toNodeId].includes(claim.nodeId) ||
    !goal ||
    ![edge.fromNodeId, edge.toNodeId].includes(goal.nodeId) ||
    !["goal", "terminal_goal", "invariant"].includes(goal.nodeKind) ||
    goal.lifecycle !== "active" ||
    goal.nodeId === claim.nodeId
  )
    return {
      committed: false,
      remand:
        "implementation_claim_implements_edge_and_independent_goal_required",
      graph,
    };
  const before = source.artifactBeforeRef;
  const after = source.artifactAfterRef;
  const authority = source.authorityTraceRef;
  if (
    !before ||
    !after ||
    !authority ||
    normalizeString(before.sourceId, "") !==
      normalizeString(after.sourceId, "") ||
    before.sourceDigest?.value === after.sourceDigest?.value ||
    !SHA256.test(before.sourceDigest?.value || "") ||
    !SHA256.test(after.sourceDigest?.value || "") ||
    !claim.sourceRefs.some(
      (ref) =>
        ref.sourceId === before.sourceId &&
        ref.sourceDigest?.value === before.sourceDigest?.value,
    ) ||
    authority.sourceKind !== "promotion_decision" ||
    !SHA256.test(authority.sourceDigest?.value || "") ||
    claim.sourceRefs.some((ref) => ref.sourceId === authority.sourceId) ||
    !normalizeString(source.actorAgentId, "")
  )
    return {
      committed: false,
      remand: "artifact_drift_evidence_and_separate_authority_trace_required",
      graph,
    };
  const expectedScopeRevisions =
    source.expectedScopeRevisions ||
    graph.scopedRevisionRefs.filter(
      (ref) =>
        ref.scopeKind === claim.scope.scopeKind &&
        ref.projectId === claim.scope.projectId &&
        ref.workThreadId === claim.scope.workThreadId,
    );
  if (!source.contextualAdmission || !source.writeAuthorization)
    return { committed: false, remand: "artifact_drift_contextual_admission_required", graph };
  if (!source.governanceRegistry)
    return { committed: false, remand: "direct_governance_registry_required", graph };
  const admittedMutations = source.contextualAdmission.mutations;
  const hasRef = (refs, ref) =>
    Array.isArray(refs) &&
    refs.some(
      (entry) =>
        entry.sourceId === ref.sourceId &&
        entry.sourceDigest?.value === ref.sourceDigest?.value,
    );
  const admittedClaim = admittedMutations?.find(
    (mutation) =>
      mutation.mutationKind === "revise_node" &&
      mutation.targetId === claim.nodeId,
  )?.node;
  const admittedEdge = admittedMutations?.find(
    (mutation) =>
      mutation.mutationKind === "revise_edge" &&
      mutation.targetId === edge.edgeId,
  )?.edge;
  if (
    !Array.isArray(admittedMutations) ||
    admittedMutations.length !== 2 ||
    admittedClaim?.epistemicStatus !== "stale" ||
    admittedClaim?.integrationStatus !== "not_integrated" ||
    admittedClaim?.projectionEligibility !== "blocked_stale" ||
    admittedEdge?.lifecycle !== "stale" ||
    admittedEdge?.epistemicStatus !== "stale" ||
    !hasRef(admittedClaim?.sourceRefs, before) ||
    !hasRef(admittedClaim?.sourceRefs, after) ||
    !hasRef(admittedEdge?.sourceRefs, before) ||
    !hasRef(admittedEdge?.sourceRefs, after) ||
    // Drift is a new artifact observation, never a replacement genealogy.
    // Preserve every prior exact source identity on both revised bodies.
    !claim.sourceRefs.every((ref) => hasRef(admittedClaim?.sourceRefs, ref)) ||
    !edge.sourceRefs.every((ref) => hasRef(admittedEdge?.sourceRefs, ref))
  )
    return { committed: false, remand: "artifact_drift_genealogy_not_preserved", graph };
  const result = appendWorldmodelGraphTransition(
    graph,
    {
      transitionId: source.transitionId || `artifact_drift_${claim.nodeId}`,
      deltaCandidateId:
        source.deltaCandidateId || `artifact_drift_${claim.nodeId}`,
      idempotencyKey:
        source.idempotencyKey ||
        `artifact_drift_${claim.nodeId}_${edge.edgeId}`,
      actorRole: source.contextualAdmission.actorRole,
      actorAgentId: source.contextualAdmission.actorAgentId,
      expectedScopeRevisions,
      mutations: admittedMutations,
      sourceRefs: [before, after],
      authorityTraceRef: authority,
      contextualAdmission: source.contextualAdmission,
      governanceRegistry: source.governanceRegistry,
      storeAdmission: source.storeAdmission,
      writeAuthorization: source.writeAuthorization,
    },
    options,
  );
  if (!result.committed) return { ...result, witness: null };
  const resultingRevision = result.graph.scopedRevisionRefs.find(
    (ref) =>
      ref.scopeKind === claim.scope.scopeKind &&
      ref.projectId === claim.scope.projectId &&
      ref.workThreadId === claim.scope.workThreadId,
  );
  const witness = {
    schema: ARTIFACT_DRIFT_STALE_WITNESS_SCHEMA,
    witnessId: safeId(
      source.witnessId || `artifact_drift_witness_${claim.nodeId}`,
      "artifact_drift_witness",
    ),
    implementationClaimNodeId: claim.nodeId,
    implementsEdgeId: edge.edgeId,
    independentGoalNodeId: goal.nodeId,
    artifactIdentity: before.sourceId,
    beforeArtifactRef: before,
    afterArtifactRef: after,
    authorityTraceRef: authority,
    transitionRef: sourceRef(
      result.transition.transitionId,
      result.transition.digest,
      "worldmodel_graph_transition",
      "accepted",
    ),
    resultingGraphRef: exactRef(
      "hierarchical_worldmodel_graph",
      result.graph.graphId,
      result.graph.digest,
    ),
    resultingScopeRevision: resultingRevision,
    claimMarkedStale: Boolean(
      result.graph.nodes.find(
        (node) =>
          node.nodeId === claim.nodeId && node.epistemicStatus === "stale",
      ),
    ),
    implementsEdgeMarkedStale: Boolean(
      result.graph.edges.find(
        (entry) => entry.edgeId === edge.edgeId && entry.lifecycle === "stale",
      ),
    ),
    independentGoalPreserved: Boolean(
      result.graph.nodes.find(
        (node) => node.nodeId === goal.nodeId && node.lifecycle === "active",
      ),
    ),
    committed: result.committed,
    actionAuthorityGranted: false,
    rawTextIncluded: false,
  };
  witness.witnessDigest = digest(
    "direct-artifact-drift-stale-witness@1",
    witness,
  );
  return { ...result, witness };
}
function validateArtifactDriftStaleWitness(value, context = {}) {
  object(value, "artifactDriftStaleWitness");
  closed(
    value,
    new Set([
      "schema",
      "witnessId",
      "implementationClaimNodeId",
      "implementsEdgeId",
      "independentGoalNodeId",
      "artifactIdentity",
      "beforeArtifactRef",
      "afterArtifactRef",
      "authorityTraceRef",
      "transitionRef",
      "resultingGraphRef",
      "resultingScopeRevision",
      "claimMarkedStale",
      "implementsEdgeMarkedStale",
      "independentGoalPreserved",
      "committed",
      "actionAuthorityGranted",
      "rawTextIncluded",
      "witnessDigest",
    ]),
    "artifactDriftStaleWitness",
  );
  if (
    value.schema !== ARTIFACT_DRIFT_STALE_WITNESS_SCHEMA ||
    !value.committed ||
    !value.claimMarkedStale ||
    !value.implementsEdgeMarkedStale ||
    !value.independentGoalPreserved ||
    value.actionAuthorityGranted !== false ||
    value.rawTextIncluded !== false ||
    value.beforeArtifactRef?.sourceId !== value.artifactIdentity ||
    value.afterArtifactRef?.sourceId !== value.artifactIdentity ||
    value.beforeArtifactRef?.sourceDigest?.value ===
      value.afterArtifactRef?.sourceDigest?.value ||
    value.authorityTraceRef?.sourceKind !== "promotion_decision"
  )
    fail(
      "direct_worldmodel_migration_artifact_drift_witness_invalid",
      "artifactDriftStaleWitness",
    );
  [
    value.beforeArtifactRef,
    value.afterArtifactRef,
    value.authorityTraceRef,
    value.transitionRef,
  ].forEach((ref, index) =>
    exactDigest(
      ref?.sourceDigest?.value,
      `artifactDriftStaleWitness.ref${index}`,
    ),
  );
  exactDigest(
    value.resultingGraphRef?.digest,
    "artifactDriftStaleWitness.resultingGraphRef",
  );
  if (!value.resultingScopeRevision?.digest)
    fail(
      "direct_worldmodel_migration_artifact_drift_witness_invalid",
      "resultingScopeRevision",
    );
  checked(
    value,
    "witnessDigest",
    "direct-artifact-drift-stale-witness@1",
    "artifactDriftStaleWitness",
  );
  if (context.graph) {
    validateHierarchicalWorldmodelGraph(context.graph);
    if (
      context.graph.digest !== value.resultingGraphRef.digest ||
      !context.graph.transitions.some(
        (transition) =>
          transition.transitionId === value.transitionRef.sourceId &&
          transition.digest === value.transitionRef.sourceDigest.value,
      )
    )
      fail(
        "direct_worldmodel_migration_artifact_drift_receipt_mismatch",
        "artifactDriftStaleWitness",
      );
  }
  return true;
}

module.exports = {
  WORLDMODEL_MIGRATION_REPORT_SCHEMA,
  LEGACY_AGENT_MEMORY_PROMOTION_CANDIDATE_SCHEMA,
  WORK_THREAD_PROJECT_PARENT_LINKAGE_WITNESS_SCHEMA,
  SCOPED_WORLD_MEMORY_NO_DOUBLE_INCLUSION_WITNESS_SCHEMA,
  ARTIFACT_DRIFT_STALE_WITNESS_SCHEMA,
  MEMORY_AUTHORITY_CUTOVER_REGISTRY_SCHEMA,
  MEMORY_AUTHORITY_CUTOVER_RECEIPT_SCHEMA,
  MEMORY_AUTHORITY_CUTOVER_RUNTIME_SCHEMA,
  MEMORY_AUTHORITY_CUTOVER_RUNTIME_HEAD_SCHEMA,
  MEMORY_AUTHORITY_CUTOVER_RUNTIME_LEDGER_ENTRY_SCHEMA,
  buildLegacyAgentMemoryPromotionCandidate,
  validateLegacyAgentMemoryPromotionCandidate,
  buildWorkThreadProjectParentLinkageWitness,
  validateWorkThreadProjectParentLinkageWitness,
  buildScopedWorldMemoryNoDoubleInclusionWitness,
  validateScopedWorldMemoryNoDoubleInclusionWitness,
  buildWorldmodelMigrationReport,
  validateWorldmodelMigrationReport,
  buildMemoryAuthorityCutoverRegistry,
  validateMemoryAuthorityCutoverRegistry,
  cutoverMemoryAuthorityBinding,
  createMemoryAuthorityCutoverRuntime,
  installMemoryAuthorityCutoverRuntimeHead,
  resolveMemoryAuthorityFromCutoverRuntime,
  markArtifactDriftStale,
  validateArtifactDriftStaleWitness,
};
