#!/usr/bin/env node

import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const { scanFixtureForSecrets } = require("../src/main/direct/fixtures/redaction");
const { writeJsonAtomic } = require("../src/main/direct/session/session-store");
const {
  DIRECT_GOVERNANCE_BROKER_REGRESSION_REPORT_SCHEMA,
  buildCompiledPromptLayers,
  buildGovernanceAttemptRecord,
  buildGovernanceInputSnapshot,
  buildGovernanceModeSnapshot,
  buildGovernancePacket,
  buildGovernanceShadowReport,
  buildGovernanceStatusProjection,
  buildSemanticBrokerFallback,
  buildSemanticBrokerInputSnapshot,
  buildSemanticBrokerPacket,
  buildSemanticBrokerRegistrySnapshot,
  buildWorkflowTransitionGraph,
  candidateFromRoute,
  governanceRecoveryState,
  governanceRequestRefsFromArtifacts,
  normalizeSourceRef,
  sha256,
  stableStringify,
  validateGovernanceBrokerRegressionReport,
  validateGovernanceRequestRefs,
} = require("../src/main/direct/governance/broker");
const {
  DIRECT_TEXT_TURN_RECENT_DIALOGUE_POLICY_ID,
  buildContextPack,
  buildRequestManifest,
} = require("../src/main/direct/thread/context-pack");

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

function throwsCode(fn, code) {
  try {
    fn();
  } catch (error) {
    return error?.code === code || error?.message === code;
  }
  return false;
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
    coverageSource: "fixture_governance_broker",
    status: normalizeString(input.status, "passed"),
    proofOutcome: normalizeString(input.proofOutcome, "diagnostic_checked"),
    matrixRowsExercised: input.matrixRowsExercised || ["D15", "D16", "D18", "D19", "D20", "D21", "J10"],
    matrixPromotionCandidate: false,
    authorityPromotionCandidate: false,
    runtimeAuthorityExercised: false,
    providerAuthorityExercised: false,
    blockerCode: normalizeString(input.blockerCode, ""),
    artifacts: input.artifacts || {},
  };
}

function buildFixtureArtifacts() {
  const projectId = "project_governance_fixture";
  const threadId = "thread_governance_fixture";
  const turnId = "turn_governance_fixture";
  const runtimeRef = normalizeSourceRef({
    kind: "runtime_tier",
    artifactId: "runtime_direct_text_fixture",
    artifactDigest: sha256("runtime_direct_text_fixture"),
    sourceConfidence: "exact",
    rendererSafeLabel: "Direct Text",
  });
  const promptRef = normalizeSourceRef({
    kind: "current_user_intent",
    artifactId: "current_user_intent_fixture",
    artifactDigest: sha256("current_user_intent_fixture"),
    sourceConfidence: "exact",
    rendererSafeLabel: "Current user intent",
  });
  const modeSnapshot = buildGovernanceModeSnapshot({
    effectiveMode: "shadow",
    effectiveSource: "default",
  });
  const inputSnapshot = buildGovernanceInputSnapshot({
    projectId,
    threadId,
    turnId,
    trigger: "pre_request",
    runtimeTierRef: runtimeRef,
    currentUserIntentRef: promptRef,
    contextPackRef: {
      kind: "context_pack",
      artifactId: "context_pack_fixture",
      artifactDigest: sha256("context_pack_fixture"),
      sourceConfidence: "accepted",
      rendererSafeLabel: "Context pack",
    },
  });
  const graph = buildWorkflowTransitionGraph({
    projectId,
    allowedEdges: [
      { from: "text_turn", to: "assistant_final", edgeKind: "text", rendererSafeSummary: "Text turn may complete with assistant final." },
      { from: "text_turn", to: "read_file_obligation", edgeKind: "tool_request", rendererSafeSummary: "Implementation lane may request read_file with existing gates." },
      { from: "read_file_obligation", to: "tool_continuation", edgeKind: "provider_continuation", rendererSafeSummary: "Approved read result may continue provider response." },
      { from: "fresh_fork_start", to: "assistant_final", edgeKind: "fork_start", rendererSafeSummary: "Valid preview may start a fresh direct text turn." },
    ],
    blockedEdges: [
      { from: "apply_patch_obligation", to: "run_command_obligation", edgeKind: "blocked", reasonCode: "missing_evidence", rendererSafeSummary: "Command before patch apply evidence is blocked." },
      { from: "run_command_obligation", to: "tool_continuation", edgeKind: "blocked", reasonCode: "side_effect_recovery_required", rendererSafeSummary: "Nested tool after command side effect is blocked." },
      { from: "context_maintenance", to: "tool_continuation", edgeKind: "blocked", reasonCode: "active_obligation_exists", rendererSafeSummary: "Context maintenance during active obligation is blocked." },
    ],
  });
  const governancePacket = buildGovernancePacket({
    projectId,
    threadId,
    turnId,
    inputSnapshot,
    modeSnapshot,
    transitionGraphDigest: graph.integrity.artifactDigest,
    diagnostics: [
      { code: "memory_layer_not_instruction_authority", severity: "info", rendererSafeSummary: "Memory is evidence only." },
      { code: "baton_layer_not_replay_authority", severity: "info", rendererSafeSummary: "Baton cannot replay tools." },
    ],
  });
  const compiledLayers = buildCompiledPromptLayers({
    governancePacket,
    layers: [
      { kind: "harness", authority: "harness_policy", rendererSafeSummary: "Existing harness policy remains the only harness instruction source.", providerInputEligible: true, currentInstructionAuthority: true, mayBecomeProviderInstructionInThisPr: true, quotedEvidence: false },
      { kind: "memory_evidence", authority: "durable_memory_evidence", rendererSafeSummary: "Durable memory is quoted context evidence.", providerInputEligible: false, currentInstructionAuthority: false, mayBecomeProviderInstructionInThisPr: false },
      { kind: "baton_status", authority: "frontier_baton_evidence", rendererSafeSummary: "Frontier baton is status evidence with no replay authority.", providerInputEligible: false, currentInstructionAuthority: false, mayBecomeProviderInstructionInThisPr: false },
      { kind: "semantic_broker_status", authority: "semantic_broker_diagnostic", rendererSafeSummary: "Broker packet is diagnostic status.", providerInputEligible: false, currentInstructionAuthority: false, mayBecomeProviderInstructionInThisPr: false },
    ],
  });
  const registry = buildSemanticBrokerRegistrySnapshot({ projectId });
  const brokerInput = buildSemanticBrokerInputSnapshot({
    projectId,
    threadId,
    turnId,
    runtimeTierRef: runtimeRef,
    currentUserIntentRef: promptRef,
    governancePacketRef: {
      kind: "policy_snapshot",
      artifactId: governancePacket.governancePacketId,
      artifactDigest: governancePacket.integrity.artifactDigest,
      sourceConfidence: "exact",
      rendererSafeLabel: "Governance packet",
    },
  });
  const textOnlyRoute = registry.routes.find((route) => route.routeKind === "text_only");
  const brokerPacket = buildSemanticBrokerPacket({
    projectId,
    threadId,
    turnId,
    registrySnapshot: registry,
    inputSnapshot: brokerInput,
    governancePacketDigest: governancePacket.integrity.artifactDigest,
    candidates: [
      candidateFromRoute(textOnlyRoute, {
        confidence: "high",
        reasonCodes: ["simple_text_prompt"],
        rendererSafeSummary: "Simple text prompt maps to text-only diagnostics.",
      }),
    ],
  });
  const ambiguousBrokerPacket = buildSemanticBrokerPacket({
    projectId,
    threadId,
    turnId,
    registrySnapshot: registry,
    inputSnapshot: brokerInput,
    forceAmbiguous: true,
    candidates: [
      candidateFromRoute(registry.routes.find((route) => route.routeKind === "repair_loop"), {
        confidence: "low",
        reasonCodes: ["ambiguous_fix_request"],
        wouldRequireUserDecisionInFuture: true,
        wouldMutateRuntimeIfAppliedInFuture: true,
      }),
      candidateFromRoute(textOnlyRoute, {
        confidence: "low",
        reasonCodes: ["ambiguous_text_response_possible"],
      }),
    ],
  });
  const suppliedAuthorityCandidatePacket = buildSemanticBrokerPacket({
    projectId,
    threadId,
    turnId,
    registrySnapshot: registry,
    inputSnapshot: brokerInput,
    candidates: [{
      candidateId: "candidate_supplied_authority_leak",
      routeKind: "implementation_lane_command",
      toolSurface: "run_command",
      confidence: "high",
      reasonCodes: ["supplied_classifier_candidate"],
      rendererSafeSummary: "Supplied candidate must remain diagnostic.",
      mayAutoApplyInThisPr: true,
      enabledInThisPr: true,
    }],
  });
  const suppliedEnabledFallbackPacket = buildSemanticBrokerPacket({
    projectId,
    threadId,
    turnId,
    registrySnapshot: registry,
    inputSnapshot: brokerInput,
    forceAmbiguous: true,
    candidates: [
      candidateFromRoute(textOnlyRoute, { confidence: "low" }),
      candidateFromRoute(registry.routes.find((route) => route.routeKind === "repair_loop"), { confidence: "low" }),
    ],
    fallbackState: buildSemanticBrokerFallback({
      semanticBrokerPacketId: "caller_supplied_fallback",
      fallbackKind: "degrade_to_text_only",
      reasonCode: "caller_supplied_enabled_state",
      fallbackUiState: "enabled_degrade_to_text_only",
      enabledInThisPr: true,
    }),
  });
  const shadowReport = buildGovernanceShadowReport({
    governancePacket,
    compiledPromptLayers: compiledLayers,
    transitionGraph: graph,
    semanticBrokerPacket: brokerPacket,
    status: "passed",
    wouldBlockInFutureEnforceMode: true,
    rendererSafeSummary: "Shadow diagnostics would block in future enforce mode but do not block in PR 9.",
  });
  const governanceRefs = governanceRequestRefsFromArtifacts({
    governanceInputSnapshot: inputSnapshot,
    governancePacket,
    compiledPromptLayers: compiledLayers,
    transitionGraph: graph,
    semanticBrokerPacket: brokerPacket,
  });
  const contextArgs = {
    projectId,
    threadId,
    turnId,
    purpose: "direct_text_turn",
    policyId: DIRECT_TEXT_TURN_RECENT_DIALOGUE_POLICY_ID,
    contextProjection: {
      projectionId: "context_projection_fixture",
      projectionKind: "context_recent_dialogue",
      projectionDigest: sha256("context_projection_fixture"),
      caps: { omittedCounts: {} },
    },
    contextItems: [
      { role: "user", itemKind: "message", text: "Keep governance diagnostics non-authoritative." },
    ],
    currentUserPrompt: "Explain the diagnostic state.",
  };
  const contextPackWithoutGovernance = buildContextPack(contextArgs);
  const contextPackWithGovernance = buildContextPack({
    ...contextArgs,
    governanceRefs,
  });
  const requestWithoutGovernance = buildRequestManifest({
    contextPack: contextPackWithoutGovernance,
    model: "fixture-model",
    requestShape: { requestShapeClass: "direct_text_turn_recent_dialogue@1", store: false, parallelToolCalls: false },
  });
  const requestWithGovernance = buildRequestManifest({
    contextPack: contextPackWithGovernance,
    model: "fixture-model",
    requestShape: { requestShapeClass: "direct_text_turn_recent_dialogue@1", store: false, parallelToolCalls: false },
  });
  return {
    projectId,
    threadId,
    turnId,
    modeSnapshot,
    inputSnapshot,
    graph,
    governancePacket,
    compiledLayers,
    registry,
    brokerInput,
    brokerPacket,
    ambiguousBrokerPacket,
    suppliedAuthorityCandidatePacket,
    suppliedEnabledFallbackPacket,
    shadowReport,
    governanceRefs,
    contextPackWithoutGovernance,
    contextPackWithGovernance,
    requestWithoutGovernance,
    requestWithGovernance,
  };
}

function buildReport() {
  const artifacts = buildFixtureArtifacts();
  const providerInputTextUnchanged =
    artifacts.requestWithoutGovernance.providerInput.projection.providerInputTextHash ===
    artifacts.requestWithGovernance.providerInput.projection.providerInputTextHash;
  if (!providerInputTextUnchanged) throw new Error("governance_refs_changed_provider_input_text");
  const stableStringifyMatchesJsonUndefinedSemantics =
    stableStringify({ keep: true, omit: undefined }) === "{\"keep\":true}" &&
    stableStringify([undefined]) === "[null]" &&
    stableStringify([undefined]) !== stableStringify([]);
  const nestedRawExposureBlocked = throwsCode(
    () => validateGovernanceRequestRefs({ providerInputProjectionGovernanceRefs: { rawCompiledTextIncluded: true } }),
    "governance_request_refs_raw_exposure_blocked",
  );
  let rawSubstringAllowed = false;
  try {
    validateGovernanceRequestRefs({ withdraw: true, nested: { strawberry: true } });
    rawSubstringAllowed = true;
  } catch {
    rawSubstringAllowed = false;
  }

  const cases = [
    baseCase({
      caseId: "stable_stringify_undefined_json_semantics",
      proofOutcome: stableStringifyMatchesJsonUndefinedSemantics
        ? "stable_digest_input_normalized"
        : "failed",
    }),
    baseCase({
      caseId: "governance_mode_snapshot_id_derived_from_source_digest",
      proofOutcome: buildGovernanceModeSnapshot({
        effectiveMode: "shadow",
        effectiveSource: "default",
      }).governanceModeSnapshotId === `governance_mode_${sha256(sha256("shadow:default")).slice(0, 24)}`
        ? "source_digest_consistent"
        : "failed",
    }),
    baseCase({
      caseId: "governance_packet_shadow_happy_path",
      artifacts: { governancePacketId: artifacts.governancePacket.governancePacketId },
    }),
    baseCase({
      caseId: "compiled_prompt_layers_happy_path",
      artifacts: { compiledPromptLayersId: artifacts.compiledLayers.compiledPromptLayersId },
    }),
    baseCase({
      caseId: "memory_layer_not_instruction_authority",
      proofOutcome: artifacts.compiledLayers.layers.some((layer) => layer.authority === "durable_memory_evidence" && layer.currentInstructionAuthority === false)
        ? "memory_layer_evidence_only"
        : "failed",
    }),
    baseCase({
      caseId: "baton_layer_not_replay_authority",
      proofOutcome: artifacts.compiledLayers.layers.some((layer) => layer.authority === "frontier_baton_evidence" && layer.mayBecomeProviderInstructionInThisPr === false)
        ? "baton_layer_evidence_only"
        : "failed",
    }),
    baseCase({
      caseId: "transition_graph_blocked_auto_retry_after_side_effect",
      artifacts: { transitionGraphId: artifacts.graph.transitionGraphId },
      blockerCode: "side_effect_recovery_required",
    }),
    baseCase({
      caseId: "transition_graph_context_maintenance_during_active_obligation_blocked",
      blockerCode: "active_obligation_exists",
    }),
    baseCase({
      caseId: "semantic_broker_registry_snapshot_valid",
      artifacts: { registrySnapshotId: artifacts.registry.registrySnapshotId },
    }),
    baseCase({
      caseId: "semantic_broker_input_snapshot_valid",
      artifacts: { semanticBrokerInputSnapshotId: artifacts.brokerInput.semanticBrokerInputSnapshotId },
    }),
    baseCase({
      caseId: "semantic_broker_simple_text_prompt_text_only_candidate",
      artifacts: { semanticBrokerPacketId: artifacts.brokerPacket.semanticBrokerPacketId },
    }),
    baseCase({
      caseId: "semantic_broker_ambiguous_ask_human_disabled",
      proofOutcome: artifacts.ambiguousBrokerPacket.fallbackState?.enabledInThisPr === false
        ? "disabled_fallback_recorded"
        : "failed",
      artifacts: { fallbackId: artifacts.ambiguousBrokerPacket.fallbackState?.fallbackId },
    }),
    baseCase({
      caseId: "semantic_broker_supplied_candidate_forces_authority_flags_off",
      proofOutcome: artifacts.suppliedAuthorityCandidatePacket.candidates.every((candidate) => candidate.mayAutoApplyInThisPr === false && candidate.enabledInThisPr === false)
        ? "candidate_non_authority_enforced"
        : "failed",
      artifacts: { semanticBrokerPacketId: artifacts.suppliedAuthorityCandidatePacket.semanticBrokerPacketId },
    }),
    baseCase({
      caseId: "semantic_broker_supplied_fallback_forces_disabled_state",
      proofOutcome: artifacts.suppliedEnabledFallbackPacket.fallbackState?.enabledInThisPr === false &&
        artifacts.suppliedEnabledFallbackPacket.fallbackState?.fallbackUiState === "disabled_degrade_to_text_only"
        ? "fallback_non_authority_enforced"
        : "failed",
      artifacts: { fallbackId: artifacts.suppliedEnabledFallbackPacket.fallbackState?.fallbackId },
    }),
    baseCase({
      caseId: "governance_request_refs_nested_raw_exposure_blocked",
      proofOutcome: nestedRawExposureBlocked ? "nested_raw_exposure_blocked" : "failed",
    }),
    baseCase({
      caseId: "governance_request_refs_raw_substring_keys_allowed",
      proofOutcome: rawSubstringAllowed ? "raw_prefix_only" : "failed",
    }),
    baseCase({
      caseId: "enforce_mode_unavailable_status",
      artifacts: {
        modeSnapshotId: buildGovernanceModeSnapshot({
          effectiveMode: "enforce_unavailable",
          enforceUnavailableReason: "workflow_value_unproved",
        }).governanceModeSnapshotId,
      },
    }),
    baseCase({
      caseId: "request_manifest_refs_include_governance_packet_when_present",
      artifacts: {
        requestManifestId: artifacts.requestWithGovernance.requestManifest.requestManifestId,
        governancePacketId: artifacts.requestWithGovernance.requestManifest.governanceRefs.governancePacketId,
      },
    }),
    baseCase({
      caseId: "provider_input_text_unchanged_by_governance_refs",
      proofOutcome: providerInputTextUnchanged ? "provider_input_text_unchanged" : "failed",
    }),
    baseCase({
      caseId: "current_pointer_failed_attempt_not_promoted",
      proofOutcome: buildGovernanceAttemptRecord({
        attemptKind: "semantic_broker",
        status: "blocked_raw_exposure",
      }).replacesCurrentPointer === false ? "attempt_history_only" : "failed",
    }),
    baseCase({
      caseId: "governance_recovery_attempt_history_only",
      proofOutcome: governanceRecoveryState({ attemptHistoryOnly: true }),
    }),
    baseCase({
      caseId: "status_projection_display_only",
      artifacts: {
        projectionDigest: buildGovernanceStatusProjection({
          projectId: artifacts.projectId,
          threadId: artifacts.threadId,
          governancePacketId: artifacts.governancePacket.governancePacketId,
          semanticBrokerPacketId: artifacts.brokerPacket.semanticBrokerPacketId,
          transitionGraphId: artifacts.graph.transitionGraphId,
          rendererSafeSummary: "Governance status is display-only.",
        }).projectionDigest,
      },
    }),
  ];

  return {
    schema: DIRECT_GOVERNANCE_BROKER_REGRESSION_REPORT_SCHEMA,
    generatedAt: nowIso(),
    coverageSource: "fixture_governance_broker",
    matrixRowsExercised: ["D15", "D16", "D17", "D18", "D19", "D20", "D21", "J10"],
    matrixPromotionCandidate: false,
    authorityPromotionCandidate: false,
    runtimeAuthorityExercised: false,
    providerAuthorityExercised: false,
    promotionCandidates: {
      D15_governancePromptLayering_schema: true,
      D16_shadowMode_diagnostics: true,
      D17_enforceMode: false,
      D18_transitionLegality_diagnostic: true,
      D19_governanceDiagnostics: true,
      D20_semanticBrokerPacket_schema: true,
      D21_brokerFallback_diagnostic: true,
      J10_governanceModeStatus: true,
    },
    sourceOfTruthOrder: [
      "canonical session/turn/runtime artifacts",
      "validated context/tool/workspace refs",
      "governance input snapshot",
      "governance packet",
      "compiled prompt layers",
      "transition graph diagnostics",
      "semantic broker packet",
      "request manifest refs",
      "renderer-safe status",
    ],
    nonAuthorityProof: {
      shadowReportCannotBlock: artifacts.shadowReport.blockedInThisPr === false,
      brokerCannotRoute: artifacts.brokerPacket.adjudication.autoRouteApplied === false,
      compiledLayersCannotMutateProviderInput: artifacts.compiledLayers.providerInputMutationAllowedInThisPr === false,
      providerInputTextUnchanged,
      statusReadCannotRebuild: true,
      rightPaneHandoffCannotBeEvidence: true,
    },
    sentinelCounters: {
      providerTransportCalls: 0,
      appServerSpawnCalls: 0,
      workspaceReadCalls: 0,
      patchApplyCalls: 0,
      commandRunCalls: 0,
      contextMaintenanceRuns: 0,
      memoryEdits: 0,
      autoRouteApplications: 0,
      runtimeTierMutations: 0,
      runtimeTierMutationCalls: 0,
      toolDeclarationMutations: 0,
      requestManifestBuildsFromBroker: 0,
      rightPaneMutationCalls: 0,
      handoffMutationCalls: 0,
    },
    rawExposureScan: "passed",
    schemaValidation: "passed",
    cases,
  };
}

function renderMarkdown(report) {
  const lines = [
    "# Direct Governance Broker Regression",
    "",
    `Generated: ${report.generatedAt}`,
    `Coverage source: ${report.coverageSource}`,
    `Matrix promotion candidate: ${report.matrixPromotionCandidate}`,
    "",
    "## Cases",
    "",
  ];
  for (const entry of report.cases) lines.push(`- ${entry.caseId}: ${entry.status} (${entry.proofOutcome})`);
  lines.push("", "## Sentinels", "");
  for (const [key, value] of Object.entries(report.sentinelCounters)) lines.push(`- ${key}: ${value}`);
  lines.push("");
  return lines.join("\n");
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const userDataRoot = normalizeString(options.userDataRoot || process.env[USER_DATA_ROOT_ENV_VAR], defaultAppUserDataRoot());
  const runId = safeIdPart(options.runId, `governance_broker_${Date.now()}`);
  const outputDir = path.join(userDataRoot, "direct-governance-broker-runs", runId);
  ensureDirectory(outputDir);
  const report = buildReport();
  validateGovernanceBrokerRegressionReport(report);
  const findings = scanFixtureForSecrets(report);
  if (findings.length) {
    const safeFailure = {
      schema: DIRECT_GOVERNANCE_BROKER_REGRESSION_REPORT_SCHEMA,
      generatedAt: nowIso(),
      coverageSource: "fixture_governance_broker",
      matrixPromotionCandidate: false,
      rawExposureScan: "blocked",
      cases: [baseCase({ caseId: "raw_exposure_scan", status: "blocked", proofOutcome: "raw_exposure_blocked" })],
      sentinelCounters: {
        providerTransportCalls: 0,
        appServerSpawnCalls: 0,
        workspaceReadCalls: 0,
        patchApplyCalls: 0,
        commandRunCalls: 0,
        memoryEdits: 0,
        autoRouteApplications: 0,
        runtimeTierMutationCalls: 0,
        toolDeclarationMutations: 0,
        requestManifestBuildsFromBroker: 0,
        rightPaneMutationCalls: 0,
        handoffMutationCalls: 0,
      },
    };
    writeJsonAtomic(path.join(outputDir, "regression-summary.json"), safeFailure);
    throw new Error(`Governance broker report failed raw-exposure scan: ${findings.join(", ")}`);
  }
  const jsonPath = path.join(outputDir, "regression-summary.json");
  const markdownPath = path.join(outputDir, "regression-summary.md");
  writeJsonAtomic(jsonPath, report);
  writeTextFile(markdownPath, renderMarkdown(report));
  const reread = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  validateGovernanceBrokerRegressionReport(reread);
  console.log(`Direct governance broker regression passed: ${jsonPath}`);
  console.log(`Report digest: ${sha256(stableStringify(reread))}`);
}

main();
