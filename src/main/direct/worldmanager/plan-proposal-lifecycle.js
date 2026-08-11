"use strict";

const {
  digestFor,
  stableId,
} = require("./control-plane");

const PLAN_PROPOSAL_REVISION_SCHEMA =
  "direct_world_manager_plan_proposal_revision@1";
const PLAN_PROPOSAL_REVIEW_RECEIPT_SCHEMA =
  "direct_world_manager_plan_proposal_review_receipt@1";
const PLAN_ADMISSION_REQUEST_SCHEMA =
  "direct_world_manager_plan_admission_request@1";
const PLAN_ADMISSION_DECISION_SCHEMA =
  "direct_world_manager_plan_admission_decision@1";
const IMPLEMENTATION_CONTRACT_SCHEMA =
  "direct_world_manager_implementation_contract@1";

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

function exactRef(value = {}, label = "ref") {
  const ref = {
    kind: text(value.kind, ""),
    id: text(value.id, ""),
    digest: text(value.digest, ""),
  };
  if (!ref.kind || !ref.id || !ref.digest) {
    fail("world_manager_plan_exact_ref_required", label);
  }
  if (text(value.projectId, "")) ref.projectId = value.projectId;
  return ref;
}

function exactRefs(values, label) {
  return (Array.isArray(values) ? values : [])
    .map((value, index) => exactRef(value, `${label}[${index}]`));
}

function finish(schema, value) {
  const result = { schema, ...value };
  result.digest = digestFor(schema, result, ["digest"]);
  return result;
}

function buildPlanProposalRevision(input = {}) {
  const projectId = text(input.projectId, "");
  const revision = Number(input.revision || 1);
  if (!projectId || !Number.isInteger(revision) || revision < 1) {
    fail("world_manager_plan_proposal_identity_invalid");
  }
  const sourceAgentResultRef = exactRef(
    input.sourceAgentResultRef,
    "sourceAgentResultRef",
  );
  const sourceFinalMessageRef = exactRef(
    input.sourceFinalMessageRef,
    "sourceFinalMessageRef",
  );
  const reconciliationRef = exactRef(
    input.reconciliationRef,
    "reconciliationRef",
  );
  const lineageId = text(
    input.proposalLineageId,
    stableId("wm_plan_proposal_lineage", {
      projectId,
      sourceSemanticEventId: input.sourceSemanticEventRef?.id,
    }),
  );
  const proposalRevisionId = stableId("wm_plan_proposal_revision", {
    lineageId,
    revision,
    sourceAgentResultRef,
  });
  return finish(PLAN_PROPOSAL_REVISION_SCHEMA, {
    proposalRevisionId,
    proposalId: proposalRevisionId,
    proposalLineageId: lineageId,
    projectId,
    revision,
    parentProposalRevisionRef: input.parentProposalRevisionRef
      ? exactRef(input.parentProposalRevisionRef, "parentProposalRevisionRef")
      : null,
    title: text(input.title, `Project plan v${revision}`),
    summary: text(input.summary, "A reconciled project plan is awaiting review."),
    proposalText: text(input.proposalText, ""),
    features: (Array.isArray(input.features) ? input.features : []).map(
      (feature, index) => ({
        featureId: text(feature?.featureId || feature?.id, `feature_${index + 1}`),
        title: text(feature?.title || feature, `Feature ${index + 1}`),
        outcome: text(feature?.outcome || feature?.description, ""),
      }),
    ),
    semanticDischarge: {
      semanticSummary: text(input.semanticSummary, input.summary),
      blindspots: (Array.isArray(input.blindspots) ? input.blindspots : [])
        .map((entry) => text(entry, "")).filter(Boolean),
      continuationPaths: (
        Array.isArray(input.continuationPaths)
          ? input.continuationPaths
          : []
      ).map((entry) => text(entry, "")).filter(Boolean),
      recommendation: text(input.recommendation, ""),
    },
    sourceAgentResultRef,
    sourceFinalMessageRef,
    sourceSemanticEventRef: exactRef(
      input.sourceSemanticEventRef,
      "sourceSemanticEventRef",
    ),
    reconciliationRef,
    expectedCanonicalRevisionRefs: exactRefs(
      input.expectedCanonicalRevisionRefs,
      "expectedCanonicalRevisionRefs",
    ),
    reconciliationState: "reconciled",
    state: "candidate",
    candidateOnly: true,
    canonicalWorldstateMutation: false,
    createdAt: text(input.createdAt, new Date().toISOString()),
  });
}

function validatePlanProposalRevision(value) {
  if (
    !value ||
    value.schema !== PLAN_PROPOSAL_REVISION_SCHEMA ||
    !text(value.proposalRevisionId, "") ||
    !text(value.proposalLineageId, "") ||
    !text(value.projectId, "") ||
    !Number.isInteger(value.revision) ||
    value.revision < 1 ||
    value.reconciliationState !== "reconciled" ||
    value.candidateOnly !== true ||
    value.canonicalWorldstateMutation !== false ||
    value.digest !== digestFor(value.schema, value, ["digest"])
  ) fail("world_manager_plan_proposal_revision_invalid");
  exactRef(value.sourceAgentResultRef, "sourceAgentResultRef");
  exactRef(value.sourceFinalMessageRef, "sourceFinalMessageRef");
  exactRef(value.sourceSemanticEventRef, "sourceSemanticEventRef");
  exactRef(value.reconciliationRef, "reconciliationRef");
  exactRefs(value.expectedCanonicalRevisionRefs, "expectedCanonicalRevisionRefs");
  return true;
}

function buildPlanProposalReviewReceipt(input = {}) {
  const proposalRevisionRef = exactRef(
    input.proposalRevisionRef,
    "proposalRevisionRef",
  );
  return finish(PLAN_PROPOSAL_REVIEW_RECEIPT_SCHEMA, {
    reviewReceiptId: stableId("wm_plan_proposal_review", {
      proposalRevisionRef,
      actorId: text(input.actorId, "operator"),
    }),
    proposalRevisionRef,
    actorId: text(input.actorId, "operator"),
    reviewState: "reviewed",
    sameContextEvidenceInspected: true,
    grantsAdmissionAuthority: false,
    reviewedAt: text(input.reviewedAt, new Date().toISOString()),
  });
}

function buildPlanAdmissionRequest(input = {}) {
  const proposalRevisionRef = exactRef(
    input.proposalRevisionRef,
    "proposalRevisionRef",
  );
  const reviewReceiptRef = exactRef(
    input.reviewReceiptRef,
    "reviewReceiptRef",
  );
  return finish(PLAN_ADMISSION_REQUEST_SCHEMA, {
    admissionRequestId: stableId("wm_plan_admission_request", {
      proposalRevisionRef,
      reviewReceiptRef,
      actorId: text(input.actorId, "operator"),
    }),
    projectId: text(input.projectId, proposalRevisionRef.projectId || ""),
    proposalRevisionRef,
    reviewReceiptRef,
    actorId: text(input.actorId, "operator"),
    expectedCanonicalRevisionRefs: exactRefs(
      input.expectedCanonicalRevisionRefs,
      "expectedCanonicalRevisionRefs",
    ),
    targetAdmissionScope: {
      kind: "project",
      projectId: text(input.projectId, proposalRevisionRef.projectId || ""),
    },
    decisionProtocol: "exact_revision_explicit_greenlight",
    state: "pending_graph_admission",
    downstreamEffectsExecuted: false,
    requestedAt: text(input.requestedAt, new Date().toISOString()),
  });
}

function buildPlanAdmissionDecision(input = {}) {
  const requestRef = exactRef(input.admissionRequestRef, "admissionRequestRef");
  const transitionRef = exactRef(input.graphTransitionRef, "graphTransitionRef");
  return finish(PLAN_ADMISSION_DECISION_SCHEMA, {
    admissionDecisionId: stableId("wm_plan_admission_decision", {
      requestRef,
      transitionRef,
    }),
    projectId: text(input.projectId, transitionRef.projectId || ""),
    proposalRevisionRef: exactRef(
      input.proposalRevisionRef,
      "proposalRevisionRef",
    ),
    admissionRequestRef: requestRef,
    graphTransitionRef: transitionRef,
    canonicalGraphRef: exactRef(input.canonicalGraphRef, "canonicalGraphRef"),
    decision: "admitted",
    activationState: text(input.activationState, "contract_pending"),
    decidedAt: text(input.decidedAt, new Date().toISOString()),
  });
}

function buildImplementationContract(input = {}) {
  const proposalRevisionRef = exactRef(
    input.proposalRevisionRef,
    "proposalRevisionRef",
  );
  const admissionDecisionRef = exactRef(
    input.admissionDecisionRef,
    "admissionDecisionRef",
  );
  const workThreadId = text(input.workThreadId, stableId(
    "wm_plan_implementation_work_thread",
    { proposalRevisionRef, admissionDecisionRef },
  ));
  return finish(IMPLEMENTATION_CONTRACT_SCHEMA, {
    implementationContractId: stableId("wm_implementation_contract", {
      proposalRevisionRef,
      admissionDecisionRef,
    }),
    projectId: text(input.projectId, proposalRevisionRef.projectId || ""),
    proposalRevisionRef,
    admissionDecisionRef,
    canonicalGraphRef: exactRef(input.canonicalGraphRef, "canonicalGraphRef"),
    graphTransitionRef: exactRef(input.graphTransitionRef, "graphTransitionRef"),
    workThreadId,
    state: "contract_received",
    objective: text(input.objective, "Implement the admitted project plan."),
    deliverables: (Array.isArray(input.deliverables) ? input.deliverables : [])
      .map((entry) => text(entry, "")).filter(Boolean),
    obligations: (Array.isArray(input.obligations) ? input.obligations : [
      "Preserve the admitted proposal and graph lineage.",
      "Acquire separate worker-start authority before implementation activity.",
      "Report evidence before claiming completion.",
    ]).map((entry) => text(entry, "")).filter(Boolean),
    completionCriteria: (
      Array.isArray(input.completionCriteria)
        ? input.completionCriteria
        : ["Every admitted deliverable has a closure witness."]
    ).map((entry) => text(entry, "")).filter(Boolean),
    authority: {
      admittedBy: text(input.actorId, "operator"),
      admissionKind: "explicit_greenlight",
      workerStartAuthorized: false,
      remoteMutationAllowed: false,
    },
    createdAt: text(input.createdAt, new Date().toISOString()),
  });
}

function planProposalRef(proposal) {
  if (
    !proposal ||
    proposal.schema !== PLAN_PROPOSAL_REVISION_SCHEMA ||
    !text(proposal.proposalRevisionId, "") ||
    !text(proposal.digest, "") ||
    !text(proposal.projectId, "")
  ) fail("world_manager_plan_proposal_ref_invalid");
  return {
    kind: "plan_proposal_revision",
    id: proposal.proposalRevisionId,
    digest: proposal.digest,
    projectId: proposal.projectId,
  };
}

module.exports = {
  IMPLEMENTATION_CONTRACT_SCHEMA,
  PLAN_ADMISSION_DECISION_SCHEMA,
  PLAN_ADMISSION_REQUEST_SCHEMA,
  PLAN_PROPOSAL_REVIEW_RECEIPT_SCHEMA,
  PLAN_PROPOSAL_REVISION_SCHEMA,
  buildImplementationContract,
  buildPlanAdmissionDecision,
  buildPlanAdmissionRequest,
  buildPlanProposalReviewReceipt,
  buildPlanProposalRevision,
  planProposalRef,
  validatePlanProposalRevision,
};
