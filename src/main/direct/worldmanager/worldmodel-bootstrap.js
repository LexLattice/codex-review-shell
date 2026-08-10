"use strict";

const path = require("node:path");
const {
  buildHierarchicalWorldmodelGraph,
  buildScopedWorldmodelRevisionRef,
  buildWorldmodelSemanticEdge,
  buildWorldmodelSemanticNode,
  validateHierarchicalWorldmodelGraph,
} = require("../worldmodel/hierarchical-graph");
const {
  buildGovernanceProvenanceRegistry,
} = require("../worldmodel/governance-provenance-registry");
const {
  buildWorldmodelTrustAnchor,
  createWorldmodelTrustStore,
  initializeAuthoritativeWorldmodelGraph,
  readAuthoritativeWorldmodelGraphById,
} = require("../worldmodel/governance-trust-store");
const {
  buildProjectManagerProfile,
  validateProjectManagerProfile,
} = require("../worldmodel/project-manager");
const {
  buildWorldmodelManagerProfile,
  validateWorldmodelManagerProfile,
} = require("../worldmodel/manager");
const {
  buildWorldmodelGraphProjection,
  buildWorldmodelProjectionPolicy,
  validateWorldmodelGraphProjection,
  validateWorldmodelProjectionPolicy,
} = require("../worldmodel/graph-projection");
const {
  buildManagerTurnBootPacket,
  validateManagerTurnBootPacket,
} = require("../worldmodel/manager-turn-context");
const { normalizeOdeuSourceRefs } = require("../odeu/source-ref");
const { digestFor, stableId } = require("./control-plane");
const {
  validateWorldManagerTaskSettlement,
} = require("./settlement");
const {
  admitArtifactRevisionToWorldmodel,
  canonicalRevisionRefsForArtifactScope,
  projectManagerActorRef,
} = require("./artifact-canonical-admission");

const WORLD_MANAGER_GRAPH_BINDING_SCHEMA =
  "direct_world_manager_graph_binding@1";
const WORLD_MANAGER_CONTEXT_BUNDLE_SCHEMA =
  "direct_world_manager_context_bundle@1";
const TRUST_STORE_DIRECTORY = "worldmodel-trust-store";

function fail(code, detail = "") {
  const error = new Error(detail ? `${code}:${detail}` : code);
  error.code = code;
  if (detail) error.detail = detail;
  throw error;
}

function sourceRefsForBootstrap(bootstrap) {
  return normalizeOdeuSourceRefs([
    {
      sourceRefId: `world_manager_bootstrap_${bootstrap.bootstrapId}`,
      sourceKind: "family_specific",
      sourceId: bootstrap.bootstrapId,
      sourceConfidence: "exact",
      freshness: "fresh",
      observedAt: bootstrap.createdAt,
      sourceDigest: {
        algorithm: "sha256",
        value: bootstrap.manifestDigest,
        digestOf: "canonical_json",
      },
    },
  ]);
}

function semanticNode(input, bootstrap) {
  return buildWorldmodelSemanticNode(
    {
      ...input,
      sourceRefs: sourceRefsForBootstrap(bootstrap),
      promotionTransitionRefs: [],
      lifecycle: "active",
      integrationStatus: "integrated",
      epistemicStatus: "accepted",
      projectionEligibility: "eligible",
      createdAt: bootstrap.createdAt,
      updatedAt: bootstrap.createdAt,
    },
    { now: () => Date.parse(bootstrap.createdAt) },
  );
}

function buildBootstrapGraph(bootstrap, trustAnchorRef) {
  const userProfileId = bootstrap.userWorld.userWorldId;
  const graphId = stableId("worldmanager_graph", { userProfileId });
  const rootNodeId = stableId("world_root", { userProfileId });
  const nodes = [
    semanticNode(
      {
        nodeId: rootNodeId,
        graphId,
        scope: {
          scopeKind: "user_world",
          userProfileId,
          semanticPath: ["world"],
        },
        nodeKind: "world_root",
        abstractionLevel: "world",
        semanticSummary:
          "Canonical user-world root for WorldManager keyboard settlement.",
        normativeForce: "constitutional",
        custodianRole: "world_manager",
        authorizedWriterRoles: ["world_manager"],
        structuredValue: {
          bootstrapConfigurationDigest: bootstrap.configurationDigest,
          bootstrapId: bootstrap.bootstrapId,
        },
      },
      bootstrap,
    ),
    semanticNode(
      {
        nodeId: stableId("world_principle", {
          userProfileId,
          principle: "semantic_authority_separation",
        }),
        graphId,
        scope: {
          scopeKind: "user_world",
          userProfileId,
          semanticPath: ["world", "principles"],
        },
        nodeKind: "principle",
        abstractionLevel: "strategic",
        semanticSummary:
          "Settlement and routing never grant canonical write or execution authority.",
        normativeForce: "constitutional",
        custodianRole: "world_manager",
        authorizedWriterRoles: ["world_manager"],
        structuredValue: {
          principleId: "semantic_authority_separation",
          sensitivity: "public",
        },
      },
      bootstrap,
    ),
  ];
  const edges = [];
  for (const project of bootstrap.projects) {
    const projectRootNodeId = project.projectWorldId;
    const statusNodeId = stableId("project_status", {
      userProfileId,
      projectId: project.projectId,
    });
    nodes.push(
      semanticNode(
        {
          nodeId: projectRootNodeId,
          graphId,
          scope: {
            scopeKind: "project",
            userProfileId,
            projectId: project.projectId,
            semanticPath: ["projects", project.projectId],
          },
          nodeKind: "project_root",
          abstractionLevel: "strategic",
          semanticSummary: `${project.name}: ${project.summary}`,
          normativeForce: "project_commitment",
          custodianRole: "project_manager",
          authorizedWriterRoles: ["project_manager", "world_manager"],
          structuredValue: {
            projectId: project.projectId,
            configurationDigest: project.configurationDigest,
            sensitivity: "project_scoped",
          },
        },
        bootstrap,
      ),
      semanticNode(
        {
          nodeId: statusNodeId,
          graphId,
          scope: {
            scopeKind: "project",
            userProfileId,
            projectId: project.projectId,
            semanticPath: ["projects", project.projectId, "status"],
          },
          nodeKind: "project_status",
          abstractionLevel: "operational",
          semanticSummary:
            "Configured and available for semantic settlement; no role turn has run.",
          normativeForce: "informational",
          custodianRole: "project_manager",
          authorizedWriterRoles: ["project_manager", "world_manager"],
          structuredValue: {
            projectId: project.projectId,
            runtimePathClass: project.runtimePath,
            sensitivity: "project_scoped",
          },
        },
        bootstrap,
      ),
    );
    edges.push(
      buildWorldmodelSemanticEdge({
        edgeId: stableId("world_edge", {
          graphId,
          fromNodeId: rootNodeId,
          toNodeId: projectRootNodeId,
        }),
        graphId,
        fromNodeId: rootNodeId,
        toNodeId: projectRootNodeId,
        relationKind: "supports",
        epistemicStatus: "accepted",
        lifecycle: "active",
        sourceRefs: sourceRefsForBootstrap(bootstrap),
      }),
      buildWorldmodelSemanticEdge({
        edgeId: stableId("project_edge", {
          graphId,
          fromNodeId: projectRootNodeId,
          toNodeId: statusNodeId,
        }),
        graphId,
        fromNodeId: projectRootNodeId,
        toNodeId: statusNodeId,
        relationKind: "supports",
        epistemicStatus: "accepted",
        lifecycle: "active",
        sourceRefs: sourceRefsForBootstrap(bootstrap),
      }),
    );
  }
  const scopedRevisionRefs = [
    buildScopedWorldmodelRevisionRef({
      scopeKind: "user_world",
      revision: 0,
    }),
    ...bootstrap.projects.map((project) =>
      buildScopedWorldmodelRevisionRef({
        scopeKind: "project",
        projectId: project.projectId,
        revision: 0,
      }),
    ),
  ];
  const graph = buildHierarchicalWorldmodelGraph(
    {
      graphId,
      userProfileId,
      rootNodeId,
      trustAnchorRef,
      nodes,
      edges,
      scopedRevisionRefs,
      materializedAt: bootstrap.createdAt,
    },
    { now: () => Date.parse(bootstrap.createdAt) },
  );
  validateHierarchicalWorldmodelGraph(graph);
  return graph;
}

function graphBindingFor(bootstrap, graph, trustStoreState) {
  const rootNode = graph.nodes.find((node) => node.nodeId === graph.rootNodeId);
  const projectRootNodeIds = Object.fromEntries(
    graph.projectRootRefs.map((entry) => [entry.projectId, entry.rootNodeId]),
  );
  const configurationMatches =
    rootNode?.structuredValue?.bootstrapConfigurationDigest ===
      bootstrap.configurationDigest &&
    bootstrap.projects.every((project) => {
      const node = graph.nodes.find(
        (entry) =>
          entry.nodeId === projectRootNodeIds[project.projectId] &&
          entry.nodeKind === "project_root",
      );
      return (
        node?.structuredValue?.configurationDigest ===
        project.configurationDigest
      );
    }) &&
    Object.keys(projectRootNodeIds).length === bootstrap.projects.length;
  const result = {
    schema: WORLD_MANAGER_GRAPH_BINDING_SCHEMA,
    bindingId: stableId("wm_graph_binding", {
      bootstrapId: bootstrap.bootstrapId,
      configurationDigest: bootstrap.configurationDigest,
      graphId: graph.graphId,
      graphDigest: graph.digest,
    }),
    bootstrapRef: {
      kind: "world_manager_bootstrap_manifest",
      id: bootstrap.bootstrapId,
      digest: bootstrap.manifestDigest,
    },
    graphRef: {
      kind: "hierarchical_worldmodel_graph",
      id: graph.graphId,
      digest: graph.digest,
    },
    trustAnchorRef: graph.trustAnchorRef,
    storeRevision: trustStoreState.storeRevision,
    userProfileId: graph.userProfileId,
    worldRootNodeId: graph.rootNodeId,
    projectRootNodeIds,
    configurationDigest: bootstrap.configurationDigest,
    state: configurationMatches ? "bound" : "configuration_drift",
    grantsAuthority: false,
    rawGraphBodyIncluded: false,
  };
  result.digest = digestFor(
    WORLD_MANAGER_GRAPH_BINDING_SCHEMA,
    result,
    ["digest"],
  );
  return result;
}

function authorityBoundaryRef(role, userProfileId, projectId = "") {
  const id = stableId("wm_authority_boundary", {
    role,
    userProfileId,
    projectId,
    boundary: "context_projection_only_k2",
  });
  return {
    kind: "authority_boundary",
    id,
    digest: digestFor("direct-world-manager-context-authority-boundary@1", {
      id,
      role,
      userProfileId,
      projectId,
      grantsAuthority: false,
    }),
  };
}

function managerArtifacts(input = {}) {
  const { bootstrap, graph, taskSettlement } = input;
  const userProfileId = bootstrap.userWorld.userWorldId;
  const managerAgentId = taskSettlement.selectedManagerAgentRef.id;
  const sourceRefs = sourceRefsForBootstrap(bootstrap);
  if (taskSettlement.responsibleRole === "project_manager") {
    const projectId = taskSettlement.projectId;
    const projectRootNodeId = input.graphBinding.projectRootNodeIds[projectId];
    if (!projectRootNodeId) {
      fail("world_manager_project_graph_binding_missing", projectId);
    }
    const policyId = stableId("wm_projection_policy", {
      managerAgentId,
      projectId,
      purpose: "current_context",
    });
    const authoritySourceRef = authorityBoundaryRef(
      "project_manager",
      userProfileId,
      projectId,
    );
    const managerProfile = buildProjectManagerProfile(
      {
        projectManagerProfileId: stableId("project_manager_profile", {
          userProfileId,
          projectId,
        }),
        projectManagerAgentId: managerAgentId,
        worldManagerAgentId: stableId("world_manager_agent", {
          userWorldId: userProfileId,
        }),
        projectId,
        projectRootNodeId,
        authorityBoundaryRef: authoritySourceRef,
        graphProjectionPolicyRef: {
          kind: "graph_projection_policy",
          id: policyId,
          digest: digestFor("direct-world-manager-policy-identity@1", {
            policyId,
          }),
        },
        sourceRefs,
        createdAt: bootstrap.createdAt,
        updatedAt: bootstrap.createdAt,
      },
      { now: () => Date.parse(bootstrap.createdAt) },
    );
    validateProjectManagerProfile(managerProfile);
    const rootNode = graph.nodes.find((node) => node.nodeId === projectRootNodeId);
    const policyArtifact = buildWorldmodelProjectionPolicy({
      graph,
      managerProfile,
      authoritySourceRef,
      policyId,
      purpose: "current_context",
      audienceRole: "project_manager",
      allowedEntryPaths: ["project_resident"],
      allowedFocalScopes: [{ scopeKind: "project", projectId }],
      trustedSeedNodeRefs: [
        {
          kind: "worldmodel_semantic_node",
          id: rootNode.nodeId,
          digest: rootNode.digest,
        },
      ],
      custodyDenyList: [],
      sensitivityDenyList: [
        "private",
        "secret",
        "user_private",
        "manager_private",
        "restricted",
      ],
      allowedRelationKinds: [
        "affects",
        "depends_on",
        "refines",
        "implements",
        "supports",
        "applies_to",
        "relevant_to",
      ],
      maxTraversalDepth: 3,
      semanticBudget: {
        maxNodes: 48,
        maxEdges: 96,
        maxSummaryChars: 12000,
      },
      workerAllowedProjectNodeRefs: [],
    });
    validateWorldmodelProjectionPolicy(policyArtifact, {
      graph,
      managerProfile,
      authoritySourceRef,
      audienceRole: "project_manager",
    });
    return {
      managerProfile,
      policyArtifact,
      authoritySourceRef,
      entryPath: "project_resident",
      focalScope: { scopeKind: "project", projectId },
    };
  }

  const authoritySourceRef = authorityBoundaryRef(
    "world_manager",
    userProfileId,
  );
  const managerProfile = buildWorldmodelManagerProfile(
    {
      managerProfileId: stableId("world_manager_profile", { userProfileId }),
      managerAgentId,
      scope: {
        scopeKind: "global_user",
        userProfileId,
      },
      sourceRefs,
      createdAt: bootstrap.createdAt,
      updatedAt: bootstrap.createdAt,
    },
    { now: () => Date.parse(bootstrap.createdAt) },
  );
  validateWorldmodelManagerProfile(managerProfile);
  const rootNode = graph.nodes.find((node) => node.nodeId === graph.rootNodeId);
  const policyArtifact = buildWorldmodelProjectionPolicy({
    graph,
    managerProfile,
    authoritySourceRef,
    policyId: stableId("wm_projection_policy", {
      managerAgentId,
      purpose: "current_context",
    }),
    purpose: "current_context",
    audienceRole: "world_manager",
    allowedEntryPaths: ["world_root"],
    allowedFocalScopes: [{ scopeKind: "user_world" }],
    trustedSeedNodeRefs: [
      {
        kind: "worldmodel_semantic_node",
        id: rootNode.nodeId,
        digest: rootNode.digest,
      },
    ],
    custodyDenyList: [],
    sensitivityDenyList: [
      "private",
      "secret",
      "user_private",
      "manager_private",
      "restricted",
    ],
    allowedRelationKinds: [
      "affects",
      "depends_on",
      "refines",
      "implements",
      "supports",
      "applies_to",
      "relevant_to",
    ],
    maxTraversalDepth: 2,
    semanticBudget: {
      maxNodes: 64,
      maxEdges: 128,
      maxSummaryChars: 16000,
    },
    workerAllowedProjectNodeRefs: [],
  });
  validateWorldmodelProjectionPolicy(policyArtifact, {
    graph,
    managerProfile,
    authoritySourceRef,
    audienceRole: "world_manager",
  });
  return {
    managerProfile,
    policyArtifact,
    authoritySourceRef,
    entryPath: "world_root",
    focalScope: { scopeKind: "user_world" },
  };
}

class DirectWorldManagerWorldmodelBootstrap {
  constructor(options = {}) {
    if (!options.rootDir) fail("world_manager_worldmodel_root_required");
    this.rootDir = path.join(options.rootDir, TRUST_STORE_DIRECTORY);
    this.now = typeof options.now === "function" ? options.now : Date.now;
    this.trustStore = createWorldmodelTrustStore(this.rootDir, {
      storeId: "world_manager_authoritative_worldmodel",
      now: this.now,
    });
    this.bootstrap = null;
    this.graph = null;
    this.binding = null;
  }

  ensure(bootstrap) {
    this.bootstrap = bootstrap;
    const graphId = stableId("worldmanager_graph", {
      userProfileId: bootstrap.userWorld.userWorldId,
    });
    let state;
    try {
      state = readAuthoritativeWorldmodelGraphById(this.trustStore, graphId);
    } catch (error) {
      if (error?.code !== "direct_worldmodel_trust_store_graph_missing") {
        throw error;
      }
      const trustAnchorRef = buildWorldmodelTrustAnchor(
        this.trustStore,
        graphId,
      );
      const graph = buildBootstrapGraph(bootstrap, trustAnchorRef);
      const registry = buildGovernanceProvenanceRegistry(
        {
          registryId: stableId("wm_governance_registry", {
            graphId,
            phase: "bootstrap",
          }),
          userProfileId: graph.userProfileId,
          revision: 0,
          records: [],
          transitions: [],
          createdAt: bootstrap.createdAt,
        },
        { now: () => Date.parse(bootstrap.createdAt) },
      );
      state = initializeAuthoritativeWorldmodelGraph(
        this.trustStore,
        graph,
        registry,
      );
    }
    this.graph = state.graph;
    this.binding = graphBindingFor(bootstrap, state.graph, state);
    if (this.binding.state !== "bound") {
      fail(
        "world_manager_worldmodel_configuration_drift",
        bootstrap.configurationDigest,
      );
    }
    return {
      graph: this.graph,
      binding: this.binding,
      governanceRegistryRef: state.registryRef,
      storeRevision: state.storeRevision,
    };
  }

  graphBinding() {
    if (!this.binding) fail("world_manager_worldmodel_not_bootstrapped");
    return JSON.parse(JSON.stringify(this.binding));
  }

  canonicalArtifactRevisionRefs(targetAdmissionScope) {
    if (!this.graph || !this.bootstrap || !this.binding) {
      fail("world_manager_worldmodel_not_bootstrapped");
    }
    return canonicalRevisionRefsForArtifactScope({
      trustStore: this.trustStore,
      graphId: this.graph.graphId,
      targetAdmissionScope,
    });
  }

  projectManagerAdmissionActorRef(projectId) {
    if (!this.graph || !this.bootstrap || !this.binding) {
      fail("world_manager_worldmodel_not_bootstrapped");
    }
    return projectManagerActorRef(this.graph.userProfileId, projectId);
  }

  admitArtifactRevision(input = {}) {
    if (!this.graph || !this.bootstrap || !this.binding) {
      fail("world_manager_worldmodel_not_bootstrapped");
    }
    const result = admitArtifactRevisionToWorldmodel({
      ...input,
      trustStore: this.trustStore,
      graphId: this.graph.graphId,
      now: this.now,
    });
    if (result.admitted === true) {
      const state = readAuthoritativeWorldmodelGraphById(
        this.trustStore,
        this.graph.graphId,
      );
      this.graph = state.graph;
      this.binding = graphBindingFor(
        this.bootstrap,
        state.graph,
        state,
      );
      if (this.binding.state !== "bound") {
        fail("world_manager_worldmodel_configuration_drift");
      }
    }
    return result;
  }

  buildManagerContext(input = {}) {
    if (!this.graph || !this.bootstrap || !this.binding) {
      fail("world_manager_worldmodel_not_bootstrapped");
    }
    const taskSettlement = input.taskSettlement;
    validateWorldManagerTaskSettlement(taskSettlement);
    if (taskSettlement.state !== "settled") {
      fail("world_manager_context_requires_settled_task");
    }
    const ingressEnvelope = input.ingressEnvelope;
    const manager = managerArtifacts({
      bootstrap: this.bootstrap,
      graph: this.graph,
      graphBinding: this.binding,
      taskSettlement,
    });
    const graphProjection = buildWorldmodelGraphProjection({
      graph: this.graph,
      managerProfile: manager.managerProfile,
      authoritySourceRef: manager.authoritySourceRef,
      policyArtifact: manager.policyArtifact,
      projectionId: stableId("wm_graph_projection", {
        semanticEventId: taskSettlement.semanticEventId,
      }),
      entryPath: manager.entryPath,
      focalScope: manager.focalScope,
    });
    validateWorldmodelGraphProjection(graphProjection);
    const bootPacket = buildManagerTurnBootPacket({
      bootPacketId: stableId("wm_manager_boot", {
        semanticEventId: taskSettlement.semanticEventId,
      }),
      managerRole: taskSettlement.responsibleRole,
      managerAgentId: taskSettlement.selectedManagerAgentRef.id,
      graphProjection,
      profileSnapshot: manager.managerProfile,
      currentIngress: ingressEnvelope,
      openDecisionRefs: [],
      openRemandRefs: [],
      changesSincePreviousTurnRefs: [],
      targetedEvidenceInspectionArtifacts: [],
    });
    validateManagerTurnBootPacket(bootPacket);
    const result = {
      schema: WORLD_MANAGER_CONTEXT_BUNDLE_SCHEMA,
      contextBundleId: stableId("wm_context_bundle", {
        semanticEventId: taskSettlement.semanticEventId,
      }),
      semanticEventId: taskSettlement.semanticEventId,
      graphRef: {
        kind: "hierarchical_worldmodel_graph",
        id: this.graph.graphId,
        digest: this.graph.digest,
      },
      managerProfileRef: {
        kind:
          taskSettlement.responsibleRole === "project_manager"
            ? "project_manager_profile"
            : "worldmodel_manager_profile",
        id:
          manager.managerProfile.projectManagerProfileId ||
          manager.managerProfile.managerProfileId,
        digest: manager.managerProfile.profileDigest,
      },
      projectionRef: {
        kind: "worldmodel_graph_projection",
        id: graphProjection.projectionId,
        digest: graphProjection.projectionDigest,
      },
      bootPacketRef: {
        kind: "manager_turn_boot_packet",
        id: bootPacket.bootPacketId,
        digest: bootPacket.digest,
      },
      selectedNodeCount: graphProjection.selectedNodeRefs.length,
      selectedEdgeCount: graphProjection.selectedEdgeRefs.length,
      omittedCounts: graphProjection.omittedCounts,
      contextAdmissionState: "deferred_to_k3",
      providerRoleTurnState: "not_started",
      historicalTranscriptIncluded: false,
      rawUnrelatedProjectStateIncluded: false,
      grantsAuthority: false,
    };
    result.digest = digestFor(
      WORLD_MANAGER_CONTEXT_BUNDLE_SCHEMA,
      result,
      ["digest"],
    );
    return {
      contextBundle: result,
      managerProfile: manager.managerProfile,
      policyArtifact: manager.policyArtifact,
      authoritySourceRef: manager.authoritySourceRef,
      graphProjection,
      bootPacket,
    };
  }
}

module.exports = {
  DirectWorldManagerWorldmodelBootstrap,
  TRUST_STORE_DIRECTORY,
  WORLD_MANAGER_CONTEXT_BUNDLE_SCHEMA,
  WORLD_MANAGER_GRAPH_BINDING_SCHEMA,
  buildBootstrapGraph,
};
