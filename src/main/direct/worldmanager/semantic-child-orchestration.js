"use strict";

const {
  digestFor,
  stableId,
} = require("./control-plane");

const SEMANTIC_CHILD_CONTRACT_SCHEMA =
  "direct_semantic_child_contract@1";
const SEMANTIC_SPLIT_COORDINATION_SCHEMA =
  "direct_semantic_split_coordination@1";

const CHILD_EXECUTION_STATES = new Set([
  "materialized",
  "settling",
  "agent_world_ready",
  "running",
  "completed",
  "clarification_required",
  "remanded",
  "failed",
  "interrupted",
]);
const COORDINATION_STATES = new Set([
  "materialized",
  "executing",
  "joining",
  "completed",
  "partially_remanded",
  "remanded",
  "failed",
  "interrupted",
]);

function fail(code, detail = "") {
  const error = new Error(detail ? `${code}:${detail}` : code);
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
  return typeof value === "string" && value.trim()
    ? value.trim()
    : fallback;
}

function nowIso(now = Date.now) {
  const value = typeof now === "function" ? now() : now;
  return new Date(Number(value) || Date.now()).toISOString();
}

function exactRef(value, label) {
  if (
    !isPlainObject(value) ||
    !text(value.kind, "") ||
    !text(value.id, "") ||
    !/^sha256:[a-f0-9]{64}$/i.test(
      text(value.digest, ""),
    )
  ) {
    fail("semantic_child_orchestration_ref_invalid", label);
  }
  return {
    kind: value.kind,
    id: value.id,
    digest: value.digest,
    label: text(value.label, value.kind),
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
}

function normalizeTypeExpression(value = {}) {
  const source = isPlainObject(value) ? value : {};
  return {
    mode: text(source.mode, "freeform"),
    existingTypeRef: text(source.existingTypeRef, ""),
    proposedLabel: text(source.proposedLabel, ""),
    parentTypeRef: text(source.parentTypeRef, ""),
    differentia: text(source.differentia, ""),
    components: (Array.isArray(source.components)
      ? source.components
      : [])
      .map((entry) => text(entry, ""))
      .filter(Boolean),
    freeformCharacterization: text(
      source.freeformCharacterization,
      "",
    ),
  };
}

function semanticTypeExpressionText(value = {}) {
  const expression = normalizeTypeExpression(value);
  const primary = expression.mode === "existing_ref"
    ? expression.existingTypeRef
    : expression.mode === "proposed_type"
      ? expression.proposedLabel
      : expression.mode === "composite"
        ? expression.components.join(" + ")
        : expression.freeformCharacterization;
  return [
    text(primary, "Semantic child contract"),
    expression.parentTypeRef
      ? `Parent semantic type: ${expression.parentTypeRef}.`
      : "",
    expression.differentia
      ? `Differentia: ${expression.differentia}`
      : "",
  ].filter(Boolean).join("\n");
}

function buildSemanticChildContract(input = {}) {
  const parentEventRef = exactRef(
    input.parentEventRef,
    "semanticChildContract.parentEventRef",
  );
  const childIndex = Number(input.childIndex);
  if (!Number.isInteger(childIndex) || childIndex < 0) {
    fail("semantic_child_contract_index_invalid");
  }
  const semanticTypeExpression = normalizeTypeExpression(
    input.semanticTypeExpression,
  );
  const childSemanticEventId = text(
    input.childSemanticEventId,
    "",
  );
  if (!childSemanticEventId) {
    fail("semantic_child_contract_event_required");
  }
  const createdAt = text(input.createdAt, nowIso(input.now));
  const result = {
    schema: SEMANTIC_CHILD_CONTRACT_SCHEMA,
    childContractId: stableId(
      "wm_semantic_child_contract",
      {
        parentSemanticEventId: parentEventRef.id,
        childIndex,
        semanticTypeExpression,
      },
    ),
    parentEventRef,
    childSemanticEventId,
    childIndex,
    semanticTypeExpression,
    coordinationObjective: text(
      input.coordinationObjective,
      "Coordinate independently actionable semantic children.",
    ),
    semanticPrompt: semanticTypeExpressionText(
      semanticTypeExpression,
    ),
    provenancePosture: "derived_from_user_utterance",
    currentInstructionAuthorityInherited: true,
    canonicalEffectGranted: false,
    grantsAuthority: false,
    createdAt,
  };
  result.digest = digestFor(
    SEMANTIC_CHILD_CONTRACT_SCHEMA,
    result,
    ["digest"],
  );
  validateSemanticChildContract(result);
  return result;
}

function validateSemanticChildContract(value) {
  if (
    !isPlainObject(value) ||
    value.schema !== SEMANTIC_CHILD_CONTRACT_SCHEMA ||
    !text(value.childContractId, "") ||
    !text(value.childSemanticEventId, "") ||
    !Number.isInteger(Number(value.childIndex)) ||
    Number(value.childIndex) < 0 ||
    !isPlainObject(value.semanticTypeExpression) ||
    !text(value.semanticPrompt, "") ||
    value.provenancePosture !==
      "derived_from_user_utterance" ||
    value.currentInstructionAuthorityInherited !== true ||
    value.canonicalEffectGranted !== false ||
    value.grantsAuthority !== false
  ) {
    fail("semantic_child_contract_invalid");
  }
  exactRef(
    value.parentEventRef,
    "semanticChildContract.parentEventRef",
  );
  if (
    value.digest !==
    digestFor(
      SEMANTIC_CHILD_CONTRACT_SCHEMA,
      value,
      ["digest"],
    )
  ) {
    fail("semantic_child_contract_digest_mismatch");
  }
  return true;
}

function semanticChildIngressMessage(contract, childEvent) {
  validateSemanticChildContract(contract);
  if (
    !childEvent ||
    childEvent.semanticEventId !==
      contract.childSemanticEventId
  ) {
    fail("semantic_child_message_event_mismatch");
  }
  return {
    schema: "direct_semantic_child_ingress_message@1",
    messageId: contract.childContractId,
    semanticEventId: childEvent.semanticEventId,
    clientRequestId: childEvent.clientRequestId,
    authorKind: "harness",
    authorRole: "semantic_router",
    projectId: childEvent.projectId,
    text: contract.semanticPrompt,
    presentationState: "derived",
    createdAt: contract.createdAt,
    sourceKind: "semantic_child_contract",
    messageDigest: contract.digest,
    rawProviderPayloadIncluded: false,
    rawChainOfThoughtIncluded: false,
  };
}

function normalizeChildOutcome(value = {}) {
  const state = text(value.state, "materialized");
  const childIndex = Number(value.childIndex);
  if (!CHILD_EXECUTION_STATES.has(state)) {
    fail(
      "semantic_child_outcome_state_invalid",
      state,
    );
  }
  if (!Number.isInteger(childIndex) || childIndex < 0) {
    fail("semantic_child_outcome_index_invalid");
  }
  return {
    childContractRef: exactRef(
      value.childContractRef,
      "semanticSplitCoordination.childOutcome.childContractRef",
    ),
    childEventRef: exactRef(
      value.childEventRef,
      "semanticSplitCoordination.childOutcome.childEventRef",
    ),
    childIndex,
    state,
    taskSettlementRef: value.taskSettlementRef
      ? exactRef(
          value.taskSettlementRef,
          "semanticSplitCoordination.childOutcome.taskSettlementRef",
        )
      : null,
    agentResultRef: value.agentResultRef
      ? exactRef(
          value.agentResultRef,
          "semanticSplitCoordination.childOutcome.agentResultRef",
        )
      : null,
    candidateArtifactRefs: (
      Array.isArray(value.candidateArtifactRefs)
        ? value.candidateArtifactRefs
        : []
    ).map((entry) =>
      exactRef(
        entry,
        "semanticSplitCoordination.childOutcome.candidateArtifactRef",
      )),
    summary: text(value.summary, ""),
  };
}

function buildSemanticSplitCoordination(input = {}) {
  const parentEventRef = exactRef(
    input.parentEventRef,
    "semanticSplitCoordination.parentEventRef",
  );
  const childContractRefs = (
    Array.isArray(input.childContractRefs)
      ? input.childContractRefs
      : []
  ).map((entry) =>
    exactRef(
      entry,
      "semanticSplitCoordination.childContractRef",
    ));
  const childEventRefs = (
    Array.isArray(input.childEventRefs)
      ? input.childEventRefs
      : []
  ).map((entry) =>
    exactRef(
      entry,
      "semanticSplitCoordination.childEventRef",
    ));
  if (
    childContractRefs.length < 2 ||
    childContractRefs.length !== childEventRefs.length
  ) {
    fail("semantic_split_coordination_children_invalid");
  }
  const state = text(input.state, "materialized");
  if (!COORDINATION_STATES.has(state)) {
    fail("semantic_split_coordination_state_invalid", state);
  }
  const revision = Number(input.revision || 1);
  if (!Number.isInteger(revision) || revision < 1) {
    fail("semantic_split_coordination_revision_invalid");
  }
  const createdAt = text(input.createdAt, nowIso(input.now));
  const result = {
    schema: SEMANTIC_SPLIT_COORDINATION_SCHEMA,
    coordinationId: stableId(
      "wm_semantic_split_coordination",
      {
        parentSemanticEventId: parentEventRef.id,
      },
    ),
    parentEventRef,
    coordinationObjective: text(
      input.coordinationObjective,
      "Coordinate independently actionable semantic children.",
    ),
    childContractRefs,
    childEventRefs,
    childOutcomes: (
      Array.isArray(input.childOutcomes)
        ? input.childOutcomes
        : []
    ).map(normalizeChildOutcome),
    parentAgentResultRef: input.parentAgentResultRef
      ? exactRef(
          input.parentAgentResultRef,
          "semanticSplitCoordination.parentAgentResultRef",
        )
      : null,
    state,
    revision,
    summary: text(input.summary, ""),
    canonicalWorldstateMutation: false,
    grantsAuthority: false,
    createdAt,
    updatedAt: text(input.updatedAt, createdAt),
  };
  result.digest = digestFor(
    SEMANTIC_SPLIT_COORDINATION_SCHEMA,
    result,
    ["digest"],
  );
  validateSemanticSplitCoordination(result);
  return result;
}

function validateSemanticSplitCoordination(value) {
  if (
    !isPlainObject(value) ||
    value.schema !== SEMANTIC_SPLIT_COORDINATION_SCHEMA ||
    !text(value.coordinationId, "") ||
    !Array.isArray(value.childContractRefs) ||
    value.childContractRefs.length < 2 ||
    !Array.isArray(value.childEventRefs) ||
    value.childContractRefs.length !==
      value.childEventRefs.length ||
    !Array.isArray(value.childOutcomes) ||
    !COORDINATION_STATES.has(value.state) ||
    !Number.isInteger(Number(value.revision)) ||
    Number(value.revision) < 1 ||
    value.canonicalWorldstateMutation !== false ||
    value.grantsAuthority !== false
  ) {
    fail("semantic_split_coordination_invalid");
  }
  exactRef(
    value.parentEventRef,
    "semanticSplitCoordination.parentEventRef",
  );
  value.childContractRefs.forEach((entry, index) =>
    exactRef(
      entry,
      `semanticSplitCoordination.childContractRefs.${index}`,
    ));
  value.childEventRefs.forEach((entry, index) =>
    exactRef(
      entry,
      `semanticSplitCoordination.childEventRefs.${index}`,
    ));
  value.childOutcomes.forEach(normalizeChildOutcome);
  if (value.parentAgentResultRef) {
    exactRef(
      value.parentAgentResultRef,
      "semanticSplitCoordination.parentAgentResultRef",
    );
  }
  if (
    value.digest !==
    digestFor(
      SEMANTIC_SPLIT_COORDINATION_SCHEMA,
      value,
      ["digest"],
    )
  ) {
    fail("semantic_split_coordination_digest_mismatch");
  }
  return true;
}

function semanticSplitJoinPrompt(input = {}) {
  const coordination = input.coordination;
  validateSemanticSplitCoordination(coordination);
  const children = Array.isArray(input.children)
    ? input.children
    : [];
  return [
    "[ORIGINAL USER UTTERANCE]",
    text(input.parentMessage?.text, ""),
    "[SEMANTIC SPLIT COORDINATION - TRUSTED HARNESS EVIDENCE]",
    JSON.stringify({
      coordinationRef: {
        kind: "semantic_split_coordination",
        id: coordination.coordinationId,
        digest: coordination.digest,
      },
      coordinationObjective:
        coordination.coordinationObjective,
      children: children.map((entry) => ({
        childIndex: entry.childIndex,
        semanticContract:
          entry.contract?.semanticTypeExpression || null,
        settlement: entry.settlement
          ? {
              state: entry.settlement.state,
              taskType: entry.settlement.taskType,
              projectId: entry.settlement.projectId,
              responsibleRole:
                entry.settlement.responsibleRole,
              clarificationPrompt:
                entry.settlement.clarificationPrompt,
              rationale: entry.settlement.rationale,
            }
          : null,
        visibleManagerResult:
          entry.resultRecord
            ? {
                role:
                  entry.resultRecord.agentResult?.roleKind,
                state:
                  entry.resultRecord.agentResult?.resultState,
                response:
                  entry.resultRecord.userFacingResponse?.text,
              }
            : null,
        candidateArtifactRefs:
          entry.candidateArtifactRefs || [],
      })),
      authorityPosture: {
        childResultsAreEvidence: true,
        candidatesAreNotCanonical: true,
        canonicalWriteGranted: false,
      },
    }),
    "[PARENT CLOSURE CONTRACT]",
    "Formulate one coherent natural-language response to the original user utterance.",
    "Integrate the completed child results without exposing internal bureaucracy unless a limitation materially affects the answer.",
    "Distinguish clearly between completed analysis, non-canonical candidates, clarification needs, and failed or remanded children.",
    "Do not claim that a candidate is canonical, that a remanded child completed, or that any workspace or external effect occurred.",
    "Do not return JSON.",
  ].join("\n");
}

module.exports = {
  CHILD_EXECUTION_STATES,
  COORDINATION_STATES,
  SEMANTIC_CHILD_CONTRACT_SCHEMA,
  SEMANTIC_SPLIT_COORDINATION_SCHEMA,
  buildSemanticChildContract,
  buildSemanticSplitCoordination,
  semanticChildIngressMessage,
  semanticSplitJoinPrompt,
  semanticTypeExpressionText,
  validateSemanticChildContract,
  validateSemanticSplitCoordination,
};
