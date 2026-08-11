"use strict";

const {
  abstractReasoningObjectRef,
  branchRef,
  digestFor,
  stableId,
  validateAbstractReasoningObject,
  validateAroCurrentTargetComparison,
} = require("./aro-kernel");

const ARO_MUTATION_CONTRACT_SCHEMA =
  "direct_aro_mutation_contract@1";
const ARO_MUTATION_COMPILATION_RUN_SCHEMA =
  "direct_aro_mutation_compilation_run@1";
const ARO_MUTATION_VALIDATION_SCHEMA =
  "direct_aro_mutation_contract_validation@1";
const ARO_MUTATION_REQUEST_MANIFEST_SCHEMA =
  "direct_aro_mutation_contract_request_manifest@1";
const ARO_MUTATION_DELTA_SCHEMA =
  "direct_aro_mutation_delta@1";
const ARO_MUTATION_ACTION =
  "wm_discharge_aro_mutation_contract";

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
  if (
    !ref.kind ||
    !ref.id ||
    !ref.digest
  ) {
    fail(
      "world_manager_aro_mutation_ref_invalid",
      label,
    );
  }
  const projectId = text(
    value.projectId,
    "",
  );
  if (projectId) {
    ref.projectId = projectId;
  }
  const labelText = text(
    value.label,
    "",
  );
  if (labelText) {
    ref.label = bounded(
      labelText,
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
  const seen = new Set();
  return (
    Array.isArray(values) ? values : []
  )
    .map((value, index) =>
      exactRef(
        value,
        `refs.${index}`,
      ))
    .filter((ref) => {
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
      "world_manager_aro_mutation_object_required",
      label,
    );
  }
  const actual =
    Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (
    actual.length !== wanted.length ||
    actual.some(
      (key, index) =>
        key !== wanted[index],
    )
  ) {
    fail(
      "world_manager_aro_mutation_form_mismatch",
      label,
    );
  }
}

function comparisonRef(comparison) {
  validateAroCurrentTargetComparison(
    comparison,
  );
  return exactRef({
    kind:
      "aro_current_target_comparison",
    id: comparison.comparisonId,
    digest: comparison.digest,
    projectId: comparison.projectId,
  });
}

function mutationContractRef(contract) {
  validateAroMutationContract(contract);
  return exactRef({
    kind: "aro_mutation_contract",
    id: contract.contractId,
    digest: contract.digest,
    projectId: contract.projectId,
  });
}

function branchMap(
  currentAro,
  targetAro,
) {
  const map = new Map();
  for (
    const [posture, aro] of [
      ["current", currentAro],
      ["target", targetAro],
    ]
  ) {
    for (const branch of aro.branches) {
      map.set(
        `${posture}:${branch.branchKey}`,
        {
          posture,
          branch,
          ref: branchRef(branch),
        },
      );
    }
  }
  return map;
}

function targetGapBranchRefs(targetAro) {
  const witness =
    targetAro.coverageWitness;
  return uniqueRefs(
    (witness?.branchCoverage || [])
      .filter((entry) =>
        entry.coverageState !==
          "realized")
      .map((entry) =>
        entry.branchRef),
  );
}

function buildAroMutationDelta(
  currentAro,
  targetAro,
  comparison,
) {
  validateAbstractReasoningObject(
    currentAro,
  );
  validateAbstractReasoningObject(
    targetAro,
  );
  validateAroCurrentTargetComparison(
    comparison,
  );
  if (
    !exactRefMatches(
      comparison.currentAroRef,
      abstractReasoningObjectRef(
        currentAro,
      ),
    ) ||
    !exactRefMatches(
      comparison.targetAroRef,
      abstractReasoningObjectRef(
        targetAro,
      ),
    )
  ) {
    fail(
      "world_manager_aro_mutation_comparison_binding_invalid",
    );
  }
  const targetGapRefs =
    targetGapBranchRefs(targetAro);
  const operativeTargetBranchRefs =
    uniqueRefs([
      ...comparison
        .targetOnlyBranchRefs,
      ...comparison.conflictPairs.map(
        (pair) =>
          pair.targetBranchRef,
      ),
      ...targetGapRefs,
    ]);
  const delta = {
    schema: ARO_MUTATION_DELTA_SCHEMA,
    comparisonRef:
      comparisonRef(comparison),
    currentAroRef:
      abstractReasoningObjectRef(
        currentAro,
      ),
    targetAroRef:
      abstractReasoningObjectRef(
        targetAro,
      ),
    targetOnlyBranchRefs:
      comparison.targetOnlyBranchRefs,
    currentOnlyBranchRefs:
      comparison.currentOnlyBranchRefs,
    conflictPairs:
      comparison.conflictPairs,
    targetGapBranchRefs:
      targetGapRefs,
    operativeTargetBranchRefs,
    mutationRequired:
      operativeTargetBranchRefs.length >
        0 ||
      comparison.currentOnlyBranchRefs
        .length > 0,
    semanticTruthValidated: false,
    codeMutationAuthorized: false,
    grantsAuthority: false,
  };
  delta.digest = digestFor(
    delta.schema,
    delta,
    ["digest"],
  );
  validateAroMutationDelta(delta);
  return delta;
}

function validateAroMutationDelta(value) {
  if (
    !isPlainObject(value) ||
    value.schema !==
      ARO_MUTATION_DELTA_SCHEMA ||
    !Array.isArray(
      value.targetOnlyBranchRefs,
    ) ||
    !Array.isArray(
      value.currentOnlyBranchRefs,
    ) ||
    !Array.isArray(value.conflictPairs) ||
    !Array.isArray(
      value.targetGapBranchRefs,
    ) ||
    !Array.isArray(
      value.operativeTargetBranchRefs,
    ) ||
    typeof value.mutationRequired !==
      "boolean" ||
    value.semanticTruthValidated !==
      false ||
    value.codeMutationAuthorized !==
      false ||
    value.grantsAuthority !== false ||
    value.digest !==
      digestFor(
        ARO_MUTATION_DELTA_SCHEMA,
        value,
        ["digest"],
      )
  ) {
    fail(
      "world_manager_aro_mutation_delta_invalid",
    );
  }
  exactRef(
    value.comparisonRef,
    "mutationDelta.comparisonRef",
  );
  exactRef(
    value.currentAroRef,
    "mutationDelta.currentAroRef",
  );
  exactRef(
    value.targetAroRef,
    "mutationDelta.targetAroRef",
  );
  for (
    const [label, refs] of [
      [
        "targetOnlyBranchRefs",
        value.targetOnlyBranchRefs,
      ],
      [
        "currentOnlyBranchRefs",
        value.currentOnlyBranchRefs,
      ],
      [
        "targetGapBranchRefs",
        value.targetGapBranchRefs,
      ],
      [
        "operativeTargetBranchRefs",
        value.operativeTargetBranchRefs,
      ],
    ]
  ) {
    refs.forEach((ref, index) =>
      exactRef(
        ref,
        `mutationDelta.${label}.${index}`,
      ));
  }
  value.conflictPairs.forEach(
    (pair, index) => {
      if (
        !isPlainObject(pair) ||
        !text(pair.branchKey, "") ||
        !Array.isArray(
          pair.distinctions,
        )
      ) {
        fail(
          "world_manager_aro_mutation_delta_conflict_invalid",
          String(index),
        );
      }
      exactRef(
        pair.currentBranchRef,
        `mutationDelta.conflictPairs.${index}.current`,
      );
      exactRef(
        pair.targetBranchRef,
        `mutationDelta.conflictPairs.${index}.target`,
      );
    },
  );
  const expectedMutationRequired =
    value.operativeTargetBranchRefs
      .length > 0 ||
    value.currentOnlyBranchRefs.length >
      0;
  if (
    value.mutationRequired !==
      expectedMutationRequired
  ) {
    fail(
      "world_manager_aro_mutation_delta_posture_invalid",
    );
  }
  return true;
}

function selectorToolSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      posture: {
        type: "string",
        enum: ["current", "target"],
      },
      branchKey: {
        type: "string",
      },
    },
    required: [
      "posture",
      "branchKey",
    ],
  };
}

function mutationContractTool() {
  const selector =
    selectorToolSchema();
  return {
    type: "function",
    name: ARO_MUTATION_ACTION,
    description:
      "Discharge one provisional implementation contract from the exact current/target ARO delta. This action authors semantic obligations and verification requirements only. It cannot inspect code, launch a worker, mutate a workspace, admit canonical state, or grant authority.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        disposition: {
          type: "string",
          enum: [
            "mutation_required",
            "no_change_required",
          ],
        },
        contractSummary: {
          type: "string",
        },
        changeStrategy: {
          type: "string",
        },
        implementationObligations: {
          type: "array",
          maxItems: 24,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              obligationKey: {
                type: "string",
              },
              obligationKind: {
                type: "string",
              },
              title: {
                type: "string",
              },
              objective: {
                type: "string",
              },
              branchSelectors: {
                type: "array",
                minItems: 1,
                items: selector,
              },
              preservationConstraintKeys: {
                type: "array",
                items: {
                  type: "string",
                },
              },
              verificationRequirementKeys: {
                type: "array",
                minItems: 1,
                items: {
                  type: "string",
                },
              },
              priority: {
                type: "string",
              },
              rationale: {
                type: "string",
              },
            },
            required: [
              "obligationKey",
              "obligationKind",
              "title",
              "objective",
              "branchSelectors",
              "preservationConstraintKeys",
              "verificationRequirementKeys",
              "priority",
              "rationale",
            ],
          },
        },
        verificationRequirements: {
          type: "array",
          maxItems: 32,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              verificationKey: {
                type: "string",
              },
              verificationKind: {
                type: "string",
              },
              claim: {
                type: "string",
              },
              successCondition: {
                type: "string",
              },
              branchSelectors: {
                type: "array",
                minItems: 1,
                items: selector,
              },
              requiredEvidenceKinds: {
                type: "array",
                items: {
                  type: "string",
                },
              },
            },
            required: [
              "verificationKey",
              "verificationKind",
              "claim",
              "successCondition",
              "branchSelectors",
              "requiredEvidenceKinds",
            ],
          },
        },
        preservationConstraints: {
          type: "array",
          maxItems: 24,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              constraintKey: {
                type: "string",
              },
              statement: {
                type: "string",
              },
              branchSelectors: {
                type: "array",
                minItems: 1,
                items: selector,
              },
            },
            required: [
              "constraintKey",
              "statement",
              "branchSelectors",
            ],
          },
        },
        assumptions: {
          type: "array",
          items: {
            type: "string",
          },
        },
        unresolvedQuestions: {
          type: "array",
          items: {
            type: "string",
          },
        },
      },
      required: [
        "disposition",
        "contractSummary",
        "changeStrategy",
        "implementationObligations",
        "verificationRequirements",
        "preservationConstraints",
        "assumptions",
        "unresolvedQuestions",
      ],
    },
  };
}

function mutationInstructions() {
  return [
    "You are the bounded implementation-contract compiler operating under the WorldManager.",
    "Reason only about the supplied exact current ARO, target ARO, their comparison, and target coverage. Do not inspect or invent source files.",
    "Translate the semantic delta into explicit implementation obligations, preservation constraints, and verification requirements.",
    "Every target-only, conflicting target, and target coverage-gap branch must be covered by at least one obligation. Every current-only branch must be addressed by an obligation or preservation constraint.",
    "Branch selectors must use only supplied posture and branch keys. Verification keys and preservation keys must resolve exactly.",
    "Use open semantic vocabulary for obligation kinds, verification kinds, priorities, strategies, assumptions, and questions. The schema constrains form, not meaning.",
    "If the mechanically supplied delta is empty, select no_change_required and return empty obligation, verification, and preservation arrays.",
    "Do not claim code locations, code correctness, completed realization, test success, semantic truth, or execution authority.",
    "Call exactly one wm_discharge_aro_mutation_contract action. Emit no prose or JSON outside the action.",
    "The result is a provisional SC8.1 contract only. It cannot launch a worker, mutate code, admit worldstate, or grant authority.",
  ].join("\n");
}

function branchPromptShape(aro) {
  return aro.branches.map((branch) => ({
    branchKey: branch.branchKey,
    branchKind: branch.branchKind,
    modality: branch.modality,
    statement: branch.statement,
    condition: branch.condition,
    expectedOutcome:
      branch.expectedOutcome,
    semanticState:
      branch.semanticState,
    coverageState:
      aro.coverageWitness
        .branchCoverage.find((entry) =>
          entry.branchRef.id ===
            branch.branchId)
        ?.coverageState ||
      "absent",
  }));
}

function mutationPrompt(input = {}) {
  const {
    currentAro,
    targetAro,
    comparison,
  } = input;
  const delta = buildAroMutationDelta(
    currentAro,
    targetAro,
    comparison,
  );
  return [
    "[PROJECT]",
    JSON.stringify({
      projectId: comparison.projectId,
      conceptKey:
        comparison.conceptKey,
      name: text(
        input.project?.name,
        comparison.projectId,
      ),
      summary: text(
        input.project?.summary,
        "",
      ),
    }),
    "[CURRENT ARO]",
    JSON.stringify({
      aroRef:
        abstractReasoningObjectRef(
          currentAro,
        ),
      semanticIdentity:
        currentAro.semanticIdentity,
      purpose: currentAro.purpose,
      branches:
        branchPromptShape(currentAro),
    }),
    "[TARGET ARO]",
    JSON.stringify({
      aroRef:
        abstractReasoningObjectRef(
          targetAro,
        ),
      semanticIdentity:
        targetAro.semanticIdentity,
      purpose: targetAro.purpose,
      branches:
        branchPromptShape(targetAro),
    }),
    "[MECHANICALLY DERIVED DELTA]",
    JSON.stringify(delta),
    "[CONTRACT TASK]",
    "Discharge a provisional implementation contract that accounts for every operative semantic distinction without guessing the realization substrate.",
  ].join("\n");
}

function outputContract() {
  const contract = {
    schema:
      "direct_aro_mutation_action_contract@1",
    outputContractId:
      "world_manager.aro_mutation_contract@1",
    selectionMechanism:
      "required_native_function_action",
    exactlyOneActionRequired: true,
    availableActionNames: [
      ARO_MUTATION_ACTION,
    ],
    semanticContentPosture: "open",
    sourceInspectionEffect: false,
    workerLaunchEffect: false,
    workspaceMutationEffect: false,
    canonicalAdmissionEffect: false,
    grantsAuthority: false,
    tools: [
      mutationContractTool(),
    ],
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
    mutationInstructions();
  const actionContract =
    outputContract();
  const manifest = {
    schema:
      ARO_MUTATION_REQUEST_MANIFEST_SCHEMA,
    requestManifestId: stableId(
      "wm_aro_mutation_manifest",
      {
        projectId: input.projectId,
        comparisonRef:
          comparisonRef(
            input.comparison,
          ),
        attempt: input.attempt,
        instructionsDigest:
          digestFor(
            "direct_aro_mutation_instructions@1",
            { instructions },
          ),
        outputContractDigest:
          actionContract.digest,
      },
    ),
    projectId: input.projectId,
    comparisonRef:
      comparisonRef(input.comparison),
    currentAroRef:
      abstractReasoningObjectRef(
        input.currentAro,
      ),
    targetAroRef:
      abstractReasoningObjectRef(
        input.targetAro,
      ),
    attempt: Number(input.attempt),
    instructionPackageRef:
      exactRef({
        kind:
          "trusted_aro_mutation_instruction_package",
        id:
          "world_manager.aro_mutation_contract@1",
        digest: digestFor(
          "direct_aro_mutation_instructions@1",
          { instructions },
        ),
      }),
    outputContractRef: exactRef({
      kind:
        "aro_mutation_action_contract",
      id:
        actionContract.outputContractId,
      digest:
        actionContract.digest,
    }),
    rendererInstructionsAccepted: false,
    sourceInspectionEffect: false,
    workerLaunchEffect: false,
    workspaceMutationEffect: false,
    canonicalAdmissionEffect: false,
    grantsAuthority: false,
  };
  manifest.digest = digestFor(
    ARO_MUTATION_REQUEST_MANIFEST_SCHEMA,
    manifest,
    ["digest"],
  );
  return {
    instructions,
    outputContract:
      actionContract,
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
    "world_manager_aro_mutation_arguments_invalid",
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

function resolveSelectors(
  values,
  branches,
  label,
) {
  if (!Array.isArray(values)) {
    fail(
      "world_manager_aro_mutation_selectors_invalid",
      label,
    );
  }
  return values.map(
    (selector, index) => {
      exactKeys(
        selector,
        [
          "posture",
          "branchKey",
        ],
        `${label}.${index}`,
      );
      const key =
        `${selector.posture}:${selector.branchKey}`;
      const entry = branches.get(key);
      if (!entry) {
        fail(
          "world_manager_aro_mutation_branch_selector_unresolved",
          key,
        );
      }
      return entry.ref;
    },
  );
}

function normalizeActionResult(
  args,
  context,
) {
  exactKeys(args, [
    "disposition",
    "contractSummary",
    "changeStrategy",
    "implementationObligations",
    "verificationRequirements",
    "preservationConstraints",
    "assumptions",
    "unresolvedQuestions",
  ], "action");
  if (
    ![
      "mutation_required",
      "no_change_required",
    ].includes(args.disposition)
  ) {
    fail(
      "world_manager_aro_mutation_disposition_invalid",
    );
  }
  const rawRequirements =
    Array.isArray(
      args.verificationRequirements,
    )
      ? args.verificationRequirements
      : [];
  const verificationKeys =
    new Set();
  const verificationRequirements =
    rawRequirements.map(
      (requirement, index) => {
        exactKeys(requirement, [
          "verificationKey",
          "verificationKind",
          "claim",
          "successCondition",
          "branchSelectors",
          "requiredEvidenceKinds",
        ], `verification.${index}`);
        const key = text(
          requirement.verificationKey,
          "",
        );
        if (
          !key ||
          verificationKeys.has(key)
        ) {
          fail(
            "world_manager_aro_mutation_verification_key_invalid",
            key,
          );
        }
        verificationKeys.add(key);
        return {
          verificationKey: key,
          verificationKind: bounded(
            requirement.verificationKind,
            "semantic_verification",
            160,
          ),
          claim: bounded(
            requirement.claim,
            "",
            1_200,
          ),
          successCondition: bounded(
            requirement.successCondition,
            "",
            1_200,
          ),
          branchRefs:
            resolveSelectors(
              requirement.branchSelectors,
              context.branches,
              `verification:${key}`,
            ),
          requiredEvidenceKinds:
            uniqueStrings(
              requirement
                .requiredEvidenceKinds,
            ).slice(0, 16),
        };
      },
    );
  const rawConstraints =
    Array.isArray(
      args.preservationConstraints,
    )
      ? args.preservationConstraints
      : [];
  const constraintKeys = new Set();
  const preservationConstraints =
    rawConstraints.map(
      (constraint, index) => {
        exactKeys(constraint, [
          "constraintKey",
          "statement",
          "branchSelectors",
        ], `constraint.${index}`);
        const key = text(
          constraint.constraintKey,
          "",
        );
        if (
          !key ||
          constraintKeys.has(key)
        ) {
          fail(
            "world_manager_aro_mutation_constraint_key_invalid",
            key,
          );
        }
        constraintKeys.add(key);
        return {
          constraintKey: key,
          statement: bounded(
            constraint.statement,
            "",
            1_200,
          ),
          branchRefs:
            resolveSelectors(
              constraint.branchSelectors,
              context.branches,
              `constraint:${key}`,
            ),
        };
      },
    );
  const rawObligations =
    Array.isArray(
      args.implementationObligations,
    )
      ? args.implementationObligations
      : [];
  const obligationKeys = new Set();
  const implementationObligations =
    rawObligations.map(
      (obligation, index) => {
        exactKeys(obligation, [
          "obligationKey",
          "obligationKind",
          "title",
          "objective",
          "branchSelectors",
          "preservationConstraintKeys",
          "verificationRequirementKeys",
          "priority",
          "rationale",
        ], `obligation.${index}`);
        const key = text(
          obligation.obligationKey,
          "",
        );
        if (
          !key ||
          obligationKeys.has(key)
        ) {
          fail(
            "world_manager_aro_mutation_obligation_key_invalid",
            key,
          );
        }
        obligationKeys.add(key);
        const preservationKeys =
          uniqueStrings(
            obligation
              .preservationConstraintKeys,
          );
        const verificationRefs =
          uniqueStrings(
            obligation
              .verificationRequirementKeys,
          );
        if (
          preservationKeys.some(
            (constraintKey) =>
              !constraintKeys.has(
                constraintKey,
              ),
          ) ||
          !verificationRefs.length ||
          verificationRefs.some(
            (verificationKey) =>
              !verificationKeys.has(
                verificationKey,
              ),
          )
        ) {
          fail(
            "world_manager_aro_mutation_obligation_dependency_invalid",
            key,
          );
        }
        return {
          obligationKey: key,
          obligationKind: bounded(
            obligation.obligationKind,
            "implementation_obligation",
            160,
          ),
          title: bounded(
            obligation.title,
            key,
            300,
          ),
          objective: bounded(
            obligation.objective,
            "",
            1_600,
          ),
          branchRefs:
            resolveSelectors(
              obligation.branchSelectors,
              context.branches,
              `obligation:${key}`,
            ),
          preservationConstraintKeys:
            preservationKeys,
          verificationRequirementKeys:
            verificationRefs,
          priority: bounded(
            obligation.priority,
            "normal",
            120,
          ),
          rationale: bounded(
            obligation.rationale,
            "",
            1_200,
          ),
        };
      },
    );
  if (
    context.delta.mutationRequired
  ) {
    if (
      args.disposition !==
        "mutation_required" ||
      !implementationObligations
        .length ||
      !verificationRequirements.length
    ) {
      fail(
        "world_manager_aro_mutation_required_contract_incomplete",
      );
    }
  } else if (
    args.disposition !==
      "no_change_required" ||
    implementationObligations.length ||
    verificationRequirements.length ||
    preservationConstraints.length
  ) {
    fail(
      "world_manager_aro_mutation_empty_delta_contract_invalid",
    );
  }
  const obligationBranchIds =
    new Set(
      implementationObligations
        .flatMap((obligation) =>
          obligation.branchRefs)
        .map((ref) => ref.id),
    );
  const preservationBranchIds =
    new Set(
      preservationConstraints
        .flatMap((constraint) =>
          constraint.branchRefs)
        .map((ref) => ref.id),
    );
  const missingOperative =
    context.delta
      .operativeTargetBranchRefs
      .filter((ref) =>
        !obligationBranchIds.has(
          ref.id,
        ));
  const missingCurrentOnly =
    context.delta
      .currentOnlyBranchRefs
      .filter((ref) =>
        !obligationBranchIds.has(
          ref.id,
        ) &&
        !preservationBranchIds.has(
          ref.id,
        ));
  if (
    missingOperative.length ||
    missingCurrentOnly.length
  ) {
    fail(
      "world_manager_aro_mutation_delta_coverage_incomplete",
      `${missingOperative.length}:${missingCurrentOnly.length}`,
    );
  }
  return {
    disposition: args.disposition,
    contractSummary: bounded(
      args.contractSummary,
      "",
      1_600,
    ),
    changeStrategy: bounded(
      args.changeStrategy,
      "",
      1_600,
    ),
    implementationObligations,
    verificationRequirements,
    preservationConstraints,
    assumptions:
      uniqueStrings(
        args.assumptions,
      ).slice(0, 24),
    unresolvedQuestions:
      uniqueStrings(
        args.unresolvedQuestions,
      ).slice(0, 24),
  };
}

function validateMutationAction(
  runnerResult,
  context,
) {
  const actionCalls =
    actionCallsFromResult(runnerResult);
  const errors = [];
  let result = null;
  try {
    if (
      actionCalls.length !== 1 ||
      actionCalls[0].name !==
        ARO_MUTATION_ACTION
    ) {
      fail(
        "world_manager_aro_mutation_exact_action_required",
        String(actionCalls.length),
      );
    }
    const args = parseArguments(
      actionCalls[0].argumentsJson ??
        actionCalls[0].arguments ??
        actionCalls[0].payload,
    );
    result = {
      callId: text(
        actionCalls[0].callId,
        "",
      ),
      ...normalizeActionResult(
        args,
        context,
      ),
    };
  } catch (error) {
    errors.push({
      code: text(
        error?.code,
        "world_manager_aro_mutation_validation_failed",
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
      ARO_MUTATION_VALIDATION_SCHEMA,
    state: errors.length
      ? "remanded"
      : "validated",
    requiredContract:
      "exactly_one_native_aro_mutation_contract_action",
    observedActionNames:
      actionCalls
        .map((call) =>
          text(call.name, ""))
        .filter(Boolean),
    errors,
    exactDeltaCoverageValidated:
      errors.length === 0,
    semanticContentValidatedAgainstClosedTaxonomy:
      false,
    semanticTruthValidated: false,
    sourceInspectionEffect: false,
    workerLaunchEffect: false,
    workspaceMutationEffect: false,
    grantsAuthority: false,
  };
  validation.digest = digestFor(
    ARO_MUTATION_VALIDATION_SCHEMA,
    validation,
    ["digest"],
  );
  return {
    result,
    validation,
  };
}

function buildAroMutationContract(
  input = {},
) {
  const projectId = text(
    input.projectId,
    "",
  );
  const comparisonReference =
    exactRef(
      input.comparisonRef,
      "mutationContract.comparisonRef",
    );
  const currentAroRef =
    exactRef(
      input.currentAroRef,
      "mutationContract.currentAroRef",
    );
  const targetAroRef =
    exactRef(
      input.targetAroRef,
      "mutationContract.targetAroRef",
    );
  const revision = Number(
    input.contractRevision || 1,
  );
  if (
    !projectId ||
    !Number.isInteger(revision) ||
    revision < 1
  ) {
    fail(
      "world_manager_aro_mutation_contract_identity_invalid",
    );
  }
  const contractId = text(
    input.contractId,
    stableId(
      "wm_aro_mutation_contract",
      {
        projectId,
        comparisonReference,
      },
    ),
  );
  const predecessorRef =
    input.predecessorRef
      ? exactRef(
          input.predecessorRef,
          "mutationContract.predecessorRef",
        )
      : null;
  if (
    (revision === 1) ===
      Boolean(predecessorRef)
  ) {
    fail(
      "world_manager_aro_mutation_contract_lineage_invalid",
    );
  }
  const contract = {
    schema:
      ARO_MUTATION_CONTRACT_SCHEMA,
    contractId,
    contractRevision: revision,
    predecessorRef,
    projectId,
    conceptKey: text(
      input.conceptKey,
      "",
    ),
    comparisonRef:
      comparisonReference,
    currentAroRef,
    targetAroRef,
    repositorySnapshotRef:
      input.repositorySnapshotRef
        ? exactRef(
            input.repositorySnapshotRef,
            "mutationContract.repositorySnapshotRef",
          )
        : null,
    delta: input.delta,
    disposition: text(
      input.disposition,
      "",
    ),
    contractSummary: bounded(
      input.contractSummary,
      "",
      1_600,
    ),
    changeStrategy: bounded(
      input.changeStrategy,
      "",
      1_600,
    ),
    implementationObligations:
      input.implementationObligations
        .map((obligation) => ({
          schema:
            "direct_aro_implementation_obligation@1",
          obligationId: stableId(
            "wm_aro_implementation_obligation",
            {
              contractId,
              obligationKey:
                obligation.obligationKey,
            },
          ),
          ...obligation,
          branchRefs: uniqueRefs(
            obligation.branchRefs,
          ),
          grantsAuthority: false,
        })),
    verificationRequirements:
      input.verificationRequirements
        .map((requirement) => ({
          schema:
            "direct_aro_verification_requirement@1",
          verificationRequirementId:
            stableId(
              "wm_aro_verification_requirement",
              {
                contractId,
                verificationKey:
                  requirement.verificationKey,
              },
            ),
          ...requirement,
          branchRefs: uniqueRefs(
            requirement.branchRefs,
          ),
          grantsAuthority: false,
        })),
    preservationConstraints:
      input.preservationConstraints
        .map((constraint) => ({
          schema:
            "direct_aro_preservation_constraint@1",
          preservationConstraintId:
            stableId(
              "wm_aro_preservation_constraint",
              {
                contractId,
                constraintKey:
                  constraint.constraintKey,
              },
            ),
          ...constraint,
          branchRefs: uniqueRefs(
            constraint.branchRefs,
          ),
          grantsAuthority: false,
        })),
    assumptions:
      uniqueStrings(input.assumptions),
    unresolvedQuestions:
      uniqueStrings(
        input.unresolvedQuestions,
      ),
    provenanceRefs: uniqueRefs([
      comparisonReference,
      currentAroRef,
      targetAroRef,
      ...(input.repositorySnapshotRef
        ? [input.repositorySnapshotRef]
        : []),
    ]),
    lifecycle: "candidate",
    reviewState: "pending",
    realizationContextState:
      "not_imported_sc8_1",
    workerLaunchState:
      "unavailable_sc8_1",
    executionAuthorityGranted: false,
    semanticTruthValidated: false,
    sourceInspectionEffect: false,
    workerLaunchEffect: false,
    workspaceMutationEffect: false,
    canonicalAdmissionEffect: false,
    canonical: false,
    grantsAuthority: false,
    createdAt: text(
      input.createdAt,
      nowIso(input.now),
    ),
  };
  contract.digest = digestFor(
    ARO_MUTATION_CONTRACT_SCHEMA,
    contract,
    ["digest"],
  );
  validateAroMutationContract(contract);
  return contract;
}

function validateAroMutationContract(
  value,
) {
  if (
    !isPlainObject(value) ||
    value.schema !==
      ARO_MUTATION_CONTRACT_SCHEMA ||
    !text(value.contractId, "") ||
    !Number.isInteger(
      Number(value.contractRevision),
    ) ||
    !text(value.projectId, "") ||
    !text(value.conceptKey, "") ||
    ![
      "mutation_required",
      "no_change_required",
    ].includes(value.disposition) ||
    !Array.isArray(
      value.implementationObligations,
    ) ||
    !Array.isArray(
      value.verificationRequirements,
    ) ||
    !Array.isArray(
      value.preservationConstraints,
    ) ||
    !Array.isArray(value.assumptions) ||
    !Array.isArray(
      value.unresolvedQuestions,
    ) ||
    !Array.isArray(
      value.provenanceRefs,
    ) ||
    value.lifecycle !== "candidate" ||
    value.reviewState !== "pending" ||
    value.realizationContextState !==
      "not_imported_sc8_1" ||
    value.workerLaunchState !==
      "unavailable_sc8_1" ||
    value.executionAuthorityGranted !==
      false ||
    value.semanticTruthValidated !==
      false ||
    value.sourceInspectionEffect !==
      false ||
    value.workerLaunchEffect !== false ||
    value.workspaceMutationEffect !==
      false ||
    value.canonicalAdmissionEffect !==
      false ||
    value.canonical !== false ||
    value.grantsAuthority !== false ||
    value.digest !==
      digestFor(
        ARO_MUTATION_CONTRACT_SCHEMA,
        value,
        ["digest"],
      )
  ) {
    fail(
      "world_manager_aro_mutation_contract_invalid",
    );
  }
  if (
    (Number(value.contractRevision) ===
      1) ===
      Boolean(value.predecessorRef)
  ) {
    fail(
      "world_manager_aro_mutation_contract_lineage_invalid",
    );
  }
  exactRef(
    value.comparisonRef,
    "mutationContract.comparisonRef",
  );
  exactRef(
    value.currentAroRef,
    "mutationContract.currentAroRef",
  );
  exactRef(
    value.targetAroRef,
    "mutationContract.targetAroRef",
  );
  validateAroMutationDelta(value.delta);
  if (
    !exactRefMatches(
      value.delta.comparisonRef,
      value.comparisonRef,
    ) ||
    !exactRefMatches(
      value.delta.currentAroRef,
      value.currentAroRef,
    ) ||
    !exactRefMatches(
      value.delta.targetAroRef,
      value.targetAroRef,
    ) ||
    (
      value.disposition ===
        "mutation_required"
    ) !== value.delta.mutationRequired
  ) {
    fail(
      "world_manager_aro_mutation_contract_delta_binding_invalid",
    );
  }
  if (value.repositorySnapshotRef) {
    exactRef(
      value.repositorySnapshotRef,
      "mutationContract.repositorySnapshotRef",
    );
  }
  value.provenanceRefs.forEach(
    (ref, index) =>
      exactRef(
        ref,
        `mutationContract.provenanceRefs.${index}`,
      ),
  );
  const obligationKeys = new Set();
  const verificationKeys = new Set();
  const constraintKeys = new Set();
  const obligationBranchIds =
    new Set();
  const preservationBranchIds =
    new Set();
  for (
    const requirement of
      value.verificationRequirements
  ) {
    if (
      verificationKeys.has(
        requirement.verificationKey,
      )
    ) {
      fail(
        "world_manager_aro_mutation_verification_key_invalid",
        requirement.verificationKey,
      );
    }
    verificationKeys.add(
      requirement.verificationKey,
    );
  }
  for (
    const constraint of
      value.preservationConstraints
  ) {
    if (
      constraintKeys.has(
        constraint.constraintKey,
      )
    ) {
      fail(
        "world_manager_aro_mutation_constraint_key_invalid",
        constraint.constraintKey,
      );
    }
    constraintKeys.add(
      constraint.constraintKey,
    );
  }
  for (
    const obligation of
      value.implementationObligations
  ) {
    if (
      obligation.schema !==
        "direct_aro_implementation_obligation@1" ||
      !text(obligation.obligationId, "") ||
      !text(obligation.obligationKey, "") ||
      !text(obligation.obligationKind, "") ||
      !text(obligation.title, "") ||
      !text(obligation.objective, "") ||
      !Array.isArray(
        obligation.branchRefs,
      ) ||
      !obligation.branchRefs.length ||
      !Array.isArray(
        obligation
          .verificationRequirementKeys,
      ) ||
      !obligation
        .verificationRequirementKeys
        .length ||
      !Array.isArray(
        obligation
          .preservationConstraintKeys,
      ) ||
      !text(obligation.priority, "") ||
      obligation.grantsAuthority !==
        false
    ) {
      fail(
        "world_manager_aro_mutation_obligation_invalid",
      );
    }
    if (
      obligationKeys.has(
        obligation.obligationKey,
      ) ||
      obligation
        .verificationRequirementKeys
        .some((key) =>
          !verificationKeys.has(key)) ||
      obligation
        .preservationConstraintKeys
        .some((key) =>
          !constraintKeys.has(key))
    ) {
      fail(
        "world_manager_aro_mutation_obligation_dependency_invalid",
        obligation.obligationKey,
      );
    }
    obligationKeys.add(
      obligation.obligationKey,
    );
    obligation.branchRefs.forEach(
      (ref, index) => {
        exactRef(
          ref,
          `mutationObligation.branchRefs.${index}`,
        );
        obligationBranchIds.add(
          ref.id,
        );
      },
    );
  }
  for (
    const requirement of
      value.verificationRequirements
  ) {
    if (
      requirement.schema !==
        "direct_aro_verification_requirement@1" ||
      !text(
        requirement
          .verificationRequirementId,
        "",
      ) ||
      !text(
        requirement.verificationKey,
        "",
      ) ||
      !text(
        requirement.verificationKind,
        "",
      ) ||
      !text(requirement.claim, "") ||
      !text(
        requirement.successCondition,
        "",
      ) ||
      !Array.isArray(
        requirement.branchRefs,
      ) ||
      !requirement.branchRefs.length ||
      !Array.isArray(
        requirement
          .requiredEvidenceKinds,
      ) ||
      requirement.grantsAuthority !==
        false
    ) {
      fail(
        "world_manager_aro_mutation_verification_invalid",
      );
    }
    requirement.branchRefs.forEach(
      (ref, index) =>
        exactRef(
          ref,
          `mutationVerification.branchRefs.${index}`,
        ),
    );
  }
  for (
    const constraint of
      value.preservationConstraints
  ) {
    if (
      constraint.schema !==
        "direct_aro_preservation_constraint@1" ||
      !text(
        constraint
          .preservationConstraintId,
        "",
      ) ||
      !text(constraint.constraintKey, "") ||
      !text(constraint.statement, "") ||
      !Array.isArray(
        constraint.branchRefs,
      ) ||
      !constraint.branchRefs.length ||
      constraint.grantsAuthority !==
        false
    ) {
      fail(
        "world_manager_aro_mutation_constraint_invalid",
      );
    }
    constraint.branchRefs.forEach(
      (ref, index) => {
        exactRef(
          ref,
          `mutationConstraint.branchRefs.${index}`,
        );
        preservationBranchIds.add(
          ref.id,
        );
      },
    );
  }
  const missingOperative =
    value.delta
      .operativeTargetBranchRefs
      .filter((ref) =>
        !obligationBranchIds.has(
          ref.id,
        ));
  const missingCurrentOnly =
    value.delta
      .currentOnlyBranchRefs
      .filter((ref) =>
        !obligationBranchIds.has(
          ref.id,
        ) &&
        !preservationBranchIds.has(
          ref.id,
        ));
  if (
    missingOperative.length ||
    missingCurrentOnly.length ||
    (
      value.delta.mutationRequired &&
      (
        !value
          .implementationObligations
          .length ||
        !value
          .verificationRequirements
          .length
      )
    ) ||
    (
      !value.delta.mutationRequired &&
      (
        value
          .implementationObligations
          .length ||
        value
          .verificationRequirements
          .length ||
        value
          .preservationConstraints
          .length
      )
    )
  ) {
    fail(
      "world_manager_aro_mutation_contract_coverage_invalid",
    );
  }
  return true;
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
    toolNames:
      uniqueStrings(value.toolNames),
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

function buildAroMutationCompilationRun(
  input = {},
) {
  const projectId = text(
    input.projectId,
    "",
  );
  const state = text(
    input.state,
    "scheduled",
  );
  const attempt = Number(
    input.attempt || 1,
  );
  const revision = Number(
    input.runRevision || 1,
  );
  const comparisonReference =
    exactRef(
      input.comparisonRef,
      "mutationRun.comparisonRef",
    );
  if (
    !projectId ||
    !RUN_STATES.has(state) ||
    !Number.isInteger(attempt) ||
    attempt < 1 ||
    !Number.isInteger(revision) ||
    revision < 1
  ) {
    fail(
      "world_manager_aro_mutation_run_identity_invalid",
    );
  }
  const runId = text(
    input.runId,
    stableId(
      "wm_aro_mutation_compilation_run",
      {
        projectId,
        comparisonReference,
        attempt,
      },
    ),
  );
  const predecessorRef =
    input.predecessorRef
      ? exactRef(
          input.predecessorRef,
          "mutationRun.predecessorRef",
        )
      : null;
  if (
    (revision === 1) ===
      Boolean(predecessorRef)
  ) {
    fail(
      "world_manager_aro_mutation_run_lineage_invalid",
    );
  }
  const error = input.error
    ? {
        code: text(
          input.error.code,
          "world_manager_aro_mutation_compilation_failed",
        ),
        message: bounded(
          input.error.message,
          "ARO mutation contract compilation failed.",
          500,
        ),
      }
    : null;
  const run = {
    schema:
      ARO_MUTATION_COMPILATION_RUN_SCHEMA,
    runId,
    runRevision: revision,
    predecessorRef,
    projectId,
    comparisonRef:
      comparisonReference,
    currentAroRef: exactRef(
      input.currentAroRef,
      "mutationRun.currentAroRef",
    ),
    targetAroRef: exactRef(
      input.targetAroRef,
      "mutationRun.targetAroRef",
    ),
    attempt,
    state,
    requestManifest:
      input.requestManifest || null,
    validation:
      input.validation || null,
    contractRef:
      input.contractRef
        ? exactRef(
            input.contractRef,
            "mutationRun.contractRef",
          )
        : null,
    error,
    telemetry:
      input.telemetry || null,
    retryable:
      RETRYABLE_RUN_STATES.has(
        state,
      ),
    canonical: false,
    semanticTruthValidated: false,
    sourceInspectionEffect: false,
    workerLaunchEffect: false,
    workspaceMutationEffect: false,
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
    ARO_MUTATION_COMPILATION_RUN_SCHEMA,
    run,
    ["digest"],
  );
  validateAroMutationCompilationRun(run);
  return run;
}

function validateAroMutationCompilationRun(
  value,
) {
  if (
    !isPlainObject(value) ||
    value.schema !==
      ARO_MUTATION_COMPILATION_RUN_SCHEMA ||
    !text(value.runId, "") ||
    !Number.isInteger(
      Number(value.runRevision),
    ) ||
    !text(value.projectId, "") ||
    !Number.isInteger(
      Number(value.attempt),
    ) ||
    !RUN_STATES.has(value.state) ||
    value.retryable !==
      RETRYABLE_RUN_STATES.has(
        value.state,
      ) ||
    value.canonical !== false ||
    value.semanticTruthValidated !==
      false ||
    value.sourceInspectionEffect !==
      false ||
    value.workerLaunchEffect !== false ||
    value.workspaceMutationEffect !==
      false ||
    value.grantsAuthority !== false ||
    value.digest !==
      digestFor(
        ARO_MUTATION_COMPILATION_RUN_SCHEMA,
        value,
        ["digest"],
      )
  ) {
    fail(
      "world_manager_aro_mutation_run_invalid",
    );
  }
  if (
    (Number(value.runRevision) === 1) ===
      Boolean(value.predecessorRef)
  ) {
    fail(
      "world_manager_aro_mutation_run_lineage_invalid",
    );
  }
  exactRef(
    value.comparisonRef,
    "mutationRun.comparisonRef",
  );
  exactRef(
    value.currentAroRef,
    "mutationRun.currentAroRef",
  );
  exactRef(
    value.targetAroRef,
    "mutationRun.targetAroRef",
  );
  if (value.predecessorRef) {
    exactRef(
      value.predecessorRef,
      "mutationRun.predecessorRef",
    );
  }
  if (value.contractRef) {
    exactRef(
      value.contractRef,
      "mutationRun.contractRef",
    );
  }
  if (
    value.state === "completed" &&
    !value.contractRef
  ) {
    fail(
      "world_manager_aro_mutation_run_completed_without_contract",
    );
  }
  return true;
}

function reviseAroMutationCompilationRun(
  current,
  input = {},
) {
  validateAroMutationCompilationRun(
    current,
  );
  if (
    TERMINAL_RUN_STATES.has(
      current.state,
    )
  ) {
    fail(
      "world_manager_aro_mutation_terminal_run_immutable",
      current.runId,
    );
  }
  return buildAroMutationCompilationRun({
    ...current,
    ...input,
    runRevision:
      current.runRevision + 1,
    predecessorRef: exactRef({
      kind:
        "aro_mutation_compilation_run",
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

class DirectAroMutationContractRuntime {
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
    const currentAro =
      input.currentAro;
    const targetAro =
      input.targetAro;
    const comparison =
      input.comparison;
    const delta = buildAroMutationDelta(
      currentAro,
      targetAro,
      comparison,
    );
    const projectId = text(
      input.projectId ||
        comparison.projectId,
      "",
    );
    const attempt = Math.max(
      1,
      Number(input.attempt || 1),
    );
    const createdAt = nowIso(this.now);
    const {
      instructions,
      outputContract:
        actionContract,
      manifest,
    } = requestManifest({
      projectId,
      currentAro,
      targetAro,
      comparison,
      attempt,
    });
    if (!this.runner) {
      const error = new Error(
        "world_manager_aro_mutation_runner_unavailable",
      );
      error.code =
        "world_manager_aro_mutation_runner_unavailable";
      throw error;
    }
    let runnerResult;
    try {
      runnerResult = await this.runner({
        schema:
          "direct_aro_mutation_contract_runner_request@1",
        projectId,
        comparisonRef:
          comparisonRef(comparison),
        currentAroRef:
          abstractReasoningObjectRef(
            currentAro,
          ),
        targetAroRef:
          abstractReasoningObjectRef(
            targetAro,
          ),
        attempt,
        instructions,
        prompt: mutationPrompt({
          project: input.project,
          currentAro,
          targetAro,
          comparison,
        }),
        outputContract:
          actionContract,
        tools: actionContract.tools,
        toolChoicePolicy: "required",
        reasoningEffort: text(
          input.reasoningEffort,
          "medium",
        ),
        sourceInspectionEffect: false,
        workerLaunchEffect: false,
        workspaceMutationEffect: false,
        grantsAuthority: false,
      });
    } catch (error) {
      return {
        state: "failed",
        requestManifest: manifest,
        validation: null,
        contract: null,
        telemetry:
          normalizeTelemetry(
            {},
            "failed",
          ),
        error: {
          code: text(
            error?.code,
            "world_manager_aro_mutation_runner_failed",
          ),
          message: bounded(
            error?.message,
            "Direct ARO mutation contract compilation failed.",
            500,
          ),
        },
      };
    }
    const validated =
      validateMutationAction(
        runnerResult,
        {
          branches: branchMap(
            currentAro,
            targetAro,
          ),
          delta,
        },
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
        contract: null,
        telemetry:
          normalizeTelemetry(
            runnerResult?.telemetry,
            "remanded",
          ),
        error: {
          code:
            validated.validation
              .errors[0]?.code ||
            "world_manager_aro_mutation_remanded",
          message:
            validated.validation
              .errors[0]?.detail ||
            "The semantic mutation-contract action did not satisfy its discharge form.",
        },
      };
    }
    const contract =
      buildAroMutationContract({
        projectId,
        conceptKey:
          comparison.conceptKey,
        comparisonRef:
          comparisonRef(comparison),
        currentAroRef:
          abstractReasoningObjectRef(
            currentAro,
          ),
        targetAroRef:
          abstractReasoningObjectRef(
            targetAro,
          ),
        repositorySnapshotRef:
          input.repositorySnapshotRef,
        delta,
        ...validated.result,
        createdAt,
        now: this.now,
      });
    return {
      state: "completed",
      requestManifest: manifest,
      validation:
        validated.validation,
      contract,
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
  ARO_MUTATION_ACTION,
  ARO_MUTATION_COMPILATION_RUN_SCHEMA,
  ARO_MUTATION_CONTRACT_SCHEMA,
  ARO_MUTATION_DELTA_SCHEMA,
  ARO_MUTATION_REQUEST_MANIFEST_SCHEMA,
  ARO_MUTATION_VALIDATION_SCHEMA,
  DirectAroMutationContractRuntime,
  buildAroMutationCompilationRun,
  buildAroMutationContract,
  buildAroMutationDelta,
  comparisonRef,
  mutationContractRef,
  mutationContractTool,
  mutationInstructions,
  mutationPrompt,
  reviseAroMutationCompilationRun,
  validateAroMutationCompilationRun,
  validateAroMutationContract,
  validateAroMutationDelta,
};
