"use strict";

const {
  DIRECT_BRL_REPLAY_LOCK_MANIFEST_SCHEMA,
  DIRECT_EXECUTION_CONTEXT_REGISTRY_SCHEMA,
  DIRECT_HOB_COVERAGE_KINDS,
  DIRECT_HOB_OBLIGATION_STATUSES,
  DIRECT_HOB_READINESS_POSTURES,
  DIRECT_HOB_OBLIGATION_STATUS_SCHEMA,
  DIRECT_INSTRUCTION_OMISSION_LEDGER_SCHEMA,
  DIRECT_INSTRUCTION_PACKAGE_SCHEMA,
  DIRECT_META_ATTEMPT_FAILURE_SCHEMA,
  DIRECT_META_ATTEMPT_KINDS,
  DIRECT_META_CURRENT_POINTER_SET_SCHEMA,
  DIRECT_META_DISCRIMINATOR_KINDS,
  DIRECT_META_OWNER_KINDS,
  DIRECT_META_SESSION_EVENT_LEDGER_MANIFEST_SCHEMA,
  DIRECT_META_SESSION_EVENT_SCHEMA,
  DIRECT_META_SESSION_INDEX_SCHEMA,
  DIRECT_META_SESSION_SCHEMA,
  DIRECT_META_SESSION_STATUSES,
  DIRECT_META_STATE_OBJECT_DESCRIPTOR_SCHEMA,
  DIRECT_META_STATUS_PROJECTION_SCHEMA,
  DIRECT_RUN_CONTRACT_SCHEMA,
  DIRECT_RUN_CONTRACT_STATUSES,
  DIRECT_TRANSITION_GUARD_DECISION_SCHEMA,
  DIRECT_TRANSITION_GUARD_INPUT_SCHEMA,
  DIRECT_TRANSITION_CLAIM_SCHEMA,
  DIRECT_UPSTREAM_DISCRIMINATOR_ROW_SCHEMA,
} = require("./constants");
const { isMetaSessionBlockerCode } = require("./blocker-codes");
const { isPlainObject, normalizeString } = require("./ids");

function hasDigest(value, key = "digest") {
  return typeof value?.[key] === "string" && value[key].startsWith("sha256:");
}

function hasRefDigest(ref) {
  return isPlainObject(ref) && normalizeString(ref.artifactDigest || ref.sourceDigest, "").startsWith("sha256:");
}

function validateArtifactRefs(refs = []) {
  return Array.isArray(refs) && refs.every((ref) => isPlainObject(ref)
    && normalizeString(ref.artifactKind, "")
    && normalizeString(ref.artifactId, "")
    && normalizeString(ref.artifactDigest, "").startsWith("sha256:")
    && !/^\/|^[A-Za-z]:\\|^\\\\/.test(normalizeString(ref.storageSlot, "")));
}

function validateSourceRefs(refs = []) {
  return Array.isArray(refs) && refs.every((ref) => isPlainObject(ref)
    && normalizeString(ref.sourceRefId, "")
    && normalizeString(ref.sourceDigest, "").startsWith("sha256:")
    && ref.rawTextIncluded === false
    && ref.rawPathIncluded === false
    && ref.rawProviderPayloadIncluded === false);
}

function validateMetaSession(value) {
  return Boolean(isPlainObject(value)
    && value.schemaVersion === DIRECT_META_SESSION_SCHEMA
    && normalizeString(value.metaSessionId, "")
    && DIRECT_META_SESSION_STATUSES.includes(value.status)
    && Number.isInteger(value.sessionEpoch)
    && value.sessionEpoch >= 1
    && validateSourceRefs(value.sourceRefs)
    && value.rawTextIncluded === false
    && hasDigest(value));
}

function validateExecutionContextRegistry(value) {
  return Boolean(isPlainObject(value)
    && value.schemaVersion === DIRECT_EXECUTION_CONTEXT_REGISTRY_SCHEMA
    && normalizeString(value.registryId, "")
    && normalizeString(value.metaSessionId, "")
    && Array.isArray(value.contexts)
    && value.contexts.every((context) => isPlainObject(context)
      && normalizeString(context.contextId, "")
      && normalizeString(context.contextDigest, "").startsWith("sha256:")
      && normalizeString(context.contextKind, "")
      && normalizeString(context.runtimeSourceClass, "")
      && normalizeString(context.jurisdiction, "")
      && context.rawPathIncluded === false
      && context.rawChatGptUrlIncluded === false)
    && normalizeString(value.sourceDigest, "").startsWith("sha256:")
    && hasDigest(value));
}

function validateRunContract(value) {
  return Boolean(isPlainObject(value)
    && value.schemaVersion === DIRECT_RUN_CONTRACT_SCHEMA
    && normalizeString(value.contractId, "")
    && normalizeString(value.metaSessionId, "")
    && Number.isInteger(value.contractVersion)
    && value.contractVersion >= 1
    && Number.isInteger(value.sessionEpoch)
    && value.sessionEpoch >= 1
    && DIRECT_RUN_CONTRACT_STATUSES.includes(value.status)
    && isPlainObject(value.authorityPolicy)
    && isPlainObject(value.amendmentPolicy)
    && isPlainObject(value.stopPolicy)
    && isPlainObject(value.transitionPolicy)
    && isPlainObject(value.instructionPolicy)
    && isPlainObject(value.evidencePolicy)
    && validateSourceRefs(value.sourceRefs)
    && value.rawTextIncluded === false
    && hasDigest(value));
}

function validateInstructionOmissionLedger(value) {
  return Boolean(isPlainObject(value)
    && value.schemaVersion === DIRECT_INSTRUCTION_OMISSION_LEDGER_SCHEMA
    && normalizeString(value.ledgerId, "")
    && normalizeString(value.metaSessionId, "")
    && normalizeString(value.roleId, "")
    && normalizeString(value.targetContextId, "")
    && Array.isArray(value.omissions)
    && value.omissions.every((omission) => isPlainObject(omission)
      && normalizeString(omission.omissionId, "")
      && isPlainObject(omission.sourceRef)
      && validateSourceRefs([omission.sourceRef])
      && ["irrelevant_to_role", "forbidden_by_contract", "stale", "raw_exposure_risk", "scope_excluded", "future"].includes(omission.reason)
      && normalizeString(omission.rendererSafeSummary, "")
      && omission.rawTextIncluded === false)
    && value.omissionCount === value.omissions.length
    && value.rawTextIncluded === false
    && value.rawCompiledPromptIncluded === false
    && hasDigest(value));
}

function validateInstructionPackage(value) {
  return Boolean(isPlainObject(value)
    && value.schemaVersion === DIRECT_INSTRUCTION_PACKAGE_SCHEMA
    && normalizeString(value.packageId, "")
    && normalizeString(value.metaSessionId, "")
    && normalizeString(value.contractId, "")
    && Number.isInteger(value.contractVersion)
    && value.contractVersion >= 1
    && Number.isInteger(value.sessionEpoch)
    && value.sessionEpoch >= 1
    && normalizeString(value.roleId, "")
    && normalizeString(value.targetContextId, "")
    && validateSourceRefs(value.includedSourceRefs)
    && validateArtifactRefs(value.omissionLedgerRefs)
    && value.omissionLedgerRefs.length > 0
    && normalizeString(value.compiledMessagesDigest, "").startsWith("sha256:")
    && Array.isArray(value.authoritySummary)
    && Array.isArray(value.forbiddenActions)
    && normalizeString(value.outputArtifactSchemaRef, "")
    && value.rawCompiledPromptIncluded === false
    && value.launchEnvelopePersisted === false
    && value.workerLaunchAuthority === false
    && hasDigest(value));
}

function validateGuardContextSnapshot(value) {
  return Boolean(isPlainObject(value)
    && normalizeString(value.contextId, "")
    && normalizeString(value.contextDigest, "").startsWith("sha256:"));
}

function validateTransitionGuardInput(value) {
  return Boolean(isPlainObject(value)
    && value.schemaVersion === DIRECT_TRANSITION_GUARD_INPUT_SCHEMA
    && normalizeString(value.guardInputId, "")
    && normalizeString(value.metaSessionId, "")
    && normalizeString(value.transitionKind, "")
    && Number.isInteger(value.expectedContractVersion)
    && value.expectedContractVersion >= 1
    && Number.isInteger(value.expectedSessionEpoch)
    && value.expectedSessionEpoch >= 1
    && validateArtifactRefs([value.contractRef])
    && validateArtifactRefs([value.contextRegistryRef])
    && validateArtifactRefs([value.instructionPackageRef])
    && validateArtifactRefs(value.transitionClaimRefs)
    && validateGuardContextSnapshot(value.sourceContext)
    && validateGuardContextSnapshot(value.targetContext)
    && normalizeString(value.inputDigest, "").startsWith("sha256:")
    && value.enforcementAvailableInThisPr === false
    && value.runtimeMutationAuthority === false
    && value.rawTextIncluded === false
    && hasDigest(value));
}

function validateTransitionGuardDecision(value) {
  return Boolean(isPlainObject(value)
    && value.schemaVersion === DIRECT_TRANSITION_GUARD_DECISION_SCHEMA
    && normalizeString(value.guardDecisionId, "")
    && normalizeString(value.metaSessionId, "")
    && validateArtifactRefs([value.guardInputRef])
    && ["allow_shadow", "deny_shadow", "ask_human_shadow", "reclassify_shadow", "stop_shadow"].includes(value.decision)
    && Array.isArray(value.reasonCodes)
    && value.reasonCodes.every((reason) => normalizeString(reason, ""))
    && Array.isArray(value.blockerCodes)
    && value.blockerCodes.every((code) => isMetaSessionBlockerCode(code))
    && validateArtifactRefs(value.evidenceRefs)
    && typeof value.wouldBlockInFutureEnforceMode === "boolean"
    && value.shadowOnly === true
    && value.enforceableInThisPr === false
    && value.runtimeBlocked === false
    && value.routeDispatched === false
    && value.workerLaunchAuthority === false
    && value.providerTransportAuthority === false
    && value.rawTextIncluded === false
    && hasDigest(value));
}

function validateStateObjectDescriptor(value) {
  return Boolean(isPlainObject(value)
    && value.schemaVersion === DIRECT_META_STATE_OBJECT_DESCRIPTOR_SCHEMA
    && normalizeString(value.id, "")
    && DIRECT_META_OWNER_KINDS.includes(value.ownerKind)
    && Array.isArray(value.producers)
    && Array.isArray(value.consumers)
    && isPlainObject(value.codeAnchors)
    && Array.isArray(value.codeAnchors.producers)
    && value.codeAnchors.producers.length > 0
    && Array.isArray(value.codeAnchors.consumers)
    && Array.isArray(value.codeAnchors.ipcChannels)
    && Array.isArray(value.codeAnchors.shellEvents)
    && Array.isArray(value.codeAnchors.storageSlots)
    && value.codeAnchors.storageSlots.length > 0
    && value.codeAnchors.storageSlots.every((slot) => !/^\/|^[A-Za-z]:\\|^\\\\/.test(normalizeString(slot, "")))
    && Array.isArray(value.evidenceAuthority)
    && Array.isArray(value.statusLattice)
    && Array.isArray(value.projections)
    && Array.isArray(value.mutationRoutes)
    && Array.isArray(value.validationRefs)
    && value.rawTextIncluded === false
    && hasDigest(value));
}

function validateHobObligationStatus(value) {
  return Boolean(isPlainObject(value)
    && value.schemaVersion === DIRECT_HOB_OBLIGATION_STATUS_SCHEMA
    && normalizeString(value.rowId, "")
    && normalizeString(value.ownerStateObjectId, "")
    && normalizeString(value.obligationId, "")
    && DIRECT_HOB_OBLIGATION_STATUSES.includes(value.status)
    && validateSourceRefs(value.evidenceRefs)
    && normalizeString(value.evidenceAuthority, "")
    && DIRECT_HOB_COVERAGE_KINDS.includes(value.coverageKind)
    && DIRECT_HOB_READINESS_POSTURES.includes(value.readinessPosture)
    && normalizeString(value.rendererSafeSummary, "")
    && value.rawTextIncluded === false
    && hasDigest(value));
}

function validateTransitionClaim(value) {
  return Boolean(isPlainObject(value)
    && value.schemaVersion === DIRECT_TRANSITION_CLAIM_SCHEMA
    && normalizeString(value.transitionClaimId, "")
    && normalizeString(value.metaSessionId, "")
    && normalizeString(value.claimingActorRef, "")
    && ["fixture", "manual", "future_worker", "diagnostic"].includes(value.claimSource)
    && normalizeString(value.fromPhase, "")
    && normalizeString(value.toPhase, "")
    && normalizeString(value.claimedTransitionKind, "")
    && ["none", "scoped", "official_ready", "gold"].includes(value.claimedPromotion)
    && isPlainObject(value.objectBridge)
    && validateArtifactRefs(value.objectBridge.carriedArtifactRefs)
    && validateArtifactRefs(value.objectBridge.transformedArtifactRefs)
    && validateArtifactRefs(value.objectBridge.comparisonTargetRefs)
    && isPlainObject(value.evidenceBridge)
    && validateSourceRefs(value.evidenceBridge.requiredEvidenceRefs)
    && Array.isArray(value.evidenceBridge.forbiddenEvidenceClasses)
    && validateSourceRefs(value.evidenceBridge.observedEvidenceRefs)
    && isPlainObject(value.obligationBridge)
    && Array.isArray(value.obligationBridge.created)
    && Array.isArray(value.obligationBridge.preserved)
    && Array.isArray(value.obligationBridge.discharged)
    && Array.isArray(value.obligationBridge.blocked)
    && Array.isArray(value.obligationBridge.deferred)
    && isPlainObject(value.useBridge)
    && Array.isArray(value.useBridge.allowedNextPhases)
    && Array.isArray(value.useBridge.forbiddenPromotions)
    && value.enforceableInThisPr === false
    && value.rawTextIncluded === false
    && hasDigest(value));
}

function validateUpstreamDiscriminatorRow(value) {
  return Boolean(isPlainObject(value)
    && value.schemaVersion === DIRECT_UPSTREAM_DISCRIMINATOR_ROW_SCHEMA
    && normalizeString(value.rowId, "")
    && normalizeString(value.ownerStateObjectId, "")
    && Array.isArray(value.conflictingBranches)
    && value.conflictingBranches.length >= 2
    && isPlainObject(value.proposedDiscriminator)
    && DIRECT_META_DISCRIMINATOR_KINDS.includes(value.proposedDiscriminator.discriminatorKind)
    && Array.isArray(value.counterfactualProbeRefs)
    && ["proposed", "observed", "specified_by_contract", "rejected", "blocked"].includes(value.status)
    && value.rawTextIncluded === false
    && hasDigest(value));
}

function validateBrlReplayLockManifest(value) {
  return Boolean(isPlainObject(value)
    && value.schemaVersion === DIRECT_BRL_REPLAY_LOCK_MANIFEST_SCHEMA
    && normalizeString(value.lockId, "")
    && normalizeString(value.ownerSurface, "")
    && Array.isArray(value.protectedSurfaces)
    && Array.isArray(value.ignoredSurfaces)
    && validateArtifactRefs(value.observedSurfaceRefs)
    && normalizeString(value.canonicalizationProfile, "")
    && normalizeString(value.expectedObservationHash, "").startsWith("sha256:")
    && normalizeString(value.expectedHashProvenance, "")
    && ["non_mutating", "mutating_with_after_hash", "future"].includes(value.mutationPolicy)
    && ["draft", "locked", "retired"].includes(value.manifestLifecycle)
    && value.failureMeaning === "protected_projection_changed_not_product_truth"
    && (!value.validationCommandRef || value.validationCommandRef.rawCommandIncluded === false)
    && value.rawTextIncluded === false
    && hasDigest(value));
}

function validateCurrentPointerSet(value) {
  return Boolean(isPlainObject(value)
    && value.schemaVersion === DIRECT_META_CURRENT_POINTER_SET_SCHEMA
    && normalizeString(value.pointerSetId, "")
    && ["global", "surface", "meta_session", "execution_context"].includes(value.scopeKind)
    && normalizeString(value.scopeId, "")
    && (!value.currentLedgerHead || normalizeString(value.currentLedgerHead, "").startsWith("sha256:"))
    && hasDigest(value, "pointerSetDigest"));
}

function validateAttemptFailure(value) {
  return Boolean(isPlainObject(value)
    && value.schemaVersion === DIRECT_META_ATTEMPT_FAILURE_SCHEMA
    && normalizeString(value.attemptId, "")
    && DIRECT_META_ATTEMPT_KINDS.includes(value.attemptKind)
    && isMetaSessionBlockerCode(value.blockerCode)
    && value.currentPointersChanged === false
    && value.rawTextIncluded === false
    && hasDigest(value));
}

function validateLedgerEvent(value) {
  return Boolean(isPlainObject(value)
    && value.schemaVersion === DIRECT_META_SESSION_EVENT_SCHEMA
    && normalizeString(value.eventId, "")
    && Number.isInteger(value.sequence)
    && value.sequence >= 1
    && normalizeString(value.eventKind, "")
    && normalizeString(value.metaSessionId, "")
    && validateArtifactRefs(value.artifactRefs)
    && normalizeString(value.eventBodyDigest, "").startsWith("sha256:")
    && normalizeString(value.eventDigest, "").startsWith("sha256:")
    && normalizeString(value.ledgerHeadDigest, "").startsWith("sha256:"));
}

function validateLedgerManifest(value) {
  return Boolean(isPlainObject(value)
    && value.schemaVersion === DIRECT_META_SESSION_EVENT_LEDGER_MANIFEST_SCHEMA
    && normalizeString(value.metaSessionId, "")
    && Number.isInteger(value.eventCount)
    && Number.isInteger(value.lastSequence)
    && typeof value.corrupted === "boolean"
    && hasDigest(value));
}

function validateIndex(value) {
  return Boolean(isPlainObject(value)
    && value.schemaVersion === DIRECT_META_SESSION_INDEX_SCHEMA
    && Array.isArray(value.sessionRefs)
    && validateArtifactRefs(value.sessionRefs)
    && hasDigest(value));
}

function validateStatusProjection(value) {
  return Boolean(isPlainObject(value)
    && value.schemaVersion === DIRECT_META_STATUS_PROJECTION_SCHEMA
    && normalizeString(value.projectionId, "")
    && normalizeString(value.sourceDigest, "").startsWith("sha256:")
    && isPlainObject(value.counts)
    && value.capabilities?.statusRead === true
    && value.capabilities?.mutationIpcAvailable === false
    && value.actionability?.actionable === false
    && Array.isArray(value.actionability?.allowedActions)
    && value.actionability.allowedActions.length === 0
    && value.rawTextIncluded === false
    && value.rawTranscriptIncluded === false
    && value.rawPathIncluded === false
    && value.rawChatGptUrlIncluded === false
    && value.rawProviderPayloadIncluded === false);
}

function validateDirectMetaSessionArtifact(value) {
  switch (value?.schemaVersion) {
    case DIRECT_META_SESSION_INDEX_SCHEMA: return validateIndex(value);
    case DIRECT_META_SESSION_SCHEMA: return validateMetaSession(value);
    case DIRECT_EXECUTION_CONTEXT_REGISTRY_SCHEMA: return validateExecutionContextRegistry(value);
    case DIRECT_RUN_CONTRACT_SCHEMA: return validateRunContract(value);
    case DIRECT_INSTRUCTION_OMISSION_LEDGER_SCHEMA: return validateInstructionOmissionLedger(value);
    case DIRECT_INSTRUCTION_PACKAGE_SCHEMA: return validateInstructionPackage(value);
    case DIRECT_TRANSITION_GUARD_INPUT_SCHEMA: return validateTransitionGuardInput(value);
    case DIRECT_TRANSITION_GUARD_DECISION_SCHEMA: return validateTransitionGuardDecision(value);
    case DIRECT_META_STATE_OBJECT_DESCRIPTOR_SCHEMA: return validateStateObjectDescriptor(value);
    case DIRECT_HOB_OBLIGATION_STATUS_SCHEMA: return validateHobObligationStatus(value);
    case DIRECT_TRANSITION_CLAIM_SCHEMA: return validateTransitionClaim(value);
    case DIRECT_UPSTREAM_DISCRIMINATOR_ROW_SCHEMA: return validateUpstreamDiscriminatorRow(value);
    case DIRECT_BRL_REPLAY_LOCK_MANIFEST_SCHEMA: return validateBrlReplayLockManifest(value);
    case DIRECT_META_CURRENT_POINTER_SET_SCHEMA: return validateCurrentPointerSet(value);
    case DIRECT_META_ATTEMPT_FAILURE_SCHEMA: return validateAttemptFailure(value);
    case DIRECT_META_SESSION_EVENT_SCHEMA: return validateLedgerEvent(value);
    case DIRECT_META_SESSION_EVENT_LEDGER_MANIFEST_SCHEMA: return validateLedgerManifest(value);
    case DIRECT_META_STATUS_PROJECTION_SCHEMA: return validateStatusProjection(value);
    default: return false;
  }
}

module.exports = {
  hasRefDigest,
  validateArtifactRefs,
  validateAttemptFailure,
  validateBrlReplayLockManifest,
  validateCurrentPointerSet,
  validateDirectMetaSessionArtifact,
  validateExecutionContextRegistry,
  validateHobObligationStatus,
  validateIndex,
  validateInstructionOmissionLedger,
  validateInstructionPackage,
  validateTransitionGuardDecision,
  validateTransitionGuardInput,
  validateLedgerEvent,
  validateLedgerManifest,
  validateMetaSession,
  validateRunContract,
  validateSourceRefs,
  validateStateObjectDescriptor,
  validateStatusProjection,
  validateTransitionClaim,
  validateUpstreamDiscriminatorRow,
};
