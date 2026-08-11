"use strict";

const {
  digestFor,
  stableId,
} = require("./control-plane");
const {
  semanticArtifactRef,
  validateOpenDecision,
} = require("./semantic-artifact-kernel");

const DECISION_TRANSITION_REQUEST_SCHEMA =
  "direct_decision_transition_request@1";
const DECISION_TRANSITION_RECEIPT_SCHEMA =
  "direct_decision_transition_receipt@1";
const DECISION_MECHANICAL_RESOLUTION_SCHEMA =
  "direct_decision_mechanical_resolution@1";
const DECISION_SEMANTIC_RELAY_ENVELOPE_SCHEMA =
  "direct_decision_semantic_relay_envelope@1";
const DECISION_RESOLUTION_HISTORY_RELATION_SCHEMA =
  "direct_decision_resolution_history_relation@1";

const DECISION_TRANSITION_KINDS = new Set([
  "resolve_option",
  "semantic_relay",
  "request_evidence",
  "request_authority",
]);
const DECISION_TRANSITION_RECEIPT_STATES = new Set([
  "accepted",
  "blocked",
  "resolved",
  "relayed",
  "failed",
]);

const TRANSITION_KIND_BY_RESOLUTION_MODE = Object.freeze({
  mechanical: "resolve_option",
  semantic_relay: "semantic_relay",
  evidence_request: "request_evidence",
  authority_request: "request_authority",
});

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
  return typeof value === "string" && value.trim()
    ? value.trim()
    : fallback;
}

function bounded(value, fallback = "", max = 2400) {
  return text(value, fallback).slice(0, max);
}

function nowIso(now = Date.now) {
  const value = typeof now === "function" ? now() : now;
  return new Date(Number(value) || Date.now()).toISOString();
}

function exactRef(value = {}, label = "ref") {
  const ref = {
    kind: text(value.kind, ""),
    id: text(value.id, ""),
    digest: text(value.digest, ""),
  };
  const projectId = text(value.projectId, "");
  if (projectId) ref.projectId = projectId;
  const refLabel = text(value.label, "");
  if (refLabel) ref.label = refLabel;
  if (!ref.kind || !ref.id || !ref.digest) {
    fail("decision_transition_ref_invalid", label);
  }
  return ref;
}

function decisionTransitionIdempotencyPayload(input = {}) {
  const optionRef = isPlainObject(input.optionRef)
    ? input.optionRef
    : {};
  return {
    clientRequestId: text(
      input.clientRequestId ||
        input.idempotencyKey,
      "",
    ),
    decisionId: text(
      input.decisionId ||
        input.decisionRef?.id,
      "",
    ),
    decisionDigest: text(
      input.decisionDigest ||
        input.decisionRef?.digest,
      "",
    ),
    expectedDecisionRevision: Number(
      input.expectedDecisionRevision ??
        input.expectedRevision,
    ),
    transitionKind: text(
      input.transitionKind,
      "",
    ),
    optionId: text(
      input.optionId ||
        optionRef.id,
      "",
    ),
    optionDigest: text(
      input.optionDigest ||
        optionRef.digest,
      "",
    ),
    semanticInput: bounded(
      input.semanticInput,
      "",
      4000,
    ),
    semanticRegionBindingId: text(
      input.semanticRegionBindingRef?.id,
      "",
    ),
    semanticRegionBindingDigest: text(
      input.semanticRegionBindingRef?.digest,
      "",
    ),
    actorId: text(input.actorId, "operator"),
    actorRole: text(input.actorRole, "operator"),
  };
}

function decisionTransitionIdempotencyDigest(input = {}) {
  return digestFor(
    "direct_decision_transition_idempotency_payload@1",
    decisionTransitionIdempotencyPayload(input),
  );
}

function buildDecisionTransitionRequest(
  input = {},
  decision,
  options = {},
) {
  validateOpenDecision(decision);
  const payload =
    decisionTransitionIdempotencyPayload(input);
  if (
    !payload.clientRequestId ||
    !payload.decisionId ||
    !payload.decisionDigest ||
    !Number.isInteger(
      payload.expectedDecisionRevision,
    ) ||
    payload.expectedDecisionRevision < 1 ||
    !DECISION_TRANSITION_KINDS.has(
      payload.transitionKind,
    )
  ) {
    fail("decision_transition_request_invalid");
  }
  if (
    payload.decisionId !== decision.decisionId ||
    payload.decisionDigest !== decision.digest
  ) {
    fail("decision_transition_exact_target_mismatch");
  }
  if (
    payload.expectedDecisionRevision !==
      decision.header.revision
  ) {
    fail("decision_transition_revision_conflict");
  }
  if (
    ["resolved", "superseded", "stale"].includes(
      decision.decisionState,
    )
  ) {
    fail(
      "decision_transition_state_not_actionable",
      decision.decisionState,
    );
  }
  const expectedTransitionKind =
    TRANSITION_KIND_BY_RESOLUTION_MODE[
      decision.resolutionMode
    ];
  if (
    payload.transitionKind !==
      expectedTransitionKind
  ) {
    fail(
      "decision_transition_contract_kind_mismatch",
      `${decision.resolutionMode}:${payload.transitionKind}`,
    );
  }
  if (
    decision.resolutionContract
      .transitionAvailability !==
        "available_wm_sc5"
  ) {
    fail(
      "decision_transition_execution_unavailable",
      decision.resolutionContract
        .transitionAvailability,
    );
  }
  const requiredRoles =
    decision.resolutionContract
      .requiredActorRoles || [];
  if (
    requiredRoles.length &&
    !requiredRoles.includes(payload.actorRole)
  ) {
    fail(
      "decision_transition_actor_role_forbidden",
      payload.actorRole,
    );
  }

  let optionRef = null;
  if (payload.transitionKind === "resolve_option") {
    const option = decision.options.find(
      (entry) =>
        entry.optionId === payload.optionId,
    );
    if (
      !option ||
      option.digest !== payload.optionDigest ||
      option.availability !== "available"
    ) {
      fail("decision_transition_option_unavailable");
    }
    const allowed = decision.resolutionContract
      .allowedOptionRefs
      .some((ref) =>
        ref.id === option.optionId &&
        ref.digest === option.digest);
    if (!allowed) {
      fail(
        "decision_transition_option_not_in_contract",
      );
    }
    optionRef = {
      kind: "decision_option",
      id: option.optionId,
      digest: option.digest,
      label: option.label,
    };
  } else if (!payload.semanticInput) {
    fail("decision_transition_semantic_input_required");
  }

  const createdAt = nowIso(options.now);
  const request = {
    schema: DECISION_TRANSITION_REQUEST_SCHEMA,
    decisionTransitionRequestId: stableId(
      "wm_decision_transition_request",
      {
        clientRequestId: payload.clientRequestId,
      },
    ),
    clientRequestId: payload.clientRequestId,
    idempotencyDigest:
      decisionTransitionIdempotencyDigest(input),
    decisionRef: {
      ...semanticArtifactRef(decision),
      label: decision.header.semanticIdentity,
    },
    expectedDecisionRevision:
      payload.expectedDecisionRevision,
    expectedProjectionRevision:
      input.expectedProjectionRevision !==
        null &&
      input.expectedProjectionRevision !==
        undefined &&
      Number.isInteger(
        Number(input.expectedProjectionRevision),
      )
        ? Number(input.expectedProjectionRevision)
        : null,
    resolutionContractRef: {
      kind: "decision_resolution_contract",
      id:
        decision.resolutionContract
          .resolutionContractId,
      digest:
        decision.resolutionContract.digest,
    },
    semanticRegionBindingRef:
      input.semanticRegionBindingRef
        ? exactRef(
            input.semanticRegionBindingRef,
            "decisionTransitionRequest.semanticRegionBindingRef",
          )
        : null,
    transitionKind: payload.transitionKind,
    optionRef,
    semanticInput: payload.semanticInput,
    actor: {
      actorId: payload.actorId,
      actorRole: payload.actorRole,
    },
    executionAuthorityGranted: false,
    grantsAuthority: false,
    createdAt,
  };
  request.digest = digestFor(
    DECISION_TRANSITION_REQUEST_SCHEMA,
    request,
    ["digest"],
  );
  validateDecisionTransitionRequest(request);
  return request;
}

function validateDecisionTransitionRequest(value) {
  if (
    !isPlainObject(value) ||
    value.schema !==
      DECISION_TRANSITION_REQUEST_SCHEMA ||
    !text(value.decisionTransitionRequestId, "") ||
    !text(value.clientRequestId, "") ||
    !text(value.idempotencyDigest, "") ||
    !Number.isInteger(
      Number(value.expectedDecisionRevision),
    ) ||
    !DECISION_TRANSITION_KINDS.has(
      value.transitionKind,
    ) ||
    !isPlainObject(value.actor) ||
    !text(value.actor.actorId, "") ||
    !text(value.actor.actorRole, "") ||
    value.executionAuthorityGranted !== false ||
    value.grantsAuthority !== false ||
    !text(value.createdAt, "")
  ) {
    fail("decision_transition_request_invalid");
  }
  exactRef(
    value.decisionRef,
    "decisionTransitionRequest.decisionRef",
  );
  exactRef(
    value.resolutionContractRef,
    "decisionTransitionRequest.resolutionContractRef",
  );
  if (value.semanticRegionBindingRef) {
    exactRef(
      value.semanticRegionBindingRef,
      "decisionTransitionRequest.semanticRegionBindingRef",
    );
  }
  if (
    value.transitionKind === "resolve_option"
  ) {
    exactRef(
      value.optionRef,
      "decisionTransitionRequest.optionRef",
    );
    if (text(value.semanticInput, "")) {
      fail(
        "decision_transition_mechanical_input_mixed",
      );
    }
  } else if (
    value.optionRef !== null ||
    !text(value.semanticInput, "")
  ) {
    fail(
      "decision_transition_semantic_input_invalid",
    );
  }
  if (
    value.digest !==
      digestFor(
        DECISION_TRANSITION_REQUEST_SCHEMA,
        value,
        ["digest"],
      )
  ) {
    fail(
      "decision_transition_request_digest_mismatch",
    );
  }
  return true;
}

function buildDecisionMechanicalResolution(
  request,
  decision,
  options = {},
) {
  validateDecisionTransitionRequest(request);
  validateOpenDecision(decision);
  if (request.transitionKind !== "resolve_option") {
    fail(
      "decision_mechanical_resolution_request_invalid",
    );
  }
  const option = decision.options.find(
    (entry) =>
      entry.optionId === request.optionRef.id &&
      entry.digest === request.optionRef.digest,
  );
  if (!option) {
    fail("decision_mechanical_resolution_option_missing");
  }
  const resolution = {
    schema:
      DECISION_MECHANICAL_RESOLUTION_SCHEMA,
    decisionResolutionId: stableId(
      "wm_decision_resolution",
      {
        requestId:
          request.decisionTransitionRequestId,
        decisionId: decision.decisionId,
        optionId: option.optionId,
      },
    ),
    requestRef: {
      kind: "decision_transition_request",
      id:
        request.decisionTransitionRequestId,
      digest: request.digest,
    },
    priorDecisionRef:
      semanticArtifactRef(decision),
    selectedOptionRef: {
      kind: "decision_option",
      id: option.optionId,
      digest: option.digest,
      label: option.label,
    },
    semanticValue: option.semanticValue,
    selectedBy: request.actor,
    effectSummary: bounded(
      option.effectSummary,
      "The selected semantic option was recorded.",
      1200,
    ),
    downstreamEffectsExecuted: false,
    executionAuthorityGranted: false,
    canonical: true,
    grantsAuthority: false,
    createdAt: nowIso(options.now),
  };
  resolution.digest = digestFor(
    DECISION_MECHANICAL_RESOLUTION_SCHEMA,
    resolution,
    ["digest"],
  );
  validateDecisionMechanicalResolution(resolution);
  return resolution;
}

function validateDecisionMechanicalResolution(value) {
  if (
    !isPlainObject(value) ||
    value.schema !==
      DECISION_MECHANICAL_RESOLUTION_SCHEMA ||
    !text(value.decisionResolutionId, "") ||
    !isPlainObject(value.semanticValue) ||
    !isPlainObject(value.selectedBy) ||
    !text(value.selectedBy.actorId, "") ||
    !text(value.selectedBy.actorRole, "") ||
    value.downstreamEffectsExecuted !== false ||
    value.executionAuthorityGranted !== false ||
    value.canonical !== true ||
    value.grantsAuthority !== false ||
    !text(value.createdAt, "")
  ) {
    fail("decision_mechanical_resolution_invalid");
  }
  exactRef(
    value.requestRef,
    "decisionMechanicalResolution.requestRef",
  );
  exactRef(
    value.priorDecisionRef,
    "decisionMechanicalResolution.priorDecisionRef",
  );
  exactRef(
    value.selectedOptionRef,
    "decisionMechanicalResolution.selectedOptionRef",
  );
  if (
    value.digest !==
      digestFor(
        DECISION_MECHANICAL_RESOLUTION_SCHEMA,
        value,
        ["digest"],
      )
  ) {
    fail(
      "decision_mechanical_resolution_digest_mismatch",
    );
  }
  return true;
}

function buildDecisionSemanticRelayEnvelope(
  request,
  decision,
  options = {},
) {
  validateDecisionTransitionRequest(request);
  validateOpenDecision(decision);
  if (request.transitionKind === "resolve_option") {
    fail("decision_semantic_relay_kind_invalid");
  }
  const relay = {
    schema:
      DECISION_SEMANTIC_RELAY_ENVELOPE_SCHEMA,
    decisionSemanticRelayEnvelopeId: stableId(
      "wm_decision_semantic_relay_envelope",
      {
        requestId:
          request.decisionTransitionRequestId,
      },
    ),
    requestRef: {
      kind: "decision_transition_request",
      id:
        request.decisionTransitionRequestId,
      digest: request.digest,
    },
    decisionRef:
      semanticArtifactRef(decision),
    scope: {
      ...decision.header.scope,
    },
    transitionKind: request.transitionKind,
    semanticInput: request.semanticInput,
    ingressClientRequestId: stableId(
      "wm_decision_relay_ingress",
      {
        requestId:
          request.decisionTransitionRequestId,
      },
    ),
    relayState: "pending_world_manager",
    canonicalDecisionMutation: false,
    executionAuthorityGranted: false,
    canonical: false,
    grantsAuthority: false,
    createdAt: nowIso(options.now),
  };
  relay.digest = digestFor(
    DECISION_SEMANTIC_RELAY_ENVELOPE_SCHEMA,
    relay,
    ["digest"],
  );
  validateDecisionSemanticRelayEnvelope(relay);
  return relay;
}

function validateDecisionSemanticRelayEnvelope(value) {
  if (
    !isPlainObject(value) ||
    value.schema !==
      DECISION_SEMANTIC_RELAY_ENVELOPE_SCHEMA ||
    !text(
      value.decisionSemanticRelayEnvelopeId,
      "",
    ) ||
    !DECISION_TRANSITION_KINDS.has(
      value.transitionKind,
    ) ||
    value.transitionKind === "resolve_option" ||
    !text(value.semanticInput, "") ||
    !text(value.ingressClientRequestId, "") ||
    value.relayState !== "pending_world_manager" ||
    value.canonicalDecisionMutation !== false ||
    value.executionAuthorityGranted !== false ||
    value.canonical !== false ||
    value.grantsAuthority !== false
  ) {
    fail("decision_semantic_relay_envelope_invalid");
  }
  exactRef(
    value.requestRef,
    "decisionSemanticRelayEnvelope.requestRef",
  );
  exactRef(
    value.decisionRef,
    "decisionSemanticRelayEnvelope.decisionRef",
  );
  if (
    value.digest !==
      digestFor(
        DECISION_SEMANTIC_RELAY_ENVELOPE_SCHEMA,
        value,
        ["digest"],
      )
  ) {
    fail(
      "decision_semantic_relay_envelope_digest_mismatch",
    );
  }
  return true;
}

function buildDecisionResolutionHistoryRelation(
  request,
  decision,
  targetRef,
  options = {},
) {
  validateDecisionTransitionRequest(request);
  validateOpenDecision(decision);
  const relationKind = {
    resolve_option: "resolves_object",
    semantic_relay: "requests_semantic_revision",
    request_evidence: "requests_evidence",
    request_authority: "requests_authority",
  }[request.transitionKind];
  const relation = {
    schema:
      DECISION_RESOLUTION_HISTORY_RELATION_SCHEMA,
    decisionResolutionHistoryRelationId: stableId(
      "wm_decision_resolution_relation",
      {
        requestId:
          request.decisionTransitionRequestId,
        relationKind,
      },
    ),
    relationKind,
    sourceRef: {
      kind: "decision_transition_request",
      id:
        request.decisionTransitionRequestId,
      digest: request.digest,
    },
    priorDecisionRef:
      semanticArtifactRef(decision),
    targetRef: exactRef(
      targetRef,
      "decisionResolutionHistoryRelation.targetRef",
    ),
    posture:
      request.transitionKind === "resolve_option"
        ? "admitted"
        : "candidate_source",
    durability: "durable",
    canonicalDecisionMutation:
      request.transitionKind === "resolve_option",
    executionAuthorityGranted: false,
    grantsAuthority: false,
    createdAt: nowIso(options.now),
  };
  relation.digest = digestFor(
    DECISION_RESOLUTION_HISTORY_RELATION_SCHEMA,
    relation,
    ["digest"],
  );
  validateDecisionResolutionHistoryRelation(
    relation,
  );
  return relation;
}

function validateDecisionResolutionHistoryRelation(
  value,
) {
  if (
    !isPlainObject(value) ||
    value.schema !==
      DECISION_RESOLUTION_HISTORY_RELATION_SCHEMA ||
    !text(
      value.decisionResolutionHistoryRelationId,
      "",
    ) ||
    ![
      "resolves_object",
      "requests_semantic_revision",
      "requests_evidence",
      "requests_authority",
    ].includes(value.relationKind) ||
    !["admitted", "candidate_source"].includes(
      value.posture,
    ) ||
    value.durability !== "durable" ||
    typeof value.canonicalDecisionMutation !==
      "boolean" ||
    value.executionAuthorityGranted !== false ||
    value.grantsAuthority !== false
  ) {
    fail(
      "decision_resolution_history_relation_invalid",
    );
  }
  exactRef(
    value.sourceRef,
    "decisionResolutionHistoryRelation.sourceRef",
  );
  exactRef(
    value.priorDecisionRef,
    "decisionResolutionHistoryRelation.priorDecisionRef",
  );
  exactRef(
    value.targetRef,
    "decisionResolutionHistoryRelation.targetRef",
  );
  if (
    value.digest !==
      digestFor(
        DECISION_RESOLUTION_HISTORY_RELATION_SCHEMA,
        value,
        ["digest"],
      )
  ) {
    fail(
      "decision_resolution_history_relation_digest_mismatch",
    );
  }
  return true;
}

function buildDecisionTransitionReceipt(
  input = {},
  options = {},
) {
  const request = input.request;
  validateDecisionTransitionRequest(request);
  const state = text(input.state, "accepted");
  if (
    !DECISION_TRANSITION_RECEIPT_STATES.has(
      state,
    )
  ) {
    fail("decision_transition_receipt_state_invalid");
  }
  const revision = Number(input.revision || 1);
  if (!Number.isInteger(revision) || revision < 1) {
    fail(
      "decision_transition_receipt_revision_invalid",
    );
  }
  const receipt = {
    schema: DECISION_TRANSITION_RECEIPT_SCHEMA,
    decisionTransitionReceiptId: stableId(
      "wm_decision_transition_receipt",
      {
        requestId:
          request.decisionTransitionRequestId,
      },
    ),
    receiptRevision: revision,
    predecessorReceiptRef: input.predecessorReceiptRef
      ? exactRef(
          input.predecessorReceiptRef,
          "decisionTransitionReceipt.predecessorReceiptRef",
        )
      : null,
    requestRef: {
      kind: "decision_transition_request",
      id:
        request.decisionTransitionRequestId,
      digest: request.digest,
    },
    priorDecisionRef: exactRef(
      input.priorDecisionRef ||
        request.decisionRef,
      "decisionTransitionReceipt.priorDecisionRef",
    ),
    currentDecisionRef:
      input.currentDecisionRef
        ? exactRef(
            input.currentDecisionRef,
            "decisionTransitionReceipt.currentDecisionRef",
          )
        : null,
    transitionArtifactRef:
      input.transitionArtifactRef
        ? exactRef(
            input.transitionArtifactRef,
            "decisionTransitionReceipt.transitionArtifactRef",
          )
        : null,
    historyRelationRef:
      input.historyRelationRef
        ? exactRef(
            input.historyRelationRef,
            "decisionTransitionReceipt.historyRelationRef",
          )
        : null,
    relayEventRef:
      input.relayEventRef
        ? exactRef(
            input.relayEventRef,
            "decisionTransitionReceipt.relayEventRef",
          )
        : null,
    state,
    transitionKind: request.transitionKind,
    summary: bounded(
      input.summary,
      state === "resolved"
        ? "The semantic decision was resolved."
        : state === "accepted"
          ? "The governed transition was accepted."
          : "The governed transition reached a visible terminal boundary.",
      1200,
    ),
    relayState: text(input.relayState, ""),
    blockedDependencyRefs:
      (Array.isArray(
        input.blockedDependencyRefs,
      )
        ? input.blockedDependencyRefs
        : []).map((ref, index) =>
        exactRef(
          ref,
          `decisionTransitionReceipt.blockedDependencyRefs.${index}`,
        )),
    errorCode: text(input.errorCode, ""),
    canonicalDecisionMutation:
      input.canonicalDecisionMutation === true,
    downstreamEffectsExecuted: false,
    executionAuthorityGranted: false,
    grantsAuthority: false,
    createdAt: nowIso(options.now),
  };
  receipt.digest = digestFor(
    DECISION_TRANSITION_RECEIPT_SCHEMA,
    receipt,
    ["digest"],
  );
  validateDecisionTransitionReceipt(receipt);
  return receipt;
}

function validateDecisionTransitionReceipt(value) {
  if (
    !isPlainObject(value) ||
    value.schema !==
      DECISION_TRANSITION_RECEIPT_SCHEMA ||
    !text(value.decisionTransitionReceiptId, "") ||
    !Number.isInteger(
      Number(value.receiptRevision),
    ) ||
    Number(value.receiptRevision) < 1 ||
    !DECISION_TRANSITION_RECEIPT_STATES.has(
      value.state,
    ) ||
    !DECISION_TRANSITION_KINDS.has(
      value.transitionKind,
    ) ||
    !Array.isArray(
      value.blockedDependencyRefs,
    ) ||
    typeof value.canonicalDecisionMutation !==
      "boolean" ||
    value.downstreamEffectsExecuted !== false ||
    value.executionAuthorityGranted !== false ||
    value.grantsAuthority !== false ||
    !text(value.createdAt, "")
  ) {
    fail("decision_transition_receipt_invalid");
  }
  exactRef(
    value.requestRef,
    "decisionTransitionReceipt.requestRef",
  );
  exactRef(
    value.priorDecisionRef,
    "decisionTransitionReceipt.priorDecisionRef",
  );
  if (value.predecessorReceiptRef) {
    exactRef(
      value.predecessorReceiptRef,
      "decisionTransitionReceipt.predecessorReceiptRef",
    );
  }
  if (value.currentDecisionRef) {
    exactRef(
      value.currentDecisionRef,
      "decisionTransitionReceipt.currentDecisionRef",
    );
  }
  if (value.transitionArtifactRef) {
    exactRef(
      value.transitionArtifactRef,
      "decisionTransitionReceipt.transitionArtifactRef",
    );
  }
  if (value.historyRelationRef) {
    exactRef(
      value.historyRelationRef,
      "decisionTransitionReceipt.historyRelationRef",
    );
  }
  if (value.relayEventRef) {
    exactRef(
      value.relayEventRef,
      "decisionTransitionReceipt.relayEventRef",
    );
  }
  value.blockedDependencyRefs.forEach(
    (ref, index) =>
      exactRef(
        ref,
        `decisionTransitionReceipt.blockedDependencyRefs.${index}`,
      ),
  );
  if (
    (value.state === "resolved" &&
      (
        !value.currentDecisionRef ||
        !value.transitionArtifactRef ||
        value.canonicalDecisionMutation !== true
      )) ||
    (value.state !== "resolved" &&
      value.canonicalDecisionMutation !== false)
  ) {
    fail(
      "decision_transition_receipt_effect_mismatch",
    );
  }
  if (
    value.digest !==
      digestFor(
        DECISION_TRANSITION_RECEIPT_SCHEMA,
        value,
        ["digest"],
      )
  ) {
    fail(
      "decision_transition_receipt_digest_mismatch",
    );
  }
  return true;
}

function decisionTransitionArtifactRef(artifact) {
  if (
    artifact?.schema ===
      DECISION_MECHANICAL_RESOLUTION_SCHEMA
  ) {
    validateDecisionMechanicalResolution(artifact);
    return {
      kind: "decision_mechanical_resolution",
      id: artifact.decisionResolutionId,
      digest: artifact.digest,
    };
  }
  validateDecisionSemanticRelayEnvelope(artifact);
  return {
    kind: "decision_semantic_relay_envelope",
    id:
      artifact.decisionSemanticRelayEnvelopeId,
    digest: artifact.digest,
  };
}

function decisionTransitionReceiptRef(receipt) {
  validateDecisionTransitionReceipt(receipt);
  return {
    kind: "decision_transition_receipt",
    id: receipt.decisionTransitionReceiptId,
    digest: receipt.digest,
  };
}

module.exports = {
  DECISION_MECHANICAL_RESOLUTION_SCHEMA,
  DECISION_RESOLUTION_HISTORY_RELATION_SCHEMA,
  DECISION_SEMANTIC_RELAY_ENVELOPE_SCHEMA,
  DECISION_TRANSITION_KINDS,
  DECISION_TRANSITION_RECEIPT_SCHEMA,
  DECISION_TRANSITION_REQUEST_SCHEMA,
  TRANSITION_KIND_BY_RESOLUTION_MODE,
  buildDecisionMechanicalResolution,
  buildDecisionResolutionHistoryRelation,
  buildDecisionSemanticRelayEnvelope,
  buildDecisionTransitionReceipt,
  buildDecisionTransitionRequest,
  decisionTransitionArtifactRef,
  decisionTransitionIdempotencyDigest,
  decisionTransitionReceiptRef,
  validateDecisionMechanicalResolution,
  validateDecisionResolutionHistoryRelation,
  validateDecisionSemanticRelayEnvelope,
  validateDecisionTransitionReceipt,
  validateDecisionTransitionRequest,
};
