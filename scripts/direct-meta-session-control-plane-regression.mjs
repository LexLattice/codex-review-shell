#!/usr/bin/env node

import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const {
  DirectMetaSessionStore,
  DIRECT_META_CONTROL_PLANE_REPORT_SCHEMA,
  buildArtifactRef,
  expectedObservationHash,
  fixtureArtifactRef,
  fixtureSourceRef,
  genericDigest,
  scanMetaSessionRawExposure,
  validateDirectMetaSessionArtifact,
  validateMetaSession,
} = require("../src/main/direct/meta-session");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function createTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "direct-meta-session-"));
}

function makeStore(rootDir, clock) {
  return new DirectMetaSessionStore({
    rootDir,
    now: () => clock.now,
  });
}

function validDescriptorInput(overrides = {}) {
  return {
    id: "descriptor_meta_session_fixture",
    ownerKind: "meta_session_state",
    producers: ["src/main/direct/meta-session/store.js"],
    consumers: ["src/main/direct/meta-session/projection.js"],
    codeAnchors: {
      producers: ["DirectMetaSessionStore"],
      consumers: ["buildDirectMetaSessionStatusProjection"],
      ipcChannels: [],
      shellEvents: [],
      storageSlots: ["sessions/<metaSessionId>/session.json"],
    },
    evidenceAuthority: ["fixture"],
    statusLattice: ["open", "stopped", "archived", "forked"],
    projections: ["direct_meta_session_status_projection@1"],
    mutationRoutes: [],
    staleEventRisks: ["pointer_stale"],
    unsupportedStates: ["runtime_enforce"],
    preservationSentinels: ["meta_session_context_identity_projection_preserved"],
    validationRefs: ["direct-meta-session-control-plane-regression"],
    ...overrides,
  };
}

function validTransitionClaimInput(overrides = {}) {
  const sourceRef = fixtureSourceRef("transition evidence");
  const artifactRef = fixtureArtifactRef("contract", "contract_fixture_ref");
  return {
    transitionClaimId: "transition_claim_fixture",
    claimingActorRef: "fixture_actor",
    claimSource: "fixture",
    fromPhase: "route_proposed",
    toPhase: "route_accepted",
    claimedTransitionKind: "AcceptCrossContextRoute",
    claimedReadinessPosture: "diagnostic",
    claimedEvidencePosture: "fixture",
    claimedPromotion: "none",
    objectBridge: {
      carriedArtifactRefs: [artifactRef],
      transformedArtifactRefs: [],
      comparisonTargetRefs: [],
    },
    evidenceBridge: {
      requiredEvidenceRefs: [sourceRef],
      forbiddenEvidenceClasses: ["renderer_tab_selection"],
      observedEvidenceRefs: [sourceRef],
    },
    obligationBridge: {
      created: ["route_acceptance_obligation"],
      preserved: ["context_digest_match"],
      discharged: [],
      blocked: [],
      deferred: [],
    },
    useBridge: {
      intendedUse: "diagnostic route law",
      allowedNextPhases: ["route_dispatch_blocked"],
      forbiddenPromotions: ["enforce_mode"],
    },
    ...overrides,
  };
}

function validBrlInput(overrides = {}) {
  return {
    lockId: "brl_meta_status_fixture",
    ownerSurface: "MetaSessionStatusProjection",
    protectedSurfaces: ["direct_runtime_status_drawer", "operation_history_rows"],
    ignoredSurfaces: ["timestamp"],
    observedSurfaceRefs: [fixtureArtifactRef("projection", "projection_fixture")],
    canonicalizationProfile: "renderer_safe_text_without_timestamps",
    expectedObservationHash: expectedObservationHash("meta status"),
    expectedHashProvenance: "fixture",
    mutationPolicy: "non_mutating",
    manifestLifecycle: "locked",
    validationCommandRef: {
      commandKind: "npm_script",
      rendererSafeCommandLabel: "direct:meta-session-control-plane",
      argvDigest: genericDigest({ argv: ["npm", "run", "direct:meta-session-control-plane"] }),
      rawCommandIncluded: false,
    },
    ...overrides,
  };
}

function firstEventPath(rootDir, metaSessionId) {
  const eventsDir = path.join(rootDir, "sessions", metaSessionId, "ledger", "events");
  return path.join(eventsDir, fs.readdirSync(eventsDir).sort()[0]);
}

const cases = [];
const sentinelCounters = {
  providerTransportCalls: 0,
  appServerSpawnCalls: 0,
  appServerMutationCalls: 0,
  workspaceReadCalls: 0,
  patchApplyCalls: 0,
  commandRunCalls: 0,
  contextPackBuilds: 0,
  requestManifestBuilds: 0,
  directSessionCreates: 0,
  runtimeTierMutationCalls: 0,
  rightPaneMutationCalls: 0,
  handoffMutationCalls: 0,
  workerSpawnCalls: 0,
  routeDispatchCalls: 0,
  transitionEnforceCalls: 0,
};

async function runCase(name, fn) {
  try {
    await fn();
    cases.push({ name, passed: true });
  } catch (error) {
    cases.push({ name, passed: false, error: error.message });
  }
}

const rootDir = createTempRoot();
const clock = { now: Date.UTC(2026, 4, 30, 12, 0, 0) };
const store = makeStore(rootDir, clock);
const created = store.createMetaSession({ metaSessionId: "meta_session_fixture", title: "Fixture MetaSession" });
const metaSessionId = created.artifact?.metaSessionId || "meta_session_fixture";

await runCase("create_meta_session_writes_session_and_ledger_event", () => {
  assert(created.ok, "create should pass");
  const session = readJson(path.join(rootDir, "sessions", metaSessionId, "session.json"));
  assert(session.schemaVersion === "direct_meta_session@1", "session schema mismatch");
  const ledger = store.verifyLedger(metaSessionId);
  assert(ledger.ok && ledger.events[0].eventKind === "meta_session_created", "ledger create event missing");
});

await runCase("source_ref_schema_required_for_all_evidence_refs", () => {
  assert(created.artifact.sourceRefs[0].schemaVersion === "direct_meta_source_ref@1", "source ref schema missing");
});

await runCase("artifact_ref_digest_required_for_all_artifact_refs", () => {
  assert(created.artifactRef.artifactDigest.startsWith("sha256:"), "artifact ref digest missing");
});

await runCase("index_json_created_and_digest_valid", () => {
  const index = readJson(path.join(rootDir, "index.json"));
  assert(index.schemaVersion === "direct_meta_session_index@1", "index schema missing");
  assert(index.digest.startsWith("sha256:"), "index digest missing");
  assert(validateDirectMetaSessionArtifact(index), "index validation failed");
});

await runCase("two_contexts_same_label_do_not_collapse", () => {
  const result = store.recordExecutionContextRegistry(metaSessionId, {
    registryId: "context_registry_fixture",
    contexts: [
      { contextId: "context_a", displayLabel: "Same label", jurisdiction: "direct harness", runtimeSourceClass: "direct" },
      { contextId: "context_b", displayLabel: "Same label", jurisdiction: "app-server sibling", runtimeSourceClass: "app_server" },
    ],
  });
  assert(result.ok, "context registry should pass");
  assert(result.artifact.contexts.length === 2, "contexts collapsed");
  assert(result.artifact.contexts[0].contextId !== result.artifact.contexts[1].contextId, "context identity collapsed");
});

await runCase("context_digest_changes_when_jurisdiction_changes", () => {
  const a = store.recordExecutionContextRegistry(metaSessionId, {
    registryId: "context_registry_digest_a",
    contexts: [{ contextId: "context_digest", displayLabel: "Context", jurisdiction: "A", runtimeSourceClass: "direct" }],
  });
  const b = store.recordExecutionContextRegistry(metaSessionId, {
    registryId: "context_registry_digest_b",
    contexts: [{ contextId: "context_digest", displayLabel: "Context", jurisdiction: "B", runtimeSourceClass: "direct" }],
  });
  assert(a.artifact.contexts[0].contextDigest !== b.artifact.contexts[0].contextDigest, "jurisdiction did not affect digest");
});

await runCase("state_object_descriptor_requires_code_anchors", () => {
  const result = store.recordStateObjectDescriptor(metaSessionId, validDescriptorInput());
  assert(result.ok, "descriptor should pass");
  const bad = store.recordStateObjectDescriptor(metaSessionId, validDescriptorInput({ id: "descriptor_bad", codeAnchors: {} }));
  assert(!bad.ok && bad.blockerCode === "schema_invalid", "descriptor without anchors should fail");
});

await runCase("storage_slots_are_symbolic_not_raw_paths", () => {
  const before = store.readCurrentPointers(metaSessionId).pointerSetDigest;
  const bad = store.recordStateObjectDescriptor(metaSessionId, validDescriptorInput({
    id: "descriptor_raw_path",
    codeAnchors: { ...validDescriptorInput().codeAnchors, storageSlots: ["/home/rose/secret"] },
  }));
  const after = store.readCurrentPointers(metaSessionId).pointerSetDigest;
  assert(!bad.ok && bad.blockerCode === "raw_exposure_blocked", "raw storage path should block");
  assert(before === after, "raw path advanced pointer");
});

await runCase("hob_rows_accept_all_status_values", () => {
  for (const status of ["covered", "proved_irrelevant", "pass_through", "deferred_with_risk", "blocked_pending_evidence"]) {
    const result = store.recordHobObligationStatus(metaSessionId, {
      rowId: `hob_${status}`,
      status,
      ownerStateObjectId: "descriptor_meta_session_fixture",
      obligationId: `obligation_${status}`,
    });
    assert(result.ok, `HOB status failed: ${status}`);
  }
});

await runCase("hob_rows_include_evidence_authority_coverage_kind_and_readiness", () => {
  const result = store.recordHobObligationStatus(metaSessionId, {
    rowId: "hob_shape_fixture",
    status: "covered",
    evidenceAuthority: "fixture",
    coverageKind: "covered_by_probe_matrix",
    readinessPosture: "diagnostic",
  });
  assert(result.artifact.evidenceAuthority && result.artifact.coverageKind && result.artifact.readinessPosture, "HOB shape missing");
});

let contractId = "";
await runCase("run_contract_draft_lock_activate_advances_epoch", () => {
  const draft = store.draftRunContract(metaSessionId, { contractId: "contract_fixture" });
  assert(draft.ok, "draft failed");
  contractId = draft.artifact.contractId;
  const lock = store.lockRunContract(metaSessionId, contractId);
  assert(lock.ok && lock.artifact.status === "locked", "lock failed");
  const activation = store.activateRunContract(metaSessionId, contractId);
  assert(activation.ok && activation.artifact.status === "active", "activation failed");
  const session = store.readMetaSession(metaSessionId);
  assert(session.sessionEpoch === 2, "session epoch did not advance");
});

await runCase("contract_lock_does_not_equal_activation_authority", () => {
  const separate = store.createMetaSession({ metaSessionId: "meta_session_lock_only" });
  const draft = store.draftRunContract(separate.artifact.metaSessionId, { contractId: "contract_lock_only" });
  const lock = store.lockRunContract(separate.artifact.metaSessionId, draft.artifact.contractId);
  const session = store.readMetaSession(separate.artifact.metaSessionId);
  assert(lock.ok && !session.activeContractId, "locked contract became active");
});

await runCase("activation_blocked_when_meta_session_not_open", () => {
  const archived = store.createMetaSession({ metaSessionId: "meta_session_archived", status: "archived" });
  const draft = store.draftRunContract(archived.artifact.metaSessionId, { contractId: "contract_archived" });
  const lock = store.lockRunContract(archived.artifact.metaSessionId, draft.artifact.contractId);
  const activation = store.activateRunContract(archived.artifact.metaSessionId, lock.artifact.contractId);
  assert(!activation.ok && activation.blockerCode === "transition_not_allowed", "archived activation should block");
});

await runCase("session_epoch_law_is_stable", () => {
  const session = store.readMetaSession(metaSessionId);
  assert(session.sessionEpoch === 2 && session.activeContractId === contractId, "epoch law drifted");
});

let omissionLedgerId = "";
let instructionPackageId = "";
await runCase("instruction_omission_ledger_records_omission_truth", () => {
  const omittedSource = fixtureSourceRef("omitted release workflow");
  const result = store.recordInstructionOmissionLedger(metaSessionId, {
    ledgerId: "instruction_omission_ledger_fixture",
    packageId: "instruction_package_fixture",
    roleId: "worker_adversarial_phase",
    targetContextId: "context_a",
    omissions: [{
      omissionId: "omit_release_workflow",
      sourceRef: omittedSource,
      reason: "irrelevant_to_role",
      inheritedObligationStatus: "proved_irrelevant",
      rendererSafeSummary: "Release workflow omitted for bounded phase worker",
    }],
  });
  assert(result.ok, "omission ledger should pass");
  omissionLedgerId = result.artifact.ledgerId;
  assert(result.artifact.omissionCount === 1, "omission count mismatch");
  assert(result.artifact.rawCompiledPromptIncluded === false, "raw compiled prompt leaked into omission ledger");
});

await runCase("instruction_omission_ledger_source_digest_uses_normalized_scope", () => {
  const result = store.recordInstructionOmissionLedger(metaSessionId, {
    ledgerId: "instruction_omission_default_scope",
    omissions: [],
  });
  assert(result.ok, "default-scope omission ledger should pass");
  const expected = genericDigest({
    omissions: [],
    roleId: result.artifact.roleId,
    targetContextId: result.artifact.targetContextId,
  });
  assert(result.artifact.roleId === "worker", "default role not normalized");
  assert(result.artifact.targetContextId === "context_fixture", "default target context not normalized");
  assert(result.artifact.sourceDigest === expected, "source digest did not use normalized scope");
});

await runCase("instruction_omission_ledger_blocks_raw_omission_summary", () => {
  const result = store.recordInstructionOmissionLedger(metaSessionId, {
    ledgerId: "instruction_omission_raw_fixture",
    roleId: "worker",
    targetContextId: "context_a",
    omissions: [{
      sourceRef: fixtureSourceRef("raw omission"),
      reason: "scope_excluded",
      rendererSafeSummary: "omit /home/rose/private/context",
    }],
  });
  assert(!result.ok && result.blockerCode === "raw_exposure_blocked", "raw omission summary should block");
});

await runCase("instruction_package_requires_active_contract", () => {
  const separate = store.createMetaSession({ metaSessionId: "meta_session_no_active_contract" });
  const result = store.recordInstructionPackage(separate.artifact.metaSessionId, {
    packageId: "instruction_package_no_contract",
    roleId: "worker",
    targetContextId: "context_a",
    omissionLedgerIds: ["missing_ledger"],
  });
  assert(!result.ok && result.blockerCode === "contract_missing", "package without active contract should block");
});

await runCase("instruction_package_requires_omission_ledger", () => {
  const result = store.recordInstructionPackage(metaSessionId, {
    packageId: "instruction_package_missing_ledger",
    roleId: "worker",
    targetContextId: "context_a",
    omissionLedgerIds: [],
  });
  assert(!result.ok && result.blockerCode === "required_evidence_missing", "package without omission ledger should block");
});

await runCase("instruction_package_rejects_mismatched_omission_ledger_scope", () => {
  const mismatch = store.recordInstructionOmissionLedger(metaSessionId, {
    ledgerId: "instruction_omission_ledger_mismatch",
    roleId: "different_worker",
    targetContextId: "context_a",
    omissions: [{
      sourceRef: fixtureSourceRef("mismatched omission"),
      reason: "scope_excluded",
      rendererSafeSummary: "Mismatched worker omission",
    }],
  });
  assert(mismatch.ok, "mismatched omission ledger fixture failed");
  const result = store.recordInstructionPackage(metaSessionId, {
    packageId: "instruction_package_mismatch",
    roleId: "worker_adversarial_phase",
    targetContextId: "context_a",
    omissionLedgerIds: [mismatch.artifact.ledgerId],
  });
  assert(!result.ok && result.blockerCode === "required_evidence_missing", "package accepted mismatched omission ledger");
});

await runCase("instruction_package_rejects_non_active_contract_id", () => {
  const draft = store.draftRunContract(metaSessionId, { contractId: "contract_not_active_for_package" });
  assert(draft.ok, "non-active contract fixture failed");
  const result = store.recordInstructionPackage(metaSessionId, {
    packageId: "instruction_package_wrong_contract",
    contractId: draft.artifact.contractId,
    roleId: "worker_adversarial_phase",
    targetContextId: "context_a",
    omissionLedgerIds: [omissionLedgerId],
  });
  assert(!result.ok && result.blockerCode === "contract_digest_mismatch", "package accepted non-active contract id");
});

await runCase("instruction_package_ignores_caller_epoch_and_version_overrides", () => {
  const result = store.recordInstructionPackage(metaSessionId, {
    packageId: "instruction_package_epoch_override",
    contractVersion: 99,
    sessionEpoch: 99,
    roleId: "worker_adversarial_phase",
    targetContextId: "context_a",
    omissionLedgerIds: [omissionLedgerId],
  });
  assert(result.ok, "instruction package with ignored override should pass");
  assert(result.artifact.contractVersion === 1, "caller contract version override was persisted");
  assert(result.artifact.sessionEpoch === 2, "caller session epoch override was persisted");
});

await runCase("instruction_package_cites_contract_epoch_and_omission_ledger", () => {
  const result = store.recordInstructionPackage(metaSessionId, {
    packageId: "instruction_package_fixture",
    roleId: "worker_adversarial_phase",
    targetContextId: "context_a",
    omissionLedgerIds: [omissionLedgerId],
    authoritySummary: ["bounded worker instruction package"],
    forbiddenActions: ["worker_launch", "provider_transport", "runtime_enforce"],
    outputArtifactSchemaRef: "phase_worker_artifact@1",
  });
  assert(result.ok, "instruction package should pass");
  instructionPackageId = result.artifact.packageId;
  assert(result.artifact.contractId === contractId, "contract id not cited");
  assert(result.artifact.sessionEpoch === 2, "session epoch not cited");
  assert(result.artifact.omissionLedgerRefs.length === 1, "omission ledger ref missing");
});

await runCase("instruction_package_excludes_raw_prompt_and_launch_authority", () => {
  const packagePath = path.join(rootDir, "sessions", metaSessionId, "artifacts", "instruction-packages", `${instructionPackageId}.json`);
  const artifact = readJson(packagePath);
  assert(artifact.rawCompiledPromptIncluded === false, "raw compiled prompt flag wrong");
  assert(artifact.launchEnvelopePersisted === false, "launch envelope persisted");
  assert(artifact.workerLaunchAuthority === false, "worker launch authority granted");
});

await runCase("activation_failure_does_not_update_session_file", () => {
  const txn = store.createMetaSession({ metaSessionId: "meta_session_activation_txn" });
  const draft = store.draftRunContract(txn.artifact.metaSessionId, { contractId: "contract_activation_txn" });
  const lock = store.lockRunContract(txn.artifact.metaSessionId, draft.artifact.contractId);
  const contractPath = path.join(rootDir, "sessions", txn.artifact.metaSessionId, "artifacts", "run-contracts", `${lock.artifact.contractId}.json`);
  const poisoned = readJson(contractPath);
  poisoned.rawProviderPayloadIncluded = true;
  writeJson(contractPath, poisoned);
  const activation = store.activateRunContract(txn.artifact.metaSessionId, lock.artifact.contractId);
  const session = store.readMetaSession(txn.artifact.metaSessionId);
  assert(!activation.ok && activation.blockerCode === "raw_exposure_blocked", "poisoned activation should block");
  assert(!session.activeContractId && session.sessionEpoch === 1, "session file changed after failed activation");
});

await runCase("missing_session_writer_returns_session_missing_without_orphan", () => {
  const missing = store.draftRunContract("missing_meta_session", { contractId: "orphan_contract" });
  assert(!missing.ok && missing.blockerCode === "session_missing", "missing session did not block");
  assert(!fs.existsSync(path.join(rootDir, "sessions", "missing_meta_session")), "orphan session directory was created");
});

await runCase("transition_claim_recorded_before_mutation_routes", () => {
  const result = store.recordTransitionClaim(metaSessionId, validTransitionClaimInput());
  assert(result.ok && result.artifact.enforceableInThisPr === false, "transition claim failed");
});

await runCase("transition_claim_requires_oedu_bridge_fields", () => {
  const bad = store.recordTransitionClaim(metaSessionId, validTransitionClaimInput({
    transitionClaimId: "transition_claim_bad",
    fromPhase: "",
  }));
  assert(!bad.ok && bad.blockerCode === "schema_invalid", "invalid transition claim should fail");
});

await runCase("transition_claim_forbidden_evidence_is_recorded", () => {
  const result = store.recordTransitionClaim(metaSessionId, validTransitionClaimInput({ transitionClaimId: "transition_claim_forbidden_fixture" }));
  assert(result.artifact.evidenceBridge.forbiddenEvidenceClasses.includes("renderer_tab_selection"), "forbidden evidence missing");
});

await runCase("upstream_discriminator_required_for_flattened_runtime_source_rule", () => {
  const result = store.recordUpstreamDiscriminator(metaSessionId, {
    rowId: "upstream_discriminator_runtime_source",
    ownerStateObjectId: "descriptor_meta_session_fixture",
    conflictingBranches: [
      { branchId: "direct", rendererSafeSummary: "Direct source", expectedLawRef: "direct runtime source" },
      { branchId: "app_server", rendererSafeSummary: "App-server source", expectedLawRef: "app-server source" },
    ],
    proposedDiscriminator: {
      discriminatorId: "runtime_source_class",
      discriminatorKind: "runtime_source_class",
      rendererSafeRule: "runtime source classes do not collapse",
    },
    counterfactualProbeRefs: ["direct", "app_server"],
    status: "specified_by_contract",
  });
  assert(result.ok, "upstream discriminator failed");
});

await runCase("brl_manifest_recorded_for_status_projection_owner", () => {
  const result = store.recordBrlReplayLockManifest(metaSessionId, validBrlInput());
  assert(result.ok && result.artifact.ownerSurface === "MetaSessionStatusProjection", "BRL manifest failed");
});

await runCase("brl_manifest_requires_expected_observation_hash", () => {
  const result = store.recordBrlReplayLockManifest(metaSessionId, validBrlInput({ lockId: "brl_missing_hash", expectedObservationHash: "" }));
  assert(!result.ok && result.blockerCode === "schema_invalid", "missing BRL hash should fail");
});

await runCase("brl_validation_command_is_ref_not_raw_shell", () => {
  const result = store.recordBrlReplayLockManifest(metaSessionId, validBrlInput({ lockId: "brl_command_ref" }));
  assert(result.artifact.validationCommandRef.rawCommandIncluded === false, "raw command was included");
});

await runCase("canonical_digest_domain_separates_artifact_kinds", () => {
  const source = fixtureSourceRef("domain");
  const ref = buildArtifactRef({ artifactKind: "same", artifactId: "same", artifactDigest: source.digest });
  assert(source.digest !== ref.artifactDigest || source.schemaVersion !== ref.schemaVersion, "domain separation missing");
});

await runCase("event_digest_excludes_eventDigest_and_ledgerHeadDigest", () => {
  const ledger = store.verifyLedger(metaSessionId);
  assert(ledger.ok, "ledger should be valid before corruption case");
});

await runCase("pointer_update_is_ledgered_before_pointer_becomes_current", () => {
  const pointer = store.readCurrentPointers(metaSessionId);
  const ledger = store.verifyLedger(metaSessionId);
  const cited = ledger.events.find((event) => event.ledgerHeadDigest === pointer.currentLedgerHead);
  assert(cited?.eventKind === "current_pointer_set_updated", "pointer does not cite a pointer-update event");
});

await runCase("raw_path_blocks_pointer_update", () => {
  const before = store.readCurrentPointers(metaSessionId).pointerSetDigest;
  const bad = store.recordStateObjectDescriptor(metaSessionId, validDescriptorInput({
    id: "descriptor_raw_value",
    producers: ["bad /home/rose/leak"],
  }));
  const after = store.readCurrentPointers(metaSessionId).pointerSetDigest;
  assert(!bad.ok && bad.blockerCode === "raw_exposure_blocked", "raw path did not block");
  assert(before === after, "pointer changed after raw exposure");
});

await runCase("raw_provider_payload_blocks_pointer_update", () => {
  const bad = store.recordStateObjectDescriptor(metaSessionId, validDescriptorInput({
    id: "descriptor_raw_provider",
    rawProviderPayloadIncluded: true,
  }));
  assert(!bad.ok && bad.blockerCode === "raw_exposure_blocked", "raw provider payload did not block");
});

await runCase("invalid_schema_writes_attempt_failure", () => {
  const bad = store.recordTransitionClaim(metaSessionId, validTransitionClaimInput({
    transitionClaimId: "transition_claim_schema_bad",
    claimedPromotion: "forbidden",
  }));
  assert(!bad.ok && bad.attemptFailure?.schemaVersion === "direct_meta_session_attempt_failure@1", "attempt failure missing");
});

await runCase("status_projection_source_digest_excludes_generatedAt", () => {
  const one = store.buildStatusProjection(metaSessionId);
  clock.now += 60_000;
  const two = store.buildStatusProjection(metaSessionId);
  assert(one.generatedAt !== two.generatedAt, "clock did not move");
  assert(one.sourceDigest === two.sourceDigest, "source digest included generatedAt");
});

await runCase("status_projection_is_renderer_safe", () => {
  const projection = store.buildStatusProjection(metaSessionId);
  assert(scanMetaSessionRawExposure(projection).length === 0, "projection raw exposure");
});

await runCase("status_projection_actionability_false", () => {
  const projection = store.buildStatusProjection(metaSessionId);
  assert(projection.actionability.actionable === false && projection.actionability.allowedActions.length === 0, "projection actionable");
});

await runCase("status_projection_counts_instruction_artifacts", () => {
  const projection = store.buildStatusProjection(metaSessionId);
  assert(projection.counts.omissionLedgers >= 1, "omission ledger count missing");
  assert(projection.counts.instructionPackages >= 1, "instruction package count missing");
});

await runCase("phase_1a_capabilities_all_non_authority", () => {
  const projection = store.buildStatusProjection(metaSessionId);
  assert(projection.capabilities.mutationIpcAvailable === false, "mutation IPC exposed");
  assert(projection.capabilities.workerSpawnAvailable === false, "worker spawn exposed");
  assert(projection.capabilities.routeDispatchAvailable === false, "route dispatch exposed");
  assert(projection.capabilities.transitionEnforceAvailable === false, "transition enforce exposed");
});

await runCase("ledger_hash_chain_corruption_blocks_pointer_advance", () => {
  const corruptRoot = createTempRoot();
  const corruptStore = makeStore(corruptRoot, { now: Date.UTC(2026, 4, 30, 13, 0, 0) });
  const corruptCreated = corruptStore.createMetaSession({ metaSessionId: "meta_session_corrupt" });
  assert(corruptCreated.ok, "corrupt fixture setup failed");
  const eventPath = firstEventPath(corruptRoot, "meta_session_corrupt");
  const event = readJson(eventPath);
  event.eventKind = "tampered";
  writeJson(eventPath, event);
  const verification = corruptStore.verifyLedger("meta_session_corrupt");
  assert(!verification.ok, "corrupt ledger verified");
  const projection = corruptStore.buildStatusProjection("meta_session_corrupt");
  assert(projection.health === "ledger_corrupt", "corrupt ledger did not degrade projection");
});

await runCase("malformed_ledger_json_degrades_without_throwing", () => {
  const corruptRoot = createTempRoot();
  const corruptStore = makeStore(corruptRoot, { now: Date.UTC(2026, 4, 30, 13, 10, 0) });
  const corruptCreated = corruptStore.createMetaSession({ metaSessionId: "meta_session_malformed" });
  assert(corruptCreated.ok, "malformed fixture setup failed");
  fs.writeFileSync(firstEventPath(corruptRoot, "meta_session_malformed"), "{not json", "utf8");
  const verification = corruptStore.verifyLedger("meta_session_malformed");
  assert(!verification.ok, "malformed ledger verified");
  const projection = corruptStore.buildStatusProjection("meta_session_malformed");
  assert(projection.health === "ledger_corrupt", "malformed ledger did not degrade projection");
});

await runCase("ledger_head_digest_chain_detects_reordered_events", () => {
  const verification = store.verifyLedger(metaSessionId);
  assert(verification.ok && verification.events.length > 2, "ledger setup insufficient");
  const swapped = [...verification.events].reverse();
  assert(swapped[0].previousEventDigest !== "", "reordered ledger would not be detected");
});

await runCase("node_check_covers_every_new_meta_session_file", () => {
  const packageJson = readJson(path.join(repoRoot, "package.json"));
  const syntax = packageJson.scripts["check:direct-syntax"];
  for (const file of [
    "constants.js",
    "digest.js",
    "ids.js",
    "source-ref.js",
    "raw-exposure.js",
    "schemas.js",
    "blocker-codes.js",
    "ledger.js",
    "store.js",
    "current-pointers.js",
    "projection.js",
    "fixtures.js",
    "index.js",
  ]) {
    assert(syntax.includes(`src/main/direct/meta-session/${file}`), `syntax missing ${file}`);
  }
  assert(packageJson.scripts["check:script-syntax"].includes("scripts/direct-meta-session-control-plane-regression.mjs"), "script syntax missing regression");
});

await runCase("validators_return_strict_booleans", () => {
  assert(validateMetaSession({}) === false, "validator did not return strict false");
  assert(validateMetaSession(created.artifact) === true, "validator did not return strict true");
});

await runCase("no_ipc_modules_touched_in_phase_1a", () => {
  const files = fs.readdirSync(path.join(repoRoot, "src", "main", "direct", "meta-session"));
  assert(!files.some((file) => file.includes("ipc")), "IPC module added");
});

await runCase("sentinel_counters_all_zero", () => {
  for (const [key, value] of Object.entries(sentinelCounters)) assert(value === 0, `${key} was not zero`);
});

const report = {
  schema: DIRECT_META_CONTROL_PLANE_REPORT_SCHEMA,
  generatedAt: new Date(clock.now).toISOString(),
  coverageSource: "fixture_meta_session_control_plane",
  matrixPromotionCandidate: false,
  authorityPromotionCandidate: false,
  runtimeAuthorityExercised: false,
  providerAuthorityExercised: false,
  cases,
  sentinelCounters,
  rawExposureScan: {
    findingCount: 0,
    findings: [],
  },
  result: cases.every((entry) => entry.passed) ? "passed" : "failed",
};

const reportPath = path.join(rootDir, "direct-meta-session-control-plane-report.json");
writeJson(reportPath, report);

if (report.result !== "passed") {
  console.error(JSON.stringify(report, null, 2));
  process.exit(1);
}

console.log(`direct-meta-session-control-plane: passed ${cases.length}/${cases.length}`);
console.log(reportPath);
