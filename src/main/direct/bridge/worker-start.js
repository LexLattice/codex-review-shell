"use strict";

const crypto = require("node:crypto");
const {
  DIRECT_ROLE_HANDOFF_PACKET_SCHEMA,
  stableStringify,
  validateDirectRoleHandoffPacket,
} = require("./role-handoff-packet");
const {
  ARTIFACT_AUDIT_ASSIGNMENT_SCHEMA,
  ARTIFACT_PRODUCER_ASSIGNMENT_SCHEMA,
  artifactLifecycleInstanceRef,
  artifactTypeConstitutionRef,
  auditAssignmentRef,
  exactRefMatches,
  producerAssignmentRef,
  validateArtifactLifecycleInstance,
  validateArtifactTypeConstitution,
  validateAuditAssignment,
  validateProducerAssignment,
} = require("../worldmanager/artifact-lifecycle-kernel");

const DIRECT_WORKER_START_TRANSITION_SCHEMA = "direct_worker_start_transition@1";
const DIRECT_WORKER_CONTEXT_PACKET_SCHEMA = "direct_worker_context_packet@1";
const DIRECT_WORKER_START_RESULT_SCHEMA = "direct_worker_start_result@1";
const DIRECT_WORKER_START_VERSION = "direct-worker-start@1";
const DIRECT_ARTIFACT_WORKTHREAD_START_AUTHORIZATION_SCHEMA =
  "direct_artifact_workthread_start_authorization@1";

const WORKER_START_STATES = new Set(["ready_to_start", "blocked", "started", "failed"]);

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype;
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function boundedString(value, maxLength = 360) {
  const text = normalizeString(value, "");
  return text.length > maxLength ? `${text.slice(0, Math.max(0, maxLength - 3))}...` : text;
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function digestFor(domain, value) {
  return `sha256:${sha256(`${domain}:${stableStringify(value)}`)}`;
}

function isoTimestamp(input) {
  if (input instanceof Date && !Number.isNaN(input.getTime())) return input.toISOString();
  if (typeof input === "number" && Number.isFinite(input)) return new Date(input).toISOString();
  const parsed = Date.parse(normalizeString(input, ""));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString();
}

function normalizeEvidenceRef(input = {}, fallbackKind = "unknown") {
  const source = isPlainObject(input) ? input : {};
  const artifactId = normalizeString(source.artifactId || source.id || source.refId, "");
  const artifactDigest = normalizeString(source.artifactDigest || source.digest || source.specDigest, "");
  if (!artifactId && !artifactDigest) return null;
  return {
    kind: normalizeString(source.kind, fallbackKind),
    artifactId,
    artifactDigest,
    sourceConfidence: normalizeString(source.sourceConfidence || source.confidence, "diagnostic"),
    rendererSafeLabel: boundedString(source.rendererSafeLabel || source.label || fallbackKind, 120),
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
}

function normalizeEvidenceRefs(value, fallbackKind) {
  return (Array.isArray(value) ? value : [])
    .map((entry) => normalizeEvidenceRef(entry, fallbackKind))
    .filter(Boolean);
}

function normalizeCompiledAgentContextRef(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const id = normalizeString(
    source.id || source.compiledAgentContextId,
    "",
  );
  const digest = normalizeString(
    source.digest || source.compiledAgentContextDigest,
    "",
  );
  if (!id && !digest) return null;
  if (!id || !digest) {
    throw new Error(
      "direct_worker_compiled_agent_context_ref_invalid",
    );
  }
  return {
    kind: "compiled_agent_context",
    id,
    digest,
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
}

function normalizeRuntimeRef(input, kind) {
  if (!isPlainObject(input)) return null;
  const id = normalizeString(input.id, "");
  const digest = normalizeString(input.digest, "");
  if (!id && !digest) return null;
  if (!id || !digest || normalizeString(input.kind, kind) !== kind) {
    throw new Error(`direct_worker_${kind}_ref_invalid`);
  }
  return {
    kind,
    id,
    digest,
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
}

function operatorAcceptance(input = {}) {
  const source = isPlainObject(input) ? input : {};
  const decision = normalizeString(source.decision || source.operatorDecision, "");
  return {
    decision,
    accepted: source.accepted === true || decision === "accept" || decision === "accepted",
    rejected: source.rejected === true || decision === "reject" || decision === "rejected",
    operatorActionId: normalizeString(source.operatorActionId || source.actionId, ""),
    acceptedAt: normalizeString(source.acceptedAt || source.decidedAt, ""),
    rendererSafeLabel: boundedString(source.rendererSafeLabel || "Operator role-handoff decision", 160),
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
}

function buildArtifactWorkThreadStartAuthorization(input = {}, opts = {}) {
  const source = isPlainObject(input) ? input : {};
  const constitution = source.constitution;
  const lifecycle = source.lifecycle;
  const assignment = source.assignment;
  validateArtifactTypeConstitution(constitution);
  validateArtifactLifecycleInstance(lifecycle);
  if (!exactRefMatches(
    lifecycle.artifactTypeConstitutionRef,
    artifactTypeConstitutionRef(constitution),
  )) {
    throw new Error("direct_artifact_workthread_constitution_mismatch");
  }
  let assignmentKind = "";
  let assignmentId = "";
  let assignedAgentRef = null;
  let assignedRoleKind = "";
  let artifactRevisionRef = null;
  let assignmentExactRef = null;
  if (assignment?.schema === ARTIFACT_PRODUCER_ASSIGNMENT_SCHEMA) {
    validateProducerAssignment(assignment);
    assignmentKind = "producer";
    assignmentId = assignment.assignmentId;
    assignedAgentRef = assignment.producerAgentRef;
    assignedRoleKind = assignment.producerRole;
    assignmentExactRef = producerAssignmentRef(
      assignment,
      lifecycle.subjectScope?.projectId,
    );
  } else if (assignment?.schema === ARTIFACT_AUDIT_ASSIGNMENT_SCHEMA) {
    validateAuditAssignment(assignment);
    assignmentKind = "auditor";
    assignmentId = assignment.auditAssignmentId;
    assignedAgentRef = assignment.auditorAgentRef;
    assignedRoleKind = assignment.auditorRole;
    artifactRevisionRef = assignment.artifactRevisionRef;
    assignmentExactRef = auditAssignmentRef(
      assignment,
      lifecycle.subjectScope?.projectId,
    );
  } else {
    throw new Error("direct_artifact_workthread_assignment_invalid");
  }
  if (assignment.lifecycleId !== lifecycle.lifecycleId) {
    throw new Error("direct_artifact_workthread_lifecycle_mismatch");
  }
  if (
    assignmentKind === "producer" &&
    !exactRefMatches(lifecycle.producerAssignmentRef, assignmentExactRef)
  ) {
    throw new Error("direct_artifact_workthread_producer_assignment_stale");
  }
  if (
    artifactRevisionRef &&
    !exactRefMatches(artifactRevisionRef, lifecycle.currentArtifactRevisionRef)
  ) {
    throw new Error("direct_artifact_workthread_revision_stale");
  }
  const projectId = normalizeString(
    source.projectId || lifecycle.subjectScope?.projectId,
    "",
  );
  const workThreadId = normalizeString(
    source.workThreadId || lifecycle.subjectScope?.workThreadId,
    "",
  );
  if (
    !projectId ||
    projectId !== normalizeString(lifecycle.subjectScope?.projectId, "") ||
    !workThreadId
  ) {
    throw new Error("direct_artifact_workthread_scope_invalid");
  }
  const assignmentRef = assignmentExactRef;
  const workThreadRef = {
    kind: "work_thread",
    id: workThreadId,
    digest: digestFor("direct-artifact-workthread-scope@1", {
      projectId,
      workThreadId,
      lifecycleId: lifecycle.lifecycleId,
    }),
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  const remandObligations = (Array.isArray(source.remandObligations)
    ? source.remandObligations
    : [])
    .map((entry) => ({
      obligationRef: isPlainObject(entry?.obligationRef)
        ? {
            kind: normalizeString(
              entry.obligationRef.kind,
              "artifact_remand_obligation",
            ),
            id: normalizeString(entry.obligationRef.id, ""),
            digest: normalizeString(entry.obligationRef.digest, ""),
          }
        : null,
      obligation: boundedString(entry?.obligation, 800),
    }))
    .filter((entry) =>
      entry.obligationRef?.id &&
      entry.obligationRef?.digest &&
      entry.obligation,
    );
  const authorization = {
    schema: DIRECT_ARTIFACT_WORKTHREAD_START_AUTHORIZATION_SCHEMA,
    authorizationId: normalizeString(
      source.authorizationId,
      `artifact_workthread_auth_${sha256(`${constitution.digest}:${lifecycle.digest}:${assignment.digest}:${workThreadId}`).slice(0, 24)}`,
    ),
    authorizationMode: "artifact_constitution",
    projectId,
    workThreadRef,
    artifactTypeConstitutionRef:
      artifactTypeConstitutionRef(constitution),
    constitutionAdmissionReceiptRef:
      constitution.constitutionAdmissionReceiptRef,
    lifecycleRef: artifactLifecycleInstanceRef(lifecycle),
    assignmentKind,
    assignmentRef,
    assignedAgentRef,
    assignedRoleKind,
    artifactRevisionRef,
    ...(remandObligations.length ? { remandObligations } : {}),
    boundedCapabilityNames: assignmentKind === "auditor"
      ? [...(assignment.boundedCapabilityNames || [])]
      : [
          "ledger.publish_observation",
          "ledger.propose_claim",
          "ledger.attach_evidence",
          "ledger.raise_blocker",
          "ledger.submit_closure",
          "workspace.read.request",
          "workspace.patch.request",
          "workspace.command.request",
        ],
    providerLaunchAuthorized: true,
    providerCallScope: "single_direct_worker_text_turn",
    recursiveWorkerSpawnAllowed: false,
    workspaceEffectRequestAllowed: assignmentKind === "producer",
    perToolAuthorizationRequired: true,
    mechanicalRuntimeWitnessEligible: assignmentKind === "producer",
    workspaceMutationAllowed: false,
    canonicalAdmissionAllowed: false,
    grantsCanonicalAuthority: false,
    createdAt: isoTimestamp(opts.nowMs ?? source.nowMs ?? source.createdAt),
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  authorization.authorizationDigest = digestFor(
    DIRECT_ARTIFACT_WORKTHREAD_START_AUTHORIZATION_SCHEMA,
    { ...authorization, authorizationDigest: "" },
  );
  validateArtifactWorkThreadStartAuthorization(authorization);
  return authorization;
}

function validateArtifactWorkThreadStartAuthorization(value = {}) {
  if (
    !isPlainObject(value) ||
    value.schema !== DIRECT_ARTIFACT_WORKTHREAD_START_AUTHORIZATION_SCHEMA ||
    value.authorizationMode !== "artifact_constitution" ||
    !normalizeString(value.authorizationId, "") ||
    !normalizeString(value.projectId, "") ||
    !["producer", "auditor"].includes(value.assignmentKind) ||
    !normalizeString(value.assignedRoleKind, "") ||
    value.providerLaunchAuthorized !== true ||
    value.providerCallScope !== "single_direct_worker_text_turn" ||
    value.recursiveWorkerSpawnAllowed !== false ||
    (typeof value.workspaceEffectRequestAllowed !== "undefined" &&
      value.workspaceEffectRequestAllowed !==
        (value.assignmentKind === "producer")) ||
    (typeof value.perToolAuthorizationRequired !== "undefined" &&
      value.perToolAuthorizationRequired !== true) ||
    (typeof value.mechanicalRuntimeWitnessEligible !== "undefined" &&
      value.mechanicalRuntimeWitnessEligible !==
        (value.assignmentKind === "producer")) ||
    value.workspaceMutationAllowed !== false ||
    value.canonicalAdmissionAllowed !== false ||
    value.grantsCanonicalAuthority !== false
  ) {
    throw new Error("direct_artifact_workthread_authorization_invalid");
  }
  for (const refValue of [
    value.workThreadRef,
    value.artifactTypeConstitutionRef,
    value.constitutionAdmissionReceiptRef,
    value.lifecycleRef,
    value.assignmentRef,
    value.assignedAgentRef,
  ]) {
    if (
      !isPlainObject(refValue) ||
      !normalizeString(refValue.kind, "") ||
      !normalizeString(refValue.id, "") ||
      !normalizeString(refValue.digest, "")
    ) {
      throw new Error("direct_artifact_workthread_authorization_ref_invalid");
    }
  }
  if (
    (typeof value.remandObligations !== "undefined" &&
      !Array.isArray(value.remandObligations)) ||
    (Array.isArray(value.remandObligations) &&
      value.remandObligations.some((entry) =>
        !isPlainObject(entry) ||
        !isPlainObject(entry.obligationRef) ||
        !normalizeString(entry.obligationRef.kind, "") ||
        !normalizeString(entry.obligationRef.id, "") ||
        !normalizeString(entry.obligationRef.digest, "") ||
        !normalizeString(entry.obligation, "") ||
        entry.obligation.length > 800,
      ))
  ) {
    throw new Error(
      "direct_artifact_workthread_remand_obligations_invalid",
    );
  }
  if (
    value.assignmentKind === "auditor" &&
    (!value.artifactRevisionRef?.id || !value.artifactRevisionRef?.digest)
  ) {
    throw new Error("direct_artifact_workthread_authorization_revision_missing");
  }
  if (
    value.rawTextIncluded !== false ||
    value.rawPathIncluded !== false ||
    value.rawSecretIncluded !== false ||
    value.authorizationDigest !== digestFor(
      DIRECT_ARTIFACT_WORKTHREAD_START_AUTHORIZATION_SCHEMA,
      { ...value, authorizationDigest: "" },
    )
  ) {
    throw new Error("direct_artifact_workthread_authorization_digest_mismatch");
  }
  return true;
}

function handoffRef(packet = {}) {
  const source = isPlainObject(packet) ? packet : {};
  return {
    handoffPacketId: normalizeString(source.handoffPacketId, ""),
    handoffPacketDigest: normalizeString(source.packetDigest || source.sourceDigest, ""),
    status: normalizeString(source.status, ""),
    selectedWorkThreadId: normalizeString(source.workThreadRef?.workThreadId, ""),
    selectedAgentClassId: normalizeString(source.selectedAgentClass?.agentClassId, ""),
    selectedAgentClassKind: normalizeString(source.selectedAgentClass?.agentClassKind, ""),
    expectedOutputArtifactFamily: normalizeString(source.expectedOutputArtifactFamily, ""),
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
}

function transitionBlockers({
  projectId,
  handoffPacket,
  acceptance,
  artifactAuthorization,
  workerPrompt,
}) {
  const blockers = [];
  if (!isPlainObject(handoffPacket) || handoffPacket.schema !== DIRECT_ROLE_HANDOFF_PACKET_SCHEMA) {
    blockers.push("handoff_packet_missing_or_invalid");
    return blockers;
  }
  const requestedProjectId = normalizeString(projectId, "");
  const handoffProjectId = normalizeString(handoffPacket.projectId, "");
  if (requestedProjectId && handoffProjectId && requestedProjectId !== handoffProjectId) {
    blockers.push("handoff_project_id_mismatch");
  }
  try {
    validateDirectRoleHandoffPacket(handoffPacket);
  } catch (error) {
    blockers.push(`handoff_packet_validation_failed:${normalizeString(error.message, "unknown")}`);
  }
  if (handoffPacket.status !== "operator_review_required") blockers.push("handoff_not_ready_for_operator_review");
  if (Array.isArray(handoffPacket.blockerCodes) && handoffPacket.blockerCodes.length) blockers.push("handoff_has_blockers");
  let artifactAuthorized = false;
  if (artifactAuthorization) {
    try {
      validateArtifactWorkThreadStartAuthorization(artifactAuthorization);
      artifactAuthorized = true;
    } catch (error) {
      blockers.push(`artifact_authorization_invalid:${normalizeString(error.message, "unknown")}`);
    }
  }
  if (acceptance.accepted && artifactAuthorized) {
    blockers.push("multiple_worker_start_authorities");
  }
  if (!acceptance.accepted && !artifactAuthorized) {
    blockers.push(acceptance.rejected ? "operator_rejected_handoff" : "worker_start_authorization_missing");
  }
  if (artifactAuthorized) {
    if (artifactAuthorization.projectId !== handoffProjectId) blockers.push("artifact_authorization_project_mismatch");
    if (artifactAuthorization.workThreadRef.id !== normalizeString(handoffPacket.workThreadRef?.workThreadId, "")) blockers.push("artifact_authorization_workthread_mismatch");
    if (artifactAuthorization.workThreadRef.digest !== normalizeString(handoffPacket.workThreadRef?.sourceDigest, "")) blockers.push("artifact_authorization_workthread_revision_mismatch");
    if (artifactAuthorization.assignedRoleKind !== normalizeString(handoffPacket.selectedAgentClass?.agentClassKind, "")) blockers.push("artifact_authorization_role_mismatch");
    if (artifactAuthorization.assignedAgentRef.id !== normalizeString(handoffPacket.selectedAgentClass?.agentClassId, "")) blockers.push("artifact_authorization_agent_mismatch");
    if (artifactAuthorization.assignmentRef.digest !== normalizeString(handoffPacket.selectedAgentClass?.specDigest, "")) blockers.push("artifact_authorization_assignment_mismatch");
    const authorizationTransition = (handoffPacket.authorityTransitionRefs || []).find((entry) =>
      entry.artifactId === artifactAuthorization.authorizationId &&
      entry.artifactDigest === artifactAuthorization.authorizationDigest);
    if (!authorizationTransition) blockers.push("artifact_authorization_transition_ref_missing");
  }
  if (normalizeString(handoffPacket.selectedAgentClass?.agentClassKind, "") === "primary_agent") blockers.push("primary_agent_worker_start_forbidden");
  if (!normalizeString(handoffPacket.workThreadRef?.workThreadId, "")) blockers.push("work_thread_ref_missing");
  if (!normalizeString(handoffPacket.selectedAgentClass?.agentClassId, "")) blockers.push("agent_class_ref_missing");
  if (!normalizeString(workerPrompt, "")) blockers.push("worker_prompt_missing");
  return [...new Set(blockers)];
}

function buildDirectWorkerContextPacket(input = {}, opts = {}) {
  const source = isPlainObject(input) ? input : {};
  const handoffPacket = isPlainObject(source.handoffPacket) ? source.handoffPacket : {};
  const prompt = normalizeString(source.workerPrompt || source.prompt, "");
  const compiledAgentContextRef =
    normalizeCompiledAgentContextRef(
      source.compiledAgentContextRef,
    );
  const threadEnvironmentBindingRef = normalizeRuntimeRef(
    source.threadEnvironmentBindingRef,
    "thread_environment_binding",
  );
  const stepEnvironmentSnapshotRef = normalizeRuntimeRef(
    source.stepEnvironmentSnapshotRef,
    "step_environment_snapshot",
  );
  const selectedEnvironmentIds = [
    ...new Set((Array.isArray(
      source.environmentSelection?.selectedEnvironmentIds,
    )
      ? source.environmentSelection.selectedEnvironmentIds
      : []).map((entry) => normalizeString(entry, "")).filter(Boolean)),
  ];
  const primaryEnvironmentId = normalizeString(
    source.environmentSelection?.primaryEnvironmentId,
    selectedEnvironmentIds[0] || "",
  );
  if (
    Boolean(threadEnvironmentBindingRef) !==
      Boolean(stepEnvironmentSnapshotRef) ||
    (threadEnvironmentBindingRef && !selectedEnvironmentIds.length) ||
    (selectedEnvironmentIds.length &&
      selectedEnvironmentIds[0] !== primaryEnvironmentId)
  ) {
    throw new Error("direct_worker_environment_binding_invalid");
  }
  const contextRefs = [
    normalizeEvidenceRef({
      kind: "role_handoff_packet",
      artifactId: handoffPacket.handoffPacketId,
      artifactDigest: handoffPacket.packetDigest,
      sourceConfidence: "accepted",
      rendererSafeLabel: "Accepted role handoff packet",
    }, "role_handoff_packet"),
    ...(source.artifactWorkThreadAuthorization
      ? [normalizeEvidenceRef({
          kind: "artifact_workthread_start_authorization",
          artifactId:
            source.artifactWorkThreadAuthorization.authorizationId,
          artifactDigest:
            source.artifactWorkThreadAuthorization.authorizationDigest,
          sourceConfidence: "accepted",
          rendererSafeLabel:
            "Artifact constitution worker-start authorization",
        }, "artifact_workthread_start_authorization")]
      : []),
    ...normalizeEvidenceRefs(handoffPacket.contextRefs, "context_pack"),
    ...normalizeEvidenceRefs(handoffPacket.requestRefs, "request_manifest"),
    ...normalizeEvidenceRefs(source.contextRefs, "context_pack"),
  ].filter(Boolean);
  const sourceDigest = digestFor("direct-worker-context-packet-source@1", {
    handoffPacketId: handoffPacket.handoffPacketId || "",
    handoffPacketDigest: handoffPacket.packetDigest || "",
    workerPromptDigest: sha256(prompt),
    contextRefs,
    compiledAgentContextRef,
    threadEnvironmentBindingRef,
    stepEnvironmentSnapshotRef,
    primaryEnvironmentId,
    selectedEnvironmentIds,
  });
  const packet = {
    schema: DIRECT_WORKER_CONTEXT_PACKET_SCHEMA,
    version: DIRECT_WORKER_START_VERSION,
    workerContextPacketId: normalizeString(source.workerContextPacketId, `worker_context_${sourceDigest.slice(7, 31)}`),
    projectId: normalizeString(source.projectId || handoffPacket.projectId, ""),
    parentThreadId: normalizeString(source.parentThreadId || handoffPacket.threadId, ""),
    workThreadId: normalizeString(handoffPacket.workThreadRef?.workThreadId || source.workThreadId, ""),
    handoffPacketId: normalizeString(handoffPacket.handoffPacketId, ""),
    handoffPacketDigest: normalizeString(handoffPacket.packetDigest, ""),
    agentClassId: normalizeString(handoffPacket.selectedAgentClass?.agentClassId, ""),
    agentClassKind: normalizeString(handoffPacket.selectedAgentClass?.agentClassKind, ""),
    expectedOutputArtifactFamily: normalizeString(handoffPacket.expectedOutputArtifactFamily, ""),
    workerPromptDigest: sha256(prompt),
    workerPromptPreview: boundedString(prompt, 240),
    contextRefs,
    contextRefCount: contextRefs.length,
    compiledAgentContextRef,
    threadEnvironmentBindingRef,
    stepEnvironmentSnapshotRef,
    environmentSelection: threadEnvironmentBindingRef
      ? {
          primaryEnvironmentId,
          selectedEnvironmentIds,
          inheritancePosture: "exact_parent_step_snapshot",
        }
      : null,
    createdAt: isoTimestamp(opts.nowMs ?? source.nowMs ?? source.createdAt),
    providerInputEligible: true,
    rawPromptIncluded: false,
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
    sourceDigest,
  };
  packet.contextPacketDigest = digestFor(DIRECT_WORKER_CONTEXT_PACKET_SCHEMA, { ...packet, contextPacketDigest: "" });
  return packet;
}

function buildDirectWorkerStartTransition(input = {}, opts = {}) {
  const source = isPlainObject(input) ? input : {};
  const handoffPacket = isPlainObject(source.handoffPacket) ? source.handoffPacket : {};
  const acceptance = operatorAcceptance(source.operatorAcceptance || source.acceptance || {});
  const artifactAuthorization = isPlainObject(
    source.artifactWorkThreadAuthorization || source.startAuthorization,
  ) ? (source.artifactWorkThreadAuthorization || source.startAuthorization) : null;
  const workerPrompt = normalizeString(source.workerPrompt || source.prompt, "");
  const projectId = normalizeString(source.projectId || handoffPacket.projectId, "");
  const blockerCodes = transitionBlockers({
    projectId,
    handoffPacket,
    acceptance,
    artifactAuthorization,
    workerPrompt,
  });
  const startState = blockerCodes.length ? "blocked" : "ready_to_start";
  const contextPacket = buildDirectWorkerContextPacket({
    ...source,
    handoffPacket,
    workerPrompt,
  }, opts);
  const selectedAgentClass = isPlainObject(handoffPacket.selectedAgentClass) ? handoffPacket.selectedAgentClass : {};
  const sourceDigest = digestFor("direct-worker-start-transition-source@1", {
    handoffRef: handoffRef(handoffPacket),
    acceptance,
    artifactAuthorizationRef: artifactAuthorization
      ? {
          id: artifactAuthorization.authorizationId,
          digest: artifactAuthorization.authorizationDigest,
        }
      : null,
    workerPromptDigest: sha256(workerPrompt),
    contextPacketSourceDigest: contextPacket.sourceDigest,
    blockerCodes,
  });
  const transition = {
    schema: DIRECT_WORKER_START_TRANSITION_SCHEMA,
    version: DIRECT_WORKER_START_VERSION,
    workerStartTransitionId: normalizeString(source.workerStartTransitionId, `worker_start_${sourceDigest.slice(7, 31)}`),
    projectId,
    parentThreadId: normalizeString(source.parentThreadId || handoffPacket.threadId, ""),
    primaryThreadId: normalizeString(source.primaryThreadId || source.parentThreadId || handoffPacket.threadId, ""),
    workThreadId: normalizeString(handoffPacket.workThreadRef?.workThreadId || source.workThreadId, ""),
    startState,
    blockerCodes,
    handoffRef: handoffRef(handoffPacket),
    operatorAcceptance: acceptance,
    authorityMode: artifactAuthorization
      ? "artifact_constitution"
      : acceptance.accepted
        ? "operator_acceptance"
        : "none",
    artifactWorkThreadAuthorization: artifactAuthorization,
    selectedAgentClass: {
      agentClassId: normalizeString(selectedAgentClass.agentClassId, ""),
      agentClassKind: normalizeString(selectedAgentClass.agentClassKind, ""),
      displayName: boundedString(selectedAgentClass.displayName || selectedAgentClass.agentClassKind, 160),
    },
    expectedOutputArtifactFamily: normalizeString(handoffPacket.expectedOutputArtifactFamily, ""),
    contextPacket,
    workerPromptDigest: sha256(workerPrompt),
    workerPromptPreview: boundedString(workerPrompt, 240),
    workerSessionCreateAllowed: startState === "ready_to_start",
    workerTurnStartAllowed: startState === "ready_to_start",
    providerCallAllowed: startState === "ready_to_start",
    providerCallScope: startState === "ready_to_start" ? "single_direct_worker_text_turn" : "none",
    recursiveWorkerSpawnAllowed: false,
    objectAuditAllowed: false,
    workspaceMutationAllowed: false,
    workflowClosureAllowed: false,
    childDialogueFlattenedIntoPrimary: false,
    evidenceRefs: [
      normalizeEvidenceRef({
        kind: "role_handoff_packet",
        artifactId: handoffPacket.handoffPacketId,
        artifactDigest: handoffPacket.packetDigest,
        sourceConfidence: startState === "ready_to_start" ? "accepted" : "diagnostic",
        rendererSafeLabel: "Role handoff packet",
      }, "role_handoff_packet"),
      ...normalizeEvidenceRefs(handoffPacket.evidenceRefs, "unknown"),
    ].filter(Boolean),
    createdAt: isoTimestamp(opts.nowMs ?? source.nowMs ?? source.createdAt),
    rawPromptIncluded: false,
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
    sourceDigest,
  };
  transition.transitionDigest = digestFor(DIRECT_WORKER_START_TRANSITION_SCHEMA, { ...transition, transitionDigest: "" });
  return transition;
}

function buildDirectWorkerStartResult(input = {}, opts = {}) {
  const source = isPlainObject(input) ? input : {};
  const transition = isPlainObject(source.transition) ? source.transition : {};
  const session = isPlainObject(source.session) ? source.session : {};
  const turn = isPlainObject(source.turn) ? source.turn : {};
  const status = normalizeString(source.status, transition.startState === "ready_to_start" ? "started" : "blocked");
  const result = {
    schema: DIRECT_WORKER_START_RESULT_SCHEMA,
    version: DIRECT_WORKER_START_VERSION,
    resultId: normalizeString(source.resultId, `worker_start_result_${sha256(`${transition.workerStartTransitionId || ""}:${session.sessionId || ""}:${turn.turnId || ""}:${status}`).slice(0, 24)}`),
    projectId: normalizeString(source.projectId || transition.projectId || session.projectId, ""),
    workerStartTransitionId: normalizeString(transition.workerStartTransitionId, ""),
    workerStartTransitionDigest: normalizeString(transition.transitionDigest, ""),
    status: WORKER_START_STATES.has(status) ? status : "failed",
    parentThreadId: normalizeString(transition.parentThreadId || session.parentThreadId, ""),
    primaryThreadId: normalizeString(transition.primaryThreadId || session.primaryThreadId, ""),
    workerSessionId: normalizeString(session.sessionId || source.workerSessionId, ""),
    workerTurnId: normalizeString(turn.id || turn.turnId || source.workerTurnId, ""),
    agentClassKind: normalizeString(transition.selectedAgentClass?.agentClassKind || session.agentRole, ""),
    workerGraphAlignmentId: normalizeString(source.workerGraphAlignment?.alignmentId || source.workerGraphAlignmentId, ""),
    workerGraphAlignmentDigest: normalizeString(source.workerGraphAlignment?.integrity?.artifactDigest || source.workerGraphAlignmentDigest, ""),
    providerCallAllowed: status === "started",
    providerCallScope: status === "started" ? "single_direct_worker_text_turn" : "none",
    recursiveWorkerSpawnAllowed: false,
    childDialogueFlattenedIntoPrimary: false,
    rawPromptIncluded: false,
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
    createdAt: isoTimestamp(opts.nowMs ?? source.nowMs ?? source.createdAt),
  };
  result.resultDigest = digestFor(DIRECT_WORKER_START_RESULT_SCHEMA, { ...result, resultDigest: "" });
  return result;
}

function validateDirectWorkerStartTransition(transition = {}) {
  if (!isPlainObject(transition) || transition.schema !== DIRECT_WORKER_START_TRANSITION_SCHEMA) {
    throw new Error("direct_worker_start_transition_schema_mismatch");
  }
  if (!WORKER_START_STATES.has(transition.startState)) {
    throw new Error(`direct_worker_start_transition_state_invalid:${transition.startState || ""}`);
  }
  if (!normalizeString(transition.projectId, "")) throw new Error("direct_worker_start_transition_missing_project_id");
  if (!normalizeString(transition.workerStartTransitionId, "")) throw new Error("direct_worker_start_transition_missing_id");
  if (!normalizeString(transition.transitionDigest, "")) throw new Error("direct_worker_start_transition_missing_digest");
  if (transition.startState === "ready_to_start") {
    const operatorAuthorized =
      transition.operatorAcceptance?.accepted === true;
    const artifactAuthorized = Boolean(
      transition.artifactWorkThreadAuthorization &&
      validateArtifactWorkThreadStartAuthorization(
        transition.artifactWorkThreadAuthorization,
      ),
    );
    if (operatorAuthorized === artifactAuthorized) {
      throw new Error("direct_worker_start_transition_authority_ambiguous");
    }
    if (!normalizeString(transition.workThreadId, "")) throw new Error("direct_worker_start_transition_missing_work_thread");
    if (!normalizeString(transition.handoffRef?.handoffPacketId, "")) throw new Error("direct_worker_start_transition_missing_handoff");
    if (!normalizeString(transition.workerPromptDigest, "")) throw new Error("direct_worker_start_transition_missing_prompt_digest");
    if (transition.providerCallAllowed !== true || transition.workerTurnStartAllowed !== true || transition.workerSessionCreateAllowed !== true) {
      throw new Error("direct_worker_start_transition_ready_without_start_authority");
    }
    validateDirectWorkerContextPacket(transition.contextPacket);
  }
  for (const key of [
    "recursiveWorkerSpawnAllowed",
    "objectAuditAllowed",
    "workspaceMutationAllowed",
    "workflowClosureAllowed",
    "childDialogueFlattenedIntoPrimary",
    "rawPromptIncluded",
    "rawTextIncluded",
    "rawPathIncluded",
    "rawSecretIncluded",
  ]) {
    if (transition[key] !== false) throw new Error(`direct_worker_start_transition_authority_leak:${key}`);
  }
  return true;
}

function validateDirectWorkerContextPacket(packet = {}) {
  if (!isPlainObject(packet) || packet.schema !== DIRECT_WORKER_CONTEXT_PACKET_SCHEMA) {
    throw new Error("direct_worker_context_packet_schema_mismatch");
  }
  if (!normalizeString(packet.workerContextPacketId, "")) throw new Error("direct_worker_context_packet_missing_id");
  if (!normalizeString(packet.projectId, "")) throw new Error("direct_worker_context_packet_missing_project_id");
  if (!normalizeString(packet.parentThreadId, "")) throw new Error("direct_worker_context_packet_missing_parent_thread_id");
  if (!normalizeString(packet.workThreadId, "")) throw new Error("direct_worker_context_packet_missing_work_thread_id");
  if (!normalizeString(packet.handoffPacketId, "")) throw new Error("direct_worker_context_packet_missing_handoff_packet_id");
  if (!normalizeString(packet.agentClassId, "")) throw new Error("direct_worker_context_packet_missing_agent_class_id");
  if (!normalizeString(packet.workerPromptDigest, "")) throw new Error("direct_worker_context_packet_missing_prompt_digest");
  if (!normalizeString(packet.contextPacketDigest, "")) throw new Error("direct_worker_context_packet_missing_digest");
  if (
    packet.compiledAgentContextRef &&
    (
      packet.compiledAgentContextRef.kind !==
        "compiled_agent_context" ||
      !normalizeString(
        packet.compiledAgentContextRef.id,
        "",
      ) ||
      !normalizeString(
        packet.compiledAgentContextRef.digest,
        "",
      ) ||
      packet.compiledAgentContextRef
        .rawTextIncluded !== false ||
      packet.compiledAgentContextRef
        .rawPathIncluded !== false ||
      packet.compiledAgentContextRef
        .rawSecretIncluded !== false
    )
  ) {
    throw new Error(
      "direct_worker_context_packet_compiled_context_ref_invalid",
    );
  }
  const environmentRefsPresent = Boolean(
    packet.threadEnvironmentBindingRef ||
      packet.stepEnvironmentSnapshotRef ||
      packet.environmentSelection,
  );
  if (environmentRefsPresent) {
    const selection = packet.environmentSelection;
    if (
      packet.threadEnvironmentBindingRef?.kind !==
        "thread_environment_binding" ||
      !normalizeString(packet.threadEnvironmentBindingRef?.id, "") ||
      !normalizeString(packet.threadEnvironmentBindingRef?.digest, "") ||
      packet.stepEnvironmentSnapshotRef?.kind !==
        "step_environment_snapshot" ||
      !normalizeString(packet.stepEnvironmentSnapshotRef?.id, "") ||
      !normalizeString(packet.stepEnvironmentSnapshotRef?.digest, "") ||
      !isPlainObject(selection) ||
      !Array.isArray(selection.selectedEnvironmentIds) ||
      !selection.selectedEnvironmentIds.length ||
      selection.selectedEnvironmentIds[0] !==
        selection.primaryEnvironmentId ||
      selection.inheritancePosture !==
        "exact_parent_step_snapshot"
    ) {
      throw new Error(
        "direct_worker_context_packet_environment_binding_invalid",
      );
    }
    for (const ref of [
      packet.threadEnvironmentBindingRef,
      packet.stepEnvironmentSnapshotRef,
    ]) {
      if (
        ref.rawTextIncluded !== false ||
        ref.rawPathIncluded !== false ||
        ref.rawSecretIncluded !== false
      ) {
        throw new Error(
          "direct_worker_context_packet_environment_ref_exposure",
        );
      }
    }
  }
  if (packet.providerInputEligible !== true) throw new Error("direct_worker_context_packet_not_provider_eligible");
  if (packet.rawPromptIncluded !== false || packet.rawTextIncluded !== false || packet.rawPathIncluded !== false || packet.rawSecretIncluded !== false) {
    throw new Error("direct_worker_context_packet_raw_exposure");
  }
  return true;
}

function validateDirectWorkerStartResult(result = {}) {
  if (!isPlainObject(result) || result.schema !== DIRECT_WORKER_START_RESULT_SCHEMA) {
    throw new Error("direct_worker_start_result_schema_mismatch");
  }
  if (!WORKER_START_STATES.has(result.status)) throw new Error(`direct_worker_start_result_status_invalid:${result.status || ""}`);
  if (result.status === "started") {
    if (!normalizeString(result.workerSessionId, "")) throw new Error("direct_worker_start_result_missing_worker_session_id");
    if (!normalizeString(result.workerTurnId, "")) throw new Error("direct_worker_start_result_missing_worker_turn_id");
  }
  for (const key of [
    "recursiveWorkerSpawnAllowed",
    "childDialogueFlattenedIntoPrimary",
    "rawPromptIncluded",
    "rawTextIncluded",
    "rawPathIncluded",
    "rawSecretIncluded",
  ]) {
    if (result[key] !== false) throw new Error(`direct_worker_start_result_authority_leak:${key}`);
  }
  return true;
}

module.exports = {
  DIRECT_ARTIFACT_WORKTHREAD_START_AUTHORIZATION_SCHEMA,
  DIRECT_WORKER_CONTEXT_PACKET_SCHEMA,
  DIRECT_WORKER_START_RESULT_SCHEMA,
  DIRECT_WORKER_START_TRANSITION_SCHEMA,
  DIRECT_WORKER_START_VERSION,
  buildDirectWorkerContextPacket,
  buildDirectWorkerStartResult,
  buildDirectWorkerStartTransition,
  buildArtifactWorkThreadStartAuthorization,
  validateDirectWorkerContextPacket,
  validateDirectWorkerStartResult,
  validateDirectWorkerStartTransition,
  validateArtifactWorkThreadStartAuthorization,
};
