"use strict";

const {
  buildAroReconstructionCandidate,
  digestFor,
  stableId,
  validateAroReconstructionCandidate,
} = require("./aro-kernel");

const THOUGHT_BRUSH_ACTION =
  "wm_discharge_thought_brush";
const THOUGHT_BRUSH_REGISTRY_SCHEMA =
  "direct_thought_brush_registry@1";
const THOUGHT_BRUSH_REQUEST_SCHEMA =
  "direct_thought_brush_request@1";
const THOUGHT_BRUSH_RESULT_SCHEMA =
  "direct_thought_brush_result@1";
const THOUGHT_BRUSH_VALIDATION_SCHEMA =
  "direct_thought_brush_validation@1";
const THOUGHT_BRUSH_STROKE_SCHEMA =
  "direct_thought_brush_stroke@1";
const CONTEXT_CANVAS_SCHEMA =
  "direct_context_canvas@1";
const CONTEXT_CANVAS_INSIGHT_EXTRACTION_REQUEST_SCHEMA =
  "direct_context_canvas_insight_extraction_request@1";

const BRUSH_DEFINITIONS = Object.freeze([
  {
    key: "interpolate",
    label: "Interpolate",
    shortLabel: "Between",
    description:
      "Search a bounded chronological or semantic span for connective trajectory, unfinished motion, intermediate distinctions, and possible synthesis.",
    direction: "between_selected_anchors",
    defaultAltitude: "same_as_anchors",
    compositionPosture: "extend",
    requiredPreservations: [
      "source identity",
      "unresolved tensions",
      "chronological direction",
    ],
  },
  {
    key: "switch",
    label: "Switch project",
    shortLabel: "Switch",
    description:
      "Replace the project-scoped canvas with the selected project's semantic history while retaining only stable world and pinned anchors.",
    direction: "replace_project_scope",
    defaultAltitude: "project",
    compositionPosture: "replace",
    requiredPreservations: [
      "stable user constitution",
      "world constitution",
      "explicitly pinned anchors",
    ],
  },
  {
    key: "vertical_ascent",
    label: "Vertical ascent",
    shortLabel: "Ascend",
    description:
      "Traverse from realization toward component ARO, architecture, purpose, and principle without erasing lower-level demands or contradictions.",
    direction: "toward_abstraction",
    defaultAltitude: "architecture",
    compositionPosture: "extend",
    requiredPreservations: [
      "lower-level demands",
      "known contradictions",
      "source lineage",
    ],
  },
  {
    key: "vertical_descent",
    label: "Vertical descent",
    shortLabel: "Descend",
    description:
      "Turn abstract demands into bounded realization obligations without assuming a canonical implementation.",
    direction: "toward_realization",
    defaultAltitude: "component",
    compositionPosture: "extend",
    requiredPreservations: [
      "abstract demand identity",
      "alternatives",
      "non-canonical posture",
    ],
  },
  {
    key: "horizontal_analogy",
    label: "Horizontal analogy",
    shortLabel: "Analogy",
    description:
      "Align homologous objects at the same semantic altitude and separate transferable structure from policy or substrate differences.",
    direction: "across_homologous_objects",
    defaultAltitude: "same_as_anchors",
    compositionPosture: "extend",
    requiredPreservations: [
      "project policy differences",
      "substrate differences",
      "invalid transfer conditions",
    ],
  },
  {
    key: "horizontal_contrast",
    label: "Horizontal contrast",
    shortLabel: "Contrast",
    description:
      "Emphasize the discriminators between objects at the same semantic altitude.",
    direction: "across_discriminators",
    defaultAltitude: "same_as_anchors",
    compositionPosture: "extend",
    requiredPreservations: [
      "shared altitude",
      "policy differences",
      "substrate differences",
    ],
  },
  {
    key: "causal_trace",
    label: "Causal trace",
    shortLabel: "Causes",
    description:
      "Trace causes, evidence, authority transitions, and semantic state changes behind the selected anchors.",
    direction: "toward_causes",
    defaultAltitude: "causal_lineage",
    compositionPosture: "extend",
    requiredPreservations: [
      "evidence identity",
      "authority boundaries",
      "transition order",
    ],
  },
  {
    key: "effect_projection",
    label: "Effect projection",
    shortLabel: "Effects",
    description:
      "Project likely downstream objects, projects, policies, realizations, and decisions from the selected anchors.",
    direction: "toward_effects",
    defaultAltitude: "causal_lineage",
    compositionPosture: "extend",
    requiredPreservations: [
      "uncertainty",
      "authority boundaries",
      "canonical versus candidate status",
    ],
  },
  {
    key: "counterfactual_branch",
    label: "Counterfactual branch",
    shortLabel: "Counterfactual",
    description:
      "Create a temporary candidate branch exploring what would follow under an alternate condition.",
    direction: "alternate_world_branch",
    defaultAltitude: "same_as_anchors",
    compositionPosture: "extend",
    requiredPreservations: [
      "actual-world baseline",
      "changed assumption",
      "temporary posture",
    ],
  },
  {
    key: "assumption_inversion",
    label: "Assumption inversion",
    shortLabel: "Invert",
    description:
      "Temporarily invert one governing assumption and expose the semantic consequences.",
    direction: "invert_assumption",
    defaultAltitude: "same_as_anchors",
    compositionPosture: "extend",
    requiredPreservations: [
      "original assumption",
      "inversion boundary",
      "temporary posture",
    ],
  },
  {
    key: "constitutional_overlay",
    label: "Constitutional overlay",
    shortLabel: "Constitution",
    description:
      "Project applicable policy, authority, capability, budget, and completion constraints over the active canvas.",
    direction: "overlay_governance",
    defaultAltitude: "constitution",
    compositionPosture: "extend",
    requiredPreservations: [
      "policy provenance",
      "authority boundaries",
      "capability constraints",
    ],
  },
]);

const BRUSH_KEYS = new Set(
  BRUSH_DEFINITIONS.map(
    (definition) => definition.key,
  ),
);
const STROKE_STATES = new Set([
  "completed",
  "remanded",
  "failed",
]);
const CANVAS_FRESHNESS = new Set([
  "fresh",
  "stale",
  "blocked",
]);
const ARO_MODALITIES = new Set([
  "required",
  "possible",
  "counterfactual",
]);
const ARO_STATES = new Set([
  "supported",
  "missing",
  "contradicted",
  "unknown",
]);
const ARO_EDGE_RELATIONS = new Set([
  "requires",
  "excludes",
  "causes",
  "refines",
  "alternative_to",
  "counterfactual_of",
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
  const source = text(value, fallback);
  return source.length > max
    ? `${source.slice(0, max - 1).trimEnd()}…`
    : source;
}

function nowIso(now = Date.now) {
  const value =
    typeof now === "function"
      ? now()
      : now;
  return new Date(
    Number(value) || Date.now(),
  ).toISOString();
}

function exactRef(
  value = {},
  label = "ref",
) {
  const ref = {
    kind: text(value.kind, ""),
    id: text(value.id, ""),
    digest: text(value.digest, ""),
  };
  if (!ref.kind || !ref.id || !ref.digest) {
    fail(
      "world_manager_thought_brush_ref_invalid",
      label,
    );
  }
  const projectId = text(
    value.projectId,
    "",
  );
  if (projectId) ref.projectId = projectId;
  const refLabel = text(
    value.label,
    "",
  );
  if (refLabel) {
    ref.label = bounded(
      refLabel,
      "",
      240,
    );
  }
  return ref;
}

function exactRefMatches(left, right) {
  return Boolean(
    left &&
      right &&
      left.kind === right.kind &&
      left.id === right.id &&
      left.digest === right.digest,
  );
}

function uniqueStrings(values = []) {
  return [
    ...new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => text(value, ""))
        .filter(Boolean),
    ),
  ];
}

function uniqueRefs(values = []) {
  const refs = (
    Array.isArray(values)
      ? values
      : []
  ).map((value, index) =>
    exactRef(
      value,
      `refs.${index}`,
    ));
  const seen = new Set();
  return refs.filter((ref) => {
    const key =
      `${ref.kind}:${ref.id}:${ref.digest}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function exactKeys(
  value,
  expected,
  label,
) {
  if (!isPlainObject(value)) {
    fail(
      "world_manager_thought_brush_object_required",
      label,
    );
  }
  const actual =
    Object.keys(value).sort();
  const wanted =
    [...expected].sort();
  if (
    actual.length !== wanted.length ||
    actual.some(
      (key, index) =>
        key !== wanted[index],
    )
  ) {
    fail(
      "world_manager_thought_brush_form_mismatch",
      label,
    );
  }
}

function brushDefinition(key) {
  const normalized = text(key, "");
  const definition =
    BRUSH_DEFINITIONS.find(
      (entry) =>
        entry.key === normalized,
    );
  if (!definition) {
    fail(
      "world_manager_thought_brush_unknown",
      normalized,
    );
  }
  return definition;
}

function thoughtBrushRegistry() {
  const registry = {
    schema:
      THOUGHT_BRUSH_REGISTRY_SCHEMA,
    registryId:
      "world_manager.thought_brush_registry@1",
    definitions:
      BRUSH_DEFINITIONS.map(
        (definition) => ({
          ...definition,
          persistencePosture:
            "temporary_canvas",
          worldEffect: "none",
          grantsAuthority: false,
        }),
      ),
    invocationForms: [
      "natural_language_palette",
      "compact_control",
      "expert_command",
    ],
    compositionAvailable: true,
    undoAvailable: true,
    candidateExtractionAvailable:
      true,
    canonicalAdmissionAvailable:
      false,
    persistencePosture:
      "temporary_reversible",
    worldEffect: "none",
    grantsAuthority: false,
  };
  registry.digest = digestFor(
    THOUGHT_BRUSH_REGISTRY_SCHEMA,
    registry,
    ["digest"],
  );
  validateThoughtBrushRegistry(
    registry,
  );
  return registry;
}

function validateThoughtBrushRegistry(
  value,
) {
  if (
    !isPlainObject(value) ||
    value.schema !==
      THOUGHT_BRUSH_REGISTRY_SCHEMA ||
    value.registryId !==
      "world_manager.thought_brush_registry@1" ||
    !Array.isArray(value.definitions) ||
    value.definitions.length !==
      BRUSH_DEFINITIONS.length ||
    value.compositionAvailable !== true ||
    value.undoAvailable !== true ||
    value.candidateExtractionAvailable !==
      true ||
    value.canonicalAdmissionAvailable !==
      false ||
    value.persistencePosture !==
      "temporary_reversible" ||
    value.worldEffect !== "none" ||
    value.grantsAuthority !== false ||
    value.digest !==
      digestFor(
        THOUGHT_BRUSH_REGISTRY_SCHEMA,
        value,
        ["digest"],
      )
  ) {
    fail(
      "world_manager_thought_brush_registry_invalid",
    );
  }
  const keys = new Set();
  for (
    const definition
    of value.definitions
  ) {
    if (
      !BRUSH_KEYS.has(
        definition.key,
      ) ||
      keys.has(definition.key) ||
      !text(definition.label, "") ||
      !text(
        definition.description,
        "",
      ) ||
      !Array.isArray(
        definition
          .requiredPreservations,
      ) ||
      definition.persistencePosture !==
        "temporary_canvas" ||
      definition.worldEffect !==
        "none" ||
      definition.grantsAuthority !==
        false
    ) {
      fail(
        "world_manager_thought_brush_definition_invalid",
      );
    }
    keys.add(definition.key);
  }
  return true;
}

function normalizeSourceCatalog(
  values = [],
) {
  const keys = new Set();
  return (
    Array.isArray(values)
      ? values
      : []
  ).slice(0, 160).map(
    (entry, index) => {
      const key = text(
        entry?.key,
        "",
      );
      if (!key || keys.has(key)) {
        fail(
          "world_manager_thought_brush_source_key_invalid",
          String(index),
        );
      }
      keys.add(key);
      const normalized = {
        key,
        ref: exactRef(
          entry.ref,
          `sourceCatalog.${index}.ref`,
        ),
        projectId: text(
          entry.projectId ||
            entry.ref?.projectId,
          "",
        ),
        objectClass: text(
          entry.objectClass,
          "semantic_object",
        ),
        label: bounded(
          entry.label,
          key,
          240,
        ),
        summary: bounded(
          entry.summary,
          "",
          1_200,
        ),
        contradiction:
          entry.contradiction === true,
        discriminator:
          entry.discriminator === true,
        pinned:
          entry.pinned === true,
      };
      return normalized;
    },
  );
}

function buildThoughtBrushRequest(
  input = {},
) {
  const brush =
    brushDefinition(input.brush);
  const projectId = text(
    input.projectId,
    "",
  );
  if (!projectId) {
    fail(
      "world_manager_thought_brush_project_required",
    );
  }
  const sourceCatalog =
    normalizeSourceCatalog(
      input.sourceCatalog,
    );
  if (!sourceCatalog.length) {
    fail(
      "world_manager_thought_brush_sources_required",
    );
  }
  const targetProjectId = text(
    input.targetProjectId,
    "",
  );
  if (
    brush.key === "switch" &&
    !targetProjectId
  ) {
    fail(
      "world_manager_thought_brush_switch_target_required",
    );
  }
  const currentCanvasRef =
    input.currentCanvasRef
      ? exactRef(
          input.currentCanvasRef,
          "thoughtBrush.currentCanvasRef",
        )
      : null;
  const userInstruction = bounded(
    input.userInstruction,
    brush.description,
    8_000,
  );
  const requestedAt = text(
    input.requestedAt,
    nowIso(input.now),
  );
  const request = {
    schema:
      THOUGHT_BRUSH_REQUEST_SCHEMA,
    brushStrokeId: text(
      input.brushStrokeId,
      stableId(
        "wm_thought_brush_stroke",
        {
          projectId,
          brush: brush.key,
          targetProjectId,
          currentCanvasRef,
          userInstruction,
          operatorActionId:
            text(
              input.operatorActionId,
              "",
            ),
        },
      ),
    ),
    projectId,
    targetProjectId,
    brush: brush.key,
    brushRegistryRef: exactRef({
      kind:
        "thought_brush_registry",
      id:
        thoughtBrushRegistry()
          .registryId,
      digest:
        thoughtBrushRegistry()
          .digest,
    }),
    currentCanvasRef,
    sourceCatalog,
    sourceCatalogDigest:
      digestFor(
        "direct_thought_brush_source_catalog@1",
        sourceCatalog,
      ),
    altitude: bounded(
      input.altitude,
      brush.defaultAltitude,
      160,
    ),
    userInstruction,
    preservationRules:
      uniqueStrings([
        ...brush
          .requiredPreservations,
        ...(input
          .preservationRules ||
          []),
      ]),
    requiredPreservationKeys:
      uniqueStrings([
        ...sourceCatalog
          .filter((source) =>
            (
              source.contradiction &&
              (
                brush.key !== "switch" ||
                source.pinned ||
                source.projectId ===
                  targetProjectId
              )
            ) ||
            (
              [
                "horizontal_analogy",
                "horizontal_contrast",
              ].includes(brush.key) &&
              source.discriminator
            ))
          .map((source) =>
            source.key),
        ...(input
          .requiredPreservationKeys ||
          []),
      ]),
    attentionBudget: {
      maxInputTokens:
        Math.max(
          1_000,
          Math.min(
            24_000,
            Number(
              input.attentionBudget
                ?.maxInputTokens ||
                12_000,
            ),
          ),
        ),
      maxResultObjects:
        Math.max(
          1,
          Math.min(
            24,
            Number(
              input.attentionBudget
                ?.maxResultObjects ||
                10,
            ),
          ),
        ),
    },
    operatorActionId: text(
      input.operatorActionId,
      stableId(
        "wm_thought_brush_action",
        {
          projectId,
          brush: brush.key,
          requestedAt,
        },
      ),
    ),
    persistencePosture:
      "temporary_canvas",
    worldEffect: "none",
    grantsAuthority: false,
    requestedAt,
  };
  request.digest = digestFor(
    THOUGHT_BRUSH_REQUEST_SCHEMA,
    request,
    ["digest"],
  );
  validateThoughtBrushRequest(
    request,
  );
  return request;
}

function validateThoughtBrushRequest(
  value,
) {
  if (
    !isPlainObject(value) ||
    value.schema !==
      THOUGHT_BRUSH_REQUEST_SCHEMA ||
    !text(value.brushStrokeId, "") ||
    !text(value.projectId, "") ||
    !BRUSH_KEYS.has(value.brush) ||
    !Array.isArray(
      value.sourceCatalog,
    ) ||
    !value.sourceCatalog.length ||
    value.sourceCatalogDigest !==
      digestFor(
        "direct_thought_brush_source_catalog@1",
        value.sourceCatalog,
      ) ||
    !text(value.altitude, "") ||
    !text(value.userInstruction, "") ||
    !Array.isArray(
      value.preservationRules,
    ) ||
    !Array.isArray(
      value.requiredPreservationKeys,
    ) ||
    !isPlainObject(
      value.attentionBudget,
    ) ||
    value.persistencePosture !==
      "temporary_canvas" ||
    value.worldEffect !== "none" ||
    value.grantsAuthority !== false ||
    value.digest !==
      digestFor(
        THOUGHT_BRUSH_REQUEST_SCHEMA,
        value,
        ["digest"],
      )
  ) {
    fail(
      "world_manager_thought_brush_request_invalid",
    );
  }
  if (
    value.brush === "switch" &&
    !text(value.targetProjectId, "")
  ) {
    fail(
      "world_manager_thought_brush_switch_target_required",
    );
  }
  exactRef(
    value.brushRegistryRef,
    "thoughtBrush.brushRegistryRef",
  );
  if (value.currentCanvasRef) {
    exactRef(
      value.currentCanvasRef,
      "thoughtBrush.currentCanvasRef",
    );
  }
  normalizeSourceCatalog(
    value.sourceCatalog,
  );
  const sourceKeys = new Set(
    value.sourceCatalog.map(
      (source) => source.key,
    ),
  );
  if (
    value.requiredPreservationKeys
      .some((key) =>
        !sourceKeys.has(key))
  ) {
    fail(
      "world_manager_thought_brush_preservation_source_unknown",
    );
  }
  return true;
}

function validateContextCanvasInsightExtractionRequest(
  value,
) {
  if (
    !isPlainObject(value) ||
    value.schema !==
      CONTEXT_CANVAS_INSIGHT_EXTRACTION_REQUEST_SCHEMA ||
    !text(value.projectId, "") ||
    !text(value.contextCanvasId, "") ||
    !text(value.contextCanvasDigest, "") ||
    !text(value.candidateInsightId, "")
  ) {
    fail(
      "world_manager_context_canvas_insight_extraction_request_invalid",
    );
  }
  return true;
}

function branchToolSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      branchKey: {
        type: "string",
      },
      parentBranchKey: {
        type: "string",
      },
      branchKind: {
        type: "string",
      },
      modality: {
        type: "string",
        enum: [...ARO_MODALITIES],
      },
      statement: {
        type: "string",
      },
      condition: {
        type: "string",
      },
      expectedOutcome: {
        type: "string",
      },
      semanticState: {
        type: "string",
        enum: [...ARO_STATES],
      },
    },
    required: [
      "branchKey",
      "parentBranchKey",
      "branchKind",
      "modality",
      "statement",
      "condition",
      "expectedOutcome",
      "semanticState",
    ],
  };
}

function thoughtBrushTool() {
  return {
    type: "function",
    name: THOUGHT_BRUSH_ACTION,
    description:
      "Apply the selected semantic transformation to the exact supplied source catalog. The result is temporary ContextCanvas material and grants no world, tool, workspace, or canonical authority.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        summary: {
          type: "string",
        },
        altitude: {
          type: "string",
        },
        selectedAnchorKeys: {
          type: "array",
          items: {
            type: "string",
          },
        },
        selectedContextKeys: {
          type: "array",
          items: {
            type: "string",
          },
        },
        preservedSourceKeys: {
          type: "array",
          items: {
            type: "string",
          },
        },
        resultObjects: {
          type: "array",
          maxItems: 24,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              objectKey: {
                type: "string",
              },
              objectKind: {
                type: "string",
              },
              label: {
                type: "string",
              },
              summary: {
                type: "string",
              },
              sourceKeys: {
                type: "array",
                items: {
                  type: "string",
                },
              },
              relationHints: {
                type: "array",
                items: {
                  type: "string",
                },
              },
              temporaryPosture: {
                type: "string",
                enum: [
                  "candidate",
                  "counterfactual",
                  "exploratory",
                ],
              },
            },
            required: [
              "objectKey",
              "objectKind",
              "label",
              "summary",
              "sourceKeys",
              "relationHints",
              "temporaryPosture",
            ],
          },
        },
        candidateInsights: {
          type: "array",
          maxItems: 8,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              insightKey: {
                type: "string",
              },
              conceptKey: {
                type: "string",
              },
              semanticIdentity: {
                type: "string",
              },
              purpose: {
                type: "string",
              },
              rationale: {
                type: "string",
              },
              sourceKeys: {
                type: "array",
                items: {
                  type: "string",
                },
              },
              branches: {
                type: "array",
                minItems: 1,
                maxItems: 24,
                items:
                  branchToolSchema(),
              },
              edges: {
                type: "array",
                maxItems: 40,
                items: {
                  type: "object",
                  additionalProperties:
                    false,
                  properties: {
                    fromBranchKey: {
                      type: "string",
                    },
                    toBranchKey: {
                      type: "string",
                    },
                    relationKind: {
                      type: "string",
                      enum: [
                        ...ARO_EDGE_RELATIONS,
                      ],
                    },
                    rationale: {
                      type: "string",
                    },
                  },
                  required: [
                    "fromBranchKey",
                    "toBranchKey",
                    "relationKind",
                    "rationale",
                  ],
                },
              },
            },
            required: [
              "insightKey",
              "conceptKey",
              "semanticIdentity",
              "purpose",
              "rationale",
              "sourceKeys",
              "branches",
              "edges",
            ],
          },
        },
        omissions: {
          type: "array",
          items: {
            type: "string",
          },
        },
      },
      required: [
        "summary",
        "altitude",
        "selectedAnchorKeys",
        "selectedContextKeys",
        "preservedSourceKeys",
        "resultObjects",
        "candidateInsights",
        "omissions",
      ],
    },
  };
}

function thoughtBrushInstructions(
  request,
) {
  validateThoughtBrushRequest(
    request,
  );
  const brush =
    brushDefinition(request.brush);
  return [
    "You are the bounded thought-brush reasoner operating under the WorldManager.",
    `Apply only the trusted ${brush.label} transformation described in the request.`,
    "The source catalog is exact semantic context selected by the harness. Refer to sources only by their supplied source keys.",
    "The schema constrains discharge form, not semantic vocabulary. Use open semantic object kinds, labels, summaries, and relations appropriate to the material.",
    "Honor the requested semantic altitude, user instruction, and preservation rules.",
    "Every required preservation key must appear in preservedSourceKeys. Preserve known lower-level contradictions during ascent and policy or substrate discriminators during analogy or contrast.",
    "A switch replaces project-scoped attention with the target project. It does not append the prior project's whole canvas. Select only target-project or explicitly pinned world sources.",
    "Counterfactual and assumption-inversion results are temporary branches, never claims about the actual world.",
    "Candidate insights are optional ARO-shaped interpretations. Include them only when an intensional object with requirements, alternatives, edges, or counterfactuals is genuinely supported by the selected sources.",
    "Do not claim source inspection, code mutation, policy admission, project mutation, external effects, or authority.",
    `Call exactly one ${THOUGHT_BRUSH_ACTION} action. Emit no prose or JSON outside the action.`,
    "The harness will validate references and store only a reversible ContextCanvas revision. Any extracted insight must later pass the normal ARO review and admission gates.",
  ].join("\n");
}

function thoughtBrushPrompt(
  request,
) {
  validateThoughtBrushRequest(
    request,
  );
  return [
    "[TRUSTED BRUSH]",
    JSON.stringify(
      brushDefinition(
        request.brush,
      ),
    ),
    "[CANVAS SCOPE]",
    JSON.stringify({
      projectId:
        request.projectId,
      targetProjectId:
        request.targetProjectId,
      currentCanvasRef:
        request.currentCanvasRef,
      altitude:
        request.altitude,
      preservationRules:
        request.preservationRules,
      requiredPreservationKeys:
        request
          .requiredPreservationKeys,
      attentionBudget:
        request.attentionBudget,
    }),
    "[EXACT SOURCE CATALOG]",
    JSON.stringify(
      request.sourceCatalog,
    ),
    "[USER THOUGHT DIRECTION]",
    request.userInstruction,
    "[DISCHARGE]",
    "Return one temporary semantic transformation over these exact sources.",
  ].join("\n");
}

function thoughtBrushOutputContract() {
  const tool = thoughtBrushTool();
  const contract = {
    schema:
      "direct_thought_brush_action_contract@1",
    outputContractId:
      "world_manager.thought_brush@1",
    selectionMechanism:
      "required_native_function_action",
    exactlyOneActionRequired: true,
    availableActionNames: [
      THOUGHT_BRUSH_ACTION,
    ],
    semanticContentPosture: "open",
    persistencePosture:
      "temporary_canvas",
    worldEffect: "none",
    toolExecutionEffect: false,
    workspaceMutationEffect: false,
    canonicalAdmissionEffect: false,
    grantsAuthority: false,
    tools: [tool],
  };
  contract.digest = digestFor(
    contract.schema,
    contract,
    ["digest"],
  );
  return contract;
}

function parseArguments(value) {
  if (isPlainObject(value)) return value;
  try {
    const parsed = JSON.parse(
      String(value || ""),
    );
    return isPlainObject(parsed)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function normalizeToolCalls(
  runnerResult,
) {
  if (
    Array.isArray(
      runnerResult?.actionCalls,
    )
  ) {
    return runnerResult
      .actionCalls.map((call) => ({
        name: text(
          call?.name,
          "",
        ),
        arguments:
          call?.argumentsJson ??
          call?.arguments ??
          call?.payload,
      }));
  }
  if (
    Array.isArray(
      runnerResult?.normalizedEvents,
    )
  ) {
    return runnerResult
      .normalizedEvents
      .filter((event) =>
        event?.type ===
          "tool_call_completed")
      .map((event) => ({
        name: text(
          event.name ||
            event.toolName,
          "",
        ),
        arguments:
          event.argumentsJson ??
          event.arguments,
      }));
  }
  const source =
    runnerResult?.response ||
    runnerResult;
  const candidates = [
    ...(Array.isArray(
      source?.toolCalls,
    )
      ? source.toolCalls
      : []),
    ...(Array.isArray(
      source?.tool_calls,
    )
      ? source.tool_calls
      : []),
    ...(Array.isArray(
      source?.actions,
    )
      ? source.actions
      : []),
  ];
  return candidates.map(
    (call) => ({
      name: text(
        call?.name ||
          call?.function?.name ||
          call?.action,
        "",
      ),
      arguments:
        call?.arguments ??
        call?.function?.arguments ??
        call?.input ??
        call?.payload,
    }),
  );
}

function normalizeResultObject(
  value,
  sourceKeys,
) {
  exactKeys(
    value,
    [
      "objectKey",
      "objectKind",
      "label",
      "summary",
      "sourceKeys",
      "relationHints",
      "temporaryPosture",
    ],
    "resultObject",
  );
  const result = {
    objectKey: text(
      value.objectKey,
      "",
    ),
    objectKind: text(
      value.objectKind,
      "",
    ),
    label: bounded(
      value.label,
      "",
      300,
    ),
    summary: bounded(
      value.summary,
      "",
      2_400,
    ),
    sourceKeys:
      uniqueStrings(
        value.sourceKeys,
      ),
    relationHints:
      uniqueStrings(
        value.relationHints,
      ).map((entry) =>
        bounded(
          entry,
          "",
          800,
        )),
    temporaryPosture: text(
      value.temporaryPosture,
      "",
    ),
  };
  if (
    !result.objectKey ||
    !result.objectKind ||
    !result.label ||
    !result.summary ||
    ![
      "candidate",
      "counterfactual",
      "exploratory",
    ].includes(
      result.temporaryPosture,
    ) ||
    result.sourceKeys.some(
      (key) =>
        !sourceKeys.has(key),
    )
  ) {
    fail(
      "world_manager_thought_brush_result_object_invalid",
    );
  }
  return result;
}

function normalizeInsight(
  value,
  sourceKeys,
) {
  exactKeys(
    value,
    [
      "insightKey",
      "conceptKey",
      "semanticIdentity",
      "purpose",
      "rationale",
      "sourceKeys",
      "branches",
      "edges",
    ],
    "candidateInsight",
  );
  const unorderedBranches =
    Array.isArray(value.branches)
      ? value.branches.map(
          (branch) => {
            exactKeys(
              branch,
              [
                "branchKey",
                "parentBranchKey",
                "branchKind",
                "modality",
                "statement",
                "condition",
                "expectedOutcome",
                "semanticState",
              ],
              "candidateInsight.branch",
            );
            return {
              branchKey: text(
                branch.branchKey,
                "",
              ),
              parentBranchKey:
                text(
                  branch
                    .parentBranchKey,
                  "",
                ),
              branchKind: text(
                branch.branchKind,
                "",
              ),
              modality: text(
                branch.modality,
                "",
              ),
              statement: bounded(
                branch.statement,
                "",
                1_200,
              ),
              condition: bounded(
                branch.condition,
                "",
                800,
              ),
              expectedOutcome:
                bounded(
                  branch
                    .expectedOutcome,
                  "",
                  800,
                ),
              semanticState: text(
                branch.semanticState,
                "",
              ),
            };
          },
        )
      : [];
  const branchesByKey = new Map(
    unorderedBranches.map(
      (branch) => [
        branch.branchKey,
        branch,
      ],
    ),
  );
  if (
    branchesByKey.size !==
      unorderedBranches.length ||
    branchesByKey.has("")
  ) {
    fail(
      "world_manager_thought_brush_candidate_insight_branch_key_invalid",
    );
  }
  const branches = [];
  const visiting = new Set();
  const visited = new Set();
  const visitBranch = (branch) => {
    if (
      visited.has(
        branch.branchKey,
      )
    ) {
      return;
    }
    if (
      visiting.has(
        branch.branchKey,
      )
    ) {
      fail(
        "world_manager_thought_brush_candidate_insight_cycle",
        branch.branchKey,
      );
    }
    visiting.add(
      branch.branchKey,
    );
    if (
      branch.parentBranchKey
    ) {
      const parent =
        branchesByKey.get(
          branch.parentBranchKey,
        );
      if (!parent) {
        fail(
          "world_manager_thought_brush_candidate_insight_parent_unknown",
          branch.parentBranchKey,
        );
      }
      visitBranch(parent);
    }
    visiting.delete(
      branch.branchKey,
    );
    visited.add(
      branch.branchKey,
    );
    branches.push(branch);
  };
  for (
    const branch
    of unorderedBranches
  ) {
    visitBranch(branch);
  }
  const edges =
    Array.isArray(value.edges)
      ? value.edges.map((edge) => {
          exactKeys(
            edge,
            [
              "fromBranchKey",
              "toBranchKey",
              "relationKind",
              "rationale",
            ],
            "candidateInsight.edge",
          );
          return {
            fromBranchKey: text(
              edge.fromBranchKey,
              "",
            ),
            toBranchKey: text(
              edge.toBranchKey,
              "",
            ),
            relationKind: text(
              edge.relationKind,
              "",
            ),
            rationale: bounded(
              edge.rationale,
              "",
              800,
            ),
          };
        })
      : [];
  const result = {
    insightKey: text(
      value.insightKey,
      "",
    ),
    conceptKey: text(
      value.conceptKey,
      "",
    ),
    semanticIdentity: bounded(
      value.semanticIdentity,
      "",
      300,
    ),
    purpose: bounded(
      value.purpose,
      "",
      1_200,
    ),
    rationale: bounded(
      value.rationale,
      "",
      1_600,
    ),
    sourceKeys:
      uniqueStrings(
        value.sourceKeys,
      ),
    branches,
    edges,
  };
  const branchKeys = new Set(
    branches.map(
      (branch) =>
        branch.branchKey,
    ),
  );
  if (
    !result.insightKey ||
    !result.conceptKey ||
    !result.semanticIdentity ||
    !result.purpose ||
    !branches.length ||
    branches.some(
      (branch) =>
        !branch.branchKey ||
        !branch.branchKind ||
        !branch.statement ||
        !ARO_MODALITIES.has(
          branch.modality,
        ) ||
        !ARO_STATES.has(
          branch.semanticState,
        ) ||
        (
          branch.parentBranchKey &&
          !branchKeys.has(
            branch.parentBranchKey,
          )
        ),
    ) ||
    edges.some(
      (edge) =>
        !branchKeys.has(
          edge.fromBranchKey,
        ) ||
        !branchKeys.has(
          edge.toBranchKey,
        ) ||
        !ARO_EDGE_RELATIONS.has(
          edge.relationKind,
        ),
    ) ||
    result.sourceKeys.some(
      (key) =>
        !sourceKeys.has(key),
    )
  ) {
    fail(
      "world_manager_thought_brush_candidate_insight_invalid",
    );
  }
  return result;
}

function normalizeThoughtBrushResult(
  value,
  request,
) {
  exactKeys(
    value,
    [
      "summary",
      "altitude",
      "selectedAnchorKeys",
      "selectedContextKeys",
      "preservedSourceKeys",
      "resultObjects",
      "candidateInsights",
      "omissions",
    ],
    "thoughtBrushResult",
  );
  const sourceKeys = new Set(
    request.sourceCatalog.map(
      (source) => source.key,
    ),
  );
  const resultObjects =
    Array.isArray(value.resultObjects)
      ? value.resultObjects.map(
          (entry) =>
            normalizeResultObject(
              entry,
              sourceKeys,
            ),
        )
      : [];
  const candidateInsights =
    Array.isArray(
      value.candidateInsights,
    )
      ? value.candidateInsights.map(
          (entry) =>
            normalizeInsight(
              entry,
              sourceKeys,
            ),
        )
      : [];
  const result = {
    schema:
      THOUGHT_BRUSH_RESULT_SCHEMA,
    brushStrokeId:
      request.brushStrokeId,
    projectId:
      request.projectId,
    targetProjectId:
      request.targetProjectId,
    brush: request.brush,
    summary: bounded(
      value.summary,
      "",
      2_400,
    ),
    altitude: bounded(
      value.altitude,
      request.altitude,
      160,
    ),
    selectedAnchorKeys:
      uniqueStrings(
        value.selectedAnchorKeys,
      ),
    selectedContextKeys:
      uniqueStrings(
        value.selectedContextKeys,
      ),
    preservedSourceKeys:
      uniqueStrings(
        value.preservedSourceKeys,
      ),
    resultObjects,
    candidateInsights,
    omissions:
      uniqueStrings(
        value.omissions,
      ).map((entry) =>
        bounded(
          entry,
          "",
          1_000,
        )),
    persistencePosture:
      "temporary_canvas",
    worldEffect: "none",
    grantsAuthority: false,
  };
  const selectedKeys = [
    ...result.selectedAnchorKeys,
    ...result.selectedContextKeys,
    ...result.preservedSourceKeys,
  ];
  if (
    !result.summary ||
    selectedKeys.some(
      (key) =>
        !sourceKeys.has(key),
    ) ||
    request
      .requiredPreservationKeys
      .some((key) =>
        !result
          .preservedSourceKeys
          .includes(key)) ||
    result.resultObjects.length >
      request.attentionBudget
        .maxResultObjects
  ) {
    fail(
      "world_manager_thought_brush_result_invalid",
    );
  }
  if (request.brush === "switch") {
    const selected = new Set([
      ...result.selectedAnchorKeys,
      ...result.selectedContextKeys,
    ]);
    const illegal = request
      .sourceCatalog
      .filter((source) =>
        selected.has(source.key) &&
        !source.pinned &&
        source.projectId &&
        source.projectId !==
          request.targetProjectId);
    if (illegal.length) {
      fail(
        "world_manager_thought_brush_switch_append_forbidden",
      );
    }
  }
  result.digest = digestFor(
    THOUGHT_BRUSH_RESULT_SCHEMA,
    result,
    ["digest"],
  );
  validateThoughtBrushResult(
    result,
  );
  return result;
}

function validateThoughtBrushResult(
  value,
) {
  if (
    !isPlainObject(value) ||
    value.schema !==
      THOUGHT_BRUSH_RESULT_SCHEMA ||
    !text(value.brushStrokeId, "") ||
    !text(value.projectId, "") ||
    !BRUSH_KEYS.has(value.brush) ||
    !text(value.summary, "") ||
    !text(value.altitude, "") ||
    !Array.isArray(
      value.selectedAnchorKeys,
    ) ||
    !Array.isArray(
      value.selectedContextKeys,
    ) ||
    !Array.isArray(
      value.preservedSourceKeys,
    ) ||
    !Array.isArray(
      value.resultObjects,
    ) ||
    !Array.isArray(
      value.candidateInsights,
    ) ||
    !Array.isArray(value.omissions) ||
    value.persistencePosture !==
      "temporary_canvas" ||
    value.worldEffect !== "none" ||
    value.grantsAuthority !== false ||
    value.digest !==
      digestFor(
        THOUGHT_BRUSH_RESULT_SCHEMA,
        value,
        ["digest"],
      )
  ) {
    fail(
      "world_manager_thought_brush_result_invalid",
    );
  }
  return true;
}

function validateThoughtBrushAction(
  runnerResult,
  request,
) {
  const calls =
    normalizeToolCalls(
      runnerResult,
    );
  const matching = calls.filter(
    (call) =>
      call.name ===
        THOUGHT_BRUSH_ACTION,
  );
  const errors = [];
  let result = null;
  if (
    calls.length !== 1 ||
    matching.length !== 1
  ) {
    errors.push({
      code:
        "world_manager_thought_brush_action_count_invalid",
      detail:
        `Expected exactly one ${THOUGHT_BRUSH_ACTION} action and received ${calls.length}.`,
    });
  } else {
    const parsed =
      parseArguments(
        matching[0].arguments,
      );
    if (!parsed) {
      errors.push({
        code:
          "world_manager_thought_brush_arguments_invalid",
        detail:
          "The thought-brush action arguments were not a JSON object.",
      });
    } else {
      try {
        result =
          normalizeThoughtBrushResult(
            parsed,
            request,
          );
      } catch (error) {
        errors.push({
          code: text(
            error?.code,
            "world_manager_thought_brush_result_invalid",
          ),
          detail: bounded(
            error?.message,
            "The thought-brush result failed validation.",
            600,
          ),
        });
      }
    }
  }
  const validation = {
    schema:
      THOUGHT_BRUSH_VALIDATION_SCHEMA,
    brushStrokeId:
      request.brushStrokeId,
    state:
      errors.length
        ? "remanded"
        : "validated",
    actionCount: calls.length,
    matchingActionCount:
      matching.length,
    exactSourceBinding:
      errors.length === 0,
    preservationSatisfied:
      errors.length === 0,
    switchReplacementSatisfied:
      errors.length === 0,
    errors,
    worldEffect: "none",
    grantsAuthority: false,
  };
  validation.digest = digestFor(
    THOUGHT_BRUSH_VALIDATION_SCHEMA,
    validation,
    ["digest"],
  );
  return {
    validation,
    result,
  };
}

function normalizeTelemetry(
  value = {},
  terminalState,
) {
  return {
    terminalState,
    runtimeMode: text(
      value.runtimeMode ||
        value.runtime_mode,
      "direct",
    ),
    model: text(
      value.model,
      "",
    ),
    toolCallCount:
      Number(
        value.toolCallCount ||
          value.tool_call_count ||
          1,
      ),
    durationMs:
      Number(
        value.durationMs ||
          value.duration_ms ||
          0,
      ),
    rawProviderPayloadStored:
      false,
    rawChainOfThoughtStored: false,
  };
}

function buildThoughtBrushStroke(
  input = {},
) {
  const request = input.request;
  validateThoughtBrushRequest(
    request,
  );
  const state = text(
    input.state,
    "",
  );
  if (!STROKE_STATES.has(state)) {
    fail(
      "world_manager_thought_brush_stroke_state_invalid",
    );
  }
  if (input.result) {
    validateThoughtBrushResult(
      input.result,
    );
  }
  const stroke = {
    schema:
      THOUGHT_BRUSH_STROKE_SCHEMA,
    brushStrokeId:
      request.brushStrokeId,
    projectId:
      request.projectId,
    targetProjectId:
      request.targetProjectId,
    brush: request.brush,
    request,
    state,
    result: input.result || null,
    validation:
      input.validation || null,
    telemetry:
      input.telemetry || null,
    error: input.error || null,
    persistencePosture:
      "temporary_canvas",
    worldEffect: "none",
    toolExecutionEffect: false,
    workspaceMutationEffect: false,
    canonicalAdmissionEffect:
      false,
    grantsAuthority: false,
    createdAt: text(
      input.createdAt,
      nowIso(input.now),
    ),
  };
  stroke.digest = digestFor(
    THOUGHT_BRUSH_STROKE_SCHEMA,
    stroke,
    ["digest"],
  );
  validateThoughtBrushStroke(
    stroke,
  );
  return stroke;
}

function validateThoughtBrushStroke(
  value,
) {
  if (
    !isPlainObject(value) ||
    value.schema !==
      THOUGHT_BRUSH_STROKE_SCHEMA ||
    !text(value.brushStrokeId, "") ||
    !text(value.projectId, "") ||
    !BRUSH_KEYS.has(value.brush) ||
    !STROKE_STATES.has(
      value.state,
    ) ||
    value.persistencePosture !==
      "temporary_canvas" ||
    value.worldEffect !== "none" ||
    value.toolExecutionEffect !==
      false ||
    value.workspaceMutationEffect !==
      false ||
    value.canonicalAdmissionEffect !==
      false ||
    value.grantsAuthority !== false ||
    value.digest !==
      digestFor(
        THOUGHT_BRUSH_STROKE_SCHEMA,
        value,
        ["digest"],
      )
  ) {
    fail(
      "world_manager_thought_brush_stroke_invalid",
    );
  }
  validateThoughtBrushRequest(
    value.request,
  );
  if (
    value.state === "completed"
  ) {
    validateThoughtBrushResult(
      value.result,
    );
  }
  return true;
}

function contextCanvasRef(canvas) {
  validateContextCanvas(canvas);
  return exactRef({
    kind: "context_canvas",
    id: canvas.contextCanvasId,
    digest: canvas.digest,
    projectId:
      canvas.activeProjectId,
    label:
      `ContextCanvas revision ${canvas.revision}`,
  });
}

function thoughtBrushStrokeRef(
  stroke,
) {
  validateThoughtBrushStroke(
    stroke,
  );
  return exactRef({
    kind: "thought_brush_stroke",
    id: stroke.brushStrokeId,
    digest: stroke.digest,
    projectId: stroke.projectId,
    label:
      `${brushDefinition(stroke.brush).label} stroke`,
  });
}

function buildBaseContextCanvas(
  input = {},
) {
  const projectId = text(
    input.projectId,
    "",
  );
  if (!projectId) {
    fail(
      "world_manager_context_canvas_project_required",
    );
  }
  const canvas = {
    schema: CONTEXT_CANVAS_SCHEMA,
    contextCanvasId: text(
      input.contextCanvasId,
      stableId(
        "wm_context_canvas",
        {
          ownerId: text(
            input.ownerId,
            "operator",
          ),
          projectId,
        },
      ),
    ),
    ownerId: text(
      input.ownerId,
      "operator",
    ),
    projectId,
    activeProjectId: projectId,
    revision: 1,
    predecessorRef: null,
    restoredCanvasRef: null,
    operationKind: "initialize",
    operationRef: null,
    baseOperationalMetaContextRef:
      input
        .baseOperationalMetaContextRef
        ? exactRef(
            input
              .baseOperationalMetaContextRef,
            "canvas.baseOperationalMetaContextRef",
          )
        : null,
    brushStrokeRefs: [],
    activeAnchorRefs:
      uniqueRefs(
        input.activeAnchorRefs,
      ),
    importedContextBundleRefs:
      uniqueRefs(
        input
          .importedContextBundleRefs,
      ),
    altitude: bounded(
      input.altitude,
      "project",
      160,
    ),
    temporarySemanticObjects: [],
    candidateInsights: [],
    preservationRules: [],
    estimatedAttentionCost: {
      sourceObjectCount:
        Number(
          input
            .estimatedAttentionCost
            ?.sourceObjectCount ||
            0,
        ),
      resultObjectCount: 0,
      estimatedTokens:
        Number(
          input
            .estimatedAttentionCost
            ?.estimatedTokens ||
            0,
        ),
    },
    freshness: "fresh",
    persistencePosture:
      "temporary",
    worldEffect: "none",
    canonical: false,
    grantsAuthority: false,
    createdAt: text(
      input.createdAt,
      nowIso(input.now),
    ),
  };
  canvas.digest = digestFor(
    CONTEXT_CANVAS_SCHEMA,
    canvas,
    ["digest"],
  );
  validateContextCanvas(canvas);
  return canvas;
}

function sourceRefsForKeys(
  request,
  keys,
) {
  const wanted = new Set(keys);
  return uniqueRefs(
    request.sourceCatalog
      .filter((source) =>
        wanted.has(source.key))
      .map((source) =>
        source.ref),
  );
}

function temporaryObjectsFromResult(
  stroke,
) {
  return stroke.result.resultObjects.map(
    (result) => {
      const object = {
        schema:
          "direct_context_canvas_temporary_object@1",
        temporaryObjectId:
          stableId(
            "wm_context_canvas_object",
            {
              brushStrokeId:
                stroke.brushStrokeId,
              objectKey:
                result.objectKey,
            },
          ),
        objectKey:
          result.objectKey,
        objectKind:
          result.objectKind,
        label: result.label,
        summary: result.summary,
        sourceRefs:
          sourceRefsForKeys(
            stroke.request,
            result.sourceKeys,
          ),
        relationHints:
          result.relationHints,
        temporaryPosture:
          result
            .temporaryPosture,
        brushStrokeRef:
          thoughtBrushStrokeRef(
            stroke,
          ),
        canonical: false,
        worldEffect: "none",
        grantsAuthority: false,
      };
      object.digest = digestFor(
        object.schema,
        object,
        ["digest"],
      );
      return object;
    },
  );
}

function canvasInsightsFromResult(
  stroke,
) {
  return stroke
    .result.candidateInsights
    .map((insight) => {
      const candidate = {
        schema:
          "direct_context_canvas_candidate_insight@1",
        candidateInsightId:
          stableId(
            "wm_context_canvas_candidate_insight",
            {
              brushStrokeId:
                stroke.brushStrokeId,
              insightKey:
                insight.insightKey,
            },
          ),
        insightKey:
          insight.insightKey,
        conceptKey:
          insight.conceptKey,
        semanticIdentity:
          insight.semanticIdentity,
        purpose:
          insight.purpose,
        rationale:
          insight.rationale,
        sourceRefs:
          sourceRefsForKeys(
            stroke.request,
            insight.sourceKeys,
          ),
        branches:
          insight.branches,
        edges: insight.edges,
        brushStrokeRef:
          thoughtBrushStrokeRef(
            stroke,
          ),
        extractionState:
          "available",
        canonical: false,
        worldEffect: "none",
        grantsAuthority: false,
      };
      candidate.digest =
        digestFor(
          candidate.schema,
          candidate,
          ["digest"],
        );
      return candidate;
    });
}

function buildAppliedContextCanvas(
  current,
  stroke,
  input = {},
) {
  validateContextCanvas(current);
  validateThoughtBrushStroke(
    stroke,
  );
  if (
    stroke.state !== "completed" ||
    !stroke.result ||
    stroke.projectId !==
      current.activeProjectId
  ) {
    fail(
      "world_manager_context_canvas_stroke_invalid",
    );
  }
  const replacing =
    stroke.brush === "switch";
  const targetProjectId =
    replacing
      ? stroke.targetProjectId
      : current.activeProjectId;
  const selectedAnchorRefs =
    sourceRefsForKeys(
      stroke.request,
      stroke.result
        .selectedAnchorKeys,
    );
  const selectedContextRefs =
    sourceRefsForKeys(
      stroke.request,
      stroke.result
        .selectedContextKeys,
    );
  const pinnedRefs =
    sourceRefsForKeys(
      stroke.request,
      stroke.request.sourceCatalog
        .filter((source) =>
          source.pinned)
        .map((source) =>
          source.key),
    );
  const newObjects =
    temporaryObjectsFromResult(
      stroke,
    );
  const newInsights =
    canvasInsightsFromResult(
      stroke,
    );
  const canvas = {
    schema: CONTEXT_CANVAS_SCHEMA,
    contextCanvasId:
      current.contextCanvasId,
    ownerId: current.ownerId,
    projectId: current.projectId,
    activeProjectId:
      targetProjectId,
    revision:
      current.revision + 1,
    predecessorRef:
      contextCanvasRef(current),
    restoredCanvasRef: null,
    operationKind: "apply_brush",
    operationRef:
      thoughtBrushStrokeRef(
        stroke,
      ),
    baseOperationalMetaContextRef:
      input
        .baseOperationalMetaContextRef
        ? exactRef(
            input
              .baseOperationalMetaContextRef,
            "canvas.baseOperationalMetaContextRef",
          )
        : current
            .baseOperationalMetaContextRef,
    brushStrokeRefs:
      replacing
        ? [
            thoughtBrushStrokeRef(
              stroke,
            ),
          ]
        : uniqueRefs([
            ...current
              .brushStrokeRefs,
            thoughtBrushStrokeRef(
              stroke,
            ),
          ]),
    activeAnchorRefs:
      replacing
        ? uniqueRefs([
            ...pinnedRefs,
            ...selectedAnchorRefs,
          ])
        : uniqueRefs([
            ...current
              .activeAnchorRefs,
            ...selectedAnchorRefs,
          ]),
    importedContextBundleRefs:
      replacing
        ? selectedContextRefs
        : uniqueRefs([
            ...current
              .importedContextBundleRefs,
            ...selectedContextRefs,
          ]),
    altitude:
      stroke.result.altitude,
    temporarySemanticObjects:
      replacing
        ? newObjects
        : [
            ...current
              .temporarySemanticObjects,
            ...newObjects,
          ],
    candidateInsights:
      replacing
        ? newInsights
        : [
            ...current
              .candidateInsights,
            ...newInsights,
          ],
    preservationRules:
      uniqueStrings([
        ...(replacing
          ? []
          : current
              .preservationRules),
        ...stroke.request
          .preservationRules,
      ]),
    estimatedAttentionCost: {
      sourceObjectCount:
        (
          replacing
            ? selectedAnchorRefs
            : uniqueRefs([
                ...current
                  .activeAnchorRefs,
                ...selectedAnchorRefs,
              ])
        ).length +
        (
          replacing
            ? selectedContextRefs
            : uniqueRefs([
                ...current
                  .importedContextBundleRefs,
                ...selectedContextRefs,
              ])
        ).length,
      resultObjectCount:
        (
          replacing
            ? newObjects
            : [
                ...current
                  .temporarySemanticObjects,
                ...newObjects,
              ]
        ).length,
      estimatedTokens:
        Math.min(
          stroke.request
            .attentionBudget
            .maxInputTokens,
          Math.max(
            500,
            (
              stroke.request
                .sourceCatalog.length *
                160
            ) +
              (
                newObjects.length *
                220
              ),
          ),
        ),
    },
    freshness: text(
      input.freshness,
      "fresh",
    ),
    persistencePosture:
      "temporary",
    worldEffect: "none",
    canonical: false,
    grantsAuthority: false,
    createdAt: text(
      input.createdAt,
      nowIso(input.now),
    ),
  };
  canvas.digest = digestFor(
    CONTEXT_CANVAS_SCHEMA,
    canvas,
    ["digest"],
  );
  validateContextCanvas(canvas);
  return canvas;
}

function buildUndoContextCanvas(
  current,
  restored,
  input = {},
) {
  validateContextCanvas(current);
  validateContextCanvas(restored);
  if (
    current.contextCanvasId !==
      restored.contextCanvasId ||
    current.revision <= 1 ||
    restored.revision >=
      current.revision
  ) {
    fail(
      "world_manager_context_canvas_undo_target_invalid",
    );
  }
  const canvas = {
    ...restored,
    revision:
      current.revision + 1,
    predecessorRef:
      contextCanvasRef(current),
    restoredCanvasRef:
      contextCanvasRef(restored),
    operationKind: "undo",
    operationRef: null,
    createdAt: text(
      input.createdAt,
      nowIso(input.now),
    ),
    digest: undefined,
  };
  canvas.digest = digestFor(
    CONTEXT_CANVAS_SCHEMA,
    canvas,
    ["digest"],
  );
  validateContextCanvas(canvas);
  return canvas;
}

function validateContextCanvas(
  value,
) {
  if (
    !isPlainObject(value) ||
    value.schema !==
      CONTEXT_CANVAS_SCHEMA ||
    !text(
      value.contextCanvasId,
      "",
    ) ||
    !text(value.ownerId, "") ||
    !text(value.projectId, "") ||
    !text(
      value.activeProjectId,
      "",
    ) ||
    !Number.isInteger(
      Number(value.revision),
    ) ||
    Number(value.revision) < 1 ||
    ![
      "initialize",
      "apply_brush",
      "undo",
    ].includes(
      value.operationKind,
    ) ||
    !Array.isArray(
      value.brushStrokeRefs,
    ) ||
    !Array.isArray(
      value.activeAnchorRefs,
    ) ||
    !Array.isArray(
      value
        .importedContextBundleRefs,
    ) ||
    !text(value.altitude, "") ||
    !Array.isArray(
      value.temporarySemanticObjects,
    ) ||
    !Array.isArray(
      value.candidateInsights,
    ) ||
    !Array.isArray(
      value.preservationRules,
    ) ||
    !isPlainObject(
      value.estimatedAttentionCost,
    ) ||
    !CANVAS_FRESHNESS.has(
      value.freshness,
    ) ||
    value.persistencePosture !==
      "temporary" ||
    value.worldEffect !== "none" ||
    value.canonical !== false ||
    value.grantsAuthority !== false ||
    value.digest !==
      digestFor(
        CONTEXT_CANVAS_SCHEMA,
        value,
        ["digest"],
      )
  ) {
    fail(
      "world_manager_context_canvas_invalid",
    );
  }
  if (
    (
      Number(value.revision) === 1
    ) !==
      (
        !value.predecessorRef
      ) ||
    (
      value.operationKind ===
        "undo"
    ) !==
      Boolean(
        value.restoredCanvasRef,
      ) ||
    (
      value.operationKind ===
        "apply_brush"
    ) !==
      Boolean(value.operationRef)
  ) {
    fail(
      "world_manager_context_canvas_lineage_invalid",
    );
  }
  if (value.predecessorRef) {
    exactRef(
      value.predecessorRef,
      "canvas.predecessorRef",
    );
  }
  if (value.restoredCanvasRef) {
    exactRef(
      value.restoredCanvasRef,
      "canvas.restoredCanvasRef",
    );
  }
  if (value.operationRef) {
    exactRef(
      value.operationRef,
      "canvas.operationRef",
    );
  }
  if (
    value.baseOperationalMetaContextRef
  ) {
    exactRef(
      value
        .baseOperationalMetaContextRef,
      "canvas.baseOperationalMetaContextRef",
    );
  }
  [
    value.brushStrokeRefs,
    value.activeAnchorRefs,
    value
      .importedContextBundleRefs,
  ].forEach((refs) =>
    refs.forEach((ref, index) =>
      exactRef(
        ref,
        `canvas.refs.${index}`,
      )));
  return true;
}

function buildThoughtBrushAroCandidate(
  input = {},
) {
  const canvas = input.canvas;
  validateContextCanvas(canvas);
  const insightId = text(
    input.candidateInsightId,
    "",
  );
  const insight =
    canvas.candidateInsights.find(
      (entry) =>
        entry
          .candidateInsightId ===
          insightId,
    );
  if (!insight) {
    fail(
      "world_manager_context_canvas_insight_unknown",
      insightId,
    );
  }
  const canvasRef =
    contextCanvasRef(canvas);
  const candidate =
    buildAroReconstructionCandidate({
      candidateId: stableId(
        "wm_aro_thought_brush_candidate",
        {
          canvasRef,
          candidateInsightId:
            insightId,
        },
      ),
      projectId:
        canvas.activeProjectId,
      repositorySnapshotRef:
        canvasRef,
      evidenceRefs: [
        canvasRef,
        insight.brushStrokeRef,
        ...insight.sourceRefs,
      ],
      contradictionRefs: [],
      reconstructionMethod:
        "thought_brush_candidate_insight",
      createdAt: input.createdAt,
      now: input.now,
      candidateAro: {
        projectId:
          canvas.activeProjectId,
        conceptKey:
          insight.conceptKey,
        semanticIdentity:
          insight.semanticIdentity,
        purpose: insight.purpose,
        posture: "current",
        branches:
          insight.branches.map(
            (branch) => ({
              ...branch,
              provenanceRefs: [
                canvasRef,
                insight
                  .brushStrokeRef,
                ...insight
                  .sourceRefs,
              ],
            }),
          ),
        edges: insight.edges,
        realizationBindings: [],
        provenanceRefs: [
          canvasRef,
          insight.brushStrokeRef,
          ...insight.sourceRefs,
        ],
      },
    });
  validateAroReconstructionCandidate(
    candidate,
  );
  return candidate;
}

class DirectThoughtBrushRuntime {
  constructor(options = {}) {
    this.runner =
      typeof options.runner === "function"
        ? options.runner
        : null;
    this.now =
      typeof options.now === "function"
        ? options.now
        : Date.now;
  }

  available() {
    return Boolean(this.runner);
  }

  async run(input = {}) {
    const request =
      input.request ||
      buildThoughtBrushRequest({
        ...input,
        now: this.now,
      });
    validateThoughtBrushRequest(
      request,
    );
    if (!this.runner) {
      fail(
        "world_manager_thought_brush_runner_unavailable",
      );
    }
    const outputContract =
      thoughtBrushOutputContract();
    let runnerResult;
    try {
      runnerResult =
        await this.runner({
          schema:
            "direct_thought_brush_runner_request@1",
          projectId:
            request.projectId,
          targetProjectId:
            request.targetProjectId,
          brushStrokeId:
            request.brushStrokeId,
          brush: request.brush,
          requiredPreservationKeys:
            request
              .requiredPreservationKeys,
          instructions:
            thoughtBrushInstructions(
              request,
            ),
          prompt:
            thoughtBrushPrompt(
              request,
            ),
          outputContract,
          tools:
            outputContract.tools,
          toolChoicePolicy: "required",
          reasoningEffort: text(
            input.reasoningEffort,
            "medium",
          ),
          persistencePosture:
            "temporary_canvas",
          worldEffect: "none",
          toolExecutionEffect: false,
          workspaceMutationEffect:
            false,
          canonicalAdmissionEffect:
            false,
          grantsAuthority: false,
        });
    } catch (error) {
      return buildThoughtBrushStroke({
        request,
        state: "failed",
        result: null,
        validation: null,
        telemetry:
          normalizeTelemetry(
            {},
            "failed",
          ),
        error: {
          code: text(
            error?.code,
            "world_manager_thought_brush_runner_failed",
          ),
          message: bounded(
            error?.message,
            "Direct thought-brush reasoning failed.",
            600,
          ),
        },
        now: this.now,
      });
    }
    const validated =
      validateThoughtBrushAction(
        runnerResult,
        request,
      );
    if (
      validated.validation.state !==
        "validated"
    ) {
      return buildThoughtBrushStroke({
        request,
        state: "remanded",
        result: null,
        validation:
          validated.validation,
        telemetry:
          normalizeTelemetry(
            runnerResult?.telemetry,
            "remanded",
          ),
        error: {
          code:
            validated.validation
              .errors[0]?.code ||
            "world_manager_thought_brush_remanded",
          message:
            validated.validation
              .errors[0]?.detail ||
            "The thought-brush action did not satisfy its semantic discharge form.",
        },
        now: this.now,
      });
    }
    return buildThoughtBrushStroke({
      request,
      state: "completed",
      result: validated.result,
      validation:
        validated.validation,
      telemetry:
        normalizeTelemetry(
          runnerResult?.telemetry,
          "completed",
        ),
      error: null,
      now: this.now,
    });
  }
}

module.exports = {
  CONTEXT_CANVAS_SCHEMA,
  CONTEXT_CANVAS_INSIGHT_EXTRACTION_REQUEST_SCHEMA,
  DirectThoughtBrushRuntime,
  THOUGHT_BRUSH_ACTION,
  THOUGHT_BRUSH_REGISTRY_SCHEMA,
  THOUGHT_BRUSH_REQUEST_SCHEMA,
  THOUGHT_BRUSH_RESULT_SCHEMA,
  THOUGHT_BRUSH_STROKE_SCHEMA,
  THOUGHT_BRUSH_VALIDATION_SCHEMA,
  buildAppliedContextCanvas,
  buildBaseContextCanvas,
  buildThoughtBrushAroCandidate,
  buildThoughtBrushRequest,
  buildThoughtBrushStroke,
  buildUndoContextCanvas,
  contextCanvasRef,
  thoughtBrushInstructions,
  thoughtBrushOutputContract,
  thoughtBrushPrompt,
  thoughtBrushRegistry,
  thoughtBrushStrokeRef,
  thoughtBrushTool,
  validateContextCanvas,
  validateContextCanvasInsightExtractionRequest,
  validateThoughtBrushRegistry,
  validateThoughtBrushRequest,
  validateThoughtBrushResult,
  validateThoughtBrushStroke,
};
