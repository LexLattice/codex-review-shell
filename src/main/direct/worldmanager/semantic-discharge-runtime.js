"use strict";

const {
  digestFor,
  stableId,
} = require("./control-plane");
const {
  SEMANTIC_ROUTER_META_ROLE_ID,
  createDefaultConstitutionalMetaRoleRegistry,
  validateConstitutionalMetaRoleInvocation,
  validateConstitutionalMetaRoleMember,
} = require("./constitutional-meta-role");

const LEGACY_SEMANTIC_SETTLEMENT_SCHEMA =
  "direct_world_manager_semantic_settlement@1";
const LEGACY_SEMANTIC_INGRESS_RUN_SCHEMA =
  "direct_world_manager_semantic_ingress_run@1";
const SEMANTIC_DISCHARGE_SCHEMA =
  "direct_world_manager_semantic_discharge@1";
const SEMANTIC_SETTLEMENT_SCHEMA =
  "direct_world_manager_semantic_settlement@2";
const SEMANTIC_INGRESS_RUN_SCHEMA =
  "direct_world_manager_semantic_ingress_run@2";
const SEMANTIC_INGRESS_VALIDATION_SCHEMA =
  "direct_world_manager_semantic_discharge_validation@1";
const SEMANTIC_INGRESS_REQUEST_MANIFEST_SCHEMA =
  "direct_world_manager_semantic_discharge_request_manifest@1";
const SEMANTIC_ACTION_CONTRACT_SCHEMA =
  "direct_world_manager_semantic_action_contract@1";

const ACTION_NAMES = Object.freeze({
  WORLD_CONVERSATION: "wm_discharge_world_conversation",
  WORLD_INTROSPECTION: "wm_discharge_world_introspection",
  PROJECT_ECOLOGY:
    "wm_discharge_project_ecology_concern",
  DECISION_CONCERN:
    "wm_discharge_decision_concern",
  PROJECT_CONCERN: "wm_discharge_project_concern",
  PROJECT_GENESIS: "wm_discharge_project_genesis",
  CLARIFICATION: "wm_discharge_clarification",
  SPLIT: "wm_discharge_split",
});

const TYPE_EXPRESSION_MODES = new Set([
  "existing_ref",
  "proposed_type",
  "composite",
  "freeform",
  "unresolved",
]);

const PROJECT_OPERATIONAL_ADAPTERS = new Set([
  "project_discussion",
  "project_planning",
  "policy_discussion",
  "implementation_request",
  "project_review",
]);
const PROJECT_ECOLOGY_OPERATIONAL_ADAPTERS = new Set([
  "project_ecology_status",
  "cross_project_comparison",
  "portfolio_planning",
]);

const DECISION_DISPOSITIONS = new Set([
  "deliberate",
  "inspect_evidence",
  "request_authority",
  "authorize_exact_target",
]);

const TASK_PHASES = Object.freeze({
  world_conversation: "conversation",
  project_ecology_status: "review",
  cross_project_comparison: "review",
  portfolio_planning: "planning",
  semantic_decision_deliberation: "deliberation",
  project_initialization: "project_genesis",
  policy_discussion: "governance",
  project_planning: "planning",
  implementation_request: "implementation",
  project_review: "review",
  project_discussion: "discussion",
  semantic_settlement_unavailable: "semantic_ingress",
});

function fail(code, detail = "") {
  const error = new Error(detail ? `${code}:${detail}` : code);
  error.code = code;
  if (detail) error.detail = detail;
  throw error;
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : fallback;
}

function required(value, label) {
  const result = normalizeString(value, "");
  if (!result) fail("world_manager_semantic_discharge_missing_string", label);
  return result;
}

function nowIso(now = Date.now) {
  const value = typeof now === "function" ? now() : now;
  return new Date(Number(value) || Date.now()).toISOString();
}

function ref(kind, id, digest) {
  return {
    kind: required(kind, "ref.kind"),
    id: required(id, "ref.id"),
    digest: required(digest, "ref.digest"),
  };
}

function normalizeExactTargetRef(value, label = "targetArtifactRef") {
  if (!isPlainObject(value)) {
    fail("world_manager_semantic_discharge_exact_ref_required", label);
  }
  exactKeys(value, ["kind", "id", "digest", "projectId"], label);
  return {
    kind: required(value.kind, `${label}.kind`),
    id: required(value.id, `${label}.id`),
    digest: required(value.digest, `${label}.digest`),
    projectId: normalizeString(value.projectId, ""),
  };
}

function exactTargetRefMatches(left = {}, right = {}) {
  return (
    normalizeString(left.kind, "") === normalizeString(right.kind, "") &&
    normalizeString(left.id, "") === normalizeString(right.id, "") &&
    normalizeString(left.digest, "") === normalizeString(right.digest, "") &&
    normalizeString(left.projectId, "") ===
      normalizeString(right.projectId, "")
  );
}

function normalizeStringList(value) {
  return (Array.isArray(value) ? value : [])
    .map((entry) => normalizeString(entry, ""))
    .filter(Boolean);
}

function sortedUnique(value) {
  return [...new Set(normalizeStringList(value))]
    .sort((left, right) => left.localeCompare(right));
}

function exactKeys(value, expected, label) {
  if (!isPlainObject(value)) {
    fail("world_manager_semantic_discharge_object_required", label);
  }
  const actual = Object.keys(value).sort();
  const requiredKeys = [...expected].sort();
  if (
    actual.length !== requiredKeys.length ||
    actual.some((key, index) => key !== requiredKeys[index])
  ) {
    fail(
      "world_manager_semantic_discharge_form_mismatch",
      `${label}:${actual.join(",")}`,
    );
  }
}

function parseExactObject(value, label) {
  if (isPlainObject(value)) return value;
  const source = normalizeString(value, "");
  if (!source) {
    fail("world_manager_semantic_discharge_arguments_missing", label);
  }
  try {
    const parsed = JSON.parse(source);
    if (!isPlainObject(parsed)) throw new Error("not_object");
    return parsed;
  } catch {
    fail("world_manager_semantic_discharge_arguments_invalid", label);
  }
}

function semanticTypeExpressionJsonSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      mode: {
        type: "string",
        enum: [...TYPE_EXPRESSION_MODES],
      },
      existingTypeRef: { type: "string" },
      proposedLabel: { type: "string" },
      parentTypeRef: { type: "string" },
      differentia: { type: "string" },
      components: {
        type: "array",
        items: { type: "string" },
      },
      freeformCharacterization: { type: "string" },
    },
    required: [
      "mode",
      "existingTypeRef",
      "proposedLabel",
      "parentTypeRef",
      "differentia",
      "components",
      "freeformCharacterization",
    ],
  };
}

const TYPE_EXPRESSION_KEYS = Object.freeze([
  "mode",
  "existingTypeRef",
  "proposedLabel",
  "parentTypeRef",
  "differentia",
  "components",
  "freeformCharacterization",
]);

function normalizeSemanticTypeExpression(value, label) {
  exactKeys(value, TYPE_EXPRESSION_KEYS, label);
  const result = {
    mode: required(value.mode, `${label}.mode`),
    existingTypeRef: normalizeString(value.existingTypeRef, ""),
    proposedLabel: normalizeString(value.proposedLabel, ""),
    parentTypeRef: normalizeString(value.parentTypeRef, ""),
    differentia: normalizeString(value.differentia, ""),
    components: normalizeStringList(value.components),
    freeformCharacterization: normalizeString(
      value.freeformCharacterization,
      "",
    ),
  };
  if (!TYPE_EXPRESSION_MODES.has(result.mode)) {
    fail(
      "world_manager_semantic_discharge_type_expression_mode_invalid",
      `${label}:${result.mode}`,
    );
  }
  if (result.mode === "existing_ref" && !result.existingTypeRef) {
    fail(
      "world_manager_semantic_discharge_existing_type_ref_required",
      label,
    );
  }
  if (
    result.mode === "proposed_type" &&
    (!result.proposedLabel || !result.differentia)
  ) {
    fail(
      "world_manager_semantic_discharge_proposed_type_incomplete",
      label,
    );
  }
  if (result.mode === "composite" && !result.components.length) {
    fail(
      "world_manager_semantic_discharge_composite_components_required",
      label,
    );
  }
  if (
    ["freeform", "unresolved"].includes(result.mode) &&
    !result.freeformCharacterization
  ) {
    fail(
      "world_manager_semantic_discharge_characterization_required",
      label,
    );
  }
  return result;
}

function typeExpressionArray(value, label) {
  if (!Array.isArray(value)) {
    fail("world_manager_semantic_discharge_array_required", label);
  }
  return value.map((entry, index) =>
    normalizeSemanticTypeExpression(entry, `${label}[${index}]`));
}

function functionTool(name, description, properties, requiredFields) {
  return {
    type: "function",
    name,
    description,
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties,
      required: requiredFields,
    },
  };
}

function semanticDischargeTools() {
  const typeExpression = semanticTypeExpressionJsonSchema();
  const typeExpressionArraySchema = {
    type: "array",
    items: typeExpression,
  };
  return [
    functionTool(
      ACTION_NAMES.WORLD_CONVERSATION,
      "Discharge an ordinary world-scoped conversational act that is not constituted as project work. This selects the conversation meta-contract; it does not formulate the user-facing answer.",
      {
        conversationKind: typeExpression,
        responseIntent: { type: "string" },
        contextNeeds: typeExpressionArraySchema,
        rationaleSummary: { type: "string" },
      },
      [
        "conversationKind",
        "responseIntent",
        "contextNeeds",
        "rationaleSummary",
      ],
    ),
    functionTool(
      ACTION_NAMES.WORLD_INTROSPECTION,
      "Discharge a question about the system, its prior interpretation, governance, provenance, constitution, or operation. This selects the introspection meta-contract; it does not formulate the user-facing answer.",
      {
        introspectionSubject: typeExpression,
        questionObjective: { type: "string" },
        evidenceNeeds: typeExpressionArraySchema,
        rationaleSummary: { type: "string" },
      },
      [
        "introspectionSubject",
        "questionObjective",
        "evidenceNeeds",
        "rationaleSummary",
      ],
    ),
    functionTool(
      ACTION_NAMES.PROJECT_ECOLOGY,
      "Discharge a world-governed concern whose subjects are multiple existing projects or the project ecology as a whole. This is the portfolio/cross-project meta-contract, not ordinary world conversation and not a concern belonging to one project.",
      {
        concernType: typeExpression,
        objective: { type: "string" },
        operationalAdapter: {
          type: "string",
          enum: [
            ...PROJECT_ECOLOGY_OPERATIONAL_ADAPTERS,
          ],
        },
        selectionMode: {
          type: "string",
          enum: ["all_projects", "explicit_projects"],
        },
        projectIds: {
          type: "array",
          items: { type: "string" },
        },
        evidenceNeeds: typeExpressionArraySchema,
        rationaleSummary: { type: "string" },
      },
      [
        "concernType",
        "objective",
        "operationalAdapter",
        "selectionMode",
        "projectIds",
        "evidenceNeeds",
        "rationaleSummary",
      ],
    ),
    functionTool(
      ACTION_NAMES.DECISION_CONCERN,
      "Discharge a user contribution explicitly bound to one supplied pending semantic decision. Preserve the exact decision identity, governed target, and resolution mode. Select the semantic disposition of the authenticated user act. The model neither grants authority nor performs the disposition; trusted harness code decides whether an explicitly offered disposition is executable.",
      {
        decisionId: { type: "string" },
        targetArtifactRef: {
          type: "object",
          additionalProperties: false,
          properties: {
            kind: { type: "string" },
            id: { type: "string" },
            digest: { type: "string" },
            projectId: { type: "string" },
          },
          required: ["kind", "id", "digest", "projectId"],
        },
        resolutionMode: {
          type: "string",
          enum: [
            "semantic_relay",
            "evidence_request",
            "authority_request",
          ],
        },
        disposition: {
          type: "string",
          enum: [...DECISION_DISPOSITIONS],
        },
        concernType: typeExpression,
        objective: { type: "string" },
        requestedActions:
          typeExpressionArraySchema,
        anticipatedEffects:
          typeExpressionArraySchema,
        ambiguities: {
          type: "array",
          items: { type: "string" },
        },
        rationaleSummary: { type: "string" },
      },
      [
        "decisionId",
        "targetArtifactRef",
        "resolutionMode",
        "disposition",
        "concernType",
        "objective",
        "requestedActions",
        "anticipatedEffects",
        "ambiguities",
        "rationaleSummary",
      ],
    ),
    functionTool(
      ACTION_NAMES.PROJECT_CONCERN,
      "Discharge a concern belonging to one existing project. Select the finite operational adapter needed by the current execution pipeline while expressing the concern's semantic type and subtype openly.",
      {
        projectId: { type: "string" },
        concernType: typeExpression,
        concernSubtype: typeExpression,
        objective: { type: "string" },
        operationalAdapter: {
          type: "string",
          enum: [...PROJECT_OPERATIONAL_ADAPTERS],
        },
        requestedActions: typeExpressionArraySchema,
        anticipatedEffects: typeExpressionArraySchema,
        ambiguities: {
          type: "array",
          items: { type: "string" },
        },
        rationaleSummary: { type: "string" },
      },
      [
        "projectId",
        "concernType",
        "concernSubtype",
        "objective",
        "operationalAdapter",
        "requestedActions",
        "anticipatedEffects",
        "ambiguities",
        "rationaleSummary",
      ],
    ),
    functionTool(
      ACTION_NAMES.PROJECT_GENESIS,
      "Discharge an idea that can seed a durable new project or project constitution. Express the seed and constitution dimensions openly; do not invent a closed project category.",
      {
        seedType: typeExpression,
        objective: { type: "string" },
        constitutionDimensions: typeExpressionArraySchema,
        ambiguities: {
          type: "array",
          items: { type: "string" },
        },
        rationaleSummary: { type: "string" },
      },
      [
        "seedType",
        "objective",
        "constitutionDimensions",
        "ambiguities",
        "rationaleSummary",
      ],
    ),
    functionTool(
      ACTION_NAMES.CLARIFICATION,
      "Discharge material ambiguity that prevents responsible routing. State the provisional semantic contract and unresolved dimensions, then provide the natural clarification question that the system should ask.",
      {
        provisionalContract: typeExpression,
        unresolvedDimensions: typeExpressionArraySchema,
        clarificationObjective: { type: "string" },
        clarificationPrompt: { type: "string" },
        rationaleSummary: { type: "string" },
      },
      [
        "provisionalContract",
        "unresolvedDimensions",
        "clarificationObjective",
        "clarificationPrompt",
        "rationaleSummary",
      ],
    ),
    functionTool(
      ACTION_NAMES.SPLIT,
      "Discharge an utterance containing multiple independently actionable semantic contracts that should become child events. Describe the child contracts openly.",
      {
        childContracts: {
          type: "array",
          minItems: 2,
          items: typeExpression,
        },
        coordinationObjective: { type: "string" },
        rationaleSummary: { type: "string" },
      },
      [
        "childContracts",
        "coordinationObjective",
        "rationaleSummary",
      ],
    ),
  ];
}

function semanticIngressInstructions(options = {}) {
  const metaRoleInvocation = options.metaRoleInvocation || null;
  if (metaRoleInvocation) {
    validateConstitutionalMetaRoleInvocation(metaRoleInvocation);
  }
  const instructions = [
    ...(metaRoleInvocation
      ? [
          `You are executing the harness-owned constitutional meta-role ${metaRoleInvocation.metaRoleId}.`,
          "This invocation is not a user task role, visible speaker, project worker, or ordinary model-selected agent.",
          "Your only standing is the compiled capability and authority envelope supplied for this invocation.",
        ]
      : []),
    "You are the constitutional semantic ingress of one unified WorldManager communications plane.",
    "Interpret the current utterance by meaning, discourse, referents, intended scope, and intended effects.",
    "Select exactly one provided wm_discharge_* action. The action name selects the applicable top-level semantic meta-contract.",
    "Discharge every semantic dimension required by that action's contract.",
    "The action arguments describe semantic actions and bindings. They are not the user-facing answer. A downstream role will formulate the natural response.",
    "Semantic content is open: use an existing_ref only when you can name a stable semantic type reference; use proposed_type for a newly distinguished type; composite for multiple types; freeform for an adequate characterization that does not need promotion; unresolved for a distinction requiring clarification.",
    "Do not force an unfamiliar meaning into a known label merely to satisfy a taxonomy.",
    "Ordinary social, playful, relational, or general conversation remains world conversation even when a project is visually focused.",
    "Questions about why the system interpreted, routed, admitted, prohibited, or executed something are world introspection unless the user explicitly asks a project role to alter project work.",
    "Use project ecology when the subject is multiple existing projects, all projects, portfolio status, cross-project comparison, or portfolio planning. Project ecology remains governed at user-world scope while admitting bounded evidence about its project subjects.",
    "Use decision concern only when the contribution can be bound to exactly one supplied pending decision. A region scopeBinding is an exact binding witness; otherwise semantic reference may select one supplied decision by its exact identity and governed target.",
    "For decision concern, copy the exact decisionId, targetArtifactRef, and resolutionMode from the supplied decision. Select deliberate, inspect_evidence, or request_authority for non-effecting contributions.",
    "Select authorize_exact_target only when the authenticated user is presently and unambiguously authorizing that exact governed target and the supplied decision explicitly lists authorize_exact_target as executable. A generic affirmation with multiple or unresolved possible targets is clarification, never authorization.",
    "authorize_exact_target is only a semantic disposition. The model does not admit state or grant authority; trusted harness code revalidates the exact target and invokes the governing admission protocol.",
    "Use project concern only for a settled existing-project assignment and copy its exact projectId from the supplied project index.",
    "A credible durable-project seed may enter project genesis even without creation vocabulary. Negated, hypothetical, or merely illustrative project language is not itself a genesis request.",
    "Use clarification only for material ambiguity that prevents a responsible contract selection. Do not treat novelty as invalidity.",
    "Use split only when independently actionable meanings truly require separate child contracts.",
    "No discharge grants authority or creates canonical, workspace, remote, or external effects.",
    "Call exactly one action. Do not emit a prose answer or a JSON answer.",
  ];
  if (options.semanticChildMode === true) {
    instructions.splice(
      instructions.length - 2,
      0,
      "The current input is one already-materialized semantic child contract. Discharge only that child; recursive split is unavailable at this boundary.",
    );
  }
  return instructions.join("\n");
}

function semanticIngressPrompt(input = {}) {
  const request = input.request || {};
  const scopeHint = request.scopeHint || {};
  const projects = (Array.isArray(input.projects) ? input.projects : [])
    .map((project) => ({
      projectId: project.projectId || project.id,
      name: project.name,
      summary: project.summary,
      statusClass: project.statusClass,
      roleRuntimeAddressable:
        project.roleRuntimeAddressable === true,
    }));
  const prompt = [
    "[CURRENT WORLD - TYPED EVIDENCE]",
    JSON.stringify({
      userWorldId: input.userWorldId,
      projects,
      ambientFocusedProjectId: normalizeString(
        input.focusedProjectId,
        "",
      ),
      scopeBinding: {
        posture: normalizeString(
          scopeHint.bindingPosture,
          "ambient_focus",
        ),
        projectId: normalizeString(scopeHint.projectId, ""),
        proposalId: normalizeString(scopeHint.proposalId, ""),
        workThreadId: normalizeString(scopeHint.workThreadId, ""),
      },
      pendingDecisions: (Array.isArray(input.pendingDecisions)
        ? input.pendingDecisions
        : []).map((decision) => ({
          decisionRequestId: decision.decisionRequestId,
          semanticDecisionRef:
            decision.semanticDecisionRef || null,
          decisionKind: decision.decisionKind,
          targetArtifactRef: decision.targetArtifactRef,
          state: decision.state,
          semanticIdentity:
            decision.semanticIdentity || "",
          question: decision.question || "",
          resolutionMode:
            decision.resolutionMode || "",
          options: Array.isArray(decision.options)
            ? decision.options
            : [],
          executableDispositions:
            Array.isArray(
              decision.executableDispositions,
            )
              ? decision.executableDispositions
              : [],
          targetProjectStatusClass:
            decision.targetProjectStatusClass || "",
          targetProjectRoleRuntimeAddressable:
            decision
              .targetProjectRoleRuntimeAddressable ===
            true,
        })),
    }),
  ];
  if (input.semanticChildContract) {
    prompt.push(
      "[SEMANTIC CHILD CONTRACT - TYPED EVIDENCE]",
      JSON.stringify({
        childContractId:
          input.semanticChildContract.childContractId,
        parentEventRef:
          input.semanticChildContract.parentEventRef,
        childIndex:
          input.semanticChildContract.childIndex,
        semanticTypeExpression:
          input.semanticChildContract
            .semanticTypeExpression,
        coordinationObjective:
          input.semanticChildContract
            .coordinationObjective,
        recursiveSplitAvailable: false,
        grantsAuthority: false,
      }),
      "[BOUNDED SEMANTIC CHILD]",
    );
  } else {
    prompt.push("[CURRENT USER UTTERANCE]");
  }
  prompt.push(
    normalizeString(input.message?.text, ""),
  );
  return prompt.join("\n");
}

function semanticIngressOutputContract(options = {}) {
  const semanticChildMode =
    options.semanticChildMode === true;
  const metaRoleMember = options.metaRoleMember || null;
  const metaRoleInvocation = options.metaRoleInvocation || null;
  if (metaRoleMember) validateConstitutionalMetaRoleMember(metaRoleMember);
  if (metaRoleInvocation) {
    validateConstitutionalMetaRoleInvocation(metaRoleInvocation);
  }
  const tools = semanticDischargeTools().filter((tool) =>
    !semanticChildMode ||
    tool.name !== ACTION_NAMES.SPLIT);
  if (
    metaRoleMember &&
    tools.some((tool) =>
      !metaRoleMember.capabilityNames.includes(tool.name))
  ) {
    fail("world_manager_semantic_discharge_meta_role_capability_mismatch");
  }
  const contract = {
    schema: SEMANTIC_ACTION_CONTRACT_SCHEMA,
    outputContractId: semanticChildMode
      ? "world_manager.semantic_child_discharge@1"
      : "world_manager.semantic_discharge@1",
    selectionMechanism: "required_native_function_action",
    exactlyOneActionRequired: true,
    availableActionNames: tools.map((tool) => tool.name),
    semanticContentPosture: "open",
    newSemanticTypesPermitted: true,
    naturalLanguageAnswerConstrained: false,
    canonicalAdmissionEffect: false,
    grantsAuthority: false,
    ...(metaRoleMember
      ? {
          roleClassRef: metaRoleMember.roleClassRef,
          metaRoleMemberRef: {
            kind: "constitutional_meta_role_member",
            id: metaRoleMember.metaRoleId,
            digest: metaRoleMember.digest,
          },
          realizationPolicyRef:
            metaRoleMember.realizationPolicyRef,
        }
      : {}),
    ...(metaRoleInvocation
      ? {
          metaRoleInvocationRef: {
            kind: "constitutional_meta_role_invocation",
            id: metaRoleInvocation.metaRoleInvocationId,
            digest: metaRoleInvocation.digest,
          },
        }
      : {}),
    tools,
  };
  contract.digest = digestFor(
    SEMANTIC_ACTION_CONTRACT_SCHEMA,
    contract,
    ["digest"],
  );
  return contract;
}

function normalizeActionArguments(actionName, value) {
  const args = parseExactObject(value, actionName);
  switch (actionName) {
    case ACTION_NAMES.WORLD_CONVERSATION:
      exactKeys(args, [
        "conversationKind",
        "responseIntent",
        "contextNeeds",
        "rationaleSummary",
      ], actionName);
      return {
        conversationKind: normalizeSemanticTypeExpression(
          args.conversationKind,
          "conversationKind",
        ),
        responseIntent: required(
          args.responseIntent,
          "responseIntent",
        ),
        contextNeeds: typeExpressionArray(
          args.contextNeeds,
          "contextNeeds",
        ),
        rationaleSummary: required(
          args.rationaleSummary,
          "rationaleSummary",
        ),
      };
    case ACTION_NAMES.WORLD_INTROSPECTION:
      exactKeys(args, [
        "introspectionSubject",
        "questionObjective",
        "evidenceNeeds",
        "rationaleSummary",
      ], actionName);
      return {
        introspectionSubject: normalizeSemanticTypeExpression(
          args.introspectionSubject,
          "introspectionSubject",
        ),
        questionObjective: required(
          args.questionObjective,
          "questionObjective",
        ),
        evidenceNeeds: typeExpressionArray(
          args.evidenceNeeds,
          "evidenceNeeds",
        ),
        rationaleSummary: required(
          args.rationaleSummary,
          "rationaleSummary",
        ),
      };
    case ACTION_NAMES.PROJECT_ECOLOGY: {
      exactKeys(args, [
        "concernType",
        "objective",
        "operationalAdapter",
        "selectionMode",
        "projectIds",
        "evidenceNeeds",
        "rationaleSummary",
      ], actionName);
      const operationalAdapter = required(
        args.operationalAdapter,
        "operationalAdapter",
      );
      if (
        !PROJECT_ECOLOGY_OPERATIONAL_ADAPTERS.has(
          operationalAdapter,
        )
      ) {
        fail(
          "world_manager_semantic_discharge_project_ecology_adapter_invalid",
          operationalAdapter,
        );
      }
      const selectionMode = required(
        args.selectionMode,
        "selectionMode",
      );
      if (
        !["all_projects", "explicit_projects"].includes(
          selectionMode,
        )
      ) {
        fail(
          "world_manager_semantic_discharge_project_ecology_selection_invalid",
          selectionMode,
        );
      }
      return {
        concernType: normalizeSemanticTypeExpression(
          args.concernType,
          "concernType",
        ),
        objective: required(args.objective, "objective"),
        operationalAdapter,
        selectionMode,
        projectIds: sortedUnique(args.projectIds),
        evidenceNeeds: typeExpressionArray(
          args.evidenceNeeds,
          "evidenceNeeds",
        ),
        rationaleSummary: required(
          args.rationaleSummary,
          "rationaleSummary",
        ),
      };
    }
    case ACTION_NAMES.DECISION_CONCERN: {
      exactKeys(args, [
        "decisionId",
        "targetArtifactRef",
        "resolutionMode",
        "disposition",
        "concernType",
        "objective",
        "requestedActions",
        "anticipatedEffects",
        "ambiguities",
        "rationaleSummary",
      ], actionName);
      const resolutionMode = required(
        args.resolutionMode,
        "resolutionMode",
      );
      if (
        ![
          "semantic_relay",
          "evidence_request",
          "authority_request",
        ].includes(resolutionMode)
      ) {
        fail(
          "world_manager_semantic_discharge_decision_resolution_mode_invalid",
          resolutionMode,
        );
      }
      const disposition = required(
        args.disposition,
        "disposition",
      );
      if (!DECISION_DISPOSITIONS.has(disposition)) {
        fail(
          "world_manager_semantic_discharge_decision_disposition_invalid",
          disposition,
        );
      }
      return {
        decisionId: required(
          args.decisionId,
          "decisionId",
        ),
        targetArtifactRef: normalizeExactTargetRef(
          args.targetArtifactRef,
        ),
        resolutionMode,
        disposition,
        concernType:
          normalizeSemanticTypeExpression(
            args.concernType,
            "concernType",
          ),
        objective: required(
          args.objective,
          "objective",
        ),
        requestedActions: typeExpressionArray(
          args.requestedActions,
          "requestedActions",
        ),
        anticipatedEffects:
          typeExpressionArray(
            args.anticipatedEffects,
            "anticipatedEffects",
          ),
        ambiguities:
          normalizeStringList(args.ambiguities),
        rationaleSummary: required(
          args.rationaleSummary,
          "rationaleSummary",
        ),
      };
    }
    case ACTION_NAMES.PROJECT_CONCERN: {
      exactKeys(args, [
        "projectId",
        "concernType",
        "concernSubtype",
        "objective",
        "operationalAdapter",
        "requestedActions",
        "anticipatedEffects",
        "ambiguities",
        "rationaleSummary",
      ], actionName);
      const operationalAdapter = required(
        args.operationalAdapter,
        "operationalAdapter",
      );
      if (!PROJECT_OPERATIONAL_ADAPTERS.has(operationalAdapter)) {
        fail(
          "world_manager_semantic_discharge_operational_adapter_invalid",
          operationalAdapter,
        );
      }
      return {
        projectId: required(args.projectId, "projectId"),
        concernType: normalizeSemanticTypeExpression(
          args.concernType,
          "concernType",
        ),
        concernSubtype: normalizeSemanticTypeExpression(
          args.concernSubtype,
          "concernSubtype",
        ),
        objective: required(args.objective, "objective"),
        operationalAdapter,
        requestedActions: typeExpressionArray(
          args.requestedActions,
          "requestedActions",
        ),
        anticipatedEffects: typeExpressionArray(
          args.anticipatedEffects,
          "anticipatedEffects",
        ),
        ambiguities: normalizeStringList(args.ambiguities),
        rationaleSummary: required(
          args.rationaleSummary,
          "rationaleSummary",
        ),
      };
    }
    case ACTION_NAMES.PROJECT_GENESIS:
      exactKeys(args, [
        "seedType",
        "objective",
        "constitutionDimensions",
        "ambiguities",
        "rationaleSummary",
      ], actionName);
      return {
        seedType: normalizeSemanticTypeExpression(
          args.seedType,
          "seedType",
        ),
        objective: required(args.objective, "objective"),
        constitutionDimensions: typeExpressionArray(
          args.constitutionDimensions,
          "constitutionDimensions",
        ),
        ambiguities: normalizeStringList(args.ambiguities),
        rationaleSummary: required(
          args.rationaleSummary,
          "rationaleSummary",
        ),
      };
    case ACTION_NAMES.CLARIFICATION:
      exactKeys(args, [
        "provisionalContract",
        "unresolvedDimensions",
        "clarificationObjective",
        "clarificationPrompt",
        "rationaleSummary",
      ], actionName);
      return {
        provisionalContract: normalizeSemanticTypeExpression(
          args.provisionalContract,
          "provisionalContract",
        ),
        unresolvedDimensions: typeExpressionArray(
          args.unresolvedDimensions,
          "unresolvedDimensions",
        ),
        clarificationObjective: required(
          args.clarificationObjective,
          "clarificationObjective",
        ),
        clarificationPrompt: required(
          args.clarificationPrompt,
          "clarificationPrompt",
        ),
        rationaleSummary: required(
          args.rationaleSummary,
          "rationaleSummary",
        ),
      };
    case ACTION_NAMES.SPLIT: {
      exactKeys(args, [
        "childContracts",
        "coordinationObjective",
        "rationaleSummary",
      ], actionName);
      const childContracts = typeExpressionArray(
        args.childContracts,
        "childContracts",
      );
      if (childContracts.length < 2) {
        fail(
          "world_manager_semantic_discharge_split_children_required",
        );
      }
      return {
        childContracts,
        coordinationObjective: required(
          args.coordinationObjective,
          "coordinationObjective",
        ),
        rationaleSummary: required(
          args.rationaleSummary,
          "rationaleSummary",
        ),
      };
    }
    default:
      fail(
        "world_manager_semantic_discharge_action_unknown",
        actionName,
      );
  }
}

function typeExpressionLabel(value) {
  if (!isPlainObject(value)) return "";
  if (value.mode === "existing_ref") return value.existingTypeRef;
  if (value.mode === "proposed_type") return value.proposedLabel;
  if (value.mode === "composite") return value.components.join("+");
  return value.freeformCharacterization;
}

function collectTypeExpressions(value, path = "$", output = []) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      collectTypeExpressions(entry, `${path}[${index}]`, output));
    return output;
  }
  if (!isPlainObject(value)) return output;
  if (
    TYPE_EXPRESSION_MODES.has(value.mode) &&
    Object.keys(value).length === TYPE_EXPRESSION_KEYS.length
  ) {
    output.push({
      path,
      expression: value,
    });
    return output;
  }
  for (const [key, child] of Object.entries(value)) {
    collectTypeExpressions(child, `${path}.${key}`, output);
  }
  return output;
}

function configuredProjectIds(input = {}) {
  return new Set(
    (Array.isArray(input.projects) ? input.projects : [])
      .map((project) =>
        normalizeString(project.projectId || project.id, ""))
      .filter(Boolean),
  );
}

function exactPendingDecisionBinding(input = {}) {
  const proposalId = normalizeString(
    input.request?.scopeHint?.proposalId,
    "",
  );
  if (!proposalId) return null;
  return (
    Array.isArray(input.pendingDecisions)
      ? input.pendingDecisions
      : []
  ).find((decision) =>
    normalizeString(
      decision.decisionRequestId ||
        decision.targetArtifactRef?.id,
      "",
    ) === proposalId ||
    normalizeString(
      decision.targetArtifactRef?.id,
      "",
    ) === proposalId) || null;
}

function pendingDecisionForAction(args = {}, input = {}) {
  const decisions = Array.isArray(input.pendingDecisions)
    ? input.pendingDecisions
    : [];
  return decisions.find((decision) =>
    normalizeString(decision.decisionRequestId, "") ===
      normalizeString(args.decisionId, "")) || null;
}

function validateActionReferenceBoundaries(actionName, args, input = {}) {
  const availableProjectIds = configuredProjectIds(input);
  const regionDecisionBinding =
    exactPendingDecisionBinding(input);
  if (regionDecisionBinding && actionName !== ACTION_NAMES.DECISION_CONCERN) {
    fail(
      "world_manager_semantic_discharge_decision_binding_action_mismatch",
      actionName,
    );
  }
  if (actionName === ACTION_NAMES.DECISION_CONCERN) {
    const decisionBinding = pendingDecisionForAction(args, input);
    if (!decisionBinding) {
      fail(
        "world_manager_semantic_discharge_decision_binding_required",
        args.decisionId,
      );
    }
    if (
      regionDecisionBinding &&
      normalizeString(
        regionDecisionBinding.decisionRequestId,
        "",
      ) !== normalizeString(decisionBinding.decisionRequestId, "")
    ) {
      fail(
        "world_manager_semantic_discharge_decision_region_binding_mismatch",
        args.decisionId,
      );
    }
    const decisionId = normalizeString(
      decisionBinding.decisionRequestId ||
        decisionBinding.targetArtifactRef?.id,
      "",
    );
    if (
      args.decisionId !== decisionId ||
      args.resolutionMode !==
        decisionBinding.resolutionMode
    ) {
      fail(
        "world_manager_semantic_discharge_decision_binding_mismatch",
        args.decisionId,
      );
    }
    if (
      !exactTargetRefMatches(
        args.targetArtifactRef,
        decisionBinding.targetArtifactRef,
      )
    ) {
      fail(
        "world_manager_semantic_discharge_decision_target_mismatch",
        args.targetArtifactRef?.id,
      );
    }
    if (args.disposition === "authorize_exact_target") {
      if (
        args.resolutionMode !== "authority_request" ||
        args.ambiguities.length > 0 ||
        !(decisionBinding.executableDispositions || [])
          .includes("authorize_exact_target")
      ) {
        fail(
          "world_manager_semantic_discharge_decision_authorization_unavailable",
          args.decisionId,
        );
      }
    }
    return;
  }
  if (actionName === ACTION_NAMES.PROJECT_ECOLOGY) {
    if (
      args.selectionMode === "explicit_projects" &&
      args.projectIds.length < 2
    ) {
      fail(
        "world_manager_semantic_discharge_project_ecology_subjects_required",
      );
    }
    for (const projectId of args.projectIds) {
      if (!availableProjectIds.has(projectId)) {
        fail(
          "world_manager_semantic_discharge_project_ref_unresolved",
          projectId,
        );
      }
    }
    return;
  }
  if (actionName !== ACTION_NAMES.PROJECT_CONCERN) return;
  if (!availableProjectIds.has(args.projectId)) {
    fail(
      "world_manager_semantic_discharge_project_ref_unresolved",
      args.projectId,
    );
  }
  const project = (
    Array.isArray(input.projects)
      ? input.projects
      : []
  ).find((entry) =>
    normalizeString(
      entry.projectId || entry.id,
      "",
    ) === args.projectId);
  if (
    project?.roleRuntimeAddressable === false
  ) {
    fail(
      "world_manager_semantic_discharge_project_role_runtime_unavailable",
      args.projectId,
    );
  }
  const scopeHint = input.request?.scopeHint || {};
  if (
    scopeHint.bindingPosture === "explicit_constraint" &&
    normalizeString(scopeHint.projectId, "") !== args.projectId
  ) {
    fail(
      "world_manager_semantic_discharge_explicit_scope_violation",
      args.projectId,
    );
  }
}

function actionCallsFromRunnerResult(value = {}) {
  if (Array.isArray(value.actionCalls)) return value.actionCalls;
  return (Array.isArray(value.normalizedEvents)
    ? value.normalizedEvents
    : [])
    .filter((event) => event?.type === "tool_call_completed")
    .map((event) => ({
      callId: event.callId,
      name: event.name || event.toolName,
      argumentsJson: event.argumentsJson,
    }));
}

function validateDischargeAction(runnerResult, input = {}) {
  const errors = [];
  let action = null;
  const actionCalls = actionCallsFromRunnerResult(runnerResult);
  try {
    if (actionCalls.length !== 1) {
      fail(
        "world_manager_semantic_discharge_exactly_one_action_required",
        String(actionCalls.length),
      );
    }
    const call = actionCalls[0];
    const actionName = required(call.name, "action.name");
    if (!Object.values(ACTION_NAMES).includes(actionName)) {
      fail(
        "world_manager_semantic_discharge_action_unknown",
        actionName,
      );
    }
    if (
      input.semanticChildContract &&
      actionName === ACTION_NAMES.SPLIT
    ) {
      fail(
        "world_manager_semantic_child_recursive_split_forbidden",
      );
    }
    const args = normalizeActionArguments(
      actionName,
      call.argumentsJson ?? call.arguments ?? call.payload,
    );
    validateActionReferenceBoundaries(actionName, args, input);
    action = {
      callId: normalizeString(call.callId, ""),
      actionName,
      arguments: args,
    };
  } catch (error) {
    errors.push({
      code: normalizeString(
        error?.code,
        "world_manager_semantic_discharge_validation_failed",
      ),
      detail: normalizeString(error?.detail, ""),
    });
  }
  const validation = {
    schema: SEMANTIC_INGRESS_VALIDATION_SCHEMA,
    state: errors.length ? "remanded" : "validated",
    requiredContract: "exactly_one_native_semantic_action",
    observedActionNames: actionCalls
      .map((call) => normalizeString(call?.name, ""))
      .filter(Boolean),
    errors,
    semanticContentValidatedAgainstClosedTaxonomy: false,
    grantsAuthority: false,
  };
  validation.digest = digestFor(
    SEMANTIC_INGRESS_VALIDATION_SCHEMA,
    validation,
    ["digest"],
  );
  return { validation, action };
}

function buildSemanticDischarge(input = {}) {
  const action = input.action;
  const result = {
    schema: SEMANTIC_DISCHARGE_SCHEMA,
    semanticDischargeId: stableId(
      "wm_semantic_discharge",
      {
        semanticEventId: input.event.semanticEventId,
        actionName: action.actionName,
        arguments: action.arguments,
      },
    ),
    semanticEventId: input.event.semanticEventId,
    actionName: action.actionName,
    callId: action.callId,
    arguments: action.arguments,
    typeExpressions: collectTypeExpressions(action.arguments),
    semanticContentPosture: "open",
    grantsAuthority: false,
    createdAt: input.createdAt,
  };
  result.digest = digestFor(
    SEMANTIC_DISCHARGE_SCHEMA,
    result,
    ["digest"],
  );
  validateSemanticDischarge(result);
  return result;
}

function validateSemanticDischarge(value) {
  if (
    !isPlainObject(value) ||
    value.schema !== SEMANTIC_DISCHARGE_SCHEMA
  ) {
    fail("world_manager_semantic_discharge_schema_mismatch");
  }
  required(value.semanticDischargeId, "semanticDischarge.id");
  required(value.semanticEventId, "semanticDischarge.eventId");
  required(value.actionName, "semanticDischarge.actionName");
  if (
    !Object.values(ACTION_NAMES).includes(value.actionName) ||
    !isPlainObject(value.arguments) ||
    !Array.isArray(value.typeExpressions) ||
    value.semanticContentPosture !== "open" ||
    value.grantsAuthority !== false
  ) {
    fail("world_manager_semantic_discharge_boundary_violation");
  }
  if (
    value.digest !==
    digestFor(SEMANTIC_DISCHARGE_SCHEMA, value, ["digest"])
  ) {
    fail("world_manager_semantic_discharge_digest_mismatch");
  }
  return true;
}

function ecologyProjectIds(args = {}, input = {}) {
  if (args.selectionMode === "all_projects") {
    return [...configuredProjectIds(input)].sort();
  }
  return sortedUnique(args.projectIds);
}

function derivedSettlementFields(discharge, input = {}) {
  const args = discharge?.arguments || {};
  switch (discharge?.actionName) {
    case ACTION_NAMES.WORLD_CONVERSATION:
      return {
        settlementState: "settled",
        speechActs: [{
          act: typeExpressionLabel(args.conversationKind) || "converse",
          confidence: "semantically_discharged",
        }],
        laneAssignments: [{
          laneId: "conversation",
          posture: "primary",
          scopeKind: "user_world",
          projectId: "",
          workThreadId: "",
          rationaleSummary: args.rationaleSummary,
        }],
        projectSeedJudgment: "not_applicable",
        taskTypes: ["world_conversation"],
        actionClasses: ["formulate_natural_response"],
        effectClasses: ["none"],
        formulationDisposition: "answer_in_world_manager_turn",
        roleAssignments: [{
          role: "world_manager",
          scopeKind: "user_world",
          projectId: "",
          workThreadId: "",
        }],
        ambiguityReasons: [],
        clarificationPrompt: "",
        rationaleSummary: args.rationaleSummary,
      };
    case ACTION_NAMES.WORLD_INTROSPECTION:
      return {
        settlementState: "settled",
        speechActs: [{
          act: "inspect",
          confidence: "semantically_discharged",
        }],
        laneAssignments: [{
          laneId: "system_introspection",
          posture: "primary",
          scopeKind: "user_world",
          projectId: "",
          workThreadId: "",
          rationaleSummary: args.rationaleSummary,
        }],
        projectSeedJudgment: "not_applicable",
        taskTypes: ["world_conversation"],
        actionClasses: ["formulate_natural_response", "inspect_system_semantics"],
        effectClasses: ["none"],
        formulationDisposition: "answer_in_world_manager_turn",
        roleAssignments: [{
          role: "world_manager",
          scopeKind: "user_world",
          projectId: "",
          workThreadId: "",
        }],
        ambiguityReasons: [],
        clarificationPrompt: "",
        rationaleSummary: args.rationaleSummary,
      };
    case ACTION_NAMES.PROJECT_ECOLOGY: {
      const projectIds = ecologyProjectIds(args, input);
      return {
        settlementState: "settled",
        speechActs: [{
          act:
            typeExpressionLabel(args.concernType) ||
            "project_ecology_concern",
          confidence: "semantically_discharged",
        }],
        laneAssignments: [
          {
            laneId: "project_ecology",
            posture: "primary",
            scopeKind: "user_world",
            projectId: "",
            workThreadId: "",
            rationaleSummary: args.rationaleSummary,
          },
          ...projectIds.map((projectId) => ({
            laneId: "project_ecology_subject",
            posture: "secondary",
            scopeKind: "project",
            projectId,
            workThreadId: "",
            rationaleSummary:
              "This project is a bounded subject of the world-governed ecology concern.",
          })),
        ],
        projectSeedJudgment: "not_applicable",
        taskTypes: [args.operationalAdapter],
        actionClasses: [
          "formulate_project_ecology_response",
        ],
        effectClasses: ["none"],
        formulationDisposition:
          "answer_in_world_manager_turn",
        roleAssignments: [{
          role: "world_manager",
          scopeKind: "user_world",
          projectId: "",
          workThreadId: "",
        }],
        ambiguityReasons: [],
        clarificationPrompt: "",
        rationaleSummary: args.rationaleSummary,
      };
    }
    case ACTION_NAMES.DECISION_CONCERN: {
      const requested = args.requestedActions
        .map(typeExpressionLabel)
        .filter(Boolean);
      const effects = args.anticipatedEffects
        .map(typeExpressionLabel)
        .filter(Boolean);
      const executableDisposition =
        args.disposition === "authorize_exact_target";
      return {
        settlementState: "settled",
        speechActs: [{
          act:
            typeExpressionLabel(
              args.concernType,
            ) ||
            "deliberate_semantic_decision",
          confidence:
            "semantically_discharged",
        }],
        laneAssignments: [{
          laneId:
            "semantic_decision_deliberation",
          posture: "primary",
          scopeKind: "user_world",
          projectId: "",
          workThreadId: "",
          rationaleSummary:
            args.rationaleSummary,
        }],
        projectSeedJudgment:
          "not_applicable",
        taskTypes: [
          "semantic_decision_deliberation",
        ],
        actionClasses: requested.length
          ? requested
          : executableDisposition
            ? ["authorize_exact_decision_target"]
            : [
              "interpret_decision_contribution",
              "formulate_natural_response",
            ],
        effectClasses: effects.length
          ? effects
          : executableDisposition
            ? ["governed_admission_protocol"]
            : ["none"],
        formulationDisposition:
          "answer_in_world_manager_turn",
        roleAssignments: [{
          role: "world_manager",
          scopeKind: "user_world",
          projectId: "",
          workThreadId: "",
        }],
        ambiguityReasons:
          sortedUnique(args.ambiguities),
        clarificationPrompt: "",
        rationaleSummary:
          args.rationaleSummary,
      };
    }
    case ACTION_NAMES.PROJECT_CONCERN: {
      const requested = args.requestedActions
        .map(typeExpressionLabel)
        .filter(Boolean);
      const effects = args.anticipatedEffects
        .map(typeExpressionLabel)
        .filter(Boolean);
      return {
        settlementState: "settled",
        speechActs: [{
          act: typeExpressionLabel(args.concernType) || "project_concern",
          confidence: "semantically_discharged",
        }],
        laneAssignments: [{
          laneId:
            args.operationalAdapter === "implementation_request"
              ? "project_execution_request"
              : "project_deliberation",
          posture: "primary",
          scopeKind: "project",
          projectId: args.projectId,
          workThreadId: "",
          rationaleSummary: args.rationaleSummary,
        }],
        projectSeedJudgment: "not_applicable",
        taskTypes: [args.operationalAdapter],
        actionClasses: requested.length
          ? requested
          : ["address_project_concern"],
        effectClasses: effects.length ? effects : ["none"],
        formulationDisposition: "delegate",
        roleAssignments: [{
          role: "project_manager",
          scopeKind: "project",
          projectId: args.projectId,
          workThreadId: "",
        }],
        ambiguityReasons: sortedUnique(args.ambiguities),
        clarificationPrompt: "",
        rationaleSummary: args.rationaleSummary,
      };
    }
    case ACTION_NAMES.PROJECT_GENESIS:
      return {
        settlementState: "settled",
        speechActs: [{
          act: typeExpressionLabel(args.seedType) || "project_seed",
          confidence: "semantically_discharged",
        }],
        laneAssignments: [{
          laneId: "project_genesis",
          posture: "primary",
          scopeKind: "user_world",
          projectId: "",
          workThreadId: "",
          rationaleSummary: args.rationaleSummary,
        }],
        projectSeedJudgment: "present",
        taskTypes: ["project_initialization"],
        actionClasses: [
          "formulate_project_constitution_candidate",
          "rank_realization_options",
        ],
        effectClasses: ["project_constitution_candidate"],
        formulationDisposition: "delegate",
        roleAssignments: [{
          role: "world_manager",
          scopeKind: "user_world",
          projectId: "",
          workThreadId: "",
        }],
        ambiguityReasons: sortedUnique(args.ambiguities),
        clarificationPrompt: "",
        rationaleSummary: args.rationaleSummary,
      };
    case ACTION_NAMES.CLARIFICATION:
      return {
        settlementState: "clarification_required",
        speechActs: [{
          act: "clarify",
          confidence: "semantically_discharged",
        }],
        laneAssignments: [{
          laneId: "system_introspection",
          posture: "primary",
          scopeKind: "user_world",
          projectId: "",
          workThreadId: "",
          rationaleSummary: args.rationaleSummary,
        }],
        projectSeedJudgment: "ambiguous",
        taskTypes: ["project_discussion"],
        actionClasses: ["request_clarification"],
        effectClasses: ["none"],
        formulationDisposition: "clarify",
        roleAssignments: [{
          role: "world_manager",
          scopeKind: "user_world",
          projectId: "",
          workThreadId: "",
        }],
        ambiguityReasons: args.unresolvedDimensions
          .map(typeExpressionLabel)
          .filter(Boolean),
        clarificationPrompt: args.clarificationPrompt,
        rationaleSummary: args.rationaleSummary,
      };
    case ACTION_NAMES.SPLIT:
      return {
        settlementState: "settled",
        speechActs: [{
          act: "multi_contract",
          confidence: "semantically_discharged",
        }],
        laneAssignments: [{
          laneId: "mixed",
          posture: "primary",
          scopeKind: "user_world",
          projectId: "",
          workThreadId: "",
          rationaleSummary: args.rationaleSummary,
        }],
        projectSeedJudgment: "not_applicable",
        taskTypes: ["project_discussion"],
        actionClasses: ["split_semantic_child_contracts"],
        effectClasses: ["semantic_child_event_candidates"],
        formulationDisposition: "split",
        roleAssignments: [{
          role: "world_manager",
          scopeKind: "user_world",
          projectId: "",
          workThreadId: "",
        }],
        ambiguityReasons: [],
        clarificationPrompt: "",
        rationaleSummary: args.rationaleSummary,
      };
    default:
      return null;
  }
}

function fallbackSettlementFields(failed) {
  return {
    settlementState: "remanded",
    speechActs: [{
      act: "semantic_discharge_unavailable",
      confidence: "unsettled",
    }],
    laneAssignments: [{
      laneId: "system_introspection",
      posture: "primary",
      scopeKind: "user_world",
      projectId: "",
      workThreadId: "",
      rationaleSummary:
        "The harness could not obtain one structurally valid semantic discharge action.",
    }],
    projectSeedJudgment: "not_applicable",
    taskTypes: ["semantic_settlement_unavailable"],
    actionClasses: ["request_semantic_retry"],
    effectClasses: ["none"],
    formulationDisposition: "remand",
    roleAssignments: [{
      role: "world_manager",
      scopeKind: "user_world",
      projectId: "",
      workThreadId: "",
    }],
    ambiguityReasons: [
      failed
        ? "semantic_discharge_unavailable"
        : "semantic_discharge_form_invalid",
    ],
    clarificationPrompt: failed
      ? "WorldManager could not discharge that message. Retry when semantic ingress is available."
      : "WorldManager returned an invalid semantic action form. Retry this message.",
    rationaleSummary:
      "No semantic content was rejected as an unknown category; the action form itself was unavailable or invalid.",
  };
}

function buildSemanticSettlement(input = {}) {
  const fields = input.semanticDischarge
    ? derivedSettlementFields(
        input.semanticDischarge,
        input,
      )
    : fallbackSettlementFields(input.failed);
  const result = {
    schema: SEMANTIC_SETTLEMENT_SCHEMA,
    semanticSettlementId: stableId("wm_semantic_settlement", {
      semanticEventId: input.event.semanticEventId,
      semanticDischargeDigest: input.semanticDischarge?.digest || "",
      fields,
    }),
    semanticEventId: input.event.semanticEventId,
    ingressMessageRef: ref(
      "world_manager_message",
      input.message.messageId,
      input.message.messageDigest,
    ),
    worldBindingRef: ref(
      "worldmodel_binding",
      input.graphBinding.bindingId,
      input.graphBinding.digest,
    ),
    ...(input.semanticDischarge
      ? {
          semanticDischargeRef: ref(
            "world_manager_semantic_discharge",
            input.semanticDischarge.semanticDischargeId,
            input.semanticDischarge.digest,
          ),
        }
      : {}),
    ...fields,
    phase: TASK_PHASES[fields.taskTypes[0]] || "semantic_ingress",
    semanticTypeExpressions:
      input.semanticDischarge?.typeExpressions || [],
    grantsAuthority: false,
    createdAt: input.createdAt,
    compilerVersion: "world_manager_semantic_discharge@1",
  };
  result.digest = digestFor(
    SEMANTIC_SETTLEMENT_SCHEMA,
    result,
    ["digest"],
  );
  validateSemanticSettlement(result);
  return result;
}

function validateLegacySemanticSettlement(value) {
  if (
    !isPlainObject(value) ||
    value.schema !== LEGACY_SEMANTIC_SETTLEMENT_SCHEMA
  ) {
    fail("world_manager_semantic_settlement_schema_mismatch");
  }
  required(value.semanticSettlementId, "semanticSettlement.id");
  required(value.semanticEventId, "semanticSettlement.eventId");
  if (
    !Array.isArray(value.laneAssignments) ||
    !value.laneAssignments.length ||
    !Array.isArray(value.taskTypes) ||
    value.taskTypes.length !== 1 ||
    !Array.isArray(value.roleAssignments) ||
    !value.roleAssignments.length ||
    value.grantsAuthority !== false ||
    value.digest !==
      digestFor(LEGACY_SEMANTIC_SETTLEMENT_SCHEMA, value, ["digest"])
  ) {
    fail("world_manager_semantic_settlement_boundary_violation");
  }
  return true;
}

function validateSemanticSettlement(value) {
  if (value?.schema === LEGACY_SEMANTIC_SETTLEMENT_SCHEMA) {
    return validateLegacySemanticSettlement(value);
  }
  if (
    !isPlainObject(value) ||
    value.schema !== SEMANTIC_SETTLEMENT_SCHEMA
  ) {
    fail("world_manager_semantic_settlement_schema_mismatch");
  }
  required(value.semanticSettlementId, "semanticSettlement.id");
  required(value.semanticEventId, "semanticSettlement.eventId");
  if (
    !["settled", "clarification_required", "remanded"].includes(
      value.settlementState,
    ) ||
    !Array.isArray(value.speechActs) ||
    !value.speechActs.length ||
    !Array.isArray(value.laneAssignments) ||
    value.laneAssignments.filter((entry) =>
      entry?.posture === "primary").length !== 1 ||
    !Array.isArray(value.taskTypes) ||
    value.taskTypes.length !== 1 ||
    !Array.isArray(value.actionClasses) ||
    !Array.isArray(value.effectClasses) ||
    !Array.isArray(value.roleAssignments) ||
    !value.roleAssignments.length ||
    !Array.isArray(value.ambiguityReasons) ||
    !Array.isArray(value.semanticTypeExpressions) ||
    value.grantsAuthority !== false
  ) {
    fail("world_manager_semantic_settlement_boundary_violation");
  }
  if (
    value.digest !==
    digestFor(SEMANTIC_SETTLEMENT_SCHEMA, value, ["digest"])
  ) {
    fail("world_manager_semantic_settlement_digest_mismatch");
  }
  return true;
}

function normalizeTelemetry(
  value = {},
  state = "completed",
  metaRoleInvocation = null,
) {
  return {
    runtimeMode: normalizeString(
      value.runtimeMode,
      "semantic_discharge_runner",
    ),
    model: normalizeString(value.model, ""),
    reasoningEffort: normalizeString(value.reasoningEffort, "low"),
    inputTokens: Number(value.inputTokens || 0),
    outputTokens: Number(value.outputTokens || 0),
    toolCallCount: Number(value.toolCallCount || 0),
    toolNames: sortedUnique(value.toolNames),
    telemetrySource: normalizeString(
      value.telemetrySource,
      "harness_observed",
    ),
    terminalState: state,
    metaRoleId: normalizeString(
      value.metaRoleId,
      metaRoleInvocation?.metaRoleId || "",
    ),
    metaRoleInvocationRef: metaRoleInvocation
      ? {
          kind: "constitutional_meta_role_invocation",
          id: metaRoleInvocation.metaRoleInvocationId,
          digest: metaRoleInvocation.digest,
        }
      : null,
    realizationPolicyRef:
      metaRoleInvocation?.realizationPolicyRef || null,
    effectCount: 0,
    rawProviderPayloadStored: false,
    rawChainOfThoughtStored: false,
  };
}

function requestManifest(
  input,
  instructions,
  outputContract,
  metaRoleInvocation = null,
) {
  const scopeHint = input.request?.scopeHint || {};
  const manifest = {
    schema: SEMANTIC_INGRESS_REQUEST_MANIFEST_SCHEMA,
    requestManifestId: stableId(
      "wm_semantic_discharge_manifest",
      {
        semanticEventId: input.event.semanticEventId,
        instructionDigest: digestFor(
          "direct-world-manager-semantic-discharge-instructions@1",
          { instructions },
        ),
        outputContractDigest: outputContract.digest,
      },
    ),
    semanticEventId: input.event.semanticEventId,
    ingressMessageRef: ref(
      input.semanticChildContract
        ? "semantic_child_contract"
        : "world_manager_message",
      input.message.messageId,
      input.message.messageDigest,
    ),
    instructionPackageRef: {
      kind: "trusted_semantic_ingress_instruction_package",
      id: input.semanticChildContract
        ? "world_manager.semantic_child_discharge@1"
        : "world_manager.semantic_discharge@1",
      digest: digestFor(
        "direct-world-manager-semantic-discharge-instructions@1",
        { instructions },
      ),
    },
    outputContractRef: {
      kind: "semantic_action_contract",
      id: outputContract.outputContractId,
      digest: outputContract.digest,
    },
    constitutionalMetaRoleInvocation:
      metaRoleInvocation || null,
    metaRoleInvocationRef: metaRoleInvocation
      ? {
          kind: "constitutional_meta_role_invocation",
          id: metaRoleInvocation.metaRoleInvocationId,
          digest: metaRoleInvocation.digest,
        }
      : null,
    metaRoleMemberRef:
      outputContract.metaRoleMemberRef || null,
    metaRoleRealizationPolicyRef:
      outputContract.realizationPolicyRef || null,
    projectIndexDigest: digestFor(
      "direct-world-manager-semantic-ingress-project-index@1",
      (Array.isArray(input.projects) ? input.projects : []).map(
        (project) => ({
          projectId: project.projectId || project.id,
          name: project.name,
          summary: project.summary,
        }),
      ),
    ),
    scopeBinding: {
      posture: normalizeString(
        scopeHint.bindingPosture,
        "ambient_focus",
      ),
      projectId: normalizeString(scopeHint.projectId, ""),
      proposalId: normalizeString(scopeHint.proposalId, ""),
      workThreadId: normalizeString(scopeHint.workThreadId, ""),
    },
    rendererInstructionsAccepted: false,
    grantsAuthority: false,
  };
  manifest.digest = digestFor(
    SEMANTIC_INGRESS_REQUEST_MANIFEST_SCHEMA,
    manifest,
    ["digest"],
  );
  return manifest;
}

function buildRunRecord(input = {}) {
  const record = {
    schema: SEMANTIC_INGRESS_RUN_SCHEMA,
    semanticIngressRunId: stableId(
      "wm_semantic_ingress_run",
      {
        semanticEventId: input.event.semanticEventId,
        requestManifestDigest: input.requestManifest.digest,
      },
    ),
    semanticEventId: input.event.semanticEventId,
    requestManifestRef: {
      kind: "semantic_discharge_request_manifest",
      id: input.requestManifest.requestManifestId,
      digest: input.requestManifest.digest,
    },
    requestManifest: input.requestManifest,
    semanticDischarge: input.semanticDischarge,
    semanticSettlement: input.semanticSettlement,
    outputValidation: input.validation,
    telemetry: input.telemetry,
    runState: input.runState,
    outputPayloadStored: Boolean(input.semanticDischarge),
    rawProviderPayloadStored: false,
    rawChainOfThoughtStored: false,
    grantsAuthority: false,
    createdAt: input.createdAt,
  };
  record.digest = digestFor(
    SEMANTIC_INGRESS_RUN_SCHEMA,
    record,
    ["digest"],
  );
  validateSemanticIngressRun(record);
  return record;
}

function validateLegacySemanticIngressRun(value) {
  if (
    !isPlainObject(value) ||
    value.schema !== LEGACY_SEMANTIC_INGRESS_RUN_SCHEMA
  ) {
    fail("world_manager_semantic_ingress_run_schema_mismatch");
  }
  required(value.semanticIngressRunId, "semanticIngressRun.id");
  required(value.semanticEventId, "semanticIngressRun.eventId");
  validateLegacySemanticSettlement(value.semanticSettlement);
  if (
    value.grantsAuthority !== false ||
    value.digest !==
      digestFor(LEGACY_SEMANTIC_INGRESS_RUN_SCHEMA, value, ["digest"])
  ) {
    fail("world_manager_semantic_ingress_run_boundary_violation");
  }
  return true;
}

function validateSemanticIngressRun(value) {
  if (value?.schema === LEGACY_SEMANTIC_INGRESS_RUN_SCHEMA) {
    return validateLegacySemanticIngressRun(value);
  }
  if (
    !isPlainObject(value) ||
    value.schema !== SEMANTIC_INGRESS_RUN_SCHEMA
  ) {
    fail("world_manager_semantic_ingress_run_schema_mismatch");
  }
  required(value.semanticIngressRunId, "semanticIngressRun.id");
  required(value.semanticEventId, "semanticIngressRun.eventId");
  validateSemanticSettlement(value.semanticSettlement);
  if (value.semanticDischarge) {
    validateSemanticDischarge(value.semanticDischarge);
    if (
      value.semanticSettlement.semanticDischargeRef?.id !==
        value.semanticDischarge.semanticDischargeId ||
      value.semanticSettlement.semanticDischargeRef?.digest !==
        value.semanticDischarge.digest
    ) {
      fail("world_manager_semantic_discharge_lineage_mismatch");
    }
  }
  if (
    !["completed", "remanded", "failed"].includes(value.runState) ||
    value.rawProviderPayloadStored !== false ||
    value.rawChainOfThoughtStored !== false ||
    value.grantsAuthority !== false ||
    value.digest !==
      digestFor(SEMANTIC_INGRESS_RUN_SCHEMA, value, ["digest"])
  ) {
    fail("world_manager_semantic_ingress_run_boundary_violation");
  }
  return true;
}

class DirectWorldManagerSemanticIngressRuntime {
  constructor(options = {}) {
    this.runner = typeof options.runner === "function"
      ? options.runner
      : null;
    this.now = typeof options.now === "function"
      ? options.now
      : Date.now;
    this.metaRoleRegistry = options.metaRoleRegistry ||
      createDefaultConstitutionalMetaRoleRegistry();
  }

  available() {
    return Boolean(this.runner);
  }

  metaRoleProjection() {
    return this.metaRoleRegistry.projection();
  }

  run(input = {}) {
    const createdAt = nowIso(this.now);
    const semanticChildMode =
      Boolean(input.semanticChildContract);
    const metaRoleMember = this.metaRoleRegistry.member(
      SEMANTIC_ROUTER_META_ROLE_ID,
    );
    const metaRoleRealizationPolicy =
      this.metaRoleRegistry.realizationPolicy(
        SEMANTIC_ROUTER_META_ROLE_ID,
      );
    const metaRoleInvocation =
      this.metaRoleRegistry.compileInvocation({
        metaRoleId: SEMANTIC_ROUTER_META_ROLE_ID,
        activationRef: {
          kind: "world_manager_semantic_event",
          id: input.event.semanticEventId,
          digest: input.event.eventDigest || digestFor(
            "world_manager_semantic_event_activation@1",
            {
              semanticEventId: input.event.semanticEventId,
              clientRequestId: input.event.clientRequestId || "",
            },
          ),
        },
        createdAt,
      });
    const instructions = semanticIngressInstructions({
      semanticChildMode,
      metaRoleInvocation,
    });
    const outputContract = semanticIngressOutputContract({
      semanticChildMode,
      metaRoleMember,
      metaRoleInvocation,
    });
    const manifest = requestManifest(
      input,
      instructions,
      outputContract,
      metaRoleInvocation,
    );
    const finalize = (runnerResult, runnerError = null) => {
      let validated;
      if (runnerError) {
        const validation = {
          schema: SEMANTIC_INGRESS_VALIDATION_SCHEMA,
          state: "failed",
          requiredContract: "exactly_one_native_semantic_action",
          observedActionNames: [],
          errors: [{
            code: normalizeString(
              runnerError.code,
              "world_manager_semantic_discharge_runner_failed",
            ),
            detail: normalizeString(runnerError.message, ""),
          }],
          semanticContentValidatedAgainstClosedTaxonomy: false,
          grantsAuthority: false,
        };
        validation.digest = digestFor(
          SEMANTIC_INGRESS_VALIDATION_SCHEMA,
          validation,
          ["digest"],
        );
        validated = { validation, action: null };
      } else {
        validated = validateDischargeAction(runnerResult, input);
      }
      const runState = runnerError
        ? "failed"
        : validated.validation.state === "validated"
          ? "completed"
          : "remanded";
      const semanticDischarge = validated.action
        ? buildSemanticDischarge({
            action: validated.action,
            event: input.event,
            createdAt,
          })
        : null;
      const semanticSettlement = buildSemanticSettlement({
        semanticDischarge,
        failed: Boolean(runnerError),
        event: input.event,
        message: input.message,
        graphBinding: input.graphBinding,
        projects: input.projects,
        createdAt,
      });
      return buildRunRecord({
        event: input.event,
        requestManifest: manifest,
        semanticDischarge,
        semanticSettlement,
        validation: validated.validation,
        telemetry: normalizeTelemetry(
          runnerResult?.telemetry,
          runState,
          metaRoleInvocation,
        ),
        runState,
        createdAt,
      });
    };
    if (!this.runner) {
      const error = new Error(
        "world_manager_semantic_discharge_runner_unavailable",
      );
      error.code =
        "world_manager_semantic_discharge_runner_unavailable";
      return finalize(null, error);
    }
    try {
      const result = this.runner({
        schema: "direct_world_manager_semantic_discharge_runner_request@1",
        semanticEventId: input.event.semanticEventId,
        clientRequestId: input.event.clientRequestId,
        projectId:
          normalizeString(input.focusedProjectId, "") ||
          normalizeString(input.projects?.[0]?.projectId, ""),
        userText: input.message.text,
        projects: input.projects,
        scopeHint: input.request?.scopeHint || {},
        focusedProjectId: input.focusedProjectId,
        pendingDecisions: input.pendingDecisions,
        semanticChildContract:
          input.semanticChildContract || null,
        instructions,
        prompt: semanticIngressPrompt(input),
        outputContract,
        tools: outputContract.tools,
        toolChoicePolicy: "required",
        runtimeRoleClass: "constitutional_meta_role",
        metaRoleId: SEMANTIC_ROUTER_META_ROLE_ID,
        metaRoleInvocation,
        metaRoleRealizationPolicy,
        grantsAuthority: false,
      });
      if (result && typeof result.then === "function") {
        return result.then(
          (value) => finalize(value, null),
          (error) => finalize(null, error),
        );
      }
      return finalize(result, null);
    } catch (error) {
      return finalize(null, error);
    }
  }
}

module.exports = {
  ACTION_NAMES,
  LEGACY_SEMANTIC_INGRESS_RUN_SCHEMA,
  LEGACY_SEMANTIC_SETTLEMENT_SCHEMA,
  PROJECT_ECOLOGY_OPERATIONAL_ADAPTERS,
  PROJECT_OPERATIONAL_ADAPTERS,
  SEMANTIC_ACTION_CONTRACT_SCHEMA,
  SEMANTIC_DISCHARGE_SCHEMA,
  SEMANTIC_INGRESS_REQUEST_MANIFEST_SCHEMA,
  SEMANTIC_INGRESS_RUN_SCHEMA,
  SEMANTIC_INGRESS_VALIDATION_SCHEMA,
  SEMANTIC_SETTLEMENT_SCHEMA,
  TASK_PHASES,
  TYPE_EXPRESSION_MODES,
  DirectWorldManagerSemanticIngressRuntime,
  semanticDischargeTools,
  semanticIngressInstructions,
  semanticIngressOutputContract,
  semanticIngressPrompt,
  semanticTypeExpressionJsonSchema,
  validateDischargeAction,
  validateSemanticDischarge,
  validateSemanticIngressRun,
  validateSemanticSettlement,
};
