// Test-only semantic-role fixture.
//
// This module intentionally lives outside production source. Its phrase
// matching chooses deterministic typed outputs for orchestration regressions;
// it is not a semantic implementation and must never be wired into the app.

const RESULT_SCHEMA =
  "direct_world_manager_semantic_ingress_result@1";

const ACTION_NAMES = {
  WORLD_CONVERSATION: "wm_discharge_world_conversation",
  WORLD_INTROSPECTION: "wm_discharge_world_introspection",
  PROJECT_ECOLOGY:
    "wm_discharge_project_ecology_concern",
  PROJECT_CONCERN: "wm_discharge_project_concern",
  PROJECT_GENESIS: "wm_discharge_project_genesis",
  CLARIFICATION: "wm_discharge_clarification",
  SPLIT: "wm_discharge_split",
};

function typeExpression(label, mode = "freeform") {
  return {
    mode,
    existingTypeRef:
      mode === "existing_ref" ? String(label || "") : "",
    proposedLabel:
      mode === "proposed_type" ? String(label || "") : "",
    parentTypeRef: "",
    differentia:
      mode === "proposed_type"
        ? `Fixture-defined differentia for ${label}.`
        : "",
    components:
      mode === "composite"
        ? [String(label || "fixture_component")]
        : [],
    freeformCharacterization:
      ["freeform", "unresolved"].includes(mode)
        ? String(label || "fixture semantic characterization")
        : "",
  };
}

function actionCall(name, args) {
  return {
    callId: `fixture_${name}`,
    name,
    argumentsJson: JSON.stringify(args),
  };
}

function actionFromLegacyFixture(payload = {}) {
  const primaryLane = payload.laneAssignments?.find(
    (entry) => entry.posture === "primary",
  ) || payload.laneAssignments?.[0] || {};
  const taskType = payload.taskTypes?.[0] || "project_discussion";
  const rationaleSummary =
    payload.rationaleSummary ||
    "The deterministic fixture discharged the semantic contract.";
  if (
    payload.settlementState === "clarification_required" ||
    payload.formulationDisposition === "clarify"
  ) {
    return actionCall(ACTION_NAMES.CLARIFICATION, {
      provisionalContract: typeExpression(
        taskType,
        "existing_ref",
      ),
      unresolvedDimensions: (payload.ambiguityReasons || [
        "fixture ambiguity",
      ]).map((reason) => typeExpression(reason, "unresolved")),
      clarificationObjective:
        "Resolve the fixture's material routing ambiguity.",
      clarificationPrompt: payload.clarificationPrompt,
      rationaleSummary,
    });
  }
  if (payload.formulationDisposition === "split") {
    return actionCall(ACTION_NAMES.SPLIT, {
      childContracts: (payload.laneAssignments || [])
        .map((lane) =>
          typeExpression(
            `${lane.laneId}:${lane.scopeKind}`,
            "freeform",
          )),
      coordinationObjective:
        "Create independently actionable semantic child contracts.",
      rationaleSummary,
    });
  }
  if (taskType === "project_initialization") {
    return actionCall(ACTION_NAMES.PROJECT_GENESIS, {
      seedType: typeExpression(
        "durable project seed",
        "proposed_type",
      ),
      objective:
        "Formulate a candidate project constitution from the seed.",
      constitutionDimensions: [
        typeExpression("project purpose", "freeform"),
        typeExpression("realization substrate", "freeform"),
      ],
      ambiguities: payload.ambiguityReasons || [],
      rationaleSummary,
    });
  }
  if (taskType === "world_conversation") {
    if (primaryLane.laneId === "system_introspection") {
      return actionCall(ACTION_NAMES.WORLD_INTROSPECTION, {
        introspectionSubject: typeExpression(
          "system interpretation and routing",
          "freeform",
        ),
        questionObjective:
          "Explain the system-level interpretation under inspection.",
        evidenceNeeds: [
          typeExpression("routing witness", "existing_ref"),
        ],
        rationaleSummary,
      });
    }
    return actionCall(ACTION_NAMES.WORLD_CONVERSATION, {
      conversationKind: typeExpression(
        "ordinary conversation",
        "freeform",
      ),
      responseIntent:
        "Respond naturally at world scope.",
      contextNeeds: [],
      rationaleSummary,
    });
  }
  if (
    [
      "project_ecology_status",
      "cross_project_comparison",
      "portfolio_planning",
    ].includes(taskType)
  ) {
    return actionCall(ACTION_NAMES.PROJECT_ECOLOGY, {
      concernType: typeExpression(
        taskType,
        "existing_ref",
      ),
      objective:
        "Reason about the bounded project ecology at user-world scope.",
      operationalAdapter: taskType,
      selectionMode: "all_projects",
      projectIds: [],
      evidenceNeeds: [
        typeExpression(
          "user_world_project_ecology",
          "existing_ref",
        ),
      ],
      rationaleSummary,
    });
  }
  return actionCall(ACTION_NAMES.PROJECT_CONCERN, {
    projectId:
      payload.roleAssignments?.[0]?.projectId ||
      primaryLane.projectId,
    concernType: typeExpression(taskType, "existing_ref"),
    concernSubtype: typeExpression(
      primaryLane.laneId || "project concern",
      "freeform",
    ),
    objective:
      "Address the existing-project concern represented by the fixture.",
    operationalAdapter: taskType,
    requestedActions: (payload.actionClasses || []).map(
      (entry) => typeExpression(entry, "freeform"),
    ),
    anticipatedEffects: (payload.effectClasses || []).map(
      (entry) => typeExpression(entry, "freeform"),
    ),
    ambiguities: payload.ambiguityReasons || [],
    rationaleSummary,
  });
}

function projectIdFor(input, text) {
  const projects = Array.isArray(input.projects)
    ? input.projects
    : [];
  const lower = text.toLowerCase();
  const mentioned = projects.find((project) =>
    [
      project.projectId || project.id,
      project.name,
    ].some((value) =>
      String(value || "").trim() &&
      lower.includes(String(value).toLowerCase())));
  return mentioned?.projectId ||
    mentioned?.id ||
    input.scopeHint?.projectId ||
    input.focusedProjectId ||
    projects[0]?.projectId ||
    projects[0]?.id ||
    "";
}

function base(fields = {}) {
  return {
    schema: RESULT_SCHEMA,
    settlementState: fields.settlementState || "settled",
    speechActs: [
      {
        act: fields.speechAct || "ask",
        confidence: fields.confidence || "high",
      },
    ],
    laneAssignments: fields.laneAssignments,
    projectSeedJudgment:
      fields.projectSeedJudgment || "absent",
    taskTypes: [fields.taskType],
    actionClasses: fields.actionClasses,
    effectClasses: fields.effectClasses,
    formulationDisposition:
      fields.formulationDisposition || "delegate",
    roleAssignments: fields.roleAssignments,
    ambiguityReasons: fields.ambiguityReasons || [],
    clarificationPrompt: fields.clarificationPrompt || "",
    rationaleSummary: fields.rationaleSummary,
    grantsAuthority: false,
  };
}

function projectResult(input, fields = {}) {
  const projectId = fields.projectId ||
    projectIdFor(input, String(input.userText || ""));
  return base({
    taskType: fields.taskType || "project_discussion",
    laneAssignments: [
      {
        laneId: fields.laneId || "project_deliberation",
        posture: "primary",
        scopeKind: "project",
        projectId,
        rationaleSummary:
          fields.rationaleSummary ||
          "The deterministic semantic-role fixture assigned an existing-project task.",
      },
    ],
    roleAssignments: [
      {
        role: "project_manager",
        scopeKind: "project",
        projectId,
      },
    ],
    actionClasses: fields.actionClasses || ["discuss"],
    effectClasses: fields.effectClasses || ["none"],
    rationaleSummary:
      fields.rationaleSummary ||
      "The deterministic semantic-role fixture assigned an existing-project task.",
    speechAct: fields.speechAct || "direct",
  });
}

function conversationResult() {
  return base({
    taskType: "world_conversation",
    laneAssignments: [
      {
        laneId: "conversation",
        posture: "primary",
        scopeKind: "user_world",
        rationaleSummary:
          "The deterministic semantic-role fixture assigned ordinary conversation.",
      },
    ],
    roleAssignments: [
      {
        role: "world_manager",
        scopeKind: "user_world",
      },
    ],
    actionClasses: ["converse"],
    effectClasses: ["none"],
    formulationDisposition:
      "answer_in_world_manager_turn",
    rationaleSummary:
      "The deterministic semantic-role fixture assigned ordinary conversation.",
    speechAct: "converse",
  });
}

function introspectionResult() {
  return base({
    taskType: "world_conversation",
    laneAssignments: [
      {
        laneId: "system_introspection",
        posture: "primary",
        scopeKind: "user_world",
        rationaleSummary:
          "The deterministic semantic-role fixture assigned a question about system interpretation to world introspection.",
      },
    ],
    roleAssignments: [
      {
        role: "world_manager",
        scopeKind: "user_world",
      },
    ],
    actionClasses: ["inspect_system_semantics"],
    effectClasses: ["none"],
    formulationDisposition:
      "answer_in_world_manager_turn",
    rationaleSummary:
      "The deterministic semantic-role fixture assigned a question about system interpretation to world introspection.",
    speechAct: "inspect",
  });
}

function genesisResult() {
  return base({
    taskType: "project_initialization",
    laneAssignments: [
      {
        laneId: "project_genesis",
        posture: "primary",
        scopeKind: "user_world",
        rationaleSummary:
          "The deterministic semantic-role fixture identified a durable project seed.",
      },
    ],
    roleAssignments: [
      {
        role: "world_manager",
        scopeKind: "user_world",
      },
    ],
    projectSeedJudgment: "present",
    actionClasses: [
      "formulate_project_constitution_candidate",
      "interpret_project_intent",
      "rank_realization_options",
    ],
    effectClasses: [
      "project_constitution_candidate",
    ],
    rationaleSummary:
      "The deterministic semantic-role fixture identified a durable project seed.",
    speechAct: "propose",
  });
}

function projectEcologyResult(
  input = {},
  taskType = "project_ecology_status",
) {
  const projects = Array.isArray(input.projects)
    ? input.projects
    : [];
  return base({
    taskType,
    laneAssignments: [
      {
        laneId: "project_ecology",
        posture: "primary",
        scopeKind: "user_world",
        rationaleSummary:
          "The deterministic semantic-role fixture assigned a cross-project concern to the world-governed project ecology.",
      },
      ...projects.map((project) => ({
        laneId: "project_ecology_subject",
        posture: "secondary",
        scopeKind: "project",
        projectId: project.projectId || project.id,
        rationaleSummary:
          "The project is a bounded subject of the ecology query.",
      })),
    ],
    roleAssignments: [
      {
        role: "world_manager",
        scopeKind: "user_world",
      },
    ],
    actionClasses: [
      "formulate_project_ecology_response",
    ],
    effectClasses: ["none"],
    formulationDisposition:
      "answer_in_world_manager_turn",
    rationaleSummary:
      "The deterministic semantic-role fixture assigned a cross-project concern to the world-governed project ecology.",
    speechAct: "inspect",
  });
}

function clarificationResult(taskType, ambiguityReason, prompt) {
  return base({
    settlementState: "clarification_required",
    taskType,
    laneAssignments: [
      {
        laneId: "system_introspection",
        posture: "primary",
        scopeKind: "user_world",
        rationaleSummary:
          "The deterministic semantic-role fixture found material ambiguity.",
      },
    ],
    roleAssignments: [
      {
        role: "world_manager",
        scopeKind: "user_world",
      },
    ],
    actionClasses: ["request_clarification"],
    effectClasses: ["none"],
    formulationDisposition: "clarify",
    ambiguityReasons: [ambiguityReason],
    clarificationPrompt: prompt,
    rationaleSummary:
      ambiguityReason === "admission_target_missing"
        ? "The affirmative reply does not identify an exact proposal or action target."
        : "No exact or high-confidence project target was established.",
    speechAct: "ask",
    confidence: "ambiguous",
  });
}

function defaultFixtureResult(input = {}) {
  const text = String(input.userText || "").trim();
  const lower = text.toLowerCase();
  const configuredProjects = Array.isArray(input.projects)
    ? input.projects
    : [];
  const mentionedProject = configuredProjects.find((project) =>
    [
      project.projectId || project.id,
      project.name,
    ].some((value) =>
      String(value || "").trim() &&
      lower.includes(String(value).toLowerCase())));

  if (
    /^(?:yes|yep|yeah|ok|okay|approve|approved|greenlight|go ahead|do it)[.! ]*$/.test(
      text,
    )
  ) {
    return clarificationResult(
      "project_discussion",
      "admission_target_missing",
      "What exact proposal or action are you approving? Name it or open its decision card before confirming.",
    );
  }
  if (
    /^(?:hi|hey|hello|hiya|howdy|yo|thanks|thank you|[:;=x][-^']?[)(dp]+|[👋🙂😊😀😄😁🙃❤️❤\s]+)[!,.?\s]*$/iu.test(
      text,
    )
  ) {
    return conversationResult();
  }
  if (
    /\b(?:why|how)\b[\s\S]{0,96}\b(?:interpret|route|classif|remand|admit|prohibit|decide)\w*/i.test(
      text,
    )
  ) {
    return introspectionResult();
  }
  if (
    /\b(?:create|start|initialize|initialise|set up|setup|bootstrap)\b[\s\S]{0,64}\b(?:new )?project\b/i.test(
      text,
    ) &&
    !/\b(?:do not|don't|never)\b/i.test(text)
  ) {
    return genesisResult();
  }
  if (
    /\b(?:always|never|policy|preference|permitted|forbidden|must not|local only|non-draft)\b/i.test(
      text,
    )
  ) {
    return projectResult(input, {
      projectId:
        mentionedProject?.projectId ||
        mentionedProject?.id,
      taskType: "policy_discussion",
      laneId: "project_deliberation",
      actionClasses: ["discuss_policy"],
      effectClasses: ["policy_candidate"],
    });
  }
  if (
    /\b(?:plan|planning|roadmap|prioriti[sz]e|next features?|milestone|budget)\b/i.test(
      text,
    )
  ) {
    if (
      !mentionedProject &&
      !input.scopeHint?.projectId &&
      configuredProjects.length > 1
    ) {
      return clarificationResult(
        "project_planning",
        "project_scope_ambiguous",
        `Which project is this for: ${configuredProjects
          .map((project) => project.name)
          .join(", ")}?`,
      );
    }
    return projectResult(input, {
      projectId:
        mentionedProject?.projectId ||
        mentionedProject?.id,
      taskType: "project_planning",
      actionClasses: ["plan", "propose"],
      effectClasses: ["candidate_plan"],
    });
  }
  if (
    /\b(?:implement|build|fix|refactor|change|edit|wire|add|remove|delete)\b/i.test(
      text,
    )
  ) {
    return projectResult(input, {
      projectId:
        mentionedProject?.projectId ||
        mentionedProject?.id,
      taskType: "implementation_request",
      laneId: "project_execution_request",
      actionClasses: ["edit", "inspect", "test"],
      effectClasses: ["local_workspace_mutation"],
    });
  }
  if (
    /\b(?:projects|portfolio|project ecology)\b/i.test(text) &&
    /\b(?:status|review|audit|inspect|check|where are we|standing)\b/i.test(
      text,
    )
  ) {
    return projectEcologyResult(
      input,
      "project_ecology_status",
    );
  }
  if (
    /\b(?:status|review|audit|inspect|check|what happened|where are we|standing|risks?)\b/i.test(
      text,
    )
  ) {
    if (
      !mentionedProject &&
      !input.scopeHint?.projectId &&
      configuredProjects.length > 1 &&
      !/\b(?:this|current) project\b/i.test(text)
    ) {
      return clarificationResult(
        "project_review",
        "project_scope_ambiguous",
        `Which project is this for: ${configuredProjects
          .map((project) => project.name)
          .join(", ")}?`,
      );
    }
    return projectResult(input, {
      projectId:
        mentionedProject?.projectId ||
        mentionedProject?.id,
      taskType: "project_review",
      laneId: "epistemic_inquiry",
      actionClasses: ["inspect", "report"],
      effectClasses: ["read_only_evidence"],
      rationaleSummary: mentionedProject
        ? "The current user message explicitly names a project; that current user message outranks ambient renderer focus."
        : "The deterministic semantic-role fixture resolved the project review referent.",
    });
  }
  if (mentionedProject || input.scopeHint?.projectId) {
    return projectResult(input, {
      projectId:
        mentionedProject?.projectId ||
        mentionedProject?.id,
      taskType: "project_discussion",
    });
  }
  return clarificationResult(
    "project_discussion",
    "project_scope_ambiguous",
    `Which project is this for: ${configuredProjects
      .map((project) => project.name)
      .join(", ")}?`,
  );
}

export function createSemanticIngressFixture(options = {}) {
  const overrides = options.overrides || {};
  return (input = {}) => {
    const override =
      overrides[input.clientRequestId] ||
      overrides[input.semanticEventId];
    const payload = typeof override === "function"
      ? override(input)
      : override || defaultFixtureResult(input);
    const action = payload?.name && payload?.argumentsJson
      ? payload
      : actionFromLegacyFixture(payload);
    return {
      actionCalls: [action],
      telemetry: {
        runtimeMode: "deterministic_test_fixture",
        model: "semantic-fixture",
        reasoningEffort: "none",
        inputTokens: 0,
        outputTokens: 0,
        toolCallCount: 1,
        toolNames: [action.name],
        telemetrySource: "deterministic_fixture",
      },
    };
  };
}

export {
  base as semanticIngressFixtureResult,
  actionCall as semanticDischargeFixtureAction,
  conversationResult as conversationFixtureResult,
  genesisResult as genesisFixtureResult,
  introspectionResult as introspectionFixtureResult,
  projectEcologyResult as projectEcologyFixtureResult,
  projectResult as projectFixtureResult,
};
