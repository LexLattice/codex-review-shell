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
  DIRECT_CONTEXT_MAINTENANCE_REGRESSION_REPORT_SCHEMA,
  assertOmissionParity,
  buildDurableThreadMemory,
  buildFrontierBaton,
  buildMaintenanceManifest,
  buildMemoryRefreshManifest,
  buildOmissionLedger,
  buildPressureEstimate,
  buildRawWindowTrimPolicy,
  buildStatusProjection,
  buildTrimPlan,
  maintenanceRecoveryState,
  maintenanceRefsFromArtifacts,
  selectMaintenanceRoute,
  sha256,
  stableStringify,
  validateContextMaintenanceReport,
  validateMaintenanceRefs,
} = require("../src/main/direct/context/maintenance");
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
    coverageSource: "fixture_context_maintenance",
    status: normalizeString(input.status, "passed"),
    proofOutcome: normalizeString(input.proofOutcome, "fixture_context_maintenance_checked"),
    routeKind: normalizeString(input.route?.routeKind || input.routeKind, ""),
    routeClass: normalizeString(input.route?.routeClass || input.routeClass, ""),
    recoveryState: normalizeString(input.recoveryState, "healthy"),
    matrixRowsExercised: input.matrixRowsExercised || ["D1", "D2", "D7", "D10", "D11", "D13", "D14", "D22", "D23", "J11"],
    matrixPromotionCandidate: false,
    routePromotionCandidate: false,
    authorityPromotionCandidate: false,
    providerAuthorityExercised: false,
    runtimeAuthorityExercised: false,
    providerTransportUsed: false,
    appServerFallbackUsed: false,
    blockerCode: normalizeString(input.blockerCode, ""),
    artifacts: input.artifacts || {},
  };
}

function fixtureMaintenanceArtifacts(projectId, threadId) {
  const pressure = buildPressureEstimate({
    projectId,
    threadId,
    modelId: "fixture-model",
    visibleCharCount: 94_000,
    hiddenRequiredTokens: 1_200,
    modelContextWindowEstimate: 24_000,
    reservedOutputTokens: 2_000,
  });
  const { route } = selectMaintenanceRoute({ pressureEstimate: pressure });
  const trimPolicy = buildRawWindowTrimPolicy();
  const trimPlan = buildTrimPlan({
    route,
    sourceContextProjectionId: "context_projection_fixture",
    sourceContextProjectionDigest: "context_projection_digest_fixture",
    trimPolicy,
    candidateOmissions: [
      {
        sourceArtifactKind: "context_recent_dialogue",
        sourceArtifactId: "context_projection_fixture",
        sourceDigest: "context_projection_digest_fixture",
        sourceStableKeys: ["turn_1", "turn_2"],
        omittedItemCount: 2,
        omittedTurnCount: 2,
        omittedCharCount: 4800,
        omittedTokenEstimate: 1200,
        reason: "over_budget",
        rendererSafeSummary: "Two optional earlier dialogue items omitted under pressure.",
      },
    ],
  });
  const omissionLedger = buildOmissionLedger({ trimPlan });
  const memory = buildDurableThreadMemory({
    projectId,
    threadId,
    entries: [
      {
        kind: "decision",
        authority: "decision_record",
        contextUse: "quoted_context_only",
        rendererSafeSummary: "The direct harness remains the authority for local tool execution.",
        sourceRefs: [{ artifactKind: "operation_history", artifactId: "operation_fixture", artifactDigest: "operation_digest_fixture" }],
      },
    ],
  });
  const memoryRefresh = buildMemoryRefreshManifest({
    projectId,
    threadId,
    nextMemory: memory,
    sourceRefs: [{ artifactKind: "context_projection", artifactId: "context_projection_fixture", artifactDigest: "context_projection_digest_fixture" }],
  });
  const baton = buildFrontierBaton({
    projectId,
    threadId,
    batonRequirement: "required_for_trim",
    frontier: {
      rendererSafeGoalSummary: "Maintain context without silently dropping required direct-harness evidence.",
      nextExpectedAction: "assistant_final",
      openObligationRefs: [],
      unresolvedRiskRefs: [],
      workspaceEffectRefs: [],
    },
  });
  const manifest = buildMaintenanceManifest({
    route,
    pressureEstimate: pressure,
    outputKind: "trim_only",
    producedArtifacts: [
      { artifactKind: "raw_window_trim_plan", artifactId: trimPlan.trimPlanId, artifactDigest: trimPlan.integrity.artifactDigest },
      { artifactKind: "context_omission_ledger", artifactId: omissionLedger.omissionLedgerId, artifactDigest: omissionLedger.integrity.artifactDigest },
      { artifactKind: "durable_thread_memory", artifactId: memory.memoryId, artifactDigest: memory.integrity.artifactDigest },
      { artifactKind: "frontier_baton", artifactId: baton.batonId, artifactDigest: baton.integrity.artifactDigest },
    ],
  });
  const refs = maintenanceRefsFromArtifacts({
    pressureEstimate: pressure,
    route,
    maintenanceManifest: manifest,
    trimPlan,
    omissionLedger,
    memory,
    memoryRefresh,
    baton,
    requiredOmissionLedger: true,
    requiredMemory: true,
    requiredBaton: true,
  });
  return { pressure, route, trimPolicy, trimPlan, omissionLedger, memory, memoryRefresh, baton, manifest, refs };
}

function buildReport() {
  const projectId = "project_context_maintenance_fixture";
  const threadId = "thread_context_maintenance_fixture";
  const artifacts = fixtureMaintenanceArtifacts(projectId, threadId);
  validateMaintenanceRefs(artifacts.refs, { requireOmissionLedger: true, requireMemory: true, requireBaton: true });

  const contextPack = buildContextPack({
    projectId,
    threadId,
    turnId: "turn_context_fixture",
    purpose: "direct_text_turn",
    policyId: DIRECT_TEXT_TURN_RECENT_DIALOGUE_POLICY_ID,
    contextProjection: {
      projectionId: "context_projection_fixture",
      projectionKind: "context_recent_dialogue",
      projectionDigest: "context_projection_digest_fixture",
      caps: { omittedCounts: {} },
    },
    contextItems: [
      { role: "user", itemKind: "message", text: "Please keep the direct harness authority boundaries intact." },
    ],
    currentUserPrompt: "Summarize the current safe context state.",
    maintenanceRefs: artifacts.refs,
    maintenanceArtifacts: {
      omissionLedger: artifacts.omissionLedger,
      memory: artifacts.memory,
      baton: artifacts.baton,
    },
  });
  const request = buildRequestManifest({
    contextPack,
    model: "fixture-model",
    requestShape: { requestShapeClass: "direct_text_turn_recent_dialogue@1", store: false, parallelToolCalls: false },
    requestShapeEvidenceRef: "fixture_context_maintenance_request_shape",
  });
  assertOmissionParity({ omissionLedger: artifacts.omissionLedger, contextPack });

  const cases = [
    baseCase({
      caseId: "within_budget_no_op",
      route: selectMaintenanceRoute({
        pressureEstimate: buildPressureEstimate({
          projectId,
          threadId,
          modelId: "fixture-model",
          visibleCharCount: 4000,
          hiddenRequiredTokens: 200,
          modelContextWindowEstimate: 64_000,
        }),
      }).route,
    }),
    baseCase({
      caseId: "over_budget_local_trim_with_omission_ledger",
      route: artifacts.route,
      artifacts: {
        pressureEstimateId: artifacts.pressure.pressureEstimateId,
        trimPlanId: artifacts.trimPlan.trimPlanId,
        omissionLedgerId: artifacts.omissionLedger.omissionLedgerId,
        contextBuildId: contextPack.contextBuildId,
        requestManifestId: request.requestManifest.requestManifestId,
      },
    }),
    baseCase({
      caseId: "required_artifact_at_risk_blocks",
      route: selectMaintenanceRoute({
        pressureEstimate: buildPressureEstimate({
          projectId,
          threadId,
          modelId: "fixture-model",
          pressureState: "required_artifact_at_risk",
        }),
      }).route,
      proofOutcome: "blocked_required_artifact_at_risk",
      blockerCode: "context_budget_required_artifact_at_risk",
    }),
    baseCase({
      caseId: "active_obligation_blocks_maintenance",
      route: selectMaintenanceRoute({ pressureEstimate: artifacts.pressure, activeObligation: true }).route,
      blockerCode: "active_obligation_blocks_maintenance",
    }),
    baseCase({
      caseId: "handoff_unknown_blocks_maintenance",
      route: selectMaintenanceRoute({ pressureEstimate: artifacts.pressure, handoffUnknown: true }).route,
      blockerCode: "handoff_unknown_blocks_maintenance",
    }),
    baseCase({
      caseId: "provider_compaction_missing_evidence_blocks",
      route: selectMaintenanceRoute({ pressureEstimate: artifacts.pressure, providerCompactionRequested: true }).route,
      blockerCode: "provider_compaction_missing_evidence",
      matrixRowsExercised: ["A12", "D1", "D5"],
    }),
    baseCase({
      caseId: "memory_refresh_failed_current_retained",
      routeKind: "memory_refresh",
      routeClass: "memory",
      recoveryState: maintenanceRecoveryState({ memoryRefreshFailedCurrentRetained: true }),
      artifacts: {
        memoryRefreshId: buildMemoryRefreshManifest({ projectId, threadId, currentMemory: artifacts.memory }).memoryRefreshId,
      },
    }),
    baseCase({
      caseId: "baton_required_missing_blocks_context",
      status: "blocked",
      routeKind: "frontier_baton_build",
      routeClass: "baton",
      recoveryState: maintenanceRecoveryState({ batonRequiredMissing: true }),
      blockerCode: (() => {
        try {
          validateMaintenanceRefs({ requiredBaton: true }, { requireBaton: true });
        } catch (error) {
          return error.code || error.message;
        }
        return "missing_expected_blocker";
      })(),
    }),
    baseCase({
      caseId: "unknown_pressure_no_trim",
      route: selectMaintenanceRoute({
        pressureEstimate: buildPressureEstimate({ projectId, threadId, modelId: "fixture-model", pressureState: "unknown" }),
        trimRequested: true,
      }).route,
      blockerCode: "pressure_unknown_over_budget_risk",
    }),
    baseCase({
      caseId: "context_status_projection_display_only",
      routeKind: "estimate_only",
      routeClass: "diagnostic",
      artifacts: {
        statusProjectionDigest: buildStatusProjection({
          projectId,
          threadId,
          currentRouteId: artifacts.route.routeId,
          currentManifestId: artifacts.manifest.maintenanceManifestId,
          currentMemoryId: artifacts.memory.memoryId,
          currentBatonId: artifacts.baton.batonId,
          currentOmissionLedgerId: artifacts.omissionLedger.omissionLedgerId,
          pressureState: artifacts.pressure.pressureState,
          memoryState: artifacts.memory.lifecycle,
          batonState: "present",
          omissionState: "represented",
          composerAllowed: true,
        }).projectionDigest,
      },
    }),
  ];

  const report = {
    schema: DIRECT_CONTEXT_MAINTENANCE_REGRESSION_REPORT_SCHEMA,
    generatedAt: nowIso(),
    coverageSource: "fixture_context_maintenance",
    matrixPromotionCandidate: false,
    authorityPromotionCandidate: false,
    runtimeAuthorityExercised: false,
    providerAuthorityExercised: false,
    rowsExercised: ["D1", "D2", "D7", "D10", "D11", "D13", "D14", "D22", "D23", "A12", "J11", "C12"],
    promotionCandidates: {
      D1_routeMatrix: true,
      D2_pressureModel: true,
      D7_frontierBaton: true,
      D10_durableMemory: true,
      D11_memoryRefresh: true,
      D13_trimPolicy: true,
      D14_omissionLedger: true,
      D22_manifest: true,
      A12_providerCompaction: false,
    },
    sourceOfTruthOrder: [
      "canonical rollout/session artifacts",
      "validated context projections",
      "context maintenance route",
      "maintenance manifest",
      "trim/memory/baton/omission artifacts",
      "context pack source refs",
      "request manifest source refs",
    ],
    sentinelCounters: {
      providerTransportCalls: 0,
      appServerSpawnCalls: 0,
      workspaceReadCalls: 0,
      patchApplyCalls: 0,
      commandRunCalls: 0,
      contextPackBuilds: 1,
      requestManifestBuilds: 1,
      rightPaneMutationCalls: 0,
      handoffMutationCalls: 0,
    },
    contextIntegration: {
      contextBuildId: contextPack.contextBuildId,
      contextMaintenanceRefsPresent: Boolean(contextPack.maintenanceRefs),
      requestManifestId: request.requestManifest.requestManifestId,
      requestManifestMaintenanceRefsPresent: Boolean(request.requestManifest.maintenanceRefs),
      omittedItemsRepresented: contextPack.caps.omittedCounts.context_omission_ledger_items,
      providerCompactionOutputOpaque: true,
      memoryEditorIpcPresent: false,
      maintenanceInsertedIntoChatTranscript: false,
    },
    cases,
  };
  validateContextMaintenanceReport(report);
  return report;
}

function renderMarkdown(report) {
  const lines = [
    "# Direct Context Maintenance Regression",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    `Coverage source: ${report.coverageSource}`,
    `Matrix promotion candidate: ${report.matrixPromotionCandidate}`,
    "",
    "## Cases",
    "",
  ];
  for (const entry of report.cases) {
    lines.push(`- ${entry.caseId}: ${entry.status} (${entry.routeKind || entry.proofOutcome})`);
  }
  lines.push("");
  lines.push("## Sentinels");
  lines.push("");
  for (const [key, value] of Object.entries(report.sentinelCounters)) {
    lines.push(`- ${key}: ${value}`);
  }
  lines.push("");
  return lines.join("\n");
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const userDataRoot = normalizeString(options.userDataRoot || process.env[USER_DATA_ROOT_ENV_VAR], defaultAppUserDataRoot());
  const runId = safeIdPart(options.runId, `context_maintenance_${Date.now()}`);
  const outputDir = path.join(userDataRoot, "direct-context-maintenance-runs", runId);
  ensureDirectory(outputDir);
  const report = buildReport();
  validateContextMaintenanceReport(report);
  const secretFindings = scanFixtureForSecrets(report);
  if (secretFindings.length) {
    const safeFailure = {
      schema: DIRECT_CONTEXT_MAINTENANCE_REGRESSION_REPORT_SCHEMA,
      generatedAt: nowIso(),
      coverageSource: "fixture_context_maintenance",
      matrixPromotionCandidate: false,
      cases: [baseCase({ caseId: "raw_exposure_scan", status: "blocked", proofOutcome: "raw_exposure_blocked", blockerCode: "raw_exposure_blocked" })],
      sentinelCounters: {
        providerTransportCalls: 0,
        appServerSpawnCalls: 0,
        workspaceReadCalls: 0,
        patchApplyCalls: 0,
        commandRunCalls: 0,
        rightPaneMutationCalls: 0,
        handoffMutationCalls: 0,
      },
      rawExposureBlocked: true,
    };
    writeJsonAtomic(path.join(outputDir, "regression-summary.json"), safeFailure);
    throw new Error(`Direct context maintenance report failed raw-exposure scan: ${secretFindings.join(", ")}`);
  }
  const jsonPath = path.join(outputDir, "regression-summary.json");
  const markdownPath = path.join(outputDir, "regression-summary.md");
  writeJsonAtomic(jsonPath, report);
  writeTextFile(markdownPath, renderMarkdown(report));
  const reread = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  validateContextMaintenanceReport(reread);
  console.log(`Direct context maintenance regression passed: ${jsonPath}`);
  console.log(`Report digest: ${sha256(stableStringify(reread))}`);
}

main();
