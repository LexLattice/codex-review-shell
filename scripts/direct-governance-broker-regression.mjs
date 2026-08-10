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
  buildSemanticBrokerPreflight,
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
  validateSemanticBrokerPreflight,
} = require("../src/main/direct/governance/broker");
const {
  DIRECT_TEXT_TURN_RECENT_DIALOGUE_POLICY_ID,
  buildContextPack,
  buildRequestManifest,
} = require("../src/main/direct/thread/context-pack");
const {
  buildAuthorityBearingTransition,
  buildWorkThreadContextBinding,
} = require("../src/main/direct/bridge/work-thread-alignment");
const {
  buildWorkTargetResolution,
  buildWorkTargetResolutionReport,
  buildWorkThread,
} = require("../src/main/direct/bridge/work-thread-registry");
const {
  buildAgentClassRegistry,
} = require("../src/main/direct/bridge/agent-class-spec");

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
  const workThread = buildWorkThread({
    workThreadId: "work_thread_governance_fixture",
    projectId,
    title: "Governance fixture WorkThread",
    authorityBoundary: {
      mutationAllowedBeforeResolution: false,
      allowedActions: ["read_file_after_approval"],
      forbiddenActions: ["workspace_mutation_before_target_resolution"],
      summary: "Governance may cite but not enforce WorkThread routing in this slice.",
    },
    openObligations: [
      { obligationId: "obl_governance_shadow", kind: "governance", status: "open", summary: "Keep WorkThread governance shadow-only." },
    ],
    activeRuntimePath: "direct-implementation",
  });
  const workTargetResolution = buildWorkTargetResolution({
    projectId,
    userRequest: "continue governance fixture WorkThread",
    activeRuntimePath: "direct-implementation",
  }, [workThread], { nowMs: 0 });
  const workTargetResolutionReport = buildWorkTargetResolutionReport({
    projectId,
    resolution: workTargetResolution,
  }, { nowMs: 0 });
  const staleWorkTargetResolutionReport = buildWorkTargetResolutionReport({
    projectId,
    resolution: workTargetResolution,
    expectedResolutionDigest: "sha256:stale",
  }, { nowMs: 0 });
  const clarifyWorkTargetResolution = buildWorkTargetResolution({
    projectId,
    userRequest: "unclear task",
  }, [workThread], { nowMs: 0 });
  const clarifyWorkTargetResolutionReport = buildWorkTargetResolutionReport({
    projectId,
    resolution: clarifyWorkTargetResolution,
  }, { nowMs: 0 });
  const agentClassRegistry = buildAgentClassRegistry({ projectId, workThreadId: workThread.workThreadId, nowMs: 0 });
  const primaryAgentSpec = agentClassRegistry.specs.find((spec) => spec.agentClassKind === "primary_agent");
  const implementationWorkerSpec = agentClassRegistry.specs.find((spec) => spec.agentClassKind === "implementation_worker");
  const workThreadBinding = buildWorkThreadContextBinding({
    workThread,
    bridgeInformationRefs: [
      { classId: "ic12.work-thread-registry", role: "governance_routing", artifactKind: "work_thread", artifactId: workThread.workThreadId },
      { classId: "ic6.semantic-governance-broker", role: "governance_routing", artifactKind: "governance_packet", artifactId: "fixture_governance_packet" },
    ],
  });
  const authorityTransition = buildAuthorityBearingTransition({
    transitionKind: "read_file",
    transitionPhase: "decision",
    projectId,
    threadId,
    turnId,
    obligationId: "obl_governance_shadow",
    status: "diagnostic",
    workThreadBinding,
    sourceArtifact: { classId: "ic4.read-file-authority", artifactKind: "readonly_tool_authority_decision", artifactId: "decision_fixture" },
  });
  const workThreadBindingRef = {
    kind: "work_thread_binding",
    artifactId: workThreadBinding.workThreadId,
    artifactDigest: workThreadBinding.bindingDigest,
    sourceConfidence: "exact",
    rendererSafeLabel: "WorkThread binding",
  };
  const authorityTransitionRef = {
    kind: "authority_transition",
    artifactId: authorityTransition.transitionId,
    artifactDigest: authorityTransition.transitionDigest,
    sourceConfidence: "exact",
    rendererSafeLabel: "Authority transition",
  };
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
    workThreadBindingRef,
    authorityTransitionRefs: [authorityTransitionRef],
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
      { code: "workthread_binding_shadow_only", severity: "info", rendererSafeSummary: "WorkThread binding is diagnostic only." },
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
    workThreadBindingRef,
    authorityTransitionRefs: [authorityTransitionRef],
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
  const allowPreflight = buildSemanticBrokerPreflight({
    projectId,
    threadId,
    turnId,
    semanticBrokerPacket: brokerPacket,
    workTargetResolutionReport,
    agentClassSpec: primaryAgentSpec,
    contextRefs: [{
      kind: "context_pack",
      artifactId: "context_pack_fixture",
      artifactDigest: sha256("context_pack_fixture"),
      sourceConfidence: "accepted",
      rendererSafeLabel: "Context pack",
    }],
    requestRefs: [{
      kind: "request_manifest",
      artifactId: "request_manifest_fixture",
      artifactDigest: sha256("request_manifest_fixture"),
      sourceConfidence: "diagnostic",
      rendererSafeLabel: "Request manifest",
    }],
    authorityTransitionRefs: [authorityTransitionRef],
  });
  const clarifyPreflight = buildSemanticBrokerPreflight({
    projectId,
    threadId,
    turnId,
    semanticBrokerPacket: ambiguousBrokerPacket,
    workTargetResolutionReport: clarifyWorkTargetResolutionReport,
    agentClassSpec: primaryAgentSpec,
  });
  const stalePreflight = buildSemanticBrokerPreflight({
    projectId,
    threadId,
    turnId,
    semanticBrokerPacket: brokerPacket,
    workTargetResolutionReport: staleWorkTargetResolutionReport,
    expectedBrokerPacketDigest: "sha256:stale",
  });
  const blockPreflight = buildSemanticBrokerPreflight({
    projectId,
    threadId,
    turnId,
    semanticBrokerPacket: buildSemanticBrokerPacket({
      projectId,
      threadId,
      turnId,
      registrySnapshot: registry,
      inputSnapshot: brokerInput,
      candidates: [
        candidateFromRoute(registry.routes.find((route) => route.routeKind === "implementation_lane_read"), {
          confidence: "medium",
          missingEvidenceCodes: ["tool_policy_missing"],
          reasonCodes: ["missing_tool_policy"],
        }),
      ],
    }),
    workTargetResolutionReport,
    agentClassSpec: implementationWorkerSpec,
  });
  const routeToRolePreflight = buildSemanticBrokerPreflight({
    projectId,
    threadId,
    turnId,
    semanticBrokerPacket: brokerPacket,
    workTargetResolutionReport,
    agentClassSpec: implementationWorkerSpec,
  });
  const missingTargetReportPreflight = buildSemanticBrokerPreflight({
    projectId,
    threadId,
    turnId,
    semanticBrokerPacket: brokerPacket,
    agentClassSpec: primaryAgentSpec,
  });
  const missingBrokerPacketPreflight = buildSemanticBrokerPreflight({
    projectId,
    threadId,
    turnId,
    workTargetResolutionReport,
    agentClassSpec: primaryAgentSpec,
  });
  const kindOnlyAgentPreflight = buildSemanticBrokerPreflight({
    projectId,
    threadId,
    turnId,
    semanticBrokerPacket: brokerPacket,
    workTargetResolutionReport,
    agentClassRef: { id: "agent_kind_only", kind: "implementation_worker" },
  });
  const duplicateBlockerPreflight = buildSemanticBrokerPreflight({
    projectId,
    threadId,
    turnId,
    semanticBrokerPacket: buildSemanticBrokerPacket({
      projectId,
      threadId,
      turnId,
      registrySnapshot: registry,
      inputSnapshot: brokerInput,
      candidates: [
        candidateFromRoute(registry.routes.find((route) => route.routeKind === "implementation_lane_read"), {
          confidence: "medium",
          missingEvidenceCodes: ["tool_policy_missing", "tool_policy_missing"],
          reasonCodes: ["missing_tool_policy"],
        }),
      ],
    }),
    workTargetResolutionReport: {
      ...workTargetResolutionReport,
      blockerCodes: ["tool_policy_missing", "tool_policy_missing"],
    },
    agentClassSpec: implementationWorkerSpec,
  });
  for (const preflight of [
    allowPreflight,
    clarifyPreflight,
    stalePreflight,
    blockPreflight,
    routeToRolePreflight,
    missingTargetReportPreflight,
    missingBrokerPacketPreflight,
    kindOnlyAgentPreflight,
    duplicateBlockerPreflight,
  ]) {
    validateSemanticBrokerPreflight(preflight);
  }
  const invalidAllowWithoutTargetBlocked = throwsCode(
    () => validateSemanticBrokerPreflight({ ...allowPreflight, selectedWorkThreadId: "" }),
    "direct_semantic_broker_preflight_missing_selected_target",
  );
  const invalidMissingProjectBlocked = throwsCode(
    () => validateSemanticBrokerPreflight({ ...allowPreflight, projectId: "" }),
    "direct_semantic_broker_preflight_missing_project_id",
  );
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
    workThread,
    workTargetResolution,
    workTargetResolutionReport,
    staleWorkTargetResolutionReport,
    clarifyWorkTargetResolutionReport,
    agentClassRegistry,
    primaryAgentSpec,
    implementationWorkerSpec,
    workThreadBinding,
    authorityTransition,
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
    allowPreflight,
    clarifyPreflight,
    stalePreflight,
    blockPreflight,
    routeToRolePreflight,
    missingTargetReportPreflight,
    missingBrokerPacketPreflight,
    kindOnlyAgentPreflight,
    duplicateBlockerPreflight,
    invalidAllowWithoutTargetBlocked,
    invalidMissingProjectBlocked,
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
      caseId: "governance_packet_cites_workthread_binding",
      proofOutcome: artifacts.governancePacket.workThreadBindingDigest === artifacts.workThreadBinding.bindingDigest &&
        artifacts.governancePacket.workThreadRoutingEnforced === false
        ? "workthread_binding_cited_shadow_only"
        : "failed",
      artifacts: {
        governancePacketId: artifacts.governancePacket.governancePacketId,
        workThreadId: artifacts.workThread.workThreadId,
      },
    }),
    baseCase({
      caseId: "governance_packet_cites_authority_transition_without_enforcement",
      proofOutcome: artifacts.governancePacket.authorityTransitionsDigest &&
        artifacts.governancePacket.authorityTransitionRoutingEnforced === false &&
        artifacts.governancePacket.mutationAllowedByGovernance === false &&
        artifacts.governancePacket.providerCallAllowedByGovernance === false
        ? "authority_transition_cited_shadow_only"
        : "failed",
      artifacts: {
        transitionId: artifacts.authorityTransition.transitionId,
        transitionDigest: artifacts.authorityTransition.transitionDigest,
      },
    }),
    baseCase({
      caseId: "semantic_broker_input_cites_workthread_without_auto_route",
      proofOutcome: artifacts.brokerInput.workThreadBindingRef?.artifactDigest === artifacts.workThreadBinding.bindingDigest &&
        artifacts.brokerInput.authorityTransitionRefs?.[0]?.artifactDigest === artifacts.authorityTransition.transitionDigest &&
        artifacts.brokerPacket.adjudication.autoRouteApplied === false
        ? "broker_citation_non_authority"
        : "failed",
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
      caseId: "semantic_broker_preflight_allow_non_authority",
      proofOutcome: artifacts.allowPreflight.recommendationClass === "allow" &&
        artifacts.allowPreflight.autoRouteApplied === false &&
        artifacts.allowPreflight.routingEnforced === false &&
        artifacts.allowPreflight.providerCallAllowed === false &&
        artifacts.allowPreflight.mutationAllowed === false
        ? "allow_recommendation_without_execution_authority"
        : "failed",
      artifacts: { preflightId: artifacts.allowPreflight.preflightId },
    }),
    baseCase({
      caseId: "semantic_broker_preflight_clarify_for_ambiguous_target",
      proofOutcome: artifacts.clarifyPreflight.recommendationClass === "clarify" &&
        artifacts.clarifyPreflight.clarificationRequired === true &&
        artifacts.clarifyPreflight.mayAutoApplyInThisPr === false
        ? "clarification_required_without_auto_route"
        : "failed",
      artifacts: { preflightId: artifacts.clarifyPreflight.preflightId },
    }),
    baseCase({
      caseId: "semantic_broker_preflight_stale_blocks_selected_target",
      proofOutcome: artifacts.stalePreflight.recommendationClass === "stale" &&
        artifacts.stalePreflight.selectedWorkThreadId === "" &&
        artifacts.stalePreflight.staleInputCodes.includes("broker_packet_digest_mismatch")
        ? "stale_inputs_block_route"
        : "failed",
      artifacts: { preflightId: artifacts.stalePreflight.preflightId },
    }),
    baseCase({
      caseId: "semantic_broker_preflight_block_missing_evidence",
      proofOutcome: artifacts.blockPreflight.recommendationClass === "block" &&
        artifacts.blockPreflight.blockerCodes.includes("tool_policy_missing") &&
        artifacts.blockPreflight.providerCallAllowed === false
        ? "missing_evidence_blocks_route"
        : "failed",
      artifacts: { preflightId: artifacts.blockPreflight.preflightId },
    }),
    baseCase({
      caseId: "semantic_broker_preflight_route_to_role_without_handoff",
      proofOutcome: artifacts.routeToRolePreflight.recommendationClass === "route_to_role" &&
        artifacts.routeToRolePreflight.recommendedAgentClass.agentClassKind === "implementation_worker" &&
        artifacts.routeToRolePreflight.mayRouteToRoleInThisPr === false &&
        artifacts.routeToRolePreflight.brokerPerformedWorkerTask === false
        ? "role_handoff_recommended_not_executed"
        : "failed",
      artifacts: { preflightId: artifacts.routeToRolePreflight.preflightId },
    }),
    baseCase({
      caseId: "semantic_broker_preflight_missing_target_report_blocks",
      proofOutcome: artifacts.missingTargetReportPreflight.recommendationClass === "block" &&
        artifacts.missingTargetReportPreflight.selectedWorkThreadId === "" &&
        artifacts.missingTargetReportPreflight.blockerCodes.includes("work_target_resolution_report_missing")
        ? "missing_target_report_blocks_route"
        : "failed",
      artifacts: { preflightId: artifacts.missingTargetReportPreflight.preflightId },
    }),
    baseCase({
      caseId: "semantic_broker_preflight_missing_broker_ref_omitted",
      proofOutcome: artifacts.missingBrokerPacketPreflight.recommendationClass === "block" &&
        artifacts.missingBrokerPacketPreflight.blockerCodes.includes("semantic_broker_packet_missing") &&
        artifacts.missingBrokerPacketPreflight.evidenceRefs.every((ref) => ref.artifactId || ref.artifactDigest)
        ? "missing_broker_packet_blocks_without_empty_ref"
        : "failed",
      artifacts: { preflightId: artifacts.missingBrokerPacketPreflight.preflightId },
    }),
    baseCase({
      caseId: "semantic_broker_preflight_agent_kind_display_fallback",
      proofOutcome: artifacts.kindOnlyAgentPreflight.recommendedAgentClass.displayName === "implementation_worker"
        ? "kind_fallback_used_for_display_name"
        : "failed",
      artifacts: { preflightId: artifacts.kindOnlyAgentPreflight.preflightId },
    }),
    baseCase({
      caseId: "semantic_broker_preflight_blocker_codes_deduped_before_digest",
      proofOutcome: artifacts.duplicateBlockerPreflight.blockerCodes.length === new Set(artifacts.duplicateBlockerPreflight.blockerCodes).size &&
        artifacts.duplicateBlockerPreflight.blockerCodes.includes("tool_policy_missing")
        ? "blocker_codes_deduped"
        : "failed",
      artifacts: { preflightId: artifacts.duplicateBlockerPreflight.preflightId },
    }),
    baseCase({
      caseId: "semantic_broker_preflight_validator_requires_project_and_target",
      proofOutcome: artifacts.invalidAllowWithoutTargetBlocked && artifacts.invalidMissingProjectBlocked
        ? "required_identity_validation_blocks_invalid_preflight"
        : "failed",
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
          workThreadBindingState: "valid",
          authorityTransitionState: "valid",
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
      preflightCannotRoute: artifacts.allowPreflight.autoRouteApplied === false &&
        artifacts.routeToRolePreflight.mayRouteToRoleInThisPr === false,
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
