"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  DIRECT_BRL_REPLAY_LOCK_MANIFEST_SCHEMA,
  DIRECT_EXECUTION_CONTEXT_REGISTRY_SCHEMA,
  DIRECT_INSTRUCTION_OMISSION_LEDGER_SCHEMA,
  DIRECT_INSTRUCTION_PACKAGE_SCHEMA,
  DIRECT_META_ATTEMPT_FAILURE_SCHEMA,
  DIRECT_META_SESSION_INDEX_SCHEMA,
  DIRECT_META_SESSION_SCHEMA,
  DIRECT_META_STATE_OBJECT_DESCRIPTOR_SCHEMA,
  DIRECT_HOB_OBLIGATION_STATUS_SCHEMA,
  DIRECT_RUN_CONTRACT_SCHEMA,
  DIRECT_TRANSITION_CLAIM_SCHEMA,
  DIRECT_UPSTREAM_DISCRIMINATOR_ROW_SCHEMA,
} = require("./constants");
const { buildCurrentPointerSet } = require("./current-pointers");
const { artifactDigest, genericDigest } = require("./digest");
const { normalizeId, normalizeString, nowIso, safeSlotPart, isPlainObject } = require("./ids");
const {
  appendLedgerEvent,
  ensureDirectory,
  readJsonFile,
  verifyDirectMetaSessionLedger,
  writeJsonAtomic,
} = require("./ledger");
const { buildDirectMetaSessionStatusProjection } = require("./projection");
const { assertMetaSessionRendererSafe } = require("./raw-exposure");
const { validateDirectMetaSessionArtifact } = require("./schemas");
const { artifactRefFromArtifact, buildSourceRef } = require("./source-ref");

const ARTIFACT_FOLDERS = Object.freeze({
  context_registry: "execution-context-registries",
  descriptor: "state-object-descriptors",
  contract: "run-contracts",
  omission_ledger: "instruction-omission-ledgers",
  instruction_package: "instruction-packages",
  hob: "hob-obligation-status",
  transition_claim: "transition-claims",
  upstream_discriminator: "upstream-discriminators",
  brl: "brl-manifests",
  attempt: "attempts",
  projection: "projections",
});

function withArtifactDigest(artifactKind, artifact) {
  const next = { ...artifact };
  next.digest = artifactDigest({
    schemaVersion: next.schemaVersion,
    artifactKind,
    value: next,
  });
  return next;
}

function sourceRefs(input = {}) {
  if (Array.isArray(input.sourceRefs)) return input.sourceRefs;
  return [buildSourceRef({
    sourceKind: "fixture",
    authority: "fixture",
    sourceDigest: genericDigest({ source: input.sourceLabel || "meta-session-fixture" }),
    rendererSafeLabel: normalizeString(input.sourceLabel, "fixture"),
  })];
}

function normalizePolicy(value, name) {
  return isPlainObject(value) ? value : { policyId: `${name}@fixture`, mode: "diagnostic" };
}

function defaultMetaSessionRootDir() {
  try {
    const electron = require("electron");
    if (electron?.app && typeof electron.app.getPath === "function") {
      return path.join(electron.app.getPath("userData"), ".direct-meta-session");
    }
  } catch {}
  return path.join(process.cwd(), ".direct-meta-session");
}

class DirectMetaSessionStore {
  constructor(options = {}) {
    this.rootDir = path.resolve(options.rootDir || defaultMetaSessionRootDir());
    this.now = options.now || Date.now;
    this.randomId = options.randomId || normalizeId;
    this.ensureRoot();
  }

  ensureRoot() {
    ensureDirectory(this.rootDir);
    ensureDirectory(path.join(this.rootDir, "sessions"));
    if (!fs.existsSync(this.indexPath())) this.writeIndex({ sessionRefs: [] });
  }

  indexPath() {
    return path.join(this.rootDir, "index.json");
  }

  readIndex() {
    return readJsonFile(this.indexPath()) || this.buildIndex({ sessionRefs: [] });
  }

  buildIndex(input = {}) {
    return withArtifactDigest("meta_session_index", {
      schemaVersion: DIRECT_META_SESSION_INDEX_SCHEMA,
      sessionRefs: Array.isArray(input.sessionRefs) ? input.sessionRefs : [],
      currentGlobalPointerSetId: normalizeString(input.currentGlobalPointerSetId, ""),
      lastUpdatedAt: nowIso(this.now),
    });
  }

  writeIndex(input = {}) {
    const index = this.buildIndex(input);
    writeJsonAtomic(this.indexPath(), index);
    return index;
  }

  sessionDir(metaSessionId) {
    return path.join(this.rootDir, "sessions", safeSlotPart(metaSessionId));
  }

  sessionPath(metaSessionId) {
    return path.join(this.sessionDir(metaSessionId), "session.json");
  }

  ledgerDir(metaSessionId) {
    return path.join(this.sessionDir(metaSessionId), "ledger");
  }

  pointerPath(metaSessionId) {
    return path.join(this.sessionDir(metaSessionId), "current-pointers", "meta-session.json");
  }

  artifactPath(metaSessionId, folder, id) {
    return path.join(this.sessionDir(metaSessionId), "artifacts", folder, `${safeSlotPart(id)}.json`);
  }

  readMetaSession(metaSessionId) {
    return readJsonFile(this.sessionPath(metaSessionId));
  }

  readCurrentPointers(metaSessionId) {
    return readJsonFile(this.pointerPath(metaSessionId));
  }

  artifactSlot(metaSessionId, folder, id) {
    return `sessions/${safeSlotPart(metaSessionId)}/artifacts/${folder}/${safeSlotPart(id)}.json`;
  }

  sessionSlot(metaSessionId) {
    return `sessions/${safeSlotPart(metaSessionId)}/session.json`;
  }

  writeValidatedArtifact(metaSessionId, artifactKind, folder, id, artifact, eventKind, options = {}) {
    if (!options.sessionFile && !this.readMetaSession(metaSessionId)) {
      return this.recordAttemptFailure(metaSessionId, {
        attemptKind: options.attemptKind || artifactKind,
        blockerCode: "session_missing",
        rendererSafeSummary: `${artifactKind} write blocked: session missing`,
      });
    }
    try {
      assertMetaSessionRendererSafe(artifact);
      if (!validateDirectMetaSessionArtifact(artifact)) throw Object.assign(new Error("schema_invalid"), { code: "schema_invalid" });
      const targetPath = options.sessionFile ? this.sessionPath(metaSessionId) : this.artifactPath(metaSessionId, folder, id);
      writeJsonAtomic(targetPath, artifact);
      const storageSlot = options.sessionFile ? this.sessionSlot(metaSessionId) : this.artifactSlot(metaSessionId, folder, id);
      const artifactRef = artifactRefFromArtifact(artifactKind, artifact, storageSlot);
      const recorded = appendLedgerEvent(this.ledgerDir(metaSessionId), {
        eventKind,
        metaSessionId,
        artifactRefs: [artifactRef],
      }, { now: this.now });
      let currentPointerSet = null;
      if (options.updatePointers) {
        const pointerEvent = appendLedgerEvent(this.ledgerDir(metaSessionId), {
          eventKind: "current_pointer_set_updated",
          metaSessionId,
          artifactRefs: [artifactRef],
        }, { now: this.now }).event;
        currentPointerSet = buildCurrentPointerSet({
          pointerSetId: `meta_pointer_${metaSessionId}`,
          scopeKind: "meta_session",
          scopeId: metaSessionId,
          currentMetaSessionId: metaSessionId,
          currentContractId: options.currentContractId,
          currentContractVersion: options.currentContractVersion,
          currentSessionEpoch: options.currentSessionEpoch,
          currentContextRegistryId: options.currentContextRegistryId,
          currentLedgerHead: pointerEvent.ledgerHeadDigest,
          indexDigest: this.readIndex().digest,
        });
        writeJsonAtomic(this.pointerPath(metaSessionId), currentPointerSet);
      }
      return { ok: true, artifact, artifactRef, ledgerEvent: recorded.event, currentPointerSet };
    } catch (error) {
      const blockerCode = error?.code === "raw_exposure_blocked" ? "raw_exposure_blocked" : "schema_invalid";
      return this.recordAttemptFailure(metaSessionId, {
        attemptKind: options.attemptKind || artifactKind,
        blockerCode,
        rendererSafeSummary: `${artifactKind} write blocked`,
      });
    }
  }

  createMetaSession(input = {}) {
    const metaSessionId = normalizeId(input.metaSessionId, "meta_session");
    ensureDirectory(path.join(this.sessionDir(metaSessionId), "current-pointers"));
    ensureDirectory(path.join(this.ledgerDir(metaSessionId), "events"));
    for (const folder of Object.values(ARTIFACT_FOLDERS)) ensureDirectory(path.join(this.sessionDir(metaSessionId), "artifacts", folder));
    const createdAt = nowIso(this.now);
    const session = withArtifactDigest("meta_session", {
      schemaVersion: DIRECT_META_SESSION_SCHEMA,
      metaSessionId,
      title: normalizeString(input.title, "Untitled meta-session"),
      status: ["open", "stopped", "archived", "forked"].includes(input.status) ? input.status : "open",
      createdAt,
      updatedAt: createdAt,
      sessionEpoch: 1,
      activeContractId: "",
      activeContractVersion: undefined,
      contextRegistryId: "",
      sourceRefs: sourceRefs(input),
      rawTextIncluded: false,
    });
    const result = this.writeValidatedArtifact(metaSessionId, "meta_session", "", metaSessionId, session, "meta_session_created", {
      sessionFile: true,
      updatePointers: true,
      currentSessionEpoch: session.sessionEpoch,
      attemptKind: "session",
    });
    if (result.ok) {
      const index = this.readIndex();
      const sessionRef = artifactRefFromArtifact("meta_session", session, this.sessionSlot(metaSessionId));
      const sessionRefs = [...index.sessionRefs.filter((ref) => ref.artifactId !== metaSessionId), sessionRef];
      this.writeIndex({ sessionRefs, currentGlobalPointerSetId: `meta_pointer_${metaSessionId}` });
    }
    return result;
  }

  recordExecutionContextRegistry(metaSessionId, input = {}) {
    const registryId = normalizeId(input.registryId, "context_registry");
    const contexts = (Array.isArray(input.contexts) ? input.contexts : []).map((context, index) => {
      const normalized = {
        contextId: normalizeId(context.contextId, `context_${index + 1}`),
        contextKind: normalizeString(context.contextKind, "thread"),
        runtimeSourceClass: normalizeString(context.runtimeSourceClass, "direct"),
        jurisdiction: normalizeString(context.jurisdiction, "unspecified"),
        displayLabel: normalizeString(context.displayLabel, "Context"),
        evidenceRefs: Array.isArray(context.evidenceRefs) ? context.evidenceRefs : [],
        rawPathIncluded: false,
        rawChatGptUrlIncluded: false,
      };
      normalized.contextDigest = genericDigest({
        contextId: normalized.contextId,
        contextKind: normalized.contextKind,
        runtimeSourceClass: normalized.runtimeSourceClass,
        jurisdiction: normalized.jurisdiction,
        evidenceRefs: normalized.evidenceRefs.map((ref) => ref.sourceDigest || ref.artifactDigest || ""),
      });
      return normalized;
    });
    const registry = withArtifactDigest("execution_context_registry", {
      schemaVersion: DIRECT_EXECUTION_CONTEXT_REGISTRY_SCHEMA,
      registryId,
      metaSessionId,
      contexts,
      createdAt: nowIso(this.now),
      sourceDigest: genericDigest({ contexts }),
    });
    const result = this.writeValidatedArtifact(metaSessionId, "context_registry", ARTIFACT_FOLDERS.context_registry, registryId, registry, "execution_context_registry_recorded", {
      updatePointers: true,
      currentContextRegistryId: registryId,
      currentSessionEpoch: this.readMetaSession(metaSessionId)?.sessionEpoch,
      attemptKind: "context_registry",
    });
    if (result.ok) {
      const session = this.readMetaSession(metaSessionId);
      session.contextRegistryId = registryId;
      session.updatedAt = nowIso(this.now);
      writeJsonAtomic(this.sessionPath(metaSessionId), withArtifactDigest("meta_session", session));
    }
    return result;
  }

  recordStateObjectDescriptor(metaSessionId, input = {}) {
    const id = normalizeId(input.id, "state_object");
    const descriptor = withArtifactDigest("state_object_descriptor", {
      schemaVersion: DIRECT_META_STATE_OBJECT_DESCRIPTOR_SCHEMA,
      id,
      ownerKind: normalizeString(input.ownerKind, "meta_session_state"),
      producers: Array.isArray(input.producers) ? input.producers : [],
      consumers: Array.isArray(input.consumers) ? input.consumers : [],
      codeAnchors: {
        producers: input.codeAnchors?.producers || [],
        consumers: input.codeAnchors?.consumers || [],
        ipcChannels: input.codeAnchors?.ipcChannels || [],
        shellEvents: input.codeAnchors?.shellEvents || [],
        storageSlots: input.codeAnchors?.storageSlots || [],
      },
      evidenceAuthority: input.evidenceAuthority || [],
      statusLattice: input.statusLattice || [],
      projections: input.projections || [],
      mutationRoutes: input.mutationRoutes || [],
      staleEventRisks: input.staleEventRisks || [],
      unsupportedStates: input.unsupportedStates || [],
      preservationSentinels: input.preservationSentinels || [],
      validationRefs: input.validationRefs || [],
      rawTextIncluded: false,
      rawProviderPayloadIncluded: input.rawProviderPayloadIncluded === true,
    });
    return this.writeValidatedArtifact(metaSessionId, "descriptor", ARTIFACT_FOLDERS.descriptor, id, descriptor, "state_object_descriptor_recorded", {
      attemptKind: "descriptor",
    });
  }

  draftRunContract(metaSessionId, input = {}) {
    const session = this.readMetaSession(metaSessionId);
    const contractId = normalizeId(input.contractId, "run_contract");
    const contract = withArtifactDigest("run_contract", {
      schemaVersion: DIRECT_RUN_CONTRACT_SCHEMA,
      metaSessionId,
      contractId,
      contractVersion: Number(input.contractVersion || 1),
      sessionEpoch: Number(session?.sessionEpoch || 1),
      status: "draft",
      title: normalizeString(input.title, "Fixture run contract"),
      authorityPolicy: normalizePolicy(input.authorityPolicy, "authority"),
      amendmentPolicy: normalizePolicy(input.amendmentPolicy, "amendment"),
      stopPolicy: normalizePolicy(input.stopPolicy, "stop"),
      transitionPolicy: normalizePolicy(input.transitionPolicy, "transition"),
      instructionPolicy: normalizePolicy(input.instructionPolicy, "instruction"),
      evidencePolicy: normalizePolicy(input.evidencePolicy, "evidence"),
      createdAt: nowIso(this.now),
      sourceRefs: sourceRefs(input),
      rawTextIncluded: false,
    });
    return this.writeValidatedArtifact(metaSessionId, "contract", ARTIFACT_FOLDERS.contract, contractId, contract, "run_contract_drafted", {
      attemptKind: "contract",
    });
  }

  contractPath(metaSessionId, contractId) {
    return this.artifactPath(metaSessionId, ARTIFACT_FOLDERS.contract, contractId);
  }

  readContract(metaSessionId, contractId) {
    return readJsonFile(this.contractPath(metaSessionId, contractId));
  }

  omissionLedgerPath(metaSessionId, ledgerId) {
    return this.artifactPath(metaSessionId, ARTIFACT_FOLDERS.omission_ledger, ledgerId);
  }

  readOmissionLedger(metaSessionId, ledgerId) {
    return readJsonFile(this.omissionLedgerPath(metaSessionId, ledgerId));
  }

  lockRunContract(metaSessionId, contractId) {
    const contract = this.readContract(metaSessionId, contractId);
    if (!contract) return this.recordAttemptFailure(metaSessionId, { attemptKind: "contract", blockerCode: "contract_missing", rendererSafeSummary: "Contract missing." });
    const locked = withArtifactDigest("run_contract", { ...contract, status: "locked", lockedAt: nowIso(this.now) });
    return this.writeValidatedArtifact(metaSessionId, "contract", ARTIFACT_FOLDERS.contract, contractId, locked, "run_contract_locked", {
      attemptKind: "contract",
    });
  }

  activateRunContract(metaSessionId, contractId) {
    const session = this.readMetaSession(metaSessionId);
    if (!session) return this.recordAttemptFailure(metaSessionId, { attemptKind: "contract", blockerCode: "session_missing", rendererSafeSummary: "Session missing." });
    if (session.status !== "open") return this.recordAttemptFailure(metaSessionId, { attemptKind: "contract", blockerCode: "transition_not_allowed", rendererSafeSummary: "Only open meta-sessions may activate contracts." });
    const contract = this.readContract(metaSessionId, contractId);
    if (!contract) return this.recordAttemptFailure(metaSessionId, { attemptKind: "contract", blockerCode: "contract_missing", rendererSafeSummary: "Contract missing." });
    if (contract.status !== "locked") return this.recordAttemptFailure(metaSessionId, { attemptKind: "contract", blockerCode: "transition_not_allowed", rendererSafeSummary: "Only locked contracts may activate." });
    const nextEpoch = Number(session.sessionEpoch || 1) + 1;
    const active = withArtifactDigest("run_contract", { ...contract, status: "active", sessionEpoch: nextEpoch, activatedAt: nowIso(this.now) });
    const result = this.writeValidatedArtifact(metaSessionId, "contract", ARTIFACT_FOLDERS.contract, contractId, active, "run_contract_activated", {
      updatePointers: true,
      currentContractId: contractId,
      currentContractVersion: active.contractVersion,
      currentSessionEpoch: nextEpoch,
      currentContextRegistryId: session.contextRegistryId,
      attemptKind: "contract",
    });
    if (result.ok) {
      const updatedSession = withArtifactDigest("meta_session", {
        ...session,
        activeContractId: contractId,
        activeContractVersion: active.contractVersion,
        sessionEpoch: nextEpoch,
        updatedAt: nowIso(this.now),
      });
      writeJsonAtomic(this.sessionPath(metaSessionId), updatedSession);
    }
    return result;
  }

  recordInstructionOmissionLedger(metaSessionId, input = {}) {
    const ledgerId = normalizeId(input.ledgerId, "instruction_omission_ledger");
    const omissions = (Array.isArray(input.omissions) ? input.omissions : []).map((omission, index) => ({
      omissionId: normalizeId(omission.omissionId, `instruction_omission_${index + 1}`),
      sourceRef: omission.sourceRef || sourceRefs({ sourceLabel: `omission_${index + 1}` })[0],
      reason: normalizeString(omission.reason, "scope_excluded"),
      inheritedObligationStatus: normalizeString(omission.inheritedObligationStatus, "deferred_with_risk"),
      rendererSafeSummary: normalizeString(omission.rendererSafeSummary, "Instruction source omitted"),
      rawTextIncluded: false,
    }));
    const omissionLedger = withArtifactDigest("instruction_omission_ledger", {
      schemaVersion: DIRECT_INSTRUCTION_OMISSION_LEDGER_SCHEMA,
      ledgerId,
      metaSessionId,
      packageId: normalizeString(input.packageId, ""),
      roleId: normalizeString(input.roleId, "worker"),
      targetContextId: normalizeString(input.targetContextId, "context_fixture"),
      omissions,
      omissionCount: omissions.length,
      sourceDigest: genericDigest({ omissions: omissions.map((omission) => omission.sourceRef.sourceDigest), roleId: input.roleId, targetContextId: input.targetContextId }),
      rawTextIncluded: false,
      rawCompiledPromptIncluded: false,
    });
    return this.writeValidatedArtifact(metaSessionId, "instruction_omission_ledger", ARTIFACT_FOLDERS.omission_ledger, ledgerId, omissionLedger, "instruction_omission_ledger_recorded", {
      attemptKind: "instruction_omission_ledger",
    });
  }

  recordInstructionPackage(metaSessionId, input = {}) {
    const session = this.readMetaSession(metaSessionId);
    if (!session) return this.recordAttemptFailure(metaSessionId, { attemptKind: "instruction_package", blockerCode: "session_missing", rendererSafeSummary: "Session missing." });
    const contractId = normalizeString(input.contractId, session.activeContractId);
    if (!contractId) return this.recordAttemptFailure(metaSessionId, { attemptKind: "instruction_package", blockerCode: "contract_missing", rendererSafeSummary: "Instruction package requires an active contract." });
    const contract = this.readContract(metaSessionId, contractId);
    if (!contract || contract.status !== "active") {
      return this.recordAttemptFailure(metaSessionId, { attemptKind: "instruction_package", blockerCode: "contract_missing", rendererSafeSummary: "Active contract artifact missing." });
    }
    const packageId = normalizeId(input.packageId, "instruction_package");
    const roleId = normalizeString(input.roleId, "worker");
    const targetContextId = normalizeString(input.targetContextId, "context_fixture");
    const omissionLedgerRefs = [];
    const omissionLedgerIds = Array.isArray(input.omissionLedgerIds) ? input.omissionLedgerIds : [];
    if (!omissionLedgerIds.length) {
      return this.recordAttemptFailure(metaSessionId, { attemptKind: "instruction_package", blockerCode: "required_evidence_missing", rendererSafeSummary: "Instruction package requires an omission ledger." });
    }
    for (const ledgerId of omissionLedgerIds) {
      const omissionLedger = this.readOmissionLedger(metaSessionId, ledgerId);
      if (!omissionLedger) {
        return this.recordAttemptFailure(metaSessionId, { attemptKind: "instruction_package", blockerCode: "required_evidence_missing", rendererSafeSummary: "Instruction omission ledger missing." });
      }
      if (!validateDirectMetaSessionArtifact(omissionLedger)) {
        return this.recordAttemptFailure(metaSessionId, { attemptKind: "instruction_package", blockerCode: "schema_invalid", rendererSafeSummary: "Instruction omission ledger invalid." });
      }
      if (omissionLedger.metaSessionId !== metaSessionId || omissionLedger.roleId !== roleId || omissionLedger.targetContextId !== targetContextId) {
        return this.recordAttemptFailure(metaSessionId, { attemptKind: "instruction_package", blockerCode: "required_evidence_missing", rendererSafeSummary: "Instruction omission ledger scope mismatch." });
      }
      omissionLedgerRefs.push(artifactRefFromArtifact("instruction_omission_ledger", omissionLedger, this.artifactSlot(metaSessionId, ARTIFACT_FOLDERS.omission_ledger, ledgerId)));
    }
    const includedSourceRefs = Array.isArray(input.includedSourceRefs) ? input.includedSourceRefs : sourceRefs(input);
    const instructionPackage = withArtifactDigest("instruction_package", {
      schemaVersion: DIRECT_INSTRUCTION_PACKAGE_SCHEMA,
      packageId,
      metaSessionId,
      contractId,
      contractVersion: Number(input.contractVersion || contract.contractVersion),
      sessionEpoch: Number(input.sessionEpoch || contract.sessionEpoch),
      roleId,
      targetContextId,
      includedSourceRefs,
      omissionLedgerRefs,
      compiledMessagesDigest: normalizeString(input.compiledMessagesDigest, genericDigest({ includedSourceRefs, omissionLedgerRefs, contractId, packageId })),
      authoritySummary: Array.isArray(input.authoritySummary) ? input.authoritySummary : ["diagnostic instruction package only"],
      forbiddenActions: Array.isArray(input.forbiddenActions) ? input.forbiddenActions : ["worker_launch", "provider_transport", "runtime_enforce"],
      outputArtifactSchemaRef: normalizeString(input.outputArtifactSchemaRef, "future_worker_artifact@1"),
      rawCompiledPromptIncluded: false,
      launchEnvelopePersisted: false,
      workerLaunchAuthority: false,
    });
    return this.writeValidatedArtifact(metaSessionId, "instruction_package", ARTIFACT_FOLDERS.instruction_package, packageId, instructionPackage, "instruction_package_recorded", {
      attemptKind: "instruction_package",
    });
  }

  recordHobObligationStatus(metaSessionId, input = {}) {
    const rowId = normalizeId(input.rowId, "hob_row");
    const row = withArtifactDigest("hob_obligation_status", {
      schemaVersion: DIRECT_HOB_OBLIGATION_STATUS_SCHEMA,
      rowId,
      ownerStateObjectId: normalizeString(input.ownerStateObjectId, "state_object_fixture"),
      obligationId: normalizeString(input.obligationId, "obligation_fixture"),
      status: normalizeString(input.status, "covered"),
      evidenceRefs: sourceRefs(input),
      evidenceAuthority: normalizeString(input.evidenceAuthority, "fixture"),
      coverageKind: normalizeString(input.coverageKind, "covered_by_probe_matrix"),
      readinessPosture: normalizeString(input.readinessPosture, "diagnostic"),
      rendererSafeSummary: normalizeString(input.rendererSafeSummary, "HOB obligation fixture row"),
      rawTextIncluded: false,
    });
    return this.writeValidatedArtifact(metaSessionId, "hob", ARTIFACT_FOLDERS.hob, rowId, row, "hob_obligation_status_recorded", { attemptKind: "hob" });
  }

  recordTransitionClaim(metaSessionId, input = {}) {
    const transitionClaimId = normalizeId(input.transitionClaimId, "transition_claim");
    const claim = withArtifactDigest("transition_claim", {
      schemaVersion: DIRECT_TRANSITION_CLAIM_SCHEMA,
      transitionClaimId,
      metaSessionId,
      claimingActorRef: normalizeString(input.claimingActorRef, "fixture_actor"),
      claimSource: normalizeString(input.claimSource, "fixture"),
      fromPhase: normalizeString(input.fromPhase, ""),
      toPhase: normalizeString(input.toPhase, ""),
      claimedTransitionKind: normalizeString(input.claimedTransitionKind, ""),
      claimedReadinessPosture: normalizeString(input.claimedReadinessPosture, "diagnostic"),
      claimedEvidencePosture: normalizeString(input.claimedEvidencePosture, "fixture"),
      claimedPromotion: normalizeString(input.claimedPromotion, "none"),
      objectBridge: {
        carriedArtifactRefs: input.objectBridge?.carriedArtifactRefs || [],
        transformedArtifactRefs: input.objectBridge?.transformedArtifactRefs || [],
        comparisonTargetRefs: input.objectBridge?.comparisonTargetRefs || [],
      },
      evidenceBridge: {
        requiredEvidenceRefs: input.evidenceBridge?.requiredEvidenceRefs || sourceRefs(input),
        forbiddenEvidenceClasses: input.evidenceBridge?.forbiddenEvidenceClasses || [],
        observedEvidenceRefs: input.evidenceBridge?.observedEvidenceRefs || sourceRefs(input),
      },
      obligationBridge: {
        created: input.obligationBridge?.created || [],
        preserved: input.obligationBridge?.preserved || [],
        discharged: input.obligationBridge?.discharged || [],
        blocked: input.obligationBridge?.blocked || [],
        deferred: input.obligationBridge?.deferred || [],
      },
      useBridge: {
        intendedUse: normalizeString(input.useBridge?.intendedUse, "diagnostic"),
        allowedNextPhases: input.useBridge?.allowedNextPhases || [],
        forbiddenPromotions: input.useBridge?.forbiddenPromotions || [],
      },
      enforceableInThisPr: false,
      rawTextIncluded: false,
    });
    return this.writeValidatedArtifact(metaSessionId, "transition_claim", ARTIFACT_FOLDERS.transition_claim, transitionClaimId, claim, "transition_claim_recorded", { attemptKind: "transition_claim" });
  }

  recordUpstreamDiscriminator(metaSessionId, input = {}) {
    const rowId = normalizeId(input.rowId, "upstream_discriminator");
    const row = withArtifactDigest("upstream_discriminator", {
      schemaVersion: DIRECT_UPSTREAM_DISCRIMINATOR_ROW_SCHEMA,
      rowId,
      ownerStateObjectId: normalizeString(input.ownerStateObjectId, "state_object_fixture"),
      conflictingBranches: input.conflictingBranches || [],
      proposedDiscriminator: {
        discriminatorId: normalizeId(input.proposedDiscriminator?.discriminatorId, "discriminator"),
        discriminatorKind: normalizeString(input.proposedDiscriminator?.discriminatorKind, "other"),
        rendererSafeRule: normalizeString(input.proposedDiscriminator?.rendererSafeRule, "fixture discriminator"),
      },
      counterfactualProbeRefs: input.counterfactualProbeRefs || [],
      status: normalizeString(input.status, "proposed"),
      rawTextIncluded: false,
    });
    return this.writeValidatedArtifact(metaSessionId, "upstream_discriminator", ARTIFACT_FOLDERS.upstream_discriminator, rowId, row, "upstream_discriminator_recorded", { attemptKind: "upstream_discriminator" });
  }

  recordBrlReplayLockManifest(metaSessionId, input = {}) {
    const lockId = normalizeId(input.lockId, "brl_lock");
    const manifest = withArtifactDigest("brl", {
      schemaVersion: DIRECT_BRL_REPLAY_LOCK_MANIFEST_SCHEMA,
      lockId,
      ownerSurface: normalizeString(input.ownerSurface, "MetaSessionStatusProjection"),
      protectedSurfaces: input.protectedSurfaces || [],
      ignoredSurfaces: input.ignoredSurfaces || [],
      observedSurfaceRefs: input.observedSurfaceRefs || [],
      canonicalizationProfile: normalizeString(input.canonicalizationProfile, "fixture_canonicalization"),
      expectedObservationHash: normalizeString(input.expectedObservationHash, ""),
      canonicalObservationHash: normalizeString(input.canonicalObservationHash, ""),
      rawObservationHash: normalizeString(input.rawObservationHash, ""),
      expectedHashProvenance: normalizeString(input.expectedHashProvenance, "fixture"),
      environmentProfileRef: input.environmentProfileRef,
      mutationPolicy: normalizeString(input.mutationPolicy, "non_mutating"),
      manifestLifecycle: normalizeString(input.manifestLifecycle, "locked"),
      failureMeaning: "protected_projection_changed_not_product_truth",
      validationCommandRef: input.validationCommandRef,
      rawTextIncluded: false,
    });
    return this.writeValidatedArtifact(metaSessionId, "brl", ARTIFACT_FOLDERS.brl, lockId, manifest, "brl_replay_lock_manifest_recorded", { attemptKind: "brl" });
  }

  recordAttemptFailure(metaSessionId, input = {}) {
    const attemptId = normalizeId(input.attemptId, "attempt_failure");
    const failure = withArtifactDigest("attempt_failure", {
      schemaVersion: DIRECT_META_ATTEMPT_FAILURE_SCHEMA,
      attemptId,
      attemptKind: normalizeString(input.attemptKind, "projection"),
      blockerCode: normalizeString(input.blockerCode, "schema_invalid"),
      rendererSafeSummary: normalizeString(input.rendererSafeSummary, "Meta-session attempt failed."),
      currentPointersChanged: false,
      rawTextIncluded: false,
    });
    assertMetaSessionRendererSafe(failure);
    const folder = ARTIFACT_FOLDERS.attempt;
    if (metaSessionId && fs.existsSync(this.sessionDir(metaSessionId))) {
      writeJsonAtomic(this.artifactPath(metaSessionId, folder, attemptId), failure);
      try {
        appendLedgerEvent(this.ledgerDir(metaSessionId), {
          eventKind: "attempt_failure_recorded",
          metaSessionId,
          artifactRefs: [artifactRefFromArtifact("attempt_failure", failure, this.artifactSlot(metaSessionId, folder, attemptId))],
        }, { now: this.now });
      } catch {}
    }
    return {
      ok: false,
      blockerCode: failure.blockerCode,
      attemptFailure: failure,
    };
  }

  buildStatusProjection(metaSessionId) {
    const ledgerStatus = verifyDirectMetaSessionLedger(this.ledgerDir(metaSessionId), metaSessionId);
    const currentPointers = this.readCurrentPointers(metaSessionId);
    return buildDirectMetaSessionStatusProjection({
      metaSessionId,
      sessionDir: this.sessionDir(metaSessionId),
      currentPointers,
      ledgerStatus,
      now: this.now,
    });
  }

  verifyLedger(metaSessionId) {
    return verifyDirectMetaSessionLedger(this.ledgerDir(metaSessionId), metaSessionId);
  }
}

module.exports = {
  DirectMetaSessionStore,
  writeJsonAtomic,
};
