"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  DIRECT_BRL_REPLAY_LOCK_MANIFEST_SCHEMA,
  DIRECT_CROSS_CONTEXT_ROUTE_SCHEMA,
  DIRECT_EXECUTION_CONTEXT_REGISTRY_SCHEMA,
  DIRECT_INSTRUCTION_OMISSION_LEDGER_SCHEMA,
  DIRECT_INSTRUCTION_PACKAGE_SCHEMA,
  DIRECT_META_ATTEMPT_FAILURE_SCHEMA,
  DIRECT_META_SESSION_INDEX_SCHEMA,
  DIRECT_META_SESSION_SCHEMA,
  DIRECT_META_STATE_OBJECT_DESCRIPTOR_SCHEMA,
  DIRECT_HOB_OBLIGATION_STATUS_SCHEMA,
  DIRECT_RUN_CONTRACT_SCHEMA,
  DIRECT_TRANSITION_GUARD_DECISION_SCHEMA,
  DIRECT_TRANSITION_GUARD_INPUT_SCHEMA,
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
  transition_guard_input: "transition-guard-inputs",
  transition_guard_decision: "transition-guard-decisions",
  cross_context_route: "cross-context-routes",
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

function countBy(items = [], field) {
  const counts = {};
  for (const item of items) {
    const key = normalizeString(item?.[field], "unknown");
    counts[key] = Number(counts[key] || 0) + 1;
  }
  return counts;
}

class DirectMetaSessionStore {
  constructor(options = {}) {
    this.rootDir = path.resolve(options.rootDir || defaultMetaSessionRootDir());
    this.now = options.now || Date.now;
    this.randomId = options.randomId || normalizeId;
    if (options.ensureRoot !== false) this.ensureRoot();
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

  artifactDir(metaSessionId, folder) {
    return path.join(this.sessionDir(metaSessionId), "artifacts", folder);
  }

  artifactFileEntries(metaSessionId, folder) {
    try {
      const directory = this.artifactDir(metaSessionId, folder);
      return fs.readdirSync(directory, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map((entry) => {
          let mtimeMs = 0;
          try {
            mtimeMs = fs.statSync(path.join(directory, entry.name)).mtimeMs;
          } catch {}
          return { name: entry.name, mtimeMs };
        })
        .sort((a, b) => a.mtimeMs - b.mtimeMs || a.name.localeCompare(b.name));
    } catch (error) {
      if (error?.code === "ENOENT") return [];
      throw error;
    }
  }

  artifactFileCount(metaSessionId, folder) {
    return this.artifactFileEntries(metaSessionId, folder).length;
  }

  readArtifactList(metaSessionId, folder, limit = null) {
    const max = Number.isInteger(limit) && limit > 0 ? limit : null;
    const entries = this.artifactFileEntries(metaSessionId, folder);
    const selected = max ? entries.slice(-max) : entries;
    return selected
      .map((entry) => readJsonFile(path.join(this.artifactDir(metaSessionId, folder), entry.name)))
      .filter(Boolean);
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

  contextRegistryPath(metaSessionId, registryId) {
    return this.artifactPath(metaSessionId, ARTIFACT_FOLDERS.context_registry, registryId);
  }

  readContextRegistry(metaSessionId, registryId) {
    return readJsonFile(this.contextRegistryPath(metaSessionId, registryId));
  }

  omissionLedgerPath(metaSessionId, ledgerId) {
    return this.artifactPath(metaSessionId, ARTIFACT_FOLDERS.omission_ledger, ledgerId);
  }

  readOmissionLedger(metaSessionId, ledgerId) {
    return readJsonFile(this.omissionLedgerPath(metaSessionId, ledgerId));
  }

  instructionPackagePath(metaSessionId, packageId) {
    return this.artifactPath(metaSessionId, ARTIFACT_FOLDERS.instruction_package, packageId);
  }

  readInstructionPackage(metaSessionId, packageId) {
    return readJsonFile(this.instructionPackagePath(metaSessionId, packageId));
  }

  transitionGuardInputPath(metaSessionId, guardInputId) {
    return this.artifactPath(metaSessionId, ARTIFACT_FOLDERS.transition_guard_input, guardInputId);
  }

  readTransitionGuardInput(metaSessionId, guardInputId) {
    return readJsonFile(this.transitionGuardInputPath(metaSessionId, guardInputId));
  }

  transitionGuardDecisionPath(metaSessionId, guardDecisionId) {
    return this.artifactPath(metaSessionId, ARTIFACT_FOLDERS.transition_guard_decision, guardDecisionId);
  }

  readTransitionGuardDecision(metaSessionId, guardDecisionId) {
    return readJsonFile(this.transitionGuardDecisionPath(metaSessionId, guardDecisionId));
  }

  crossContextRoutePath(metaSessionId, routeId) {
    return this.artifactPath(metaSessionId, ARTIFACT_FOLDERS.cross_context_route, routeId);
  }

  readCrossContextRoute(metaSessionId, routeId) {
    return readJsonFile(this.crossContextRoutePath(metaSessionId, routeId));
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
    const roleId = normalizeString(input.roleId, "worker");
    const targetContextId = normalizeString(input.targetContextId, "context_fixture");
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
      roleId,
      targetContextId,
      omissions,
      omissionCount: omissions.length,
      sourceDigest: genericDigest({ omissions: omissions.map((omission) => omission.sourceRef.sourceDigest), roleId, targetContextId }),
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
    const contractId = normalizeString(session.activeContractId, "");
    if (!contractId) return this.recordAttemptFailure(metaSessionId, { attemptKind: "instruction_package", blockerCode: "contract_missing", rendererSafeSummary: "Instruction package requires an active contract." });
    const requestedContractId = normalizeString(input.contractId, contractId);
    if (requestedContractId !== contractId) {
      return this.recordAttemptFailure(metaSessionId, { attemptKind: "instruction_package", blockerCode: "contract_digest_mismatch", rendererSafeSummary: "Instruction package contract does not match active contract." });
    }
    const contract = this.readContract(metaSessionId, contractId);
    if (!contract || contract.status !== "active") {
      return this.recordAttemptFailure(metaSessionId, { attemptKind: "instruction_package", blockerCode: "contract_missing", rendererSafeSummary: "Active contract artifact missing." });
    }
    if (Number(contract.sessionEpoch) !== Number(session.sessionEpoch)) {
      return this.recordAttemptFailure(metaSessionId, { attemptKind: "instruction_package", blockerCode: "contract_epoch_stale", rendererSafeSummary: "Active contract epoch does not match session epoch." });
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
      contractVersion: Number(contract.contractVersion),
      sessionEpoch: Number(contract.sessionEpoch),
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

  recordTransitionGuardInput(metaSessionId, input = {}) {
    const session = this.readMetaSession(metaSessionId);
    if (!session) return this.recordAttemptFailure(metaSessionId, { attemptKind: "transition_guard", blockerCode: "session_missing", rendererSafeSummary: "Session missing." });
    const contractId = normalizeString(input.contractId, session.activeContractId);
    const contract = contractId ? this.readContract(metaSessionId, contractId) : null;
    if (!contract) return this.recordAttemptFailure(metaSessionId, { attemptKind: "transition_guard", blockerCode: "contract_missing", rendererSafeSummary: "Transition guard input requires a contract." });
    if (!validateDirectMetaSessionArtifact(contract)) return this.recordAttemptFailure(metaSessionId, { attemptKind: "transition_guard", blockerCode: "schema_invalid", rendererSafeSummary: "Transition guard input contract invalid." });
    const contextRegistryId = normalizeString(input.contextRegistryId, session.contextRegistryId);
    const contextRegistry = contextRegistryId ? this.readContextRegistry(metaSessionId, contextRegistryId) : null;
    if (!contextRegistry) return this.recordAttemptFailure(metaSessionId, { attemptKind: "transition_guard", blockerCode: "context_missing", rendererSafeSummary: "Transition guard input requires a context registry." });
    if (!validateDirectMetaSessionArtifact(contextRegistry)) return this.recordAttemptFailure(metaSessionId, { attemptKind: "transition_guard", blockerCode: "schema_invalid", rendererSafeSummary: "Transition guard input context registry invalid." });
    const sourceContextId = normalizeString(input.sourceContextId, "");
    const targetContextId = normalizeString(input.targetContextId, "");
    const sourceContext = contextRegistry.contexts?.find((context) => context.contextId === sourceContextId);
    const targetContext = contextRegistry.contexts?.find((context) => context.contextId === targetContextId);
    if (!sourceContext || !targetContext) return this.recordAttemptFailure(metaSessionId, { attemptKind: "transition_guard", blockerCode: "context_missing", rendererSafeSummary: "Transition guard input requires source and target contexts." });
    const packageId = normalizeString(input.instructionPackageId, "");
    const instructionPackage = packageId ? this.readInstructionPackage(metaSessionId, packageId) : null;
    if (!instructionPackage) return this.recordAttemptFailure(metaSessionId, { attemptKind: "transition_guard", blockerCode: "required_evidence_missing", rendererSafeSummary: "Transition guard input requires an instruction package." });
    if (!validateDirectMetaSessionArtifact(instructionPackage)) return this.recordAttemptFailure(metaSessionId, { attemptKind: "transition_guard", blockerCode: "schema_invalid", rendererSafeSummary: "Transition guard input instruction package invalid." });
    const transitionClaimRefs = [];
    for (const claimId of Array.isArray(input.transitionClaimIds) ? input.transitionClaimIds : []) {
      const claim = readJsonFile(this.artifactPath(metaSessionId, ARTIFACT_FOLDERS.transition_claim, claimId));
      if (!claim) return this.recordAttemptFailure(metaSessionId, { attemptKind: "transition_guard", blockerCode: "required_evidence_missing", rendererSafeSummary: "Transition guard input transition claim missing." });
      if (!validateDirectMetaSessionArtifact(claim)) return this.recordAttemptFailure(metaSessionId, { attemptKind: "transition_guard", blockerCode: "schema_invalid", rendererSafeSummary: "Transition guard input transition claim invalid." });
      transitionClaimRefs.push(artifactRefFromArtifact("transition_claim", claim, this.artifactSlot(metaSessionId, ARTIFACT_FOLDERS.transition_claim, claimId)));
    }
    const guardInputId = normalizeId(input.guardInputId, "transition_guard_input");
    const expectedContractVersion = Number(input.expectedContractVersion ?? contract.contractVersion);
    const expectedSessionEpoch = Number(input.expectedSessionEpoch ?? contract.sessionEpoch);
    const expectedSourceDigest = normalizeString(input.expectedSourceContextDigest, sourceContext.contextDigest);
    const expectedTargetDigest = normalizeString(input.expectedTargetContextDigest, targetContext.contextDigest);
    const contractRef = artifactRefFromArtifact("contract", contract, this.artifactSlot(metaSessionId, ARTIFACT_FOLDERS.contract, contractId));
    const contextRegistryRef = artifactRefFromArtifact("context_registry", contextRegistry, this.artifactSlot(metaSessionId, ARTIFACT_FOLDERS.context_registry, contextRegistryId));
    const instructionPackageRef = artifactRefFromArtifact("instruction_package", instructionPackage, this.artifactSlot(metaSessionId, ARTIFACT_FOLDERS.instruction_package, packageId));
    const guardInput = withArtifactDigest("transition_guard_input", {
      schemaVersion: DIRECT_TRANSITION_GUARD_INPUT_SCHEMA,
      guardInputId,
      metaSessionId,
      transitionKind: normalizeString(input.transitionKind, "cross_context_route"),
      contractRef,
      expectedContractVersion,
      expectedSessionEpoch,
      contextRegistryRef,
      sourceContext: {
        contextId: sourceContext.contextId,
        contextDigest: expectedSourceDigest,
      },
      targetContext: {
        contextId: targetContext.contextId,
        contextDigest: expectedTargetDigest,
      },
      instructionPackageRef,
      transitionClaimRefs,
      inputDigest: genericDigest({
        transitionKind: normalizeString(input.transitionKind, "cross_context_route"),
        contractDigest: contract.digest,
        expectedContractVersion,
        expectedSessionEpoch,
        sourceContextId: sourceContext.contextId,
        sourceContextDigest: expectedSourceDigest,
        targetContextId: targetContext.contextId,
        targetContextDigest: expectedTargetDigest,
        instructionPackageDigest: instructionPackage.digest,
        transitionClaimDigests: transitionClaimRefs.map((ref) => ref.artifactDigest),
      }),
      enforcementAvailableInThisPr: false,
      runtimeMutationAuthority: false,
      rawTextIncluded: false,
    });
    return this.writeValidatedArtifact(metaSessionId, "transition_guard_input", ARTIFACT_FOLDERS.transition_guard_input, guardInputId, guardInput, "transition_guard_input_recorded", {
      attemptKind: "transition_guard",
    });
  }

  recordTransitionGuardDecision(metaSessionId, input = {}) {
    const session = this.readMetaSession(metaSessionId);
    if (!session) return this.recordAttemptFailure(metaSessionId, { attemptKind: "transition_guard", blockerCode: "session_missing", rendererSafeSummary: "Session missing." });
    const guardInputId = normalizeString(input.guardInputId, "");
    const guardInput = guardInputId ? this.readTransitionGuardInput(metaSessionId, guardInputId) : null;
    if (!guardInput) return this.recordAttemptFailure(metaSessionId, { attemptKind: "transition_guard", blockerCode: "required_evidence_missing", rendererSafeSummary: "Transition guard input missing." });
    if (!validateDirectMetaSessionArtifact(guardInput)) return this.recordAttemptFailure(metaSessionId, { attemptKind: "transition_guard", blockerCode: "schema_invalid", rendererSafeSummary: "Transition guard input invalid." });

    const reasons = [];
    const blockerCodes = [];
    const evidenceRefs = [artifactRefFromArtifact("transition_guard_input", guardInput, this.artifactSlot(metaSessionId, ARTIFACT_FOLDERS.transition_guard_input, guardInputId))];
    const contract = this.readContract(metaSessionId, guardInput.contractRef.artifactId);
    const isContractValid = Boolean(contract && validateDirectMetaSessionArtifact(contract));
    if (!isContractValid) {
      reasons.push("contract_missing_or_invalid");
      blockerCodes.push("contract_missing");
    } else {
      evidenceRefs.push(artifactRefFromArtifact("contract", contract, this.artifactSlot(metaSessionId, ARTIFACT_FOLDERS.contract, contract.contractId)));
      if (contract.digest !== guardInput.contractRef.artifactDigest) {
        reasons.push("contract_digest_mismatch");
        blockerCodes.push("contract_digest_mismatch");
      }
      if (contract.status !== "active" || session.activeContractId !== contract.contractId) {
        reasons.push("contract_not_active");
        blockerCodes.push("contract_digest_mismatch");
      }
      if (Number(contract.contractVersion) !== Number(guardInput.expectedContractVersion) || Number(contract.sessionEpoch) !== Number(guardInput.expectedSessionEpoch) || Number(session.sessionEpoch) !== Number(guardInput.expectedSessionEpoch)) {
        reasons.push("contract_epoch_stale");
        blockerCodes.push("contract_epoch_stale");
      }
    }

    const contextRegistry = this.readContextRegistry(metaSessionId, guardInput.contextRegistryRef.artifactId);
    if (!contextRegistry || !validateDirectMetaSessionArtifact(contextRegistry)) {
      reasons.push("context_registry_missing_or_invalid");
      blockerCodes.push("context_missing");
    } else {
      evidenceRefs.push(artifactRefFromArtifact("context_registry", contextRegistry, this.artifactSlot(metaSessionId, ARTIFACT_FOLDERS.context_registry, contextRegistry.registryId)));
      if (contextRegistry.digest !== guardInput.contextRegistryRef.artifactDigest) {
        reasons.push("context_registry_digest_mismatch");
        blockerCodes.push("context_digest_mismatch");
      }
      const sourceContext = contextRegistry.contexts.find((context) => context.contextId === guardInput.sourceContext.contextId);
      const targetContext = contextRegistry.contexts.find((context) => context.contextId === guardInput.targetContext.contextId);
      if (!sourceContext || !targetContext) {
        reasons.push("context_missing");
        blockerCodes.push("context_missing");
      } else if (sourceContext.contextDigest !== guardInput.sourceContext.contextDigest || targetContext.contextDigest !== guardInput.targetContext.contextDigest) {
        reasons.push("context_digest_mismatch");
        blockerCodes.push("context_digest_mismatch");
      }
    }

    const instructionPackage = this.readInstructionPackage(metaSessionId, guardInput.instructionPackageRef.artifactId);
    if (!instructionPackage || !validateDirectMetaSessionArtifact(instructionPackage)) {
      reasons.push("instruction_package_missing_or_invalid");
      blockerCodes.push("required_evidence_missing");
    } else {
      evidenceRefs.push(artifactRefFromArtifact("instruction_package", instructionPackage, this.artifactSlot(metaSessionId, ARTIFACT_FOLDERS.instruction_package, instructionPackage.packageId)));
      if (instructionPackage.digest !== guardInput.instructionPackageRef.artifactDigest) {
        reasons.push("instruction_package_digest_mismatch");
        blockerCodes.push("required_evidence_missing");
      }
      if (isContractValid && (instructionPackage.contractId !== contract.contractId || Number(instructionPackage.sessionEpoch) !== Number(contract.sessionEpoch))) {
        reasons.push("instruction_package_contract_mismatch");
        blockerCodes.push("required_evidence_missing");
      }
    }

    if (!guardInput.transitionClaimRefs.length) {
      reasons.push("transition_claim_missing");
      blockerCodes.push("required_evidence_missing");
    } else {
      evidenceRefs.push(...guardInput.transitionClaimRefs);
    }

    const uniqueBlockers = [...new Set(blockerCodes)];
    const decision = uniqueBlockers.includes("context_digest_mismatch") || uniqueBlockers.includes("contract_epoch_stale") || uniqueBlockers.includes("contract_digest_mismatch")
      ? "deny_shadow"
      : uniqueBlockers.includes("required_evidence_missing")
        ? "ask_human_shadow"
        : uniqueBlockers.length
          ? "reclassify_shadow"
          : "allow_shadow";
    const guardDecisionId = normalizeId(input.guardDecisionId, "transition_guard_decision");
    const guardDecision = withArtifactDigest("transition_guard_decision", {
      schemaVersion: DIRECT_TRANSITION_GUARD_DECISION_SCHEMA,
      guardDecisionId,
      metaSessionId,
      guardInputRef: artifactRefFromArtifact("transition_guard_input", guardInput, this.artifactSlot(metaSessionId, ARTIFACT_FOLDERS.transition_guard_input, guardInputId)),
      decision,
      reasonCodes: reasons.length ? [...new Set(reasons)] : ["shadow_evidence_valid"],
      blockerCodes: uniqueBlockers,
      evidenceRefs,
      wouldBlockInFutureEnforceMode: decision !== "allow_shadow",
      shadowOnly: true,
      enforceableInThisPr: false,
      runtimeBlocked: false,
      routeDispatched: false,
      workerLaunchAuthority: false,
      providerTransportAuthority: false,
      rawTextIncluded: false,
    });
    return this.writeValidatedArtifact(metaSessionId, "transition_guard_decision", ARTIFACT_FOLDERS.transition_guard_decision, guardDecisionId, guardDecision, "transition_guard_decision_recorded", {
      attemptKind: "transition_guard",
    });
  }

  recordCrossContextRouteProposal(metaSessionId, input = {}) {
    const session = this.readMetaSession(metaSessionId);
    if (!session) return this.recordAttemptFailure(metaSessionId, { attemptKind: "cross_context_route", blockerCode: "session_missing", rendererSafeSummary: "Session missing." });
    const contractId = normalizeString(session.activeContractId, "");
    const contract = contractId ? this.readContract(metaSessionId, contractId) : null;
    if (!contract || !validateDirectMetaSessionArtifact(contract) || contract.status !== "active") {
      return this.recordAttemptFailure(metaSessionId, { attemptKind: "cross_context_route", blockerCode: "contract_missing", rendererSafeSummary: "Cross-context route requires an active contract." });
    }
    const contextRegistryId = normalizeString(input.contextRegistryId, session.contextRegistryId);
    const contextRegistry = contextRegistryId ? this.readContextRegistry(metaSessionId, contextRegistryId) : null;
    if (!contextRegistry || !validateDirectMetaSessionArtifact(contextRegistry)) {
      return this.recordAttemptFailure(metaSessionId, { attemptKind: "cross_context_route", blockerCode: "context_missing", rendererSafeSummary: "Cross-context route requires a context registry." });
    }
    const targetContextIds = (Array.isArray(input.targetContextIds) ? input.targetContextIds : []).map((contextId) => normalizeString(contextId, "")).filter(Boolean);
    if (!targetContextIds.length) return this.recordAttemptFailure(metaSessionId, { attemptKind: "cross_context_route", blockerCode: "context_missing", rendererSafeSummary: "Cross-context route requires target contexts." });
    const observedContextDigestsAtProposal = {};
    for (const targetContextId of targetContextIds) {
      const context = contextRegistry.contexts.find((entry) => entry.contextId === targetContextId);
      if (!context) return this.recordAttemptFailure(metaSessionId, { attemptKind: "cross_context_route", blockerCode: "context_missing", rendererSafeSummary: "Cross-context route target context missing." });
      observedContextDigestsAtProposal[targetContextId] = context.contextDigest;
    }
    const guardDecisionId = normalizeString(input.guardDecisionId, "");
    const guardDecision = guardDecisionId ? this.readTransitionGuardDecision(metaSessionId, guardDecisionId) : null;
    if (!guardDecision || !validateDirectMetaSessionArtifact(guardDecision)) {
      return this.recordAttemptFailure(metaSessionId, { attemptKind: "cross_context_route", blockerCode: "required_evidence_missing", rendererSafeSummary: "Cross-context route requires a transition guard decision." });
    }
    if (guardDecision.metaSessionId !== metaSessionId) {
      return this.recordAttemptFailure(metaSessionId, { attemptKind: "cross_context_route", blockerCode: "required_evidence_missing", rendererSafeSummary: "Cross-context route guard decision session mismatch." });
    }
    if (guardDecision.decision !== "allow_shadow") {
      return this.recordAttemptFailure(metaSessionId, { attemptKind: "cross_context_route", blockerCode: "required_evidence_missing", rendererSafeSummary: "Cross-context route requires an allow-shadow guard decision." });
    }
    const guardInput = this.readTransitionGuardInput(metaSessionId, guardDecision.guardInputRef.artifactId);
    if (!guardInput || !validateDirectMetaSessionArtifact(guardInput) || guardInput.metaSessionId !== metaSessionId) {
      return this.recordAttemptFailure(metaSessionId, { attemptKind: "cross_context_route", blockerCode: "required_evidence_missing", rendererSafeSummary: "Cross-context route guard input missing or invalid." });
    }
    const guardedTargetContextId = guardInput.targetContext.contextId;
    if (guardDecision.guardInputRef.artifactDigest !== guardInput.digest
      || guardInput.transitionKind !== "cross_context_route"
      || guardInput.contractRef.artifactId !== contract.contractId
      || guardInput.contractRef.artifactDigest !== contract.digest
      || Number(guardInput.expectedContractVersion) !== Number(contract.contractVersion)
      || Number(guardInput.expectedSessionEpoch) !== Number(contract.sessionEpoch)
      || guardInput.contextRegistryRef.artifactId !== contextRegistry.registryId
      || guardInput.contextRegistryRef.artifactDigest !== contextRegistry.digest
      || targetContextIds.length !== 1
      || guardedTargetContextId !== targetContextIds[0]
      || guardInput.targetContext.contextDigest !== observedContextDigestsAtProposal[guardedTargetContextId]) {
      return this.recordAttemptFailure(metaSessionId, { attemptKind: "cross_context_route", blockerCode: "required_evidence_missing", rendererSafeSummary: "Cross-context route guard decision scope mismatch." });
    }
    const ledgerStatus = this.verifyLedger(metaSessionId);
    if (!ledgerStatus.ok) return this.recordAttemptFailure(metaSessionId, { attemptKind: "cross_context_route", blockerCode: "ledger_corrupt", rendererSafeSummary: "Cross-context route requires a valid ledger." });
    const routeId = normalizeId(input.routeId, "cross_context_route");
    const requestedRouteKind = normalizeString(input.routeKind, "dispatch");
    const routeKind = ["dispatch", "status_request", "question", "handoff", "broadcast"].includes(requestedRouteKind) ? requestedRouteKind : "dispatch";
    const proposalDigest = genericDigest({
      routeId,
      metaSessionId,
      contractDigest: contract.digest,
      contextRegistryDigest: contextRegistry.digest,
      targetContextIds,
      observedContextDigestsAtProposal,
      observedLedgerHeadAtProposal: ledgerStatus.ledgerHeadDigest,
      routeKind,
      guardDecisionDigest: guardDecision.digest,
    });
    const route = withArtifactDigest("cross_context_route", {
      schemaVersion: DIRECT_CROSS_CONTEXT_ROUTE_SCHEMA,
      routeId,
      metaSessionId,
      lifecycleState: "proposed",
      contractRef: artifactRefFromArtifact("contract", contract, this.artifactSlot(metaSessionId, ARTIFACT_FOLDERS.contract, contract.contractId)),
      contractVersion: Number(contract.contractVersion),
      sessionEpoch: Number(contract.sessionEpoch),
      sourceSurface: ["meta_session_chat", "local_thread", "ui_action"].includes(input.sourceSurface) ? input.sourceSurface : "meta_session_chat",
      contextRegistryRef: artifactRefFromArtifact("context_registry", contextRegistry, this.artifactSlot(metaSessionId, ARTIFACT_FOLDERS.context_registry, contextRegistry.registryId)),
      targetContextIds,
      observedContextDigestsAtProposal,
      observedLedgerHeadAtProposal: ledgerStatus.ledgerHeadDigest,
      routeProposalDigest: proposalDigest,
      routeKind,
      confidence: ["high", "medium", "low"].includes(input.confidence) ? input.confidence : "medium",
      ambiguity: Array.isArray(input.ambiguity) ? input.ambiguity : [],
      humanApproved: false,
      guardDecisionRef: artifactRefFromArtifact("transition_guard_decision", guardDecision, this.artifactSlot(metaSessionId, ARTIFACT_FOLDERS.transition_guard_decision, guardDecision.guardDecisionId)),
      runtimeMutationAuthority: false,
      workerLaunchAuthority: false,
      providerTransportAuthority: false,
      rawTextIncluded: false,
      createdAt: nowIso(this.now),
    });
    return this.writeValidatedArtifact(metaSessionId, "cross_context_route", ARTIFACT_FOLDERS.cross_context_route, routeId, route, "cross_context_route_proposed", {
      attemptKind: "cross_context_route",
    });
  }

  acceptCrossContextRoute(metaSessionId, routeId, input = {}) {
    const route = this.readCrossContextRoute(metaSessionId, routeId);
    if (!route || !validateDirectMetaSessionArtifact(route)) return this.recordAttemptFailure(metaSessionId, { attemptKind: "cross_context_route", blockerCode: "required_evidence_missing", rendererSafeSummary: "Cross-context route missing." });
    if (route.metaSessionId !== metaSessionId) return this.recordAttemptFailure(metaSessionId, { attemptKind: "cross_context_route", blockerCode: "required_evidence_missing", rendererSafeSummary: "Cross-context route session mismatch." });
    if (route.lifecycleState !== "proposed") return this.recordAttemptFailure(metaSessionId, { attemptKind: "cross_context_route", blockerCode: "transition_not_allowed", rendererSafeSummary: "Only proposed routes may be accepted." });
    if (input.humanApproved !== true) return this.recordAttemptFailure(metaSessionId, { attemptKind: "cross_context_route", blockerCode: "human_approval_required", rendererSafeSummary: "Cross-context route acceptance requires human approval." });
    const accepted = withArtifactDigest("cross_context_route", {
      ...route,
      lifecycleState: "accepted",
      humanApproved: true,
      acceptedAt: nowIso(this.now),
      runtimeMutationAuthority: false,
      workerLaunchAuthority: false,
      providerTransportAuthority: false,
    });
    return this.writeValidatedArtifact(metaSessionId, "cross_context_route", ARTIFACT_FOLDERS.cross_context_route, route.routeId, accepted, "cross_context_route_accepted", {
      attemptKind: "cross_context_route",
    });
  }

  dispatchCrossContextRoute(metaSessionId, routeId) {
    const route = this.readCrossContextRoute(metaSessionId, routeId);
    if (!route || !validateDirectMetaSessionArtifact(route)) return this.recordAttemptFailure(metaSessionId, { attemptKind: "cross_context_route", blockerCode: "required_evidence_missing", rendererSafeSummary: "Cross-context route missing." });
    if (route.metaSessionId !== metaSessionId) return this.recordAttemptFailure(metaSessionId, { attemptKind: "cross_context_route", blockerCode: "required_evidence_missing", rendererSafeSummary: "Cross-context route session mismatch." });
    if (route.lifecycleState !== "accepted") return this.recordAttemptFailure(metaSessionId, { attemptKind: "cross_context_route", blockerCode: "transition_not_allowed", rendererSafeSummary: "Only accepted routes may be dispatched." });
    const contextRegistry = this.readContextRegistry(metaSessionId, route.contextRegistryRef.artifactId);
    if (!contextRegistry || !validateDirectMetaSessionArtifact(contextRegistry)) return this.recordAttemptFailure(metaSessionId, { attemptKind: "cross_context_route", blockerCode: "context_missing", rendererSafeSummary: "Cross-context route context registry missing." });
    const ledgerStatus = this.verifyLedger(metaSessionId);
    if (!ledgerStatus.ok) return this.recordAttemptFailure(metaSessionId, { attemptKind: "cross_context_route", blockerCode: "ledger_corrupt", rendererSafeSummary: "Cross-context route requires a valid ledger." });
    const observedContextDigestsAtDispatch = {};
    let routeStale = false;
    for (const targetContextId of route.targetContextIds) {
      const context = contextRegistry.contexts.find((entry) => entry.contextId === targetContextId);
      if (!context) {
        routeStale = true;
        continue;
      }
      observedContextDigestsAtDispatch[targetContextId] = context.contextDigest;
      if (context.contextDigest !== route.observedContextDigestsAtProposal[targetContextId]) routeStale = true;
    }
    const next = withArtifactDigest("cross_context_route", {
      ...route,
      lifecycleState: routeStale ? "dispatch_blocked" : "dispatched",
      observedContextDigestsAtDispatch,
      observedLedgerHeadAtDispatch: ledgerStatus.ledgerHeadDigest,
      staleBlockerCode: routeStale ? "route_stale" : undefined,
      dispatchedAt: nowIso(this.now),
      runtimeMutationAuthority: false,
      workerLaunchAuthority: false,
      providerTransportAuthority: false,
    });
    const result = this.writeValidatedArtifact(metaSessionId, "cross_context_route", ARTIFACT_FOLDERS.cross_context_route, route.routeId, next, routeStale ? "cross_context_route_dispatch_blocked" : "cross_context_route_dispatched", {
      attemptKind: "cross_context_route",
    });
    if (!result.ok) return result;
    if (!routeStale) return result;
    const failure = this.recordAttemptFailure(metaSessionId, {
      attemptKind: "cross_context_route",
      blockerCode: "route_stale",
      rendererSafeSummary: "Cross-context route dispatch blocked by stale context evidence.",
    });
    return { ...failure, artifact: result.artifact, artifactRef: result.artifactRef };
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

  availableMetaSessionSummaries(index = this.readIndex()) {
    const refs = Array.isArray(index?.sessionRefs) ? index.sessionRefs : [];
    return refs.slice(-8)
      .map((ref) => ({
        metaSessionId: normalizeString(ref?.artifactId, ""),
        artifactDigest: normalizeString(ref?.artifactDigest, ""),
        rendererSafeLabel: normalizeString(ref?.artifactId, "unknown"),
      }))
      .filter((ref) => ref.metaSessionId);
  }

  statusDetails(metaSessionId, input = {}) {
    const index = input.index || this.readIndex();
    const session = this.readMetaSession(metaSessionId);
    const contextRegistry = session?.contextRegistryId ? this.readContextRegistry(metaSessionId, session.contextRegistryId) : null;
    const guardDecisionTotal = this.artifactFileCount(metaSessionId, ARTIFACT_FOLDERS.transition_guard_decision);
    const routeTotal = this.artifactFileCount(metaSessionId, ARTIFACT_FOLDERS.cross_context_route);
    const attemptTotal = this.artifactFileCount(metaSessionId, ARTIFACT_FOLDERS.attempt);
    const activeContract = session?.activeContractId ? this.readContract(metaSessionId, session.activeContractId) : null;
    const guardDecisions = this.readArtifactList(metaSessionId, ARTIFACT_FOLDERS.transition_guard_decision, 32);
    const routes = this.readArtifactList(metaSessionId, ARTIFACT_FOLDERS.cross_context_route, 32);
    const attempts = this.readArtifactList(metaSessionId, ARTIFACT_FOLDERS.attempt, 32);
    const routeLifecycleCounts = countBy(routes, "lifecycleState");
    const guardDecisionCounts = countBy(guardDecisions, "decision");
    const latestAttemptBlockers = attempts
      .map((attempt) => attempt.blockerCode)
      .filter(Boolean)
      .slice(-5);
    const selectedMetaSession = session ? {
      metaSessionId: session.metaSessionId,
      status: session.status,
      sessionEpoch: Number(session.sessionEpoch),
      activeContractId: normalizeString(session.activeContractId, ""),
      activeContractVersion: Number.isInteger(session.activeContractVersion) ? session.activeContractVersion : undefined,
      contextRegistryId: normalizeString(session.contextRegistryId, ""),
      rawTextIncluded: false,
    } : undefined;
    const routeSummary = {
      total: routeTotal,
      recentWindowCount: routes.length,
      proposed: Number(routeLifecycleCounts.proposed || 0),
      accepted: Number(routeLifecycleCounts.accepted || 0),
      dispatched: Number(routeLifecycleCounts.dispatched || 0),
      dispatchBlocked: Number(routeLifecycleCounts.dispatch_blocked || 0),
      latest: routes.slice(-5).map((route) => ({
        routeId: route.routeId,
        lifecycleState: route.lifecycleState,
        routeKind: route.routeKind,
        staleBlockerCode: route.staleBlockerCode || "",
        runtimeMutationAuthority: false,
        workerLaunchAuthority: false,
        providerTransportAuthority: false,
      })),
    };
    const guardDecisionSummary = {
      total: guardDecisionTotal,
      recentWindowCount: guardDecisions.length,
      allowShadow: Number(guardDecisionCounts.allow_shadow || 0),
      denyShadow: Number(guardDecisionCounts.deny_shadow || 0),
      askHumanShadow: Number(guardDecisionCounts.ask_human_shadow || 0),
      reclassifyShadow: Number(guardDecisionCounts.reclassify_shadow || 0),
      stopShadow: Number(guardDecisionCounts.stop_shadow || 0),
    };
    const attemptFailureSummary = {
      total: attemptTotal,
      recentWindowCount: attempts.length,
      latestBlockerCodes: latestAttemptBlockers,
    };
    const summaryRows = [
      { label: "Session", value: session ? session.status : "missing", state: session ? "ok" : "missing" },
      { label: "Epoch", value: session ? String(session.sessionEpoch) : "none", state: session ? "ok" : "missing" },
      { label: "Active contract", value: activeContract ? activeContract.status : "missing", state: activeContract ? "ok" : "missing" },
      { label: "Contexts", value: String(Array.isArray(contextRegistry?.contexts) ? contextRegistry.contexts.length : 0), state: contextRegistry ? "ok" : "missing" },
      { label: "Guard decisions", value: String(guardDecisionTotal), state: guardDecisionTotal ? "ok" : "missing" },
      { label: "Routes", value: String(routeTotal), state: routeTotal ? "ok" : "missing" },
      { label: "Dispatch blocked", value: String(routeSummary.dispatchBlocked), state: routeSummary.dispatchBlocked ? "blocked" : "ok" },
      { label: "Attempt failures", value: String(attemptTotal), state: attemptTotal ? "blocked" : "ok" },
    ];
    return {
      selectedMetaSession,
      availableMetaSessions: this.availableMetaSessionSummaries(index),
      routeSummary,
      guardDecisionSummary,
      attemptFailureSummary,
      summaryRows,
      requestedMetaSessionId: normalizeString(input.requestedMetaSessionId, ""),
      rendererSafe: true,
    };
  }

  readLatestStatusProjection(input = {}) {
    const index = this.readIndex();
    const refs = Array.isArray(index?.sessionRefs) ? index.sessionRefs : [];
    const requestedMetaSessionId = normalizeString(input.metaSessionId, "");
    const selectedMetaSessionId = requestedMetaSessionId || refs[refs.length - 1]?.artifactId || "";
    if (!selectedMetaSessionId || !this.readMetaSession(selectedMetaSessionId)) {
      return buildDirectMetaSessionStatusProjection({
        metaSessionId: selectedMetaSessionId,
        sessionDir: "",
        currentPointers: null,
        ledgerStatus: { ok: true, ledgerHeadDigest: "", events: [] },
        health: "missing",
        now: this.now,
        details: {
          selectedMetaSession: undefined,
          availableMetaSessions: this.availableMetaSessionSummaries(index),
          routeSummary: { total: 0, proposed: 0, accepted: 0, dispatched: 0, dispatchBlocked: 0, latest: [] },
          guardDecisionSummary: { total: 0, allowShadow: 0, denyShadow: 0, askHumanShadow: 0, reclassifyShadow: 0, stopShadow: 0 },
          attemptFailureSummary: { total: 0, latestBlockerCodes: [] },
          summaryRows: [
            { label: "Session", value: "missing", state: "missing" },
            { label: "Status", value: "read-only", state: "ok" },
          ],
          requestedMetaSessionId,
          rendererSafe: true,
        },
      });
    }
    return this.buildStatusProjection(selectedMetaSessionId, { index, requestedMetaSessionId });
  }

  buildStatusProjection(metaSessionId, options = {}) {
    const ledgerStatus = verifyDirectMetaSessionLedger(this.ledgerDir(metaSessionId), metaSessionId);
    const currentPointers = this.readCurrentPointers(metaSessionId);
    return buildDirectMetaSessionStatusProjection({
      metaSessionId,
      sessionDir: this.sessionDir(metaSessionId),
      currentPointers,
      ledgerStatus,
      details: this.statusDetails(metaSessionId, options),
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
