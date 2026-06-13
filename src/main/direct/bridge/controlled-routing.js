"use strict";

const crypto = require("node:crypto");
const {
  buildAgentClassRegistry,
} = require("./agent-class-spec");
const {
  buildWorkThreadContextBinding,
  normalizeBridgeInformationRef,
} = require("./work-thread-alignment");
const {
  buildSemanticBrokerInputSnapshot,
  buildSemanticBrokerPacket,
  buildSemanticBrokerPreflight,
  buildSemanticBrokerRegistrySnapshot,
  candidateFromRoute,
  normalizeSourceRef,
  stableStringify,
  validateSemanticBrokerPreflight,
} = require("../governance/broker");
const {
  assertWorkTargetResolutionReportSafe,
  buildWorkTargetResolution,
  buildWorkTargetResolutionReport,
  buildWorkThread,
} = require("./work-thread-registry");

const DIRECT_CONTROLLED_ROUTING_SLICE_SCHEMA = "direct_controlled_routing_slice@1";
const DIRECT_CONTROLLED_ROUTING_SLICE_VERSION = "direct-controlled-routing-slice@1";

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function arrayOrEmpty(value) {
  return Array.isArray(value) ? value : [];
}

function nowIso(nowMs = Date.now()) {
  return new Date(Number(nowMs) || Date.now()).toISOString();
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function digestFor(prefix, value) {
  return `sha256:${sha256(`${prefix}\0${stableStringify(value)}`)}`;
}

function textOnlyRouteCandidate(registrySnapshot, refs = {}) {
  const route = (Array.isArray(registrySnapshot?.routes) ? registrySnapshot.routes : [])
    .find((entry) => entry.routeKind === "text_only") || {
      routeKind: "text_only",
      toolSurface: "none",
      contextPolicyKinds: ["direct_text"],
      runtimeTierKinds: ["direct_text"],
    };
  return candidateFromRoute(route, {
    candidateId: "controlled_text_only_direct_turn",
    requiredEvidenceRefs: [
      refs.runtimeTierRef,
      refs.currentUserIntentRef,
      refs.workThreadBindingRef,
    ].filter(Boolean),
    confidence: "high",
    reasonCodes: ["selected_work_thread", "primary_agent_text_turn"],
    rendererSafeSummary: "Controlled route to existing direct text turn.",
  });
}

function agentSpecByKind(registry = {}, kind = "primary_agent") {
  return (Array.isArray(registry.specs) ? registry.specs : []).find((spec) => spec.agentClassKind === kind) || null;
}

function sourceRefForArtifact(kind, artifactId, artifactDigest, label, sourceConfidence = "accepted") {
  return normalizeSourceRef({
    kind,
    artifactId,
    artifactDigest,
    sourceConfidence,
    rendererSafeLabel: label,
  });
}

function buildControlledRoutingSlice(input = {}, options = {}) {
  const source = isPlainObject(input) ? input : {};
  const projectId = normalizeString(source.projectId, source.session?.projectId || "");
  const threadId = normalizeString(source.threadId, source.session?.sessionId || "");
  const turnId = normalizeString(source.turnId, "");
  const requestPreview = normalizeString(source.requestPreview, "");
  const nowMs = options.nowMs ?? source.nowMs;
  const createdAt = normalizeString(source.createdAt, nowIso(nowMs));
  const workThread = isPlainObject(source.workThread)
    ? buildWorkThread({ ...source.workThread, projectId: source.workThread.projectId || projectId }, { nowMs })
    : null;
  const workThreads = Array.isArray(source.workThreads) && source.workThreads.length
    ? source.workThreads
    : workThread ? [workThread] : [];
  const workTargetResolution = isPlainObject(source.workTargetResolution)
    ? source.workTargetResolution
    : buildWorkTargetResolution({
        projectId,
        userRequest: requestPreview,
        codexThreadId: threadId,
        activeRuntimePath: "direct-implementation",
      }, workThreads, { nowMs });
  const workTargetResolutionReport = isPlainObject(source.workTargetResolutionReport)
    ? source.workTargetResolutionReport
    : buildWorkTargetResolutionReport({
        projectId,
        resolution: workTargetResolution,
      }, { nowMs });
  assertWorkTargetResolutionReportSafe(workTargetResolutionReport);
  const operatorBrokerResolution = isPlainObject(source.operatorBrokerResolution)
    ? source.operatorBrokerResolution
    : isPlainObject(source.operatorBroker?.resolution)
      ? source.operatorBroker.resolution
      : null;
  const operatorBrokerConstraints = arrayOrEmpty(
    operatorBrokerResolution?.downstreamRoutePacketConstraints?.constraintCodes ||
    operatorBrokerResolution?.nonTargetPreservationConstraints,
  ).map((item) => normalizeString(item, "")).filter(Boolean);

  const selectedWorkThread = workThreads.find((thread) => thread.workThreadId === workTargetResolutionReport.selectedWorkThreadId) || workThread || null;
  const workThreadBinding = buildWorkThreadContextBinding(source.workThreadBinding || {
    workThread: selectedWorkThread,
    workThreadId: workTargetResolutionReport.selectedWorkThreadId,
    projectId,
    authorityBoundary: selectedWorkThread?.authorityBoundary || source.authorityBoundary,
    openObligations: selectedWorkThread?.openObligations || source.openObligations,
    bridgeInformationRefs: [
      ...(Array.isArray(source.bridgeInformationRefs) ? source.bridgeInformationRefs : []),
      {
        classId: "ic12.work-thread-registry",
        role: "governance_routing",
        artifactKind: "work_target_resolution_report",
        artifactId: workTargetResolutionReport.reportId,
        artifactDigest: workTargetResolutionReport.reportDigest,
      },
    ],
  });
  const currentUserIntentRef = sourceRefForArtifact(
    "current_user_intent",
    `current_user_intent_${sha256(`${projectId}:${threadId}:${turnId}:${requestPreview}`).slice(0, 16)}`,
    digestFor("direct-controlled-routing-current-user-intent@1", { projectId, threadId, turnId, requestPreview }),
    "Current user intent",
    "exact",
  );
  const runtimeTierRef = sourceRefForArtifact(
    "runtime_tier",
    "direct_live_text_runtime",
    digestFor("direct-controlled-routing-runtime-tier@1", { runtimeMode: "direct-experimental", transport: "live-text" }),
    "Direct live text runtime",
    "accepted",
  );
  const workThreadBindingRef = sourceRefForArtifact(
    "work_thread_binding",
    workThreadBinding.workThreadId,
    workThreadBinding.bindingDigest,
    "WorkThread binding",
    "exact",
  );
  const registrySnapshot = isPlainObject(source.semanticBrokerRegistrySnapshot)
    ? source.semanticBrokerRegistrySnapshot
    : buildSemanticBrokerRegistrySnapshot({
        projectId,
        routes: [{
          routeKind: "text_only",
          toolSurface: "none",
          requiredEvidenceKinds: ["runtime_tier", "current_user_intent", "work_thread_binding"],
          contextPolicyKinds: ["direct_text"],
          runtimeTierKinds: ["direct_text"],
        }],
      });
  const brokerInputSnapshot = isPlainObject(source.semanticBrokerInputSnapshot)
    ? source.semanticBrokerInputSnapshot
    : buildSemanticBrokerInputSnapshot({
        projectId,
        threadId,
        turnId,
        currentUserIntentRef,
        runtimeTierRef,
        workThreadBindingRef,
      });
  const semanticBrokerPacket = isPlainObject(source.semanticBrokerPacket)
    ? source.semanticBrokerPacket
    : buildSemanticBrokerPacket({
        projectId,
        threadId,
        turnId,
        registrySnapshot,
        inputSnapshot: brokerInputSnapshot,
        candidates: [textOnlyRouteCandidate(registrySnapshot, { runtimeTierRef, currentUserIntentRef, workThreadBindingRef })],
      });
  const agentClassRegistry = isPlainObject(source.agentClassRegistry)
    ? source.agentClassRegistry
    : buildAgentClassRegistry({
        projectId,
        workThreadId: workThreadBinding.workThreadId,
        nowMs,
      });
  const primaryAgentSpec = source.agentClassSpec || agentSpecByKind(agentClassRegistry, "primary_agent");
  const semanticBrokerPreflight = isPlainObject(source.semanticBrokerPreflight)
    ? source.semanticBrokerPreflight
    : buildSemanticBrokerPreflight({
        projectId,
        threadId,
        turnId,
        semanticBrokerPacket,
        workTargetResolutionReport,
        agentClassSpec: primaryAgentSpec,
      });
  validateSemanticBrokerPreflight(semanticBrokerPreflight);
  const blockerCodes = [];
  if (!primaryAgentSpec) {
    blockerCodes.push("missing_primary_agent_spec");
  }
  if (workTargetResolutionReport.routingGateState !== "selected_ready") {
    blockerCodes.push(`work_target_${workTargetResolutionReport.routingGateState || "unknown"}`);
  }
  if (operatorBrokerResolution?.clarificationRequired === true) {
    blockerCodes.push("operator_broker_clarification_required");
  }
  if (operatorBrokerResolution?.routingGateState && operatorBrokerResolution.routingGateState !== "selected_ready") {
    blockerCodes.push(`operator_broker_${operatorBrokerResolution.routingGateState}`);
  }
  if (operatorBrokerResolution?.routingGateState === "selected_ready") {
    const brokerProjectId = normalizeString(operatorBrokerResolution.projectId, "");
    const brokerWorkThreadId = normalizeString(operatorBrokerResolution.selectedWorkThreadId, "");
    if (brokerProjectId && brokerProjectId !== projectId) {
      blockerCodes.push("operator_broker_project_mismatch");
    }
    if (brokerWorkThreadId && brokerWorkThreadId !== workTargetResolutionReport.selectedWorkThreadId) {
      blockerCodes.push("operator_broker_work_thread_mismatch");
    }
    if (!brokerWorkThreadId) {
      blockerCodes.push("operator_broker_missing_selected_work_thread");
    }
  }
  if (semanticBrokerPreflight.recommendationClass !== "allow") {
    blockerCodes.push(`preflight_${semanticBrokerPreflight.recommendationClass || "unknown"}`);
  }
  if (semanticBrokerPreflight.recommendedAgentClass?.agentClassKind !== "primary_agent") {
    blockerCodes.push("non_primary_agent_route_not_enabled");
  }
  if (semanticBrokerPreflight.selectedRouteKind !== "text_only") {
    blockerCodes.push("route_kind_not_text_only");
  }
  if (semanticBrokerPreflight.selectedToolSurface && semanticBrokerPreflight.selectedToolSurface !== "none") {
    blockerCodes.push("tool_surface_not_enabled");
  }
  const gateState = blockerCodes.length ? "blocked" : "ready_for_direct_text_turn";
  const sourceDigest = digestFor("direct-controlled-routing-slice-source@1", {
    projectId,
    threadId,
    turnId,
    workTargetReportDigest: workTargetResolutionReport.reportDigest,
    operatorBrokerResolutionDigest: operatorBrokerResolution?.brokerResolutionDigest,
    preflightDigest: semanticBrokerPreflight.integrity?.artifactDigest,
    agentClassDigest: primaryAgentSpec?.specDigest,
    routeKind: semanticBrokerPreflight.selectedRouteKind,
    gateState,
    blockerCodes,
  });
  const routeId = normalizeString(source.routeId, `controlled_route_${sourceDigest.slice(7, 31)}`);
  const route = {
    schema: DIRECT_CONTROLLED_ROUTING_SLICE_SCHEMA,
    routeId,
    version: DIRECT_CONTROLLED_ROUTING_SLICE_VERSION,
    projectId,
    threadId,
    turnId,
    createdAt,
    selectedWorkThreadId: gateState === "ready_for_direct_text_turn" ? workTargetResolutionReport.selectedWorkThreadId : "",
    selectedRouteKind: normalizeString(semanticBrokerPreflight.selectedRouteKind, ""),
    selectedToolSurface: normalizeString(semanticBrokerPreflight.selectedToolSurface, "none"),
    selectedAgentClass: {
      agentClassId: normalizeString(primaryAgentSpec?.agentClassId, ""),
      agentClassKind: normalizeString(primaryAgentSpec?.agentClassKind, ""),
      specDigest: normalizeString(primaryAgentSpec?.specDigest, ""),
      rawTextIncluded: false,
      rawSecretIncluded: false,
    },
    workTargetResolutionReport: {
      reportId: normalizeString(workTargetResolutionReport.reportId, ""),
      reportDigest: normalizeString(workTargetResolutionReport.reportDigest, ""),
      routingGateState: normalizeString(workTargetResolutionReport.routingGateState, ""),
      selectedWorkThreadId: normalizeString(workTargetResolutionReport.selectedWorkThreadId, ""),
    },
    operatorBrokerResolution: operatorBrokerResolution ? {
      brokerResolutionId: normalizeString(operatorBrokerResolution.brokerResolutionId, ""),
      brokerResolutionDigest: normalizeString(operatorBrokerResolution.brokerResolutionDigest, ""),
      routingGateState: normalizeString(operatorBrokerResolution.routingGateState, ""),
      selectedWorkThreadId: normalizeString(operatorBrokerResolution.selectedWorkThreadId, ""),
      clarificationRequired: operatorBrokerResolution.clarificationRequired === true,
      nonTargetPreservationRequired: operatorBrokerResolution.nonTargetPreservationRequired !== false,
    } : null,
    nonTargetPreservationConstraints: operatorBrokerConstraints,
    semanticBrokerPreflight: {
      preflightId: normalizeString(semanticBrokerPreflight.preflightId, ""),
      preflightDigest: normalizeString(semanticBrokerPreflight.integrity?.artifactDigest, ""),
      recommendationClass: normalizeString(semanticBrokerPreflight.recommendationClass, ""),
      selectedCandidateId: normalizeString(semanticBrokerPreflight.selectedCandidateId, ""),
    },
    workThreadBinding,
    gateState,
    blockerCodes,
    controlledProviderCallAllowed: gateState === "ready_for_direct_text_turn",
    providerCallScope: gateState === "ready_for_direct_text_turn" ? "existing_direct_text_turn_start_only" : "none",
    workspaceMutationAllowed: false,
    toolExecutionAllowed: false,
    autonomousRoutingAllowed: false,
    multiAgentOrchestrationAllowed: false,
    appServerPathReplaced: false,
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
    evidenceRefs: [
      sourceRefForArtifact("work_thread_binding", workTargetResolutionReport.reportId, workTargetResolutionReport.reportDigest, "Work-target resolution report", "accepted"),
      operatorBrokerResolution ? sourceRefForArtifact("operator_broker_resolution", operatorBrokerResolution.brokerResolutionId, operatorBrokerResolution.brokerResolutionDigest, "Operator broker resolution", "accepted") : null,
      sourceRefForArtifact("semantic_registry", semanticBrokerPreflight.preflightId, semanticBrokerPreflight.integrity?.artifactDigest, "Semantic broker preflight", "accepted"),
      primaryAgentSpec ? sourceRefForArtifact("semantic_registry", primaryAgentSpec.agentClassId, primaryAgentSpec.specDigest, "Agent class spec", "accepted") : null,
      workThreadBindingRef,
    ].filter(Boolean),
    bridgeInformationRef: normalizeBridgeInformationRef({
      classId: "ic6.semantic-governance-broker",
      role: "governance_routing",
      artifactKind: "controlled_routing_slice",
      artifactId: routeId,
      artifactDigest: sourceDigest,
      confidence: gateState === "ready_for_direct_text_turn" ? "accepted" : "diagnostic",
    }),
    rendererSafeSummary: gateState === "ready_for_direct_text_turn"
      ? "Controlled routing selected the primary agent direct text path."
      : "Controlled routing blocked the direct text path.",
    sourceDigest,
  };
  route.routeDigest = digestFor("direct-controlled-routing-slice@1", route);
  return {
    route,
    workTargetResolution,
    workTargetResolutionReport,
    semanticBrokerPacket,
    semanticBrokerPreflight,
    agentClassRegistry,
    workThreadBinding,
    governanceRefs: {
      schema: "direct_governance_request_refs@1",
      semanticBrokerPacketId: semanticBrokerPacket.semanticBrokerPacketId,
      semanticBrokerPacketDigest: semanticBrokerPacket.integrity?.artifactDigest || "",
      controlledRoutingSliceId: route.routeId,
      controlledRoutingSliceDigest: route.routeDigest,
      citationPolicyDigest: digestFor("direct-controlled-routing-citation-policy@1", {
        schema: DIRECT_CONTROLLED_ROUTING_SLICE_SCHEMA,
      }),
      refsDigest: digestFor("direct-controlled-routing-governance-refs@1", {
        semanticBrokerPacketId: semanticBrokerPacket.semanticBrokerPacketId,
        semanticBrokerPacketDigest: semanticBrokerPacket.integrity?.artifactDigest || "",
        controlledRoutingSliceId: route.routeId,
        controlledRoutingSliceDigest: route.routeDigest,
        operatorBrokerResolutionId: operatorBrokerResolution?.brokerResolutionId || "",
        operatorBrokerResolutionDigest: operatorBrokerResolution?.brokerResolutionDigest || "",
      }),
    },
  };
}

function validateControlledRoutingSlice(route = {}) {
  if (!isPlainObject(route) || route.schema !== DIRECT_CONTROLLED_ROUTING_SLICE_SCHEMA) {
    throw new Error("direct_controlled_routing_slice_schema_mismatch");
  }
  if (route.rawTextIncluded !== false || route.rawPathIncluded !== false || route.rawSecretIncluded !== false) {
    throw new Error("direct_controlled_routing_slice_raw_exposure");
  }
  if (route.workspaceMutationAllowed !== false || route.toolExecutionAllowed !== false || route.autonomousRoutingAllowed !== false || route.multiAgentOrchestrationAllowed !== false) {
    throw new Error("direct_controlled_routing_slice_authority_leak");
  }
  if (route.controlledProviderCallAllowed === true && route.providerCallScope !== "existing_direct_text_turn_start_only") {
    throw new Error("direct_controlled_routing_slice_provider_scope_invalid");
  }
  if (route.gateState === "ready_for_direct_text_turn" && !normalizeString(route.selectedWorkThreadId, "")) {
    throw new Error("direct_controlled_routing_slice_missing_work_thread");
  }
  if (route.gateState !== "ready_for_direct_text_turn" && route.controlledProviderCallAllowed === true) {
    throw new Error("direct_controlled_routing_slice_blocked_provider_allowed");
  }
  return true;
}

module.exports = {
  DIRECT_CONTROLLED_ROUTING_SLICE_SCHEMA,
  DIRECT_CONTROLLED_ROUTING_SLICE_VERSION,
  buildControlledRoutingSlice,
  validateControlledRoutingSlice,
};
