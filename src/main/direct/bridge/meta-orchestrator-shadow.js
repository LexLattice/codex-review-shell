"use strict";

const crypto = require("node:crypto");
const { stableStringify } = require("./role-handoff-packet");

const DIRECT_META_ORCHESTRATOR_PLAN_POINTER_SCHEMA = "direct_meta_orchestrator_plan_pointer@1";
const DIRECT_META_ORCHESTRATOR_STEP_EVENT_SCHEMA = "direct_meta_orchestrator_step_event@1";
const DIRECT_IMPLEMENTATION_EVIDENCE_ARTIFACT_SCHEMA = "direct_implementation_evidence_artifact@1";
const DIRECT_AUDIT_ARTIFACT_SCHEMA = "direct_audit_artifact@1";
const DIRECT_META_ORCHESTRATOR_TRANSITION_GATE_SCHEMA = "direct_meta_orchestrator_transition_gate@1";
const DIRECT_META_ORCHESTRATOR_SHADOW_VERSION = "direct-meta-orchestrator-shadow@1";

const STEP_EVENT_KINDS = new Set([
  "implementation_step_started",
  "implementation_step_finished",
  "implementation_evidence_submitted",
  "audit_step_started",
  "audit_artifact_submitted",
  "workflow_transition_selected",
]);

const ARTIFACT_CLASSES = new Set([
  "implementation_evidence_artifact",
  "audit_artifact",
]);

const PRODUCER_ROLES = new Set([
  "implementation_worker",
  "audit_worker",
  "fix_worker",
  "closeout_worker",
  "meta_orchestrator",
]);

const AUDIT_VERDICT_CLASSES = new Set([
  "green",
  "yellow",
  "red",
  "blocked",
  "invalid_evidence",
]);

const ADVANCEMENT_RECOMMENDATIONS = new Set([
  "advance",
  "fix",
  "retry",
  "escalate",
  "pause",
  "close_arc",
]);

const GATE_STATES = new Set([
  "routable_accepted",
  "transition_selected",
  "blocked",
]);

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

function arrayOfStrings(value, maxItems = 20, maxLength = 180) {
  return (Array.isArray(value) ? value : [])
    .map((item) => boundedString(item, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

function normalizeEvidenceRef(input = {}, fallbackKind = "unknown") {
  const source = isPlainObject(input) ? input : {};
  const artifactId = normalizeString(source.artifactId || source.id || source.refId, "");
  const artifactDigest = normalizeString(source.artifactDigest || source.digest || source.sourceDigest, "");
  if (!artifactId && !artifactDigest) return null;
  return {
    kind: normalizeString(source.kind, fallbackKind),
    artifactId,
    artifactDigest,
    sourceConfidence: normalizeString(source.sourceConfidence || source.confidence, "diagnostic"),
    rendererSafeLabel: boundedString(source.rendererSafeLabel || source.label || fallbackKind, 140),
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

function artifactRef(input = {}, fallbackClass = "") {
  const source = isPlainObject(input) ? input : {};
  const artifactClass = normalizeString(source.artifactClass || source.class || fallbackClass, "");
  const artifactId = normalizeString(source.artifactId || source.id, "");
  const artifactDigest = normalizeString(source.artifactDigest || source.digest || source.sourceDigest, "");
  return {
    artifactClass,
    artifactId,
    artifactDigest,
    producerRole: normalizeString(source.producerRole, ""),
    stepId: normalizeString(source.stepId, ""),
    rendererSafeLabel: boundedString(source.rendererSafeLabel || artifactClass || "artifact", 160),
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
}

function buildMetaOrchestratorPlanPointer(input = {}, opts = {}) {
  const source = isPlainObject(input) ? input : {};
  const expectedArtifactClass = normalizeString(source.expectedArtifactClass, "implementation_evidence_artifact");
  const expectedProducerRole = normalizeString(source.expectedProducerRole, "implementation_worker");
  const pointer = {
    schema: DIRECT_META_ORCHESTRATOR_PLAN_POINTER_SCHEMA,
    version: DIRECT_META_ORCHESTRATOR_SHADOW_VERSION,
    planPointerId: normalizeString(source.planPointerId, `plan_pointer_${sha256(`${source.projectId || ""}:${source.planId || ""}:${source.currentStepId || ""}:${expectedArtifactClass}`).slice(0, 24)}`),
    projectId: normalizeString(source.projectId, ""),
    workThreadId: normalizeString(source.workThreadId, ""),
    planId: normalizeString(source.planId, ""),
    currentStepId: normalizeString(source.currentStepId, ""),
    currentStepOrdinal: Math.max(0, Number(source.currentStepOrdinal || 0) || 0),
    expectedArtifactClass: ARTIFACT_CLASSES.has(expectedArtifactClass) ? expectedArtifactClass : "implementation_evidence_artifact",
    expectedProducerRole: PRODUCER_ROLES.has(expectedProducerRole) ? expectedProducerRole : "implementation_worker",
    auditorRole: normalizeString(source.auditorRole, "audit_worker"),
    branchLawVersion: normalizeString(source.branchLawVersion, "meta_orchestrator_transition_law@1"),
    eventOrdinal: Math.max(0, Number(source.eventOrdinal || 0) || 0),
    evidenceRefs: normalizeEvidenceRefs(source.evidenceRefs, "plan_contract"),
    createdAt: isoTimestamp(opts.nowMs ?? source.nowMs ?? source.createdAt),
    metaPerformsObjectLevelAudit: false,
    autonomousContinuationAllowed: false,
    providerCallAllowed: false,
    workerCompletionJudgedByWorker: false,
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  pointer.pointerDigest = digestFor(DIRECT_META_ORCHESTRATOR_PLAN_POINTER_SCHEMA, { ...pointer, pointerDigest: "" });
  return pointer;
}

function buildMetaOrchestratorStepEvent(input = {}, opts = {}) {
  const source = isPlainObject(input) ? input : {};
  const eventKind = normalizeString(source.eventKind, "");
  const refs = (Array.isArray(source.artifactRefs) ? source.artifactRefs : [])
    .map((entry) => artifactRef(entry))
    .filter((entry) => entry.artifactClass || entry.artifactId || entry.artifactDigest);
  const event = {
    schema: DIRECT_META_ORCHESTRATOR_STEP_EVENT_SCHEMA,
    version: DIRECT_META_ORCHESTRATOR_SHADOW_VERSION,
    eventId: normalizeString(source.eventId, `step_event_${sha256(`${source.projectId || ""}:${source.stepId || ""}:${eventKind}:${refs.length}:${opts.nowMs ?? source.createdAt ?? ""}`).slice(0, 24)}`),
    projectId: normalizeString(source.projectId, ""),
    workThreadId: normalizeString(source.workThreadId, ""),
    planId: normalizeString(source.planId, ""),
    stepId: normalizeString(source.stepId, ""),
    eventKind: STEP_EVENT_KINDS.has(eventKind) ? eventKind : "implementation_step_started",
    producerRole: PRODUCER_ROLES.has(source.producerRole) ? source.producerRole : "meta_orchestrator",
    artifactRefs: refs,
    declaredScope: boundedString(source.declaredScope, 420),
    createdAt: isoTimestamp(opts.nowMs ?? source.nowMs ?? source.createdAt),
    metaPerformsObjectLevelAudit: false,
    autonomousContinuationAllowed: false,
    providerCallAllowed: false,
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  event.eventDigest = digestFor(DIRECT_META_ORCHESTRATOR_STEP_EVENT_SCHEMA, { ...event, eventDigest: "" });
  return event;
}

function buildImplementationEvidenceArtifact(input = {}, opts = {}) {
  const source = isPlainObject(input) ? input : {};
  const artifact = {
    schema: DIRECT_IMPLEMENTATION_EVIDENCE_ARTIFACT_SCHEMA,
    version: DIRECT_META_ORCHESTRATOR_SHADOW_VERSION,
    artifactClass: "implementation_evidence_artifact",
    artifactId: normalizeString(source.artifactId, `implementation_evidence_${sha256(`${source.projectId || ""}:${source.stepId || ""}:${source.workerThreadId || ""}`).slice(0, 24)}`),
    projectId: normalizeString(source.projectId, ""),
    workThreadId: normalizeString(source.workThreadId, ""),
    planId: normalizeString(source.planId, ""),
    stepId: normalizeString(source.stepId, ""),
    producerRole: "implementation_worker",
    workerThreadId: normalizeString(source.workerThreadId, ""),
    workerStartTransitionId: normalizeString(source.workerStartTransitionId, ""),
    statusClaim: normalizeString(source.statusClaim, "completed"),
    intentContractRef: artifactRef(source.intentContractRef, "intent_contract"),
    changedFileRefs: normalizeEvidenceRefs(source.changedFileRefs, "changed_file"),
    testEvidenceRefs: normalizeEvidenceRefs(source.testEvidenceRefs, "test_evidence"),
    scopeDeclaration: boundedString(source.scopeDeclaration, 600),
    unresolvedIssues: arrayOfStrings(source.unresolvedIssues, 20, 220),
    workerNotesPreview: boundedString(source.workerNotesPreview || source.workerNotes, 500),
    createdAt: isoTimestamp(opts.nowMs ?? source.nowMs ?? source.createdAt),
    evidenceValidityCertified: false,
    objectLevelAuditPerformed: false,
    metaPerformsObjectLevelAudit: false,
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  artifact.artifactDigest = digestFor(DIRECT_IMPLEMENTATION_EVIDENCE_ARTIFACT_SCHEMA, { ...artifact, artifactDigest: "" });
  return artifact;
}

function normalizeDefect(input = {}, index = 0) {
  const source = isPlainObject(input) ? input : {};
  return {
    defectId: normalizeString(source.defectId, `audit_defect_${index + 1}`),
    severity: normalizeString(source.severity, "medium"),
    rendererSafeSummary: boundedString(source.rendererSafeSummary || source.summary, 260),
    evidenceRefs: normalizeEvidenceRefs(source.evidenceRefs, "audit_evidence"),
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
}

function buildAuditArtifact(input = {}, opts = {}) {
  const source = isPlainObject(input) ? input : {};
  const verdictClass = normalizeString(source.verdictClass, "yellow");
  const advancementRecommendation = normalizeString(source.advancementRecommendation, verdictClass === "green" ? "advance" : "fix");
  const artifact = {
    schema: DIRECT_AUDIT_ARTIFACT_SCHEMA,
    version: DIRECT_META_ORCHESTRATOR_SHADOW_VERSION,
    artifactClass: "audit_artifact",
    artifactId: normalizeString(source.artifactId, `audit_artifact_${sha256(`${source.projectId || ""}:${source.stepId || ""}:${source.auditorThreadId || ""}:${verdictClass}`).slice(0, 24)}`),
    projectId: normalizeString(source.projectId, ""),
    workThreadId: normalizeString(source.workThreadId, ""),
    planId: normalizeString(source.planId, ""),
    stepId: normalizeString(source.stepId, ""),
    producerRole: "audit_worker",
    auditorThreadId: normalizeString(source.auditorThreadId, ""),
    reviewedArtifactRef: artifactRef(source.reviewedArtifactRef, "implementation_evidence_artifact"),
    verdictClass: AUDIT_VERDICT_CLASSES.has(verdictClass) ? verdictClass : "yellow",
    fulfilledIntentContract: normalizeString(source.fulfilledIntentContract, "unknown"),
    evidenceValidity: normalizeString(source.evidenceValidity, "object_level_auditor_certified"),
    defects: (Array.isArray(source.defects) ? source.defects : []).map((entry, index) => normalizeDefect(entry, index)),
    requiredFixes: arrayOfStrings(source.requiredFixes, 40, 240),
    residualRisks: arrayOfStrings(source.residualRisks, 40, 240),
    advancementRecommendation: ADVANCEMENT_RECOMMENDATIONS.has(advancementRecommendation) ? advancementRecommendation : "fix",
    createdAt: isoTimestamp(opts.nowMs ?? source.nowMs ?? source.createdAt),
    objectLevelAuditPerformed: true,
    objectLevelAuthorityRole: "audit_worker",
    metaPerformsObjectLevelAudit: false,
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  artifact.artifactDigest = digestFor(DIRECT_AUDIT_ARTIFACT_SCHEMA, { ...artifact, artifactDigest: "" });
  return artifact;
}

function validateNoAuthorityLeak(artifact = {}, label = "artifact") {
  const visited = new Set();
  function check(value) {
    if (!value || typeof value !== "object") return;
    if (visited.has(value)) return;
    visited.add(value);
    if (Array.isArray(value)) {
      for (const item of value) check(item);
      return;
    }
    for (const key of [
      "metaPerformsObjectLevelAudit",
      "autonomousContinuationAllowed",
      "providerCallAllowed",
      "workerCompletionJudgedByWorker",
      "rawTextIncluded",
      "rawPathIncluded",
      "rawSecretIncluded",
    ]) {
      if (key in value && value[key] !== false) throw new Error(`${label}_authority_leak:${key}`);
    }
    for (const item of Object.values(value)) check(item);
  }
  check(artifact);
}

function validateMetaOrchestratorPlanPointer(pointer = {}) {
  if (!isPlainObject(pointer) || pointer.schema !== DIRECT_META_ORCHESTRATOR_PLAN_POINTER_SCHEMA) {
    throw new Error("direct_meta_orchestrator_plan_pointer_schema_mismatch");
  }
  if (!normalizeString(pointer.projectId, "")) throw new Error("direct_meta_orchestrator_plan_pointer_missing_project_id");
  if (!normalizeString(pointer.workThreadId, "")) throw new Error("direct_meta_orchestrator_plan_pointer_missing_work_thread_id");
  if (!normalizeString(pointer.planId, "")) throw new Error("direct_meta_orchestrator_plan_pointer_missing_plan_id");
  if (!normalizeString(pointer.currentStepId, "")) throw new Error("direct_meta_orchestrator_plan_pointer_missing_step_id");
  if (!ARTIFACT_CLASSES.has(pointer.expectedArtifactClass)) throw new Error("direct_meta_orchestrator_plan_pointer_expected_artifact_invalid");
  if (!PRODUCER_ROLES.has(pointer.expectedProducerRole)) throw new Error("direct_meta_orchestrator_plan_pointer_expected_role_invalid");
  if (!normalizeString(pointer.pointerDigest, "")) throw new Error("direct_meta_orchestrator_plan_pointer_missing_digest");
  validateNoAuthorityLeak(pointer, "direct_meta_orchestrator_plan_pointer");
  return true;
}

function validateMetaOrchestratorStepEvent(event = {}) {
  if (!isPlainObject(event) || event.schema !== DIRECT_META_ORCHESTRATOR_STEP_EVENT_SCHEMA) {
    throw new Error("direct_meta_orchestrator_step_event_schema_mismatch");
  }
  if (!STEP_EVENT_KINDS.has(event.eventKind)) throw new Error(`direct_meta_orchestrator_step_event_kind_invalid:${event.eventKind || ""}`);
  if (!PRODUCER_ROLES.has(event.producerRole)) throw new Error(`direct_meta_orchestrator_step_event_role_invalid:${event.producerRole || ""}`);
  if (!normalizeString(event.projectId, "")) throw new Error("direct_meta_orchestrator_step_event_missing_project_id");
  if (!normalizeString(event.stepId, "")) throw new Error("direct_meta_orchestrator_step_event_missing_step_id");
  if (!normalizeString(event.eventDigest, "")) throw new Error("direct_meta_orchestrator_step_event_missing_digest");
  validateNoAuthorityLeak(event, "direct_meta_orchestrator_step_event");
  return true;
}

function validateImplementationEvidenceArtifact(artifact = {}) {
  if (!isPlainObject(artifact) || artifact.schema !== DIRECT_IMPLEMENTATION_EVIDENCE_ARTIFACT_SCHEMA) {
    throw new Error("direct_implementation_evidence_artifact_schema_mismatch");
  }
  if (artifact.artifactClass !== "implementation_evidence_artifact") throw new Error("direct_implementation_evidence_artifact_class_invalid");
  if (artifact.producerRole !== "implementation_worker") throw new Error("direct_implementation_evidence_artifact_role_invalid");
  if (!normalizeString(artifact.projectId, "")) throw new Error("direct_implementation_evidence_artifact_missing_project_id");
  if (!normalizeString(artifact.stepId, "")) throw new Error("direct_implementation_evidence_artifact_missing_step_id");
  if (!normalizeString(artifact.artifactId, "")) throw new Error("direct_implementation_evidence_artifact_missing_id");
  if (!normalizeString(artifact.artifactDigest, "")) throw new Error("direct_implementation_evidence_artifact_missing_digest");
  if (artifact.evidenceValidityCertified !== false || artifact.objectLevelAuditPerformed !== false) {
    throw new Error("direct_implementation_evidence_artifact_certification_leak");
  }
  validateNoAuthorityLeak(artifact, "direct_implementation_evidence_artifact");
  return true;
}

function validateAuditArtifact(artifact = {}) {
  if (!isPlainObject(artifact) || artifact.schema !== DIRECT_AUDIT_ARTIFACT_SCHEMA) {
    throw new Error("direct_audit_artifact_schema_mismatch");
  }
  if (artifact.artifactClass !== "audit_artifact") throw new Error("direct_audit_artifact_class_invalid");
  if (artifact.producerRole !== "audit_worker") throw new Error("direct_audit_artifact_role_invalid");
  if (!normalizeString(artifact.projectId, "")) throw new Error("direct_audit_artifact_missing_project_id");
  if (!normalizeString(artifact.workThreadId, "")) throw new Error("direct_audit_artifact_missing_work_thread_id");
  if (!normalizeString(artifact.planId, "")) throw new Error("direct_audit_artifact_missing_plan_id");
  if (!normalizeString(artifact.stepId, "")) throw new Error("direct_audit_artifact_missing_step_id");
  if (!normalizeString(artifact.artifactId, "")) throw new Error("direct_audit_artifact_missing_id");
  if (!normalizeString(artifact.artifactDigest, "")) throw new Error("direct_audit_artifact_missing_digest");
  if (!AUDIT_VERDICT_CLASSES.has(artifact.verdictClass)) throw new Error(`direct_audit_artifact_verdict_invalid:${artifact.verdictClass || ""}`);
  if (!ADVANCEMENT_RECOMMENDATIONS.has(artifact.advancementRecommendation)) {
    throw new Error(`direct_audit_artifact_recommendation_invalid:${artifact.advancementRecommendation || ""}`);
  }
  if (!normalizeString(artifact.reviewedArtifactRef?.artifactId, "")) throw new Error("direct_audit_artifact_missing_reviewed_artifact");
  if (artifact.objectLevelAuditPerformed !== true || artifact.objectLevelAuthorityRole !== "audit_worker") {
    throw new Error("direct_audit_artifact_missing_auditor_authority");
  }
  if (artifact.metaPerformsObjectLevelAudit !== false) throw new Error("direct_audit_artifact_meta_audit_leak");
  if (artifact.rawTextIncluded !== false || artifact.rawPathIncluded !== false || artifact.rawSecretIncluded !== false) {
    throw new Error("direct_audit_artifact_raw_exposure");
  }
  validateNoAuthorityLeak(artifact, "direct_audit_artifact");
  return true;
}

function artifactClassFor(artifact = {}) {
  if (artifact?.schema === DIRECT_IMPLEMENTATION_EVIDENCE_ARTIFACT_SCHEMA) return "implementation_evidence_artifact";
  if (artifact?.schema === DIRECT_AUDIT_ARTIFACT_SCHEMA) return "audit_artifact";
  return normalizeString(artifact?.artifactClass, "");
}

function validateArtifactByClass(artifact = {}) {
  const artifactClass = artifactClassFor(artifact);
  if (artifactClass === "implementation_evidence_artifact") return validateImplementationEvidenceArtifact(artifact);
  if (artifactClass === "audit_artifact") return validateAuditArtifact(artifact);
  throw new Error(`direct_meta_orchestrator_unknown_artifact_class:${artifactClass || "missing"}`);
}

function transitionActionForAudit(artifact = {}) {
  const recommendation = normalizeString(artifact.advancementRecommendation, "");
  if (recommendation) return recommendation;
  if (artifact.verdictClass === "green") return "advance";
  if (artifact.verdictClass === "yellow") return "fix";
  if (artifact.verdictClass === "red") return "retry";
  if (artifact.verdictClass === "blocked") return "pause";
  if (artifact.verdictClass === "invalid_evidence") return "retry";
  return "pause";
}

function buildMetaOrchestratorTransitionGate(input = {}, opts = {}) {
  const source = isPlainObject(input) ? input : {};
  const planPointer = isPlainObject(source.planPointer) ? source.planPointer : {};
  const artifact = isPlainObject(source.artifact) ? source.artifact : {};
  const blockers = [];
  try {
    validateMetaOrchestratorPlanPointer(planPointer);
  } catch (error) {
    blockers.push(`plan_pointer_invalid:${normalizeString(error.message, "unknown")}`);
  }
  let artifactValid = false;
  try {
    validateArtifactByClass(artifact);
    artifactValid = true;
  } catch (error) {
    blockers.push(`artifact_invalid:${normalizeString(error.message, "unknown")}`);
  }
  const artifactClass = artifactClassFor(artifact);
  if (artifactValid && planPointer.expectedArtifactClass && artifactClass !== planPointer.expectedArtifactClass) {
    blockers.push("artifact_class_unexpected");
  }
  if (artifactValid && planPointer.expectedProducerRole && artifact.producerRole !== planPointer.expectedProducerRole) {
    blockers.push("producer_role_unexpected");
  }
  if (artifactValid && planPointer.currentStepId && artifact.stepId !== planPointer.currentStepId) {
    blockers.push("step_id_mismatch");
  }
  if (artifactValid && planPointer.projectId && artifact.projectId !== planPointer.projectId) {
    blockers.push("project_id_mismatch");
  }
  if (artifactValid && planPointer.workThreadId && artifact.workThreadId !== planPointer.workThreadId) {
    blockers.push("work_thread_id_mismatch");
  }
  if (artifactValid && planPointer.planId && artifact.planId !== planPointer.planId) {
    blockers.push("plan_id_mismatch");
  }

  const isAudit = artifactClass === "audit_artifact";
  const gateState = blockers.length ? "blocked" : isAudit ? "transition_selected" : "routable_accepted";
  const transitionAction = blockers.length
    ? "block"
    : isAudit
      ? transitionActionForAudit(artifact)
      : "route_to_auditor";
  const gate = {
    schema: DIRECT_META_ORCHESTRATOR_TRANSITION_GATE_SCHEMA,
    version: DIRECT_META_ORCHESTRATOR_SHADOW_VERSION,
    gateId: normalizeString(source.gateId, `meta_gate_${sha256(`${planPointer.planPointerId || ""}:${artifact.artifactId || ""}:${transitionAction}`).slice(0, 24)}`),
    projectId: normalizeString(planPointer.projectId || artifact.projectId || source.projectId, ""),
    workThreadId: normalizeString(planPointer.workThreadId || artifact.workThreadId || source.workThreadId, ""),
    planPointerId: normalizeString(planPointer.planPointerId, ""),
    planId: normalizeString(planPointer.planId || artifact.planId, ""),
    stepId: normalizeString(planPointer.currentStepId || artifact.stepId, ""),
    expectedArtifactClass: normalizeString(planPointer.expectedArtifactClass, ""),
    receivedArtifactRef: artifactRef({
      artifactClass,
      artifactId: artifact.artifactId,
      artifactDigest: artifact.artifactDigest,
      producerRole: artifact.producerRole,
      stepId: artifact.stepId,
      rendererSafeLabel: artifactClass,
    }, artifactClass),
    gateState,
    blockerCodes: [...new Set(blockers)],
    transitionAction,
    routeToAuditor: transitionAction === "route_to_auditor",
    transitionSelectedFromAuditArtifact: isAudit && !blockers.length,
    artifactPresenceChecked: true,
    artifactShapeChecked: true,
    artifactProvenanceChecked: true,
    objectLevelValidityCertifiedByAuditor: isAudit && !blockers.length,
    objectLevelValidityJudgedByMeta: false,
    metaPerformsObjectLevelAudit: false,
    autonomousContinuationAllowed: false,
    providerCallAllowed: false,
    workerCompletionJudgedByWorker: false,
    createdAt: isoTimestamp(opts.nowMs ?? source.nowMs ?? source.createdAt),
    rawTextIncluded: false,
    rawPathIncluded: false,
    rawSecretIncluded: false,
  };
  gate.gateDigest = digestFor(DIRECT_META_ORCHESTRATOR_TRANSITION_GATE_SCHEMA, { ...gate, gateDigest: "" });
  return gate;
}

function validateMetaOrchestratorTransitionGate(gate = {}) {
  if (!isPlainObject(gate) || gate.schema !== DIRECT_META_ORCHESTRATOR_TRANSITION_GATE_SCHEMA) {
    throw new Error("direct_meta_orchestrator_transition_gate_schema_mismatch");
  }
  if (!GATE_STATES.has(gate.gateState)) throw new Error(`direct_meta_orchestrator_transition_gate_state_invalid:${gate.gateState || ""}`);
  if (!normalizeString(gate.gateId, "")) throw new Error("direct_meta_orchestrator_transition_gate_missing_id");
  if (!normalizeString(gate.gateDigest, "")) throw new Error("direct_meta_orchestrator_transition_gate_missing_digest");
  if (gate.objectLevelValidityJudgedByMeta !== false) throw new Error("direct_meta_orchestrator_transition_gate_meta_audit_leak");
  if (gate.artifactPresenceChecked !== true || gate.artifactShapeChecked !== true || gate.artifactProvenanceChecked !== true) {
    throw new Error("direct_meta_orchestrator_transition_gate_missing_shallow_checks");
  }
  validateNoAuthorityLeak(gate, "direct_meta_orchestrator_transition_gate");
  return true;
}

module.exports = {
  ADVANCEMENT_RECOMMENDATIONS,
  ARTIFACT_CLASSES,
  AUDIT_VERDICT_CLASSES,
  DIRECT_AUDIT_ARTIFACT_SCHEMA,
  DIRECT_IMPLEMENTATION_EVIDENCE_ARTIFACT_SCHEMA,
  DIRECT_META_ORCHESTRATOR_PLAN_POINTER_SCHEMA,
  DIRECT_META_ORCHESTRATOR_SHADOW_VERSION,
  DIRECT_META_ORCHESTRATOR_STEP_EVENT_SCHEMA,
  DIRECT_META_ORCHESTRATOR_TRANSITION_GATE_SCHEMA,
  GATE_STATES,
  PRODUCER_ROLES,
  STEP_EVENT_KINDS,
  buildAuditArtifact,
  buildImplementationEvidenceArtifact,
  buildMetaOrchestratorPlanPointer,
  buildMetaOrchestratorStepEvent,
  buildMetaOrchestratorTransitionGate,
  validateAuditArtifact,
  validateImplementationEvidenceArtifact,
  validateMetaOrchestratorPlanPointer,
  validateMetaOrchestratorStepEvent,
  validateMetaOrchestratorTransitionGate,
};
