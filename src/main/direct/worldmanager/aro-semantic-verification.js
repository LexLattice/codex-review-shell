"use strict";

const {
  abstractReasoningObjectRef,
  branchRef,
  digestFor,
  stableId,
  validateAbstractReasoningObject,
  validateAroCurrentTargetComparison,
} = require("./aro-kernel");
const {
  mutationContractRef,
  validateAroMutationContract,
} = require("./aro-mutation-contract");
const {
  evidenceBundleRef,
  validateAroExecutionEvidenceBundle,
} = require("./aro-execution-evidence");

const ARO_SEMANTIC_VERIFICATION_ACTION =
  "wm_discharge_aro_semantic_verification";
const ARO_SEMANTIC_VERIFICATION_ASSESSMENT_SCHEMA =
  "direct_aro_semantic_verification_assessment@1";
const ARO_CLOSURE_CANDIDATE_SCHEMA =
  "direct_aro_closure_candidate@1";
const ARO_SEMANTIC_VERIFICATION_RUN_SCHEMA =
  "direct_aro_semantic_verification_run@1";
const ARO_SEMANTIC_VERIFICATION_VALIDATION_SCHEMA =
  "direct_aro_semantic_verification_validation@1";
const ARO_SEMANTIC_VERIFICATION_REQUEST_MANIFEST_SCHEMA =
  "direct_aro_semantic_verification_request_manifest@1";

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
const BLOCKING_SEVERITIES = new Set([
  "critical",
  "high",
]);
const NEGATIVE_ASSESSMENT_STATES = new Set([
  "contradicted",
  "violated",
  "failed",
  "not_realized",
  "rejected",
]);
const POSITIVE_STATES = {
  obligation: new Set([
    "satisfied",
    "fulfilled",
    "completed",
  ]),
  verification: new Set([
    "supported",
    "verified",
    "satisfied",
  ]),
  preservation: new Set([
    "preserved",
    "satisfied",
    "maintained",
  ]),
  branch: new Set([
    "realized",
    "supported",
    "satisfied",
  ]),
};

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

function bounded(value, fallback = "", max = 1_600) {
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

function uniqueStrings(values = [], max = 32) {
  return [
    ...new Set(
      (Array.isArray(values) ? values : [])
        .map((value) =>
          bounded(value, "", 1_200))
        .filter(Boolean),
    ),
  ].slice(0, max);
}

function exactRef(value = {}, label = "ref") {
  const ref = {
    kind: text(value.kind, ""),
    id: text(value.id, ""),
    digest: text(value.digest, ""),
  };
  if (!ref.kind || !ref.id || !ref.digest) {
    fail(
      "world_manager_aro_semantic_verification_ref_invalid",
      label,
    );
  }
  const projectId = text(value.projectId, "");
  if (projectId) ref.projectId = projectId;
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

function artifact(schema, idField, id, body) {
  const value = {
    schema,
    [idField]: id,
    ...body,
    grantsAuthority: false,
  };
  value.digest = digestFor(
    schema,
    value,
    ["digest"],
  );
  return value;
}

function validateArtifact(
  value,
  schema,
  idField,
) {
  if (
    !isPlainObject(value) ||
    value.schema !== schema ||
    !text(value[idField], "") ||
    value.grantsAuthority !== false ||
    value.digest !==
      digestFor(
        schema,
        value,
        ["digest"],
      )
  ) {
    fail(
      "world_manager_aro_semantic_verification_artifact_invalid",
      schema,
    );
  }
}

function assessmentRef(assessment) {
  validateAroSemanticVerificationAssessment(
    assessment,
  );
  return exactRef({
    kind:
      "aro_semantic_verification_assessment",
    id:
      assessment.assessmentId,
    digest: assessment.digest,
    projectId: assessment.projectId,
  });
}

function closureCandidateRef(candidate) {
  validateAroClosureCandidate(candidate);
  return exactRef({
    kind: "aro_closure_candidate",
    id: candidate.closureCandidateId,
    digest: candidate.digest,
    projectId: candidate.projectId,
  });
}

function objectEvidenceCatalog(bundle) {
  const catalog = new Map();
  const add = (kind, ref) => {
    const key = text(kind, "").toLowerCase();
    if (!key || !ref) return;
    const current = catalog.get(key) || [];
    current.push(ref);
    catalog.set(key, uniqueRefs(current));
  };
  const turn = bundle.workerTurnWitness;
  const turnRef = {
    kind: "aro_worker_turn_witness",
    id: turn.workerTurnWitnessId,
    digest: turn.digest,
    projectId: bundle.projectId,
  };
  add("worker_turn", turnRef);
  if (turn.finalOutputPresent) {
    add("worker_final_output", turnRef);
    add("final_output", turnRef);
  }
  for (const witness of bundle.toolResultWitnesses) {
    const ref = {
      kind: "aro_tool_result_witness",
      id: witness.toolResultWitnessId,
      digest: witness.digest,
      projectId: bundle.projectId,
    };
    add("tool_result", ref);
    add(witness.tool, ref);
    for (const kind of witness.evidenceKinds || []) {
      add(kind, ref);
    }
  }
  for (const witness of bundle.workspaceEffectWitnesses) {
    const ref = {
      kind:
        "aro_workspace_effect_witness",
      id: witness.workspaceEffectWitnessId,
      digest: witness.digest,
      projectId: bundle.projectId,
    };
    add("workspace_effect", ref);
    add("workspace_mutation", ref);
  }
  const repository =
    bundle.repositoryAfterStateWitness;
  const repositoryRef = {
    kind:
      "aro_repository_after_state_witness",
    id:
      repository
        .repositoryAfterStateWitnessId,
    digest: repository.digest,
    projectId: bundle.projectId,
  };
  add("repository_after_state", repositoryRef);
  add("source_after_state", repositoryRef);
  add("source_diff", repositoryRef);
  for (
    const witness of
      bundle.verificationCoverageWitnesses
  ) {
    const ref = {
      kind:
        "aro_verification_coverage_witness",
      id:
        witness
          .verificationCoverageWitnessId,
      digest: witness.digest,
      projectId: bundle.projectId,
    };
    add("verification_coverage", ref);
    for (
      const kind of
        witness.observedEvidenceKinds || []
    ) {
      add(kind, ref);
    }
  }
  return catalog;
}

function bindEvidenceKinds(
  evidenceKinds,
  catalog,
) {
  const kinds = uniqueStrings(
    evidenceKinds,
    24,
  );
  const refs = uniqueRefs(
    kinds.flatMap((kind) =>
      catalog.get(
        kind.toLowerCase(),
      ) || []),
  );
  const unmappedEvidenceKinds =
    kinds.filter((kind) =>
      !catalog.has(
        kind.toLowerCase(),
      ));
  return {
    evidenceKinds: kinds,
    evidenceRefs: refs,
    unmappedEvidenceKinds,
    evidenceBindingState:
      !kinds.length
        ? "not_claimed"
        : unmappedEvidenceKinds.length
          ? refs.length
            ? "partial"
            : "unmapped"
          : "bound",
  };
}

function assessmentRow(
  kind,
  key,
  sourceRef,
  raw,
  catalog,
  options = {},
) {
  const present = Boolean(raw);
  const status = text(
    raw?.status,
    "indeterminate",
  ).toLowerCase();
  return {
    schema:
      `direct_aro_${kind}_assessment@1`,
    [`${kind}Key`]: key,
    sourceRef:
      exactRef(
        sourceRef,
        `${kind}.${key}.sourceRef`,
      ),
    status,
    rationale: bounded(
      raw?.rationale,
      present
        ? "No semantic rationale was supplied."
        : "The semantic discharge omitted this contract object; the harness materialized an indeterminate assessment.",
      1_800,
    ),
    blindspots: uniqueStrings(
      raw?.blindspots,
      24,
    ),
    continuationPaths: uniqueStrings(
      raw?.continuationPaths,
      24,
    ),
    ...bindEvidenceKinds(
      raw?.evidenceKinds,
      catalog,
    ),
    requiredForGate:
      options.requiredForGate !== false,
    synthesizedFromOmission:
      !present,
    canonical: false,
    grantsAuthority: false,
  };
}

function semanticRows({
  expected,
  supplied,
  keyField,
  kind,
  sourceRef,
  catalog,
  requiredForGate,
}) {
  const byKey = new Map(
    (Array.isArray(supplied)
      ? supplied
      : [])
      .map((entry) => [
        text(entry?.[keyField], ""),
        entry,
      ])
      .filter(([key]) => key),
  );
  const expectedKeys = new Set(
    expected.map((entry) =>
      text(entry[keyField], "")),
  );
  const rows = expected.map((entry) => {
    const key = text(
      entry[keyField],
      "",
    );
    return assessmentRow(
      kind,
      key,
      sourceRef(entry),
      byKey.get(key),
      catalog,
      {
        requiredForGate:
          typeof requiredForGate ===
          "function"
            ? requiredForGate(entry)
            : requiredForGate,
      },
    );
  });
  const unmapped =
    (Array.isArray(supplied)
      ? supplied
      : [])
      .filter((entry) =>
        !expectedKeys.has(
          text(entry?.[keyField], ""),
        ))
      .map((entry) => ({
        objectKind: kind,
        objectKey: text(
          entry?.[keyField],
          "unidentified",
        ),
        status: text(
          entry?.status,
          "indeterminate",
        ),
        rationale: bounded(
          entry?.rationale,
          "The semantic discharge named an object that is not present in the exact contract lineage.",
          1_200,
        ),
        ...bindEvidenceKinds(
          entry?.evidenceKinds,
          catalog,
        ),
        canonical: false,
        grantsAuthority: false,
      }));
  return { rows, unmapped };
}

function normalizeFindings(
  values,
  catalog,
) {
  return (
    Array.isArray(values) ? values : []
  ).slice(0, 80).map((entry, index) => ({
    schema:
      "direct_aro_drift_finding@1",
    findingKey: text(
      entry?.findingKey,
      `finding_${index + 1}`,
    ),
    severity: text(
      entry?.severity,
      "medium",
    ).toLowerCase(),
    category: bounded(
      entry?.category,
      "semantic_drift",
      240,
    ),
    statement: bounded(
      entry?.statement,
      "Unspecified semantic drift.",
      1_800,
    ),
    affectedBranchKeys:
      uniqueStrings(
        entry?.affectedBranchKeys,
        32,
      ),
    recommendedResponse:
      bounded(
        entry?.recommendedResponse,
        "",
        1_200,
      ),
    ...bindEvidenceKinds(
      entry?.evidenceKinds,
      catalog,
    ),
    canonical: false,
    grantsAuthority: false,
  }));
}

function normalizeContinuationPaths(values) {
  return (
    Array.isArray(values) ? values : []
  ).slice(0, 40).map((entry, index) => ({
    schema:
      "direct_aro_continuation_path@1",
    pathKey: text(
      entry?.pathKey,
      `path_${index + 1}`,
    ),
    label: bounded(
      entry?.label,
      "Continue verification",
      300,
    ),
    description: bounded(
      entry?.description,
      "",
      1_600,
    ),
    priority: bounded(
      entry?.priority,
      "normal",
      120,
    ),
    preconditions:
      uniqueStrings(
        entry?.preconditions,
        24,
      ),
    canonical: false,
    grantsAuthority: false,
  }));
}

function normalizeDecisionProposals(values) {
  return (
    Array.isArray(values) ? values : []
  ).slice(0, 20).map((entry, index) => ({
    schema:
      "direct_aro_verification_decision_proposal@1",
    decisionKey: text(
      entry?.decisionKey,
      `decision_${index + 1}`,
    ),
    question: bounded(
      entry?.question,
      "What should happen next?",
      1_200,
    ),
    description: bounded(
      entry?.description,
      "",
      1_600,
    ),
    options: (
      Array.isArray(entry?.options)
        ? entry.options
        : []
    ).slice(0, 8).map((option, optionIndex) => ({
      optionKey: text(
        option?.optionKey,
        `option_${optionIndex + 1}`,
      ),
      label: bounded(
        option?.label,
        "Consider option",
        240,
      ),
      description: bounded(
        option?.description,
        "",
        1_000,
      ),
      semanticValue: bounded(
        option?.semanticValue,
        option?.label ||
          "Consider this option.",
        1_000,
      ),
    })),
    canonical: false,
    grantsAuthority: false,
  }));
}

function buildAssessment(input = {}) {
  const {
    bundle,
    contract,
    currentAro,
    targetAro,
    comparison,
    mappingWitnessRef,
    result,
  } = input;
  validateAroExecutionEvidenceBundle(bundle);
  validateAroMutationContract(contract);
  validateAbstractReasoningObject(currentAro);
  validateAbstractReasoningObject(targetAro);
  validateAroCurrentTargetComparison(
    comparison,
  );
  if (
    bundle.captureState !== "acquired" ||
    !bundle.workerTurnTerminal ||
    !exactRefMatches(
      bundle.contractRef,
      mutationContractRef(contract),
    ) ||
    !exactRefMatches(
      contract.currentAroRef,
      abstractReasoningObjectRef(currentAro),
    ) ||
    !exactRefMatches(
      contract.targetAroRef,
      abstractReasoningObjectRef(targetAro),
    ) ||
    !exactRefMatches(
      contract.comparisonRef,
      {
        kind:
          "aro_current_target_comparison",
        id: comparison.comparisonId,
        digest: comparison.digest,
        projectId: comparison.projectId,
      },
    )
  ) {
    fail(
      "world_manager_aro_semantic_verification_lineage_invalid",
    );
  }
  const catalog =
    objectEvidenceCatalog(bundle);
  const obligations = semanticRows({
    expected:
      contract.implementationObligations,
    supplied:
      result.obligationAssessments,
    keyField: "obligationKey",
    kind: "obligation",
    sourceRef: (entry) => ({
      kind:
        "aro_implementation_obligation",
      id: entry.obligationId,
      digest: digestFor(
        "direct_aro_implementation_obligation_ref@1",
        entry,
      ),
      projectId: contract.projectId,
    }),
    catalog,
    requiredForGate: true,
  });
  const verification = semanticRows({
    expected:
      contract.verificationRequirements,
    supplied:
      result.verificationAssessments,
    keyField: "verificationKey",
    kind: "verification",
    sourceRef: (entry) => ({
      kind:
        "aro_verification_requirement",
      id:
        entry.verificationRequirementId,
      digest: digestFor(
        "direct_aro_verification_requirement_ref@1",
        entry,
      ),
      projectId: contract.projectId,
    }),
    catalog,
    requiredForGate: true,
  });
  const preservation = semanticRows({
    expected:
      contract.preservationConstraints,
    supplied:
      result.preservationAssessments,
    keyField: "constraintKey",
    kind: "preservation",
    sourceRef: (entry) => ({
      kind:
        "aro_preservation_constraint",
      id:
        entry.preservationConstraintId,
      digest: digestFor(
        "direct_aro_preservation_constraint_ref@1",
        entry,
      ),
      projectId: contract.projectId,
    }),
    catalog,
    requiredForGate: true,
  });
  const branches = semanticRows({
    expected: targetAro.branches,
    supplied: result.branchAssessments,
    keyField: "branchKey",
    kind: "branch",
    sourceRef: branchRef,
    catalog,
    requiredForGate: (entry) =>
      entry.modality === "required",
  });
  const unmappedAssessments = [
    ...obligations.unmapped,
    ...verification.unmapped,
    ...preservation.unmapped,
    ...branches.unmapped,
  ];
  const driftFindings = [
    ...normalizeFindings(
      result.driftFindings,
      catalog,
    ),
    ...unmappedAssessments.map((entry) => ({
      schema:
        "direct_aro_drift_finding@1",
      findingKey: stableId(
        "wm_aro_unmapped_assessment_finding",
        {
          objectKind: entry.objectKind,
          objectKey: entry.objectKey,
        },
      ),
      severity: "medium",
      category:
        "unmapped_semantic_reference",
      statement:
        `${entry.objectKind} assessment '${entry.objectKey}' does not resolve against the exact contract lineage.`,
      affectedBranchKeys: [],
      recommendedResponse:
        "Re-run verification against the exact supplied object keys.",
      evidenceKinds:
        entry.evidenceKinds,
      evidenceRefs:
        entry.evidenceRefs,
      unmappedEvidenceKinds:
        entry.unmappedEvidenceKinds,
      evidenceBindingState:
        entry.evidenceBindingState,
      canonical: false,
      grantsAuthority: false,
    })),
  ];
  const assessedAt = text(
    input.assessedAt,
    nowIso(input.now),
  );
  const assessmentId = stableId(
    "wm_aro_semantic_verification_assessment",
    {
      evidenceBundleRef:
        evidenceBundleRef(bundle),
      attempt: Number(input.attempt || 1),
    },
  );
  const assessment = artifact(
    ARO_SEMANTIC_VERIFICATION_ASSESSMENT_SCHEMA,
    "assessmentId",
    assessmentId,
    {
      projectId: bundle.projectId,
      evidenceBundleRef:
        evidenceBundleRef(bundle),
      handoffRunRef:
        bundle.handoffRunRef,
      constitutionRef:
        bundle.constitutionRef,
      contractRef:
        mutationContractRef(contract),
      contextImportRef:
        bundle.contextImportRef,
      mappingWitnessRef:
        exactRef(
          mappingWitnessRef,
          "mappingWitnessRef",
        ),
      comparisonRef:
        contract.comparisonRef,
      currentAroRef:
        abstractReasoningObjectRef(
          currentAro,
        ),
      targetAroRef:
        abstractReasoningObjectRef(
          targetAro,
        ),
      overallPosture: bounded(
        result.overallPosture,
        "inconclusive",
        240,
      ).toLowerCase(),
      assessmentSummary: bounded(
        result.assessmentSummary,
        "Semantic verification completed without a summary.",
        2_400,
      ),
      obligationAssessments:
        obligations.rows,
      verificationAssessments:
        verification.rows,
      preservationAssessments:
        preservation.rows,
      branchAssessments:
        branches.rows,
      unmappedAssessments,
      driftFindings,
      continuationPaths:
        normalizeContinuationPaths(
          result.continuationPaths,
        ),
      decisionProposals:
        normalizeDecisionProposals(
          result.openDecisions,
        ),
      closureRecommendation:
        bounded(
          result.closureRecommendation,
          "remand_for_evidence",
          240,
        ).toLowerCase(),
      closureRationale:
        bounded(
          result.closureRationale,
          "",
          1_800,
        ),
      synthesizedAssessmentCount: [
        ...obligations.rows,
        ...verification.rows,
        ...preservation.rows,
        ...branches.rows,
      ].filter((entry) =>
        entry.synthesizedFromOmission)
        .length,
      unmappedAssessmentCount:
        unmappedAssessments.length,
      semanticTruthAssessed: true,
      semanticTruthCanonical: false,
      workerLaunchEffect: false,
      sourceInspectionEffect: false,
      toolExecutionEffect: false,
      workspaceMutationEffect: false,
      remoteMutationEffect: false,
      canonicalAdmissionEffect: false,
      closureCertified: false,
      canonical: false,
      assessedAt,
    },
  );
  validateAroSemanticVerificationAssessment(
    assessment,
  );
  return assessment;
}

function validateAssessmentRows(
  values,
  keyField,
) {
  if (!Array.isArray(values)) {
    fail(
      "world_manager_aro_semantic_verification_rows_invalid",
      keyField,
    );
  }
  const keys = new Set();
  for (const entry of values) {
    const key = text(
      entry?.[keyField],
      "",
    );
    if (
      !key ||
      keys.has(key) ||
      !text(entry.status, "") ||
      !entry.sourceRef ||
      !Array.isArray(entry.evidenceKinds) ||
      !Array.isArray(entry.evidenceRefs) ||
      !Array.isArray(
        entry.unmappedEvidenceKinds,
      ) ||
      entry.canonical !== false ||
      entry.grantsAuthority !== false
    ) {
      fail(
        "world_manager_aro_semantic_verification_row_invalid",
        `${keyField}:${key}`,
      );
    }
    keys.add(key);
    exactRef(
      entry.sourceRef,
      `${keyField}.${key}.sourceRef`,
    );
    entry.evidenceRefs.forEach(
      (ref, index) =>
        exactRef(
          ref,
          `${keyField}.${key}.evidenceRefs.${index}`,
        ),
    );
  }
}

function validateAroSemanticVerificationAssessment(
  value,
) {
  validateArtifact(
    value,
    ARO_SEMANTIC_VERIFICATION_ASSESSMENT_SCHEMA,
    "assessmentId",
  );
  if (
    !text(value.projectId, "") ||
    !text(value.overallPosture, "") ||
    !Array.isArray(value.driftFindings) ||
    !Array.isArray(
      value.continuationPaths,
    ) ||
    !Array.isArray(
      value.decisionProposals,
    ) ||
    !Array.isArray(
      value.unmappedAssessments,
    ) ||
    value.semanticTruthAssessed !== true ||
    value.semanticTruthCanonical !== false ||
    value.workerLaunchEffect !== false ||
    value.sourceInspectionEffect !== false ||
    value.toolExecutionEffect !== false ||
    value.workspaceMutationEffect !== false ||
    value.remoteMutationEffect !== false ||
    value.canonicalAdmissionEffect !== false ||
    value.closureCertified !== false ||
    value.canonical !== false
  ) {
    fail(
      "world_manager_aro_semantic_verification_boundary_invalid",
      value.assessmentId,
    );
  }
  for (
    const [key, ref] of [
      ["evidenceBundleRef", value.evidenceBundleRef],
      ["handoffRunRef", value.handoffRunRef],
      ["constitutionRef", value.constitutionRef],
      ["contractRef", value.contractRef],
      ["contextImportRef", value.contextImportRef],
      ["mappingWitnessRef", value.mappingWitnessRef],
      ["comparisonRef", value.comparisonRef],
      ["currentAroRef", value.currentAroRef],
      ["targetAroRef", value.targetAroRef],
    ]
  ) {
    exactRef(ref, key);
  }
  validateAssessmentRows(
    value.obligationAssessments,
    "obligationKey",
  );
  validateAssessmentRows(
    value.verificationAssessments,
    "verificationKey",
  );
  validateAssessmentRows(
    value.preservationAssessments,
    "preservationKey",
  );
  validateAssessmentRows(
    value.branchAssessments,
    "branchKey",
  );
  return true;
}

function isPositive(kind, status) {
  return Boolean(
    POSITIVE_STATES[kind]?.has(
      text(status, "").toLowerCase(),
    ),
  );
}

function buildAroClosureCandidate(
  input = {},
) {
  const assessment = input.assessment;
  const bundle = input.bundle;
  validateAroSemanticVerificationAssessment(
    assessment,
  );
  validateAroExecutionEvidenceBundle(bundle);
  if (
    !exactRefMatches(
      assessment.evidenceBundleRef,
      evidenceBundleRef(bundle),
    )
  ) {
    fail(
      "world_manager_aro_closure_candidate_lineage_invalid",
    );
  }
  const requiredRows = [
    ...assessment.obligationAssessments
      .filter((entry) =>
        entry.requiredForGate)
      .map((entry) => ({
        kind: "obligation",
        entry,
      })),
    ...assessment.verificationAssessments
      .filter((entry) =>
        entry.requiredForGate)
      .map((entry) => ({
        kind: "verification",
        entry,
      })),
    ...assessment.preservationAssessments
      .filter((entry) =>
        entry.requiredForGate)
      .map((entry) => ({
        kind: "preservation",
        entry,
      })),
    ...assessment.branchAssessments
      .filter((entry) =>
        entry.requiredForGate)
      .map((entry) => ({
        kind: "branch",
        entry,
      })),
  ];
  const indeterminateCount =
    requiredRows.filter(({ entry }) =>
      entry.status === "indeterminate" ||
      entry.synthesizedFromOmission ||
      entry.evidenceBindingState ===
        "unmapped")
      .length;
  const contradictedCount =
    requiredRows.filter(({ entry }) =>
      NEGATIVE_ASSESSMENT_STATES.has(
        entry.status,
      )).length;
  const incompleteCount =
    requiredRows.filter(({ kind, entry }) =>
      !isPositive(kind, entry.status))
      .length;
  const blockingFindingCount =
    assessment.driftFindings
      .filter((finding) =>
        BLOCKING_SEVERITIES.has(
          finding.severity,
        )).length;
  const ready =
    bundle.captureState === "acquired" &&
    bundle.workerTurnTerminal === true &&
    bundle.ambiguityObserved === false &&
    bundle.missingEvidenceKindCount === 0 &&
    incompleteCount === 0 &&
    blockingFindingCount === 0 &&
    assessment.unmappedAssessmentCount ===
      0;
  const gateDisposition = ready
    ? "ready_for_review"
    : contradictedCount ||
        assessment.driftFindings.some(
          (finding) =>
            finding.severity ===
              "critical")
      ? "reject_realization"
      : bundle.ambiguityObserved ||
          bundle.missingEvidenceKindCount ||
          indeterminateCount
        ? "remand_for_evidence"
        : "continue_implementation";
  const closureCandidateId =
    stableId(
      "wm_aro_closure_candidate",
      {
        assessmentRef:
          assessmentRef(assessment),
        gateDisposition,
      },
    );
  const candidate = artifact(
    ARO_CLOSURE_CANDIDATE_SCHEMA,
    "closureCandidateId",
    closureCandidateId,
    {
      projectId: assessment.projectId,
      assessmentRef:
        assessmentRef(assessment),
      evidenceBundleRef:
        evidenceBundleRef(bundle),
      targetAroRef:
        assessment.targetAroRef,
      modelRecommendation:
        assessment.closureRecommendation,
      gateDisposition,
      gateReady: ready,
      requiredAssessmentCount:
        requiredRows.length,
      incompleteAssessmentCount:
        incompleteCount,
      indeterminateAssessmentCount:
        indeterminateCount,
      contradictedAssessmentCount:
        contradictedCount,
      blockingFindingCount,
      ambiguityObserved:
        bundle.ambiguityObserved,
      missingEvidenceKindCount:
        bundle.missingEvidenceKindCount,
      reviewRequired: true,
      canonicalAdmissionAvailable: false,
      semanticTruthAssessed: true,
      semanticTruthCanonical: false,
      canonicalAdmissionEffect: false,
      workspaceMutationEffect: false,
      remoteMutationEffect: false,
      closureCertified: false,
      canonical: false,
      createdAt: text(
        input.createdAt,
        nowIso(input.now),
      ),
    },
  );
  validateAroClosureCandidate(candidate);
  return candidate;
}

function validateAroClosureCandidate(value) {
  validateArtifact(
    value,
    ARO_CLOSURE_CANDIDATE_SCHEMA,
    "closureCandidateId",
  );
  if (
    ![
      "ready_for_review",
      "continue_implementation",
      "remand_for_evidence",
      "reject_realization",
    ].includes(value.gateDisposition) ||
    value.gateReady !==
      (value.gateDisposition ===
        "ready_for_review") ||
    value.reviewRequired !== true ||
    value.canonicalAdmissionAvailable !==
      false ||
    value.semanticTruthAssessed !== true ||
    value.semanticTruthCanonical !== false ||
    value.canonicalAdmissionEffect !==
      false ||
    value.workspaceMutationEffect !== false ||
    value.remoteMutationEffect !== false ||
    value.closureCertified !== false ||
    value.canonical !== false
  ) {
    fail(
      "world_manager_aro_closure_candidate_boundary_invalid",
      value.closureCandidateId,
    );
  }
  exactRef(
    value.assessmentRef,
    "closureCandidate.assessmentRef",
  );
  exactRef(
    value.evidenceBundleRef,
    "closureCandidate.evidenceBundleRef",
  );
  exactRef(
    value.targetAroRef,
    "closureCandidate.targetAroRef",
  );
  return true;
}

function buildAroSemanticVerificationRun(
  input = {},
) {
  const state = text(
    input.state,
    "scheduled",
  );
  const attempt = Math.max(
    1,
    Number(input.attempt || 1),
  );
  const runRevision = Math.max(
    1,
    Number(input.runRevision || 1),
  );
  const evidenceRef = exactRef(
    input.evidenceBundleRef,
    "verificationRun.evidenceBundleRef",
  );
  if (!RUN_STATES.has(state)) {
    fail(
      "world_manager_aro_semantic_verification_run_state_invalid",
      state,
    );
  }
  const runId = text(
    input.runId,
    stableId(
      "wm_aro_semantic_verification_run",
      {
        evidenceBundleRef:
          evidenceRef,
        attempt,
      },
    ),
  );
  const predecessorRef =
    input.predecessorRef
      ? exactRef(
          input.predecessorRef,
          "verificationRun.predecessorRef",
        )
      : null;
  if (
    (runRevision === 1) ===
      Boolean(predecessorRef)
  ) {
    fail(
      "world_manager_aro_semantic_verification_run_lineage_invalid",
    );
  }
  const run = artifact(
    ARO_SEMANTIC_VERIFICATION_RUN_SCHEMA,
    "runId",
    runId,
    {
      runRevision,
      predecessorRef,
      projectId: text(
        input.projectId ||
          evidenceRef.projectId,
        "",
      ),
      evidenceBundleRef: evidenceRef,
      attempt,
      state,
      requestManifest:
        input.requestManifest || null,
      validation:
        input.validation || null,
      assessmentRef:
        input.assessmentRef
          ? exactRef(
              input.assessmentRef,
              "verificationRun.assessmentRef",
            )
          : null,
      closureCandidateRef:
        input.closureCandidateRef
          ? exactRef(
              input.closureCandidateRef,
              "verificationRun.closureCandidateRef",
            )
          : null,
      openDecisionRefs:
        uniqueRefs(
          input.openDecisionRefs,
        ),
      error: input.error
        ? {
            code: text(
              input.error.code,
              "world_manager_aro_semantic_verification_failed",
            ),
            message: bounded(
              input.error.message,
              "ARO semantic verification failed.",
              1_200,
            ),
          }
        : null,
      telemetry: input.telemetry || null,
      retryable:
        RETRYABLE_RUN_STATES.has(
          state,
        ),
      semanticTruthAssessed:
        state === "completed",
      semanticTruthCanonical: false,
      sourceInspectionEffect: false,
      toolExecutionEffect: false,
      workspaceMutationEffect: false,
      remoteMutationEffect: false,
      canonicalAdmissionEffect: false,
      closureCertified: false,
      canonical: false,
      createdAt: text(
        input.createdAt,
        nowIso(input.now),
      ),
      updatedAt: text(
        input.updatedAt,
        input.createdAt ||
          nowIso(input.now),
      ),
    },
  );
  validateAroSemanticVerificationRun(run);
  return run;
}

function validateAroSemanticVerificationRun(value) {
  validateArtifact(
    value,
    ARO_SEMANTIC_VERIFICATION_RUN_SCHEMA,
    "runId",
  );
  if (
    !RUN_STATES.has(value.state) ||
    !Number.isInteger(value.runRevision) ||
    value.runRevision < 1 ||
    !Number.isInteger(value.attempt) ||
    value.attempt < 1 ||
    value.retryable !==
      RETRYABLE_RUN_STATES.has(
        value.state,
      ) ||
    value.semanticTruthAssessed !==
      (value.state === "completed") ||
    value.semanticTruthCanonical !== false ||
    value.sourceInspectionEffect !== false ||
    value.toolExecutionEffect !== false ||
    value.workspaceMutationEffect !== false ||
    value.remoteMutationEffect !== false ||
    value.canonicalAdmissionEffect !== false ||
    value.closureCertified !== false ||
    value.canonical !== false
  ) {
    fail(
      "world_manager_aro_semantic_verification_run_invalid",
      value.runId,
    );
  }
  if (
    (value.runRevision === 1) ===
      Boolean(value.predecessorRef)
  ) {
    fail(
      "world_manager_aro_semantic_verification_run_lineage_invalid",
      value.runId,
    );
  }
  exactRef(
    value.evidenceBundleRef,
    "verificationRun.evidenceBundleRef",
  );
  if (
    value.state === "completed" &&
    (
      !value.assessmentRef ||
      !value.closureCandidateRef
    )
  ) {
    fail(
      "world_manager_aro_semantic_verification_run_result_required",
      value.runId,
    );
  }
  return true;
}

function reviseAroSemanticVerificationRun(
  current,
  patch = {},
) {
  validateAroSemanticVerificationRun(
    current,
  );
  if (
    TERMINAL_RUN_STATES.has(
      current.state,
    )
  ) {
    fail(
      "world_manager_aro_semantic_verification_run_terminal",
      current.runId,
    );
  }
  return buildAroSemanticVerificationRun({
    ...current,
    ...patch,
    runId: current.runId,
    projectId: current.projectId,
    evidenceBundleRef:
      current.evidenceBundleRef,
    attempt: current.attempt,
    runRevision:
      current.runRevision + 1,
    predecessorRef: {
      kind:
        "aro_semantic_verification_run",
      id: current.runId,
      digest: current.digest,
      projectId: current.projectId,
    },
    createdAt: current.createdAt,
    updatedAt: text(
      patch.updatedAt,
      nowIso(patch.now),
    ),
  });
}

function assessmentItemSchema(keyField) {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      [keyField]: { type: "string" },
      status: { type: "string" },
      rationale: { type: "string" },
      evidenceKinds: {
        type: "array",
        items: { type: "string" },
      },
      blindspots: {
        type: "array",
        items: { type: "string" },
      },
      continuationPaths: {
        type: "array",
        items: { type: "string" },
      },
    },
    required: [
      keyField,
      "status",
      "rationale",
      "evidenceKinds",
      "blindspots",
      "continuationPaths",
    ],
  };
}

function semanticVerificationTool() {
  const parameters = {
    type: "object",
    additionalProperties: false,
    properties: {
      overallPosture: { type: "string" },
      assessmentSummary: {
        type: "string",
      },
      obligationAssessments: {
        type: "array",
        items:
          assessmentItemSchema(
            "obligationKey",
          ),
      },
      verificationAssessments: {
        type: "array",
        items:
          assessmentItemSchema(
            "verificationKey",
          ),
      },
      preservationAssessments: {
        type: "array",
        items:
          assessmentItemSchema(
            "constraintKey",
          ),
      },
      branchAssessments: {
        type: "array",
        items:
          assessmentItemSchema(
            "branchKey",
          ),
      },
      driftFindings: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            findingKey: { type: "string" },
            severity: { type: "string" },
            category: { type: "string" },
            statement: { type: "string" },
            evidenceKinds: {
              type: "array",
              items: { type: "string" },
            },
            affectedBranchKeys: {
              type: "array",
              items: { type: "string" },
            },
            recommendedResponse: {
              type: "string",
            },
          },
          required: [
            "findingKey",
            "severity",
            "category",
            "statement",
            "evidenceKinds",
            "affectedBranchKeys",
            "recommendedResponse",
          ],
        },
      },
      continuationPaths: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            pathKey: { type: "string" },
            label: { type: "string" },
            description: {
              type: "string",
            },
            priority: { type: "string" },
            preconditions: {
              type: "array",
              items: { type: "string" },
            },
          },
          required: [
            "pathKey",
            "label",
            "description",
            "priority",
            "preconditions",
          ],
        },
      },
      openDecisions: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            decisionKey: {
              type: "string",
            },
            question: { type: "string" },
            description: {
              type: "string",
            },
            options: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  optionKey: {
                    type: "string",
                  },
                  label: {
                    type: "string",
                  },
                  description: {
                    type: "string",
                  },
                  semanticValue: {
                    type: "string",
                  },
                },
                required: [
                  "optionKey",
                  "label",
                  "description",
                  "semanticValue",
                ],
              },
            },
          },
          required: [
            "decisionKey",
            "question",
            "description",
            "options",
          ],
        },
      },
      closureRecommendation: {
        type: "string",
      },
      closureRationale: {
        type: "string",
      },
    },
    required: [
      "overallPosture",
      "assessmentSummary",
      "obligationAssessments",
      "verificationAssessments",
      "preservationAssessments",
      "branchAssessments",
      "driftFindings",
      "continuationPaths",
      "openDecisions",
      "closureRecommendation",
      "closureRationale",
    ],
  };
  return {
    type: "function",
    name:
      ARO_SEMANTIC_VERIFICATION_ACTION,
    description:
      "Discharge a semantic assessment of exact acquired realization evidence against the supplied ARO contract. The action authors assessment meaning only; it cannot execute tools, mutate state, certify closure, or admit canonical truth.",
    strict: true,
    parameters,
  };
}

function semanticVerificationInstructions() {
  return [
    "You are the fixed WorldManager ARO semantic-verification role.",
    "Assess what the acquired worker evidence actually supports relative to the exact mutation contract and target ARO.",
    "Use only the supplied typed evidence. Do not claim to inspect source or run tools.",
    "The schema constrains discharge form, not semantic vocabulary. Write precise open-ended rationales, blindspots, drift categories, and continuation paths.",
    "Use the exact supplied obligationKey, verificationKey, constraintKey, and branchKey identities. Do not rename them.",
    "A green command is evidence, not semantic success. A worker final message is evidence, not closure.",
    "If evidence is missing, ambiguous, or conflicting, say so. Do not fill gaps optimistically.",
    "Open decisions are optional questions requiring user judgment. They will be persisted and governed elsewhere.",
    "Your closureRecommendation is advisory. A deterministic harness gate and later canonical admission remain separate.",
    `Call exactly one native action: ${ARO_SEMANTIC_VERIFICATION_ACTION}.`,
  ].join("\n");
}

function promptShape(input = {}) {
  const {
    project,
    bundle,
    contract,
    currentAro,
    targetAro,
    comparison,
  } = input;
  return [
    "[PROJECT]",
    JSON.stringify({
      id: project?.id ||
        contract.projectId,
      name: project?.name || "",
      summary:
        project?.summary || "",
    }),
    "[CURRENT/TARGET COMPARISON]",
    JSON.stringify({
      comparisonId:
        comparison.comparisonId,
      semanticSummary:
        comparison.semanticSummary,
      branchComparisons:
        comparison.branchComparisons,
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
        currentAro.branches.map(
          (branch) => ({
            branchKey:
              branch.branchKey,
            modality:
              branch.modality,
            statement:
              branch.statement,
          })),
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
        targetAro.branches.map(
          (branch) => ({
            branchKey:
              branch.branchKey,
            modality:
              branch.modality,
            statement:
              branch.statement,
          })),
    }),
    "[MUTATION CONTRACT]",
    JSON.stringify({
      contractRef:
        mutationContractRef(contract),
      summary:
        contract.contractSummary,
      strategy:
        contract.changeStrategy,
      obligations:
        contract
          .implementationObligations,
      verificationRequirements:
        contract
          .verificationRequirements,
      preservationConstraints:
        contract
          .preservationConstraints,
    }),
    "[ACQUIRED EXECUTION EVIDENCE]",
    JSON.stringify({
      evidenceBundleRef:
        evidenceBundleRef(bundle),
      workerTurn:
        bundle.workerTurnWitness,
      toolResults:
        bundle.toolResultWitnesses,
      workspaceEffects:
        bundle.workspaceEffectWitnesses,
      repositoryAfterState:
        bundle
          .repositoryAfterStateWitness,
      verificationCoverage:
        bundle
          .verificationCoverageWitnesses,
      ambiguityObserved:
        bundle.ambiguityObserved,
      missingEvidenceKindCount:
        bundle
          .missingEvidenceKindCount,
    }),
    "[VERIFICATION TASK]",
    "Determine what was achieved, what remains unproved, what drift occurred, and which continuation paths or user decisions are warranted.",
  ].join("\n");
}

function outputContract() {
  const contract = {
    schema:
      "direct_aro_semantic_verification_action_contract@1",
    outputContractId:
      "world_manager.aro_semantic_verification@1",
    selectionMechanism:
      "required_native_function_action",
    exactlyOneActionRequired: true,
    availableActionNames: [
      ARO_SEMANTIC_VERIFICATION_ACTION,
    ],
    semanticContentPosture: "open",
    sourceInspectionEffect: false,
    toolExecutionEffect: false,
    workspaceMutationEffect: false,
    remoteMutationEffect: false,
    canonicalAdmissionEffect: false,
    closureCertificationEffect: false,
    grantsAuthority: false,
    tools: [
      semanticVerificationTool(),
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
    semanticVerificationInstructions();
  const contract = outputContract();
  const manifest = artifact(
    ARO_SEMANTIC_VERIFICATION_REQUEST_MANIFEST_SCHEMA,
    "requestManifestId",
    stableId(
      "wm_aro_semantic_verification_manifest",
      {
        projectId: input.projectId,
        evidenceBundleRef:
          evidenceBundleRef(
            input.bundle,
          ),
        attempt: input.attempt,
        outputContractDigest:
          contract.digest,
      },
    ),
    {
      projectId: input.projectId,
      evidenceBundleRef:
        evidenceBundleRef(
          input.bundle,
        ),
      contractRef:
        mutationContractRef(
          input.contract,
        ),
      targetAroRef:
        abstractReasoningObjectRef(
          input.targetAro,
        ),
      attempt: input.attempt,
      instructionPackageRef:
        exactRef({
          kind:
            "trusted_aro_semantic_verification_instruction_package",
          id:
            "world_manager.aro_semantic_verification@1",
          digest: digestFor(
            "direct_aro_semantic_verification_instructions@1",
            { instructions },
          ),
        }),
      outputContractRef:
        exactRef({
          kind:
            "aro_semantic_verification_action_contract",
          id:
            contract.outputContractId,
          digest: contract.digest,
        }),
      rendererInstructionsAccepted:
        false,
      sourceInspectionEffect: false,
      toolExecutionEffect: false,
      workspaceMutationEffect: false,
      remoteMutationEffect: false,
      canonicalAdmissionEffect: false,
      closureCertificationEffect:
        false,
    },
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
    "world_manager_aro_semantic_verification_arguments_invalid",
  );
}

function actionCallsFromResult(value = {}) {
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

function normalizeAction(args) {
  const requiredArrays = [
    "obligationAssessments",
    "verificationAssessments",
    "preservationAssessments",
    "branchAssessments",
    "driftFindings",
    "continuationPaths",
    "openDecisions",
  ];
  if (
    !isPlainObject(args) ||
    !text(args.overallPosture, "") ||
    !text(args.assessmentSummary, "") ||
    !text(
      args.closureRecommendation,
      "",
    ) ||
    requiredArrays.some(
      (key) =>
        !Array.isArray(args[key]),
    )
  ) {
    fail(
      "world_manager_aro_semantic_verification_form_invalid",
    );
  }
  const keyedArrays = [
    ["obligationAssessments", "obligationKey"],
    ["verificationAssessments", "verificationKey"],
    ["preservationAssessments", "constraintKey"],
    ["branchAssessments", "branchKey"],
  ];
  for (const [arrayKey, keyField] of keyedArrays) {
    const keys = new Set();
    for (const row of args[arrayKey]) {
      const key = text(
        row?.[keyField],
        "",
      );
      if (
        !key ||
        keys.has(key) ||
        !text(row?.status, "") ||
        !text(row?.rationale, "") ||
        !Array.isArray(
          row?.evidenceKinds,
        ) ||
        !Array.isArray(
          row?.blindspots,
        ) ||
        !Array.isArray(
          row?.continuationPaths,
        )
      ) {
        fail(
          "world_manager_aro_semantic_verification_assessment_form_invalid",
          `${arrayKey}:${key}`,
        );
      }
      keys.add(key);
    }
  }
  return args;
}

function validateAction(runnerResult) {
  const calls =
    actionCallsFromResult(
      runnerResult,
    );
  const errors = [];
  let result = null;
  try {
    if (
      calls.length !== 1 ||
      calls[0].name !==
        ARO_SEMANTIC_VERIFICATION_ACTION
    ) {
      fail(
        "world_manager_aro_semantic_verification_exact_action_required",
        String(calls.length),
      );
    }
    result = normalizeAction(
      parseArguments(
        calls[0].argumentsJson ??
          calls[0].arguments ??
          calls[0].payload,
      ),
    );
  } catch (error) {
    errors.push({
      code: text(
        error?.code,
        "world_manager_aro_semantic_verification_validation_failed",
      ),
      detail: bounded(
        error?.detail ||
          error?.message,
        "",
        700,
      ),
    });
  }
  const validation = artifact(
    ARO_SEMANTIC_VERIFICATION_VALIDATION_SCHEMA,
    "validationId",
    stableId(
      "wm_aro_semantic_verification_validation",
      {
        actionNames:
          calls.map((call) =>
            text(call.name, "")),
        errors,
      },
    ),
    {
      state: errors.length
        ? "remanded"
        : "validated",
      requiredContract:
        "exactly_one_native_aro_semantic_verification_action",
      observedActionNames:
        calls.map((call) =>
          text(call.name, ""))
          .filter(Boolean),
      errors,
      semanticContentValidatedAgainstClosedTaxonomy:
        false,
      semanticTruthCanonical:
        false,
      sourceInspectionEffect: false,
      toolExecutionEffect: false,
      workspaceMutationEffect: false,
      canonicalAdmissionEffect: false,
      closureCertificationEffect:
        false,
    },
  );
  return { result, validation };
}

function normalizeTelemetry(
  telemetry,
  outcome,
) {
  return {
    runtimeMode: text(
      telemetry?.runtimeMode,
      "direct",
    ),
    model: text(
      telemetry?.model,
      "",
    ),
    reasoningEffort: text(
      telemetry?.reasoningEffort,
      "medium",
    ),
    inputTokens:
      Math.max(
        0,
        Number(
          telemetry?.inputTokens || 0,
        ),
      ),
    outputTokens:
      Math.max(
        0,
        Number(
          telemetry?.outputTokens || 0,
        ),
      ),
    toolCallCount:
      Math.max(
        0,
        Number(
          telemetry?.toolCallCount || 0,
        ),
      ),
    toolNames:
      uniqueStrings(
        telemetry?.toolNames,
        12,
      ),
    outcome,
  };
}

class DirectAroSemanticVerificationRuntime {
  constructor(options = {}) {
    this.runner =
      typeof options.runner ===
      "function"
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
    const {
      bundle,
      contract,
      currentAro,
      targetAro,
      comparison,
    } = input;
    validateAroExecutionEvidenceBundle(
      bundle,
    );
    validateAroMutationContract(
      contract,
    );
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
      bundle.captureState !==
        "acquired" ||
      bundle.workerTurnTerminal !== true
    ) {
      fail(
        "world_manager_aro_semantic_verification_evidence_not_acquired",
        bundle.evidenceBundleId,
      );
    }
    const attempt = Math.max(
      1,
      Number(input.attempt || 1),
    );
    const {
      instructions,
      outputContract:
        actionContract,
      manifest,
    } = requestManifest({
      projectId: bundle.projectId,
      bundle,
      contract,
      targetAro,
      attempt,
    });
    if (!this.runner) {
      fail(
        "world_manager_aro_semantic_verification_runner_unavailable",
      );
    }
    let runnerResult;
    try {
      runnerResult = await this.runner({
        schema:
          "direct_aro_semantic_verification_runner_request@1",
        projectId: bundle.projectId,
        evidenceBundleRef:
          evidenceBundleRef(bundle),
        contractRef:
          mutationContractRef(contract),
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
        prompt: promptShape({
          ...input,
          bundle,
          contract,
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
        toolExecutionEffect: false,
        workspaceMutationEffect: false,
        remoteMutationEffect: false,
        canonicalAdmissionEffect: false,
        closureCertificationEffect:
          false,
        grantsAuthority: false,
      });
    } catch (error) {
      return {
        state: "failed",
        requestManifest: manifest,
        validation: null,
        assessment: null,
        closureCandidate: null,
        telemetry:
          normalizeTelemetry(
            {},
            "failed",
          ),
        error: {
          code: text(
            error?.code,
            "world_manager_aro_semantic_verification_runner_failed",
          ),
          message: bounded(
            error?.message,
            "Direct ARO semantic verification failed.",
            700,
          ),
        },
      };
    }
    const validated =
      validateAction(runnerResult);
    if (
      validated.validation.state !==
        "validated"
    ) {
      return {
        state: "remanded",
        requestManifest: manifest,
        validation:
          validated.validation,
        assessment: null,
        closureCandidate: null,
        telemetry:
          normalizeTelemetry(
            runnerResult?.telemetry,
            "remanded",
          ),
        error: {
          code:
            validated.validation
              .errors[0]?.code ||
            "world_manager_aro_semantic_verification_remanded",
          message:
            validated.validation
              .errors[0]?.detail ||
            "The semantic-verification action did not satisfy its discharge form.",
        },
      };
    }
    const assessment = buildAssessment({
      ...input,
      result: validated.result,
      attempt,
      assessedAt:
        nowIso(this.now),
      now: this.now,
    });
    const closureCandidate =
      buildAroClosureCandidate({
        assessment,
        bundle,
        now: this.now,
      });
    return {
      state: "completed",
      requestManifest: manifest,
      validation:
        validated.validation,
      assessment,
      closureCandidate,
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
  ARO_CLOSURE_CANDIDATE_SCHEMA,
  ARO_SEMANTIC_VERIFICATION_ACTION,
  ARO_SEMANTIC_VERIFICATION_ASSESSMENT_SCHEMA,
  ARO_SEMANTIC_VERIFICATION_REQUEST_MANIFEST_SCHEMA,
  ARO_SEMANTIC_VERIFICATION_RUN_SCHEMA,
  ARO_SEMANTIC_VERIFICATION_VALIDATION_SCHEMA,
  DirectAroSemanticVerificationRuntime,
  assessmentRef,
  buildAroClosureCandidate,
  buildAroSemanticVerificationRun,
  closureCandidateRef,
  reviseAroSemanticVerificationRun,
  semanticVerificationInstructions,
  semanticVerificationTool,
  validateAroClosureCandidate,
  validateAroSemanticVerificationAssessment,
  validateAroSemanticVerificationRun,
};
