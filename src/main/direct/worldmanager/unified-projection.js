"use strict";

const crypto = require("node:crypto");

const UNIFIED_WORLD_MANAGER_PROJECTION_SCHEMA =
  "direct_unified_worldmanager_projection@1";
const SEMANTIC_ANATOMY_PROJECTION_SCHEMA =
  "direct_semantic_anatomy_projection@1";
const SEMANTIC_ANATOMY_EVENT_SCHEMA =
  "direct_semantic_anatomy_event_projection@1";
const SEMANTIC_ANATOMY_DEPTH_SCHEMA =
  "direct_semantic_anatomy_depth_projection@1";
const OPERATIONAL_RIBBON_SCHEMA =
  "direct_operational_meta_context_ribbon@1";
const TYPED_INTERACTION_PARITY_SCHEMA =
  "direct_typed_interaction_parity_projection@1";

const SEMANTIC_ANATOMY_DEPTHS = Object.freeze([
  Object.freeze({
    depth: "unified_outcome",
    label: "Outcome",
    question: "What happened, and what needs me?",
  }),
  Object.freeze({
    depth: "provenance",
    label: "Provenance",
    question: "Which role formulated, routed, or performed this?",
  }),
  Object.freeze({
    depth: "governance",
    label: "Governance",
    question: "Why was it routed, permitted, blocked, or admitted?",
  }),
  Object.freeze({
    depth: "compiled_agent",
    label: "Compiled agent",
    question: "In what bounded agent-world did it occur?",
  }),
  Object.freeze({
    depth: "execution",
    label: "Execution",
    question: "What delegated work and evidence produced it?",
  }),
  Object.freeze({
    depth: "substrate",
    label: "Substrate",
    question: "Which exact records, calls, and measurements witness it?",
  }),
]);

const TYPED_INTERACTION_TOOLS = Object.freeze([
  Object.freeze({
    tool: "submit_message",
    label: "Send to WorldManager",
    requestSchema: "direct_world_manager_submit_request@1",
    effectPosture: "semantic_ingress_only",
  }),
  Object.freeze({
    tool: "inspect_semantic_anatomy",
    label: "Inspect semantic anatomy",
    requestSchema: "direct_semantic_anatomy_focus_request@1",
    effectPosture: "read_only_projection",
  }),
  Object.freeze({
    tool: "transition_open_decision",
    label: "Act on an open decision",
    requestSchema: "direct_decision_transition_request@1",
    effectPosture: "governed_transition_request",
  }),
  Object.freeze({
    tool: "apply_thought_brush",
    label: "Apply a thought brush",
    requestSchema: "direct_thought_brush_request@1",
    effectPosture: "temporary_canvas_only",
  }),
  Object.freeze({
    tool: "extract_canvas_insight",
    label: "Extract an ARO candidate",
    requestSchema: "direct_context_canvas_insight_extraction_request@1",
    effectPosture: "candidate_registration_only",
  }),
]);

function fail(code, detail = "") {
  const error = new Error(
    detail ? `${code}:${detail}` : code,
  );
  error.code = code;
  if (detail) error.detail = detail;
  throw error;
}

function isPlainObject(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value),
  );
}

function text(value, fallback = "") {
  return typeof value === "string" &&
    value.trim()
    ? value.trim()
    : fallback;
}

function bounded(
  value,
  fallback = "",
  max = 1_200,
) {
  const result = text(value, fallback);
  return result.length > max
    ? `${result
        .slice(0, Math.max(0, max - 1))
        .trimEnd()}…`
    : result;
}

function stableValue(
  value,
  omittedFields = new Set(),
) {
  if (Array.isArray(value)) {
    return value.map((entry) =>
      stableValue(entry, omittedFields));
  }
  if (!isPlainObject(value)) return value;
  return Object.keys(value)
    .sort()
    .reduce((output, key) => {
      if (
        omittedFields.has(key) ||
        typeof value[key] === "undefined"
      ) {
        return output;
      }
      output[key] = stableValue(
        value[key],
        omittedFields,
      );
      return output;
    }, {});
}

function digestFor(
  domain,
  value,
  omittedFields = [],
) {
  return `sha256:${crypto
    .createHash("sha256")
    .update(
      `${domain}\0${JSON.stringify(
        stableValue(
          value,
          new Set(omittedFields),
        ),
      )}`,
    )
    .digest("hex")}`;
}

function stableId(prefix, value) {
  return `${prefix}_${digestFor(
    `${prefix}@1`,
    value,
  ).slice(7, 31)}`;
}

function exactRef(
  kind,
  id,
  digest,
  label = "",
  extra = {},
) {
  const normalizedKind = text(kind, "");
  const normalizedId = text(id, "");
  const normalizedDigest = text(digest, "");
  if (
    !normalizedKind ||
    !normalizedId ||
    !normalizedDigest
  ) {
    return null;
  }
  return {
    kind: normalizedKind,
    id: normalizedId,
    digest: normalizedDigest,
    ...(text(label, "")
      ? { label: bounded(label, "", 180) }
      : {}),
    ...(text(extra.projectId, "")
      ? { projectId: text(extra.projectId, "") }
      : {}),
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
}

function normalizedRef(value) {
  if (!isPlainObject(value)) return null;
  return exactRef(
    value.kind,
    value.id,
    value.digest,
    value.label,
    value,
  );
}

function uniqueRefs(values = []) {
  const seen = new Set();
  return (Array.isArray(values) ? values : [])
    .map((value) =>
      value && value.kind
        ? normalizedRef(value)
        : null)
    .filter(Boolean)
    .filter((value) => {
      const key =
        `${value.kind}:${value.id}:${value.digest}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function fact(label, value, posture = "observed") {
  return {
    label: bounded(label, "", 120),
    value: bounded(
      Array.isArray(value)
        ? value.join(", ")
        : String(value ?? ""),
      "—",
      1_600,
    ),
    posture,
  };
}

function depthProjection({
  definition,
  eventRef,
  summary,
  facts = [],
  artifactRefs = [],
  availability,
}) {
  const refs = uniqueRefs(artifactRefs);
  const projection = {
    schema: SEMANTIC_ANATOMY_DEPTH_SCHEMA,
    depth: definition.depth,
    label: definition.label,
    question: definition.question,
    eventRef,
    availability:
      availability ||
      (refs.length
        ? "available"
        : "not_reached"),
    summary: bounded(
      summary,
      refs.length
        ? "Typed evidence is available."
        : "This lineage has not reached this depth.",
      1_600,
    ),
    facts: facts.map((entry) => ({
      label: bounded(entry.label, "", 120),
      value: bounded(entry.value, "—", 1_600),
      posture: text(
        entry.posture,
        "observed",
      ),
    })),
    artifactRefs: refs,
    privateReasoningIncluded: false,
    canonicalWorldstateMutation: false,
    grantsAuthority: false,
  };
  projection.digest = digestFor(
    SEMANTIC_ANATOMY_DEPTH_SCHEMA,
    projection,
    ["digest"],
  );
  return projection;
}

function refsForProjectSemanticObjects(
  projection,
  projectId,
) {
  const surfaces =
    projection.semanticSurface
      ?.objectSurfaces || [];
  return uniqueRefs(
    surfaces
      .filter((surface) =>
        !projectId ||
        surface.projectId === projectId ||
        surface.subjectRef?.projectId ===
          projectId)
      .map((surface) =>
        normalizedRef(
          surface.subjectRef,
        )),
  ).slice(0, 48);
}

function refsForProjectShelves(
  projection,
  projectId,
) {
  return uniqueRefs(
    (
      projection.semanticHistory
        ?.shelves || []
    )
      .filter((shelf) =>
        !projectId ||
        shelf.anchorRefs?.some((ref) =>
          ref.kind === "project" &&
          ref.id === projectId))
      .map((shelf) =>
        exactRef(
          "semantic_shelf",
          shelf.shelfId,
          shelf.digest,
          shelf.shelfKind,
          { projectId },
        )),
  ).slice(0, 24);
}

function refsForProjectAroExecution(
  projection,
  projectId,
) {
  const registry =
    projection.aroRegistry || {};
  const values = [
    ...(registry
      .mutationContracts || []),
    ...(registry
      .realizationContextImports || []),
    ...(registry
      .realizationMappingWitnesses || []),
    ...(registry
      .workerConstitutions || []),
    ...(registry
      .workerHandoffRuns || []),
    ...(registry
      .executionEvidenceBundles || []),
    ...(registry
      .semanticVerificationAssessments || []),
    ...(registry
      .closureCandidates || []),
  ];
  return uniqueRefs(
    values
      .filter((entry) =>
        !projectId ||
        !entry.projectId ||
        entry.projectId === projectId)
      .flatMap((entry) => [
        normalizedRef(
          entry.contractRef ||
            entry.contextImportRef ||
            entry.mappingWitnessRef ||
            entry.workerConstitutionRef ||
            entry.handoffRunRef ||
            entry.evidenceBundleRef ||
            entry.assessmentRef ||
            entry.closureCandidateRef,
        ),
      ]),
  ).slice(0, 48);
}

function buildEventAnatomy(
  projection,
  lineage,
) {
  const eventRef = exactRef(
    "world_manager_semantic_event",
    lineage.semanticEventId,
    lineage.eventDigest,
    "Unified semantic event",
    { projectId: lineage.projectId },
  );
  if (!eventRef) {
    fail(
      "unified_projection_event_ref_missing",
      lineage.semanticEventId,
    );
  }
  const messages = (
    projection.messages || []
  ).filter((message) =>
    message.semanticEventId ===
      lineage.semanticEventId ||
    message.sourceSemanticEventId ===
      lineage.semanticEventId);
  const userMessage =
    messages.find((message) =>
      message.authorKind === "user") ||
    null;
  const visibleResponse =
    [...messages]
      .reverse()
      .find((message) =>
        message.authorKind !== "user") ||
    null;
  const messageRefs = uniqueRefs(
    messages.map((message) =>
      exactRef(
        "world_manager_message",
        message.messageId,
        message.messageDigest,
        message.provenanceLabel,
        { projectId: message.projectId },
      )),
  );
  const lineageEvents = (
    projection.semanticLineage || []
  ).filter((event) =>
    event.lineageRootId ===
      lineage.lineageRootId);
  const lineageArtifactRefs = uniqueRefs(
    lineageEvents.flatMap((event) =>
      event.artifactRefs || []),
  );
  const anatomyRefs =
    lineage.anatomyRefs || {};
  const anatomyFacts =
    lineage.anatomyFacts || {};
  const settlementRefs = uniqueRefs([
    anatomyRefs.semanticIngressRef,
    anatomyRefs.taskSettlementRef,
    anatomyRefs.routingDecisionRef,
  ]);
  const shelfRefs =
    refsForProjectShelves(
      projection,
      lineage.projectId,
    );
  const contextRefs = uniqueRefs([
    anatomyRefs.operationalMetaContextRef ||
      lineage.operationalMetaContextRef,
    anatomyRefs.contextRequirementSetRef,
    anatomyRefs.contextImportRef,
    anatomyRefs.contextBundleRef,
    anatomyRefs.selectionWitnessRef,
  ]);
  const compiledAgentRefs = uniqueRefs([
    anatomyRefs.managerContextRef,
    anatomyRefs.agentWorldCompilationRef,
    anatomyRefs.agentInstantiationRef,
    anatomyRefs.taskConstitutionRef,
    anatomyRefs.policyClosureRef,
    anatomyRefs.requestManifestRef,
  ]);
  const resultRefs = uniqueRefs([
    anatomyRefs.roleRunRef,
    anatomyRefs.agentResultRef,
    anatomyRefs.reconciliationRef,
    anatomyRefs.splitCoordinationRef,
    ...lineageArtifactRefs,
  ]);
  const semanticObjectRefs =
    refsForProjectSemanticObjects(
      projection,
      lineage.projectId,
    );
  const executionRefs =
    refsForProjectAroExecution(
      projection,
      lineage.projectId,
    );
  const canvas =
    projection.contextCanvas
      ?.canvases
      ?.find((entry) =>
        entry.activeProjectId ===
          lineage.projectId) ||
    null;
  const canvasRefs = uniqueRefs([
    canvas?.contextCanvasRef,
    ...(canvas?.brushStrokeRefs || []),
  ]);
  const graphRefs = uniqueRefs([
    anatomyRefs.graphRef,
    anatomyRefs.graphProjectionRef,
    anatomyRefs.managerBootPacketRef,
    ...(projection.aroRegistry
      ?.repositorySnapshots || [])
      .filter((snapshot) =>
        !lineage.projectId ||
        snapshot.projectId ===
          lineage.projectId)
      .map((snapshot) =>
        snapshot.repositorySnapshotRef),
  ]);
  const responseRole =
    visibleResponse?.authorRole ||
    lineage.responsibleRole ||
    "world_manager";
  const depths = [
    depthProjection({
      definition:
        SEMANTIC_ANATOMY_DEPTHS[0],
      eventRef,
      summary:
        visibleResponse?.text ||
        lineage.rendererSafeSummary,
      facts: [
        fact(
          "Visible state",
          lineage.state,
        ),
        fact(
          "Scope",
          lineage.projectId ||
            "world scope",
        ),
        fact(
          "Needs operator",
          [
            "clarification_required",
            "partially_remanded",
            "attention_required",
            "candidate_ready",
            "candidate_reviewed",
          ].includes(lineage.state)
            ? "yes"
            : "no visible request",
        ),
      ],
      artifactRefs: [
        eventRef,
        ...messageRefs,
      ],
    }),
    depthProjection({
      definition:
        SEMANTIC_ANATOMY_DEPTHS[1],
      eventRef,
      summary:
        `Formulated by ${responseRole.replace(
          /_/g,
          " ",
        )}; routed through the WorldManager semantic ingress.`,
      facts: [
        fact(
          "Formulated by",
          responseRole.replace(/_/g, " "),
        ),
        fact(
          "Routed by",
          "WorldManager semantic router",
        ),
        fact(
          "Task",
          lineage.taskType ||
            "not settled",
        ),
        fact(
          "Lane",
          lineage.semanticLane ||
            "not settled",
        ),
      ],
      artifactRefs: [
        ...settlementRefs,
        anatomyRefs.agentResultRef,
      ],
    }),
    depthProjection({
      definition:
        SEMANTIC_ANATOMY_DEPTHS[2],
      eventRef,
      summary:
        settlementRefs.length
          ? "Settlement, routing, semantic shelves, and imported context remain exact and inspectable."
          : "Governance evidence has not been materialized for this event.",
      facts: [
        fact(
          "Settlement",
          anatomyRefs.taskSettlementRef
            ? "typed"
            : "not reached",
        ),
        fact(
          "Semantic shelves",
          anatomyFacts
            .sourceShelfCount ||
            shelfRefs.length,
        ),
        fact(
          "Imported context",
          contextRefs.length
            ? lineage
                .operationalMetaContextFreshness ||
              "available"
            : "not prepared",
        ),
        fact(
          "Route",
          anatomyFacts
            .routingDecision ||
            "not settled",
        ),
        fact(
          "Selected context",
          `${anatomyFacts.selectedEventCount || 0} outcomes · ${
            anatomyFacts.selectedSemanticObjectCount || 0
          } objects · ${
            anatomyFacts.estimatedInputTokens || 0
          } tokens${
            anatomyFacts.contextTruncated
              ? " · truncated"
              : ""
          }`,
        ),
        fact(
          "Authority",
          "inspection only",
          "non_authoritative",
        ),
      ],
      artifactRefs: [
        ...settlementRefs,
        ...shelfRefs,
        ...contextRefs,
        anatomyRefs.projectCandidateRef,
      ],
    }),
    depthProjection({
      definition:
        SEMANTIC_ANATOMY_DEPTHS[3],
      eventRef,
      summary:
        compiledAgentRefs.length
          ? "The role, policy closure, task constitution, and capability envelope were compiled as one bounded agent-world."
          : "No compiled agent-world exists for this event.",
      facts: [
        fact(
          "Responsible role",
          lineage.responsibleRole ||
            "not compiled",
        ),
        fact(
          "Role template",
          anatomyFacts
            .roleTemplateId ||
            "not compiled",
        ),
        fact(
          "Policy closure",
          anatomyFacts
            .policyClosureState ||
            "not compiled",
        ),
        fact(
          "Required actions",
          anatomyFacts
            .requiredActionClasses ||
            [],
        ),
        fact(
          "Permitted actions",
          anatomyFacts
            .permittedActionClasses ||
            [],
        ),
        fact(
          "Prohibited actions",
          anatomyFacts
            .prohibitedActionClasses ||
            [],
        ),
        fact(
          "Tools",
          anatomyRefs
            .agentWorldCompilationRef
            ? anatomyFacts.toolCount
            : "not compiled",
        ),
        fact(
          "Projection agreement",
          anatomyFacts
            .projectionAgreementState ||
            "not compiled",
        ),
        fact(
          "Launch boundary",
          anatomyFacts
            .launchBoundary ||
            "blocked",
        ),
        fact(
          "Agent world",
          anatomyRefs
            .agentWorldCompilationRef
            ? "validated preparation"
            : "not compiled",
        ),
        fact(
          "Canonical write",
          "not granted",
          "prohibited",
        ),
      ],
      artifactRefs:
        compiledAgentRefs,
    }),
    depthProjection({
      definition:
        SEMANTIC_ANATOMY_DEPTHS[4],
      eventRef,
      summary:
        resultRefs.length ||
        executionRefs.length
          ? "Role runs, result witnesses, ARO realization work, and verification remain distinct from canonical admission."
          : "No execution or provider result has been observed for this event.",
      facts: [
        fact(
          "Role result",
          anatomyRefs.agentResultRef
            ? lineage.state
            : "not produced",
        ),
        fact(
          "Output contract",
          anatomyFacts
            .outputContractState ||
            "not produced",
        ),
        fact(
          "Runtime / model",
          anatomyFacts
            .runtimeEnvironment ||
          anatomyFacts.runtimeModel
            ? `${anatomyFacts.runtimeEnvironment || "—"} / ${
                anatomyFacts.runtimeModel || "—"
              }`
            : "not started",
        ),
        fact(
          "Tool calls / effects",
          `${anatomyFacts.toolCallCount || 0} / ${
            anatomyFacts.effectCount || 0
          }`,
        ),
        fact(
          "Reconciliation",
          anatomyFacts
            .reconciliationState ||
            "not started",
        ),
        fact(
          "ARO / semantic objects",
          semanticObjectRefs.length,
        ),
        fact(
          "Execution witnesses",
          executionRefs.length,
        ),
        fact(
          "Activity is completion",
          "false",
          "boundary",
        ),
      ],
      artifactRefs: [
        ...resultRefs,
        ...semanticObjectRefs,
        ...executionRefs,
      ],
    }),
    depthProjection({
      definition:
        SEMANTIC_ANATOMY_DEPTHS[5],
      eventRef,
      summary:
        graphRefs.length ||
        canvasRefs.length
          ? "Exact graph, context, repository, canvas, and runtime refs witness the realized substrate without exposing private reasoning."
          : "No deeper substrate witness is available in this projection.",
      facts: [
        fact(
          "Graph / repository refs",
          graphRefs.length,
        ),
        fact(
          "Canvas / brush refs",
          canvasRefs.length,
        ),
        fact(
          "Direct session / turn",
          anatomyFacts
            .directSessionId ||
          anatomyFacts.directTurnId
            ? `${anatomyFacts.directSessionId || "—"} / ${
                anatomyFacts.directTurnId || "—"
              }`
            : "not started",
        ),
        fact(
          "Request manifest",
          anatomyFacts
            .requestManifestId ||
            "not created",
        ),
        fact(
          "Files touched",
          anatomyFacts.filesTouched
            ?.length
            ? anatomyFacts.filesTouched
            : "none observed",
        ),
        ...(anatomyFacts
          .constitutionState
          ? [
              fact(
                "Project constitution",
                `${anatomyFacts.constitutionState} · evidence ${
                  anatomyFacts.candidateEvidenceReviewState ||
                  "not reviewed"
                }`,
              ),
              fact(
                "Activation",
                anatomyFacts
                  .activationState ||
                  "not admitted",
              ),
              fact(
                "Workspace provisioned",
                anatomyFacts
                  .workspaceProvisioned
                  ? "yes"
                  : "no",
              ),
              fact(
                "Worker execution",
                anatomyFacts
                  .workerExecutionAvailable
                  ? "available"
                  : "not available",
              ),
            ]
          : []),
        fact(
          "Private reasoning",
          "not exposed",
          "privacy_boundary",
        ),
      ],
      artifactRefs: [
        ...graphRefs,
        ...contextRefs,
        ...canvasRefs,
        anatomyRefs.roleRunRef,
      ],
    }),
  ];
  const object = {
    schema: SEMANTIC_ANATOMY_EVENT_SCHEMA,
    anatomyEventId: stableId(
      "wm_semantic_anatomy",
      {
        eventRef,
        projectionRevision:
          projection.projectionRevision,
      },
    ),
    eventRef,
    lineageRootId:
      lineage.lineageRootId,
    projectId:
      lineage.projectId || "",
    semanticLane:
      lineage.semanticLane || "",
    taskType:
      lineage.taskType || "",
    lifecycleState:
      lineage.state,
    visibleOutcome: {
      userMessageRef:
        userMessage
          ? exactRef(
              "world_manager_message",
              userMessage.messageId,
              userMessage.messageDigest,
              "User message",
            )
          : null,
      responseMessageRef:
        visibleResponse
          ? exactRef(
              "world_manager_message",
              visibleResponse.messageId,
              visibleResponse.messageDigest,
              visibleResponse
                .provenanceLabel,
            )
          : null,
      formulatedBy: responseRole,
      text: bounded(
        visibleResponse?.text ||
          lineage.rendererSafeSummary,
        "Semantic event recorded.",
        4_000,
      ),
      state: lineage.state,
    },
    availableDepths:
      SEMANTIC_ANATOMY_DEPTHS.map(
        (entry) => entry.depth,
      ),
    depths,
    sameEventIdentityPreserved:
      depths.every((depth) =>
        depth.eventRef.id ===
          eventRef.id &&
        depth.eventRef.digest ===
          eventRef.digest),
    evidenceGate: {
      state:
        [
          ...settlementRefs,
          ...compiledAgentRefs,
          ...resultRefs,
        ].length
          ? "evidence_reachable"
          : "not_prepared",
      requiredEvidenceRefs:
        uniqueRefs([
          ...settlementRefs,
          ...compiledAgentRefs,
          ...resultRefs,
        ]),
      sameContextReachable: true,
      admissionAuthorityGranted:
        false,
    },
    privateReasoningIncluded: false,
    canonicalWorldstateMutation:
      false,
    canonical: false,
    grantsAuthority: false,
  };
  object.digest = digestFor(
    SEMANTIC_ANATOMY_EVENT_SCHEMA,
    object,
    ["digest"],
  );
  return object;
}

function altitudeFor(
  activeCanvas,
  lineage,
) {
  if (text(activeCanvas?.altitude, "")) {
    return activeCanvas.altitude;
  }
  if (
    [
      "project_planning",
      "portfolio_planning",
      "project_initialization",
    ].includes(lineage?.taskType)
  ) {
    return "architecture";
  }
  if (
    [
      "implementation",
      "repair",
      "refactor",
    ].includes(lineage?.taskType)
  ) {
    return "realization";
  }
  return lineage
    ? "task"
    : "world";
}

function buildOperationalRibbon(
  projection,
  activeEvent,
) {
  const activeCanvas =
    projection.contextCanvas
      ?.activeCanvas || null;
  const latestContext =
    projection.operationalMetaContext
      ?.latest || null;
  const lastStrokeRef =
    activeCanvas?.brushStrokeRefs
      ?.at(-1) || null;
  const lastStroke =
    lastStrokeRef
      ? projection.contextCanvas
          ?.strokes
          ?.find((stroke) =>
            stroke.brushStrokeRef?.id ===
              lastStrokeRef.id)
      : null;
  const lineage =
    projection.activeLineages
      ?.find((entry) =>
        entry.semanticEventId ===
          activeEvent?.eventRef?.id) ||
    projection.activeLineages?.at(-1) ||
    null;
  const omissionCount = Object.values(
    latestContext?.excludedCounts || {},
  ).reduce(
    (sum, value) =>
      sum + Number(value || 0),
    0,
  );
  const ribbon = {
    schema: OPERATIONAL_RIBBON_SCHEMA,
    state:
      lineage ||
      latestContext ||
      activeCanvas
        ? "active"
        : "calm",
    activeEventRef:
      activeEvent?.eventRef || null,
    scope: {
      kind:
        lineage?.projectId ||
        activeCanvas?.activeProjectId
          ? "project"
          : "user_world",
      projectId:
        lineage?.projectId ||
        activeCanvas?.activeProjectId ||
        "",
      label:
        lineage?.projectId ||
        activeCanvas?.activeProjectId ||
        "world scope",
    },
    lane:
      lineage?.semanticLane ||
      (lineage
        ? "semantic settlement"
        : "conversation"),
    altitude:
      altitudeFor(
        activeCanvas,
        lineage,
      ),
    context: {
      state:
        latestContext?.freshness ||
        "not_prepared",
      sourceShelfCount:
        Number(
          latestContext
            ?.sourceShelfCount || 0,
        ),
      selectedEventCount:
        Number(
          latestContext
            ?.selectedEventCount || 0,
        ),
      selectedSemanticObjectCount:
        Number(
          latestContext
            ?.selectedSemanticObjectCount ||
            0,
        ),
      estimatedInputTokens:
        Number(
          latestContext
            ?.estimatedInputTokens || 0,
        ),
      maxInputTokens:
        Number(
          latestContext
            ?.maxInputTokens || 0,
        ),
      omissionCount,
      truncated:
        latestContext?.truncated ===
          true,
      manifestRef:
        normalizedRef(
          latestContext
            ?.operationalMetaContextRef,
        ),
    },
    thoughtOperation: {
      state: lastStroke
        ? "active"
        : "none",
      brush:
        lastStroke?.brush || "",
      brushStrokeRef:
        lastStroke?.brushStrokeRef ||
        null,
      stackDepth:
        activeCanvas
          ?.brushStrokeRefs
          ?.length || 0,
      contextCanvasRef:
        activeCanvas
          ?.contextCanvasRef || null,
      persistencePosture:
        "temporary_reversible",
    },
    expandedEvidenceRefs:
      uniqueRefs([
        latestContext
          ?.contextRequirementSetRef,
        latestContext
          ?.contextImportRef,
        latestContext
          ?.contextBundleRef,
        latestContext
          ?.operationalMetaContextRef,
        latestContext
          ?.selectionWitnessRef,
        activeCanvas
          ?.contextCanvasRef,
        lastStroke
          ?.brushStrokeRef,
      ]),
    worldEffect: "none",
    canonicalWorldstateMutation:
      false,
    canonical: false,
    grantsAuthority: false,
  };
  ribbon.digest = digestFor(
    OPERATIONAL_RIBBON_SCHEMA,
    ribbon,
    ["digest"],
  );
  return ribbon;
}

function buildTypedInteractionParity(
  projection,
) {
  const voiceTransportState =
    text(
      projection.connectionPosture
        ?.voiceTransport,
      "deferred",
    );
  const result = {
    schema:
      TYPED_INTERACTION_PARITY_SCHEMA,
    tools: TYPED_INTERACTION_TOOLS.map(
      (definition) => ({
        ...definition,
        invocationContracts: [
          {
            modality: "keyboard",
            availability: "available",
            requestSchema:
              definition.requestSchema,
          },
          {
            modality: "pointer",
            availability: "available",
            requestSchema:
              definition.requestSchema,
          },
          {
            modality: "voice",
            availability:
              voiceTransportState ===
                "ready"
                ? "available"
                : "transport_deferred",
            requestSchema:
              definition.requestSchema,
          },
        ],
        oneTypedContractAcrossModalities:
          true,
        modalityMintsAuthority: false,
      }),
    ),
    keyboardPointerParity:
      true,
    voiceContractParity:
      true,
    voiceTransportState,
    voiceAvailabilityInflated:
      false,
    canonicalWorldstateMutation:
      false,
    grantsAuthority: false,
  };
  result.digest = digestFor(
    TYPED_INTERACTION_PARITY_SCHEMA,
    result,
    ["digest"],
  );
  return result;
}

function compileUnifiedWorldManagerProjection(
  projection,
) {
  if (
    !isPlainObject(projection) ||
    projection.schema !==
      "direct_world_manager_workbench_projection@1"
  ) {
    fail(
      "unified_projection_source_invalid",
    );
  }
  const eventObjects = (
    projection.activeLineages || []
  ).map((lineage) =>
    buildEventAnatomy(
      projection,
      lineage,
    ));
  const activeEvent =
    eventObjects.at(-1) || null;
  const semanticAnatomy = {
    schema:
      SEMANTIC_ANATOMY_PROJECTION_SCHEMA,
    depthRegistry:
      SEMANTIC_ANATOMY_DEPTHS.map(
        (entry, index) => ({
          ...entry,
          order: index,
        }),
      ),
    eventObjects,
    activeEventRef:
      activeEvent?.eventRef || null,
    objectCentered: true,
    oneEventIdentityAcrossDepths:
      eventObjects.every((event) =>
        event.sameEventIdentityPreserved),
    sameContextReachable: true,
    privateReasoningIncluded: false,
    canonicalWorldstateMutation:
      false,
    grantsAuthority: false,
  };
  semanticAnatomy.digest =
    digestFor(
      SEMANTIC_ANATOMY_PROJECTION_SCHEMA,
      semanticAnatomy,
      ["digest"],
    );
  const unified = {
    schema:
      UNIFIED_WORLD_MANAGER_PROJECTION_SCHEMA,
    projectionRevision:
      Number(
        projection.projectionRevision || 0,
      ),
    profile: {
      baseProfile:
        "artifact_inspector_reference",
      derivativeProfile:
        "unified_semantic_anatomy_workbench",
      status: "proposed_local",
      density:
        "low_default_with_semantic_expansion",
      navigationMode:
        "simultaneous_context_with_object_centered_focus",
      informationPosture:
        "outcome_first_with_evidence_drilldown",
      stateExposure:
        "progressive_explicit",
      commandPosture:
        "safe_buffered_dual_lane",
    },
    operationalRibbon:
      buildOperationalRibbon(
        projection,
        activeEvent,
      ),
    semanticAnatomy,
    interactionParity:
      buildTypedInteractionParity(
        projection,
      ),
    minimalThoughtPaletteRef: {
      kind: "thought_brush_registry",
      id:
        projection.contextCanvas
          ?.registry?.registryId ||
        "direct_thought_brush_registry",
      digest:
        projection.contextCanvas
          ?.registry?.digest ||
        digestFor(
          "direct_thought_brush_registry_projection@1",
          projection.contextCanvas
            ?.registry || {},
        ),
      rawTextIncluded: false,
      rawPathIncluded: false,
      rawSecretIncluded: false,
    },
    sameSemanticIdentityAcrossViews:
      true,
    evidenceBeforeAdmission:
      true,
    inspectionIsReadOnly: true,
    responsiveSameContextPreserved:
      true,
    canonicalWorldstateMutation:
      false,
    canonical: false,
    grantsAuthority: false,
  };
  unified.digest = digestFor(
    UNIFIED_WORLD_MANAGER_PROJECTION_SCHEMA,
    unified,
    ["digest"],
  );
  validateUnifiedWorldManagerProjection(
    unified,
  );
  return unified;
}

function validateExactRef(value, label) {
  if (
    !isPlainObject(value) ||
    !text(value.kind, "") ||
    !text(value.id, "") ||
    !text(value.digest, "") ||
    value.rawTextIncluded !== false ||
    value.rawPathIncluded !== false ||
    value.rawSecretIncluded !== false
  ) {
    fail(
      "unified_projection_ref_invalid",
      label,
    );
  }
}

function validateUnifiedWorldManagerProjection(
  value,
) {
  if (
    !isPlainObject(value) ||
    value.schema !==
      UNIFIED_WORLD_MANAGER_PROJECTION_SCHEMA ||
    value.semanticAnatomy?.schema !==
      SEMANTIC_ANATOMY_PROJECTION_SCHEMA ||
    value.operationalRibbon?.schema !==
      OPERATIONAL_RIBBON_SCHEMA ||
    value.interactionParity?.schema !==
      TYPED_INTERACTION_PARITY_SCHEMA
  ) {
    fail(
      "unified_projection_schema_invalid",
    );
  }
  if (
    value.semanticAnatomy.digest !==
      digestFor(
        SEMANTIC_ANATOMY_PROJECTION_SCHEMA,
        value.semanticAnatomy,
        ["digest"],
      ) ||
    value.operationalRibbon.digest !==
      digestFor(
        OPERATIONAL_RIBBON_SCHEMA,
        value.operationalRibbon,
        ["digest"],
      ) ||
    value.interactionParity.digest !==
      digestFor(
        TYPED_INTERACTION_PARITY_SCHEMA,
        value.interactionParity,
        ["digest"],
      )
  ) {
    fail(
      "unified_projection_child_digest_invalid",
    );
  }
  const expectedDepths =
    SEMANTIC_ANATOMY_DEPTHS.map(
      (entry) => entry.depth,
    );
  if (
    JSON.stringify(
      value.semanticAnatomy
        .depthRegistry.map((entry) =>
          entry.depth),
    ) !== JSON.stringify(expectedDepths)
  ) {
    fail(
      "unified_projection_depth_registry_invalid",
    );
  }
  for (
    const event of
      value.semanticAnatomy
        .eventObjects
  ) {
    if (
      event.schema !==
        SEMANTIC_ANATOMY_EVENT_SCHEMA ||
      event.canonical !== false ||
      event.grantsAuthority !== false ||
      event
        .canonicalWorldstateMutation !==
        false ||
      event
        .privateReasoningIncluded !==
        false ||
      event
        .sameEventIdentityPreserved !==
        true ||
      JSON.stringify(
        event.availableDepths,
      ) !== JSON.stringify(expectedDepths) ||
      event.depths.length !==
        expectedDepths.length
    ) {
      fail(
        "unified_projection_event_invalid",
        event.anatomyEventId,
      );
    }
    validateExactRef(
      event.eventRef,
      "event.eventRef",
    );
    event.depths.forEach(
      (depth, index) => {
        if (
          depth.schema !==
            SEMANTIC_ANATOMY_DEPTH_SCHEMA ||
          depth.depth !==
            expectedDepths[index] ||
          depth.eventRef.id !==
            event.eventRef.id ||
          depth.eventRef.digest !==
            event.eventRef.digest ||
          depth.privateReasoningIncluded !==
            false ||
          depth
            .canonicalWorldstateMutation !==
            false ||
          depth.grantsAuthority !== false
        ) {
          fail(
            "unified_projection_depth_invalid",
            `${event.anatomyEventId}:${index}`,
          );
        }
        validateExactRef(
          depth.eventRef,
          "depth.eventRef",
        );
        depth.artifactRefs.forEach(
          (ref) =>
            validateExactRef(
              ref,
              "depth.artifactRef",
            ),
        );
        if (
          depth.digest !==
            digestFor(
              SEMANTIC_ANATOMY_DEPTH_SCHEMA,
              depth,
              ["digest"],
            )
        ) {
          fail(
            "unified_projection_depth_digest_invalid",
            depth.depth,
          );
        }
      },
    );
    if (
      event.digest !==
        digestFor(
          SEMANTIC_ANATOMY_EVENT_SCHEMA,
          event,
          ["digest"],
        )
    ) {
      fail(
        "unified_projection_event_digest_invalid",
        event.anatomyEventId,
      );
    }
  }
  if (
    value.semanticAnatomy
      .activeEventRef
  ) {
    validateExactRef(
      value.semanticAnatomy
        .activeEventRef,
      "semanticAnatomy.activeEventRef",
    );
    if (
      !value.semanticAnatomy
        .eventObjects
        .some((event) =>
          event.eventRef.id ===
            value.semanticAnatomy
              .activeEventRef.id &&
          event.eventRef.digest ===
            value.semanticAnatomy
              .activeEventRef.digest)
    ) {
      fail(
        "unified_projection_active_event_unknown",
      );
    }
  }
  const modalityOrder = [
    "keyboard",
    "pointer",
    "voice",
  ];
  if (
    value.interactionParity
      .keyboardPointerParity !== true ||
    value.interactionParity
      .voiceContractParity !== true ||
    value.interactionParity
      .voiceAvailabilityInflated !==
        false ||
    value.interactionParity
      .grantsAuthority !== false ||
    value.interactionParity.tools.some(
      (tool) =>
        tool
          .oneTypedContractAcrossModalities !==
          true ||
        tool.modalityMintsAuthority !==
          false ||
        JSON.stringify(
          tool.invocationContracts.map(
            (entry) =>
              entry.modality,
          ),
        ) !==
          JSON.stringify(
            modalityOrder,
          ) ||
        tool.invocationContracts.some(
          (entry) =>
            entry.requestSchema !==
              tool.requestSchema),
    )
  ) {
    fail(
      "unified_projection_interaction_parity_invalid",
    );
  }
  if (
    value.operationalRibbon
      .canonical !== false ||
    value.operationalRibbon
      .grantsAuthority !== false ||
    value.operationalRibbon
      .worldEffect !== "none" ||
    value.operationalRibbon
      .canonicalWorldstateMutation !==
        false ||
    value
      .sameSemanticIdentityAcrossViews !==
        true ||
    value.evidenceBeforeAdmission !==
      true ||
    value.inspectionIsReadOnly !==
      true ||
    value
      .responsiveSameContextPreserved !==
        true ||
    value
      .canonicalWorldstateMutation !==
        false ||
    value.canonical !== false ||
    value.grantsAuthority !== false
  ) {
    fail(
      "unified_projection_authority_boundary_invalid",
    );
  }
  if (
    value.operationalRibbon
      .activeEventRef
  ) {
    validateExactRef(
      value.operationalRibbon
        .activeEventRef,
      "operationalRibbon.activeEventRef",
    );
  }
  value.operationalRibbon
    .expandedEvidenceRefs
    .forEach((ref) =>
      validateExactRef(
        ref,
        "operationalRibbon.evidenceRef",
      ));
  validateExactRef(
    value.minimalThoughtPaletteRef,
    "minimalThoughtPaletteRef",
  );
  if (
    value.digest !==
      digestFor(
        UNIFIED_WORLD_MANAGER_PROJECTION_SCHEMA,
        value,
        ["digest"],
      )
  ) {
    fail(
      "unified_projection_digest_invalid",
    );
  }
  return true;
}

module.exports = {
  OPERATIONAL_RIBBON_SCHEMA,
  SEMANTIC_ANATOMY_DEPTHS,
  SEMANTIC_ANATOMY_DEPTH_SCHEMA,
  SEMANTIC_ANATOMY_EVENT_SCHEMA,
  SEMANTIC_ANATOMY_PROJECTION_SCHEMA,
  TYPED_INTERACTION_PARITY_SCHEMA,
  UNIFIED_WORLD_MANAGER_PROJECTION_SCHEMA,
  compileUnifiedWorldManagerProjection,
  validateUnifiedWorldManagerProjection,
};
