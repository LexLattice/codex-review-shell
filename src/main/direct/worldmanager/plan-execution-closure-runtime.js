"use strict";

const {
  digestFor,
  stableId,
} = require("./control-plane");

const PLAN_EXECUTION_CLOSURE_ACTION =
  "wm_discharge_plan_execution_closure_assessment";
const PLAN_EXECUTION_CLOSURE_ASSESSMENT_SCHEMA =
  "direct_plan_execution_closure_assessment@1";

function fail(code, detail = "") {
  const error = new Error(detail ? `${code}:${detail}` : code);
  error.code = code;
  if (detail) error.detail = detail;
  throw error;
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function text(value, fallback = "") {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : fallback;
}

function bounded(value, fallback = "", max = 1_600) {
  const source = text(value, fallback);
  return source.length > max
    ? `${source.slice(0, max - 1).trimEnd()}…`
    : source;
}

function uniqueStrings(values = [], max = 64) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => text(value, ""))
    .filter(Boolean))].slice(0, max);
}

function exactRef(value = {}, label = "ref") {
  const ref = {
    kind: text(value.kind, ""),
    id: text(value.id || value.artifactId, ""),
    digest: text(value.digest || value.artifactDigest, ""),
  };
  if (
    !ref.kind ||
    !ref.id ||
    !/^sha256:[a-f0-9]{64}$/i.test(ref.digest)
  ) fail("world_manager_plan_execution_closure_ref_invalid", label);
  const projectId = text(value.projectId, "");
  if (projectId) ref.projectId = projectId;
  return ref;
}

function closureAssessmentTool() {
  return {
    type: "function",
    name: PLAN_EXECUTION_CLOSURE_ACTION,
    description:
      "Assess exact runtime evidence against each admitted completion criterion. This authors semantic witness candidates only; it cannot execute effects, close the WorkThread, or admit project memory.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["assessments", "overallSummary", "continuationPaths"],
      properties: {
        assessments: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: [
              "criterion",
              "standing",
              "evidenceRefIds",
              "semanticSummary",
            ],
            properties: {
              criterion: { type: "string" },
              standing: {
                type: "string",
                enum: ["satisfied", "not_satisfied", "uncertain"],
              },
              evidenceRefIds: {
                type: "array",
                items: { type: "string" },
              },
              semanticSummary: { type: "string" },
            },
          },
        },
        overallSummary: { type: "string" },
        continuationPaths: {
          type: "array",
          items: { type: "string" },
        },
      },
    },
  };
}

function closureAssessmentInstructions() {
  return [
    "You are the fixed Project Manager implementation-closure assessor.",
    "Assess every exact completion criterion against only the supplied worker final message and typed runtime evidence catalog.",
    "A worker claim or successful command is evidence, not automatic semantic closure. Mark uncertain or not_satisfied whenever the evidence does not actually establish the criterion.",
    "Use criterion strings and evidence ref ids exactly as supplied. Do not rename or invent them.",
    "Your assessment is advisory evidence. The deterministic harness decides whether closure is complete; the Project Manager admission gate remains separate.",
    `Call exactly one ${PLAN_EXECUTION_CLOSURE_ACTION} action.`,
  ].join("\n");
}

function closureAssessmentPrompt(input = {}) {
  return [
    "[IMPLEMENTATION CONTRACT]",
    JSON.stringify({
      implementationContractRef: input.implementationContractRef,
      workThreadRef: input.workThreadRef,
      objective: input.objective,
      deliverables: input.deliverables,
      completionCriteria: input.completionCriteria,
    }),
    "[WORKER FINAL MESSAGE]",
    text(
      input.finalAssistantText,
      "No final assistant message was observed.",
    ),
    "[EXACT RUNTIME EVIDENCE CATALOG]",
    JSON.stringify(input.runtimeEvidenceRefs.map((ref) => ({
      id: ref.id,
      kind: ref.kind,
      digest: ref.digest,
    }))),
    "[ASSESSMENT TASK]",
    "Return one assessment for every exact criterion. Bind satisfied claims to one or more exact evidence ref ids.",
  ].join("\n");
}

function parseDischarge(value) {
  if (isPlainObject(value)) return value;
  try {
    const parsed = JSON.parse(String(value || ""));
    if (isPlainObject(parsed)) return parsed;
  } catch {}
  fail("world_manager_plan_execution_closure_assessment_arguments_invalid");
}

function buildPlanExecutionClosureAssessment(input = {}) {
  const criteria = uniqueStrings(input.completionCriteria);
  if (!criteria.length) {
    fail("world_manager_plan_execution_closure_criteria_required");
  }
  const runtimeEvidenceRefs = (Array.isArray(input.runtimeEvidenceRefs)
    ? input.runtimeEvidenceRefs
    : []).map((ref, index) => exactRef(ref, `runtimeEvidenceRefs[${index}]`));
  const evidenceById = new Map(runtimeEvidenceRefs.map((ref) => [ref.id, ref]));
  if (evidenceById.size !== runtimeEvidenceRefs.length) {
    fail("world_manager_plan_execution_closure_evidence_id_ambiguous");
  }
  const discharge = isPlainObject(input.discharge) ? input.discharge : {};
  const supplied = Array.isArray(discharge.assessments)
    ? discharge.assessments
    : [];
  const suppliedByCriterion = new Map(supplied.map((assessment) => [
    text(assessment?.criterion, ""),
    assessment,
  ]));
  const semanticAssessments = criteria.map((criterion) => {
    const assessment = suppliedByCriterion.get(criterion) || {};
    const standing = ["satisfied", "not_satisfied", "uncertain"].includes(
      assessment.standing,
    )
      ? assessment.standing
      : "uncertain";
    const evidenceRefs = uniqueStrings(assessment.evidenceRefIds)
      .map((id) => evidenceById.get(id))
      .filter(Boolean);
    return {
      criterion,
      standing,
      evidenceRefs,
      semanticSummary: bounded(
        assessment.semanticSummary,
        standing === "satisfied"
          ? "The closure assessor supplied no rationale."
          : "The completion criterion remains unproved.",
        1_200,
      ),
    };
  });
  const criterionWitnesses = semanticAssessments.map((assessment) => ({
    criterion: assessment.criterion,
    evidenceRefs: assessment.standing === "satisfied"
      ? assessment.evidenceRefs
      : [],
    semanticSummary: assessment.semanticSummary,
  }));
  const assessment = {
    schema: PLAN_EXECUTION_CLOSURE_ASSESSMENT_SCHEMA,
    assessmentId: stableId("wm_plan_execution_closure_assessment", {
      implementationContractRef: input.implementationContractRef,
      workThreadRef: input.workThreadRef,
      criteria,
      runtimeEvidenceRefs,
      semanticAssessments,
    }),
    projectId: text(input.projectId, ""),
    implementationContractRef: exactRef(
      input.implementationContractRef,
      "implementationContractRef",
    ),
    workThreadRef: exactRef(input.workThreadRef, "workThreadRef"),
    semanticAssessments,
    criterionWitnesses,
    overallSummary: bounded(
      discharge.overallSummary,
      "Closure assessment completed.",
      1_600,
    ),
    continuationPaths: uniqueStrings(discharge.continuationPaths, 16),
    model: text(input.telemetry?.model, ""),
    reasoningEffort: text(input.telemetry?.reasoningEffort, ""),
    semanticAssessmentOnly: true,
    closureCertified: false,
    canonicalEffect: false,
    grantsAuthority: false,
  };
  assessment.digest = digestFor(
    PLAN_EXECUTION_CLOSURE_ASSESSMENT_SCHEMA,
    assessment,
    ["digest"],
  );
  validatePlanExecutionClosureAssessment(assessment);
  return assessment;
}

function validatePlanExecutionClosureAssessment(value) {
  if (
    !isPlainObject(value) ||
    value.schema !== PLAN_EXECUTION_CLOSURE_ASSESSMENT_SCHEMA ||
    !text(value.assessmentId, "") ||
    !text(value.projectId, "") ||
    !Array.isArray(value.semanticAssessments) ||
    !Array.isArray(value.criterionWitnesses) ||
    value.semanticAssessmentOnly !== true ||
    value.closureCertified !== false ||
    value.canonicalEffect !== false ||
    value.grantsAuthority !== false ||
    value.digest !== digestFor(value.schema, value, ["digest"])
  ) fail("world_manager_plan_execution_closure_assessment_invalid");
  const implementationContractRef = exactRef(
    value.implementationContractRef,
    "implementationContractRef",
  );
  const workThreadRef = exactRef(value.workThreadRef, "workThreadRef");
  if (
    implementationContractRef.projectId !== value.projectId ||
    workThreadRef.projectId !== value.projectId ||
    value.semanticAssessments.length !== value.criterionWitnesses.length
  ) fail("world_manager_plan_execution_closure_assessment_binding_invalid");
  const seenCriteria = new Set();
  value.semanticAssessments.forEach((assessment, index) => {
    const criterion = text(assessment?.criterion, "");
    const witness = value.criterionWitnesses[index];
    if (
      !criterion ||
      seenCriteria.has(criterion) ||
      !["satisfied", "not_satisfied", "uncertain"].includes(
        assessment?.standing,
      ) ||
      !Array.isArray(assessment?.evidenceRefs) ||
      !text(assessment?.semanticSummary, "") ||
      witness?.criterion !== criterion ||
      !Array.isArray(witness?.evidenceRefs) ||
      !text(witness?.semanticSummary, "")
    ) fail("world_manager_plan_execution_closure_assessment_shape_invalid");
    seenCriteria.add(criterion);
    const assessmentRefs = assessment.evidenceRefs.map((ref, refIndex) =>
      exactRef(ref, `semanticAssessments[${index}].evidenceRefs[${refIndex}]`));
    const witnessRefs = witness.evidenceRefs.map((ref, refIndex) =>
      exactRef(ref, `criterionWitnesses[${index}].evidenceRefs[${refIndex}]`));
    if (
      assessment.standing !== "satisfied" && witnessRefs.length ||
      assessment.standing === "satisfied" &&
        JSON.stringify(witnessRefs) !== JSON.stringify(assessmentRefs)
    ) fail("world_manager_plan_execution_closure_witness_binding_invalid");
  });
  return true;
}

class DirectPlanExecutionClosureRuntime {
  constructor(options = {}) {
    this.runner = typeof options.runner === "function" ? options.runner : null;
  }

  available() {
    return Boolean(this.runner);
  }

  async evaluate(input = {}) {
    if (!this.runner) {
      fail("world_manager_plan_execution_closure_runner_unavailable");
    }
    const completionCriteria = uniqueStrings(input.completionCriteria);
    const runtimeEvidenceRefs = (Array.isArray(input.runtimeEvidenceRefs)
      ? input.runtimeEvidenceRefs
      : []).map((ref, index) => exactRef(ref, `runtimeEvidenceRefs[${index}]`));
    if (new Set(runtimeEvidenceRefs.map((ref) => ref.id)).size !==
      runtimeEvidenceRefs.length) {
      fail("world_manager_plan_execution_closure_evidence_id_ambiguous");
    }
    const tool = closureAssessmentTool();
    const runnerResult = await this.runner({
      schema: "direct_plan_execution_closure_runner_request@1",
      projectId: input.projectId,
      reasoningEffort: "medium",
      instructions: closureAssessmentInstructions(),
      prompt: closureAssessmentPrompt({
        ...input,
        completionCriteria,
        runtimeEvidenceRefs,
      }),
      outputContract: { tools: [tool] },
      tools: [tool],
      toolChoicePolicy: "required",
      sourceInspectionEffect: false,
      toolExecutionEffect: false,
      workspaceMutationEffect: false,
      remoteMutationEffect: false,
      canonicalAdmissionEffect: false,
      closureCertificationEffect: false,
      grantsAuthority: false,
    });
    const calls = Array.isArray(runnerResult?.actionCalls)
      ? runnerResult.actionCalls
      : [];
    if (
      calls.length !== 1 ||
      calls[0].name !== PLAN_EXECUTION_CLOSURE_ACTION
    ) {
      fail("world_manager_plan_execution_closure_assessment_action_invalid");
    }
    return buildPlanExecutionClosureAssessment({
      ...input,
      completionCriteria,
      runtimeEvidenceRefs,
      discharge: parseDischarge(calls[0].argumentsJson),
      telemetry: runnerResult.telemetry,
    });
  }
}

module.exports = {
  PLAN_EXECUTION_CLOSURE_ACTION,
  PLAN_EXECUTION_CLOSURE_ASSESSMENT_SCHEMA,
  DirectPlanExecutionClosureRuntime,
  buildPlanExecutionClosureAssessment,
  closureAssessmentInstructions,
  closureAssessmentPrompt,
  closureAssessmentTool,
  validatePlanExecutionClosureAssessment,
};
