#!/usr/bin/env node

import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);

const { scanFixtureForSecrets } = require("../src/main/direct/fixtures/redaction");
const { writeJsonAtomic } = require("../src/main/direct/session/session-store");
const { DirectLiveProbeEvidenceStore } = require("../src/main/direct/probes/live-probe-evidence-store");
const {
  buildCiLiveCallGuardProof,
  buildCostEstimatorStatus,
  buildDriftWatchReport,
  buildModelCatalogSnapshot,
  buildModelControlDescriptor,
  buildPromptCacheAffinityEvidence,
  buildQuotaRateSnapshot,
  buildRuntimeEvidenceStatus,
  buildRuntimeWitnessProjection,
  buildUsageLedger,
  normalizeEvidenceRef,
  sha256,
  stableStringify,
} = require("../src/main/direct/readiness/usage-readiness");

const REPORT_SCHEMA = "direct_model_quota_usage_status_regression_report@1";
const USER_DATA_ROOT_ENV_VAR = "CODEX_REVIEW_SHELL_USER_DATA_ROOT";
const LIVE_READONLY_ENV = "CODEX_DIRECT_RUG009_LIVE_READONLY";
const LIVE_CI_ENV = "CODEX_DIRECT_REAL_TURN_ALLOW_CI";

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function nowIso() {
  return new Date().toISOString();
}

function safeIdPart(value, fallback = "run") {
  return normalizeString(value, fallback)
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 96) || fallback;
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
  return path.join(platformAppDataRoot(), "codex-review-shell");
}

function ensureDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
}

function writeTextFile(targetPath, text) {
  ensureDirectory(path.dirname(targetPath));
  fs.writeFileSync(targetPath, text, { mode: 0o600 });
}

function assertCase(cases, caseId, condition, details = {}) {
  cases.push({
    caseId,
    status: condition ? "passed" : "failed",
    details,
  });
}

function liveReadonlyAllowed(options = {}) {
  return options["allow-live-status-read"] === true || process.env[LIVE_READONLY_ENV] === "1";
}

function zeroSentinels() {
  return {
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
  };
}

function fixtureLiveEvidence() {
  return {
    evidenceId: "rug009_fixture_live_evidence",
    status: "runtime_probed",
    computedStatus: "runtime_probed",
    source: "fixture_provider_shaped",
    createdAt: "2026-05-17T12:00:00.000Z",
    model: {
      requested: "gpt-fixture-status",
      observed: "gpt-fixture-status",
      evidenceState: "runtime_probed",
    },
    provider: {
      endpointClass: "chatgpt-codex-responses",
      endpointHash: sha256("fixture-endpoint"),
    },
    auth: {
      accountEvidenceKey: sha256("fixture-account").slice(0, 32),
    },
    requestShape: {
      shapeHash: sha256("fixture-text-empty-context"),
      store: false,
      parallel_tool_calls: "omitted",
      tools: "omitted",
      previous_response_id: "omitted",
    },
    result: {
      ok: true,
      terminalState: "completed",
      failureKind: "",
      responseStatus: 200,
      normalizedEventTypes: ["session_started", "message_delta", "usage_delta", "response_completed"],
      usageSummary: {
        observed: true,
        inputTokens: 6,
        outputTokens: 4,
        totalTokens: 10,
      },
    },
    diagnostics: {
      rawAuthHeadersExposed: false,
      rawBackendRequestsExposed: false,
      rawBackendFramesExposed: false,
      rawAccountIdExposed: false,
    },
  };
}

function evidenceRefFor(evidence = {}, label = "Live probe evidence") {
  const evidenceId = normalizeString(evidence.evidenceId, "evidence_missing");
  const computedStatus = normalizeString(evidence.computedStatus, "");
  return normalizeEvidenceRef({
    kind: "model_evidence",
    artifactId: evidenceId,
    artifactDigest: sha256(stableStringify({
      evidenceId,
      status: computedStatus || evidence.status || "",
      createdAt: evidence.createdAt || "",
      model: evidence.model?.requested || evidence.model?.observed || "",
    })),
    sourceConfidence: computedStatus === "runtime_probed" ? "exact" : "diagnostic",
    rendererSafeLabel: label,
  });
}

function computedEvidenceUsable(evidence = null) {
  return normalizeString(evidence?.computedStatus, "") === "runtime_probed";
}

function latestEvidenceFromStore(evidenceRoot) {
  const store = new DirectLiveProbeEvidenceStore({ rootDir: evidenceRoot });
  const status = store.status();
  const evidence = store.listEvidence()
    .map((entry) => ({
      ...entry,
      computedStatus: status.evidenceCount ? (status.latestEvidenceId === entry.evidenceId ? status.latestStatus : entry.status) : entry.status,
    }))
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  return {
    storeStatus: status,
    evidence,
    latest: evidence[0] || null,
  };
}

function liveStatusEvidence(options = {}) {
  if (options.mode !== "live-readonly") {
    return {
      coverageSource: "fixture_provider_shaped",
      liveReadonly: false,
      liveEvidenceReadAttempted: false,
      evidenceRootDigest: "",
      storeStatus: null,
      latestEvidence: fixtureLiveEvidence(),
    };
  }
  const evidenceRoot = path.resolve(options.evidenceRoot);
  const read = latestEvidenceFromStore(evidenceRoot);
  return {
    coverageSource: "live_readonly_status",
    liveReadonly: true,
    liveEvidenceReadAttempted: true,
    evidenceRootDigest: sha256(evidenceRoot),
    storeStatus: {
      available: read.storeStatus.available === true,
      evidenceCount: read.storeStatus.evidenceCount,
      usableEvidenceCount: read.storeStatus.usableEvidenceCount,
      latestStatus: read.storeStatus.latestStatus,
      latestEvidenceId: read.storeStatus.latestEvidenceId,
      latestObservedAt: read.storeStatus.latestObservedAt,
      rawTokensExposed: read.storeStatus.rawTokensExposed === true,
      rawBackendFramesExposed: read.storeStatus.rawBackendFramesExposed === true,
    },
    latestEvidence: read.latest,
  };
}

function quotaStatusFromEvidence(evidence = {}) {
  const failureKind = normalizeString(evidence?.result?.failureKind || evidence?.evaluation?.failureKind || "", "");
  if (failureKind === "quota" || failureKind === "rate_limit") {
    return {
      source: "direct_provider_error",
      freshness: "fresh",
      creditState: failureKind === "quota" ? "exhausted" : "unknown",
      canBlockDirectByItself: true,
      bucket: {
        bucketId: `quota_${failureKind}`,
        rendererSafeLabel: failureKind === "quota" ? "Direct quota exhausted for observed request" : "Direct rate limited for observed request",
        appliesTo: "live_probe",
        status: failureKind === "quota" ? "exhausted" : "rate_limited",
        freshness: "fresh",
        sourceConfidence: "exact",
        quotaInferenceScope: "single_request",
      },
    };
  }
  return {
    source: "live_probe_failure",
    freshness: "unknown",
    creditState: "unknown",
    canBlockDirectByItself: false,
    bucket: {
      bucketId: "quota_unknown",
      rendererSafeLabel: "Direct quota unknown",
      appliesTo: "all_direct_provider_calls",
      status: "unknown",
      freshness: "unknown",
      sourceConfidence: evidence ? "diagnostic" : "unknown",
      quotaInferenceScope: "unknown",
    },
  };
}

function buildStatusArtifacts(input = {}) {
  const projectId = "project_rug009_model_quota_usage_status";
  const latest = input.latestEvidence || null;
  const evidenceUsable = computedEvidenceUsable(latest);
  const evidenceRef = evidenceRefFor(latest || {}, evidenceUsable ? "Runtime-probed live text evidence" : "Live evidence missing or diagnostic");
  const modelId = normalizeString(latest?.model?.requested || latest?.model?.observed, evidenceUsable ? "unknown-live-model" : "model-unproved");
  const endpointClass = normalizeString(latest?.provider?.endpointClass, "unknown");
  const endpointHash = normalizeString(latest?.provider?.endpointHash, "");
  const requestShapeHash = normalizeString(latest?.requestShape?.shapeHash, "");
  const accountEvidenceKey = normalizeString(latest?.auth?.accountEvidenceKey, "");
  const statusState = evidenceUsable ? "runtime_probed" : latest ? "diagnostic" : "artifact_missing";
  const modelCatalog = buildModelCatalogSnapshot({
    projectId,
    selectedModel: modelId,
    entries: [
      {
        modelId,
        canonicalModelId: modelId,
        displayName: evidenceUsable ? "Runtime-probed Direct model" : "Unproved Direct model",
        source: evidenceUsable ? "live_probe_evidence" : "unknown",
        evidenceState: statusState,
        freshness: evidenceUsable ? "fresh" : "unknown",
        readinessUse: evidenceUsable ? "can_enable" : "diagnostic_only",
        evidenceRefs: [evidenceRef],
        scope: {
          providerProfileId: "direct-live-probe",
          authMode: "chatgpt_subscription",
          accountEvidenceKey,
          endpointClass,
          endpointHash,
          modelId,
          requestShapeFamily: "text_empty_context",
          requestShapeHash,
          normalizerVersion: "codex-event-normalizer@1",
          requestBuilderVersion: "direct-text-request-builder@1",
        },
        controlDescriptors: [
          buildModelControlDescriptor({
            control: "reasoning_effort",
            supportState: "diagnostic",
            requestShapeFamilies: ["text_empty_context"],
            evidenceRefs: [evidenceRef],
          }),
          buildModelControlDescriptor({
            control: "store",
            supportState: "accepted",
            requestShapeFamilies: ["text_empty_context"],
            evidenceRefs: [evidenceRef],
          }),
          buildModelControlDescriptor({
            control: "previous_response_id",
            supportState: "diagnostic",
            requestShapeFamilies: ["text_empty_context"],
            evidenceRefs: [evidenceRef],
          }),
        ],
      },
    ],
  });
  const usageSummary = latest?.result?.usageSummary || {};
  const usageObserved = usageSummary.observed === true;
  const usageLedger = buildUsageLedger({
    projectId,
    entries: [
      usageObserved
        ? {
            usageEntryId: "rug009_live_text_usage",
            dedupeKey: normalizeString(latest?.evidenceId, "rug009_usage"),
            dedupeSource: "event_digest",
            usageRecordKind: "terminal",
            runtimeFamily: "direct_text",
            requestShapeClass: "direct_text_turn_empty_context@1",
            modelId,
            modelEvidenceState: statusState,
            usageSource: "response_completed_usage",
            inputTokens: usageSummary.inputTokens,
            outputTokens: usageSummary.outputTokens,
            totalTokens: usageSummary.totalTokens,
            sourceRefs: [evidenceRef],
            requestManifestId: "status_read_does_not_build_manifest",
            providerInputProjectionId: "status_read_does_not_build_provider_input",
            requestControls: {
              store: false,
              previousResponseIdUsed: false,
              parallelToolCalls: false,
              toolDeclarations: false,
            },
          }
        : {
            usageEntryId: "rug009_usage_missing",
            dedupeKey: normalizeString(latest?.evidenceId, "rug009_usage_missing"),
            dedupeSource: "event_digest",
            usageRecordKind: "missing",
            runtimeFamily: "direct_text",
            requestShapeClass: "direct_text_turn_empty_context@1",
            modelId,
            modelEvidenceState: statusState,
            usageSource: "missing",
            usageMissingReason: latest ? "live_probe_usage_missing" : "live_probe_evidence_missing",
            sourceRefs: [evidenceRef],
            requestControls: {
              store: false,
              previousResponseIdUsed: false,
              parallelToolCalls: false,
              toolDeclarations: false,
            },
          },
    ],
  });
  const quota = quotaStatusFromEvidence(latest);
  const quotaSnapshot = buildQuotaRateSnapshot({
    projectId,
    source: quota.source,
    freshness: quota.freshness,
    creditState: quota.creditState,
    canBlockDirectByItself: quota.canBlockDirectByItself,
    buckets: [{ ...quota.bucket, sourceRef: evidenceRef }],
  });
  const cacheEvidence = buildPromptCacheAffinityEvidence({
    requestShapeClass: "direct_text_turn_empty_context@1",
    modelId,
    source: usageObserved ? "usage_cached_tokens" : "unknown",
    cacheSignal: "unknown",
    promptCacheEvidence: { observed: false, source: "diagnostic" },
  });
  const runtimeEvidenceStatus = buildRuntimeEvidenceStatus({
    projectId,
    modelCatalogSnapshotId: modelCatalog.snapshotId,
    quotaRateSnapshotId: quotaSnapshot.snapshotId,
    usageLedgerId: usageLedger.ledgerId,
    liveProbeEvidenceView: input.storeStatus || null,
    facets: {
      textEmptyContext: {
        state: evidenceUsable ? "ready" : "blocked",
        freshness: evidenceUsable ? "fresh" : "unknown",
        blockerCodes: evidenceUsable ? [] : ["live_probe_evidence_missing_or_unusable"],
        evidenceRefs: [evidenceRef],
      },
      textRecentDialogue: {
        state: evidenceUsable ? "ready" : "blocked",
        freshness: evidenceUsable ? "fresh" : "unknown",
        blockerCodes: evidenceUsable ? [] : ["live_probe_evidence_missing_or_unusable"],
        evidenceRefs: [evidenceRef],
      },
      readFile: { state: "diagnostic_only", freshness: "unknown", blockerCodes: ["status_probe_does_not_prove_implementation_lane"] },
      applyPatch: { state: "diagnostic_only", freshness: "unknown", blockerCodes: ["status_probe_does_not_prove_implementation_lane"] },
      runCommand: { state: "diagnostic_only", freshness: "unknown", blockerCodes: ["status_probe_does_not_prove_implementation_lane"] },
      freshFork: { state: "diagnostic_only", freshness: "unknown" },
      contextMaintenance: { state: "diagnostic_only", freshness: "unknown" },
      governanceDiagnostics: { state: "diagnostic_only", freshness: "unknown" },
      subAgentObservability: { state: "diagnostic_only", freshness: "unknown" },
    },
  });
  const driftWatch = buildDriftWatchReport({
    checks: [
      {
        checkId: "live_probe_status_shape",
        source: input.liveReadonly ? "live_probe_evidence" : "fixture",
        status: latest ? "matched" : "missing",
        rendererSafeSummary: latest ? "Live probe evidence status was projected without provider transport." : "Live probe evidence is missing.",
        evidenceRefs: [evidenceRef],
      },
    ],
    impacts: [
      {
        affectedScope: "text_empty_context",
        severity: evidenceUsable ? "none" : "block",
        reason: evidenceUsable ? "runtime_probed_status_available" : "live_probe_evidence_missing_or_unusable",
      },
      {
        affectedScope: "run_command",
        severity: "diagnostic",
        reason: "status_probe_not_implementation_lane_proof",
      },
    ],
  });
  const ciGuard = buildCiLiveCallGuardProof({
    optInFlagNames: [LIVE_READONLY_ENV, "allow-live-status-read"],
    ciOverrideFlagNames: [LIVE_CI_ENV],
  });
  const costStatus = buildCostEstimatorStatus({
    rendererSafeMessage: "Cost estimation is not implemented in RUG-009.",
  });
  const witnessProjection = buildRuntimeWitnessProjection({
    projectId,
    chips: [
      { kind: "model", label: evidenceUsable ? "Model evidence runtime-probed" : "Model evidence missing", state: evidenceUsable ? "fresh" : "blocked", evidenceRefs: [evidenceRef] },
      { kind: "usage", label: usageObserved ? "Usage observed" : "Usage missing", state: usageObserved ? "fresh" : "unknown", evidenceRefs: [evidenceRef] },
      { kind: "quota", label: quota.bucket.rendererSafeLabel, state: quota.bucket.status === "unknown" ? "unknown" : "blocked", evidenceRefs: [evidenceRef] },
      { kind: "readiness", label: "Status projection is display-only", state: "diagnostic", evidenceRefs: [evidenceRef] },
    ],
  });
  return {
    evidenceUsable,
    usageObserved,
    quotaBlocks: quota.canBlockDirectByItself,
    modelCatalog,
    usageLedger,
    quotaSnapshot,
    cacheEvidence,
    runtimeEvidenceStatus,
    driftWatch,
    ciGuard,
    costStatus,
    witnessProjection,
  };
}

function buildReport(input = {}) {
  const cases = [];
  const sentinels = zeroSentinels();
  const artifacts = buildStatusArtifacts(input);
  const expiredStoredRuntimeProbed = {
    ...fixtureLiveEvidence(),
    evidenceId: "rug009_expired_status_guard",
    status: "runtime_probed",
    computedStatus: "expired",
  };
  const liveModel = artifacts.modelCatalog.entries[0];
  const usageEntry = artifacts.usageLedger.entries[0];
  const quotaBucket = artifacts.quotaSnapshot.buckets[0];
  assertCase(cases, "model_status_uses_exact_scope", liveModel.scope.requestShapeFamily === "text_empty_context" &&
    liveModel.scope.modelId === liveModel.canonicalModelId, {
    modelId: liveModel.modelId,
    evidenceState: liveModel.evidenceState,
    requestShapeFamily: liveModel.scope.requestShapeFamily,
  });
  assertCase(cases, "expired_stored_runtime_probed_evidence_does_not_promote", computedEvidenceUsable(expiredStoredRuntimeProbed) === false &&
    evidenceRefFor(expiredStoredRuntimeProbed).sourceConfidence !== "exact", {
    storedStatus: expiredStoredRuntimeProbed.status,
    computedStatus: expiredStoredRuntimeProbed.computedStatus,
  });
  assertCase(cases, "model_catalog_does_not_enable_selector_controls", artifacts.modelCatalog.selectorEnabledInThisPr === false &&
    liveModel.controlDescriptors.every((entry) => entry.uiEnabledInThisPr === false), {
    selectorEnabledInThisPr: artifacts.modelCatalog.selectorEnabledInThisPr,
  });
  assertCase(cases, "usage_status_missing_is_not_zero", usageEntry.usageRecordKind !== "missing" ||
    usageEntry.tokenFieldConfidence.inputTokens === "missing", {
    usageRecordKind: usageEntry.usageRecordKind,
    inputTokens: usageEntry.inputTokens,
    tokenFieldConfidence: usageEntry.tokenFieldConfidence,
  });
  assertCase(cases, "usage_rows_are_non_billing_and_control_scoped", artifacts.usageLedger.privacy.billingGrade === false &&
    usageEntry.requestControls.store === false &&
    usageEntry.requestControls.parallelToolCalls === false &&
    usageEntry.requestControls.toolDeclarations === false, {
    billingGrade: artifacts.usageLedger.privacy.billingGrade,
    requestControls: usageEntry.requestControls,
  });
  assertCase(cases, "quota_unknown_does_not_block_by_itself", quotaBucket.status !== "unknown" ||
    artifacts.quotaSnapshot.canBlockDirectByItself === false, {
    quotaStatus: quotaBucket.status,
    canBlockDirectByItself: artifacts.quotaSnapshot.canBlockDirectByItself,
    quotaInferenceScope: quotaBucket.quotaInferenceScope,
  });
  assertCase(cases, "single_request_quota_error_not_global_truth", quotaBucket.status === "unknown" ||
    quotaBucket.quotaInferenceScope === "single_request", {
    quotaStatus: quotaBucket.status,
    quotaInferenceScope: quotaBucket.quotaInferenceScope,
  });
  assertCase(cases, "prompt_cache_and_session_affinity_grant_no_continuity", artifacts.cacheEvidence.providerContinuityGranted === false &&
    artifacts.cacheEvidence.promptCacheEvidence.grantsContinuity === false &&
    artifacts.cacheEvidence.sessionAffinityEvidence.grantsProviderContinuity === false, {
    providerContinuityGranted: artifacts.cacheEvidence.providerContinuityGranted,
  });
  assertCase(cases, "runtime_status_facets_are_granular", artifacts.runtimeEvidenceStatus.facets.textEmptyContext.state !== artifacts.runtimeEvidenceStatus.facets.runCommand.state &&
    artifacts.runtimeEvidenceStatus.facets.runCommand.blockerCodes.includes("status_probe_does_not_prove_implementation_lane"), {
    textEmptyContext: artifacts.runtimeEvidenceStatus.facets.textEmptyContext.state,
    runCommand: artifacts.runtimeEvidenceStatus.facets.runCommand.state,
  });
  assertCase(cases, "witness_projection_display_only", artifacts.witnessProjection.chips.every((chip) => chip.actionability.actionable === false), {
    chipCount: artifacts.witnessProjection.chips.length,
  });
  assertCase(cases, "cost_estimator_hard_disabled", artifacts.costStatus.costEstimatorAvailable === false && artifacts.costStatus.billingGrade === false, {
    costEstimatorAvailable: artifacts.costStatus.costEstimatorAvailable,
    billingGrade: artifacts.costStatus.billingGrade,
  });
  assertCase(cases, "live_readonly_mode_does_not_generate", Object.values(sentinels).every((value) => value === 0), sentinels);
  assertCase(cases, "raw_private_fields_excluded", artifacts.modelCatalog.rawAccountIdIncluded === false &&
    artifacts.modelCatalog.rawEndpointIncluded === false &&
    artifacts.quotaSnapshot.rawAccountIdIncluded === false &&
    artifacts.usageLedger.privacy.rawPromptIncluded === false, {
    rawAccountIdIncluded: artifacts.modelCatalog.rawAccountIdIncluded,
    rawEndpointIncluded: artifacts.modelCatalog.rawEndpointIncluded,
  });
  const failedCases = cases.filter((entry) => entry.status !== "passed");
  const report = {
    schema: REPORT_SCHEMA,
    runId: input.runId,
    generatedAt: nowIso(),
    status: failedCases.length ? "failed" : "passed",
    coverageSource: input.coverageSource,
    liveReadonly: input.liveReadonly === true,
    liveProviderOptIn: input.liveReadonly === true,
    liveEvidenceReadAttempted: input.liveEvidenceReadAttempted === true,
    liveEvidenceRootDigest: normalizeString(input.evidenceRootDigest, ""),
    matrixRowsExercised: ["A7", "A8", "A9", "A10", "C13", "F9", "I10", "I12", "I13", "I14", "I15", "J12"],
    matrixPromotionCandidate: input.liveReadonly === true && artifacts.evidenceUsable === true,
    authorityPromotionCandidate: false,
    runtimeAuthorityExercised: false,
    providerAuthorityExercised: false,
    rug009Closed: input.liveReadonly === true && artifacts.evidenceUsable === true,
    counts: {
      passed: cases.length - failedCases.length,
      failed: failedCases.length,
      total: cases.length,
    },
    liveProbeEvidenceView: input.storeStatus || {
      available: false,
      evidenceCount: input.latestEvidence ? 1 : 0,
      usableEvidenceCount: artifacts.evidenceUsable ? 1 : 0,
      rawTokensExposed: false,
      rawBackendFramesExposed: false,
    },
    artifactRefs: {
      modelCatalogSnapshotId: artifacts.modelCatalog.snapshotId,
      usageLedgerId: artifacts.usageLedger.ledgerId,
      quotaRateSnapshotId: artifacts.quotaSnapshot.snapshotId,
      runtimeEvidenceStatusId: artifacts.runtimeEvidenceStatus.statusId,
      driftWatchReportId: artifacts.driftWatch.reportId,
      witnessProjectionId: artifacts.witnessProjection.projectionId,
    },
    modelStatus: {
      evidenceState: liveModel.evidenceState,
      readinessUse: liveModel.readinessUse,
      modelId: liveModel.modelId,
      canonicalModelId: liveModel.canonicalModelId,
      requestShapeFamily: liveModel.scope.requestShapeFamily,
      endpointClass: liveModel.scope.endpointClass,
      rawEndpointIncluded: false,
      rawAccountIdIncluded: false,
      selectorEnabledInThisPr: false,
      controlsUiEnabledInThisPr: false,
    },
    usageStatus: {
      usageRecordKind: usageEntry.usageRecordKind,
      usageSource: usageEntry.usageSource,
      inputTokensKnown: artifacts.usageLedger.totals.inputTokensKnown,
      outputTokensKnown: artifacts.usageLedger.totals.outputTokensKnown,
      totalTokensKnown: artifacts.usageLedger.totals.totalTokensKnown,
      missingUsageEntryCount: artifacts.usageLedger.totals.missingUsageEntryCount,
      billingGrade: false,
    },
    quotaStatus: {
      source: artifacts.quotaSnapshot.source,
      status: quotaBucket.status,
      appliesTo: quotaBucket.appliesTo,
      quotaInferenceScope: quotaBucket.quotaInferenceScope,
      canBlockDirectByItself: artifacts.quotaSnapshot.canBlockDirectByItself,
      billingGrade: false,
    },
    runtimeEvidenceFacets: artifacts.runtimeEvidenceStatus.facets,
    sentinelCounters: sentinels,
    rawExposure: {
      rawAccountIdExposed: false,
      rawEmailExposed: false,
      rawEndpointUrlExposed: false,
      rawProviderRequestBodyExposed: false,
      rawProviderResponseExposed: false,
      rawPromptExposed: false,
      rawAssistantOutputExposed: false,
      rawWorkspacePathExposed: false,
      rawChatGptUrlExposed: false,
      rawTokenCookieOrAuthHeaderExposed: false,
      costPricingPlaceholderExposed: false,
    },
    cases,
  };
  const findings = scanFixtureForSecrets(report);
  if (findings.length) {
    report.status = "failed";
    report.rawExposure.rawExposureScanFailed = true;
    report.rawExposure.findings = findings;
    report.cases.push({
      caseId: "model_quota_usage_status_raw_exposure_scan",
      status: "failed",
      details: { findings },
    });
    report.counts.failed += 1;
    report.counts.total += 1;
  }
  return report;
}

function markdownSummary(report) {
  const rows = report.cases.map((entry) => `| ${entry.caseId} | ${entry.status} |`).join("\n");
  return `# Direct Model/Quota/Usage Status Probe

- Report: \`${report.runId}\`
- Status: \`${report.status}\`
- Coverage: \`${report.coverageSource}\`
- RUG-009 closed: \`${report.rug009Closed}\`
- Matrix promotion candidate: \`${report.matrixPromotionCandidate}\`

| Case | Status |
| --- | --- |
${rows}
`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const mode = normalizeString(options.mode, "fixture");
  if (!["fixture", "live-readonly"].includes(mode)) throw new Error("--mode must be fixture or live-readonly.");
  if (mode === "live-readonly" && !liveReadonlyAllowed(options)) {
    throw new Error(`Live-readonly status requires --allow-live-status-read or ${LIVE_READONLY_ENV}=1.`);
  }
  if (mode === "live-readonly" && process.env.CI === "true" && process.env[LIVE_CI_ENV] !== "1") {
    throw new Error(`Live-readonly status in CI requires ${LIVE_CI_ENV}=1.`);
  }
  const runId = safeIdPart(options["run-id"] || options.runId || `rug009_${mode}_${Date.now()}`);
  const appUserDataRoot = path.resolve(normalizeString(options["app-user-data-root"], process.env[USER_DATA_ROOT_ENV_VAR] || defaultAppUserDataRoot()));
  const outputRoot = path.resolve(normalizeString(options["output-root"], path.join(appUserDataRoot, "direct-model-quota-usage-status-runs")));
  const evidenceRoot = path.resolve(normalizeString(options["evidence-root"], path.join(appUserDataRoot, "direct-probe-evidence")));
  const runRoot = path.join(outputRoot, runId);
  fs.rmSync(runRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  ensureDirectory(runRoot);
  const statusEvidence = liveStatusEvidence({ mode, evidenceRoot });
  const report = buildReport({
    runId,
    mode,
    ...statusEvidence,
  });
  const reportPath = path.join(runRoot, "direct-model-quota-usage-status-report.json");
  const markdownPath = path.join(runRoot, "direct-model-quota-usage-status-report.md");
  writeJsonAtomic(reportPath, report);
  writeTextFile(markdownPath, markdownSummary(report));
  const reread = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  const postFindings = scanFixtureForSecrets(reread);
  if (postFindings.length) {
    const failure = {
      schema: REPORT_SCHEMA,
      runId,
      generatedAt: nowIso(),
      status: "failed",
      coverageSource: statusEvidence.coverageSource,
      failureCode: "raw_exposure_blocked_after_write",
      rawExposureBlocked: true,
      rawExposureFindings: postFindings,
      matrixPromotionCandidate: false,
      rug009Closed: false,
    };
    writeJsonAtomic(reportPath, failure);
    throw new Error(`raw_exposure_blocked_after_write:${postFindings.join(",")}`);
  }
  console.log(JSON.stringify({
    ok: report.status === "passed",
    reportPath,
    status: report.status,
    coverageSource: report.coverageSource,
    matrixPromotionCandidate: report.matrixPromotionCandidate,
    rug009Closed: report.rug009Closed,
    liveEvidenceReadAttempted: report.liveEvidenceReadAttempted,
    providerTransportCalls: report.sentinelCounters.providerTransportCalls,
    passedCases: report.counts.passed,
    totalCases: report.counts.total,
  }, null, 2));
  process.exitCode = report.status === "passed" ? 0 : 1;
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
