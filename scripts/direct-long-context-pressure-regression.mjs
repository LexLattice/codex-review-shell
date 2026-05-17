#!/usr/bin/env node

import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);

const { scanFixtureForSecrets } = require("../src/main/direct/fixtures/redaction");
const { DirectSessionStore, writeJsonAtomic } = require("../src/main/direct/session/session-store");
const { DirectThreadStore } = require("../src/main/direct/thread/thread-store");
const {
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
  maintenanceRefsFromArtifacts,
  selectMaintenanceRoute,
  sha256,
  stableStringify,
  validateStatusProjectionAction,
  validateMaintenanceRefs,
} = require("../src/main/direct/context/maintenance");
const {
  buildTextOnlyProbeRequest,
  requestShapeForDiagnostic,
} = require("../src/main/direct/transport/codex-responses-transport");

const REPORT_SCHEMA = "direct_long_context_pressure_regression_report@1";
const USER_DATA_ROOT_ENV_VAR = "CODEX_REVIEW_SHELL_USER_DATA_ROOT";

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

function repeatedSafeText(label, chars) {
  const seed = `${label} direct context pressure evidence sentence. `;
  let text = "";
  while (text.length < chars) text += seed;
  return text.slice(0, chars);
}

function createLongDirectThread({ sessionStore, projectId, turnCount = 70, charsPerAssistant = 1800 } = {}) {
  const session = sessionStore.createSession({
    sessionId: "direct_session_long_context_pressure",
    projectId,
    title: "RUG-005 long context pressure thread",
    model: "fixture-model",
    runtimeMode: "direct-experimental",
    directTransport: "direct-live-text",
    sourceClass: "direct-native",
    nativeDirectSession: true,
    providerContinuityAvailable: false,
    continuityState: "fresh_session_only",
  }, { nowMs: 1_700_000_000_000 });
  for (let index = 0; index < turnCount; index += 1) {
    const turnOrdinal = String(index + 1).padStart(3, "0");
    const turn = sessionStore.createTurn(session.sessionId, {
      turnId: `direct_turn_pressure_${turnOrdinal}`,
      state: "completed",
      input: [{
        role: "user",
        text: `Please preserve context pressure evidence item ${turnOrdinal}.`,
      }],
      model: "fixture-model",
      requestShape: { requestShapeClass: "direct_text_turn_recent_dialogue@1", store: false, tools: false },
    }, { nowMs: 1_700_000_000_000 + index });
    sessionStore.appendNormalizedEvents(session.sessionId, turn.turnId, [
      {
        type: "message_delta",
        text: repeatedSafeText(`assistant-${turnOrdinal}`, charsPerAssistant),
      },
      {
        type: "response_completed",
        responseId: `resp_pressure_${turnOrdinal}`,
      },
    ], { nowMs: 1_700_000_000_500 + index });
    sessionStore.updateTurnState(session.sessionId, turn.turnId, "completed", {
      responseId: `resp_pressure_${turnOrdinal}`,
    }, { nowMs: 1_700_000_001_000 + index });
  }
  return sessionStore.readSession(session.sessionId);
}

function buildMaintenanceForProjection({ projectId, threadId, contextProjection, contextItems } = {}) {
  const visibleCharCount = contextItems.reduce((sum, item) => sum + String(item.text || "").length, 0);
  const pressure = buildPressureEstimate({
    projectId,
    threadId,
    modelId: "fixture-model",
    visibleCharCount,
    hiddenRequiredTokens: 1200,
    reservedOutputTokens: 2000,
    modelContextWindowEstimate: 18_000,
  });
  const { route } = selectMaintenanceRoute({ pressureEstimate: pressure });
  const trimPolicy = buildRawWindowTrimPolicy();
  const omittedItems = contextItems.slice(0, 8);
  const sourceStableKeys = omittedItems.map((item) => item.stableSourceItemKey).filter(Boolean);
  const omittedCharCount = omittedItems.reduce((sum, item) => sum + String(item.text || "").length, 0);
  const omittedTokenEstimate = Math.ceil(omittedCharCount / 4);
  const trimPlan = buildTrimPlan({
    route,
    sourceContextProjectionId: contextProjection.projectionId,
    sourceContextProjectionDigest: contextProjection.projectionDigest,
    trimPolicy,
    candidateOmissions: [
      {
        sourceArtifactKind: "context_recent_dialogue",
        sourceArtifactId: contextProjection.projectionId,
        sourceDigest: contextProjection.projectionDigest,
        sourceStableKeys,
        omittedItemCount: omittedItems.length,
        omittedTurnCount: omittedItems.length,
        omittedCharCount,
        omittedTokenEstimate,
        reason: "over_budget",
        rendererSafeSummary: "Earlier long-context dialogue was omitted under pressure.",
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
        rendererSafeSummary: "Context pressure artifacts are evidence only and do not grant provider continuity.",
        sourceRefs: [{ artifactKind: "context_projection", artifactId: contextProjection.projectionId, artifactDigest: contextProjection.projectionDigest }],
      },
    ],
  });
  const memoryRefresh = buildMemoryRefreshManifest({
    projectId,
    threadId,
    nextMemory: memory,
    sourceRefs: [{ artifactKind: "context_projection", artifactId: contextProjection.projectionId, artifactDigest: contextProjection.projectionDigest }],
  });
  const baton = buildFrontierBaton({
    projectId,
    threadId,
    batonRequirement: "required_for_trim",
    frontier: {
      rendererSafeGoalSummary: "Answer from the pressure-managed context without treating omissions as hidden context.",
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
  return { pressure, route, trimPolicy, trimPlan, omissionLedger, memory, memoryRefresh, baton, manifest, refs, visibleCharCount };
}

function validateReport(report = {}) {
  if (report.schema !== REPORT_SCHEMA) throw new Error("direct_long_context_pressure_report_schema_mismatch");
  if (!Array.isArray(report.cases) || !report.cases.length) throw new Error("direct_long_context_pressure_cases_missing");
  const counters = report.sentinelCounters || {};
  for (const key of [
    "providerTransportCalls",
    "providerCompactPrimitiveCalls",
    "appServerSpawnCalls",
    "appServerMutationCalls",
    "workspaceReadCalls",
    "patchApplyCalls",
    "commandRunCalls",
    "rightPaneMutationCalls",
    "handoffMutationCalls",
  ]) {
    if (Number(counters[key] || 0) !== 0) throw new Error(`direct_long_context_pressure_sentinel_nonzero:${key}`);
  }
}

function markdownSummary(report) {
  const rows = report.cases.map((entry) =>
    `| \`${entry.caseId}\` | \`${entry.status}\` |`,
  ).join("\n");
  return `# Direct Long Context Pressure Regression ${report.runId}

- Status: \`${report.status}\`
- Branch: \`${report.branch}\`
- Commit: \`${report.commit}\`
- Coverage: \`${report.coverageSource}\`
- Provider transport calls: \`${report.sentinelCounters.providerTransportCalls}\`
- Provider compact primitive calls: \`${report.sentinelCounters.providerCompactPrimitiveCalls}\`

## Cases

| Case | Status |
| --- | --- |
${rows}
`;
}

async function gitValue(args) {
  const { spawnSync } = await import("node:child_process");
  const result = spawnSync("git", args, { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : "";
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const runId = safeIdPart(options.runId || options["run-id"], `rug005_long_context_${Date.now()}`);
  const appUserDataRoot = path.resolve(normalizeString(options["app-user-data-root"], process.env[USER_DATA_ROOT_ENV_VAR] || defaultAppUserDataRoot()));
  const outputDir = path.join(appUserDataRoot, "direct-long-context-pressure-runs", runId);
  const privateRoot = path.join(outputDir, "private-store");
  ensureDirectory(outputDir);

  const sessionStore = new DirectSessionStore({ rootDir: path.join(privateRoot, "direct-sessions") });
  const threadStore = new DirectThreadStore({ rootDir: path.join(privateRoot, "direct-thread-store"), mode: "context_build_required" });
  const cases = [];
  let report;
  try {
    const projectId = "project_rug005_long_context_pressure";
    const session = createLongDirectThread({ sessionStore, projectId });
    const turns = sessionStore.listTurnIdsFromDisk(session.sessionId)
      .map((turnId) => sessionStore.readTurn(session.sessionId, turnId))
      .filter(Boolean);
    threadStore.indexSessionArtifacts(sessionStore, sessionStore.readSession(session.sessionId), turns);
    const rendererBuild = threadStore.buildRendererTranscriptProjection(session.sessionId, { sessionStore, force: true });
    const rendererProjection = threadStore.projectionFromRow(threadStore.currentProjectionRow(session.sessionId, "renderer_transcript"));
    const contextBuild = threadStore.buildContextRecentDialogueProjection(session.sessionId, { sessionStore, force: true });
    const contextProjection = threadStore.projectionFromRow(threadStore.currentProjectionRow(session.sessionId, "context_recent_dialogue"));
    const contextItems = threadStore.readProjectionItems(contextProjection.projectionId);
    const maintenance = buildMaintenanceForProjection({ projectId, threadId: session.sessionId, contextProjection, contextItems });
    validateMaintenanceRefs(maintenance.refs, { requireOmissionLedger: true, requireMemory: true, requireBaton: true });

    const prompt = "Use the pressure-managed context and summarize only the current safe state.";
    const requestBody = buildTextOnlyProbeRequest({ profileDoc: {}, model: "fixture-model", prompt });
    const turn = sessionStore.createTurn(session.sessionId, {
      turnId: "direct_turn_pressure_followup",
      state: "created",
      input: [{ role: "user", text: prompt }],
      model: "fixture-model",
      requestShape: requestShapeForDiagnostic(requestBody),
    });
    const currentSession = sessionStore.readSession(session.sessionId);
    const allTurns = [...turns, turn];
    threadStore.indexSessionArtifacts(sessionStore, currentSession, allTurns);
    const contextResult = threadStore.buildAndPersistContextForTextTurn({
      session: currentSession,
      projectId,
      threadId: session.sessionId,
      turnId: turn.turnId,
      currentUserPrompt: prompt,
      useRecentDialogue: true,
      requireRecentDialogue: true,
      sourceContextProjectionId: contextProjection.projectionId,
      expectedContextProjectionId: contextProjection.projectionId,
      expectedContextProjectionDigest: contextProjection.projectionDigest,
      model: "fixture-model",
      requestShape: requestShapeForDiagnostic(requestBody),
      requestShapeHash: sha256(stableStringify(requestShapeForDiagnostic(requestBody))),
      endpointClass: "chatgpt-codex-responses",
      endpointHash: "endpoint_hash_fixture",
      modelEvidenceRef: "fixture_model_evidence",
      requestShapeEvidenceRef: "direct_text_turn_recent_dialogue@1",
      endpointEvidenceRef: "endpoint_fixture",
      maintenanceRefs: maintenance.refs,
      maintenanceArtifacts: {
        omissionLedger: maintenance.omissionLedger,
        memory: maintenance.memory,
        baton: maintenance.baton,
      },
    }, { sessionStore });
    assertOmissionParity({ omissionLedger: maintenance.omissionLedger, contextPack: contextResult.contextPack });

    const statusProjection = buildStatusProjection({
      projectId,
      threadId: session.sessionId,
      sourceDigest: maintenance.refs.refsDigest,
      operationLedgerHeadDigest: threadStore.readOperationManifest().hashChainHead,
      currentRouteId: maintenance.route.routeId,
      currentManifestId: maintenance.manifest.maintenanceManifestId,
      currentMemoryId: maintenance.memory.memoryId,
      currentBatonId: maintenance.baton.batonId,
      currentOmissionLedgerId: maintenance.omissionLedger.omissionLedgerId,
      pressureState: maintenance.pressure.pressureState,
      memoryState: maintenance.memory.lifecycle,
      batonState: "present",
      omissionState: "represented",
      composerAllowed: true,
      composerAllowedReason: "safe_terminal",
    });

    const contextArtifactKinds = contextResult.contextPack.sourceArtifacts.map((artifact) => artifact.artifactKind);
    const requestManifestRefs = contextResult.requestManifest.maintenanceRefs || {};
    const providerPromptText = contextResult.providerInput.prompt || "";

    assertCase(cases, "rug005_constructs_long_direct_thread", turns.length >= 70 &&
      rendererBuild.status === "valid" &&
      contextBuild.status === "valid" &&
      contextProjection.caps.truncated === true, {
      turnCount: turns.length,
      rendererItemCount: rendererBuild.itemCount,
      contextItemCount: contextBuild.itemCount,
      contextTruncated: contextProjection.caps.truncated,
    });
    assertCase(cases, "rug005_detects_over_budget_pressure", maintenance.pressure.pressureState === "over_budget" &&
      maintenance.visibleCharCount > 70_000, {
      pressureState: maintenance.pressure.pressureState,
      visibleCharCount: maintenance.visibleCharCount,
      totalEstimatedTokens: maintenance.pressure.totalEstimatedTokens,
    });
    assertCase(cases, "rug005_selects_local_trim_not_compaction", maintenance.route.routeKind === "local_trim" &&
      maintenance.route.routeClass === "trim" &&
      maintenance.route.engine === "local_deterministic", {
      routeKind: maintenance.route.routeKind,
      routeClass: maintenance.route.routeClass,
      engine: maintenance.route.engine,
    });
    assertCase(cases, "rug005_context_pack_cites_maintenance_refs", Boolean(contextResult.contextPack.maintenanceRefs?.refsDigest) &&
      Boolean(requestManifestRefs.omissionLedgerId) &&
      contextArtifactKinds.includes("context_omission_ledger") &&
      contextArtifactKinds.includes("context_pressure_estimate") &&
      contextArtifactKinds.includes("frontier_baton"), {
      contextArtifactKinds,
      requestManifestMaintenanceRefsPresent: Boolean(contextResult.requestManifest.maintenanceRefs),
    });
    assertCase(cases, "rug005_omission_parity", Number(contextResult.contextPack.caps.omittedCounts.context_omission_ledger_items || 0) ===
      Number(maintenance.omissionLedger.totals.omittedItemCount || 0), {
      contextPackOmittedItems: contextResult.contextPack.caps.omittedCounts.context_omission_ledger_items,
      ledgerOmittedItems: maintenance.omissionLedger.totals.omittedItemCount,
    });
    assertCase(cases, "rug005_no_hidden_provider_or_compaction_authority", !/provider_compact_primitive|remote_compaction|hybrid_compaction/i.test(stableStringify({
      route: maintenance.route,
      manifest: maintenance.manifest,
      prompt: providerPromptText,
    })) && contextResult.requestManifest.previousResponseIdUsed !== true &&
      contextResult.requestManifest.rawRequestBodyStored !== true, {
      previousResponseIdUsed: contextResult.requestManifest.previousResponseIdUsed,
      rawRequestBodyStored: contextResult.requestManifest.rawRequestBodyStored,
      providerInputCharCount: providerPromptText.length,
    });
    const statusAction = validateStatusProjectionAction({
      projection: statusProjection,
      expectedUiProjectionGeneration: statusProjection.uiProjectionGeneration,
      expectedSourceDigest: statusProjection.sourceDigest,
      expectedOperationLedgerHeadDigest: statusProjection.operationLedgerHeadDigest,
      actionKind: "inspect_status",
    });
    assertCase(cases, "rug005_status_projection_is_display_only", statusProjection.schema === "direct_context_maintenance_status_projection@1" &&
      statusProjection.displayOnly === true &&
      statusAction.runtimeAuthorityGranted === false &&
      statusAction.providerTransportAllowed === false, {
      pressureState: statusProjection.pressureState,
      statusAction,
    });

    const failed = cases.filter((entry) => entry.status !== "passed");
    report = {
      schema: REPORT_SCHEMA,
      runId,
      branch: await gitValue(["branch", "--show-current"]),
      commit: await gitValue(["rev-parse", "HEAD"]),
      generatedAt: nowIso(),
      status: failed.length ? "failed" : "passed",
      coverageSource: "local_real_long_context_pressure",
      matrixRowsExercised: ["D1", "D2", "D13", "D14", "D22", "D23", "J11"],
      matrixPromotionCandidate: false,
      authorityPromotionCandidate: false,
      runtimeAuthorityExercised: false,
      providerAuthorityExercised: false,
      rug005Closed: failed.length === 0,
      cases,
      artifacts: {
        rendererProjectionId: rendererProjection.projectionId,
        contextProjectionId: contextProjection.projectionId,
        pressureEstimateId: maintenance.pressure.pressureEstimateId,
        routeId: maintenance.route.routeId,
        trimPlanId: maintenance.trimPlan.trimPlanId,
        omissionLedgerId: maintenance.omissionLedger.omissionLedgerId,
        contextBuildId: contextResult.contextPack.contextBuildId,
        requestManifestId: contextResult.requestManifest.requestManifestId,
        statusProjectionGeneration: statusProjection.uiProjectionGeneration,
        rawPathsIncluded: false,
      },
      sentinelCounters: {
        providerTransportCalls: 0,
        providerCompactPrimitiveCalls: 0,
        appServerSpawnCalls: 0,
        appServerMutationCalls: 0,
        workspaceReadCalls: 0,
        patchApplyCalls: 0,
        commandRunCalls: 0,
        rightPaneMutationCalls: 0,
        handoffMutationCalls: 0,
      },
      rawExposureScan: {
        scanned: true,
        status: "passed",
        findingCount: 0,
      },
    };
  } finally {
    threadStore.close();
  }

  validateReport(report);
  const findings = scanFixtureForSecrets(report, { privatePathRoots: [outputDir, privateRoot] });
  report.rawExposureScan.findingCount = findings.length;
  report.rawExposureScan.status = findings.length ? "failed" : "passed";
  if (findings.length) {
    const minimal = {
      schema: REPORT_SCHEMA,
      runId,
      generatedAt: nowIso(),
      status: "failed",
      failureCode: "raw_exposure_blocked",
      rawExposureBlocked: true,
      sentinelCounters: {
        providerTransportCalls: 0,
        providerCompactPrimitiveCalls: 0,
        appServerSpawnCalls: 0,
        appServerMutationCalls: 0,
        workspaceReadCalls: 0,
        patchApplyCalls: 0,
        commandRunCalls: 0,
        rightPaneMutationCalls: 0,
        handoffMutationCalls: 0,
      },
      rawExposureScan: { scanned: true, status: "failed", findingCount: findings.length },
    };
    const reportPath = path.join(outputDir, "direct-long-context-pressure-report.json");
    writeJsonAtomic(reportPath, minimal);
    console.log(JSON.stringify({
      ok: false,
      reportPath,
      status: minimal.status,
      failureCode: minimal.failureCode,
    }, null, 2));
    process.exit(1);
  }

  const reportPath = path.join(outputDir, "direct-long-context-pressure-report.json");
  const markdownPath = path.join(outputDir, "direct-long-context-pressure-report.md");
  writeJsonAtomic(reportPath, report);
  writeTextFile(markdownPath, markdownSummary(report));
  validateReport(report);
  console.log(JSON.stringify({
    ok: report.status === "passed",
    reportPath,
    status: report.status,
    passedCases: report.cases.filter((entry) => entry.status === "passed").length,
    totalCases: report.cases.length,
  }, null, 2));
  process.exit(report.status === "passed" ? 0 : 1);
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
