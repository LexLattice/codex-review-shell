"use strict";

const {
  abstractReasoningObjectRef,
  buildAroReconstructionCandidate,
  digestFor,
  stableId,
  validateAbstractReasoningObject,
  validateAroReconstructionCandidate,
} = require("./aro-kernel");

const ARO_TARGET_DEFINITION_ACTION =
  "wm_discharge_aro_target_definition";
const ARO_TARGET_DEFINITION_RUN_SCHEMA =
  "direct_aro_target_definition_run@1";
const ARO_TARGET_DEFINITION_VALIDATION_SCHEMA =
  "direct_aro_target_definition_validation@1";
const ARO_TARGET_DEFINITION_REQUEST_MANIFEST_SCHEMA =
  "direct_aro_target_definition_request_manifest@1";

const RUN_STATES = new Set([
  "scheduled",
  "running",
  "completed",
  "remanded",
  "failed",
]);
const TERMINAL_RUN_STATES = new Set([
  "completed",
  "remanded",
  "failed",
]);
const RETRYABLE_RUN_STATES = new Set([
  "remanded",
  "failed",
]);
const BRANCH_MODALITIES = new Set([
  "required",
  "possible",
  "counterfactual",
]);
const BRANCH_STATES = new Set([
  "supported",
  "missing",
  "contradicted",
  "unknown",
]);
const EDGE_RELATIONS = new Set([
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
      "world_manager_aro_target_ref_invalid",
      label,
    );
  }
  const projectId = text(
    value.projectId,
    "",
  );
  if (projectId) ref.projectId = projectId;
  const refLabel = text(value.label, "");
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

function exactKeys(
  value,
  expected,
  label,
) {
  if (!isPlainObject(value)) {
    fail(
      "world_manager_aro_target_object_required",
      label,
    );
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (
    actual.length !== wanted.length ||
    actual.some(
      (key, index) =>
        key !== wanted[index],
    )
  ) {
    fail(
      "world_manager_aro_target_form_mismatch",
      label,
    );
  }
}

function targetIntentDigest(targetIntent) {
  return digestFor(
    "direct_aro_target_intent@1",
    {
      targetIntent: bounded(
        targetIntent,
        "",
        8_000,
      ),
    },
  );
}

function targetDefinitionKeyDigest(
  currentRef,
  targetBaselineRef,
  intentDigest,
) {
  return digestFor(
    "direct_aro_target_definition_key@1",
    {
      currentAroRef:
        exactRef(
          currentRef,
          "targetDefinitionKey.currentAroRef",
        ),
      targetBaselineRef:
        targetBaselineRef
          ? exactRef(
              targetBaselineRef,
              "targetDefinitionKey.targetBaselineRef",
            )
          : null,
      targetIntentDigest: text(
        intentDigest,
        "",
      ),
    },
  );
}

function targetIntentRef(
  currentAro,
  targetIntent,
) {
  const exactCurrentRef =
    currentAroRef(currentAro);
  const intentDigest =
    targetIntentDigest(targetIntent);
  return exactRef({
    kind: "aro_target_intent",
    id: stableId(
      "wm_aro_target_intent",
      {
        currentAroRef:
          exactCurrentRef,
        targetIntentDigest:
          intentDigest,
      },
    ),
    digest: intentDigest,
    projectId:
      currentAro.projectId,
    label:
      "User-authored target intent",
  });
}

function currentAroRef(currentAro) {
  validateAbstractReasoningObject(
    currentAro,
  );
  return abstractReasoningObjectRef(
    currentAro,
  );
}

function targetDefinitionTool() {
  const branch = {
    type: "object",
    additionalProperties: false,
    properties: {
      branchKey: { type: "string" },
      parentBranchKey: { type: "string" },
      branchKind: { type: "string" },
      modality: {
        type: "string",
        enum: [...BRANCH_MODALITIES],
      },
      statement: { type: "string" },
      condition: { type: "string" },
      expectedOutcome: { type: "string" },
      semanticState: {
        type: "string",
        enum: [...BRANCH_STATES],
      },
      currentBranchKeys: {
        type: "array",
        items: { type: "string" },
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
      "currentBranchKeys",
    ],
  };
  const edge = {
    type: "object",
    additionalProperties: false,
    properties: {
      fromBranchKey: { type: "string" },
      toBranchKey: { type: "string" },
      relationKind: {
        type: "string",
        enum: [...EDGE_RELATIONS],
      },
      rationale: { type: "string" },
    },
    required: [
      "fromBranchKey",
      "toBranchKey",
      "relationKind",
      "rationale",
    ],
  };
  return {
    type: "function",
    name: ARO_TARGET_DEFINITION_ACTION,
    description:
      "Define one provisional target semantic posture for the exact supplied canonical current ARO and user target intent. This creates no code, binding, admission, worker, or downstream effect.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        targetSemanticIdentity: {
          type: "string",
        },
        targetPurpose: {
          type: "string",
        },
        definitionRationale: {
          type: "string",
        },
        branches: {
          type: "array",
          minItems: 1,
          maxItems: 24,
          items: branch,
        },
        edges: {
          type: "array",
          maxItems: 40,
          items: edge,
        },
        assumptions: {
          type: "array",
          items: { type: "string" },
        },
        unresolvedQuestions: {
          type: "array",
          items: { type: "string" },
        },
      },
      required: [
        "targetSemanticIdentity",
        "targetPurpose",
        "definitionRationale",
        "branches",
        "edges",
        "assumptions",
        "unresolvedQuestions",
      ],
    },
  };
}

function targetDefinitionInstructions() {
  return [
    "You are the bounded target-definition reasoner operating under the WorldManager.",
    "The harness supplies one exact canonical current Abstract Reasoning Object (ARO) and one user-authored target intent.",
    "When an existing canonical target is supplied, treat the request as a revision of that target while keeping the current ARO as the comparison anchor.",
    "Define the desired future semantic posture for the same project and concept. Do not change the project identity or concept key.",
    "An ARO is intensional. Cover requirements, relevant alternatives, edge cases, and useful counterfactuals at the semantic altitude expressed by the target intent.",
    "Reuse a current branch key when its semantic identity continues into the target, even if its statement, modality, condition, outcome, or state changes. Create a new key only for a genuinely new semantic branch. Omit a current key only when the target removes that branch.",
    "Each target branch may cite zero or more exact current branch keys as semantic lineage. Never invent a current branch key.",
    "The target is not an implementation report. Create no source paths, code claims, tests, runtime witnesses, realization bindings, or implementation coverage.",
    "Use missing or unknown honestly when the target intent leaves a distinction unresolved. Assumptions and unresolved questions are evidence for later review, not authority.",
    "The schema constrains discharge form, not semantic vocabulary.",
    `Call exactly one ${ARO_TARGET_DEFINITION_ACTION} action. Emit no prose or JSON outside the action.`,
    "The result is only a provisional target-definition candidate. It does not validate semantic truth, admit worldstate, compile a mutation contract, mutate code, launch work, or grant authority.",
  ].join("\n");
}

function targetDefinitionPrompt(
  input = {},
) {
  const currentAro = input.currentAro;
  validateAbstractReasoningObject(
    currentAro,
  );
  const targetIntent = bounded(
    input.targetIntent,
    "",
    8_000,
  );
  if (!targetIntent) {
    fail(
      "world_manager_aro_target_intent_required",
    );
  }
  return [
    "[PROJECT]",
    JSON.stringify({
      projectId: currentAro.projectId,
      name: text(
        input.project?.name,
        currentAro.projectId,
      ),
      summary: text(
        input.project?.summary,
        "",
      ),
    }),
    "[EXACT CANONICAL CURRENT ARO]",
    JSON.stringify({
      currentAroRef:
        currentAroRef(currentAro),
      conceptKey:
        currentAro.conceptKey,
      semanticIdentity:
        currentAro.semanticIdentity,
      purpose: currentAro.purpose,
      branches:
        currentAro.branches.map(
          (branch) => ({
            branchKey:
              branch.branchKey,
            parentBranchKey:
              branch.parentBranchRef
                ? currentAro.branches
                    .find((entry) =>
                      entry.branchId ===
                        branch
                          .parentBranchRef
                          .id)
                    ?.branchKey || ""
                : "",
            branchKind:
              branch.branchKind,
            modality:
              branch.modality,
            statement:
              branch.statement,
            condition:
              branch.condition,
            expectedOutcome:
              branch.expectedOutcome,
            semanticState:
              branch.semanticState,
          })),
      edges:
        currentAro.edges.map(
          (edge) => ({
            fromBranchKey:
              currentAro.branches
                .find((branch) =>
                  branch.branchId ===
                    edge.fromBranchRef.id)
                ?.branchKey || "",
            toBranchKey:
              currentAro.branches
                .find((branch) =>
                  branch.branchId ===
                    edge.toBranchRef.id)
                ?.branchKey || "",
            relationKind:
              edge.relationKind,
            rationale:
              edge.rationale,
          })),
    }),
    ...(input.existingTargetAro
      ? [
          "[EXISTING CANONICAL TARGET BASELINE]",
          JSON.stringify({
            targetAroRef:
              abstractReasoningObjectRef(
                input
                  .existingTargetAro,
              ),
            semanticIdentity:
              input.existingTargetAro
                .semanticIdentity,
            purpose:
              input.existingTargetAro
                .purpose,
            branches:
              input.existingTargetAro
                .branches.map(
                  (branch) => ({
                    branchKey:
                      branch.branchKey,
                    branchKind:
                      branch.branchKind,
                    modality:
                      branch.modality,
                    statement:
                      branch.statement,
                    condition:
                      branch.condition,
                    expectedOutcome:
                      branch
                        .expectedOutcome,
                    semanticState:
                      branch.semanticState,
                  })),
          }),
        ]
      : []),
    "[USER-AUTHORED TARGET INTENT]",
    targetIntent,
    "[DISCHARGE TASK]",
    "Produce one provisional target posture for this exact concept. Preserve semantic lineage through shared branch keys where appropriate.",
  ].join("\n");
}

function outputContract() {
  const tool = targetDefinitionTool();
  const contract = {
    schema:
      "direct_aro_target_definition_action_contract@1",
    outputContractId:
      "world_manager.aro_target_definition@1",
    selectionMechanism:
      "required_native_function_action",
    exactlyOneActionRequired: true,
    availableActionNames: [
      ARO_TARGET_DEFINITION_ACTION,
    ],
    semanticContentPosture: "open",
    sourceInspectionEffect: false,
    realizationBindingEffect: false,
    canonicalAdmissionEffect: false,
    mutationContractEffect: false,
    workerLaunchEffect: false,
    workspaceMutationEffect: false,
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

function requestManifest(input = {}) {
  const instructions =
    targetDefinitionInstructions();
  const contract = outputContract();
  const exactCurrentRef =
    currentAroRef(input.currentAro);
  const intentDigest =
    targetIntentDigest(
      input.targetIntent,
    );
  const manifest = {
    schema:
      ARO_TARGET_DEFINITION_REQUEST_MANIFEST_SCHEMA,
    requestManifestId: stableId(
      "wm_aro_target_definition_manifest",
      {
        currentAroRef:
          exactCurrentRef,
        targetBaselineRef:
          input.existingTargetAro
            ? abstractReasoningObjectRef(
                input.existingTargetAro,
              )
            : null,
        targetIntentDigest:
          intentDigest,
        attempt: input.attempt,
        outputContractDigest:
          contract.digest,
      },
    ),
    projectId:
      input.currentAro.projectId,
    currentAroRef:
      exactCurrentRef,
    targetBaselineRef:
      input.existingTargetAro
        ? abstractReasoningObjectRef(
            input.existingTargetAro,
          )
        : null,
    targetIntentDigest:
      intentDigest,
    attempt: Number(input.attempt),
    outputContractRef: exactRef({
      kind:
        "aro_target_definition_action_contract",
      id: contract.outputContractId,
      digest: contract.digest,
    }),
    rendererInstructionsAccepted: false,
    sourceInspectionEffect: false,
    realizationBindingEffect: false,
    canonicalAdmissionEffect: false,
    mutationContractEffect: false,
    workerLaunchEffect: false,
    workspaceMutationEffect: false,
    grantsAuthority: false,
  };
  manifest.digest = digestFor(
    ARO_TARGET_DEFINITION_REQUEST_MANIFEST_SCHEMA,
    manifest,
    ["digest"],
  );
  return {
    instructions,
    outputContract: contract,
    manifest,
  };
}

function parseArguments(value) {
  if (isPlainObject(value)) return value;
  try {
    const parsed = JSON.parse(
      String(value || ""),
    );
    if (isPlainObject(parsed)) {
      return parsed;
    }
  } catch {}
  fail(
    "world_manager_aro_target_arguments_invalid",
  );
}

function actionCallsFromResult(
  value = {},
) {
  if (Array.isArray(value.actionCalls)) {
    return value.actionCalls;
  }
  return (
    Array.isArray(value.normalizedEvents)
      ? value.normalizedEvents
      : []
  )
    .filter((event) =>
      event?.type ===
        "tool_call_completed")
    .map((event) => ({
      callId: event.callId,
      name:
        event.name ||
        event.toolName,
      argumentsJson:
        event.argumentsJson,
    }));
}

function orderBranches(branches) {
  const byKey = new Map();
  for (const branch of branches) {
    const key = text(
      branch.branchKey,
      "",
    );
    if (!key || byKey.has(key)) {
      fail(
        "world_manager_aro_target_branch_key_invalid",
        key,
      );
    }
    byKey.set(key, branch);
  }
  const ordered = [];
  const active = new Set();
  const complete = new Set();
  const visit = (key) => {
    if (complete.has(key)) return;
    if (active.has(key)) {
      fail(
        "world_manager_aro_target_branch_cycle",
        key,
      );
    }
    const branch = byKey.get(key);
    if (!branch) {
      fail(
        "world_manager_aro_target_branch_missing",
        key,
      );
    }
    active.add(key);
    const parentKey = text(
      branch.parentBranchKey,
      "",
    );
    if (parentKey) visit(parentKey);
    active.delete(key);
    complete.add(key);
    ordered.push(branch);
  };
  for (const key of byKey.keys()) {
    visit(key);
  }
  return ordered;
}

function normalizeTargetDefinition(
  args,
  currentAro,
) {
  exactKeys(args, [
    "targetSemanticIdentity",
    "targetPurpose",
    "definitionRationale",
    "branches",
    "edges",
    "assumptions",
    "unresolvedQuestions",
  ], "action");
  const currentBranchByKey = new Map(
    currentAro.branches.map(
      (branch) => [
        branch.branchKey,
        branch,
      ]),
  );
  const rawBranches =
    Array.isArray(args.branches)
      ? args.branches
      : [];
  if (
    rawBranches.length < 1 ||
    rawBranches.length > 24
  ) {
    fail(
      "world_manager_aro_target_branch_count_invalid",
    );
  }
  const branches = orderBranches(
    rawBranches.map((branch) => {
      exactKeys(branch, [
        "branchKey",
        "parentBranchKey",
        "branchKind",
        "modality",
        "statement",
        "condition",
        "expectedOutcome",
        "semanticState",
        "currentBranchKeys",
      ], "branch");
      if (
        !BRANCH_MODALITIES.has(
          branch.modality,
        ) ||
        !BRANCH_STATES.has(
          branch.semanticState,
        )
      ) {
        fail(
          "world_manager_aro_target_branch_form_invalid",
          text(branch.branchKey, ""),
        );
      }
      const currentBranchKeys =
        uniqueStrings(
          branch.currentBranchKeys,
        );
      const provenanceRefs =
        currentBranchKeys.map((key) => {
          const current =
            currentBranchByKey.get(key);
          if (!current) {
            fail(
              "world_manager_aro_target_current_branch_unresolved",
              key,
            );
          }
          return {
            kind: "aro_branch",
            id: current.branchId,
            digest: current.digest,
            projectId:
              currentAro.projectId,
            label: current.statement,
          };
        });
      return {
        branchKey: text(
          branch.branchKey,
          "",
        ),
        parentBranchKey: text(
          branch.parentBranchKey,
          "",
        ),
        branchKind: text(
          branch.branchKind,
          "semantic_requirement",
        ),
        modality: branch.modality,
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
        expectedOutcome: bounded(
          branch.expectedOutcome,
          "",
          800,
        ),
        semanticState:
          branch.semanticState,
        provenanceRefs:
          provenanceRefs.length
            ? provenanceRefs
            : [
                currentAroRef(
                  currentAro,
                ),
              ],
      };
    }),
  );
  const branchKeys = new Set(
    branches.map((branch) =>
      branch.branchKey),
  );
  const edges = (
    Array.isArray(args.edges)
      ? args.edges
      : []
  ).map((edge) => {
    exactKeys(edge, [
      "fromBranchKey",
      "toBranchKey",
      "relationKind",
      "rationale",
    ], "edge");
    if (
      !branchKeys.has(
        edge.fromBranchKey,
      ) ||
      !branchKeys.has(
        edge.toBranchKey,
      ) ||
      !EDGE_RELATIONS.has(
        edge.relationKind,
      )
    ) {
      fail(
        "world_manager_aro_target_edge_invalid",
      );
    }
    return {
      fromBranchKey:
        edge.fromBranchKey,
      toBranchKey:
        edge.toBranchKey,
      relationKind:
        edge.relationKind,
      rationale: bounded(
        edge.rationale,
        "",
        800,
      ),
    };
  });
  return {
    targetSemanticIdentity: bounded(
      args.targetSemanticIdentity,
      currentAro.semanticIdentity,
      300,
    ),
    targetPurpose: bounded(
      args.targetPurpose,
      currentAro.purpose,
      1_200,
    ),
    definitionRationale: bounded(
      args.definitionRationale,
      "",
      1_200,
    ),
    branches,
    edges,
    assumptions:
      uniqueStrings(args.assumptions)
        .map((entry) =>
          bounded(entry, "", 800)),
    unresolvedQuestions:
      uniqueStrings(
        args.unresolvedQuestions,
      ).map((entry) =>
        bounded(entry, "", 800)),
  };
}

function validateTargetAction(
  runnerResult,
  currentAro,
) {
  const actionCalls =
    actionCallsFromResult(runnerResult);
  const errors = [];
  let result = null;
  try {
    if (
      actionCalls.length !== 1 ||
      actionCalls[0].name !==
        ARO_TARGET_DEFINITION_ACTION
    ) {
      fail(
        "world_manager_aro_target_exact_action_required",
        String(actionCalls.length),
      );
    }
    result = normalizeTargetDefinition(
      parseArguments(
        actionCalls[0].argumentsJson ??
          actionCalls[0].arguments ??
          actionCalls[0].payload,
      ),
      currentAro,
    );
  } catch (error) {
    errors.push({
      code: text(
        error?.code,
        "world_manager_aro_target_validation_failed",
      ),
      detail: bounded(
        error?.detail ||
          error?.message,
        "",
        500,
      ),
    });
  }
  const validation = {
    schema:
      ARO_TARGET_DEFINITION_VALIDATION_SCHEMA,
    state: errors.length
      ? "remanded"
      : "validated",
    requiredContract:
      "exactly_one_native_aro_target_definition_action",
    observedActionNames:
      actionCalls
        .map((call) =>
          text(call.name, ""))
        .filter(Boolean),
    errors,
    semanticContentValidatedAgainstClosedTaxonomy:
      false,
    semanticTruthValidated: false,
    sourceInspectionEffect: false,
    realizationBindingEffect: false,
    canonicalAdmissionEffect: false,
    mutationContractEffect: false,
    workerLaunchEffect: false,
    workspaceMutationEffect: false,
    grantsAuthority: false,
  };
  validation.digest = digestFor(
    ARO_TARGET_DEFINITION_VALIDATION_SCHEMA,
    validation,
    ["digest"],
  );
  return { validation, result };
}

function normalizeTelemetry(
  value = {},
  state,
) {
  return {
    runtimeMode: text(
      value.runtimeMode,
      "direct_live",
    ),
    model: text(value.model, ""),
    reasoningEffort: text(
      value.reasoningEffort,
      "medium",
    ),
    inputTokens: Math.max(
      0,
      Number(value.inputTokens || 0),
    ),
    outputTokens: Math.max(
      0,
      Number(value.outputTokens || 0),
    ),
    toolCallCount: Math.max(
      0,
      Number(value.toolCallCount || 0),
    ),
    toolNames: uniqueStrings(
      value.toolNames,
    ),
    telemetrySource: text(
      value.telemetrySource,
      "harness_observed",
    ),
    terminalState: state,
    effectCount: 0,
    rawProviderPayloadStored: false,
    rawChainOfThoughtStored: false,
  };
}

function buildAroTargetDefinitionRun(
  input = {},
) {
  const state = text(
    input.state,
    "scheduled",
  );
  if (!RUN_STATES.has(state)) {
    fail(
      "world_manager_aro_target_run_state_invalid",
      state,
    );
  }
  const projectId = text(
    input.projectId,
    "",
  );
  const exactCurrentRef = exactRef(
    input.currentAroRef,
    "targetRun.currentAroRef",
  );
  const intent = bounded(
    input.targetIntent,
    "",
    8_000,
  );
  const intentDigest =
    targetIntentDigest(intent);
  const targetBaselineRef =
    input.targetBaselineRef
      ? exactRef(
          input.targetBaselineRef,
          "targetRun.targetBaselineRef",
        )
      : null;
  const definitionKeyDigest =
    targetDefinitionKeyDigest(
      exactCurrentRef,
      targetBaselineRef,
      intentDigest,
    );
  if (
    !projectId ||
    !intent ||
    text(
      input.targetIntentDigest,
      intentDigest,
    ) !== intentDigest ||
    text(
      input.definitionKeyDigest,
      definitionKeyDigest,
    ) !== definitionKeyDigest
  ) {
    fail(
      "world_manager_aro_target_run_identity_invalid",
    );
  }
  const attempt = Number(
    input.attempt || 1,
  );
  const runRevision = Number(
    input.runRevision || 1,
  );
  if (
    !Number.isInteger(attempt) ||
    attempt < 1 ||
    !Number.isInteger(runRevision) ||
    runRevision < 1
  ) {
    fail(
      "world_manager_aro_target_run_revision_invalid",
    );
  }
  const runId = text(
    input.runId,
    stableId(
      "wm_aro_target_definition_run",
      {
        currentAroRef:
          exactCurrentRef,
        targetBaselineRef,
        targetIntentDigest:
          intentDigest,
        attempt,
      },
    ),
  );
  const predecessorRef =
    input.predecessorRef
      ? exactRef(
          input.predecessorRef,
          "targetRun.predecessorRef",
        )
      : null;
  if (
    (runRevision === 1) ===
      Boolean(predecessorRef)
  ) {
    fail(
      "world_manager_aro_target_run_lineage_invalid",
    );
  }
  const candidateRef =
    input.candidateRef
      ? exactRef(
          input.candidateRef,
          "targetRun.candidateRef",
        )
      : null;
  const error = input.error
    ? {
        code: text(
          input.error.code,
          "world_manager_aro_target_definition_failed",
        ),
        message: bounded(
          input.error.message,
          "ARO target definition failed.",
          500,
        ),
      }
    : null;
  const run = {
    schema:
      ARO_TARGET_DEFINITION_RUN_SCHEMA,
    runId,
    runRevision,
    predecessorRef,
    projectId,
    currentAroRef:
      exactCurrentRef,
    targetBaselineRef,
    targetIntent: intent,
    targetIntentDigest:
      intentDigest,
    definitionKeyDigest,
    attempt,
    state,
    requestManifest:
      input.requestManifest || null,
    validation:
      input.validation || null,
    candidateRef,
    definitionRationale: bounded(
      input.definitionRationale,
      "",
      1_200,
    ),
    assumptions:
      uniqueStrings(input.assumptions)
        .map((entry) =>
          bounded(entry, "", 800)),
    unresolvedQuestions:
      uniqueStrings(
        input.unresolvedQuestions,
      ).map((entry) =>
        bounded(entry, "", 800)),
    error,
    telemetry:
      input.telemetry || null,
    retryable:
      RETRYABLE_RUN_STATES.has(
        state,
      ),
    sourceInspectionEffect: false,
    realizationBindingEffect: false,
    canonicalAdmissionEffect: false,
    mutationContractEffect: false,
    workerLaunchEffect: false,
    workspaceMutationEffect: false,
    canonical: false,
    grantsAuthority: false,
    createdAt: text(
      input.createdAt,
      nowIso(input.now),
    ),
    updatedAt: text(
      input.updatedAt,
      input.createdAt ||
        nowIso(input.now),
    ),
  };
  run.digest = digestFor(
    ARO_TARGET_DEFINITION_RUN_SCHEMA,
    run,
    ["digest"],
  );
  validateAroTargetDefinitionRun(run);
  return run;
}

function validateAroTargetDefinitionRun(
  value,
) {
  if (
    !isPlainObject(value) ||
    value.schema !==
      ARO_TARGET_DEFINITION_RUN_SCHEMA ||
    !text(value.runId, "") ||
    !Number.isInteger(
      Number(value.runRevision),
    ) ||
    !text(value.projectId, "") ||
    !text(value.targetIntent, "") ||
    value.targetIntentDigest !==
      targetIntentDigest(
        value.targetIntent,
      ) ||
    value.definitionKeyDigest !==
      targetDefinitionKeyDigest(
        value.currentAroRef,
        value.targetBaselineRef,
        value.targetIntentDigest,
      ) ||
    !Number.isInteger(
      Number(value.attempt),
    ) ||
    !RUN_STATES.has(value.state) ||
    value.retryable !==
      RETRYABLE_RUN_STATES.has(
        value.state,
      ) ||
    value.sourceInspectionEffect !==
      false ||
    value.realizationBindingEffect !==
      false ||
    value.canonicalAdmissionEffect !==
      false ||
    value.mutationContractEffect !==
      false ||
    value.workerLaunchEffect !== false ||
    value.workspaceMutationEffect !==
      false ||
    value.canonical !== false ||
    value.grantsAuthority !== false ||
    value.digest !==
      digestFor(
        ARO_TARGET_DEFINITION_RUN_SCHEMA,
        value,
        ["digest"],
      )
  ) {
    fail(
      "world_manager_aro_target_run_invalid",
    );
  }
  if (
    (Number(value.runRevision) === 1) ===
      Boolean(value.predecessorRef)
  ) {
    fail(
      "world_manager_aro_target_run_lineage_invalid",
    );
  }
  exactRef(
    value.currentAroRef,
    "targetRun.currentAroRef",
  );
  if (value.targetBaselineRef) {
    exactRef(
      value.targetBaselineRef,
      "targetRun.targetBaselineRef",
    );
  }
  if (value.predecessorRef) {
    exactRef(
      value.predecessorRef,
      "targetRun.predecessorRef",
    );
  }
  if (value.candidateRef) {
    exactRef(
      value.candidateRef,
      "targetRun.candidateRef",
    );
  }
  if (
    value.state === "completed" &&
    !value.candidateRef
  ) {
    fail(
      "world_manager_aro_target_completed_without_candidate",
    );
  }
  return true;
}

function reviseAroTargetDefinitionRun(
  current,
  input = {},
) {
  validateAroTargetDefinitionRun(
    current,
  );
  if (
    TERMINAL_RUN_STATES.has(
      current.state,
    )
  ) {
    fail(
      "world_manager_aro_target_terminal_run_immutable",
      current.runId,
    );
  }
  return buildAroTargetDefinitionRun({
    ...current,
    ...input,
    runRevision:
      current.runRevision + 1,
    predecessorRef: exactRef({
      kind:
        "aro_target_definition_run",
      id: current.runId,
      digest: current.digest,
      projectId: current.projectId,
    }),
    updatedAt: text(
      input.updatedAt,
      nowIso(input.now),
    ),
    digest: undefined,
  });
}

function targetCandidateFromResult(
  result,
  input = {},
) {
  const currentAro = input.currentAro;
  const repositorySnapshotRef = exactRef(
    input.repositorySnapshotRef,
    "targetCandidate.repositorySnapshotRef",
  );
  const exactCurrentRef =
    currentAroRef(currentAro);
  const intentDigest =
    targetIntentDigest(
      input.targetIntent,
    );
  const exactIntentRef =
    targetIntentRef(
      currentAro,
      input.targetIntent,
    );
  const evidenceRefs = [
    exactCurrentRef,
    exactIntentRef,
    ...(input.existingTargetAro
      ? [
          abstractReasoningObjectRef(
            input.existingTargetAro,
          ),
        ]
      : []),
    repositorySnapshotRef,
    ...currentAro.provenanceRefs,
  ];
  const candidate =
    buildAroReconstructionCandidate({
      candidateId: stableId(
        "wm_aro_target_definition_candidate",
        {
          currentAroRef:
            exactCurrentRef,
          targetBaselineRef:
            input.existingTargetAro
              ? abstractReasoningObjectRef(
                  input
                    .existingTargetAro,
                )
              : null,
          targetIntentDigest:
            intentDigest,
        },
      ),
      projectId:
        currentAro.projectId,
      repositorySnapshotRef,
      evidenceRefs,
      contradictionRefs: [],
      reconstructionMethod:
        "semantic_target_definition",
      createdAt: input.createdAt,
      now: input.now,
      candidateAro: {
        projectId:
          currentAro.projectId,
        conceptKey:
          currentAro.conceptKey,
        semanticIdentity:
          result
            .targetSemanticIdentity,
        purpose:
          result.targetPurpose,
        posture: "target",
        branches: result.branches,
        edges: result.edges,
        realizationBindings: [],
        counterpartRef:
          exactCurrentRef,
        provenanceRefs:
          evidenceRefs,
      },
    });
  validateAroReconstructionCandidate(
    candidate,
  );
  if (
    candidate.candidateAro.posture !==
      "target" ||
    candidate.candidateAro.conceptKey !==
      currentAro.conceptKey ||
    candidate.candidateAro
      .realizationBindings.length !== 0 ||
    !exactRefMatches(
      candidate.candidateAro
        .counterpartRef,
      exactCurrentRef,
    )
  ) {
    fail(
      "world_manager_aro_target_candidate_boundary",
    );
  }
  return candidate;
}

class DirectAroTargetDefinitionRuntime {
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
    const currentAro = input.currentAro;
    validateAbstractReasoningObject(
      currentAro,
    );
    if (
      currentAro.canonical !== true ||
      currentAro.lifecycle !== "active" ||
      currentAro.posture !== "current"
    ) {
      fail(
        "world_manager_aro_target_current_boundary",
      );
    }
    const existingTargetAro =
      input.existingTargetAro || null;
    if (existingTargetAro) {
      validateAbstractReasoningObject(
        existingTargetAro,
      );
      if (
        existingTargetAro
          .canonical !== true ||
        existingTargetAro
          .lifecycle !== "active" ||
        existingTargetAro
          .posture !== "target" ||
        existingTargetAro
          .projectId !==
          currentAro.projectId ||
        existingTargetAro
          .conceptKey !==
          currentAro.conceptKey
      ) {
        fail(
          "world_manager_aro_target_baseline_invalid",
        );
      }
    }
    const targetIntent = bounded(
      input.targetIntent,
      "",
      8_000,
    );
    if (!targetIntent) {
      fail(
        "world_manager_aro_target_intent_required",
      );
    }
    const attempt = Math.max(
      1,
      Number(input.attempt || 1),
    );
    const createdAt = nowIso(this.now);
    const {
      instructions,
      outputContract: contract,
      manifest,
    } = requestManifest({
      currentAro,
      targetIntent,
      existingTargetAro:
        existingTargetAro,
      attempt,
    });
    if (!this.runner) {
      fail(
        "world_manager_aro_target_runner_unavailable",
      );
    }
    let runnerResult;
    try {
      runnerResult = await this.runner({
        schema:
          "direct_aro_target_definition_runner_request@1",
        projectId:
          currentAro.projectId,
        currentAroRef:
          currentAroRef(currentAro),
        targetBaselineRef:
          existingTargetAro
            ? abstractReasoningObjectRef(
                existingTargetAro,
              )
            : null,
        targetIntentDigest:
          targetIntentDigest(
            targetIntent,
          ),
        attempt,
        instructions,
        prompt: targetDefinitionPrompt({
          project: input.project,
          currentAro,
          existingTargetAro:
            existingTargetAro,
          targetIntent,
        }),
        outputContract: contract,
        tools: contract.tools,
        toolChoicePolicy: "required",
        reasoningEffort: text(
          input.reasoningEffort,
          "medium",
        ),
        sourceInspectionEffect: false,
        realizationBindingEffect: false,
        canonicalAdmissionEffect: false,
        mutationContractEffect: false,
        workerLaunchEffect: false,
        workspaceMutationEffect: false,
        grantsAuthority: false,
      });
    } catch (error) {
      return {
        state: "failed",
        requestManifest: manifest,
        validation: null,
        candidate: null,
        definitionRationale: "",
        assumptions: [],
        unresolvedQuestions: [],
        telemetry:
          normalizeTelemetry(
            {},
            "failed",
          ),
        error: {
          code: text(
            error?.code,
            "world_manager_aro_target_runner_failed",
          ),
          message: bounded(
            error?.message,
            "Direct ARO target definition failed.",
            500,
          ),
        },
      };
    }
    const validated =
      validateTargetAction(
        runnerResult,
        currentAro,
      );
    if (
      validated.validation.state !==
        "validated"
    ) {
      return {
        state: "remanded",
        requestManifest: manifest,
        validation:
          validated.validation,
        candidate: null,
        definitionRationale: "",
        assumptions: [],
        unresolvedQuestions: [],
        telemetry:
          normalizeTelemetry(
            runnerResult?.telemetry,
            "remanded",
          ),
        error: {
          code:
            validated.validation
              .errors[0]?.code ||
            "world_manager_aro_target_remanded",
          message:
            validated.validation
              .errors[0]?.detail ||
            "The target-definition action did not satisfy its discharge form.",
        },
      };
    }
    const candidate =
      targetCandidateFromResult(
        validated.result,
        {
          currentAro,
          existingTargetAro:
            existingTargetAro,
          targetIntent,
          repositorySnapshotRef:
            input
              .repositorySnapshotRef,
          createdAt,
          now: this.now,
        },
      );
    return {
      state: "completed",
      requestManifest: manifest,
      validation:
        validated.validation,
      candidate,
      definitionRationale:
        validated.result
          .definitionRationale,
      assumptions:
        validated.result.assumptions,
      unresolvedQuestions:
        validated.result
          .unresolvedQuestions,
      telemetry:
        normalizeTelemetry(
          runnerResult?.telemetry,
          "completed",
        ),
      error: null,
    };
  }
}

module.exports = {
  ARO_TARGET_DEFINITION_ACTION,
  ARO_TARGET_DEFINITION_REQUEST_MANIFEST_SCHEMA,
  ARO_TARGET_DEFINITION_RUN_SCHEMA,
  ARO_TARGET_DEFINITION_VALIDATION_SCHEMA,
  DirectAroTargetDefinitionRuntime,
  buildAroTargetDefinitionRun,
  currentAroRef,
  reviseAroTargetDefinitionRun,
  targetDefinitionInstructions,
  targetDefinitionKeyDigest,
  targetDefinitionPrompt,
  targetDefinitionTool,
  targetIntentRef,
  targetIntentDigest,
  validateAroTargetDefinitionRun,
};
