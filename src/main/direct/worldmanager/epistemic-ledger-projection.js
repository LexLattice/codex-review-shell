"use strict";

const crypto = require("node:crypto");

const EPISTEMIC_FABRIC_PROJECTION_SCHEMA =
  "direct_epistemic_fabric_projection@1";
const EPISTEMIC_ACTIVITY_ITEM_SCHEMA =
  "direct_epistemic_activity_item@1";
const ARTIFACT_LIFECYCLE_CARD_SCHEMA =
  "direct_artifact_lifecycle_card@1";

const AUTHORITY_STATES = new Set([
  "none",
  "gate_ready",
  "admission_pending",
  "admitted",
  "failed",
]);

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
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function bounded(value, fallback = "", max = 1200) {
  const normalized = text(value, fallback);
  return normalized.length > max
    ? `${normalized.slice(0, Math.max(0, max - 1)).trimEnd()}…`
    : normalized;
}

function stableValue(value, omitted = new Set()) {
  if (Array.isArray(value)) return value.map((entry) => stableValue(entry, omitted));
  if (!isPlainObject(value)) return value;
  return Object.keys(value).sort().reduce((output, key) => {
    if (!omitted.has(key) && typeof value[key] !== "undefined") {
      output[key] = stableValue(value[key], omitted);
    }
    return output;
  }, {});
}

function digestFor(domain, value, omitted = []) {
  return `sha256:${crypto
    .createHash("sha256")
    .update(`${domain}\0${JSON.stringify(stableValue(value, new Set(omitted)))}`)
    .digest("hex")}`;
}

function exactRef(value, fallbackKind = "epistemic_object") {
  if (!isPlainObject(value)) return null;
  const kind = text(value.kind, fallbackKind);
  const id = text(
    value.id ||
      value.ledgerEventId ||
      value.lifecycleId ||
      value.deliveryId ||
      value.invalidationId ||
      value.gateDecisionId ||
      value.artifactRevisionId,
    "",
  );
  const digest = text(
    value.digest ||
      value.eventDigest ||
      value.lifecycleDigest ||
      value.deliveryDigest ||
      value.gateDecisionDigest ||
      value.artifactDigest,
    "",
  );
  if (!kind || !id || !digest) return null;
  return {
    kind,
    id,
    digest,
    ...(text(value.projectId, "") ? { projectId: text(value.projectId, "") } : {}),
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
}

function uniqueRefs(values = []) {
  const seen = new Set();
  return (Array.isArray(values) ? values : [])
    .map((value) => exactRef(value))
    .filter(Boolean)
    .filter((ref) => {
      const key = `${ref.kind}:${ref.id}:${ref.digest}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function sameExactRef(left, right) {
  const a = exactRef(left);
  const b = exactRef(right);
  return Boolean(
    a &&
      b &&
      a.kind === b.kind &&
      a.id === b.id &&
      a.digest === b.digest,
  );
}

function admissionScope(value = {}) {
  if (!isPlainObject(value)) return null;
  const kind = text(value.kind, "");
  const projectId = text(value.projectId, "");
  if (!kind || !projectId) return null;
  return {
    kind,
    projectId,
    ...(text(value.workThreadId, "")
      ? { workThreadId: text(value.workThreadId, "") }
      : {}),
    ...(text(value.taskType, "")
      ? { taskType: text(value.taskType, "") }
      : {}),
  };
}

function postureForEvent(event) {
  const posture = text(event.epistemicPosture || event.epistemicState, "observed");
  return [
    "observed",
    "candidate",
    "challenged",
    "supported",
    "contradicted",
    "remanded",
    "admitted",
    "superseded",
    "stale",
  ].includes(posture)
    ? posture
    : "observed";
}

function materialityForEvent(event) {
  const posture = postureForEvent(event);
  const actClass = text(event.actClass, "observation");
  if (["contradicted", "remanded", "stale"].includes(posture)) return "attention";
  if (posture === "admitted") return "authority";
  if (posture === "supported") return "material";
  if (["authorization", "admission"].includes(actClass)) return "authority";
  if (["assessment", "challenge"].includes(actClass)) return "material";
  return "routine";
}

function activityItem(event) {
  const eventRef = exactRef({ ...event, kind: "epistemic_ledger_event" });
  if (!eventRef) return null;
  const item = {
    schema: EPISTEMIC_ACTIVITY_ITEM_SCHEMA,
    eventRef,
    globalSequence: Number(event.globalSequence || event.sequence || 0),
    actClass: text(event.actClass, "observation"),
    actType: text(
      event.actTypeRef?.id || event.actType || event.eventKind,
      "epistemic_event",
    ),
    role: text(event.roleLaneRef?.id || event.actorRole, "harness"),
    projectId: text(event.subjectScope?.projectId || event.projectId, ""),
    lifecycleId: text(
      event.artifactLifecycleRef?.id || event.artifactLifecycleId,
      "",
    ),
    posture: postureForEvent(event),
    materiality: materialityForEvent(event),
    summary: bounded(
      event.rendererSafeSummary,
      "Epistemic transition recorded.",
      420,
    ),
    evidenceRefs: uniqueRefs(event.evidenceRefs),
    occurredAt: text(event.createdAt || event.occurredAt, ""),
    canonical: postureForEvent(event) === "admitted",
    grantsAuthority: false,
  };
  item.digest = digestFor(EPISTEMIC_ACTIVITY_ITEM_SCHEMA, item, ["digest"]);
  return item;
}

function gateForLifecycle(lifecycle, gateDecisions = []) {
  const ref = lifecycle.gateDecisionRef || null;
  return (Array.isArray(gateDecisions) ? gateDecisions : []).find((gate) =>
    (ref && gate.gateDecisionId === ref.id && gate.digest === ref.digest) ||
    (!ref && gate.lifecycleId === lifecycle.lifecycleId),
  ) || null;
}

function lifecycleCard(
  lifecycle,
  gateDecisions,
  assuranceGraphs,
  mechanicalWitnesses,
  auditAssignments,
  auditAssessments,
  admissionReceiptCandidates,
  admissionReceipts,
) {
  const lifecycleRef = exactRef({ ...lifecycle, kind: "artifact_lifecycle" });
  if (!lifecycleRef) return null;
  const gate = gateForLifecycle(lifecycle, gateDecisions);
  const graphValues = Array.isArray(assuranceGraphs) ? assuranceGraphs : [];
  const assurance = lifecycle.assuranceGraphRef
    ? graphValues.find((entry) =>
        entry.assuranceGraphId === lifecycle.assuranceGraphRef.id &&
        entry.digest === lifecycle.assuranceGraphRef.digest)
    : [...graphValues]
        .filter((entry) => entry.lifecycleId === lifecycle.lifecycleId)
        .sort((left, right) =>
          Number(right.graphRevision || 0) - Number(left.graphRevision || 0))[0] || null;
  const currentArtifactRevisionRef = exactRef(
    lifecycle.currentArtifactRevisionRef,
    "artifact_revision",
  );
  const currentMechanicalWitnesses = (Array.isArray(mechanicalWitnesses)
    ? mechanicalWitnesses
    : []
  ).filter((entry) =>
    sameExactRef(entry.artifactRevisionRef, currentArtifactRevisionRef));
  const currentAuditAssessments = (Array.isArray(auditAssessments)
    ? auditAssessments
    : []
  ).filter((entry) =>
    sameExactRef(entry.artifactRevisionRef, currentArtifactRevisionRef));
  const currentAuditAssignments = (Array.isArray(auditAssignments)
    ? auditAssignments
    : []
  ).filter((entry) =>
    sameExactRef(entry.artifactRevisionRef, currentArtifactRevisionRef));
  const auditNodes = (Array.isArray(assurance?.nodes) ? assurance.nodes : [])
    .filter((node) =>
      node.active === true &&
      node.required === true &&
      node.requirementKind === "semantic_audit");
  const graphCarriesRequirementNodes = Array.isArray(assurance?.nodes);
  const matchingAdmissionReceipt = (Array.isArray(admissionReceipts)
    ? admissionReceipts
    : []
  ).find((receipt) =>
    receipt.receiptPosture === "admitted" &&
    receipt.admitted === true &&
    receipt.canonicalEffect === true &&
    text(receipt.lifecycleRef?.digest, "") === lifecycleRef.digest &&
    sameExactRef(receipt.artifactRevisionRef, currentArtifactRevisionRef) &&
    (!lifecycle.gateDecisionRef ||
      sameExactRef(receipt.gateDecisionRef, lifecycle.gateDecisionRef)) &&
    text(receipt.targetAdmissionScope?.projectId, "") ===
      text(lifecycle.subjectScope?.projectId, "") &&
    exactRef(receipt.trustStoreReceiptRef, "trust_store_receipt"));
  const lifecycleAdmissionReceipts = (Array.isArray(admissionReceipts)
    ? admissionReceipts
    : []).filter((receipt) =>
      receipt.lifecycleRef?.digest === lifecycleRef.digest &&
      sameExactRef(receipt.artifactRevisionRef, currentArtifactRevisionRef) &&
      (!lifecycle.gateDecisionRef ||
        sameExactRef(receipt.gateDecisionRef, lifecycle.gateDecisionRef)));
  const pendingAdmissionReceipt = [...lifecycleAdmissionReceipts]
    .reverse()
    .find((receipt) => receipt.receiptPosture === "pending") || null;
  const failedAdmissionReceipt = [...lifecycleAdmissionReceipts]
    .reverse()
    .find((receipt) =>
      ["failed", "stale_cas"].includes(receipt.receiptPosture) &&
      receipt.admitted === false &&
      receipt.canonicalEffect === false) || null;
  const admissionCandidate = (Array.isArray(admissionReceiptCandidates)
    ? admissionReceiptCandidates
    : []).find((candidate) =>
      sameExactRef(candidate.artifactRevisionRef, currentArtifactRevisionRef) &&
      (!lifecycle.gateDecisionRef ||
        sameExactRef(candidate.gateDecisionRef, lifecycle.gateDecisionRef))) || null;
  const admissionReceiptRef = matchingAdmissionReceipt
    ? exactRef({
        kind: "artifact_admission_receipt",
        id: matchingAdmissionReceipt.admissionReceiptId,
        digest: matchingAdmissionReceipt.digest,
        projectId: lifecycle.subjectScope?.projectId,
      })
    : null;
  const trustStoreReceiptRef = matchingAdmissionReceipt
    ? exactRef(
        matchingAdmissionReceipt.trustStoreReceiptRef,
        "trust_store_receipt",
      )
    : null;
  const state = text(lifecycle.state, "requested");
  const receiptBackedCanonical = Boolean(
    state === "admitted" &&
      admissionReceiptRef &&
      trustStoreReceiptRef,
  );
  const authorityState = receiptBackedCanonical
    ? "admitted"
    : failedAdmissionReceipt
      ? "failed"
    : state === "admitted"
      ? "failed"
    : state === "admission_pending"
      ? "admission_pending"
      : state === "gate_ready"
        ? "gate_ready"
        : text(gate?.decisionState, "") === "failed"
          ? "failed"
          : "none";
  const card = {
    schema: ARTIFACT_LIFECYCLE_CARD_SCHEMA,
    lifecycleRef,
    artifactTypeRef: exactRef(
      lifecycle.artifactTypeConstitutionRef || lifecycle.artifactTypeRef,
      "artifact_type_constitution",
    ),
    currentArtifactRevisionRef,
    projectId: text(lifecycle.subjectScope?.projectId || lifecycle.projectId, ""),
    state,
    stateLabel: bounded(state.replace(/_/g, " "), "requested", 120),
    assurancePosture: text(
      assurance?.joinState || assurance?.posture || assurance?.state,
      state === "under_audit" ? "pending" : "not_evaluated",
    ),
    requiredAuditCount: Number(
      graphCarriesRequirementNodes
        ? auditNodes.length
        : assurance?.requiredAuditCount || lifecycle.requiredAuditCount || 0,
    ),
    satisfiedAuditCount: Number(
      graphCarriesRequirementNodes
        ? auditNodes.filter((node) => node.state === "supported").length
        : assurance?.satisfiedAuditCount || lifecycle.satisfiedAuditCount || 0,
    ),
    blockerCount: Number(
      gate?.blockerCodes?.length ||
        (Array.isArray(assurance?.nodes)
          ? assurance.nodes.filter((node) =>
              node.active === true &&
              node.required === true &&
              node.state !== "supported").length
          : 0) ||
        assurance?.blockerCount ||
        lifecycle.blockerCodes?.length ||
        0,
    ),
    remandCount: Number(lifecycle.remandCount || 0),
    authorityState: AUTHORITY_STATES.has(authorityState) ? authorityState : "none",
    producerAssignmentRef: exactRef(
      lifecycle.producerAssignmentRef,
      "artifact_producer_assignment",
    ),
    assuranceGraphRef: exactRef(
      lifecycle.assuranceGraphRef || assurance,
      "artifact_assurance_graph",
    ),
    mechanicalWitnessRefs: uniqueRefs(
      currentMechanicalWitnesses.map((witness) => ({
        kind: "artifact_mechanical_witness_join",
        id: witness.mechanicalWitnessJoinId,
        digest: witness.digest,
        projectId: lifecycle.subjectScope?.projectId,
      })),
    ),
    auditAssignments: currentAuditAssignments.map((assignment) => {
      const assessment = currentAuditAssessments.find((entry) =>
        sameExactRef(entry.auditAssignmentRef, {
          kind: "artifact_audit_assignment",
          id: assignment.auditAssignmentId,
          digest: assignment.digest,
          projectId: lifecycle.subjectScope?.projectId,
        }));
      return {
        assignmentRef: exactRef({
          kind: "artifact_audit_assignment",
          id: assignment.auditAssignmentId,
          digest: assignment.digest,
          projectId: lifecycle.subjectScope?.projectId,
        }),
        auditorAgentRef: exactRef(assignment.auditorAgentRef, "agent"),
        independenceReceiptRef: exactRef(
          assignment.independenceReceiptRef,
          "independence_receipt",
        ),
        requirementId: text(assignment.requirementId, ""),
        auditType: text(assignment.auditType, ""),
        verdict: text(assessment?.verdict, "pending"),
        assessmentRef: assessment
          ? exactRef({
              kind: "artifact_audit_assessment",
              id: assessment.auditAssessmentId,
              digest: assessment.digest,
              projectId: lifecycle.subjectScope?.projectId,
            })
          : null,
        evidenceRefs: uniqueRefs(assessment?.evidenceRefs),
        exactRevisionAssessed: assessment?.exactRevisionAssessed === true,
        canonicalEffect: false,
      };
    }),
    evidenceRefs: uniqueRefs([
      ...(Array.isArray(lifecycle.evidenceRefs) ? lifecycle.evidenceRefs : []),
      ...(Array.isArray(assurance?.evidenceRefs) ? assurance.evidenceRefs : []),
      ...currentMechanicalWitnesses.flatMap((entry) => entry.evidenceRefs || []),
      ...currentAuditAssessments.flatMap((entry) => entry.evidenceRefs || []),
      ...(trustStoreReceiptRef ? [trustStoreReceiptRef] : []),
    ]),
    gateDecisionRef: exactRef(gate, "artifact_gate_decision"),
    targetAdmissionScope: admissionScope(
      admissionCandidate?.targetAdmissionScope ||
        gate?.targetAdmissionScope,
    ),
    admissionAuthorityRef: exactRef(
      admissionCandidate?.admissionAuthorityRef ||
        gate?.admissionAuthorityRef,
      "admission_authority",
    ),
    expectedCanonicalRevisionRefs: uniqueRefs(
      admissionCandidate?.expectedCanonicalRevisionRefs,
    ),
    admissionReceiptRef,
    pendingAdmissionReceiptRef: pendingAdmissionReceipt
      ? exactRef({
          kind: "artifact_admission_receipt",
          id: pendingAdmissionReceipt.admissionReceiptId,
          digest: pendingAdmissionReceipt.digest,
          projectId: lifecycle.subjectScope?.projectId,
        })
      : null,
    admissionFailureReceiptRef: failedAdmissionReceipt
      ? exactRef({
          kind: "artifact_admission_receipt",
          id: failedAdmissionReceipt.admissionReceiptId,
          digest: failedAdmissionReceipt.digest,
          projectId: lifecycle.subjectScope?.projectId,
        })
      : null,
    admissionFailureCode: text(failedAdmissionReceipt?.failureCode, ""),
    trustStoreReceiptRef,
    receiptBackedCanonical,
    inspectionOnly: true,
    rendererCanMintAuthority: false,
    canonical: receiptBackedCanonical,
    grantsAuthority: false,
  };
  card.admissionRequestEligible = Boolean(
    card.authorityState === "gate_ready" &&
      card.targetAdmissionScope &&
      card.gateDecisionRef &&
      card.admissionAuthorityRef &&
      card.expectedCanonicalRevisionRefs.length,
  );
  card.digest = digestFor(ARTIFACT_LIFECYCLE_CARD_SCHEMA, card, ["digest"]);
  return card;
}

function compileEpistemicFabricProjection(input = {}) {
  const events = (Array.isArray(input.events) ? input.events : [])
    .map(activityItem)
    .filter(Boolean)
    .sort((left, right) => left.globalSequence - right.globalSequence)
    .slice(-100);
  const lifecycleCards = (Array.isArray(input.lifecycles) ? input.lifecycles : [])
    .map((lifecycle) => lifecycleCard(
      lifecycle,
      input.gateDecisions,
      input.assuranceGraphs,
      input.mechanicalWitnesses,
      input.auditAssignments,
      input.auditAssessments,
      input.admissionReceiptCandidates,
      input.admissionReceipts,
    ))
    .filter(Boolean)
    .sort((left, right) => left.lifecycleRef.id.localeCompare(right.lifecycleRef.id));
  const deliveries = (Array.isArray(input.deliveries) ? input.deliveries : [])
    .slice(-100)
    .map((delivery) => ({
      deliveryRef: exactRef({ ...delivery, kind: "ledger_delivery" }),
      recipientRole: text(
        delivery.recipientRoleRef?.id || delivery.recipientRole,
        "unknown",
      ),
      deliveryPosture: text(delivery.deliveryPosture || delivery.status, "queued"),
      wakeEligible: delivery.wakeEligible === true,
      cursorAfter: Number(delivery.cursorAfter || 0),
      eventRefs: uniqueRefs(delivery.eventRefs),
      rawPayloadIncluded: false,
    }))
    .filter((delivery) => delivery.deliveryRef);
  const invalidations = (Array.isArray(input.invalidations) ? input.invalidations : [])
    .slice(-100)
    .map((notice) => ({
      invalidationRef: exactRef({ ...notice, kind: "context_invalidation_notice" }),
      targetAgentRunRef: exactRef(notice.targetAgentRunRef, "agent_run"),
      posture: text(notice.posture || notice.state, "stale"),
      summary: bounded(notice.rendererSafeSummary, "Context invalidated.", 420),
      grantsAuthority: false,
    }))
    .filter((notice) => notice.invalidationRef);
  const lifecycleDischarges = (Array.isArray(input.lifecycleIngestionReceipts)
    ? input.lifecycleIngestionReceipts
    : [])
    .slice(-100)
    .map((receipt) => ({
      receiptRef: exactRef({
        kind: "artifact_lifecycle_ingestion_receipt",
        id: receipt.ingestionReceiptId,
        digest: receipt.receiptDigest,
      }),
      ledgerEventRef: exactRef(
        receipt.ledgerEventRef,
        "epistemic_ledger_event",
      ),
      lifecycleRef: exactRef(
        receipt.lifecycleRef,
        "artifact_lifecycle_instance",
      ),
      assignmentRef: exactRef(
        receipt.assignmentRef,
        "artifact_assignment",
      ),
      ingestionState: text(receipt.ingestionState, "rejected"),
      transitionKind: text(receipt.transitionKind, "none"),
      transitionRef: exactRef(
        receipt.transitionRef,
        "artifact_lifecycle_transition",
      ),
      nextAction: text(receipt.nextAction, "none"),
      blockerCodes: Array.isArray(receipt.blockerCodes)
        ? [...receipt.blockerCodes]
        : [],
      canonicalEffect: false,
      workspaceMutationAuthorized: false,
    }))
    .filter((entry) => entry.receiptRef && entry.ledgerEventRef);
  const runtimeEvidenceDischarges = (Array.isArray(
    input.artifactRuntimeEvidenceReceipts,
  )
    ? input.artifactRuntimeEvidenceReceipts
    : [])
    .slice(-100)
    .map((receipt) => ({
      receiptRef: exactRef({
        kind: "artifact_runtime_evidence_receipt",
        id: receipt.runtimeEvidenceReceiptId,
        digest: receipt.receiptDigest,
        projectId: receipt.projectId,
      }),
      lifecycleRef: exactRef(
        receipt.lifecycleRef,
        "artifact_lifecycle_instance",
      ),
      artifactRevisionRef: exactRef(
        receipt.artifactRevisionRef,
        "artifact_revision",
      ),
      repositoryStateRef: exactRef(
        receipt.repositoryStateRef,
        "artifact_repository_state",
      ),
      ingestionState: text(receipt.ingestionState, "blocked"),
      requirementDischarges: (Array.isArray(receipt.requirementDischarges)
        ? receipt.requirementDischarges
        : []).map((entry) => ({
          requirementId: text(entry.requirementId, ""),
          state: text(entry.state, "blocked"),
          evidenceRefs: uniqueRefs(entry.evidenceRefs),
          freshnessWitnessRef: exactRef(
            entry.freshnessWitnessRef,
            "artifact_runtime_freshness_witness",
          ),
        })),
      blockerCodes: Array.isArray(receipt.blockerCodes)
        ? [...receipt.blockerCodes]
        : [],
      workspaceMutationObserved:
        receipt.workspaceMutationObserved === true,
      workspaceMutationAuthorizedByLifecycle: false,
      canonicalEffect: false,
    }))
    .filter((entry) =>
      entry.receiptRef && entry.lifecycleRef && entry.artifactRevisionRef);
  const activeLifecycleId = text(input.activeLifecycleId, "");
  const focusedLifecycle = lifecycleCards.find((card) =>
    card.lifecycleRef.id === activeLifecycleId,
  ) || lifecycleCards.find((card) =>
    ["gate_ready", "admission_pending", "remanded"].includes(card.state),
  ) || null;
  const attentionItems = events.filter((item) =>
    ["attention", "authority", "material"].includes(item.materiality),
  );
  const projection = {
    schema: EPISTEMIC_FABRIC_PROJECTION_SCHEMA,
    ledgerDescriptor: {
      schema: text(input.ledgerDescriptor?.schema, "direct_epistemic_ledger_store_descriptor@1"),
      available: input.ledgerDescriptor?.available !== false,
      verified: input.ledgerDescriptor?.verified === true,
      globalSequence: Number(input.ledgerDescriptor?.globalSequence || 0),
      eventCount: Number(input.ledgerDescriptor?.eventCount || events.length),
      rawDatabasePathIncluded: false,
    },
    summary: {
      materialActivityCount: attentionItems.length,
      candidateArtifactCount: lifecycleCards.filter((card) =>
        ["candidate", "under_audit"].includes(card.state),
      ).length,
      remandedArtifactCount: lifecycleCards.filter((card) => card.state === "remanded").length,
      gateReadyCount: lifecycleCards.filter((card) => card.state === "gate_ready").length,
      admissionPendingCount: lifecycleCards.filter((card) => card.state === "admission_pending").length,
      admissionFailedCount: lifecycleCards.filter((card) =>
        card.authorityState === "failed").length,
      admittedArtifactCount: lifecycleCards.filter((card) => card.state === "admitted").length,
      queuedDeliveryCount: deliveries.filter((delivery) => delivery.deliveryPosture === "queued").length,
      staleContextCount: invalidations.filter((notice) => notice.posture === "stale").length,
      appliedLifecycleDischargeCount: lifecycleDischarges.filter((entry) =>
        entry.ingestionState === "applied").length,
      rejectedLifecycleDischargeCount: lifecycleDischarges.filter((entry) =>
        entry.ingestionState === "rejected").length,
      appliedRuntimeEvidenceCount: runtimeEvidenceDischarges.filter((entry) =>
        entry.ingestionState === "applied").length,
      blockedRuntimeEvidenceCount: runtimeEvidenceDischarges.filter((entry) =>
        entry.ingestionState !== "applied").length,
    },
    activityItems: events,
    materialActivityItems: attentionItems,
    lifecycleCards,
    focusedLifecycle,
    deliveries,
    invalidations,
    lifecycleDischarges,
    runtimeEvidenceDischarges,
    surfaceContract: {
      defaultShowsMaterialTransitionsOnly: true,
      evidenceBeforeAdmissionSameContext: true,
      candidateAndCanonicalDistinct: true,
      deliveryAndWakeDistinct: true,
      advisoryAndAuthorityActionsSeparated: true,
      responsiveSameContextPreserved: true,
      typedAdmissionRequestExactBound: true,
      deliveryAcknowledgementNeverAdmissions: true,
      rendererCanMintAuthority: false,
    },
    generatedAt: text(input.generatedAt, new Date().toISOString()),
    canonical: false,
    grantsAuthority: false,
    rawChainOfThoughtIncluded: false,
    rawSecretIncluded: false,
  };
  projection.digest = digestFor(EPISTEMIC_FABRIC_PROJECTION_SCHEMA, projection, ["digest"]);
  validateEpistemicFabricProjection(projection);
  return projection;
}

function validateEpistemicFabricProjection(projection) {
  if (
    !isPlainObject(projection) ||
    projection.schema !== EPISTEMIC_FABRIC_PROJECTION_SCHEMA ||
    !Array.isArray(projection.activityItems) ||
    !Array.isArray(projection.lifecycleCards) ||
    !Array.isArray(projection.deliveries) ||
    !Array.isArray(projection.invalidations) ||
    !Array.isArray(projection.lifecycleDischarges) ||
    !Array.isArray(projection.runtimeEvidenceDischarges) ||
    projection.surfaceContract?.defaultShowsMaterialTransitionsOnly !== true ||
    projection.surfaceContract?.evidenceBeforeAdmissionSameContext !== true ||
    projection.surfaceContract?.candidateAndCanonicalDistinct !== true ||
    projection.surfaceContract?.deliveryAndWakeDistinct !== true ||
    projection.surfaceContract?.advisoryAndAuthorityActionsSeparated !== true ||
    projection.surfaceContract?.typedAdmissionRequestExactBound !== true ||
    projection.surfaceContract?.deliveryAcknowledgementNeverAdmissions !== true ||
    projection.surfaceContract?.rendererCanMintAuthority !== false ||
    projection.canonical !== false ||
    projection.grantsAuthority !== false ||
    projection.rawChainOfThoughtIncluded !== false ||
    projection.rawSecretIncluded !== false
  ) {
    fail("epistemic_fabric_projection_invalid");
  }
  for (const card of projection.lifecycleCards) {
    if (
      card.schema !== ARTIFACT_LIFECYCLE_CARD_SCHEMA ||
      !AUTHORITY_STATES.has(card.authorityState) ||
      card.rendererCanMintAuthority !== false ||
      card.grantsAuthority !== false ||
      card.canonical !== card.receiptBackedCanonical ||
      typeof card.admissionRequestEligible !== "boolean" ||
      !Array.isArray(card.auditAssignments) ||
      !Array.isArray(card.mechanicalWitnessRefs) ||
      !Array.isArray(card.expectedCanonicalRevisionRefs) ||
      (card.admissionRequestEligible &&
        (!card.targetAdmissionScope ||
          !card.gateDecisionRef ||
          !card.admissionAuthorityRef ||
          !card.expectedCanonicalRevisionRefs.length)) ||
      (card.state === "admitted" &&
        (!card.canonical ||
          !card.admissionReceiptRef ||
          !card.trustStoreReceiptRef ||
          card.authorityState !== "admitted"))
    ) {
      fail("artifact_lifecycle_card_invalid", card.lifecycleRef?.id);
    }
  }
  if (
    projection.digest !==
      digestFor(EPISTEMIC_FABRIC_PROJECTION_SCHEMA, projection, ["digest"])
  ) {
    fail("epistemic_fabric_projection_digest_invalid");
  }
  return true;
}

module.exports = {
  ARTIFACT_LIFECYCLE_CARD_SCHEMA,
  EPISTEMIC_ACTIVITY_ITEM_SCHEMA,
  EPISTEMIC_FABRIC_PROJECTION_SCHEMA,
  compileEpistemicFabricProjection,
  validateEpistemicFabricProjection,
};
