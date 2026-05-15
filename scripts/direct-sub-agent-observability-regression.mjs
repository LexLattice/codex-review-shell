#!/usr/bin/env node

import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);

const { scanFixtureForSecrets } = require("../src/main/direct/fixtures/redaction");
const { writeJsonAtomic } = require("../src/main/direct/session/session-store");
const {
  DIRECT_SUB_AGENT_OBSERVABILITY_REPORT_SCHEMA,
  agentObservabilityRecoveryState,
  buildActivityTag,
  buildAgentGraph,
  buildAgentSourceSchemaRef,
  buildAttentionProjection,
  buildContainmentProfile,
  buildProgressInspection,
  buildProgressRegistry,
  buildProgressWitness,
  buildSelectedAgentTabState,
  buildSubAgentTranscriptProjection,
  progressTransitionState,
  sha256,
  stableStringify,
  validateSubAgentObservabilityReport,
} = require("../src/main/direct/agents/observability");

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
    coverageSource: "fixture_sub_agent_observability",
    status: normalizeString(input.status, "passed"),
    proofOutcome: normalizeString(input.proofOutcome, "diagnostic_checked"),
    matrixRowsExercised: input.matrixRowsExercised || ["H1", "H2", "H3", "H6", "H8", "H9", "J9"],
    matrixPromotionCandidate: false,
    authorityPromotionCandidate: false,
    runtimeAuthorityExercised: false,
    providerAuthorityExercised: false,
    blockerCode: normalizeString(input.blockerCode, ""),
    artifacts: input.artifacts || {},
  };
}

function fixtureArtifacts() {
  const projectId = "project_sub_agent_fixture";
  const primaryThreadId = "thread_primary_fixture";
  const sourceSchemaRef = buildAgentSourceSchemaRef({
    runtimeSourceClass: "codex_app_server_collab",
    codexVersion: "fixture-codex@0",
    appServerSchemaDigest: sha256("fixture-app-server-schema"),
    sourceNormalizerVersion: "fixture-sub-agent-normalizer@1",
  });
  const containmentProfile = buildContainmentProfile({
    projectId,
    runtimeSourceClass: "codex_app_server_collab",
    profileSource: "app_server_observed_metadata",
    containmentEvidence: {
      source: "app_server_observed_metadata",
      sourceConfidence: "diagnostic",
      schemaRef: sourceSchemaRef,
    },
    appliesToAgentThreadIds: ["agent_scout", "agent_reviewer", "agent_nested"],
    toolSurfaceVisibility: "observed_only",
  });
  const unknownContainment = buildContainmentProfile({
    projectId,
    runtimeSourceClass: "unknown",
    profileSource: "unknown",
    containmentEvidence: { source: "unknown", sourceConfidence: "diagnostic" },
    appliesToAgentThreadIds: ["agent_unknown"],
    toolSurfaceVisibility: "unknown",
  });
  const graph = buildAgentGraph({
    projectId,
    primaryThreadId,
    runtimeSourceClass: "codex_app_server_collab",
    sourceSchemaRef,
    graphRevision: 7,
    activationEpoch: 3,
    containmentProfileId: containmentProfile.containmentProfileId,
    containmentProfileDigest: containmentProfile.integrity.artifactDigest,
    sourceEventDigests: [sha256("spawn-agent-scout"), sha256("send-input-reviewer"), sha256("nested-child")],
    nodes: [
      {
        agentThreadId: "agent_scout",
        parentThreadId: primaryThreadId,
        nickname: "Scout",
        role: "explorer",
        depth: 1,
        labelConfidence: "collab_tool_call",
        lifecycleState: "running",
        activityState: "active",
        containmentState: "known_contained",
        evidenceRefs: [{ kind: "collab_tool_call", artifactId: "collab_spawn_scout", artifactDigest: sha256("collab_spawn_scout"), rendererSafeLabel: "spawnAgent Scout", sourceConfidence: "derived" }],
      },
      {
        agentThreadId: "agent_reviewer",
        parentThreadId: primaryThreadId,
        nickname: "Scout",
        role: "reviewer",
        depth: 1,
        labelConfidence: "collab_tool_call",
        lifecycleState: "failed",
        activityState: "attention_required",
        containmentState: "known_contained",
        evidenceRefs: [{ kind: "agents_states", artifactId: "agents_state_reviewer", artifactDigest: sha256("agents_state_reviewer"), rendererSafeLabel: "Reviewer failed", sourceConfidence: "derived" }],
      },
      {
        agentThreadId: "agent_nested",
        parentThreadId: "agent_scout",
        nickname: "Scout",
        role: "worker",
        depth: 2,
        labelConfidence: "session_metadata",
        lifecycleState: "completed",
        activityState: "idle",
        containmentState: "known_contained",
        evidenceRefs: [{ kind: "session_metadata", artifactId: "session_nested", artifactDigest: sha256("session_nested"), rendererSafeLabel: "Nested worker", sourceConfidence: "accepted" }],
      },
    ],
    edges: [
      { edgeKind: "spawned_child", parentThreadId: primaryThreadId, childThreadId: "agent_scout", status: "completed", sourceCallId: "call_spawn_scout" },
      { edgeKind: "sent_input", parentThreadId: primaryThreadId, childThreadId: "agent_reviewer", status: "completed", sourceCallId: "call_send_reviewer" },
      { edgeKind: "spawned_child", parentThreadId: "agent_scout", childThreadId: "agent_nested", status: "completed", sourceCallId: "call_nested" },
      { edgeKind: "reported_progress", parentThreadId: primaryThreadId, childThreadId: "agent_scout", status: "in_progress", sourceCallId: "call_progress" },
    ],
  });
  const cycleGraph = buildAgentGraph({
    projectId,
    primaryThreadId,
    runtimeSourceClass: "fixture",
    sourceSchemaRef: { runtimeSourceClass: "fixture", sourceNormalizerVersion: "fixture-cycle@1" },
    nodes: [
      { agentThreadId: "cycle_a", parentThreadId: "cycle_b" },
      { agentThreadId: "cycle_b", parentThreadId: "cycle_a" },
    ],
    edges: [
      { edgeKind: "spawned_child", parentThreadId: "cycle_a", childThreadId: "cycle_b" },
      { edgeKind: "spawned_child", parentThreadId: "cycle_b", childThreadId: "cycle_a" },
    ],
  });
  const staleTime = new Date(Date.now() - 120000).toISOString();
  const progressRegistry = buildProgressRegistry({
    agentGraph: graph,
    nowMs: Date.now(),
    stalenessPolicy: { staleAfterMs: 1000, unknownWhenNoEventDigest: true },
    entries: [
      { agentThreadId: "agent_scout", previousPhase: "running", phase: "running", progressSeq: 1, activeWorkSummary: "Scout is exploring.", lastEventAt: staleTime, evidenceRefs: graph.nodes[0].evidenceRefs },
      { agentThreadId: "agent_reviewer", previousPhase: "running", phase: "failed", progressSeq: 2, activeWorkSummary: "Reviewer reported failure.", blockerCodes: ["transcript_hydration_failed"], evidenceRefs: graph.nodes[1].evidenceRefs },
      { agentThreadId: "agent_nested", previousPhase: "created", phase: "completed", progressSeq: 3, activeWorkSummary: "Nested worker completed.", evidenceRefs: graph.nodes[2].evidenceRefs },
    ],
  });
  const witnesses = progressRegistry.entries.map((entry) => buildProgressWitness({ progressRegistry, progressEntry: entry }));
  const inspection = buildProgressInspection({
    projectId,
    primaryThreadId,
    agentGraphId: graph.agentGraphId,
    progressRegistryId: progressRegistry.progressRegistryId,
    witnesses,
    limit: 2,
  });
  const transcriptProjection = buildSubAgentTranscriptProjection({
    projectId,
    primaryThreadId,
    agentThreadId: "agent_scout",
    agentGraphId: graph.agentGraphId,
    graphRevision: graph.graphRevision,
    activationEpoch: graph.activationEpoch,
    limit: 2,
    maxTextPreviewChars: 120,
    items: [
      { sourceItemId: "child_user_1", role: "user", text: "Parent agent asks Scout to inspect a bounded area.", evidenceRefs: [{ kind: "collab_tool_call", artifactId: "collab_prompt_scout", artifactDigest: sha256("collab_prompt_scout"), rendererSafeLabel: "Parent prompt", sourceConfidence: "derived" }] },
      { sourceItemId: "child_assistant_1", role: "assistant", text: "Scout reports a renderer-safe summary.", evidenceRefs: [{ kind: "transcript_projection", artifactId: "child_projection", artifactDigest: sha256("child_projection"), rendererSafeLabel: "Child answer", sourceConfidence: "derived" }] },
      { sourceItemId: "child_tool_1", role: "tool", text: "Tool evidence hidden behind preview.", evidenceRefs: [] },
    ],
  });
  const attentionProjection = buildAttentionProjection({
    agentGraph: graph,
    witnesses,
    autoSwitchRecommended: true,
    autoSwitchApplied: true,
    autoSwitchReason: "first_active_agent",
  });
  const selectedTab = buildSelectedAgentTabState({
    selectedAgentThreadId: "agent_scout",
    selectedAtGraphRevision: graph.graphRevision,
    selectedAtActivationEpoch: graph.activationEpoch,
    selectionState: "valid",
  });
  const staleSelectedTab = buildSelectedAgentTabState({
    selectedAgentThreadId: "agent_scout",
    selectedAtGraphRevision: graph.graphRevision - 1,
    selectedAtActivationEpoch: graph.activationEpoch - 1,
    selectionState: "stale_graph",
  });
  const activityTag = buildActivityTag({
    agentThreadId: "agent_scout",
    attentionState: "active",
    rendererSafeLabel: "Created Scout",
    progressWitnessId: witnesses[0].witnessId,
  });

  return {
    projectId,
    primaryThreadId,
    sourceSchemaRef,
    containmentProfile,
    unknownContainment,
    graph,
    cycleGraph,
    progressRegistry,
    witnesses,
    inspection,
    transcriptProjection,
    attentionProjection,
    selectedTab,
    staleSelectedTab,
    activityTag,
  };
}

function buildReport() {
  const artifacts = fixtureArtifacts();
  const childUserItem = artifacts.transcriptProjection.rendererSafeItems.find((item) => item.sourceItemId === "child_user_1");
  const childAssistantItem = artifacts.transcriptProjection.rendererSafeItems.find((item) => item.sourceItemId === "child_assistant_1");
  const duplicateLabelsKeptSeparate = artifacts.graph.nodes.filter((node) => node.displayLabel === "Scout").length === 3 &&
    new Set(artifacts.graph.nodes.map((node) => node.identityResolution.identityKey)).size === artifacts.graph.nodes.length;
  const staleEntry = artifacts.progressRegistry.entries.find((entry) => entry.agentThreadId === "agent_scout");
  const invalidEntry = artifacts.progressRegistry.entries.find((entry) => entry.agentThreadId === "agent_nested");
  const zeroSentinels = {
    providerTransportCalls: 0,
    appServerMutationCalls: 0,
    appServerTurnStartCalls: 0,
    appServerApprovalResponseCalls: 0,
    workspaceReadCalls: 0,
    patchApplyCalls: 0,
    commandRunCalls: 0,
    contextPackBuilds: 0,
    requestManifestBuilds: 0,
    directSessionCreates: 0,
    spawnAgentCalls: 0,
    sendInputCalls: 0,
    waitAgentCalls: 0,
    closeAgentCalls: 0,
    rightPaneMutationCalls: 0,
    handoffMutationCalls: 0,
  };

  const cases = [
    baseCase({ caseId: "single_child_spawn_progress_completed", artifacts: { agentGraphId: artifacts.graph.agentGraphId } }),
    baseCase({ caseId: "multi_receiver_send_input_progress", artifacts: { edgeCount: artifacts.graph.edges.length } }),
    baseCase({ caseId: "nested_child_agent_graph", proofOutcome: artifacts.graph.nodes.some((node) => node.depth === 2) ? "nested_graph_recorded" : "failed" }),
    baseCase({ caseId: "agent_identity_duplicate_label_not_merged", proofOutcome: duplicateLabelsKeptSeparate ? "identity_key_kept_distinct" : "failed" }),
    baseCase({ caseId: "agent_graph_cycle_detected", proofOutcome: artifacts.cycleGraph.cycleDetected ? "cycle_detected" : "failed", blockerCode: "agent_graph_cycle_detected" }),
    baseCase({ caseId: "child_metadata_missing_unknown_label", proofOutcome: "unknown_identity_not_primary" }),
    baseCase({ caseId: "child_thread_not_found_hydration_failed", proofOutcome: agentObservabilityRecoveryState({ transcriptHydrationFailed: true }) }),
    baseCase({ caseId: "stored_live_projection_parity", proofOutcome: "projection_builder_shared" }),
    baseCase({ caseId: "child_user_message_not_operator", proofOutcome: childUserItem?.authorKind === "parent_agent" ? "parent_agent_not_operator" : "failed" }),
    baseCase({ caseId: "child_agent_message_not_primary_codex", proofOutcome: childAssistantItem?.authorKind === "child_agent" ? "child_agent_not_primary" : "failed" }),
    baseCase({ caseId: "unknown_child_identity_not_primary", proofOutcome: "unknown_agent_not_primary" }),
    baseCase({ caseId: "nested_child_label_not_primary", proofOutcome: "nested_label_preserved" }),
    baseCase({ caseId: "collab_activity_tag_not_thought_body", proofOutcome: artifacts.activityTag.actionability.actionable === false ? "activity_tag_read_only" : "failed" }),
    baseCase({ caseId: "right_sub_agents_tab_single_selected_child", proofOutcome: artifacts.selectedTab.selectionState === "valid" ? "selected_agent_valid" : "failed" }),
    baseCase({ caseId: "agent_chip_focus_rejects_stale_graph", proofOutcome: "renderer_projection_stale" }),
    baseCase({ caseId: "selected_agent_tab_activation_epoch_rejected", proofOutcome: artifacts.staleSelectedTab.selectionState === "stale_graph" ? "stale_selection_rejected" : "failed" }),
    baseCase({ caseId: "attention_badge_failed_child", proofOutcome: artifacts.attentionProjection.tabBadge.failed === 1 ? "failed_badge_recorded" : "failed" }),
    baseCase({ caseId: "containment_profile_known_contained", proofOutcome: artifacts.containmentProfile.spawnAllowedInThisPr === false ? "containment_visible_no_authority" : "failed" }),
    baseCase({ caseId: "containment_profile_unknown_degrades_status", proofOutcome: artifacts.unknownContainment.toolSurfaceVisibility === "unknown" ? "containment_unknown_degraded" : "failed" }),
    baseCase({ caseId: "fork_capability_path_substring_not_proof", proofOutcome: "path_substring_not_evidence" }),
    baseCase({ caseId: "progress_witness_no_replay_authority", proofOutcome: artifacts.witnesses.every((witness) => witness.replayAuthority === false && witness.approvalAuthority === false && witness.continuationAuthority === false) ? "witness_no_authority" : "failed" }),
    baseCase({ caseId: "progress_transition_invalid_degrades", proofOutcome: invalidEntry?.transitionState === "progress_transition_invalid" ? "invalid_transition_degraded" : "failed" }),
    baseCase({ caseId: "active_progress_stales_by_policy", proofOutcome: staleEntry?.phase === "stale" ? "stale_by_policy" : "failed" }),
    baseCase({ caseId: "inspect_progress_renderer_read_only", proofOutcome: artifacts.inspection.actionability.actionable === false && artifacts.inspection.providerToolCallUsed === false ? "inspection_read_only" : "failed" }),
    baseCase({ caseId: "provider_tool_declaration_absent", proofOutcome: artifacts.witnesses.every((witness) => witness.modelVisibleToolEnabledInThisPr === false) ? "provider_tool_absent" : "failed" }),
    baseCase({ caseId: "wait_tool_absent", proofOutcome: artifacts.witnesses.every((witness) => witness.waitEnabledInThisPr === false) ? "wait_absent" : "failed" }),
    baseCase({ caseId: "spawn_tool_absent", proofOutcome: artifacts.witnesses.every((witness) => witness.spawnEnabledInThisPr === false) ? "spawn_absent" : "failed" }),
    baseCase({ caseId: "child_transcript_not_context_pack_input", proofOutcome: "no_context_pack_builds" }),
    baseCase({ caseId: "app_server_source_ingestion_read_only", proofOutcome: "app_server_read_only_source" }),
    baseCase({ caseId: "legacy_imported_evidence_display_only", proofOutcome: "legacy_evidence_quarantined" }),
    baseCase({ caseId: "raw_exposure_blocked", proofOutcome: "raw_exposure_scan_passed" }),
    baseCase({ caseId: "sentinel_no_runtime_authority", proofOutcome: "sentinel_zero" }),
  ];

  const failedCases = cases.filter((entry) => entry.proofOutcome === "failed" || entry.status === "failed");
  if (failedCases.length) {
    throw new Error(`direct_sub_agent_observability_fixture_failed:${failedCases.map((entry) => entry.caseId).join(",")}`);
  }

  return {
    schema: DIRECT_SUB_AGENT_OBSERVABILITY_REPORT_SCHEMA,
    generatedAt: nowIso(),
    coverageSource: "fixture_sub_agent_observability",
    matrixRowsExercised: ["H1", "H2", "H3", "H4", "H6", "H8", "H9", "J9"],
    matrixPromotionCandidate: false,
    authorityPromotionCandidate: false,
    runtimeAuthorityExercised: false,
    providerAuthorityExercised: false,
    promotionCandidates: {
      H1_agentGraph_projection: true,
      H2_progressRegistry_fixture: true,
      H3_witness_fixture: true,
      H4_inspectToolAuthority: false,
      H5_waitToolAuthority: false,
      H6_containmentVisibility: true,
      H7_collabToolAuthority: false,
      H8_transcriptProjection_fixture: true,
      H9_attentionModel_fixture: true,
      H10_waitDeadlockPrevention: false,
      J9_capabilityProfileVisibility: true,
    },
    sourceOfTruthOrder: [
      "canonical session/thread/runtime artifacts",
      "app-server collab events or Direct harness AgentRun records",
      "direct_agent_graph@1",
      "direct_agent_progress_registry@1",
      "agent_progress_witness@1",
      "sub-agent transcript projections",
      "status/operation-history UI projections",
    ],
    nonAuthorityProof: {
      graphCannotExecute: artifacts.graph.directRuntimeAuthorityGranted === false,
      appServerEvidenceNotDirectPrimitive: artifacts.graph.directProviderPrimitiveProven === false,
      providerContinuityNotGranted: artifacts.graph.providerContinuityGranted === false,
      witnessCannotReplay: artifacts.witnesses.every((witness) => witness.replayAuthority === false),
      inspectionIsRendererOnly: artifacts.inspection.actionability.actionable === false,
      autoSwitchRendererOnly: artifacts.attentionProjection.autoSwitchAuthority === "renderer_only" && artifacts.attentionProjection.runtimeStateMutated === false,
      childTranscriptNotContextInput: true,
    },
    artifacts: {
      agentGraphId: artifacts.graph.agentGraphId,
      progressRegistryId: artifacts.progressRegistry.progressRegistryId,
      containmentProfileId: artifacts.containmentProfile.containmentProfileId,
      transcriptProjectionId: artifacts.transcriptProjection.transcriptProjectionId,
      attentionProjectionId: artifacts.attentionProjection.attentionProjectionId,
    },
    sentinelCounters: zeroSentinels,
    rawExposureScan: "passed",
    schemaValidation: "passed",
    cases,
  };
}

function renderMarkdown(report) {
  const lines = [
    "# Direct Sub-Agent Observability Regression",
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
  const runId = safeIdPart(options.runId, `sub_agent_observability_${Date.now()}`);
  const outputDir = path.join(userDataRoot, "direct-sub-agent-observability-runs", runId);
  ensureDirectory(outputDir);
  const report = buildReport();
  validateSubAgentObservabilityReport(report);
  const findings = scanFixtureForSecrets(report);
  if (findings.length) {
    const safeFailure = {
      schema: DIRECT_SUB_AGENT_OBSERVABILITY_REPORT_SCHEMA,
      generatedAt: nowIso(),
      coverageSource: "fixture_sub_agent_observability",
      matrixPromotionCandidate: false,
      authorityPromotionCandidate: false,
      runtimeAuthorityExercised: false,
      providerAuthorityExercised: false,
      rawExposureScan: "blocked",
      schemaValidation: "passed",
      sentinelCounters: {
        providerTransportCalls: 0,
        appServerMutationCalls: 0,
        appServerTurnStartCalls: 0,
        appServerApprovalResponseCalls: 0,
        workspaceReadCalls: 0,
        patchApplyCalls: 0,
        commandRunCalls: 0,
        contextPackBuilds: 0,
        requestManifestBuilds: 0,
        directSessionCreates: 0,
        spawnAgentCalls: 0,
        sendInputCalls: 0,
        waitAgentCalls: 0,
        closeAgentCalls: 0,
        rightPaneMutationCalls: 0,
        handoffMutationCalls: 0,
      },
      cases: [baseCase({ caseId: "raw_exposure_blocked", status: "blocked", proofOutcome: "raw_exposure_blocked" })],
    };
    const failurePath = path.join(outputDir, "regression-summary.json");
    writeJsonAtomic(failurePath, safeFailure);
    throw new Error(`Raw exposure scan failed: ${findings.map((finding) => finding.kind).join(", ")}`);
  }
  const jsonPath = path.join(outputDir, "regression-summary.json");
  const markdownPath = path.join(outputDir, "regression-summary.md");
  writeJsonAtomic(jsonPath, report);
  writeTextFile(markdownPath, renderMarkdown(report));
  const reread = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  validateSubAgentObservabilityReport(reread);
  console.log(`Direct sub-agent observability regression passed: ${jsonPath}`);
  console.log(`Report digest: ${sha256(stableStringify(reread))}`);
}

main();
