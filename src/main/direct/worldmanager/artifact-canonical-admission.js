"use strict";

const {
  appendWorldmodelGraphTransition,
  buildGraphWriteAuthorizationForTransition,
  buildScopedWorldmodelRevisionRef,
} = require("../worldmodel/hierarchical-graph");
const {
  buildProjectCustodyWriteMatrix,
  buildProjectCustodyWriteWitness,
  buildProjectManagerProfile,
} = require("../worldmodel/project-manager");
const {
  buildSemanticIngressBrokerPacket,
  buildSemanticTargetResolution,
  buildWorldmodelContextualAdmission,
  buildWorldmodelContextualAuthorityDecision,
  buildWorldmodelDeltaCandidate,
  buildWorldmodelIngressEnvelope,
} = require("../worldmodel/semantic-ingress");
const {
  buildGovernanceProvenanceRegistry,
  registryRef,
} = require("../worldmodel/governance-provenance-registry");
const {
  admitWorldmodelGovernanceRequest,
  installAuthoritativeWorldmodelGovernanceRegistry,
  readAuthoritativeWorldmodelGraphById,
  readWorldmodelStoreAdmission,
} = require("../worldmodel/governance-trust-store");
const {
  digestFor,
  stableId,
} = require("./control-plane");

const ARTIFACT_CANONICAL_ADMISSION_RESULT_SCHEMA =
  "direct_artifact_canonical_admission_result@1";

function fail(code, detail = "") {
  const error = new Error(detail ? `${code}:${detail}` : code);
  error.code = code;
  if (detail) error.detail = detail;
  throw error;
}

function text(value, fallback = "") {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : fallback;
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function exactRef(value = {}, label = "ref") {
  const result = {
    kind: text(value.kind, ""),
    id: text(value.id, ""),
    digest: text(value.digest, ""),
  };
  if (!result.kind || !result.id || !result.digest) {
    fail("direct_sc11_artifact_admission_exact_ref_required", label);
  }
  if (text(value.projectId, "")) result.projectId = value.projectId;
  return result;
}

function exactRefMatches(left, right) {
  try {
    const a = exactRef(left);
    const b = exactRef(right);
    return a.kind === b.kind && a.id === b.id && a.digest === b.digest;
  } catch {
    return false;
  }
}

function graphScopeFromArtifactScope(scope = {}, userProfileId = "") {
  const kind = text(scope.kind, "");
  const projectId = text(scope.projectId, "");
  const workThreadId = text(scope.workThreadId, "");
  if (!projectId) {
    fail("direct_sc11_artifact_admission_project_scope_required");
  }
  if (kind !== "project" && kind !== "workthread") {
    fail("direct_sc11_artifact_admission_scope_unsupported", kind);
  }
  if (kind === "workthread" && !workThreadId) {
    fail("direct_sc11_artifact_admission_workthread_required");
  }
  return {
    scopeKind: kind === "workthread" ? "work_thread" : "project",
    userProfileId,
    projectId,
    ...(workThreadId ? { workThreadId } : {}),
    semanticPath: workThreadId
      ? ["projects", projectId, "workthreads", workThreadId, "artifacts"]
      : ["projects", projectId, "architecture", "artifact_admissions"],
  };
}

function scopeKey(scope = {}) {
  return `${scope.scopeKind}:${scope.projectId || ""}:${scope.workThreadId || ""}`;
}

function currentScopeRevision(graph, scope) {
  const current = graph.scopedRevisionRefs.find((candidate) =>
    scopeKey(candidate) === scopeKey(scope));
  if (current) return current;
  if (scope.scopeKind !== "work_thread") {
    fail("direct_sc11_artifact_admission_canonical_scope_unknown");
  }
  return buildScopedWorldmodelRevisionRef({
    scopeKind: "work_thread",
    projectId: scope.projectId,
    workThreadId: scope.workThreadId,
    revision: 0,
  });
}

function canonicalRevisionRef(graph, scopeRevision) {
  const id = stableId("wm_canonical_scope_revision", {
    graphId: graph.graphId,
    scopeKind: scopeRevision.scopeKind,
    projectId: scopeRevision.projectId || "",
    workThreadId: scopeRevision.workThreadId || "",
  });
  return {
    kind: "worldmodel_scoped_revision",
    id,
    digest: scopeRevision.digest,
    ...(scopeRevision.projectId
      ? { projectId: scopeRevision.projectId }
      : {}),
  };
}

function projectManagerActorRef(userProfileId, projectId) {
  const id = stableId("project_manager_agent", {
    userWorldId: userProfileId,
    projectId,
  });
  return {
    kind: "manager_agent",
    id,
    digest: digestFor("direct-world-manager-agent-identity@1", {
      selectedManagerAgentId: id,
      responsibleRole: "project_manager",
    }),
    projectId,
  };
}

function sourceRefForExactRef(ref, sourceKind, observedAt) {
  const exact = exactRef(ref);
  return {
    sourceRefId: stableId("wm_artifact_admission_source", {
      kind: exact.kind,
      id: exact.id,
      digest: exact.digest,
    }),
    sourceKind,
    sourceId: exact.id,
    sourceConfidence: "exact",
    freshness: "fresh",
    observedAt,
    sourceDigest: {
      algorithm: "sha256",
      value: exact.digest,
      digestOf: "canonical_json",
    },
  };
}

function exactVectorMatches(left, right) {
  const a = Array.isArray(left) ? left : [];
  const b = Array.isArray(right) ? right : [];
  return a.length === b.length && a.every((candidate) =>
    b.some((entry) => exactRefMatches(candidate, entry)));
}

function transitionRef(transition, projectId) {
  return {
    kind: "worldmodel_graph_transition",
    id: transition.transitionId,
    digest: transition.digest,
    projectId,
  };
}

function artifactNodeMatches(graph, nodeId, input) {
  const node = graph.nodes.find((candidate) => candidate.nodeId === nodeId);
  return Boolean(
    node &&
    exactRefMatches(
      node.structuredValue?.artifactRevisionRef,
      input.artifactRevisionRef,
    ) &&
    exactRefMatches(
      node.structuredValue?.gateDecisionRef,
      input.gateDecisionRef,
    ) &&
    node.structuredValue?.targetAdmissionScope?.kind ===
      input.targetAdmissionScope.kind &&
    node.structuredValue?.targetAdmissionScope?.projectId ===
      input.targetAdmissionScope.projectId &&
    (node.structuredValue?.targetAdmissionScope?.workThreadId || "") ===
      (input.targetAdmissionScope.workThreadId || "")
  );
}

function canonicalRevisionRefsForArtifactScope(input = {}) {
  const state = readAuthoritativeWorldmodelGraphById(
    input.trustStore,
    input.graphId,
  );
  const scope = graphScopeFromArtifactScope(
    input.targetAdmissionScope,
    state.graph.userProfileId,
  );
  return [canonicalRevisionRef(
    state.graph,
    currentScopeRevision(state.graph, scope),
  )];
}

function admitArtifactRevisionToWorldmodel(input = {}) {
  const lifecycle = input.lifecycle;
  const artifactRevision = input.artifactRevision;
  const gateDecision = input.gateDecision;
  if (
    !isPlainObject(lifecycle) ||
    !isPlainObject(artifactRevision) ||
    !isPlainObject(gateDecision) ||
    lifecycle.state !== "admission_pending" ||
    gateDecision.decisionState !== "gate_ready"
  ) {
    fail("direct_sc11_artifact_admission_input_invalid");
  }
  const state = readAuthoritativeWorldmodelGraphById(
    input.trustStore,
    input.graphId,
  );
  const graph = state.graph;
  const targetAdmissionScope = gateDecision.targetAdmissionScope;
  const targetScope = graphScopeFromArtifactScope(
    targetAdmissionScope,
    graph.userProfileId,
  );
  const projectRoot = graph.nodes.find((node) =>
    node.nodeKind === "project_root" &&
    node.scope.projectId === targetScope.projectId);
  if (!projectRoot) {
    fail("direct_sc11_artifact_admission_project_root_unknown");
  }
  const expectedActorRef = projectManagerActorRef(
    graph.userProfileId,
    targetScope.projectId,
  );
  if (!exactRefMatches(input.actorRef, expectedActorRef)) {
    fail("direct_sc11_artifact_admission_actor_unauthorized");
  }
  const artifactRevisionRef = {
    kind: "artifact_revision",
    id: artifactRevision.artifactRevisionId,
    digest: artifactRevision.artifactDigest,
    projectId: targetScope.projectId,
  };
  const gateDecisionRef = {
    kind: "artifact_gate_decision",
    id: gateDecision.gateDecisionId,
    digest: gateDecision.digest,
    projectId: targetScope.projectId,
  };
  const transitionId = stableId("wm_artifact_admission_transition", {
    lifecycleId: lifecycle.lifecycleId,
    artifactRevisionRef,
    gateDecisionRef,
  });
  const artifactNodeId = stableId("wm_admitted_artifact", {
    lifecycleId: lifecycle.lifecycleId,
    artifactRevisionRef,
  });
  const priorTransition = graph.transitions.find((transition) =>
    transition.transitionId === transitionId);
  if (priorTransition) {
    if (
      priorTransition.actorAgentId !== expectedActorRef.id ||
      priorTransition.actorRole !== "project_manager" ||
      !artifactNodeMatches(graph, artifactNodeId, {
        artifactRevisionRef,
        gateDecisionRef,
        targetAdmissionScope,
      })
    ) {
      fail("direct_sc11_artifact_admission_transition_conflict");
    }
    return {
      schema: ARTIFACT_CANONICAL_ADMISSION_RESULT_SCHEMA,
      admitted: true,
      reused: true,
      targetAdmissionScope,
      trustStoreReceiptRef: transitionRef(
        priorTransition,
        targetScope.projectId,
      ),
      canonicalGraphRef: {
        kind: "hierarchical_worldmodel_graph",
        id: graph.graphId,
        digest: graph.digest,
      },
      canonicalEffect: true,
      downstreamEffectsExecuted: false,
    };
  }
  const scopeRevision = currentScopeRevision(graph, targetScope);
  const actualExpectedCanonicalRevisionRefs = [canonicalRevisionRef(
    graph,
    scopeRevision,
  )];
  if (!exactVectorMatches(
    input.expectedCanonicalRevisionRefs,
    actualExpectedCanonicalRevisionRefs,
  )) {
    fail("direct_sc11_artifact_admission_stale_cas");
  }
  const issuedAt = text(
    input.issuedAt || lifecycle.updatedAt || lifecycle.createdAt,
    new Date(Number(input.now())).toISOString(),
  );
  const sourceRefs = [
    sourceRefForExactRef(
      artifactRevisionRef,
      "family_specific",
      issuedAt,
    ),
    sourceRefForExactRef(
      gateDecisionRef,
      "promotion_decision",
      issuedAt,
    ),
  ];
  const managerProfile = buildProjectManagerProfile({
    projectManagerProfileId: stableId("project_manager_profile", {
      userProfileId: graph.userProfileId,
      projectId: targetScope.projectId,
    }),
    projectManagerAgentId: expectedActorRef.id,
    worldManagerAgentId: stableId("world_manager_agent", {
      userWorldId: graph.userProfileId,
    }),
    projectId: targetScope.projectId,
    projectRootNodeId: projectRoot.nodeId,
    authorityBoundaryRef: {
      kind: "authority_boundary",
      id: stableId("wm_artifact_admission_boundary", {
        projectId: targetScope.projectId,
      }),
      digest: digestFor("direct-wm-artifact-admission-boundary@1", {
        projectId: targetScope.projectId,
        scope: "canonical_artifact_admission",
      }),
    },
    graphProjectionPolicyRef: {
      kind: "graph_projection_policy",
      id: stableId("wm_artifact_admission_policy", {
        projectId: targetScope.projectId,
      }),
      digest: digestFor("direct-wm-artifact-admission-policy@1", {
        projectId: targetScope.projectId,
      }),
    },
    sourceRefs,
    createdAt: issuedAt,
    updatedAt: issuedAt,
  }, { now: () => Date.parse(issuedAt) });
  const ingress = buildWorldmodelIngressEnvelope({
    ingressId: stableId("wm_artifact_admission_ingress", { transitionId }),
    inputKind: "work_thread_closure",
    receivedByAgentId: expectedActorRef.id,
    receivedByRole: "project_manager",
    declaredScopeHints: [targetScope],
    sourceRefs,
    currentInstructionAuthority: false,
    createdAt: issuedAt,
  }, { now: () => Date.parse(issuedAt) });
  const proposedNodeMutations = [];
  if (targetScope.scopeKind === "work_thread") {
    const workThreadRootNodeId = stableId("wm_workthread_root", {
      graphId: graph.graphId,
      projectId: targetScope.projectId,
      workThreadId: targetScope.workThreadId,
    });
    if (!graph.nodes.some((node) => node.nodeId === workThreadRootNodeId)) {
      proposedNodeMutations.push({
        operation: "add",
        targetNodeId: workThreadRootNodeId,
        candidateNode: {
          nodeId: workThreadRootNodeId,
          graphId: graph.graphId,
          scope: targetScope,
          nodeKind: "work_thread_root",
          abstractionLevel: "execution",
          semanticSummary:
            `Canonical work-thread scope ${targetScope.workThreadId}.`,
          odeuImpact: {
            O: ["work_thread_scope"],
            E: ["exact_artifact_admission_lineage"],
            D: ["project_manager_custody"],
            U: ["governed_implementation"],
          },
          lifecycle: "active",
          integrationStatus: "integrated",
          epistemicStatus: "accepted",
          normativeForce: "informational",
          custodianRole: "project_manager",
          authorizedWriterRoles: ["project_manager"],
          projectionEligibility: "eligible",
          sourceRefs,
          structuredValue: {
            projectId: targetScope.projectId,
            workThreadId: targetScope.workThreadId,
          },
          createdAt: issuedAt,
          updatedAt: issuedAt,
        },
      });
    }
  }
  proposedNodeMutations.push({
    operation: "add",
    targetNodeId: artifactNodeId,
    candidateNode: {
      nodeId: artifactNodeId,
      graphId: graph.graphId,
      scope: targetScope,
      nodeKind: "decision",
      abstractionLevel: "execution",
      semanticSummary:
        `Admitted ${artifactRevision.artifactTypeId || "artifact"} revision ${artifactRevision.revision}.`,
      odeuImpact: {
        O: ["canonical_artifact_revision"],
        E: ["gate_and_assurance_receipts"],
        D: ["exact_scope_cas"],
        U: ["project_implementation_state"],
      },
      lifecycle: "active",
      integrationStatus: "realized",
      epistemicStatus: "accepted",
      normativeForce: "project_commitment",
      custodianRole: "project_manager",
      authorizedWriterRoles: ["project_manager"],
      projectionEligibility: "eligible",
      sourceRefs,
      structuredValue: {
        artifactLifecycleRef: {
          kind: "artifact_lifecycle_instance",
          id: lifecycle.lifecycleId,
          digest: lifecycle.digest,
          projectId: targetScope.projectId,
        },
        artifactRevisionRef,
        artifactContentRef: artifactRevision.artifactContentRef,
        gateDecisionRef,
        assuranceGraphRef: gateDecision.assuranceGraphRef,
        targetAdmissionScope,
        canonicalAdmission: true,
        downstreamEffectsExecuted: false,
      },
      createdAt: issuedAt,
      updatedAt: issuedAt,
    },
  });
  const resolution = buildSemanticTargetResolution({
    resolutionId: stableId("wm_artifact_admission_resolution", {
      transitionId,
    }),
    ingressId: ingress.ingressId,
    route: "commit_current_scope",
    candidateTargets: [{
      ...targetScope,
      candidateNodeIds: proposedNodeMutations.map((entry) =>
        entry.targetNodeId),
      confidence: "exact",
    }],
    sourceRefs,
  }, { now: () => Date.parse(issuedAt) });
  const brokerPacket = buildSemanticIngressBrokerPacket({
    ingressEnvelope: ingress,
    targetResolution: resolution,
  }, { now: () => Date.parse(issuedAt) });
  const candidate = buildWorldmodelDeltaCandidate({
    candidateId: stableId("wm_artifact_admission_candidate", {
      transitionId,
    }),
    ingressId: ingress.ingressId,
    targetResolutionId: resolution.resolutionId,
    receivedByRole: "project_manager",
    targetScope,
    abstractionLevel: "execution",
    proposedNodeMutations,
    proposedEdgeMutations: [],
    odeuImpact: {
      O: ["canonical_artifact_revision"],
      E: ["assurance_gate"],
      D: ["scope_relative_cas"],
      U: ["project_execution"],
    },
    candidateState: "accepted_for_commit",
    promotionOrigin: "artifact_evidence",
    expectedScopeRevisions: [scopeRevision],
    sourceRefs,
  }, { now: () => Date.parse(issuedAt) });
  const custodyMatrix = buildProjectCustodyWriteMatrix({
    matrixId: stableId("wm_artifact_admission_custody", {
      projectId: targetScope.projectId,
    }),
    projectId: targetScope.projectId,
  });
  const custodyWriteWitness = buildProjectCustodyWriteWitness({
    matrix: custodyMatrix,
    actorRole: "project_manager",
    path: "project.architecture.artifact_admissions",
    action: "admit_artifact_revision",
  });
  const authorityDecision = buildWorldmodelContextualAuthorityDecision({
    authorityDecisionId: stableId("wm_artifact_admission_authority", {
      transitionId,
    }),
    graph,
    managerProfile,
    actorAgentId: expectedActorRef.id,
    actorRole: "project_manager",
    targetScope,
    issuedAt,
    expiresAt: "2099-01-01T00:00:00.000Z",
  }, { now: () => Date.parse(issuedAt) });
  const binding = {
    graphId: graph.graphId,
    graphDigest: graph.digest,
    userProfileId: graph.userProfileId,
    scopeKind: targetScope.scopeKind,
    projectId: targetScope.projectId,
    ...(targetScope.workThreadId
      ? { workThreadId: targetScope.workThreadId }
      : {}),
    projectRootNodeId: projectRoot.nodeId,
    role: "project_manager",
    agentId: expectedActorRef.id,
    purpose: "graph_append",
    expectedScopeRevisionDigest: scopeRevision.digest,
  };
  const governanceRegistry = buildGovernanceProvenanceRegistry({
    registryId: stableId("wm_artifact_admission_registry", {
      transitionId,
      graphDigest: graph.digest,
    }),
    userProfileId: graph.userProfileId,
    records: [
      { kind: "project_manager_profile", body: managerProfile, binding },
      { kind: "project_root", body: projectRoot, binding },
      { kind: "custody_matrix", body: custodyMatrix, binding },
      { kind: "custody_witness", body: custodyWriteWitness, binding },
      {
        kind: "authority_decision",
        body: authorityDecision,
        binding,
        oneShot: true,
      },
    ],
    createdAt: issuedAt,
  }, { now: () => Date.parse(issuedAt) });
  const contextualAdmission = buildWorldmodelContextualAdmission({
    admissionId: stableId("wm_artifact_contextual_admission", {
      transitionId,
    }),
    graph,
    ingressEnvelope: ingress,
    brokerPacket,
    targetResolution: resolution,
    candidate,
    managerProfile,
    custodyMatrix,
    custodyWriteWitness,
    authorityDecision,
    governanceRegistry,
    registryRef: registryRef(governanceRegistry),
    expectedRegistryRevision: governanceRegistry.revision,
    decidedByAgentId: expectedActorRef.id,
    decidedByRole: "project_manager",
    idempotencyKey: transitionId,
  }, { now: () => Date.parse(issuedAt) });
  const writeAuthorization = buildGraphWriteAuthorizationForTransition(graph, {
    authorizationId: stableId("wm_artifact_admission_write", {
      transitionId,
    }),
    actorAgentId: expectedActorRef.id,
    actorRole: "project_manager",
    mutations: contextualAdmission.mutations,
    expectedScopeRevisions: contextualAdmission.expectedScopeRevisions,
    authorityTraceRef: sourceRefs[1],
    createdAt: issuedAt,
    authorizationExpiresAt: contextualAdmission.expiresAt,
    idempotencyKey: transitionId,
  }, { now: () => Date.parse(issuedAt) });
  const installedRegistryRef = state.registryRef;
  if (
    installedRegistryRef.id !== governanceRegistry.registryId ||
    installedRegistryRef.digest !== governanceRegistry.registryDigest
  ) {
    installAuthoritativeWorldmodelGovernanceRegistry(
      input.trustStore,
      graph,
      governanceRegistry,
    );
  }
  const storeAdmissionId = stableId("wm_artifact_store_admission", {
    transitionId,
  });
  const storeAdmissionContext = {
    graphId: graph.graphId,
    graphDigest: graph.digest,
    userProfileId: graph.userProfileId,
    scopeKind: targetScope.scopeKind,
    projectId: targetScope.projectId,
    ...(targetScope.workThreadId
      ? { workThreadId: targetScope.workThreadId }
      : {}),
    projectRootNodeId: projectRoot.nodeId,
    role: "project_manager",
    agentId: expectedActorRef.id,
    purpose: "graph_append",
    expectedScopeRevisionDigest: scopeRevision.digest,
    requiredArtifacts: contextualAdmission.registryRequiredArtifacts,
  };
  const existingStoreAdmission = readWorldmodelStoreAdmission(
    input.trustStore,
    graph,
    storeAdmissionId,
  );
  const storeAdmission = existingStoreAdmission ||
    admitWorldmodelGovernanceRequest(input.trustStore, {
      admissionId: storeAdmissionId,
      graph,
      context: storeAdmissionContext,
      issuedAt,
    });
  const committed = appendWorldmodelGraphTransition(graph, {
    transitionId,
    deltaCandidateId: candidate.candidateId,
    actorAgentId: expectedActorRef.id,
    actorRole: "project_manager",
    mutations: contextualAdmission.mutations,
    expectedScopeRevisions: contextualAdmission.expectedScopeRevisions,
    contextualAdmission,
    writeAuthorization,
    storeAdmission,
    sourceRefs,
    idempotencyKey: transitionId,
    createdAt: issuedAt,
  }, { now: () => Date.parse(issuedAt) });
  if (!committed.committed || !committed.transition) {
    const code = text(
      committed.remand?.code,
      "direct_sc11_artifact_admission_graph_commit_failed",
    );
    if (/stale|revision/i.test(code)) {
      fail("direct_sc11_artifact_admission_stale_cas", code);
    }
    fail("direct_sc11_artifact_admission_graph_commit_failed", code);
  }
  return {
    schema: ARTIFACT_CANONICAL_ADMISSION_RESULT_SCHEMA,
    admitted: true,
    reused: false,
    targetAdmissionScope,
    trustStoreReceiptRef: transitionRef(
      committed.transition,
      targetScope.projectId,
    ),
    canonicalGraphRef: {
      kind: "hierarchical_worldmodel_graph",
      id: committed.graph.graphId,
      digest: committed.graph.digest,
    },
    canonicalEffect: true,
    downstreamEffectsExecuted: false,
  };
}

module.exports = {
  ARTIFACT_CANONICAL_ADMISSION_RESULT_SCHEMA,
  admitArtifactRevisionToWorldmodel,
  canonicalRevisionRefsForArtifactScope,
  projectManagerActorRef,
};
