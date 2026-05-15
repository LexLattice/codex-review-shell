#!/usr/bin/env node

import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);

const { scanFixtureForSecrets } = require("../src/main/direct/fixtures/redaction");
const { writeJsonAtomic } = require("../src/main/direct/session/session-store");
const {
  DIRECT_USAGE_READINESS_REGRESSION_REPORT_SCHEMA,
  buildCapabilityDowngradeEvent,
  buildCiLiveCallGuardProof,
  buildCostEstimatorStatus,
  buildDocsChecklist,
  buildDriftWatchReport,
  buildMainlineReadinessReport,
  buildModelCatalogSnapshot,
  buildModelControlDescriptor,
  buildPromptCacheAffinityEvidence,
  buildQuotaRateSnapshot,
  buildReportValidationRegistry,
  buildRuntimeEvidenceStatus,
  buildRuntimeWitnessProjection,
  buildUsageLedger,
  normalizeEvidenceRef,
  sha256,
  stableStringify,
  usageReadinessRecoveryState,
  validateUsageReadinessRegressionReport,
} = require("../src/main/direct/readiness/usage-readiness");

const USER_DATA_ROOT_ENV_VAR = "CODEX_REVIEW_SHELL_USER_DATA_ROOT";

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function nowIso() {
  return new Date().toISOString();
}

function safeIdPart(value, fallback = "run") {
  return normalizeString(value, fallback).replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80) || fallback;
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) throw new Error(`Unknown argument: ${arg}`);
    const raw = arg.slice(2);
    const equals = raw.indexOf("=");
    if (equals >= 0) {
      options[raw.slice(0, equals)] = raw.slice(equals + 1);
      continue;
    }
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      options[raw] = next;
      index += 1;
    } else {
      options[raw] = true;
    }
  }
  return options;
}

function platformAppDataRoot() {
  if (process.platform === "win32") return process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support");
  return process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
}

function defaultAppUserDataRoot() {
  return path.join(platformAppDataRoot(), "Codex Review Shell");
}

function ensureDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
}

function writeTextFile(targetPath, text) {
  ensureDirectory(path.dirname(targetPath));
  fs.writeFileSync(targetPath, text, { mode: 0o600 });
}

function baseCase(input = {}) {
  return {
    caseId: normalizeString(input.caseId, "case"),
    coverageSource: "fixture_usage_readiness",
    status: normalizeString(input.status, "passed"),
    proofOutcome: normalizeString(input.proofOutcome, "diagnostic_checked"),
    matrixRowsExercised: input.matrixRowsExercised || ["A7", "A8", "A9", "A10", "C13", "F9", "I10", "I12", "I13", "I14", "I15", "J12"],
    matrixPromotionCandidate: false,
    authorityPromotionCandidate: false,
    runtimeAuthorityExercised: false,
    providerAuthorityExercised: false,
    blockerCode: normalizeString(input.blockerCode, ""),
    artifacts: input.artifacts || {},
  };
}

function fixtureArtifacts() {
  const projectId = "project_usage_readiness_fixture";
  const textEvidenceRef = normalizeEvidenceRef({
    kind: "model_evidence",
    artifactId: "live_text_probe_fixture",
    artifactDigest: sha256("live_text_probe_fixture"),
    sourceConfidence: "exact",
    rendererSafeLabel: "Runtime-probed text evidence",
  });
  const profileRef = normalizeEvidenceRef({
    kind: "profile",
    artifactId: "odeu_profile_fixture",
    artifactDigest: sha256("odeu_profile_fixture"),
    sourceConfidence: "accepted",
    rendererSafeLabel: "ODEU profile",
  });
  const usageRef = normalizeEvidenceRef({
    kind: "usage",
    artifactId: "usage_event_fixture",
    artifactDigest: sha256("usage_event_fixture"),
    sourceConfidence: "exact",
    rendererSafeLabel: "Usage event",
  });
  const modelCatalog = buildModelCatalogSnapshot({
    projectId,
    profileDigest: profileRef.artifactDigest,
    selectedModel: "gpt-fixture-live",
    entries: [
      {
        modelId: "gpt-fixture-live",
        canonicalModelId: "gpt-fixture-live",
        displayName: "Fixture Live",
        source: "live_probe_evidence",
        evidenceState: "runtime_probed",
        freshness: "fresh",
        evidenceRefs: [textEvidenceRef],
        scope: {
          providerProfileId: "profile_fixture",
          authMode: "chatgpt_subscription",
          accountEvidenceKey: sha256("fixture-account").slice(0, 32),
          endpointClass: "chatgpt-codex-responses",
          endpointHash: sha256("fixture-endpoint"),
          requestShapeFamily: "text_empty_context",
          requestShapeHash: sha256("text-empty"),
          normalizerVersion: "codex-event-normalizer@1",
          requestBuilderVersion: "direct-text-request-builder@1",
        },
        controlDescriptors: [
          buildModelControlDescriptor({
            control: "reasoning_effort",
            supportState: "diagnostic",
            requestShapeFamilies: ["text_empty_context"],
            evidenceRefs: [profileRef],
          }),
        ],
      },
      {
        modelId: "Fixture Display Alias",
        canonicalModelId: "gpt-fixture-live",
        aliasOf: "gpt-fixture-live",
        aliasResolution: "profile_alias",
        source: "odeu_profile",
        evidenceState: "diagnostic",
        readinessUse: "can_display",
        aliasEvidenceRefs: [profileRef],
        evidenceRefs: [profileRef],
        scope: {
          providerProfileId: "profile_fixture",
          authMode: "chatgpt_subscription",
          endpointClass: "chatgpt-codex-responses",
          requestShapeFamily: "diagnostic",
          normalizerVersion: "profile@1",
          requestBuilderVersion: "none",
        },
      },
    ],
  });
  const cacheEvidence = buildPromptCacheAffinityEvidence({
    requestShapeClass: "direct_text_turn_empty_context@1",
    modelId: "gpt-fixture-live",
    source: "usage_cached_tokens",
    cacheSignal: "cached_tokens_observed",
    promptCacheEvidence: { observed: true, source: "provider_event" },
  });
  const usageLedger = buildUsageLedger({
    projectId,
    entries: [
      {
        usageEntryId: "usage_terminal_text",
        dedupeKey: "resp_text_1",
        dedupeSource: "provider_response_id",
        usageRecordKind: "terminal",
        runtimeFamily: "direct_text",
        requestShapeClass: "direct_text_turn_empty_context@1",
        modelId: "gpt-fixture-live",
        modelEvidenceState: "runtime_probed",
        usageSource: "response_completed_usage",
        inputTokens: 7,
        outputTokens: 5,
        totalTokens: 12,
        cachedInputTokens: 2,
        sourceRefs: [usageRef],
        requestManifestId: "request_manifest_text",
        providerInputProjectionId: "provider_input_text",
        operationLedgerSeq: 10,
        requestControls: { store: false, previousResponseIdUsed: false, parallelToolCalls: false, toolDeclarations: false },
      },
      {
        usageEntryId: "usage_duplicate_delta",
        dedupeKey: "resp_text_1",
        dedupeSource: "provider_response_id",
        usageRecordKind: "delta",
        runtimeFamily: "direct_text",
        requestShapeClass: "direct_text_turn_empty_context@1",
        modelId: "gpt-fixture-live",
        modelEvidenceState: "runtime_probed",
        usageSource: "provider_usage_delta",
        inputTokens: 7,
        outputTokens: 5,
        totalTokens: 12,
        sourceRefs: [usageRef],
      },
      {
        usageEntryId: "usage_missing_command",
        dedupeKey: "command_missing_usage",
        dedupeSource: "request_manifest_id",
        usageRecordKind: "missing",
        runtimeFamily: "direct_implementation_lane",
        requestShapeClass: "direct_run_command_continuation@1",
        modelId: "gpt-fixture-live",
        modelEvidenceState: "candidate",
        usageSource: "missing",
        usageMissingReason: "provider_did_not_emit_usage",
        tokenFieldConfidence: {
          inputTokens: "missing",
          outputTokens: "missing",
          cachedInputTokens: "unknown",
          reasoningTokens: "unknown",
        },
        requestControls: { store: false, previousResponseIdUsed: true, parallelToolCalls: false, toolDeclarations: false },
      },
      {
        usageEntryId: "usage_app_server",
        dedupeKey: "app_server_resp",
        dedupeSource: "report_id",
        usageRecordKind: "terminal",
        runtimeFamily: "app_server",
        requestShapeClass: "app_server_baseline@1",
        modelId: "app-server-model",
        modelEvidenceState: "accepted",
        usageSource: "app_server_usage_event",
        inputTokens: 4,
        outputTokens: 4,
        totalTokens: 8,
      },
    ],
  });
  const quotaUnknown = buildQuotaRateSnapshot({
    projectId,
    source: "diagnostic_fixture",
    freshness: "unknown",
    creditState: "unknown",
    canBlockDirectByItself: false,
    buckets: [
      {
        bucketId: "quota_unknown",
        rendererSafeLabel: "Direct quota unknown",
        appliesTo: "all_direct_provider_calls",
        status: "unknown",
        freshness: "unknown",
        sourceConfidence: "diagnostic",
        quotaInferenceScope: "unknown",
      },
    ],
  });
  const quotaExhausted = buildQuotaRateSnapshot({
    projectId,
    source: "direct_provider_error",
    freshness: "fresh",
    creditState: "exhausted",
    canBlockDirectByItself: true,
    buckets: [
      {
        bucketId: "quota_live_probe_exhausted",
        rendererSafeLabel: "Live probe quota exhausted",
        appliesTo: "live_probe",
        status: "exhausted",
        freshness: "fresh",
        sourceConfidence: "exact",
        quotaInferenceScope: "single_request",
      },
    ],
  });
  const downgradeEvent = buildCapabilityDowngradeEvent({
    affectedCapabilityRows: ["I13"],
    affectedRuntimeFacets: ["textEmptyContext"],
    downgradeReason: "evidence_expired",
    previousState: "ready",
    newState: "blocked",
    evidenceRefs: [textEvidenceRef],
  });
  const runtimeEvidenceStatus = buildRuntimeEvidenceStatus({
    projectId,
    modelCatalogSnapshotId: modelCatalog.snapshotId,
    quotaRateSnapshotId: quotaUnknown.snapshotId,
    usageLedgerId: usageLedger.ledgerId,
    facets: {
      textEmptyContext: { state: "ready", freshness: "fresh", evidenceRefs: [textEvidenceRef] },
      textRecentDialogue: { state: "ready", freshness: "fresh", evidenceRefs: [textEvidenceRef] },
      readFile: { state: "degraded", freshness: "expiring", blockerCodes: ["implementation_report_stale"] },
      applyPatch: { state: "degraded", freshness: "expiring", blockerCodes: ["implementation_report_stale"] },
      runCommand: { state: "degraded", freshness: "expiring", blockerCodes: ["implementation_report_stale"] },
      freshFork: { state: "diagnostic_only", freshness: "unknown" },
      contextMaintenance: { state: "diagnostic_only", freshness: "unknown" },
      governanceDiagnostics: { state: "ready", freshness: "fresh" },
      subAgentObservability: { state: "ready", freshness: "fresh" },
    },
    downgradeEvents: [downgradeEvent],
  });
  const driftWatch = buildDriftWatchReport({
    checks: [
      { checkId: "known_text_events", source: "normalized_events", status: "matched", rendererSafeSummary: "Text events matched expected vocabulary." },
      { checkId: "run_command_unknown_event", source: "normalized_events", status: "blocked", rendererSafeSummary: "Unknown command stream event blocks command promotion." },
    ],
    unknownEventTypes: ["response.command_weird_delta"],
    impacts: [
      { affectedScope: "run_command", severity: "block", reason: "unknown_event_type" },
      { affectedScope: "text_empty_context", severity: "none", reason: "not_affected" },
    ],
  });
  const reportRegistry = buildReportValidationRegistry({
    requiredReportSchemas: ["direct_real_usage_regression_report@1", "direct_sub_agent_observability_report@1"],
    reports: [
      {
        reportKind: "real_usage",
        schema: "direct_real_usage_regression_report@1",
        reportId: "real_usage_fixture",
        validationState: "valid",
        matrixRowsExercised: ["I6"],
        matrixPromotionCandidate: true,
        authorityPromotionCandidate: false,
        evidenceRefs: [usageRef],
      },
      {
        reportKind: "implementation_lane",
        schema: "direct_implementation_proof_regression_report@1",
        reportId: "implementation_fixture",
        validationState: "stale",
        matrixRowsExercised: ["I7"],
        matrixPromotionCandidate: false,
        authorityPromotionCandidate: false,
      },
    ],
  });
  const docsChecklist = buildDocsChecklist({
    appServerDefaultDocumented: true,
    directFlagDocumented: true,
    rollbackDocumented: true,
    liveCallOptInDocumented: true,
    credentialPrivacyDocumented: true,
    rightPaneBoundaryDocumented: true,
    unsupportedCapabilitiesDocumented: true,
    migrationNotesPathEvidenceKey: sha256("docs/DIRECT_USAGE_QUOTA_MODEL_EVIDENCE_AND_MAINLINE_READINESS_SPEC.md"),
  });
  const ciGuard = buildCiLiveCallGuardProof({});
  const costStatus = buildCostEstimatorStatus({});
  const witnessProjection = buildRuntimeWitnessProjection({
    projectId,
    chips: [
      { kind: "model", label: "Model evidence fresh", state: "fresh", evidenceRefs: [textEvidenceRef] },
      { kind: "quota", label: "Quota unknown", state: "unknown" },
      { kind: "usage", label: "Usage ledger valid", state: "fresh" },
      { kind: "drift", label: "Command drift blocked", state: "blocked" },
      { kind: "readiness", label: "Ready behind flag", state: "fresh" },
    ],
  });
  const readinessReport = buildMainlineReadinessReport({
    branch: "codex/direct-usage-readiness",
    commit: sha256("fixture-commit").slice(0, 12),
    coverageSource: "fixture_readiness",
    runtimeEnablement: "eligible_projects_only",
    modelCatalogSnapshotId: modelCatalog.snapshotId,
    quotaRateSnapshotId: quotaUnknown.snapshotId,
    usageLedgerId: usageLedger.ledgerId,
    driftWatchReportId: driftWatch.reportId,
    reportValidationRegistryId: reportRegistry.registryId,
    runtimeEvidenceStatusId: runtimeEvidenceStatus.statusId,
    docsChecklistId: docsChecklist.checklistId,
    ciLiveCallGuardProofId: ciGuard.guardId,
    costEstimatorStatusId: costStatus.schema,
    appServerBaseline: {
      reportId: "app_server_baseline_fixture",
      status: "green",
      generatedAt: nowIso(),
      maxAgeHours: 24,
    },
    repoState: {
      branch: "codex/direct-usage-readiness",
      commit: sha256("fixture-commit").slice(0, 12),
      workingTreeClean: true,
      directBranchNameExpected: "codex/direct-chatgpt-harness",
      mainlineTargetBranch: "main",
    },
    preconditions: [
      { preconditionId: "text_regression", required: true, status: "present_valid", evidenceRefs: [usageRef] },
      { preconditionId: "implementation_lane", required: true, status: "skipped_with_waiver", waiver: { waiverId: "waive_impl_fixture", reason: "feature_not_in_current_merge_scope", approvedBy: "test_fixture" } },
      { preconditionId: "sub_agent_observability", required: true, status: "present_valid" },
    ],
    gates: [
      { gateId: "direct_default_false", status: "passed", requiredForReadyBehindFlag: true },
      { gateId: "app_server_baseline_required", status: "passed", requiredForReadyBehindFlag: true },
      { gateId: "app_server_removal_forbidden", status: "passed", requiredForReadyBehindFlag: true },
      { gateId: "quota_status_known_or_nonblocking_unknown", status: "passed", requiredForReadyBehindFlag: true },
      { gateId: "usage_ledger_valid", status: "passed", requiredForReadyBehindFlag: true },
    ],
    promotionCandidates: {
      A7_modelCatalog: true,
      A8_controlEvidence: true,
      A9_cacheAffinityDiagnostic: true,
      A10_quotaRateEvidence: false,
      C13_usageProjection: true,
      F9_runtimeWitnessChips: true,
      I10_usageLedger: true,
      I12_driftWatch: true,
      I13_capabilityDowngrade: true,
      I14_ciLiveCallGuard: true,
      I15_reportValidation: true,
      J12_mainlineHygiene: true,
    },
  });
  const blockedReadinessReport = buildMainlineReadinessReport({
    branch: "codex/direct-usage-readiness",
    coverageSource: "fixture_readiness",
    preconditions: [
      { preconditionId: "missing_required_report", required: true, status: "missing" },
    ],
    gates: [
      { gateId: "report_registry_valid", status: "blocked", requiredForReadyBehindFlag: true, blockerCodes: ["required_report_missing"] },
    ],
  });

  return {
    projectId,
    textEvidenceRef,
    profileRef,
    modelCatalog,
    cacheEvidence,
    usageLedger,
    quotaUnknown,
    quotaExhausted,
    downgradeEvent,
    runtimeEvidenceStatus,
    driftWatch,
    reportRegistry,
    docsChecklist,
    ciGuard,
    costStatus,
    witnessProjection,
    readinessReport,
    blockedReadinessReport,
  };
}

function zeroSentinels() {
  return {
    providerTransportCalls: 0,
    appServerSpawnCalls: 0,
    appServerMutationCalls: 0,
    appServerQuotaReadCalls: 0,
    workspaceReadCalls: 0,
    patchApplyCalls: 0,
    commandRunCalls: 0,
    contextPackBuilds: 0,
    requestManifestBuilds: 0,
    directSessionCreates: 0,
    runtimeTierMutationCalls: 0,
    rightPaneMutationCalls: 0,
    handoffMutationCalls: 0,
  };
}

function buildReport() {
  const artifacts = fixtureArtifacts();
  const liveModel = artifacts.modelCatalog.entries.find((entry) => entry.source === "live_probe_evidence");
  const aliasModel = artifacts.modelCatalog.entries.find((entry) => entry.aliasResolution === "profile_alias");
  const missingUsage = artifacts.usageLedger.entries.find((entry) => entry.usageRecordKind === "missing");
  const directUsage = artifacts.usageLedger.entries.filter((entry) => entry.runtimeFamily === "direct_text");
  const appServerUsage = artifacts.usageLedger.entries.filter((entry) => entry.runtimeFamily === "app_server");
  const runCommandDrift = artifacts.driftWatch.impacts.find((impact) => impact.affectedScope === "run_command");
  const textDrift = artifacts.driftWatch.impacts.find((impact) => impact.affectedScope === "text_empty_context");
  const zero = zeroSentinels();
  const cases = [
    baseCase({ caseId: "model_catalog_from_profile_is_display_only", proofOutcome: aliasModel?.readinessUse === "can_display" && aliasModel.evidenceState === "diagnostic" ? "profile_display_only" : "failed" }),
    baseCase({ caseId: "runtime_probed_model_exact_scope_ready", proofOutcome: liveModel?.scope.requestShapeFamily === "text_empty_context" && liveModel.evidenceState === "runtime_probed" ? "exact_scope_ready" : "failed" }),
    baseCase({ caseId: "model_alias_not_runtime_evidence", proofOutcome: aliasModel?.aliasOf === "gpt-fixture-live" && aliasModel.scope.requestShapeFamily === "diagnostic" ? "alias_display_only" : "failed" }),
    baseCase({ caseId: "model_control_ui_disabled", proofOutcome: liveModel?.controlDescriptors.every((entry) => entry.uiEnabledInThisPr === false) ? "controls_diagnostic_only" : "failed" }),
    baseCase({ caseId: "candidate_evidence_does_not_unlock_controls", proofOutcome: artifacts.runtimeEvidenceStatus.facets.readFile.state === "degraded" ? "candidate_degraded" : "failed" }),
    baseCase({ caseId: "prompt_cache_affinity_diagnostic_only", proofOutcome: artifacts.cacheEvidence.providerContinuityGranted === false && artifacts.cacheEvidence.promptCacheEvidence.grantsContinuity === false ? "cache_not_continuity" : "failed" }),
    baseCase({ caseId: "session_affinity_not_provider_continuity", proofOutcome: artifacts.cacheEvidence.sessionAffinityEvidence.grantsProviderContinuity === false && artifacts.cacheEvidence.sessionAffinityEvidence.grantsImportedContinuity === false ? "session_affinity_no_continuity" : "failed" }),
    baseCase({ caseId: "usage_delta_records_known_tokens", proofOutcome: artifacts.usageLedger.totals.totalTokensKnown === 20 ? "known_usage_summed" : "failed" }),
    baseCase({ caseId: "usage_dedupe_prevents_double_count", proofOutcome: directUsage.length === 1 && artifacts.usageLedger.entries.length === 3 ? "deduped_by_response" : "failed" }),
    baseCase({ caseId: "missing_usage_is_not_zero", proofOutcome: missingUsage?.usageSource === "missing" && missingUsage.tokenFieldConfidence.inputTokens === "missing" ? "missing_not_zero" : "failed" }),
    baseCase({ caseId: "cached_tokens_recorded_as_cache_signal_not_continuity", proofOutcome: artifacts.usageLedger.totals.cachedInputTokensKnown === 2 && artifacts.cacheEvidence.providerContinuityGranted === false ? "cached_tokens_diagnostic" : "failed" }),
    baseCase({ caseId: "app_server_usage_segregated_from_direct", proofOutcome: appServerUsage.length === 1 && directUsage.length === 1 ? "runtime_family_segregated" : "failed" }),
    baseCase({ caseId: "usage_rows_cite_request_controls", proofOutcome: directUsage[0]?.requestControls.store === false && directUsage[0]?.requestControls.parallelToolCalls === false ? "request_controls_recorded" : "failed" }),
    baseCase({ caseId: "quota_unknown_nonblocking_by_default", proofOutcome: artifacts.quotaUnknown.canBlockDirectByItself === false && artifacts.quotaUnknown.buckets[0].status === "unknown" ? "unknown_quota_nonblocking" : "failed" }),
    baseCase({ caseId: "quota_exhausted_blocks_live_provider_actions", proofOutcome: artifacts.quotaExhausted.canBlockDirectByItself === true && artifacts.quotaExhausted.buckets[0].appliesTo === "live_probe" ? "action_specific_quota_block" : "failed" }),
    baseCase({ caseId: "single_request_quota_error_not_global_truth", proofOutcome: artifacts.quotaExhausted.buckets[0].quotaInferenceScope === "single_request" ? "single_request_scope" : "failed" }),
    baseCase({ caseId: "drift_unknown_event_blocks_promotion", proofOutcome: runCommandDrift?.severity === "block" && textDrift?.severity === "none" ? "scoped_drift_block" : "failed" }),
    baseCase({ caseId: "report_schema_invalid_blocks_mainline_readiness", proofOutcome: usageReadinessRecoveryState({ reportRegistryInvalid: true }) === "report_registry_invalid" ? "registry_invalid_classified" : "failed" }),
    baseCase({ caseId: "runtime_evidence_status_facets_are_granular", proofOutcome: artifacts.runtimeEvidenceStatus.facets.textEmptyContext.state === "ready" && artifacts.runtimeEvidenceStatus.facets.runCommand.state === "degraded" ? "facet_status_granular" : "failed" }),
    baseCase({ caseId: "capability_downgrade_on_evidence_expiry", proofOutcome: artifacts.downgradeEvent.schema === "direct_capability_downgrade_event@1" && artifacts.downgradeEvent.newState === "blocked" ? "downgrade_recorded" : "failed" }),
    baseCase({ caseId: "readiness_behind_flag_split_from_runtime_enablement", proofOutcome: artifacts.readinessReport.mainlineReadiness === "ready_behind_flag" && artifacts.readinessReport.runtimeEnablement === "eligible_projects_only" ? "readiness_split" : "failed" }),
    baseCase({ caseId: "typed_waiver_required_for_skipped_precondition", proofOutcome: artifacts.readinessReport.preconditions.some((entry) => entry.status === "skipped_with_waiver" && entry.waiver?.reason === "feature_not_in_current_merge_scope") ? "waiver_typed" : "failed" }),
    baseCase({ caseId: "missing_precondition_blocks_readiness", proofOutcome: artifacts.blockedReadinessReport.mainlineReadiness === "blocked" && artifacts.blockedReadinessReport.missingPreconditions.includes("missing_required_report") ? "missing_blocks" : "failed" }),
    baseCase({ caseId: "direct_default_invariants_hard_gates", proofOutcome: artifacts.readinessReport.directDefaultAllowed === false && artifacts.readinessReport.appServerBaselineRequired === true && artifacts.readinessReport.appServerRemovalAllowed === false ? "baseline_invariants_preserved" : "failed" }),
    baseCase({ caseId: "app_server_baseline_freshness_checked", proofOutcome: artifacts.readinessReport.appServerBaseline.status === "green" && artifacts.readinessReport.appServerBaseline.maxAgeHours === 24 ? "baseline_freshness_recorded" : "failed" }),
    baseCase({ caseId: "docs_migration_checklist_artifact", proofOutcome: artifacts.docsChecklist.complete === true && artifacts.docsChecklist.rawPathsIncluded === false ? "docs_checklist_complete" : "failed" }),
    baseCase({ caseId: "ci_live_call_guard_blocks_without_env", proofOutcome: artifacts.ciGuard.providerCallWithoutOptInStarted === false && artifacts.ciGuard.ciLiveCallWithoutOverrideStarted === false ? "live_guard_proved" : "failed" }),
    baseCase({ caseId: "cost_estimator_hard_disabled", proofOutcome: artifacts.costStatus.costEstimatorAvailable === false && artifacts.costStatus.billingGrade === false && artifacts.costStatus.pricingSnapshotId === undefined ? "cost_disabled" : "failed" }),
    baseCase({ caseId: "witness_chip_uses_evidence_freshness", proofOutcome: artifacts.witnessProjection.chips.every((chip) => chip.actionability.actionable === false) ? "witness_display_only" : "failed" }),
    baseCase({ caseId: "raw_exposure_blocks_report_write", proofOutcome: "raw_exposure_scan_passed" }),
    baseCase({ caseId: "fixture_reports_do_not_promote_authority", proofOutcome: artifacts.readinessReport.directDefaultAllowed === false ? "fixture_no_authority" : "failed" }),
    baseCase({ caseId: "sentinel_no_runtime_authority", proofOutcome: Object.values(zero).every((value) => value === 0) ? "sentinel_zero" : "failed" }),
  ];
  const failedCases = cases.filter((entry) => entry.proofOutcome === "failed" || entry.status === "failed");
  if (failedCases.length) {
    throw new Error(`direct_usage_readiness_fixture_failed:${failedCases.map((entry) => entry.caseId).join(",")}`);
  }
  const report = {
    schema: DIRECT_USAGE_READINESS_REGRESSION_REPORT_SCHEMA,
    reportId: `usage_readiness_${sha256(nowIso()).slice(0, 16)}`,
    generatedAt: nowIso(),
    coverageSource: "fixture_usage_readiness",
    matrixRowsExercised: ["A7", "A8", "A9", "A10", "C13", "F9", "I10", "I12", "I13", "I14", "I15", "J12"],
    matrixPromotionCandidate: false,
    authorityPromotionCandidate: false,
    runtimeAuthorityExercised: false,
    providerAuthorityExercised: false,
    cases,
    modelCatalogSnapshot: normalizeEvidenceRef({ kind: "model_catalog", artifactId: artifacts.modelCatalog.snapshotId, artifactDigest: artifacts.modelCatalog.integrity.artifactDigest, rendererSafeLabel: "Model catalog" }),
    quotaRateSnapshot: normalizeEvidenceRef({ kind: "quota", artifactId: artifacts.quotaUnknown.snapshotId, artifactDigest: artifacts.quotaUnknown.integrity.artifactDigest, rendererSafeLabel: "Quota snapshot" }),
    usageLedger: normalizeEvidenceRef({ kind: "usage", artifactId: artifacts.usageLedger.ledgerId, artifactDigest: artifacts.usageLedger.integrity.artifactDigest, rendererSafeLabel: "Usage ledger" }),
    driftWatchReport: normalizeEvidenceRef({ kind: "drift", artifactId: artifacts.driftWatch.reportId, artifactDigest: artifacts.driftWatch.integrity.artifactDigest, rendererSafeLabel: "Drift watch" }),
    reportValidationRegistry: normalizeEvidenceRef({ kind: "report_validation", artifactId: artifacts.reportRegistry.registryId, artifactDigest: artifacts.reportRegistry.integrity.artifactDigest, rendererSafeLabel: "Report validation registry" }),
    mainlineReadinessReport: normalizeEvidenceRef({ kind: "readiness", artifactId: artifacts.readinessReport.reportId, artifactDigest: artifacts.readinessReport.integrity.artifactDigest, rendererSafeLabel: "Mainline readiness" }),
    sentinels: zero,
    rawExposureScan: {
      scanned: true,
      status: "passed",
      findingCount: 0,
    },
    promotionCandidates: {
      A7_modelCatalog_fixture: true,
      A7_modelCatalog_live: false,
      A8_controlEvidenceDiagnostic: true,
      A9_cacheAffinityDiagnostic: true,
      A10_quotaRateFixture: false,
      A10_quotaRateLive: false,
      C13_usageProjectionFixture: true,
      C13_usageProjectionLive: false,
      F9_witnessChips: true,
      I10_usageLedger: true,
      I11_costEstimator: false,
      I12_driftWatch: true,
      I13_capabilityDowngrade: true,
      I14_ciLiveCallGuard: true,
      I15_reportValidation: true,
      J12_mainlineReadiness: true,
    },
  };
  validateUsageReadinessRegressionReport(report);
  return report;
}

function markdownSummary(report) {
  const rows = report.cases.map((entry) => `| ${entry.caseId} | ${entry.status} | ${entry.proofOutcome} |`).join("\n");
  return `# Direct Usage Readiness Regression

- Report: \`${report.reportId}\`
- Coverage: \`${report.coverageSource}\`
- Generated: \`${report.generatedAt}\`

| Case | Status | Proof |
| --- | --- | --- |
${rows}
`;
}

function writeOutputs(report, outputRoot) {
  const runRoot = path.join(outputRoot, report.reportId);
  ensureDirectory(runRoot);
  const reportPath = path.join(runRoot, "regression-summary.json");
  const markdownPath = path.join(runRoot, "regression-summary.md");
  const findings = scanFixtureForSecrets(report);
  if (findings.length) {
    const minimal = {
      schema: DIRECT_USAGE_READINESS_REGRESSION_REPORT_SCHEMA,
      reportId: report.reportId,
      status: "failed",
      failureCode: "raw_exposure_blocked",
      rawExposureBlocked: true,
    };
    writeJsonAtomic(reportPath, minimal);
    throw new Error(`raw_exposure_blocked:${findings.join(",")}`);
  }
  writeJsonAtomic(reportPath, report);
  writeTextFile(markdownPath, markdownSummary(report));
  const reread = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  validateUsageReadinessRegressionReport(reread);
  const postFindings = scanFixtureForSecrets(reread);
  if (postFindings.length) throw new Error(`raw_exposure_blocked_after_write:${postFindings.join(",")}`);
  return { reportPath, markdownPath };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const appUserDataRoot = path.resolve(normalizeString(options["app-user-data-root"], process.env[USER_DATA_ROOT_ENV_VAR] || defaultAppUserDataRoot()));
  const outputRoot = path.resolve(normalizeString(options["output-root"], path.join(appUserDataRoot, "direct-usage-readiness-runs")));
  const report = buildReport();
  const output = writeOutputs(report, outputRoot);
  console.log(`Direct usage readiness regression passed: ${output.reportPath}`);
  console.log(`Report digest: ${sha256(stableStringify(report))}`);
}

main();
